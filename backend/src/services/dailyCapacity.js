const { Lead } = require('../models');
const { dateKeyFromDate, dayBounds } = require('../utils/time');
const { BDA_WORKING_TARGET, DAILY_ASSIGN_SHARES } = require('../config/constants');

const DAILY_CALL_TARGET = Number(DAILY_ASSIGN_SHARES.dailyTarget)
  || Number(BDA_WORKING_TARGET?.metrics?.find((row) => row.key === 'dialAttempts')?.daily)
  || 120;

/**
 * Auto-assign ceiling per staff for the day (manual may exceed 120).
 *
 * Example: target 120, sheet today 20, carry-over fresh 30
 * → remaining 70 for RNP / UTC / bulk shuffle only.
 *
 * carryFresh = assigned fresh with assignmentDate before today
 * (today’s sheet leads are counted via sheetToday, not again here)
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
  const { start } = dayBounds(key, timeZone);
  const rows = await Lead.aggregate([
    {
      $match: {
        deletedAt: null,
        status: 'fresh',
        assignedTo: { $in: staffIds },
        assignmentDate: { $ne: null, $lt: start },
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
  todaySheetAssignCounts,
  carryFreshCounts,
  remainingAutoSlots,
  shareQuota,
  autoCapacityByStaff,
};
