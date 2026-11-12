const { User, CallLog, FollowUp, Lead, Payment, LeadActivity, Target } = require('../models');
const { periodRange } = require('../utils/time');
const { getGeneral, getWeights } = require('./settings');
const { leaderboardScore } = require('../utils/score');
const { POSITIVE_STATUSES, WON_STATUSES } = require('../config/constants');
const { isElevated } = require('./access');
const { withProgress } = require('./targets');

async function leaderboard(user, query) {
  const general = await getGeneral();
  const period = query.period || 'monthly';
  const range = query.rangeStart && query.rangeEnd
    ? { start: new Date(query.rangeStart), end: new Date(query.rangeEnd) }
    : periodRange(period === 'daily' ? 'day' : period === 'weekly' ? 'week' : 'month', general.timezone);
  const staffFilter = { deletedAt: null, isActive: true, role: query.includeLeaders === '1' ? { $in: ['STAFF', 'TEAM_LEADER'] } : 'STAFF' };
  if (!isElevated(user)) staffFilter.branch = user.branch;
  if (user.role === 'TEAM_LEADER') staffFilter.team = user.team;
  if (query.team && isElevated(user)) staffFilter.team = query.team;
  const people = await User.find(staffFilter).select('name team branch').populate('team', 'name').lean();
  const weights = await getWeights();
  const rows = [];
  for (const person of people) {
    const [calls, followups, leads, won, positive, demos, payments, targets] = await Promise.all([
      CallLog.aggregate([
        { $match: { staff: person._id, startedAt: { $gte: range.start, $lt: range.end } } },
        { $group: {
          _id: null,
          total: { $sum: 1 },
          connected: { $sum: { $cond: [{ $eq: ['$status', 'connected'] }, 1, 0] } },
          duration: { $sum: '$durationSeconds' },
        } },
      ]),
      FollowUp.aggregate([
        { $match: { assignedTo: person._id, status: 'completed', completedAt: { $gte: range.start, $lt: range.end } } },
        { $group: {
          _id: null,
          total: { $sum: 1 },
          onTime: { $sum: { $cond: ['$completedOnTime', 1, 0] } },
        } },
      ]),
      Lead.countDocuments({ deletedAt: null, assignedTo: person._id }),
      Lead.countDocuments({ deletedAt: null, assignedTo: person._id, status: { $in: WON_STATUSES }, statusChangedAt: { $gte: range.start, $lt: range.end } }),
      Lead.countDocuments({ deletedAt: null, assignedTo: person._id, status: { $in: POSITIVE_STATUSES } }),
      LeadActivity.countDocuments({ actor: person._id, type: 'demo_completed', at: { $gte: range.start, $lt: range.end } }),
      Payment.aggregate([
        { $match: { staff: person._id, paidAt: { $gte: range.start, $lt: range.end } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Target.find({ isActive: true, staff: person._id }),
    ]);
    let targetAchievement = 0;
    if (targets.length) {
      const progresses = [];
      for (const target of targets) {
        const progress = await withProgress(target);
        progresses.push(progress.progress.percentage);
      }
      targetAchievement = progresses.reduce((sum, value) => sum + value, 0) / progresses.length;
    }
    const follow = followups[0] || { total: 0, onTime: 0 };
    const call = calls[0] || { total: 0, connected: 0, duration: 0 };
    const metrics = {
      revenueCollected: payments[0]?.total || 0,
      successfulSales: won,
      conversionRate: leads ? (won / leads) * 100 : 0,
      positiveLeads: positive,
      demosCompleted: demos,
      connectedCalls: call.connected,
      talkTimeSeconds: call.duration,
      totalCalls: call.total,
      followUpRate: follow.total ? (follow.onTime / follow.total) * 100 : 0,
      targetAchievement,
    };
    rows.push({
      staffId: person._id,
      name: person.name,
      team: person.team?.name || '',
      metrics,
      score: leaderboardScore(metrics, weights),
    });
  }
  rows.sort((a, b) => b.score - a.score);
  const limit = Math.min(50, Number(query.limit) || 20);
  return {
    data: rows.slice(0, limit).map((row, index) => ({ rank: index + 1, ...row })),
    meta: {
      period,
      weights,
      note: 'Calling performance uses connected calls and talk time. Raw call volume is not the ranking driver.',
    },
  };
}

async function teamBoard(user, query) {
  const individual = await leaderboard(user, { ...query, limit: 100, includeLeaders: '1' });
  const groups = new Map();
  individual.data.forEach((row) => {
    const key = row.team || 'Unassigned';
    const current = groups.get(key) || { team: key, score: 0, revenueCollected: 0, successfulSales: 0, members: 0 };
    current.score += row.score;
    current.revenueCollected += row.metrics.revenueCollected;
    current.successfulSales += row.metrics.successfulSales;
    current.members += 1;
    groups.set(key, current);
  });
  const data = [...groups.values()].sort((a, b) => b.score - a.score).map((row, index) => ({ rank: index + 1, ...row }));
  return { data, meta: individual.meta };
}

module.exports = { leaderboard, teamBoard };
