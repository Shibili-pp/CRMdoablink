const { Lead } = require('../models');
const { dateKeyFromDate, dayBounds } = require('../utils/time');
const { BDA_WORKING_TARGET, DAILY_ASSIGN_SHARES } = require('../config/constants');

const DAILY_CALL_TARGET = Number(DAILY_ASSIGN_SHARES.dailyTarget)
  || Number(BDA_WORKING_TARGET?.metrics?.find((row) => row.key === 'dialAttempts')?.daily)
  || 120;

/** Still with staff for dialing until hold ends → bucket. Same set as Calls Today. */
const CALLS_TODAY_HOLD_STATUSES = ['fresh', 'not_contacted', 'rnp', 'utc'];

/**
 * Auto-assign ceiling per staff for the day (manual may exceed 120).
 *
 * Example: target 120, hold leads on Calls Today 40, sheet today 20
 * → remaining 60 from bucket (RNP / UTC / bulk mix).
 *
 * holdCarry = assigned fresh / not_contacted / RNP / UTC that are NOT today’s sheet assigns
 * (sheet today is counted separately so we don’t double-count)
 */
async function todaySheetAssignCounts(staffIds, timeZone, now = new Date()) {
  const map = new Map((staffIds || []).map((id) => [String(id), 0]));
  if (!staffIds?.length) return map;
  const key = dateKeyFromDate(now, timeZone);
  const { start, end } = dayBounds(key, timeZone);
  const rows = await Lead.aggregate([
    {
      $match: {
        deletedAt: null,
        fromSheet: true,
        assignedTo: { $in: staffIds },
        assignmentDate: { $gte: start, $lt: end },
      },
    },
    { $group: { _id: '$assignedTo', count: { $sum: 1 } } },
  ]);
  rows.forEach((row) => map.set(String(row._id), row.count || 0));
  return map;
}

async function carryFreshCounts(staffIds, timeZone, now = new Date()) {
  const map = new Map((staffIds || []).map((id) => [String(id), 0]));
  if (!staffIds?.length) return map;
  const key = dateKeyFromDate(now, timeZone);
  const { start, end } = dayBounds(key, timeZone);
  const rows = await Lead.aggregate([
    {
      $match: {
        deletedAt: null,
        status: { $in: CALLS_TODAY_HOLD_STATUSES },
        assignedTo: { $in: staffIds },
        // Exclude today’s sheet assigns — those are counted via sheetToday.
        $nor: [{
          fromSheet: true,
          assignmentDate: { $gte: start, $lt: end },
        }],
      },
    },
    { $group: { _id: '$assignedTo', count: { $sum: 1 } } },
  ]);
  rows.forEach((row) => map.set(String(row._id), row.count || 0));
  return map;
}

function remainingAutoSlots(sheetCount, carryFreshCount, dailyTarget = DAILY_CALL_TARGET) {
  return Math.max(
    0,
    Number(dailyTarget || DAILY_CALL_TARGET) - Number(sheetCount || 0) - Number(carryFreshCount || 0),
  );
}

function shareQuota(remaining, share, already = 0) {
  const cap = Math.floor(Math.max(0, remaining) * Number(share || 0));
  return Math.max(0, cap - Number(already || 0));
}

async function autoCapacityByStaff(staffIds, timeZone, now = new Date()) {
  const [sheet, carryFresh] = await Promise.all([
    todaySheetAssignCounts(staffIds, timeZone, now),
    carryFreshCounts(staffIds, timeZone, now),
  ]);
  const remaining = new Map();
  (staffIds || []).forEach((id) => {
    const sid = String(id);
    remaining.set(sid, remainingAutoSlots(sheet.get(sid) || 0, carryFresh.get(sid) || 0));
  });
  return { sheet, carryFresh, remaining, dailyTarget: DAILY_CALL_TARGET };
}

module.exports = {
  DAILY_CALL_TARGET,
  CALLS_TODAY_HOLD_STATUSES,
  todaySheetAssignCounts,
  carryFreshCounts,
  remainingAutoSlots,
  shareQuota,
  autoCapacityByStaff,
};
