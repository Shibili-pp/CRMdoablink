const {
  SystemSetting, CustomLeadStatus, PipelineStage, AlertRule, User,
} = require('../models');
const { recordAudit } = require('./audit');
const {
  LEAD_SOURCES, LEAD_STATUSES, PIPELINE_STAGES, ALERT_RULES, LEADERBOARD_WEIGHTS, COMPANY,
} = require('../config/constants');
const { ALL_PERMISSIONS, ROLE_PERMISSIONS } = require('../config/permissions');
const { AppError } = require('../utils/http');

let generalCache = { at: 0, value: null };

async function getGeneral() {
  if (generalCache.value && Date.now() - generalCache.at < 30000) return generalCache.value;
  const doc = await SystemSetting.findOne({ key: 'general' }).lean();
  const value = {
    companyName: COMPANY.legalName,
    productName: COMPANY.productName,
    timezone: 'Asia/Kolkata',
    countryCode: '91',
    ...(doc?.value || {}),
  };
  generalCache = { at: Date.now(), value };
  return value;
}

function clearSettingsCache() {
  generalCache = { at: 0, value: null };
}

async function getLeadSources() {
  const doc = await SystemSetting.findOne({ key: 'leadSources' }).lean();
  return Array.isArray(doc?.value) && doc.value.length ? doc.value : [...LEAD_SOURCES];
}

async function getWeights() {
  const doc = await SystemSetting.findOne({ key: 'leaderboardWeights' }).lean();
  return { ...LEADERBOARD_WEIGHTS, ...(doc?.value || {}) };
}

async function roleTemplate(role) {
  const doc = await SystemSetting.findOne({ key: 'rolePermissions' }).lean();
  const stored = doc?.value?.[role];
  if (role === 'OWNER') return [...ALL_PERMISSIONS];
  if (Array.isArray(stored) && stored.length) {
    return stored.filter((key) => ALL_PERMISSIONS.includes(key));
  }
  return [...(ROLE_PERMISSIONS[role] || [])];
}

async function permissionsFor(user) {
  if (!user) return [];
  if (user.role === 'OWNER') return [...ALL_PERMISSIONS];
  if (user.permissionMode === 'custom' && user.permissions?.length) return user.permissions;
  return roleTemplate(user.role);
}

async function listSettings() {
  const [general, sources, weights, roles, statuses, stages, rules] = await Promise.all([
    getGeneral(),
    getLeadSources(),
    getWeights(),
    SystemSetting.findOne({ key: 'rolePermissions' }).lean(),
    CustomLeadStatus.find().sort({ sortOrder: 1 }).lean(),
    PipelineStage.find().sort({ sortOrder: 1 }).lean(),
    AlertRule.find().sort({ key: 1 }).lean(),
  ]);
  return {
    data: {
      general,
      leadSources: sources,
      leaderboardWeights: weights,
      rolePermissions: roles?.value || ROLE_PERMISSIONS,
      statuses,
      stages,
      alertRules: rules,
      permissionCatalog: ALL_PERMISSIONS,
    },
  };
}

async function updateSetting(user, key, value, meta) {
  const allowed = ['general', 'leadSources', 'leaderboardWeights'];
  if (!allowed.includes(key)) throw new AppError('Unknown setting', 404);
  if (key === 'general') {
    const current = await getGeneral();
    value = {
      companyName: value.companyName || current.companyName,
      productName: COMPANY.productName,
      timezone: value.timezone || current.timezone,
      countryCode: String(value.countryCode || current.countryCode).replace(/\D/g, '') || '91',
    };
    clearSettingsCache();
  }
  if (key === 'leadSources') {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
      throw new AppError('Lead sources must be a list of names', 422);
    }
    value = [...new Set(value.map((item) => item.trim()))];
  }
  if (key === 'leaderboardWeights') {
    const next = { ...LEADERBOARD_WEIGHTS };
    Object.keys(next).forEach((name) => {
      const numeric = Number(value?.[name]);
      if (Number.isFinite(numeric) && numeric >= 0) next[name] = numeric;
    });
    value = next;
  }
  const previous = await SystemSetting.findOne({ key }).lean();
  await SystemSetting.findOneAndUpdate({ key }, { key, value, updatedBy: user._id }, { upsert: true, new: true });
  await recordAudit({
    user: user._id,
    username: user.username,
    action: 'settings.update',
    module: 'settings',
    recordId: key,
    oldValues: previous?.value,
    newValues: value,
    ...meta,
  });
  clearSettingsCache();
  return { data: value, message: 'Setting saved' };
}

async function updateRolePermissions(actor, role, permissions, meta) {
  if (role === 'OWNER') throw new AppError('Owner access stays complete and cannot be reduced', 400);
  const clean = [...new Set((permissions || []).filter((key) => ALL_PERMISSIONS.includes(key)))];
  const doc = await SystemSetting.findOne({ key: 'rolePermissions' });
  const value = { ...(doc?.value || {}) };
  const previous = value[role] || ROLE_PERMISSIONS[role];
  value[role] = clean;
  await SystemSetting.findOneAndUpdate(
    { key: 'rolePermissions' },
    { key: 'rolePermissions', value, updatedBy: actor._id },
    { upsert: true }
  );
  await User.updateMany({ role, permissionMode: 'role', deletedAt: null }, { $set: { permissions: clean } });
  await recordAudit({
    user: actor._id,
    username: actor.username,
    action: 'roles.permissions',
    module: 'roles',
    recordId: role,
    oldValues: { permissions: previous },
    newValues: { permissions: clean },
    ...meta,
  });
  return { data: { role, permissions: clean }, message: 'Role permissions updated' };
}

async function ensureReferenceData() {
  const general = await SystemSetting.findOne({ key: 'general' });
  if (!general) {
    await SystemSetting.create({
      key: 'general',
      value: {
        companyName: COMPANY.legalName,
        productName: COMPANY.productName,
        timezone: 'Asia/Kolkata',
        countryCode: '91',
      },
    });
  }
  if (!await SystemSetting.findOne({ key: 'leadSources' })) {
    await SystemSetting.create({ key: 'leadSources', value: LEAD_SOURCES });
  }
  if (!await SystemSetting.findOne({ key: 'leaderboardWeights' })) {
    await SystemSetting.create({ key: 'leaderboardWeights', value: LEADERBOARD_WEIGHTS });
  }
  if (!await SystemSetting.findOne({ key: 'rolePermissions' })) {
    await SystemSetting.create({ key: 'rolePermissions', value: ROLE_PERMISSIONS });
  }
  await Promise.all(LEAD_STATUSES.map((status) => CustomLeadStatus.updateOne(
    { key: status.key },
    { $setOnInsert: { ...status, isSystem: true, isActive: true } },
    { upsert: true }
  )));
  await Promise.all(PIPELINE_STAGES.map((stage) => PipelineStage.updateOne(
    { key: stage.key },
    { $setOnInsert: { ...stage, isActive: true } },
    { upsert: true }
  )));
  await Promise.all(ALERT_RULES.map((rule) => AlertRule.updateOne(
    { key: rule.key },
    { $setOnInsert: rule },
    { upsert: true }
  )));
  clearSettingsCache();
}

async function activeStatuses() {
  const rows = await CustomLeadStatus.find({ isActive: true }).sort({ sortOrder: 1 }).lean();
  return rows.length ? rows : LEAD_STATUSES;
}

async function activeStages() {
  const rows = await PipelineStage.find({ isActive: true }).sort({ sortOrder: 1 }).lean();
  return rows.length ? rows : PIPELINE_STAGES;
}

async function saveStatus(user, body, meta, id) {
  const key = String(body.key || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  if (!key) throw new AppError('Status key is required', 422);
  const payload = {
    key,
    label: body.label.trim(),
    category: body.category,
    sortOrder: body.sortOrder ?? 0,
    isActive: body.isActive !== false,
  };
  const doc = id
    ? await CustomLeadStatus.findByIdAndUpdate(id, payload, { new: true })
    : await CustomLeadStatus.findOneAndUpdate({ key }, payload, { upsert: true, new: true });
  if (!doc) throw new AppError('Status not found', 404);
  await recordAudit({
    user: user._id, username: user.username, action: id ? 'status.update' : 'status.create', module: 'settings', recordId: doc.id, newValues: payload, ...meta,
  });
  return { data: doc, message: 'Status saved' };
}

async function saveStage(user, body, meta, id) {
  const key = String(body.key || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  if (!key) throw new AppError('Stage key is required', 422);
  const payload = {
    key,
    label: body.label.trim(),
    probability: body.probability ?? 0,
    sortOrder: body.sortOrder ?? 0,
    isWon: Boolean(body.isWon),
    isLost: Boolean(body.isLost),
    isActive: body.isActive !== false,
  };
  const doc = id
    ? await PipelineStage.findByIdAndUpdate(id, payload, { new: true })
    : await PipelineStage.findOneAndUpdate({ key }, payload, { upsert: true, new: true });
  if (!doc) throw new AppError('Stage not found', 404);
  await recordAudit({
    user: user._id, username: user.username, action: 'stage.save', module: 'settings', recordId: doc.id, newValues: payload, ...meta,
  });
  return { data: doc, message: 'Stage saved' };
}

async function updateAlertRule(user, id, body, meta) {
  const rule = await AlertRule.findByIdAndUpdate(id, {
    threshold: body.threshold,
    enabled: body.enabled,
    label: body.label,
  }, { new: true });
  if (!rule) throw new AppError('Alert rule not found', 404);
  await recordAudit({
    user: user._id, username: user.username, action: 'alert.update', module: 'settings', recordId: rule.id, newValues: body, ...meta,
  });
  return { data: rule, message: 'Alert rule updated' };
}

module.exports = {
  getGeneral,
  clearSettingsCache,
  getLeadSources,
  getWeights,
  roleTemplate,
  permissionsFor,
  listSettings,
  updateSetting,
  updateRolePermissions,
  ensureReferenceData,
  activeStatuses,
  activeStages,
  saveStatus,
  saveStage,
  updateAlertRule,
};
