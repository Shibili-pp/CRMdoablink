const { Lead, User, LeadAssignment, FollowUp, RevenueOpportunity } = require('../models');
const { getGeneral } = require('./settings');
const { staffOnLeave } = require('./org');
const { addActivity } = require('./activity');
const { notify } = require('./notify');
const { isWithinWorkHours } = require('./autoAssign');
const { zonedParts, dateKeyFromDate, dayBounds } = require('../utils/time');
const { BDA_WORKING_TARGET, DAILY_ASSIGN_SHARES } = require('../config/constants');

const UTC_SHARE = Number(DAILY_ASSIGN_SHARES.utc) || 0.15;
const DAILY_CALL_TARGET = Number(DAILY_ASSIGN_SHARES.dailyTarget)
  || Number(BDA_WORKING_TARGET?.metrics?.find((row) => row.key === 'dialAttempts')?.daily)
  || 120;
const BUCKET_CUTOFF = '20:00';

function clockToMinutes(value) {
  const match = String(value || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return (Number(match[1]) * 60) + Number(match[2]);
}

async function moveUtcToBucketAfterWork() {
  const general = await getGeneral();
  const timeZone = general.timezone || 'Asia/Kolkata';
  const now = new Date();
  const parts = zonedParts(now, timeZone);
  const nowMinutes = (parts.hour * 60) + parts.minute;
  const cutoff = clockToMinutes(BUCKET_CUTOFF);

  const leads = await Lead.find({
    deletedAt: null,
    status: 'utc',
    assignedTo: { $ne: null },
  }).limit(500);

  if (!leads.length) return { moved: 0 };

  const staffIds = [...new Set(leads.map((lead) => String(lead.assignedTo)))];
  const people = await User.find({ _id: { $in: staffIds } }).select('name workEnd').lean();
  const byId = new Map(people.map((person) => [String(person._id), person]));

  let moved = 0;
  for (const lead of leads) {
    const person = byId.get(String(lead.assignedTo));
    const end = clockToMinutes(person?.workEnd || BUCKET_CUTOFF);
    const pastStaffEnd = end != null && nowMinutes >= end;
    const pastCutoff = cutoff != null && nowMinutes >= cutoff;
    if (!pastStaffEnd && !pastCutoff) continue;

    const fromStaff = lead.assignedTo;
    lead.utcLastStaff = fromStaff;
    lead.assignedTo = null;
    lead.team = null;
    lead.bucketStatus = 'unassigned';
    lead.assignmentDate = null;
    await lead.save();

    await LeadAssignment.create({
      lead: lead._id,
      fromStaff,
      toStaff: null,
      assignedBy: null,
      reason: 'UTC returned to bucket after work hours',
      mode: 'manual',
    });
    await addActivity({
      lead,
      type: 'lead_reassigned',
      actor: null,
      description: 'UTC moved to bucket after work end',
      oldValue: fromStaff,
      newValue: null,
      metadata: { reason: 'utc_bucket' },
    });
    moved += 1;
  }

  return { moved };
}

async function todaySheetAssignCounts(staffIds, timeZone, now) {
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

async function todayUtcAssignCounts(staffIds, timeZone, now) {
  const key = dateKeyFromDate(now, timeZone);
  const { start, end } = dayBounds(key, timeZone);
  const rows = await LeadAssignment.aggregate([
    {
      $match: {
        toStaff: { $in: staffIds },
        mode: 'round_robin',
        reason: { $regex: /UTC rotate/i },
        createdAt: { $gte: start, $lt: end },
      },
    },
    { $group: { _id: '$toStaff', count: { $sum: 1 } } },
  ]);
  const map = new Map(staffIds.map((id) => [String(id), 0]));
  rows.forEach((row) => map.set(String(row._id), row.count || 0));
  return map;
}

function rotateTarget(eligible, lastStaffId) {
  if (!eligible.length) return null;
  if (!lastStaffId) return eligible[0];
  const index = eligible.findIndex((person) => String(person._id) === String(lastStaffId));
  if (index < 0) return eligible[0];
  return eligible[(index + 1) % eligible.length];
}

function utcQuotaForStaff(sheetCount, alreadyUtc) {
  const remaining = Math.max(0, DAILY_CALL_TARGET - Number(sheetCount || 0));
  const cap = Math.floor(remaining * UTC_SHARE);
  return Math.max(0, cap - Number(alreadyUtc || 0));
}

async function assignUtcLeadToStaff(lead, staff) {
  const filter = { _id: lead._id, deletedAt: null, assignedTo: null, status: 'utc' };
  const now = new Date();
  const updated = await Lead.findOneAndUpdate(filter, {
    $set: {
      assignedTo: staff._id,
      team: staff.team || null,
      branch: staff.branch || lead.branch || null,
      assignmentDate: now,
      bucketStatus: 'assigned',
      utcLastStaff: lead.utcLastStaff || lead.assignedTo || null,
      statusChangedAt: now,
    },
  }, { new: true });
  if (!updated) return { ok: false };

  await LeadAssignment.create({
    lead: lead._id,
    fromStaff: null,
    toStaff: staff._id,
    fromTeam: null,
    toTeam: staff.team || null,
    assignedBy: null,
    reason: 'UTC rotate from bucket · matching managing client · 15% of remaining daily target',
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
    description: `UTC rotated to ${staff.name}`,
    oldValue: null,
    newValue: staff._id,
    metadata: { mode: 'utc_rotate' },
  });
  await notify({
    user: staff._id,
    type: 'utc_assigned',
    title: 'UTC lead assigned',
    body: `${updated.name} (${updated.leadCode}) · call today`,
    module: 'leads',
    recordId: updated.id,
    dedupeKey: `utc-assign:${updated.id}:${staff.id}:${dateKeyFromDate(now, 'Asia/Kolkata')}`,
  });
  return { ok: true, lead: updated, staff };
}

/** Next work start: rotate bucket UTC to next matching staff, up to 15% of (120 − today’s sheet assigns). */
async function autoAssignUtcLeads(options = {}) {
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
    status: 'utc',
    leadRole: { $nin: [null, ''] },
  }).sort({ statusChangedAt: 1, createdAt: 1 }).limit(400).lean();

  if (!leads.length) return { assigned: 0, skipped: 0 };

  const staff = await User.find({
    deletedAt: null,
    isActive: true,
    role: { $in: ['STAFF', 'TEAM_LEADER'] },
    managingClients: { $exists: true, $ne: [] },
  }).select('name role team branch workStart workEnd managingClients employmentStatus').lean();

  const working = staff.filter((person) => (
    !onLeave.has(String(person._id))
    && person.employmentStatus !== 'on_leave'
    && (options.ignoreWorkHours || isWithinWorkHours(person, now, timeZone))
    && Array.isArray(person.managingClients)
    && person.managingClients.length
    && (!presentSet || presentSet.has(String(person._id)))
  ));

  if (!working.length) return { assigned: 0, skipped: leads.length };

  const staffIds = working.map((person) => person._id);
  const sheetCounts = await todaySheetAssignCounts(staffIds, timeZone, now);
  const utcCounts = await todayUtcAssignCounts(staffIds, timeZone, now);

  let assigned = 0;
  let skipped = 0;
  const groups = new Map();
  leads.forEach((lead) => {
    if (!groups.has(lead.leadRole)) groups.set(lead.leadRole, []);
    groups.get(lead.leadRole).push(lead);
  });

  for (const [leadRole, group] of groups.entries()) {
    const eligible = working
      .filter((person) => person.managingClients.includes(leadRole))
      .sort((a, b) => String(a._id).localeCompare(String(b._id)));
    if (!eligible.length) {
      skipped += group.length;
      continue;
    }

    for (const lead of group) {
      const target = rotateTarget(eligible, lead.utcLastStaff);
      if (!target) {
        skipped += 1;
        continue;
      }
      const sid = String(target._id);
      const quota = utcQuotaForStaff(sheetCounts.get(sid) || 0, utcCounts.get(sid) || 0);
      let picked = quota > 0 ? target : null;
      if (!picked) {
        const startAt = Math.max(0, eligible.findIndex((person) => String(person._id) === sid));
        for (let step = 1; step < eligible.length; step += 1) {
          const candidate = eligible[(startAt + step) % eligible.length];
          const cid = String(candidate._id);
          if (utcQuotaForStaff(sheetCounts.get(cid) || 0, utcCounts.get(cid) || 0) > 0) {
            picked = candidate;
            break;
          }
        }
      }
      if (!picked) {
        skipped += 1;
        continue;
      }
      const result = await assignUtcLeadToStaff(lead, picked);
      if (!result.ok) {
        skipped += 1;
        continue;
      }
      const pid = String(picked._id);
      utcCounts.set(pid, (utcCounts.get(pid) || 0) + 1);
      assigned += 1;
    }
  }

  return { assigned, skipped, dailyTarget: DAILY_CALL_TARGET, share: UTC_SHARE, at: now.toISOString() };
}

module.exports = {
  moveUtcToBucketAfterWork,
  autoAssignUtcLeads,
  DAILY_CALL_TARGET,
  UTC_SHARE,
};
