const { Lead, User, LeadAssignment, FollowUp, RevenueOpportunity } = require('../models');
const { getGeneral } = require('./settings');
const { staffOnLeave } = require('./org');
const { addActivity } = require('./activity');
const { notify } = require('./notify');
const { isWithinWorkHours } = require('./autoAssign');
const { distributeWithFirmBalance, takeBalancedPool } = require('./firmBalance');
const { autoCapacityByStaff, shareQuota } = require('./dailyCapacity');
const { zonedParts, dateKeyFromDate, dayBounds } = require('../utils/time');
const { BDA_WORKING_TARGET, DAILY_ASSIGN_SHARES } = require('../config/constants');

const RNP_FIRST_HOURS = 3;
const RNP_REPEAT_HOURS = 2;
const RNP_SHARE = Number(DAILY_ASSIGN_SHARES.rnp) || 0.3;
const DAILY_CALL_TARGET = Number(DAILY_ASSIGN_SHARES.dailyTarget)
  || Number(BDA_WORKING_TARGET?.metrics?.find((row) => row.key === 'dialAttempts')?.daily)
  || 120;
const BUCKET_CUTOFF = '20:00';

function clockToMinutes(value) {
  const match = String(value || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return (Number(match[1]) * 60) + Number(match[2]);
}

function applyRnpSchedule(lead, at = new Date()) {
  lead.rnpMarkedAt = at;
  lead.rnpNextCallAt = new Date(at.getTime() + (RNP_FIRST_HOURS * 60 * 60 * 1000));
  lead.rnpLastNotifyAt = null;
  lead.rnpNotifyCount = 0;
}

function clearRnpSchedule(lead) {
  lead.rnpMarkedAt = null;
  lead.rnpNextCallAt = null;
  lead.rnpLastNotifyAt = null;
  lead.rnpNotifyCount = 0;
}

function nextDueAfterNotify(from = new Date()) {
  return new Date(from.getTime() + (RNP_REPEAT_HOURS * 60 * 60 * 1000));
}

async function processRnpReminders() {
  const general = await getGeneral();
  const timeZone = general.timezone || 'Asia/Kolkata';
  const now = new Date();
  const leads = await Lead.find({
    deletedAt: null,
    status: 'rnp',
    assignedTo: { $ne: null },
    rnpNextCallAt: { $lte: now },
  }).limit(200).lean();

  if (!leads.length) return { notified: 0 };

  const staffIds = [...new Set(leads.map((lead) => String(lead.assignedTo)))];
  const people = await User.find({ _id: { $in: staffIds }, deletedAt: null, isActive: true })
    .select('name workStart workEnd')
    .lean();
  const byId = new Map(people.map((person) => [String(person._id), person]));

  let notified = 0;
  for (const lead of leads) {
    const person = byId.get(String(lead.assignedTo));
    if (!person) continue;
    if (!isWithinWorkHours(person, now, timeZone)) continue;

    const round = (lead.rnpNotifyCount || 0) + 1;
    const title = round === 1 ? 'RNP pending — call again' : 'RNP still pending — call again';
    const body = `${lead.name} (${lead.leadCode}) · ring not picked${round > 1 ? ` · reminder ${round}` : ''}`;
    const created = await notify({
      user: lead.assignedTo,
      type: 'rnp_pending',
      title,
      body,
      module: 'leads',
      recordId: lead._id,
      dedupeKey: `rnp:${lead._id}:${round}:${dateKeyFromDate(now, timeZone)}`,
    });
    if (!created) continue;

    await Lead.updateOne({ _id: lead._id }, {
      $set: {
        rnpLastNotifyAt: now,
        rnpNotifyCount: round,
        rnpNextCallAt: nextDueAfterNotify(now),
      },
    });
    notified += 1;
  }

  return { notified };
}

/** Marked today → keep with staff through tomorrow; move only after a later day’s work end. */
function rnpHoldComplete(markedAt, now, timeZone) {
  if (!markedAt) return true;
  const markedKey = dateKeyFromDate(new Date(markedAt), timeZone);
  const todayKey = dateKeyFromDate(now, timeZone);
  return Boolean(markedKey && todayKey && markedKey < todayKey);
}

function rnpTriedStaffIds(lead) {
  const tried = new Set();
  (Array.isArray(lead.rnpHandlers) ? lead.rnpHandlers : []).forEach((entry) => {
    if (entry?.staff) tried.add(String(entry.staff._id || entry.staff));
  });
  if (lead.rnpLastStaff) tried.add(String(lead.rnpLastStaff._id || lead.rnpLastStaff));
  return tried;
}

async function managingStaffForRole(leadRole) {
  if (!leadRole) return [];
  return User.find({
    deletedAt: null,
    isActive: true,
    role: { $in: ['STAFF', 'TEAM_LEADER'] },
    managingClients: leadRole,
    employmentStatus: { $ne: 'on_leave' },
  }).select('_id name').lean();
}

async function parkRnpExhausted(lead, fromStaff = null) {
  const now = new Date();
  lead.status = 'disqualified';
  lead.statusChangedAt = now;
  lead.lostReason = 'All staff managing this client already marked RNP';
  lead.assignedTo = null;
  lead.team = null;
  lead.bucketStatus = 'unassigned';
  lead.assignmentDate = null;
  lead.rnpMarkedAt = null;
  lead.rnpNextCallAt = null;
  lead.rnpLastNotifyAt = null;
  lead.rnpNotifyCount = 0;
  await lead.save();

  if (fromStaff) {
    await LeadAssignment.create({
      lead: lead._id,
      fromStaff,
      toStaff: null,
      assignedBy: null,
      reason: 'RNP exhausted all managing staff → Disqualified',
      mode: 'manual',
    });
  }
  await addActivity({
    lead,
    type: 'lead_status_changed',
    actor: null,
    description: 'RNP shared with all managing staff — moved to Disqualified',
    oldValue: { status: 'rnp', assignedTo: fromStaff },
    newValue: { status: 'disqualified', assignedTo: null },
    metadata: { reason: 'rnp_exhausted_disqualified' },
  });
  return lead;
}

async function moveRnpToBucketAfterWork() {
  const assignAllow = require('./assignAllow');
  if (await assignAllow.isHoldAssignedOn()) {
    return { moved: 0, blocked: true, reason: 'hold_assigned_on' };
  }
  // While Auto assigning is OFF, staff keep their leads (RNP stays on Calls today / Lead Management).
  if (!(await assignAllow.isAutoAssignOn())) {
    return { moved: 0, blocked: true, reason: 'auto_assign_off' };
  }
  const general = await getGeneral();
  const timeZone = general.timezone || 'Asia/Kolkata';
  const now = new Date();
  const parts = zonedParts(now, timeZone);
  const nowMinutes = (parts.hour * 60) + parts.minute;
  const cutoff = clockToMinutes(BUCKET_CUTOFF);

  const leads = await Lead.find({
    deletedAt: null,
    status: 'rnp',
    assignedTo: { $ne: null },
  }).limit(500);

  if (!leads.length) return { moved: 0, held: 0, disqualified: 0 };

  const staffIds = [...new Set(leads.map((lead) => String(lead.assignedTo)))];
  const people = await User.find({ _id: { $in: staffIds } }).select('name workEnd').lean();
  const byId = new Map(people.map((person) => [String(person._id), person]));

  let moved = 0;
  let held = 0;
  let disqualified = 0;
  for (const lead of leads) {
    const person = byId.get(String(lead.assignedTo));
    const end = clockToMinutes(person?.workEnd || BUCKET_CUTOFF);
    const pastStaffEnd = end != null && nowMinutes >= end;
    const pastCutoff = cutoff != null && nowMinutes >= cutoff;
    if (!pastStaffEnd && !pastCutoff) continue;

    // Keep with staff through the day after RNP was marked (retry next day if busy).
    if (!rnpHoldComplete(lead.rnpMarkedAt || lead.statusChangedAt, now, timeZone)) {
      held += 1;
      continue;
    }

    const fromStaff = lead.assignedTo;
    lead.rnpLastStaff = fromStaff;
    const marker = byId.get(String(fromStaff));
    const handlers = Array.isArray(lead.rnpHandlers) ? lead.rnpHandlers : [];
    const alreadyLatest = handlers.length
      && String(handlers[handlers.length - 1]?.staff || '') === String(fromStaff);
    if (!alreadyLatest && fromStaff) {
      handlers.push({
        staff: fromStaff,
        name: marker?.name || person?.name || '',
        markedAt: lead.rnpMarkedAt || new Date(),
      });
      lead.rnpHandlers = handlers.slice(-20);
    }

    const eligible = await managingStaffForRole(lead.leadRole);
    const tried = rnpTriedStaffIds(lead);
    const allTried = eligible.length > 0
      && eligible.every((person) => tried.has(String(person._id)));
    if (allTried) {
      await parkRnpExhausted(lead, fromStaff);
      disqualified += 1;
      continue;
    }

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
      reason: 'RNP returned to bucket after next-day hold',
      mode: 'manual',
    });
    await addActivity({
      lead,
      type: 'lead_reassigned',
      actor: null,
      description: 'RNP moved to bucket after next-day hold',
      oldValue: fromStaff,
      newValue: null,
      metadata: { reason: 'rnp_bucket', holdDays: 1 },
    });
    moved += 1;
  }

  return { moved, held, disqualified };
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

async function todayRnpAssignCounts(staffIds, timeZone, now) {
  const key = dateKeyFromDate(now, timeZone);
  const { start, end } = dayBounds(key, timeZone);
  const rows = await LeadAssignment.aggregate([
    {
      $match: {
        toStaff: { $in: staffIds },
        mode: 'round_robin',
        reason: { $regex: /RNP rotate/i },
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

function rnpQuotaForStaff(remainingSlots, alreadyRnp) {
  return shareQuota(remainingSlots, RNP_SHARE, alreadyRnp);
}

async function assignRnpLeadToStaff(lead, staff) {
  const filter = { _id: lead._id, deletedAt: null, assignedTo: null, status: 'rnp' };
  const now = new Date();
  // New staff gets this as fresh — RNP was only for the previous owner.
  const updated = await Lead.findOneAndUpdate(filter, {
    $set: {
      assignedTo: staff._id,
      team: staff.team || null,
      branch: staff.branch || lead.branch || null,
      assignmentDate: now,
      bucketStatus: 'assigned',
      status: 'fresh',
      statusChangedAt: now,
      callQueueTier: lead.fromSheet ? 1 : 3,
      rnpLastStaff: lead.rnpLastStaff || lead.assignedTo || null,
      rnpMarkedAt: null,
      rnpNextCallAt: null,
      rnpLastNotifyAt: null,
      rnpNotifyCount: 0,
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
    reason: 'RNP rotate from bucket → fresh for new staff · firm 50-50 · 30% of remaining daily target',
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
    description: `RNP rotated to ${staff.name} as fresh`,
    oldValue: { status: 'rnp' },
    newValue: { status: 'fresh', assignedTo: staff._id },
    metadata: { mode: 'rnp_rotate', firm: updated.firm || null, presentedAs: 'fresh' },
  });
  await notify({
    user: staff._id,
    type: 'lead_assigned',
    title: 'New lead assigned',
    body: `${updated.name} (${updated.leadCode}) · fresh · call today`,
    module: 'leads',
    recordId: updated.id,
    dedupeKey: `rnp-assign:${updated.id}:${staff.id}:${dateKeyFromDate(now, 'Asia/Kolkata')}`,
  });
  return { ok: true, lead: updated, staff };
}

/** At work start: rotate bucket RNP to next matching staff, up to 30% of (120 − today’s sheet assigns). Firms 50-50 (fill from other if short). */
async function autoAssignRnpLeads(options = {}) {
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
    status: 'rnp',
    leadRole: { $nin: [null, ''] },
  }).sort({ rnpMarkedAt: 1, createdAt: 1 }).limit(400).lean();

  if (!leads.length) return { assigned: 0, skipped: 0 };

  const staff = await User.find({
    deletedAt: null,
    isActive: true,
    role: { $in: ['STAFF', 'TEAM_LEADER'] },
    managingClients: { $exists: true, $ne: [] },
  }).select('name role team branch workStart workEnd managingClients employmentStatus autoAssignApplicable').lean();

  const working = staff.filter((person) => (
    person.autoAssignApplicable !== false
    && !onLeave.has(String(person._id))
    && person.employmentStatus !== 'on_leave'
    && (options.ignoreWorkHours || isWithinWorkHours(person, now, timeZone))
    && Array.isArray(person.managingClients)
    && person.managingClients.length
    && (!presentSet || presentSet.has(String(person._id)))
  ));

  if (!working.length) return { assigned: 0, skipped: leads.length };

  const staffIds = working.map((person) => person._id);
  const capacity = await autoCapacityByStaff(staffIds, timeZone, now);
  const rnpCounts = await todayRnpAssignCounts(staffIds, timeZone, now);

  let assigned = 0;
  let skipped = 0;
  const byFirm = { doablink: 0, studlink: 0, other: 0 };
  const groups = new Map();
  leads.forEach((lead) => {
    if (!groups.has(lead.leadRole)) groups.set(lead.leadRole, []);
    groups.get(lead.leadRole).push(lead);
  });

  let disqualified = 0;
  for (const [leadRole, group] of groups.entries()) {
    const eligible = working
      .filter((person) => person.managingClients.includes(leadRole))
      .sort((a, b) => String(a._id).localeCompare(String(b._id)));
    if (!eligible.length) {
      skipped += group.length;
      continue;
    }

    const allManaging = await managingStaffForRole(leadRole);
    const rotatable = [];
    for (const lead of group) {
      const tried = rnpTriedStaffIds(lead);
      const remaining = allManaging.filter((person) => !tried.has(String(person._id)));
      if (allManaging.length > 0 && remaining.length === 0) {
        const doc = await Lead.findOne({ _id: lead._id, deletedAt: null, status: 'rnp', assignedTo: null });
        if (doc) {
          await parkRnpExhausted(doc, null);
          disqualified += 1;
        } else {
          skipped += 1;
        }
        continue;
      }
      rotatable.push(lead);
    }

    const quotas = new Map();
    eligible.forEach((person) => {
      const sid = String(person._id);
      quotas.set(sid, rnpQuotaForStaff(capacity.remaining.get(sid) || 0, rnpCounts.get(sid) || 0));
    });

    const totalQuota = [...quotas.values()].reduce((sum, value) => sum + value, 0);
    if (totalQuota <= 0) {
      skipped += rotatable.length;
      continue;
    }

    const pool = takeBalancedPool(rotatable, totalQuota);
    skipped += Math.max(0, rotatable.length - pool.length);

    const hint = pool.find((lead) => lead.rnpLastStaff)?.rnpLastStaff || null;
    const result = await distributeWithFirmBalance({
      leads: pool,
      eligible,
      quotas,
      gotCounts: rnpCounts,
      rotateHintStaffId: hint,
      preferLead: (lead, person) => {
        const next = rotateTarget(eligible, lead.rnpLastStaff);
        return next && String(next._id) === String(person._id);
      },
      assignOne: (lead, person) => assignRnpLeadToStaff(lead, person),
    });

    assigned += result.assigned;
    skipped += result.skipped;
    Object.keys(byFirm).forEach((key) => {
      byFirm[key] += result.byFirm?.[key] || 0;
    });
  }

  return {
    assigned,
    skipped,
    disqualified,
    byFirm,
    dailyTarget: DAILY_CALL_TARGET,
    share: RNP_SHARE,
    at: now.toISOString(),
  };
}

module.exports = {
  applyRnpSchedule,
  clearRnpSchedule,
  parkRnpExhausted,
  rnpHoldComplete,
  processRnpReminders,
  moveRnpToBucketAfterWork,
  autoAssignRnpLeads,
  DAILY_CALL_TARGET,
  RNP_SHARE,
};
