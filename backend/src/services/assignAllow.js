const { Lead, User, SystemSetting } = require('../models');
const { AppError } = require('../utils/http');
const { getGeneral } = require('./settings');
const { staffOnLeave } = require('./org');
const { dateKeyFromDate, dayBounds, weekdayIndex } = require('../utils/time');
const { DAILY_ASSIGN_SHARES } = require('../config/constants');
const { autoCapacityByStaff } = require('./dailyCapacity');
const autoAssign = require('./autoAssign');

const SETTING_KEY = 'dailyAssignAllow';
const MASTER_KEY = 'autoAssignEnabled';
const HOLD_KEY = 'holdAssignedLeads';
const SYSTEM_ACTOR = { id: 'system', name: 'System', role: 'SYSTEM' };

async function getAllowDoc() {
  return SystemSetting.findOne({ key: SETTING_KEY }).lean();
}

function presentMaster(value = {}, weekday = null) {
  const sundayOff = weekday === 0;
  const resumeMonday = Boolean(value.resumeAfterSunday) && sundayOff;
  return {
    enabled: Boolean(value.enabled),
    resumeAfterSunday: Boolean(value.resumeAfterSunday),
    sundayOff,
    resumeMonday,
    weekday,
    sundayForcedOffAt: value.sundayForcedOffAt || null,
    mondayRestoredAt: value.mondayRestoredAt || null,
    updatedAt: value.updatedAt || null,
    updatedBy: value.updatedBy || null,
  };
}

/**
 * Sunday is not a working day: force Auto-assign OFF and remember to restore Monday
 * if it was ON. Monday restores ON when resumeAfterSunday is set.
 */
async function applyWeekendAutoAssignRule(timeZone) {
  const general = timeZone ? { timezone: timeZone } : await getGeneral();
  const tz = general.timezone || 'Asia/Kolkata';
  const now = new Date();
  const weekday = weekdayIndex(now, tz);
  const doc = await SystemSetting.findOne({ key: MASTER_KEY });
  const prev = doc?.value || {};
  let value = {
    enabled: Boolean(prev.enabled),
    resumeAfterSunday: Boolean(prev.resumeAfterSunday),
    sundayForcedOffAt: prev.sundayForcedOffAt || null,
    mondayRestoredAt: prev.mondayRestoredAt || null,
    updatedAt: prev.updatedAt || null,
    updatedBy: prev.updatedBy || null,
  };
  let changed = false;

  if (weekday === 0) {
    if (value.enabled) {
      value.resumeAfterSunday = true;
      value.enabled = false;
      value.sundayForcedOffAt = now.toISOString();
      value.updatedAt = now.toISOString();
      value.updatedBy = SYSTEM_ACTOR;
      changed = true;
    }
  } else if (weekday === 1 && value.resumeAfterSunday) {
    value.enabled = true;
    value.resumeAfterSunday = false;
    value.mondayRestoredAt = now.toISOString();
    value.updatedAt = now.toISOString();
    value.updatedBy = SYSTEM_ACTOR;
    changed = true;
  }

  if (changed) {
    await SystemSetting.updateOne(
      { key: MASTER_KEY },
      { key: MASTER_KEY, value },
      { upsert: true },
    );
  }

  return presentMaster(value, weekday);
}

/** Master switch for Owner/SA. Default OFF — no auto-assign until turned on. Sunday always OFF. */
async function isAutoAssignOn() {
  const master = await applyWeekendAutoAssignRule();
  return Boolean(master.enabled);
}

async function getAutoAssignMaster() {
  return applyWeekendAutoAssignRule();
}

async function setAutoAssignMaster(user, enabled) {
  if (!['OWNER', 'SUPER_ADMIN'].includes(user.role)) {
    throw new AppError('Only Owner or Super Admin can change auto-assign', 403);
  }
  const general = await getGeneral();
  const tz = general.timezone || 'Asia/Kolkata';
  const now = new Date();
  const weekday = weekdayIndex(now, tz);
  const wantOn = Boolean(enabled);
  const doc = await SystemSetting.findOne({ key: MASTER_KEY }).lean();
  const prev = doc?.value || {};

  let value;
  let message;

  if (weekday === 0) {
    // Sunday never runs; ON means resume Monday.
    if (wantOn) {
      value = {
        enabled: false,
        resumeAfterSunday: true,
        sundayForcedOffAt: prev.sundayForcedOffAt || now.toISOString(),
        mondayRestoredAt: prev.mondayRestoredAt || null,
        updatedAt: now.toISOString(),
        updatedBy: { id: String(user._id), name: user.name, role: user.role },
      };
      message = 'Sunday is off (not a working day). Auto-assigning will turn ON automatically on Monday.';
    } else {
      value = {
        enabled: false,
        resumeAfterSunday: false,
        sundayForcedOffAt: prev.sundayForcedOffAt || null,
        mondayRestoredAt: prev.mondayRestoredAt || null,
        updatedAt: now.toISOString(),
        updatedBy: { id: String(user._id), name: user.name, role: user.role },
      };
      message = 'Auto-assigning is OFF for Sunday. It will stay OFF on Monday unless you turn it ON.';
    }
  } else {
    value = {
      enabled: wantOn,
      resumeAfterSunday: false,
      sundayForcedOffAt: prev.sundayForcedOffAt || null,
      mondayRestoredAt: prev.mondayRestoredAt || null,
      updatedAt: now.toISOString(),
      updatedBy: { id: String(user._id), name: user.name, role: user.role },
    };
    message = wantOn
      ? 'Auto-assigning is ON. Use Allow assigning to mark present staff and run today’s mix.'
      : 'Auto-assigning is OFF. No sheet / RNP / UTC / unassigned auto-assign until you turn it ON.';
  }

  await SystemSetting.updateOne(
    { key: MASTER_KEY },
    { key: MASTER_KEY, value, updatedBy: user._id },
    { upsert: true },
  );

  return {
    data: presentMaster(value, weekday),
    message,
  };
}

/**
 * Owner onboarding hold: assigned leads stay in Lead Management.
 * Calls Today stays empty; aging/bucket movers pause; reassign ignores capacity.
 */
async function isHoldAssignedOn() {
  const doc = await SystemSetting.findOne({ key: HOLD_KEY }).lean();
  return Boolean(doc?.value?.enabled);
}

async function getHoldAssignedMaster() {
  const doc = await SystemSetting.findOne({ key: HOLD_KEY }).lean();
  const value = doc?.value || {};
  return {
    enabled: Boolean(value.enabled),
    updatedAt: value.updatedAt || null,
    updatedBy: value.updatedBy || null,
  };
}

async function setHoldAssignedMaster(user, enabled) {
  if (user.role !== 'OWNER') {
    throw new AppError('Only Owner can change Hold assigned leads', 403);
  }
  const now = new Date();
  const wantOn = Boolean(enabled);
  const value = {
    enabled: wantOn,
    updatedAt: now.toISOString(),
    updatedBy: { id: String(user._id), name: user.name, role: user.role },
  };
  await SystemSetting.updateOne(
    { key: HOLD_KEY },
    { key: HOLD_KEY, value, updatedBy: user._id },
    { upsert: true },
  );
  return {
    data: { enabled: wantOn, updatedAt: value.updatedAt, updatedBy: value.updatedBy },
    message: wantOn
      ? 'Hold assigned leads is ON. Leads stay in Lead Management for setup (follow-ups, status, dates). Calls Today is paused. Aging to bucket is paused. Reassign is not blocked by capacity.'
      : 'Hold assigned leads is OFF. Calls Today and normal hold/bucket rules run again as planned.',
  };
}

async function getTodayAllow(timeZone) {
  const general = timeZone ? { timezone: timeZone } : await getGeneral();
  const tz = general.timezone || 'Asia/Kolkata';
  const today = dateKeyFromDate(new Date(), tz);
  const doc = await getAllowDoc();
  const value = doc?.value || null;
  if (!value || value.dateKey !== today || !value.allowed) {
    return {
      allowed: false,
      dateKey: today,
      timezone: tz,
      presentStaffIds: [],
      absentStaffIds: [],
      responses: {},
      morningRunAt: null,
      allowedAt: null,
      allowedBy: null,
    };
  }
  return {
    allowed: true,
    dateKey: today,
    timezone: tz,
    presentStaffIds: (value.presentStaffIds || []).map(String),
    absentStaffIds: (value.absentStaffIds || []).map(String),
    responses: value.responses && typeof value.responses === 'object' ? value.responses : {},
    morningRunAt: value.morningRunAt || null,
    allowedAt: value.allowedAt || null,
    allowedBy: value.allowedBy || null,
  };
}

function splitFair(total, staffCount) {
  if (!staffCount || total <= 0) return [];
  const base = Math.floor(total / staffCount);
  const extra = total % staffCount;
  return Array.from({ length: staffCount }, (_, index) => base + (index < extra ? 1 : 0));
}

async function listAssignableStaff(now, onLeave) {
  const staff = await User.find({
    deletedAt: null,
    isActive: true,
    role: { $in: ['STAFF', 'TEAM_LEADER'] },
    managingClients: { $exists: true, $ne: [] },
  }).select('name role team branch employeeId workStart workEnd managingClients employmentStatus maxLeadAllocation autoAssignApplicable').lean();

  return staff
    .map((person) => {
      const leave = onLeave.has(String(person._id)) || person.employmentStatus === 'on_leave';
      const autoAssignApplicable = person.autoAssignApplicable !== false;
      return {
        id: String(person._id),
        name: person.name,
        role: person.role,
        employeeId: person.employeeId || '',
        workStart: person.workStart || '11:00',
        workEnd: person.workEnd || '20:00',
        managingClients: person.managingClients || [],
        onLeave: leave,
        autoAssignApplicable,
        presentDefault: !leave && person.employmentStatus === 'active' && autoAssignApplicable,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function bucketCounts() {
  const [sheetByRole, rnpByRole, utcByRole, bulkByRole] = await Promise.all([
    Lead.aggregate([
      { $match: { deletedAt: null, assignedTo: null, fromSheet: true, leadRole: { $nin: [null, ''] } } },
      { $group: { _id: '$leadRole', count: { $sum: 1 } } },
    ]),
    Lead.aggregate([
      { $match: { deletedAt: null, assignedTo: null, status: 'rnp', leadRole: { $nin: [null, ''] } } },
      { $group: { _id: '$leadRole', count: { $sum: 1 } } },
    ]),
    Lead.aggregate([
      { $match: { deletedAt: null, assignedTo: null, status: 'utc', leadRole: { $nin: [null, ''] } } },
      { $group: { _id: '$leadRole', count: { $sum: 1 } } },
    ]),
    Lead.aggregate([
      {
        $match: {
          deletedAt: null,
          assignedTo: null,
          fromSheet: { $ne: true },
          status: { $nin: ['rnp', 'utc', 'disqualified', 'not_interested'] },
          leadRole: { $nin: [null, ''] },
          $or: [
            { untouchedParkedAt: null },
            { untouchedParkedAt: { $exists: false } },
          ],
        },
      },
      { $group: { _id: '$leadRole', count: { $sum: 1 } } },
    ]),
  ]);
  const toMap = (rows) => {
    const map = new Map();
    rows.forEach((row) => map.set(row._id, row.count || 0));
    return map;
  };
  return {
    sheet: toMap(sheetByRole),
    rnp: toMap(rnpByRole),
    utc: toMap(utcByRole),
    bulk: toMap(bulkByRole),
    sheetTotal: sheetByRole.reduce((sum, row) => sum + (row.count || 0), 0),
    rnpTotal: rnpByRole.reduce((sum, row) => sum + (row.count || 0), 0),
    utcTotal: utcByRole.reduce((sum, row) => sum + (row.count || 0), 0),
    bulkTotal: bulkByRole.reduce((sum, row) => sum + (row.count || 0), 0),
  };
}

function planCategory(roleCounts, present, shareOfBalance, remainingByStaff, alreadyByStaff, dailyTarget) {
  const plan = new Map(present.map((person) => [person.id, 0]));
  const roles = [...roleCounts.keys()];
  roles.forEach((leadRole) => {
    const total = roleCounts.get(leadRole) || 0;
    if (!total) return;
    const eligible = present.filter((person) => person.managingClients.includes(leadRole));
    if (!eligible.length) return;

    let remaining = total;
    if (shareOfBalance != null) {
      const caps = eligible.map((person) => {
        const balance = Math.max(0, remainingByStaff.get(person.id) ?? dailyTarget);
        const cap = Math.floor(balance * shareOfBalance);
        const already = alreadyByStaff.get(person.id) || 0;
        return Math.max(0, cap - already);
      });
      const totalCap = caps.reduce((sum, value) => sum + value, 0);
      remaining = Math.min(total, totalCap);
      if (!remaining) return;
      // distribute up to remaining by fair shares among those with cap > 0
      const withCap = eligible.map((person, index) => ({ person, cap: caps[index] })).filter((row) => row.cap > 0);
      let left = remaining;
      let cursor = 0;
      while (left > 0 && withCap.length) {
        const row = withCap[cursor % withCap.length];
        if (row.cap <= 0) {
          withCap.splice(cursor % withCap.length, 1);
          continue;
        }
        plan.set(row.person.id, (plan.get(row.person.id) || 0) + 1);
        row.cap -= 1;
        left -= 1;
        cursor += 1;
      }
      return;
    }

    const shares = splitFair(remaining, eligible.length);
    eligible.forEach((person, index) => {
      plan.set(person.id, (plan.get(person.id) || 0) + (shares[index] || 0));
    });
  });
  return plan;
}

async function todaySheetCountsByStaff(staffIds, timeZone, now) {
  if (!staffIds.length) return new Map();
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

async function preview(user) {
  if (!['OWNER', 'SUPER_ADMIN'].includes(user.role)) {
    throw new AppError('Only Owner or Super Admin can open allow assigning', 403);
  }
  const general = await getGeneral();
  const timeZone = general.timezone || 'Asia/Kolkata';
  const now = new Date();
  const onLeave = await staffOnLeave(now);
  const allow = await getTodayAllow(timeZone);
  const staff = await listAssignableStaff(now, onLeave);
  const buckets = await bucketCounts();
  const dailyTarget = Number(DAILY_ASSIGN_SHARES.dailyTarget) || 120;

  const presentForPlan = staff.filter((person) => (
    allow.allowed
      ? allow.presentStaffIds.includes(person.id)
      : person.presentDefault
  ));
  const presentIds = presentForPlan.map((person) => person.id);
  const capacity = await autoCapacityByStaff(presentIds, timeZone, now);

  const sheetPlanRaw = planCategory(buckets.sheet, presentForPlan, null, capacity.remaining, new Map(), dailyTarget);
  const sheetPlan = new Map();
  presentForPlan.forEach((person) => {
    const left = capacity.remaining.get(person.id) || 0;
    sheetPlan.set(person.id, Math.min(sheetPlanRaw.get(person.id) || 0, left));
  });
  const rnpPlan = planCategory(buckets.rnp, presentForPlan, DAILY_ASSIGN_SHARES.rnp, capacity.remaining, new Map(), dailyTarget);
  const utcPlan = planCategory(buckets.utc, presentForPlan, DAILY_ASSIGN_SHARES.utc, capacity.remaining, new Map(), dailyTarget);
  const bulkPlan = planCategory(buckets.bulk, presentForPlan, DAILY_ASSIGN_SHARES.bulkUnassigned, capacity.remaining, new Map(), dailyTarget);

  const responses = allow.responses || {};
  const rows = staff.map((person) => ({
    ...person,
    present: allow.allowed ? allow.presentStaffIds.includes(person.id) : person.presentDefault,
    selfCheck: responses[person.id]?.working == null
      ? null
      : Boolean(responses[person.id].working),
    selfCheckedAt: responses[person.id]?.at || null,
    plan: {
      sheet: sheetPlan.get(person.id) || 0,
      rnp: rnpPlan.get(person.id) || 0,
      utc: utcPlan.get(person.id) || 0,
      bulk: bulkPlan.get(person.id) || 0,
    },
    sheetAssignedToday: capacity.sheet.get(person.id) || 0,
    carryFresh: capacity.carryFresh.get(person.id) || 0,
    autoRemaining: capacity.remaining.get(person.id) || 0,
  }));

  const master = await getAutoAssignMaster();
  return {
    data: {
      allow,
      master,
      buckets: {
        sheet: buckets.sheetTotal,
        rnp: buckets.rnpTotal,
        utc: buckets.utcTotal,
        bulk: buckets.bulkTotal,
      },
      shares: DAILY_ASSIGN_SHARES,
      staff: rows,
    },
  };
}

async function allowAndAssign(user, body = {}) {
  if (!['OWNER', 'SUPER_ADMIN'].includes(user.role)) {
    throw new AppError('Only Owner or Super Admin can allow assigning', 403);
  }
  if (!(await isAutoAssignOn())) {
    throw new AppError('Turn Auto-assign ON in the side menu first', 422);
  }
  const general = await getGeneral();
  const timeZone = general.timezone || 'Asia/Kolkata';
  const now = new Date();
  const today = dateKeyFromDate(now, timeZone);
  const onLeave = await staffOnLeave(now);
  const staff = await listAssignableStaff(now, onLeave);
  const allIds = new Set(staff.map((person) => person.id));

  let presentStaffIds = Array.isArray(body.presentStaffIds)
    ? body.presentStaffIds.map(String).filter((id) => allIds.has(id))
    : staff.filter((person) => person.presentDefault).map((person) => person.id);

  presentStaffIds = [...new Set(presentStaffIds)];
  if (!presentStaffIds.length) {
    throw new AppError('Select at least one present staff member', 422);
  }

  const absentStaffIds = staff.map((person) => person.id).filter((id) => !presentStaffIds.includes(id));
  const previous = await loadAllowValue(timeZone);
  const responses = { ...previous.responses };
  presentStaffIds.forEach((id) => {
    responses[id] = {
      ...(responses[id] || {}),
      working: true,
      at: now.toISOString(),
      name: responses[id]?.name || '',
      role: responses[id]?.role || '',
      source: 'owner_allow',
    };
  });
  absentStaffIds.forEach((id) => {
    if (responses[id]?.working === true) {
      responses[id] = { ...responses[id], working: false, at: now.toISOString(), source: 'owner_allow' };
    }
  });
  const value = {
    dateKey: today,
    allowed: true,
    allowedAt: now.toISOString(),
    allowedBy: { id: String(user._id), name: user.name, role: user.role },
    presentStaffIds,
    absentStaffIds,
    responses,
    morningRunAt: null,
  };

  await SystemSetting.updateOne(
    { key: SETTING_KEY },
    { key: SETTING_KEY, value, updatedBy: user._id },
    { upsert: true },
  );

  const options = {
    presentStaffIds,
    ignoreWorkHours: true,
    requireAllow: false,
  };
  const result = await autoAssign.runDailyAutoAssign(options);

  value.morningRunAt = new Date().toISOString();
  await SystemSetting.updateOne({ key: SETTING_KEY }, { value });

  return {
    data: {
      allow: await getTodayAllow(timeZone),
      result,
    },
    message: `Assigning allowed for ${presentStaffIds.length} present staff. Assigned ${(result.assigned || 0)} lead(s). New sheet leads today will auto-share to these staff.`,
  };
}

async function status() {
  const [allow, master] = await Promise.all([getTodayAllow(), getAutoAssignMaster()]);
  return { data: { ...allow, master } };
}

async function loadAllowValue(timeZone) {
  const today = dateKeyFromDate(new Date(), timeZone);
  const doc = await getAllowDoc();
  const value = doc?.value || null;
  if (value && value.dateKey === today) {
    return {
      dateKey: today,
      allowed: Boolean(value.allowed),
      allowedAt: value.allowedAt || null,
      allowedBy: value.allowedBy || null,
      presentStaffIds: (value.presentStaffIds || []).map(String),
      absentStaffIds: (value.absentStaffIds || []).map(String),
      responses: value.responses && typeof value.responses === 'object' ? { ...value.responses } : {},
      morningRunAt: value.morningRunAt || null,
    };
  }
  return {
    dateKey: today,
    allowed: false,
    allowedAt: null,
    allowedBy: null,
    presentStaffIds: [],
    absentStaffIds: [],
    responses: {},
    morningRunAt: null,
  };
}

/**
 * Staff / TL morning check-in: “Are you working today?”
 * Yes → present for auto-assign (sheet + mix split among present only).
 * No → absent — no auto leads that day.
 */
async function getMyWorkingToday(user) {
  if (!['STAFF', 'TEAM_LEADER'].includes(user.role)) {
    return {
      data: {
        applicable: false,
        needsAnswer: false,
        working: null,
        dateKey: null,
      },
    };
  }
  const general = await getGeneral();
  const timeZone = general.timezone || 'Asia/Kolkata';
  const now = new Date();
  const weekday = weekdayIndex(now, timeZone);
  const today = dateKeyFromDate(now, timeZone);
  const onLeave = await staffOnLeave(now);
  const leave = onLeave.has(String(user._id)) || user.employmentStatus === 'on_leave';
  const person = await User.findOne({ _id: user._id, deletedAt: null })
    .select('workStart workEnd employmentStatus managingClients')
    .lean();
  const workStart = person?.workStart || '11:00';
  const autoOn = await isAutoAssignOn();
  const value = await loadAllowValue(timeZone);
  const sid = String(user._id);
  const response = value.responses[sid];
  const answered = response && typeof response.working === 'boolean';
  const working = answered ? Boolean(response.working) : null;

  // Sunday / leave: no prompt. Other days: ask once until answered.
  const needsAnswer = weekday !== 0 && !leave && !answered;

  return {
    data: {
      applicable: true,
      needsAnswer,
      working,
      answered,
      dateKey: today,
      timezone: timeZone,
      workStart,
      workEnd: person?.workEnd || '20:00',
      onLeave: leave,
      autoAssignOn: autoOn,
      canReceiveLeads: Boolean(autoOn && working === true),
      presentCount: value.presentStaffIds.length,
    },
  };
}

async function setMyWorkingToday(user, body = {}) {
  if (!['STAFF', 'TEAM_LEADER'].includes(user.role)) {
    throw new AppError('Only Staff or Team Leader can answer working today', 403);
  }
  const working = Boolean(body.working);
  const general = await getGeneral();
  const timeZone = general.timezone || 'Asia/Kolkata';
  const now = new Date();
  const weekday = weekdayIndex(now, timeZone);
  if (weekday === 0) {
    throw new AppError('Sunday is not a working day for auto-assign', 422);
  }
  const onLeave = await staffOnLeave(now);
  if (onLeave.has(String(user._id)) || user.employmentStatus === 'on_leave') {
    throw new AppError('You are on leave today', 422);
  }

  const sid = String(user._id);
  const value = await loadAllowValue(timeZone);
  const present = new Set(value.presentStaffIds);
  const absent = new Set(value.absentStaffIds);
  const responses = { ...value.responses };

  responses[sid] = {
    working,
    at: now.toISOString(),
    name: user.name || '',
    role: user.role,
  };

  if (working) {
    present.add(sid);
    absent.delete(sid);
  } else {
    present.delete(sid);
    absent.add(sid);
  }

  const presentStaffIds = [...present];
  const absentStaffIds = [...absent];
  const next = {
    dateKey: value.dateKey,
    allowed: working ? true : (value.allowed || presentStaffIds.length > 0),
    allowedAt: value.allowedAt || (working ? now.toISOString() : null),
    allowedBy: value.allowedBy || (working
      ? { id: sid, name: user.name, role: user.role, source: 'staff_checkin' }
      : null),
    presentStaffIds,
    absentStaffIds,
    responses,
    morningRunAt: value.morningRunAt || null,
  };

  // Keep day allowed if anyone is present.
  if (presentStaffIds.length) next.allowed = true;

  await SystemSetting.updateOne(
    { key: SETTING_KEY },
    { key: SETTING_KEY, value: next, updatedBy: user._id },
    { upsert: true },
  );

  let result = null;
  const autoOn = await isAutoAssignOn();
  if (working && autoOn && presentStaffIds.length) {
    result = await autoAssign.runDailyAutoAssign({
      presentStaffIds,
      ignoreWorkHours: true,
      requireAllow: false,
    });
    next.morningRunAt = new Date().toISOString();
    await SystemSetting.updateOne({ key: SETTING_KEY }, { value: next });
  }

  return {
    data: {
      working,
      dateKey: next.dateKey,
      presentCount: presentStaffIds.length,
      autoAssignOn: autoOn,
      canReceiveLeads: Boolean(working && autoOn),
      assigned: result?.assigned || 0,
      result,
    },
    message: working
      ? (autoOn
        ? `You are working today. Sheet and bucket leads will split among ${presentStaffIds.length} present staff.${result?.assigned ? ` Assigned ${result.assigned} lead(s) now.` : ''}`
        : 'You are working today. Auto-assign is OFF — ask Owner to turn it ON to receive leads.')
      : 'Marked not working today. You will not receive auto-assigned leads.',
  };
}

module.exports = {
  getTodayAllow,
  getAutoAssignMaster,
  isAutoAssignOn,
  setAutoAssignMaster,
  applyWeekendAutoAssignRule,
  isHoldAssignedOn,
  getHoldAssignedMaster,
  setHoldAssignedMaster,
  preview,
  allowAndAssign,
  status,
  getMyWorkingToday,
  setMyWorkingToday,
};
