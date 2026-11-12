const { Target } = require('../models');
const { AppError, paging, metaFor } = require('../utils/http');
const { periodRange, remainingDays } = require('../utils/time');
const { getGeneral } = require('./settings');
const { measureTarget } = require('./metrics');
const { recordAudit, changed } = require('./audit');
const { isElevated } = require('./access');
const { TARGET_TYPES } = require('../config/constants');

function typeInfo(key) {
  return TARGET_TYPES.find((item) => item.key === key) || { label: key, group: 'kpi', unit: 'count' };
}

function visibleFilter(user) {
  if (isElevated(user)) return { isActive: true };
  if (user.role === 'ADMIN') {
    return { isActive: true, $or: [{ branch: user.branch }, { team: { $in: user.managedTeams || [] } }, { staff: { $exists: true }, branch: user.branch }] };
  }
  return {
    isActive: true,
    $or: [
      { staff: user._id },
      { user: user._id },
      { team: user.team },
      { branch: user.branch, assigneeType: 'branch' },
    ],
  };
}

async function withProgress(target, now = new Date()) {
  const general = await getGeneral();
  const window = target.period === 'custom'
    ? { start: new Date(target.startDate), end: new Date(target.endDate) }
    : periodRange(target.period === 'daily' ? 'day' : target.period === 'weekly' ? 'week' : 'month', general.timezone, now);
  const start = new Date(Math.max(window.start.getTime(), new Date(target.startDate).getTime()));
  const end = new Date(Math.min(window.end.getTime(), new Date(target.endDate).getTime()));
  const actual = start < end ? await measureTarget(target, { start, end }) : 0;
  const goal = Number(target.value) || 0;
  const percentage = goal ? Math.round((actual / goal) * 1000) / 10 : 0;
  const info = typeInfo(target.type);
  return {
    ...target.toObject(),
    label: info.label,
    group: info.group,
    unit: info.unit,
    progress: {
      actual,
      goal,
      percentage,
      pending: Math.max(0, Math.round((goal - actual) * 100) / 100),
      remainingDays: remainingDays(target.endDate, now),
      window: { start, end },
    },
  };
}

async function list(user, query) {
  const { page, limit, skip } = paging(query);
  const filter = visibleFilter(user);
  if (query.type) filter.type = query.type;
  const [rows, total] = await Promise.all([
    Target.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
      .populate('staff', 'name')
      .populate('team', 'name')
      .populate('branch', 'name'),
    Target.countDocuments(filter),
  ]);
  const data = [];
  for (const row of rows) data.push(await withProgress(row));
  return { data, meta: metaFor(page, limit, total) };
}

async function create(user, body, meta) {
  const target = await Target.create({
    name: body.name.trim(),
    type: body.type,
    assigneeType: body.assigneeType,
    staff: body.staff || null,
    team: body.team || null,
    branch: body.branch || user.branch || null,
    user: body.user || null,
    value: body.value,
    period: body.period,
    startDate: body.startDate,
    endDate: body.endDate,
    createdBy: user._id,
  });
  await recordAudit({
    user: user._id, username: user.username, action: 'target.create', module: 'targets', recordId: target.id, newValues: body, ...meta,
  });
  return { data: await withProgress(target), message: 'Target created', status: 201 };
}

async function update(user, id, body, meta) {
  const target = await Target.findById(id);
  if (!target) throw new AppError('Target not found', 404);
  const before = target.value;
  if (body.name) target.name = body.name;
  if (body.value != null && body.value !== target.value) {
    target.history.push({ at: new Date(), by: user._id, oldValue: target.value, newValue: body.value, note: body.note || '' });
    target.value = body.value;
  }
  if (body.endDate) target.endDate = body.endDate;
  if (body.startDate) target.startDate = body.startDate;
  if (body.isActive != null) target.isActive = body.isActive;
  await target.save();
  const diff = changed({ value: before }, { value: target.value });
  await recordAudit({
    user: user._id, username: user.username, action: 'target.update', module: 'targets', recordId: id,
    oldValues: diff.oldValues, newValues: diff.newValues, ...meta,
  });
  return { data: await withProgress(target), message: 'Target updated' };
}

async function getOne(user, id) {
  const target = await Target.findOne({ _id: id, ...visibleFilter(user) }).populate('staff', 'name').populate('team', 'name').populate('branch', 'name');
  if (!target) throw new AppError('Target not found', 404);
  return { data: await withProgress(target) };
}

module.exports = { list, create, update, getOne, withProgress };
