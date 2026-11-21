const { Lead, User, LeadAssignment, FollowUp, RevenueOpportunity, SystemSetting } = require('../models');
const { getGeneral } = require('./settings');
const { staffOnLeave } = require('./org');
const { addActivity } = require('./activity');
const { notify } = require('./notify');
const { zonedParts, dateKeyFromDate, dayBounds } = require('../utils/time');
const { BDA_WORKING_TARGET, DAILY_ASSIGN_SHARES } = require('../config/constants');

const DAILY_CALL_TARGET = Number(DAILY_ASSIGN_SHARES.dailyTarget)
  || Number(BDA_WORKING_TARGET?.metrics?.find((row) => row.key === 'dialAttempts')?.daily)
  || 120;
const BULK_SHARE = Number(DAILY_ASSIGN_SHARES.bulkUnassigned) || 0.4;
const RESERVED_SHARE = Number(DAILY_ASSIGN_SHARES.reservedManual ?? DAILY_ASSIGN_SHARES.reserved) || 0.15;

function clockToMinutes(value) {
  const match = String(value || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return (Number(match[1]) * 60) + Number(match[2]);
}

function isWithinWorkHours(person, now, timeZone) {
  const start = clockToMinutes(person.workStart || '11:00');
  const end = clockToMinutes(person.workEnd || '20:00');
  if (start == null || end == null || start >= end) return false;
  const parts = zonedParts(now, timeZone);
  const nowMinutes = (parts.hour * 60) + parts.minute;
  return nowMinutes >= start && nowMinutes < end;
}

async function todayAssignCounts(staffIds, leadRole, timeZone, now) {
  const key = dateKeyFromDate(now, timeZone);
  const { start, end } = dayBounds(key, timeZone);
  const match = {
    deletedAt: null,
    fromSheet: true,
    leadRole,
    assignedTo: { $in: staffIds },
    assignmentDate: { $gte: start, $lt: end },
  };
  const rows = await Lead.aggregate([
    { $match: match },
    { $group: { _id: '$assignedTo', count: { $sum: 1 } } },
  ]);
  const map = new Map(staffIds.map((id) => [String(id), 0]));
  rows.forEach((row) => map.set(String(row._id), row.count || 0));
  return map;
}

async function todaySheetCountsAll(staffIds, timeZone, now) {
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
  const map = new Map(staffIds.map((id) => [String(id), 0]));
  rows.forEach((row) => map.set(String(row._id), row.count || 0));
  return map;
}

async function todayBulkAssignCounts(staffIds, timeZone, now) {
  const key = dateKeyFromDate(now, timeZone);
  const { start, end } = dayBounds(key, timeZone);
  const rows = await LeadAssignment.aggregate([
    {
      $match: {
        toStaff: { $in: staffIds },
        mode: 'round_robin',
        reason: { $regex: /bulk bucket/i },
        createdAt: { $gte: start, $lt: end },
      },
    },
    { $group: { _id: '$toStaff', count: { $sum: 1 } } },
  ]);
  const map = new Map(staffIds.map((id) => [String(id), 0]));
  rows.forEach((row) => map.set(String(row._id), row.count || 0));
  return map;
}

function bulkQuotaForStaff(sheetCount, alreadyBulk) {
  const remaining = Math.max(0, DAILY_CALL_TARGET - Number(sheetCount || 0));
  const cap = Math.floor(remaining * BULK_SHARE);
  return Math.max(0, cap - Number(alreadyBulk || 0));
}

async function openLeadCounts(staffIds) {
  const rows = await Lead.aggregate([
    { $match: { deletedAt: null, assignedTo: { $in: staffIds } } },
    { $group: { _id: '$assignedTo', open: { $sum: 1 } } },
  ]);
  const map = new Map(staffIds.map((id) => [String(id), 0]));
  rows.forEach((row) => map.set(String(row._id), row.open || 0));
  return map;
}

async function getCursor(leadRole) {
  const doc = await SystemSetting.findOne({ key: 'autoAssignCursor' }).lean();
  const value = doc?.value || {};
  return Number(value[leadRole] || 0) || 0;
}

async function setCursor(leadRole, index) {
  const doc = await SystemSetting.findOne({ key: 'autoAssignCursor' });
  const value = { ...(doc?.value || {}) };
  value[leadRole] = index;
  await SystemSetting.updateOne(
    { key: 'autoAssignCursor' },
    { key: 'autoAssignCursor', value },
    { upsert: true },
  );
}

function pickStaff(eligible, todayCounts, openCounts, cursor) {
  if (!eligible.length) return null;
  const ordered = eligible
    .map((person, index) => ({
      person,
      index,
      today: todayCounts.get(String(person._id)) || 0,
      open: openCounts.get(String(person._id)) || 0,
      capacity: person.maxLeadAllocation || 50,
      rotate: (index - (cursor % eligible.length) + eligible.length) % eligible.length,
    }))
    .filter((row) => row.open < row.capacity)
    .sort((a, b) => {
      if (a.today !== b.today) return a.today - b.today;
      if (a.rotate !== b.rotate) return a.rotate - b.rotate;
      return String(a.person._id).localeCompare(String(b.person._id));
    });
  return ordered[0] || null;
}

async function assignSheetLeadToStaff(lead, staff, reason) {
  const filter = { _id: lead._id, deletedAt: null, assignedTo: null };
  const updated = await Lead.findOneAndUpdate(filter, {
    $set: {
      assignedTo: staff._id,
      team: staff.team || null,
      branch: staff.branch || lead.branch || null,
      assignmentDate: new Date(),
      bucketStatus: 'assigned',
      status: 'fresh',
      statusChangedAt: new Date(),
    },
  }, { new: true });
  if (!updated) return { ok: false, conflict: true };

  await LeadAssignment.create({
    lead: lead._id,
    fromStaff: null,
    toStaff: staff._id,
    fromTeam: null,
    toTeam: staff.team || null,
    assignedBy: null,
    reason: reason || 'Auto-assigned from Google Sheet bucket',
    mode: 'round_robin',
  });

  await FollowUp.updateMany(
    { lead: updated._id, status: { $in: ['pending', 'missed'] } },
    { $set: { assignedTo: staff._id, team: staff.team || null, branch: staff.branch || updated.branch } },
  );
  await RevenueOpportunity.updateMany(
    { lead: updated._id, deletedAt: null, status: 'open' },
    { $set: { staff: staff._id, team: staff.team || null, branch: staff.branch || updated.branch } },
  );

  await addActivity({
    lead: updated,
    type: 'lead_assigned',
    actor: null,
    description: `Auto-assigned to ${staff.name} (managing client match · fair share)`,
    oldValue: null,
    newValue: staff._id,
    metadata: { mode: 'round_robin', reason: 'auto_sheet' },
  });

  await notify({
    user: staff._id,
    type: 'lead_assigned',
    title: 'New lead assigned',
    body: `${updated.name} (${updated.leadCode})`,
    module: 'leads',
    recordId: updated.id,
    dedupeKey: `auto-assign:${updated.id}:${staff.id}`,
  });

  return { ok: true, lead: updated, staff };
}

async function autoAssignSheetLeads(options = {}) {
  const general = await getGeneral();
  const timeZone = general.timezone || 'Asia/Kolkata';
  const now = new Date();
  const onLeave = await staffOnLeave(now);

  let presentSet = null;
  if (options.requireAllow) {
    const allow = await require('./assignAllow').getTodayAllow(timeZone);
    if (!allow.allowed || !allow.presentStaffIds?.length) {
      return { assigned: 0, skipped: 0, byClient: {}, blocked: true, reason: 'awaiting_allow' };
    }
    presentSet = new Set(allow.presentStaffIds.map(String));
  } else if (Array.isArray(options.presentStaffIds)) {
    presentSet = new Set(options.presentStaffIds.map(String));
    if (!presentSet.size) return { assigned: 0, skipped: 0, byClient: {}, blocked: true, reason: 'no_present_staff' };
  }

  const leads = await Lead.find({
    deletedAt: null,
    assignedTo: null,
    fromSheet: true,
    leadRole: { $nin: [null, ''] },
  }).sort({ createdAt: 1 }).limit(300).lean();

  if (!leads.length) {
    return { assigned: 0, skipped: 0, byClient: {} };
  }

  const staff = await User.find({
    deletedAt: null,
    isActive: true,
    role: { $in: ['STAFF', 'TEAM_LEADER'] },
    managingClients: { $exists: true, $ne: [] },
  }).select('name role team branch maxLeadAllocation workStart workEnd managingClients employmentStatus').lean();

  const working = staff.filter((person) => (
    !onLeave.has(String(person._id))
    && person.employmentStatus !== 'on_leave'
    && (options.ignoreWorkHours || isWithinWorkHours(person, now, timeZone))
    && Array.isArray(person.managingClients)
    && person.managingClients.length
    && (!presentSet || presentSet.has(String(person._id)))
  ));

  const byClient = {};
  let assigned = 0;
  let skipped = 0;

  const groups = new Map();
  leads.forEach((lead) => {
    const key = lead.leadRole;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(lead);
  });

  for (const [leadRole, group] of groups.entries()) {
    const eligible = working
      .filter((person) => person.managingClients.includes(leadRole))
      .sort((a, b) => String(a._id).localeCompare(String(b._id)));

    byClient[leadRole] = { leads: group.length, staff: eligible.length, assigned: 0 };

    if (!eligible.length) {
      skipped += group.length;
      continue;
    }

    const staffIds = eligible.map((person) => person._id);
    const todayCounts = await todayAssignCounts(staffIds, leadRole, timeZone, now);
    const openCounts = await openLeadCounts(staffIds);
    let cursor = await getCursor(leadRole);

    for (const lead of group) {
      const pick = pickStaff(eligible, todayCounts, openCounts, cursor);
      if (!pick) {
        skipped += 1;
        continue;
      }
      const result = await assignSheetLeadToStaff(
        lead,
        pick.person,
        `Auto-assigned · ${leadRole} · fair share from sheet bucket`,
      );
      if (!result.ok) {
        skipped += 1;
        continue;
      }
      assigned += 1;
      byClient[leadRole].assigned += 1;
      const sid = String(pick.person._id);
      todayCounts.set(sid, (todayCounts.get(sid) || 0) + 1);
      openCounts.set(sid, (openCounts.get(sid) || 0) + 1);
      cursor = (eligible.findIndex((person) => String(person._id) === sid) + 1) % eligible.length;
    }

    await setCursor(leadRole, cursor);
  }

  return { assigned, skipped, byClient, at: now.toISOString() };
}

/**
 * Daily mix (after sheet): 30% RNP + 40% Unassigned bulk + 30% reserved (later).
 * This step fills Unassigned bulk up to 40% of (120 − today’s sheet assigns).
 * If the bucket has fewer leads, share equally (still capped at 40%).
 */
async function autoAssignBulkLeads(options = {}) {
  const general = await getGeneral();
  const timeZone = general.timezone || 'Asia/Kolkata';
  const now = new Date();
  const onLeave = await staffOnLeave(now);
  const presentSet = Array.isArray(options.presentStaffIds)
    ? new Set(options.presentStaffIds.map(String))
    : null;

  const leads = await Lead.find({
    deletedAt: null,
    assignedTo: null,
    fromSheet: { $ne: true },
    status: { $nin: ['rnp', 'utc'] },
    leadRole: { $nin: [null, ''] },
  }).sort({ priorityRank: -1, createdAt: 1 }).limit(500).lean();

  if (!leads.length) {
    return { assigned: 0, skipped: 0, byClient: {}, share: BULK_SHARE, dailyTarget: DAILY_CALL_TARGET };
  }

  const staff = await User.find({
    deletedAt: null,
    isActive: true,
    role: { $in: ['STAFF', 'TEAM_LEADER'] },
    managingClients: { $exists: true, $ne: [] },
  }).select('name role team branch maxLeadAllocation workStart workEnd managingClients employmentStatus').lean();

  const working = staff.filter((person) => (
    !onLeave.has(String(person._id))
    && person.employmentStatus !== 'on_leave'
    && (options.ignoreWorkHours || isWithinWorkHours(person, now, timeZone))
    && Array.isArray(person.managingClients)
    && person.managingClients.length
    && (!presentSet || presentSet.has(String(person._id)))
  ));

  if (!working.length) {
    return { assigned: 0, skipped: leads.length, byClient: {}, share: BULK_SHARE, dailyTarget: DAILY_CALL_TARGET };
  }

  const allIds = working.map((person) => person._id);
  const sheetCounts = await todaySheetCountsAll(allIds, timeZone, now);
  const bulkCounts = await todayBulkAssignCounts(allIds, timeZone, now);
  const openCounts = await openLeadCounts(allIds);

  let assigned = 0;
  let skipped = 0;
  const byClient = {};
  const groups = new Map();
  leads.forEach((lead) => {
    if (!groups.has(lead.leadRole)) groups.set(lead.leadRole, []);
    groups.get(lead.leadRole).push(lead);
  });

  for (const [leadRole, group] of groups.entries()) {
    const eligible = working
      .filter((person) => person.managingClients.includes(leadRole))
      .sort((a, b) => String(a._id).localeCompare(String(b._id)));

    byClient[leadRole] = { leads: group.length, staff: eligible.length, assigned: 0 };

    if (!eligible.length) {
      skipped += group.length;
      continue;
    }

    const quotas = new Map();
    eligible.forEach((person) => {
      const sid = String(person._id);
      const open = openCounts.get(sid) || 0;
      const capacity = person.maxLeadAllocation || 50;
      const room = Math.max(0, capacity - open);
      const quota = Math.min(room, bulkQuotaForStaff(sheetCounts.get(sid) || 0, bulkCounts.get(sid) || 0));
      quotas.set(sid, quota);
    });

    const totalQuota = [...quotas.values()].reduce((sum, value) => sum + value, 0);
    if (totalQuota <= 0) {
      skipped += group.length;
      continue;
    }

    const pool = group.slice(0, Math.min(group.length, totalQuota));
    skipped += Math.max(0, group.length - pool.length);

    // Fair share: always give next lead to eligible staff with fewest bulk assigns today (and remaining quota).
    let cursor = await getCursor(`bulk:${leadRole}`);
    for (const lead of pool) {
      const ordered = eligible
        .map((person, index) => {
          const sid = String(person._id);
          return {
            person,
            sid,
            left: quotas.get(sid) || 0,
            got: bulkCounts.get(sid) || 0,
            rotate: (index - (cursor % eligible.length) + eligible.length) % eligible.length,
          };
        })
        .filter((row) => row.left > 0)
        .sort((a, b) => {
          if (a.got !== b.got) return a.got - b.got;
          if (a.rotate !== b.rotate) return a.rotate - b.rotate;
          return a.sid.localeCompare(b.sid);
        });
      const pick = ordered[0];
      if (!pick) {
        skipped += 1;
        continue;
      }
      const result = await assignSheetLeadToStaff(
        lead,
        pick.person,
        `Auto-assigned · ${leadRole} · bulk bucket · up to 40% of remaining daily target`,
      );
      if (!result.ok) {
        skipped += 1;
        continue;
      }
      assigned += 1;
      byClient[leadRole].assigned += 1;
      quotas.set(pick.sid, (quotas.get(pick.sid) || 0) - 1);
      bulkCounts.set(pick.sid, (bulkCounts.get(pick.sid) || 0) + 1);
      openCounts.set(pick.sid, (openCounts.get(pick.sid) || 0) + 1);
      cursor = (eligible.findIndex((person) => String(person._id) === pick.sid) + 1) % eligible.length;
    }
    await setCursor(`bulk:${leadRole}`, cursor);
  }

  return {
    assigned,
    skipped,
    byClient,
    share: BULK_SHARE,
    reservedShare: RESERVED_SHARE,
    dailyTarget: DAILY_CALL_TARGET,
    at: now.toISOString(),
  };
}

/** Sheet → RNP 30% → UTC 15% → Unassigned 40%. Remaining 15% = TL+ manual reassign only. */
async function runDailyAutoAssign(options = {}) {
  const sheet = await autoAssignSheetLeads(options);
  const rnpResult = await require('./rnp').autoAssignRnpLeads(options);
  const utcResult = await require('./utc').autoAssignUtcLeads(options);
  const bulk = await autoAssignBulkLeads(options);
  return {
    sheet,
    rnp: rnpResult,
    utc: utcResult,
    bulk,
    mix: {
      dailyTarget: DAILY_CALL_TARGET,
      rnpShare: DAILY_ASSIGN_SHARES.rnp,
      utcShare: DAILY_ASSIGN_SHARES.utc,
      bulkShare: BULK_SHARE,
      reservedManualShare: RESERVED_SHARE,
    },
    assigned: (sheet.assigned || 0) + (rnpResult.assigned || 0) + (utcResult.assigned || 0) + (bulk.assigned || 0),
  };
}

module.exports = {
  autoAssignSheetLeads,
  autoAssignBulkLeads,
  runDailyAutoAssign,
  isWithinWorkHours,
  DAILY_CALL_TARGET,
  BULK_SHARE,
  RESERVED_SHARE,
};
