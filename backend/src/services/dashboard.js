const { Lead, User, FollowUp, CallLog, Payment, RevenueOpportunity } = require('../models');
const { leadScope, recordScope, isElevated } = require('./access');
const { summarizeCalls } = require('./calls');
const { getGeneral } = require('./settings');
const { viewRange } = require('../utils/time');
const { summarizeMoney } = require('../utils/revenue');
const { POSITIVE_STATUSES, WON_STATUSES, CONNECTED_LEAD_STATUSES } = require('../config/constants');
const { leaderboard } = require('./leaderboard');

function leadFilter(user, range) {
  return { deletedAt: null, ...leadScope(user), createdAt: { $gte: range.start, $lt: range.end } };
}

async function counts(user, range) {
  const filter = leadFilter(user, range);
  const callMatch = { ...recordScope(user, { staff: 'staff' }), startedAt: { $gte: range.start, $lt: range.end } };
  const now = new Date();
  const followMatch = {
    ...recordScope(user, { staff: 'assignedTo' }),
    status: { $in: ['pending', 'missed'] },
    dueAt: { $gte: range.start, $lt: range.end < now ? range.end : now },
  };
  const [leadRows, callToday, followOverdue, staffActive, staffTotal, opportunities, payments] = await Promise.all([
    Lead.aggregate([
      { $match: filter },
      { $group: {
        _id: null,
        total: { $sum: 1 },
        fresh: { $sum: { $cond: [{ $in: ['$status', ['fresh', 'not_contacted']] }, 1, 0] } },
        assigned: { $sum: { $cond: [{ $ifNull: ['$assignedTo', false] }, 1, 0] } },
        connected: { $sum: { $cond: [{ $in: ['$status', CONNECTED_LEAD_STATUSES] }, 1, 0] } },
        positive: { $sum: { $cond: [{ $in: ['$status', POSITIVE_STATUSES] }, 1, 0] } },
        won: { $sum: { $cond: [{ $in: ['$status', WON_STATUSES] }, 1, 0] } },
        leadExpected: { $sum: '$expectedRevenue' },
      } },
    ]),
    summarizeCalls(callMatch),
    range.start >= now ? 0 : FollowUp.countDocuments(followMatch),
    User.countDocuments({ deletedAt: null, isActive: true, ...(isElevated(user) ? {} : { branch: user.branch }) }),
    User.countDocuments({ deletedAt: null, ...(isElevated(user) ? {} : { branch: user.branch }) }),
    RevenueOpportunity.find({ deletedAt: null, ...recordScope(user, { staff: 'staff' }), createdAt: { $gte: range.start, $lt: range.end } }).lean(),
    Payment.find({ ...recordScope(user, { staff: 'staff' }), paidAt: { $gte: range.start, $lt: range.end } }).lean(),
  ]);
  const leads = leadRows[0] || { total: 0, fresh: 0, assigned: 0, connected: 0, positive: 0, won: 0, leadExpected: 0 };
  const money = summarizeMoney(opportunities, payments);
  const conversion = leads.total ? Math.round((leads.won / leads.total) * 1000) / 10 : 0;
  return { leads, callToday, followOverdue, staffActive, staffTotal, money, conversion };
}

async function sourcePerformance(user, range) {
  return Lead.aggregate([
    { $match: leadFilter(user, range) },
    { $group: {
      _id: '$source',
      leads: { $sum: 1 },
      won: { $sum: { $cond: [{ $in: ['$status', WON_STATUSES] }, 1, 0] } },
      expected: { $sum: '$expectedRevenue' },
    } },
    { $sort: { leads: -1 } },
  ]);
}

async function statusBreakdown(user, range) {
  return Lead.aggregate([
    { $match: leadFilter(user, range) },
    { $group: { _id: '$status', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
}

async function teamPerformance(user, range) {
  const match = leadFilter(user, range);
  return Lead.aggregate([
    { $match: match },
    { $group: {
      _id: '$team',
      leads: { $sum: 1 },
      positive: { $sum: { $cond: [{ $in: ['$status', POSITIVE_STATUSES] }, 1, 0] } },
      won: { $sum: { $cond: [{ $in: ['$status', WON_STATUSES] }, 1, 0] } },
    } },
  ]);
}

async function build(user, query = {}) {
  const general = await getGeneral();
  const range = viewRange(query, general.timezone);
  const snapshot = await counts(user, range);
  const boardPeriod = range.preset === 'week' ? 'weekly' : range.preset === 'month' ? 'monthly' : 'daily';
  const [sources, statuses, teams, board] = await Promise.all([
    sourcePerformance(user, range),
    statusBreakdown(user, range),
    teamPerformance(user, range),
    leaderboard(user, { period: boardPeriod, limit: 5, rangeStart: range.start.toISOString(), rangeEnd: range.end.toISOString() }).catch(() => ({ data: [] })),
  ]);
  const cards = cardsFor(user.role, snapshot, range);
  return {
    data: {
      role: user.role,
      period: { preset: range.preset, label: range.label, date: range.from || null, from: range.from, to: range.to, start: range.start, end: range.end },
      cards,
      calls: snapshot.callToday,
      money: snapshot.money,
      conversion: snapshot.conversion,
      overdueFollowUps: snapshot.followOverdue,
      charts: {
        statuses: statuses.map((row) => ({ name: row._id, value: row.count })),
        sources: sources.map((row) => ({ name: row._id || 'Unknown', leads: row.leads, won: row.won })),
        callsBySource: Object.entries(snapshot.callToday.bySource || {}).map(([name, value]) => ({ name, calls: value.calls })),
      },
      tables: {
        topPerformers: board.data || [],
        sourcePerformance: sources,
        teamPerformance: teams,
      },
      note: `${range.label} is read from the database. Call totals include every stored source. Only Android sync rows are device-verified.`,
    },
  };
}

function cardsFor(role, snapshot, range) {
  const { leads, callToday, money, staffActive, staffTotal, followOverdue, conversion } = snapshot;
  const when = range.label.toLowerCase();
  const common = [
    { key: 'leads', label: `Leads created ${when}`, value: leads.total },
    { key: 'fresh', label: 'Fresh leads', value: leads.fresh },
    { key: 'positive', label: 'Positive leads', value: leads.positive },
    { key: 'calls', label: `Calls ${when}`, value: callToday.total, hint: 'All sources' },
    { key: 'connected', label: `Connected ${when}`, value: callToday.connected },
    { key: 'talk', label: `Talk time ${when}`, value: callToday.totalDuration, format: 'duration' },
    { key: 'overdue', label: `Overdue follow-ups ${when}`, value: followOverdue },
  ];
  if (role === 'STAFF') {
    return [
      ...common,
      { key: 'unique', label: `Unique numbers ${when}`, value: callToday.uniqueNumbers },
      { key: 'expected', label: 'Expected pipeline', value: money.expectedPipeline, format: 'currency' },
      { key: 'collected', label: `Collected ${when}`, value: money.collected, format: 'currency' },
      { key: 'conversion', label: 'Conversion', value: conversion, format: 'percent' },
    ];
  }
  if (role === 'TEAM_LEADER' || role === 'ADMIN') {
    return [
      ...common,
      { key: 'assigned', label: 'Assigned leads', value: leads.assigned },
      { key: 'staff', label: 'Active staff', value: staffActive, hint: 'Current team' },
      { key: 'pipeline', label: 'Weighted pipeline', value: money.weightedPipeline, format: 'currency' },
      { key: 'collected', label: `Collected ${when}`, value: money.collected, format: 'currency' },
      { key: 'pending', label: 'Pending collection', value: money.pendingCollection, format: 'currency' },
      { key: 'conversion', label: 'Conversion', value: conversion, format: 'percent' },
    ];
  }
  return [
    { key: 'leads', label: `Leads created ${when}`, value: leads.total },
    { key: 'fresh', label: 'Fresh leads', value: leads.fresh },
    { key: 'assigned', label: 'Assigned leads', value: leads.assigned },
    { key: 'connectedLeads', label: 'Connected leads', value: leads.connected },
    { key: 'positive', label: 'Positive leads', value: leads.positive },
    { key: 'staff', label: 'Active staff', value: staffActive, hint: `${staffTotal} total` },
    { key: 'calls', label: `Calls ${when}`, value: callToday.total },
    { key: 'connected', label: `Connected ${when}`, value: callToday.connected },
    { key: 'talk', label: `Talk time ${when}`, value: callToday.totalDuration, format: 'duration' },
    { key: 'expected', label: 'Expected pipeline', value: money.expectedPipeline, format: 'currency' },
    { key: 'weighted', label: 'Weighted pipeline', value: money.weightedPipeline, format: 'currency' },
    { key: 'confirmed', label: 'Confirmed revenue', value: money.confirmed, format: 'currency' },
    { key: 'collected', label: `Collected ${when}`, value: money.collected, format: 'currency' },
    { key: 'pending', label: 'Pending collection', value: money.pendingCollection, format: 'currency' },
    { key: 'overdue', label: `Overdue follow-ups ${when}`, value: followOverdue },
    { key: 'conversion', label: 'Lead conversion', value: conversion, format: 'percent' },
  ];
}

module.exports = { build };
