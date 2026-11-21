const { Lead, User, SystemSetting } = require('../models');
const { AppError } = require('../utils/http');
const { getGeneral } = require('./settings');
const { staffOnLeave } = require('./org');
const { dateKeyFromDate, dayBounds } = require('../utils/time');
const { DAILY_ASSIGN_SHARES } = require('../config/constants');
const autoAssign = require('./autoAssign');

const SETTING_KEY = 'dailyAssignAllow';

async function getAllowDoc() {
  return SystemSetting.findOne({ key: SETTING_KEY }).lean();
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
  }).select('name role team branch employeeId workStart workEnd managingClients employmentStatus maxLeadAllocation').lean();

  return staff
    .map((person) => {
      const leave = onLeave.has(String(person._id)) || person.employmentStatus === 'on_leave';
      return {
        id: String(person._id),
        name: person.name,
        role: person.role,
        employeeId: person.employeeId || '',
        workStart: person.workStart || '11:00',
        workEnd: person.workEnd || '20:00',
        managingClients: person.managingClients || [],
        onLeave: leave,
        presentDefault: !leave && person.employmentStatus === 'active',
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
      { $match: { deletedAt: null, assignedTo: null, fromSheet: { $ne: true }, status: { $nin: ['rnp', 'utc'] }, leadRole: { $nin: [null, ''] } } },
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

function planCategory(roleCounts, present, shareOfBalance, sheetTodayByStaff, alreadyByStaff, dailyTarget) {
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
        const balance = Math.max(0, dailyTarget - (sheetTodayByStaff.get(person.id) || 0));
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
  const sheetToday = await todaySheetCountsByStaff(presentIds, timeZone, now);

  const sheetPlan = planCategory(buckets.sheet, presentForPlan, null, sheetToday, new Map(), dailyTarget);
  const rnpPlan = planCategory(buckets.rnp, presentForPlan, DAILY_ASSIGN_SHARES.rnp, sheetToday, new Map(), dailyTarget);
  const utcPlan = planCategory(buckets.utc, presentForPlan, DAILY_ASSIGN_SHARES.utc, sheetToday, new Map(), dailyTarget);
  const bulkPlan = planCategory(buckets.bulk, presentForPlan, DAILY_ASSIGN_SHARES.bulkUnassigned, sheetToday, new Map(), dailyTarget);

  const rows = staff.map((person) => ({
    ...person,
    present: allow.allowed ? allow.presentStaffIds.includes(person.id) : person.presentDefault,
    plan: {
      sheet: sheetPlan.get(person.id) || 0,
      rnp: rnpPlan.get(person.id) || 0,
      utc: utcPlan.get(person.id) || 0,
      bulk: bulkPlan.get(person.id) || 0,
    },
    sheetAssignedToday: sheetToday.get(person.id) || 0,
  }));

  return {
    data: {
      allow,
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
  const value = {
    dateKey: today,
    allowed: true,
    allowedAt: now.toISOString(),
    allowedBy: { id: String(user._id), name: user.name, role: user.role },
    presentStaffIds,
    absentStaffIds,
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
  return { data: await getTodayAllow() };
}

module.exports = {
  getTodayAllow,
  preview,
  allowAndAssign,
  status,
};
