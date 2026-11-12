const { CallLog, FollowUp, Lead, LeadActivity, Payment } = require('../models');
const { POSITIVE_STATUSES, WON_STATUSES } = require('../config/constants');

function assigneeMatch(target) {
  if (target.assigneeType === 'staff' || target.assigneeType === 'user') {
    return { staff: target.staff || target.user };
  }
  if (target.assigneeType === 'team') return { team: target.team };
  if (target.assigneeType === 'branch') return { branch: target.branch };
  return {};
}

function leadMatch(target) {
  if (target.assigneeType === 'staff' || target.assigneeType === 'user') {
    return { assignedTo: target.staff || target.user };
  }
  if (target.assigneeType === 'team') return { team: target.team };
  return { branch: target.branch };
}

async function measureTarget(target, range) {
  const callBase = { ...assigneeMatch(target), startedAt: { $gte: range.start, $lt: range.end } };
  const leadBase = { deletedAt: null, ...leadMatch(target) };
  if (target.type === 'daily_calls') return CallLog.countDocuments(callBase);
  if (target.type === 'daily_connected_calls') return CallLog.countDocuments({ ...callBase, status: 'connected' });
  if (target.type === 'daily_unique_calls') {
    const rows = await CallLog.aggregate([
      { $match: callBase },
      { $group: { _id: '$phoneNormalized' } },
      { $count: 'count' },
    ]);
    return rows[0]?.count || 0;
  }
  if (target.type === 'daily_followups') {
    return FollowUp.countDocuments({
      ...leadPerson(target, 'assignedTo'),
      status: 'completed',
      completedAt: { $gte: range.start, $lt: range.end },
    });
  }
  if (target.type === 'weekly_demos' || target.type === 'monthly_demos') {
    return LeadActivity.countDocuments({
      type: 'demo_completed',
      at: { $gte: range.start, $lt: range.end },
      lead: { $in: await Lead.find(leadBase).distinct('_id') },
    });
  }
  if (target.type === 'positive_leads') {
    return Lead.countDocuments({
      ...leadBase,
      status: { $in: POSITIVE_STATUSES },
      statusChangedAt: { $gte: range.start, $lt: range.end },
    });
  }
  if (target.type === 'subscription_sales') {
    return Lead.countDocuments({
      ...leadBase,
      status: { $in: WON_STATUSES },
      statusChangedAt: { $gte: range.start, $lt: range.end },
    });
  }
  if (target.type === 'revenue_collection') {
    const rows = await Payment.aggregate([
      { $match: { ...assigneeMatch(target), paidAt: { $gte: range.start, $lt: range.end } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    return rows[0]?.total || 0;
  }
  if (target.type === 'call_duration') {
    const rows = await CallLog.aggregate([
      { $match: { ...callBase, callType: 'outgoing' } },
      { $group: { _id: null, seconds: { $sum: '$durationSeconds' } } },
    ]);
    return Math.round((rows[0]?.seconds || 0) / 60);
  }
  if (target.type === 'prospective') return statusCount(target, range, 'positive');
  if (target.type === 'demo_booked') return statusCount(target, range, 'demo_booked');
  if (target.type === 'demo_completed') return statusCount(target, range, 'demo_completed');
  if (target.type === 'interested_to_buy') return statusCount(target, range, 'interested');
  if (target.type === 'conversion_rate') {
    const [total, won] = await Promise.all([
      Lead.countDocuments({ ...leadBase, createdAt: { $gte: range.start, $lt: range.end } }),
      Lead.countDocuments({ ...leadBase, status: { $in: WON_STATUSES }, statusChangedAt: { $gte: range.start, $lt: range.end } }),
    ]);
    if (!total) return 0;
    return Math.round((won / total) * 1000) / 10;
  }
  return 0;
}

async function statusCount(target, range, newValue) {
  const leadIds = await Lead.find({ deletedAt: null, ...leadMatch(target) }).distinct('_id');
  if (!leadIds.length) return 0;
  const rows = await LeadActivity.aggregate([
    { $match: { lead: { $in: leadIds }, at: { $gte: range.start, $lt: range.end }, type: 'status_changed', newValue } },
    { $group: { _id: '$lead' } },
    { $count: 'count' },
  ]);
  return rows[0]?.count || 0;
}

function leadPerson(target, field) {
  const match = leadMatch(target);
  if (match.assignedTo) return { [field]: match.assignedTo };
  return match;
}

module.exports = { measureTarget, assigneeMatch, leadMatch };
