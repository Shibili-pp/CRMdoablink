const {
  RevenueOpportunity, Payment, Invoice, Lead, Counter,
} = require('../models');
const { AppError, paging, metaFor } = require('../utils/http');
const { summarizeMoney } = require('../utils/revenue');
const { recordAudit } = require('./audit');
const { addActivity } = require('./activity');
const { recordScope, isElevated } = require('./access');
const { PipelineStage } = require('../models');

async function nextInvoiceNumber() {
  await Counter.updateOne({ _id: 'invoice' }, { $setOnInsert: { seq: 1000 } }, { upsert: true });
  const counter = await Counter.findOneAndUpdate({ _id: 'invoice' }, { $inc: { seq: 1 } }, { new: true });
  return `INV-${counter.seq}`;
}

function scope(user) {
  return recordScope(user, { staff: 'staff' });
}

async function list(user, query) {
  const { page, limit, skip } = paging(query);
  const filter = { deletedAt: null, ...scope(user) };
  if (query.status) filter.status = query.status;
  if (query.stage) filter.stage = query.stage;
  const [rows, total] = await Promise.all([
    RevenueOpportunity.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit)
      .populate('lead', 'leadCode name status')
      .populate('staff', 'name')
      .lean(),
    RevenueOpportunity.countDocuments(filter),
  ]);
  return {
    data: rows.map((row) => ({
      ...row,
      weighted: Math.round((row.expectedRevenue || 0) * ((row.probability || 0) / 100)),
    })),
    meta: metaFor(page, limit, total),
  };
}

async function create(user, body, meta) {
  const lead = await Lead.findOne({ _id: body.leadId, deletedAt: null });
  if (!lead) throw new AppError('Lead not found', 404);
  if (!isElevated(user) && lead.branch && user.branch && String(lead.branch) !== String(user.branch) && user.role === 'ADMIN') {
    throw new AppError('Lead not found', 404);
  }
  const stage = body.stage || 'new';
  const stageDoc = await PipelineStage.findOne({ key: stage });
  const opportunity = await RevenueOpportunity.create({
    lead: lead._id,
    staff: body.staff || lead.assignedTo || user._id,
    team: lead.team,
    branch: lead.branch,
    title: body.title || lead.company || lead.name,
    expectedRevenue: body.expectedRevenue || 0,
    dealValue: body.dealValue || 0,
    probability: body.probability ?? stageDoc?.probability ?? 10,
    expectedCloseDate: body.expectedCloseDate || null,
    stage,
    status: stageDoc?.isWon ? 'won' : stageDoc?.isLost ? 'lost' : 'open',
    createdBy: user._id,
  });
  lead.expectedRevenue = opportunity.expectedRevenue;
  lead.revenueProbability = opportunity.probability;
  await lead.save();
  await addActivity({
    lead, type: 'revenue_updated', actor: user,
    description: `Pipeline opportunity created for ${opportunity.expectedRevenue}`,
    newValue: { expectedRevenue: opportunity.expectedRevenue, probability: opportunity.probability },
  });
  await recordAudit({
    user: user._id, username: user.username, action: 'revenue.create', module: 'revenue', recordId: opportunity.id, newValues: body, ...meta,
  });
  return { data: opportunity, message: 'Opportunity created', status: 201 };
}

async function update(user, id, body, meta) {
  const opportunity = await RevenueOpportunity.findOne({ _id: id, deletedAt: null, ...scope(user) });
  if (!opportunity) throw new AppError('Opportunity not found', 404);
  const previous = {
    expectedRevenue: opportunity.expectedRevenue,
    dealValue: opportunity.dealValue,
    probability: opportunity.probability,
    stage: opportunity.stage,
    status: opportunity.status,
  };
  ['title', 'expectedRevenue', 'dealValue', 'probability', 'expectedCloseDate', 'stage', 'status', 'staff'].forEach((key) => {
    if (body[key] !== undefined) opportunity[key] = body[key];
  });
  if (body.stage) {
    const stageDoc = await PipelineStage.findOne({ key: body.stage });
    if (stageDoc?.isWon) opportunity.status = 'won';
    if (stageDoc?.isLost) opportunity.status = 'lost';
    if (body.probability == null && stageDoc) opportunity.probability = stageDoc.probability;
  }
  await opportunity.save();
  await addActivity({
    lead: opportunity.lead, type: 'revenue_updated', actor: user, description: 'Revenue opportunity updated',
    oldValue: previous, newValue: { expectedRevenue: opportunity.expectedRevenue, status: opportunity.status, stage: opportunity.stage },
  });
  await recordAudit({
    user: user._id, username: user.username, action: 'revenue.update', module: 'revenue', recordId: id, oldValues: previous, newValues: body, ...meta,
  });
  return { data: opportunity, message: 'Opportunity updated' };
}

async function refreshCollected(opportunityId) {
  const rows = await Payment.aggregate([
    { $match: { opportunity: opportunityId } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  const total = rows[0]?.total || 0;
  await RevenueOpportunity.updateOne({ _id: opportunityId }, { collectedAmount: total });
  return total;
}

async function addPayment(user, body, meta) {
  const opportunity = await RevenueOpportunity.findOne({ _id: body.opportunityId, deletedAt: null });
  if (!opportunity) throw new AppError('Opportunity not found', 404);
  const payment = await Payment.create({
    opportunity: opportunity._id,
    lead: opportunity.lead,
    invoice: body.invoiceId || null,
    staff: opportunity.staff,
    team: opportunity.team,
    branch: opportunity.branch,
    amount: body.amount,
    paidAt: body.paidAt || new Date(),
    method: body.method || 'upi',
    transactionRef: body.transactionRef || '',
    invoiceRef: body.invoiceRef || '',
    recordedBy: user._id,
    notes: body.notes || '',
  });
  const collected = await refreshCollected(opportunity._id);
  if (body.invoiceId) {
    const invoice = await Invoice.findById(body.invoiceId);
    if (invoice) {
      const paid = await Payment.aggregate([
        { $match: { invoice: invoice._id } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]);
      const amountPaid = paid[0]?.total || 0;
      invoice.status = amountPaid <= 0 ? 'issued' : amountPaid >= invoice.amount ? 'paid' : 'partial';
      await invoice.save();
    }
  }
  await addActivity({
    lead: opportunity.lead, type: 'payment_received', actor: user,
    description: `Payment of ${body.amount} recorded by ${body.method || 'upi'}. Collected total is ${collected}. Expected revenue is unchanged.`,
    newValue: { amount: body.amount, collected },
  });
  await recordAudit({
    user: user._id, username: user.username, action: 'payment.create', module: 'revenue', recordId: payment.id,
    newValues: { amount: body.amount, method: body.method, transactionRef: body.transactionRef }, ...meta,
  });
  return { data: { payment, collected }, message: 'Payment recorded', status: 201 };
}

async function listPayments(user, query) {
  const { page, limit, skip } = paging(query);
  const filter = { ...scope(user) };
  if (query.leadId) filter.lead = query.leadId;
  const [rows, total] = await Promise.all([
    Payment.find(filter).sort({ paidAt: -1 }).skip(skip).limit(limit).populate('lead', 'leadCode name').populate('recordedBy', 'name').lean(),
    Payment.countDocuments(filter),
  ]);
  return { data: rows, meta: metaFor(page, limit, total) };
}

async function createInvoice(user, body, meta) {
  const opportunity = await RevenueOpportunity.findById(body.opportunityId);
  if (!opportunity) throw new AppError('Opportunity not found', 404);
  const invoice = await Invoice.create({
    invoiceNumber: await nextInvoiceNumber(),
    opportunity: opportunity._id,
    lead: opportunity.lead,
    amount: body.amount,
    status: 'issued',
    issuedAt: new Date(),
    notes: body.notes || '',
  });
  await recordAudit({
    user: user._id, username: user.username, action: 'invoice.create', module: 'revenue', recordId: invoice.id, newValues: { amount: body.amount, invoiceNumber: invoice.invoiceNumber }, ...meta,
  });
  return { data: invoice, message: 'Invoice created', status: 201 };
}

async function listInvoices(user, query) {
  const { page, limit, skip } = paging(query);
  const leadIds = await RevenueOpportunity.find({ deletedAt: null, ...scope(user) }).distinct('lead');
  const filter = { lead: { $in: leadIds } };
  const [rows, total] = await Promise.all([
    Invoice.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Invoice.countDocuments(filter),
  ]);
  return { data: rows, meta: metaFor(page, limit, total) };
}

async function summary(user) {
  const filter = { deletedAt: null, ...scope(user) };
  const opportunities = await RevenueOpportunity.find(filter).lean();
  const payments = await Payment.find({ opportunity: { $in: opportunities.map((row) => row._id) } }).lean();
  const money = summarizeMoney(opportunities, payments);
  const leadForecast = await Lead.aggregate([
    { $match: { deletedAt: null, ...(recordScope(user, { staff: 'assignedTo' })) } },
    { $group: { _id: null, total: { $sum: '$expectedRevenue' } } },
  ]);
  return {
    data: {
      ...money,
      leadStatedExpected: leadForecast[0]?.total || 0,
      note: 'Collected revenue is the sum of payments. Expected and weighted pipeline figures are not collected revenue.',
    },
  };
}

module.exports = {
  list, create, update, addPayment, listPayments, createInvoice, listInvoices, summary,
};
