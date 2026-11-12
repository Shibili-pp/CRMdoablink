const { FollowUp, Lead, User } = require('../models');
const { AppError, paging, metaFor, sortFrom } = require('../utils/http');
const { combineLocal, periodRange, dateKeyFromDate, zonedParts } = require('../utils/time');
const { recordAudit } = require('./audit');
const { notify } = require('./notify');
const { addActivity } = require('./activity');
const { getGeneral } = require('./settings');
const { recordScope, combine, isElevated, hasPermission } = require('./access');

function scopeFor(user) {
  return recordScope(user, { staff: 'assignedTo' });
}

async function dueFrom(body) {
  if (body.dueAt) return new Date(body.dueAt);
  const general = await getGeneral();
  if (!body.date) throw new AppError('Follow-up date is required', 422);
  return combineLocal(body.date, body.time || '09:00', general.timezone);
}

async function list(user, query) {
  const { page, limit, skip } = paging(query);
  const filter = combine({}, scopeFor(user));
  const now = new Date();
  if (query.status) filter.status = query.status;
  if (query.staff && user.role !== 'STAFF') filter.assignedTo = query.staff;
  if (query.priority) filter.priority = query.priority;
  if (query.bucket === 'today') {
    const general = await getGeneral();
    const range = periodRange('day', general.timezone, now);
    filter.status = 'pending';
    filter.dueAt = { $gte: range.start, $lt: range.end };
  } else if (query.bucket === 'upcoming') {
    filter.status = 'pending';
    filter.dueAt = { $gt: now };
  } else if (query.bucket === 'overdue') {
    filter.status = { $in: ['pending', 'missed'] };
    filter.dueAt = { $lt: now };
  } else if (query.bucket === 'missed') {
    filter.status = 'missed';
  }
  if (query.date) {
    const general = await getGeneral();
    const start = combineLocal(query.date, '00:00', general.timezone);
    const end = new Date(start.getTime() + 86400000);
    filter.dueAt = { $gte: start, $lt: end };
  }
  const sort = sortFrom(query, ['dueAt', 'priority', 'createdAt'], 'dueAt');
  if (!query.order) sort.dueAt = 1;
  const [rows, total] = await Promise.all([
    FollowUp.find(filter).sort(sort).skip(skip).limit(limit)
      .populate('assignedTo', 'name')
      .populate('lead', 'leadCode name status')
      .lean(),
    FollowUp.countDocuments(filter),
  ]);
  return { data: rows.map((row) => ({ ...row, overdue: row.status === 'pending' && new Date(row.dueAt) < now })), meta: metaFor(page, limit, total) };
}

async function create(user, body, meta) {
  const lead = await Lead.findOne({ _id: body.leadId, deletedAt: null });
  if (!lead) throw new AppError('Lead not found', 404);
  if (user.role === 'STAFF' && String(lead.assignedTo || '') !== String(user._id)) {
    throw new AppError('You can only add follow-ups on your own leads', 403);
  }
  if (!isElevated(user) && user.role !== 'STAFF' && lead.branch && String(lead.branch) !== String(user.branch)) {
    throw new AppError('Lead not found', 404);
  }
  let assignedTo = body.assignedTo || lead.assignedTo || user._id;
  if (user.role === 'STAFF') assignedTo = user._id;
  const staff = await User.findById(assignedTo);
  if (!staff) throw new AppError('Assigned staff member was not found', 422);
  const dueAt = await dueFrom(body);
  const followUp = await FollowUp.create({
    lead: lead._id,
    leadName: lead.name,
    leadCode: lead.leadCode,
    assignedTo: staff._id,
    team: staff.team || lead.team,
    branch: staff.branch || lead.branch,
    title: body.title.trim(),
    description: body.description || '',
    dueAt,
    priority: body.priority || 'medium',
    createdBy: user._id,
    isDemo: Boolean(body.isDemo),
  });
  lead.followUpAt = dueAt;
  lead.nextActionTitle = body.title.trim();
  lead.nextActionDueAt = dueAt;
  await lead.save();
  await addActivity({
    lead, type: 'followup_created', actor: user, description: `${followUp.title} due ${dueAt.toISOString()}`,
    newValue: { followUpId: followUp.id, dueAt },
  });
  if (String(staff._id) !== String(user._id)) {
    await notify({
      user: staff._id, type: 'followup_assigned', title: 'New follow-up', body: `${lead.name}: ${followUp.title}`,
      module: 'followups', recordId: followUp.id,
    });
  }
  await recordAudit({
    user: user._id, username: user.username, action: 'followup.create', module: 'followups', recordId: followUp.id, newValues: { title: followUp.title, dueAt }, ...meta,
  });
  return { data: followUp, message: 'Follow-up created', status: 201 };
}

async function update(user, id, body, meta) {
  const followUp = await FollowUp.findOne({ _id: id, ...scopeFor(user) });
  if (!followUp) throw new AppError('Follow-up not found', 404);
  if (followUp.status !== 'pending') throw new AppError('Only pending follow-ups can be edited', 400);
  if (user.role === 'STAFF' && String(followUp.createdBy) !== String(user._id) && String(followUp.assignedTo) !== String(user._id)) {
    throw new AppError('You cannot edit this follow-up', 403);
  }
  if (body.title) followUp.title = body.title.trim();
  if (body.description !== undefined) followUp.description = body.description;
  if (body.priority) followUp.priority = body.priority;
  let demoReschedule = null;
  if (body.date || body.dueAt) {
    const nextDue = await dueFrom(body);
    const previousDue = followUp.dueAt ? new Date(followUp.dueAt) : null;
    const changed = !previousDue || previousDue.getTime() !== nextDue.getTime();
    const title = body.title || followUp.title || '';
    const description = body.description !== undefined ? body.description : (followUp.description || '');
    if (changed && /demo/i.test(`${title} ${description}`)) {
      demoReschedule = { previousDue, nextDue };
    }
    followUp.dueAt = nextDue;
  }
  if (body.assignedTo && hasPermission(user, 'leads.assign')) followUp.assignedTo = body.assignedTo;
  await followUp.save();
  if (demoReschedule) {
    await addActivity({
      lead: followUp.lead,
      type: 'followup_rescheduled',
      actor: user,
      description: `Demo postponed to ${demoReschedule.nextDue.toISOString()}`,
      oldValue: demoReschedule.previousDue,
      newValue: demoReschedule.nextDue,
      metadata: { demo: true, followUpId: String(followUp._id) },
    });
  }
  await recordAudit({
    user: user._id, username: user.username, action: 'followup.update', module: 'followups', recordId: id, newValues: body, ...meta,
  });
  return { data: followUp, message: demoReschedule ? 'Demo rescheduled' : 'Follow-up updated' };
}

async function complete(user, id, body, meta) {
  const followUp = await FollowUp.findOne({ _id: id, ...scopeFor(user) });
  if (!followUp || followUp.status === 'cancelled') throw new AppError('Follow-up not found', 404);
  const completedAt = new Date();
  followUp.status = 'completed';
  followUp.completedAt = completedAt;
  followUp.completionNotes = body.notes || '';
  followUp.completedOnTime = completedAt <= new Date(followUp.dueAt);
  await followUp.save();
  await addActivity({
    lead: followUp.lead, type: 'followup_completed', actor: user,
    description: followUp.completedOnTime ? `Completed on time: ${followUp.title}` : `Completed late: ${followUp.title}`,
    newValue: { notes: followUp.completionNotes, onTime: followUp.completedOnTime },
  });
  await recordAudit({
    user: user._id, username: user.username, action: 'followup.complete', module: 'followups', recordId: id,
    newValues: { onTime: followUp.completedOnTime }, ...meta,
  });
  return { data: followUp, message: followUp.completedOnTime ? 'Follow-up completed on time' : 'Follow-up completed late' };
}

async function summary(user) {
  const scope = scopeFor(user);
  const now = new Date();
  const general = await getGeneral();
  const today = periodRange('day', general.timezone, now);
  const base = { ...scope };
  const [total, onTime, late, pending, overdue, todayCount] = await Promise.all([
    FollowUp.countDocuments(base),
    FollowUp.countDocuments({ ...base, status: 'completed', completedOnTime: true }),
    FollowUp.countDocuments({ ...base, status: 'completed', completedOnTime: false }),
    FollowUp.countDocuments({ ...base, status: 'pending', dueAt: { $gte: now } }),
    FollowUp.countDocuments({ ...base, status: { $in: ['pending', 'missed'] }, dueAt: { $lt: now } }),
    FollowUp.countDocuments({ ...base, status: 'pending', dueAt: { $gte: today.start, $lt: today.end } }),
  ]);
  return { data: { total, onTime, late, pending, overdue, today: todayCount } };
}

async function calendar(user, query) {
  const general = await getGeneral();
  const month = query.month || dateKeyFromDate(new Date(), general.timezone).slice(0, 7);
  const [year, mon] = month.split('-').map(Number);
  const start = combineLocal(`${month}-01`, '00:00', general.timezone);
  const nextMonth = mon === 12 ? `${year + 1}-01-01` : `${year}-${String(mon + 1).padStart(2, '0')}-01`;
  const end = combineLocal(nextMonth, '00:00', general.timezone);
  const rows = await FollowUp.find({ ...scopeFor(user), dueAt: { $gte: start, $lt: end } }).select('dueAt status title leadCode').lean();
  const days = {};
  rows.forEach((row) => {
    const key = dateKeyFromDate(new Date(row.dueAt), general.timezone);
    days[key] = days[key] || { date: key, total: 0, pending: 0, completed: 0, missed: 0 };
    days[key].total += 1;
    if (row.status === 'completed') days[key].completed += 1;
    else if (row.status === 'missed') days[key].missed += 1;
    else days[key].pending += 1;
  });
  return { data: { month, days: Object.values(days), timezone: general.timezone } };
}

async function popups(user) {
  if (user.role !== 'STAFF') return { data: [], meta: { nextOpenAt: null } };
  const now = new Date();
  const mine = { assignedTo: user._id, status: { $in: ['pending', 'missed'] } };
  const [rows, next] = await Promise.all([
    FollowUp.find({
      ...mine,
      dueAt: { $lte: now },
      $or: [{ remindAt: null }, { remindAt: { $lte: now } }],
    }).sort({ dueAt: 1 }).limit(20).select('title leadName leadCode dueAt priority status remindAt').lean(),
    FollowUp.findOne({ ...mine, remindAt: { $gt: now } }).sort({ remindAt: 1 }).select('remindAt').lean(),
  ]);
  return { data: rows, meta: { nextOpenAt: next?.remindAt || null } };
}

async function remindLater(user, id, body, meta) {
  if (user.role !== 'STAFF') throw new AppError('Only the assigned staff member can set a later reminder', 403);
  const followUp = await FollowUp.findOne({ _id: id, assignedTo: user._id });
  if (!followUp) throw new AppError('Follow-up not found', 404);
  if (!['pending', 'missed'].includes(followUp.status) || new Date(followUp.dueAt) >= new Date()) {
    throw new AppError('This follow-up is not overdue', 400);
  }
  const reason = body.reason.trim();
  const dueAt = await dueFrom(body);
  if (dueAt <= new Date()) throw new AppError('Choose a later date and time', 422);
  const previousDue = followUp.dueAt;
  followUp.dueAt = dueAt;
  followUp.remindAt = dueAt;
  followUp.status = 'pending';
  followUp.remindReason = reason;
  followUp.remindedAt = new Date();
  followUp.reminderSentAt = null;
  await followUp.save();
  const lead = await Lead.findById(followUp.lead);
  if (lead) {
    lead.followUpAt = dueAt;
    lead.nextActionTitle = followUp.title;
    lead.nextActionDueAt = dueAt;
    await lead.save();
  }
  await addActivity({
    lead: followUp.lead,
    type: 'followup_reminded',
    actor: user,
    description: `Remind later (${reason}). Next reminder ${dueAt.toISOString()}`,
    oldValue: previousDue,
    newValue: { dueAt, reason },
  });
  await recordAudit({
    user: user._id, username: user.username, action: 'followup.remind', module: 'followups', recordId: id,
    newValues: { dueAt, reason }, ...meta,
  });
  return { data: followUp, message: 'Reminder set' };
}

async function reassignFromStaff(user, body, meta) {
  const result = await FollowUp.updateMany(
    { assignedTo: body.fromStaffId, status: 'pending' },
    { $set: { assignedTo: body.toStaffId } }
  );
  await recordAudit({
    user: user._id, username: user.username, action: 'followup.reassign', module: 'followups',
    newValues: { ...body, modified: result.modifiedCount }, ...meta,
  });
  await notify({
    user: body.toStaffId, type: 'followup_assigned', title: 'Follow-ups reassigned to you',
    body: `${result.modifiedCount} pending follow-ups were moved to you`, module: 'followups',
  });
  return { data: { modified: result.modifiedCount }, message: 'Follow-ups reassigned' };
}

async function processReminders() {
  const now = new Date();
  const soon = new Date(now.getTime() + 15 * 60 * 1000);
  const upcoming = await FollowUp.find({ status: 'pending', reminderSentAt: null, dueAt: { $gte: now, $lte: soon } });
  for (const followUp of upcoming) {
    await notify({
      user: followUp.assignedTo, type: 'followup_due', title: 'Follow-up due soon',
      body: `${followUp.leadName}: ${followUp.title}`, module: 'followups', recordId: followUp.id,
      dedupeKey: `due:${followUp.id}`,
    });
    followUp.reminderSentAt = now;
    await followUp.save();
  }
  const overdue = await FollowUp.find({ status: 'pending', dueAt: { $lt: now } });
  for (const followUp of overdue) {
    followUp.status = 'missed';
    followUp.missedMarkedAt = now;
    await followUp.save();
    await addActivity({
      lead: followUp.lead, type: 'followup_missed', actor: null,
      description: `Missed follow-up: ${followUp.title}`,
    });
    await notify({
      user: followUp.assignedTo, type: 'followup_missed', title: 'Follow-up missed',
      body: `${followUp.leadName}: ${followUp.title}`, module: 'followups', recordId: followUp.id,
      dedupeKey: `missed:${followUp.id}`,
    });
  }
  return { reminders: upcoming.length, missed: overdue.length };
}

function hourLabel(date, timeZone) {
  const parts = zonedParts(date, timeZone);
  return parts.hour;
}

module.exports = {
  list, create, update, complete, summary, calendar, popups, remindLater, reassignFromStaff, processReminders, hourLabel,
};
