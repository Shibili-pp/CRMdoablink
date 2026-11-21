const bcrypt = require('bcryptjs');
const {
  Branch, Team, User, Lead, LeadActivity, LeadAssignment, LeadSwapRequest, LeadImport, FollowUp,
  CallLog, CallRecording, DialRequest, RevenueOpportunity, Payment, Invoice, HourlyReport,
  HourlyManual, HourlyCheckIn, Target, Notification, LeaveRequest, AuditLog, SyncedContact, SyncBatch,
} = require('../models');
const { ensureReferenceData, roleTemplate } = require('../services/settings');
const { ensureLoginAccounts } = require('./loginAccounts');
const leads = require('../services/leads');
const followups = require('../services/followups');
const { recordCall } = require('../services/calls');
const revenue = require('../services/revenue');
const targets = require('../services/targets');
const { generateElapsed } = require('../services/hourly');
const { dateKeyFromDate, startOfLocalDay } = require('../utils/time');

const META = { ip: 'seed', userAgent: 'doablinkorbit-seed' };
const TZ = 'Asia/Kolkata';

function assertNotProduction() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed demo accounts in production');
  }
}

async function clearDemo() {
  const demoLeads = await Lead.find({ isDemo: true }).distinct('_id');
  const demoUsers = await User.find({ isDemo: true }).distinct('_id');
  await Promise.all([
    LeadActivity.deleteMany({ $or: [{ lead: { $in: demoLeads } }, { isDemo: true }] }),
    LeadAssignment.deleteMany({ lead: { $in: demoLeads } }),
    LeadSwapRequest.deleteMany({ $or: [{ lead: { $in: demoLeads } }, { isDemo: true }] }),
    LeadImport.deleteMany({ isDemo: true }),
    FollowUp.deleteMany({ $or: [{ isDemo: true }, { lead: { $in: demoLeads } }] }),
    CallLog.deleteMany({ $or: [{ isDemo: true }, { dataSource: 'demo_seed' }, { lead: { $in: demoLeads } }] }),
    CallRecording.deleteMany({ $or: [{ isDemo: true }, { lead: { $in: demoLeads } }] }),
    DialRequest.deleteMany({ lead: { $in: demoLeads } }),
    RevenueOpportunity.deleteMany({ $or: [{ isDemo: true }, { lead: { $in: demoLeads } }] }),
    Payment.deleteMany({ $or: [{ isDemo: true }, { lead: { $in: demoLeads } }] }),
    Invoice.deleteMany({ isDemo: true }),
    HourlyReport.deleteMany({ staff: { $in: demoUsers } }),
    HourlyManual.deleteMany({ staff: { $in: demoUsers } }),
    HourlyCheckIn.deleteMany({ staff: { $in: demoUsers } }),
    Target.deleteMany({ isDemo: true }),
    Notification.deleteMany({ $or: [{ user: { $in: demoUsers } }, { isDemo: true }] }),
    LeaveRequest.deleteMany({ isDemo: true }),
    AuditLog.deleteMany({ isDemo: true }),
    SyncedContact.deleteMany({ isDemo: true }),
    SyncBatch.deleteMany({ isDemo: true }),
    Lead.deleteMany({ isDemo: true }),
  ]);
}

async function clearDummyKeepLogins() {
  assertNotProduction();
  await ensureReferenceData();
  await clearDemo();
  // Also remove leftover sample-style leads/calls that were not flagged isDemo.
  const samplePhones = [
    '919900000001', '919900000002', '919900000003', '919900000004', '919900000005',
    '919900000006', '919900000007', '919900000008', '919900000101', '919900000102',
    '919900000103', '919900000104', '919900000201', '919900000999',
  ];
  const leftover = await Lead.find({
    $or: [
      { phoneNormalized: { $in: samplePhones } },
      { phone: { $regex: /^9900000/ } },
      { name: { $regex: /^(Bucket Lead|Kochi Walk-in)/i } },
    ],
  }).distinct('_id');
  if (leftover.length) {
    await Promise.all([
      LeadActivity.deleteMany({ lead: { $in: leftover } }),
      LeadAssignment.deleteMany({ lead: { $in: leftover } }),
      LeadSwapRequest.deleteMany({ lead: { $in: leftover } }),
      FollowUp.deleteMany({ lead: { $in: leftover } }),
      CallLog.deleteMany({ lead: { $in: leftover } }),
      CallRecording.deleteMany({ lead: { $in: leftover } }),
      RevenueOpportunity.deleteMany({ lead: { $in: leftover } }),
      Payment.deleteMany({ lead: { $in: leftover } }),
      Lead.deleteMany({ _id: { $in: leftover } }),
    ]);
  }
  await CallLog.deleteMany({ dataSource: 'demo_seed' });
  await ensureLoginAccounts();
  const left = await Lead.countDocuments({ isDemo: true });
  return { cleared: true, demoLeadsLeft: left };
}

async function ensureOrg() {
  const headOffice = await Branch.findOneAndUpdate(
    { code: 'HO' },
    { name: 'Head Office', code: 'HO', city: 'Ernakulam', state: 'Kerala', country: 'India', isDemo: true, isActive: true, deletedAt: null },
    { upsert: true, new: true }
  );
  const kochi = await Branch.findOneAndUpdate(
    { code: 'KOC' },
    { name: 'Kochi Branch', code: 'KOC', city: 'Kochi', state: 'Kerala', country: 'India', isDemo: true, isActive: true, deletedAt: null },
    { upsert: true, new: true }
  );
  const inside = await Team.findOneAndUpdate(
    { code: 'INSIDE' },
    { name: 'Inside Sales', code: 'INSIDE', branch: headOffice._id, description: 'Demo inside sales team', isDemo: true, isActive: true, deletedAt: null },
    { upsert: true, new: true }
  );
  const field = await Team.findOneAndUpdate(
    { code: 'FIELD' },
    { name: 'Field Sales', code: 'FIELD', branch: kochi._id, description: 'Demo field team', isDemo: true, isActive: true, deletedAt: null },
    { upsert: true, new: true }
  );
  return { headOffice, kochi, inside, field };
}

async function ensureUser(spec) {
  const existing = await User.findOne({ username: spec.username });
  if (existing) return existing;
  const permissions = await roleTemplate(spec.role);
  return User.create({
    username: spec.username,
    email: `${spec.username}@doablinkorbit.demo`,
    passwordHash: await bcrypt.hash('1234567', 10),
    name: spec.name,
    employeeId: spec.employeeId,
    role: spec.role,
    permissions,
    permissionMode: 'role',
    branch: spec.branch,
    team: spec.team,
    managedTeams: spec.managedTeams || [],
    manager: spec.manager,
    joiningDate: new Date('2024-04-01'),
    employmentStatus: 'active',
    isActive: true,
    isDemo: true,
    maxLeadAllocation: spec.maxLeadAllocation || 40,
    phone: spec.phone || '',
  });
}

async function markDemoLead(leadId) {
  await Lead.updateOne({ _id: leadId }, { isDemo: true });
}

function atMinutesAgo(minutes, timezone) {
  const candidate = new Date(Date.now() - minutes * 60000);
  const start = startOfLocalDay(new Date(), timezone);
  if (candidate < start) return new Date(start.getTime() + 60000);
  return candidate;
}

async function seedOperations(users, org) {
  const { owner, admin, teamleader, staff } = users;
  const samples = [
    ['Anjali Krishna', '9900000001', 'fresh', staff, 'Meta Ads', 'Ernakulam', 25000],
    ['Joseph Mathew', '9900000002', 'contacted', staff, 'Google Ads', 'Thrissur', 40000],
    ['Fathima Noor', '9900000003', 'positive', staff, 'Website', 'Kozhikode', 50000],
    ['Arun Prakash', '9900000004', 'demo_completed', staff, 'Referral', 'Ernakulam', 80000],
    ['Divya Suresh', '9900000005', 'payment_pending', staff, 'Campaign', 'Kollam', 60000],
    ['Hari Menon', '9900000006', 'onboarded', staff, 'Walk-in', 'Ernakulam', 80000],
    ['Sneha Pillai', '9900000007', 'lost', teamleader, 'Telecalling', 'Alappuzha', 15000],
    ['Nithin Roy', '9900000008', 'interested', teamleader, 'Manual Upload', 'Ernakulam', 30000],
  ];
  const created = [];
  for (const [name, local, status, assignee, source, district, expected] of samples) {
    const result = await leads.create(owner, {
      name,
      phone: local,
      source,
      district,
      city: district,
      state: 'Kerala',
      status: 'fresh',
      priority: expected >= 50000 ? 'high' : 'medium',
      expectedRevenue: expected,
      assignedTo: assignee._id,
      company: `${name.split(' ')[0]} Traders`,
      category: 'Subscription',
    }, META);
    await markDemoLead(result.data._id || result.data.id);
    if (status !== 'fresh') {
      await leads.update(owner, result.data._id || result.data.id, {
        status,
        lostReason: status === 'lost' ? 'Chose another vendor' : '',
        nextActionTitle: status === 'demo_completed' ? 'Send subscription proposal' : status === 'payment_pending' ? 'Collect advance payment' : '',
        nextActionDueAt: status === 'payment_pending' ? new Date() : undefined,
      }, META);
    }
    created.push({ ...(result.data), status, assignee });
  }
  for (let index = 1; index <= 4; index += 1) {
    const result = await leads.create(owner, {
      name: `Bucket Lead ${index}`,
      phone: `990000010${index}`,
      source: index % 2 ? 'Meta Ads' : 'Website',
      district: 'Ernakulam',
      city: 'Kochi',
      state: 'Kerala',
      branch: org.headOffice._id,
      priority: 'medium',
      category: 'New enquiry',
    }, META);
    await markDemoLead(result.data._id || result.data.id);
  }
  const kochiLead = await leads.create(owner, {
    name: 'Kochi Walk-in',
    phone: '9900000201',
    source: 'Walk-in',
    district: 'Ernakulam',
    city: 'Kochi',
    state: 'Kerala',
    branch: org.kochi._id,
    priority: 'high',
  }, META);
  await markDemoLead(kochiLead.data._id || kochiLead.data.id);

  const positive = created.find((lead) => lead.status === 'positive');
  const won = created.find((lead) => lead.status === 'onboarded');
  const pending = created.find((lead) => lead.status === 'payment_pending');
  const contacted = created.find((lead) => lead.status === 'contacted');
  const idOf = (lead) => lead._id || lead.id;

  await followups.create(staff, {
    leadId: idOf(contacted), title: 'Call back about the brochure', date: new Date().toISOString().slice(0, 10), time: '18:30', priority: 'high', isDemo: true,
  }, META);
  await FollowUp.updateMany({ lead: idOf(contacted) }, { isDemo: true });
  const yesterday = new Date(Date.now() - 26 * 3600000);
  await followups.create(staff, {
    leadId: idOf(pending), title: 'Collect advance payment', dueAt: yesterday, priority: 'urgent',
  }, META);
  await FollowUp.updateMany({ lead: idOf(pending) }, { isDemo: true });

  const callPlan = [
    [contacted, 'outgoing', 'connected', 180, 5],
    [contacted, 'outgoing', 'not_connected', 0, 12],
    [positive, 'outgoing', 'connected', 240, 18],
    [pending, 'incoming', 'connected', 90, 25],
    [won, 'outgoing', 'connected', 300, 33],
  ];
  for (const [lead, callType, status, durationSeconds, minutes] of callPlan) {
    await recordCall({
      staff,
      payload: {
        phone: lead.phone || lead.phoneNormalized,
        callType,
        status,
        durationSeconds,
        startedAt: atMinutesAgo(minutes, TZ),
      },
      dataSource: 'demo_seed',
      actor: staff,
    });
  }

  const openDeal = await revenue.create(admin, {
    leadId: idOf(positive),
    title: 'Subscription proposal',
    expectedRevenue: 50000,
    dealValue: 50000,
    probability: 60,
    stage: 'proposal',
  }, META);
  const closedDeal = await revenue.create(admin, {
    leadId: idOf(won),
    title: 'Onboarded subscription',
    expectedRevenue: 80000,
    dealValue: 80000,
    probability: 100,
    stage: 'won',
  }, META);
  await RevenueOpportunity.updateMany({ _id: { $in: [openDeal.data._id, closedDeal.data._id] } }, { isDemo: true });
  const payment = await revenue.addPayment(admin, {
    opportunityId: closedDeal.data._id,
    amount: 30000,
    method: 'upi',
    transactionRef: 'UPI-DEMO-30000',
    notes: 'Partial collection. This is demo seed data.',
  }, META);
  await Payment.updateOne({ _id: payment.data.payment._id }, { isDemo: true });

  const start = startOfLocalDay(new Date(), TZ);
  const end = new Date(start.getTime() + 60 * 86400000);
  const target = await targets.create(admin, {
    name: 'Daily connected calls',
    type: 'daily_connected_calls',
    assigneeType: 'staff',
    staff: staff._id,
    branch: org.headOffice._id,
    value: 10,
    period: 'daily',
    startDate: start,
    endDate: end,
  }, META);
  await Target.updateOne({ _id: target.data._id }, { isDemo: true });

  await leads.requestSwap(staff, {
    leadId: idOf(positive),
    toStaff: teamleader._id,
    reason: 'Customer asked to speak with the team leader',
  }, META);

  await generateElapsed(dateKeyFromDate(new Date(), TZ), String(staff._id));
  await Notification.updateMany({ user: { $in: [owner._id, admin._id, teamleader._id, staff._id] } }, { $set: {} });
}

async function seedDemo({ reset = false } = {}) {
  assertNotProduction();
  await ensureReferenceData();
  if (reset) await clearDemo();
  const org = await ensureOrg();
  const owner = await ensureUser({ username: 'owner', role: 'OWNER', name: 'Asha Menon', employeeId: 'EMP-001', branch: org.headOffice._id });
  const superadmin = await ensureUser({ username: 'superadmin', role: 'SUPER_ADMIN', name: 'Rahul Nair', employeeId: 'EMP-002', branch: org.headOffice._id });
  const admin = await ensureUser({ username: 'admin', role: 'ADMIN', name: 'Meera Iyer', employeeId: 'EMP-003', branch: org.headOffice._id, managedTeams: [org.inside._id] });
  const teamleader = await ensureUser({ username: 'teamleader', role: 'TEAM_LEADER', name: 'Vikram Das', employeeId: 'EMP-004', branch: org.headOffice._id, team: org.inside._id, maxLeadAllocation: 35 });
  const staff = await ensureUser({ username: 'staff', role: 'STAFF', name: 'Neha Joseph', employeeId: 'EMP-005', branch: org.headOffice._id, team: org.inside._id, manager: teamleader._id, maxLeadAllocation: 30, phone: '9900000999' });
  await Team.updateOne({ _id: org.inside._id }, { leader: teamleader._id });
  const existing = await Lead.countDocuments({ isDemo: true });
  if (!reset && existing > 0) return { seeded: false, reason: 'Demo leads already exist' };
  await seedOperations({ owner, superadmin, admin, teamleader, staff }, org);
  return { seeded: true };
}

async function runFromCli() {
  const { connectDb } = require('../config/db');
  require('dotenv').config();
  assertNotProduction();
  await connectDb();
  if (process.argv.includes('--clear-only')) {
    const result = await clearDummyKeepLogins();
    console.log(`Dummy CRM data cleared. Role logins kept. Demo leads left: ${result.demoLeadsLeft}.`);
    process.exit(0);
  }
  const result = await seedDemo({ reset: process.argv.includes('--reset') });
  console.log(result.seeded ? 'Demo data seeded.' : 'Demo users verified. Leads were already present.');
  console.log('Demo passwords are 1234567 and are refused when NODE_ENV=production.');
  process.exit(0);
}

if (require.main === module) {
  runFromCli().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { seedDemo, clearDemo, clearDummyKeepLogins };
