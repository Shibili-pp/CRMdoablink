const {
  SystemSetting, CustomLeadStatus, PipelineStage, AlertRule, User,
} = require('../models');
const { recordAudit } = require('./audit');
const {
  LEAD_ROLES, LEAD_FIRMS, LEAD_SOURCES, ORIGINAL_LEAD_SOURCES, LEAD_STATUSES, PIPELINE_STAGES, ALERT_RULES, LEADERBOARD_WEIGHTS, COMPANY, BDA_WORKING_TARGET,
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

async function getLeadRoles() {
  const doc = await SystemSetting.findOne({ key: 'leadRoles' }).lean();
  return Array.isArray(doc?.value) && doc.value.length ? doc.value : LEAD_ROLES.map((role) => ({ ...role }));
}

async function assertLeadRole(key) {
  const roles = await getLeadRoles();
  const match = roles.find((role) => role.key === key);
  if (!match) throw new AppError('Choose a client type', 422);
  return match;
}

function roleKey(label) {
  return String(label || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

async function addLeadRole(user, body, meta) {
  const label = String(body.label || '').trim();
  const key = roleKey(label);
  if (!key) throw new AppError('Use letters or numbers in the client name', 422);
  const roles = await getLeadRoles();
  if (roles.some((role) => role.key === key)) throw new AppError('That client type already exists', 409);
  const next = [...roles, { key, label }];
  await SystemSetting.updateOne({ key: 'leadRoles' }, { key: 'leadRoles', value: next }, { upsert: true });
  await recordAudit({
    user: user._id, username: user.username, action: 'leadRole.create', module: 'settings', newValues: { key, label }, ...meta,
  });
  return { data: next, message: 'Client type added' };
}

async function removeLeadRole(user, key, meta) {
  const roles = await getLeadRoles();
  if (roles.length <= 1) throw new AppError('Keep at least one client type', 422);
  const next = roles.filter((role) => role.key !== key);
  if (next.length === roles.length) throw new AppError('Client type not found', 404);
  await SystemSetting.updateOne({ key: 'leadRoles' }, { value: next });
  await recordAudit({
    user: user._id, username: user.username, action: 'leadRole.delete', module: 'settings', oldValues: { key }, ...meta,
  });
  return { data: next, message: 'Client type removed' };
}

async function getLeadFirms() {
  const doc = await SystemSetting.findOne({ key: 'leadFirms' }).lean();
  return Array.isArray(doc?.value) && doc.value.length ? doc.value : LEAD_FIRMS.map((firm) => ({ ...firm }));
}

async function assertLeadFirm(key) {
  const firms = await getLeadFirms();
  const match = firms.find((firm) => firm.key === key);
  if (!match) throw new AppError('Choose a firm', 422);
  return match;
}

async function addLeadFirm(user, body, meta) {
  const label = String(body.label || '').trim();
  const key = roleKey(label);
  if (!key) throw new AppError('Use letters or numbers in the firm name', 422);
  const firms = await getLeadFirms();
  if (firms.some((firm) => firm.key === key)) throw new AppError('That firm already exists', 409);
  const next = [...firms, { key, label }];
  await SystemSetting.updateOne({ key: 'leadFirms' }, { key: 'leadFirms', value: next }, { upsert: true });
  await recordAudit({
    user: user._id, username: user.username, action: 'leadFirm.create', module: 'settings', newValues: { key, label }, ...meta,
  });
  return { data: next, message: 'Firm added' };
}

async function removeLeadFirm(user, key, meta) {
  const firms = await getLeadFirms();
  if (firms.length <= 1) throw new AppError('Keep at least one firm', 422);
  const next = firms.filter((firm) => firm.key !== key);
  if (next.length === firms.length) throw new AppError('Firm not found', 404);
  await SystemSetting.updateOne({ key: 'leadFirms' }, { value: next });
  await recordAudit({
    user: user._id, username: user.username, action: 'leadFirm.delete', module: 'settings', oldValues: { key }, ...meta,
  });
  return { data: next, message: 'Firm removed' };
}

async function getLeadSources() {
  const doc = await SystemSetting.findOne({ key: 'leadSources' }).lean();
  return Array.isArray(doc?.value) && doc.value.length ? doc.value : [...LEAD_SOURCES];
}

async function assertLeadSource(name) {
  const sources = await getLeadSources();
  const match = sources.find((source) => source.toLowerCase() === String(name || '').trim().toLowerCase());
  if (!match) throw new AppError('Choose a lead source', 422);
  return match;
}

async function addLeadSource(user, body, meta) {
  const label = String(body.label || '').trim();
  if (label.length < 2) throw new AppError('Use at least 2 characters in the source name', 422);
  const sources = await getLeadSources();
  if (sources.some((source) => source.toLowerCase() === label.toLowerCase())) throw new AppError('That source already exists', 409);
  const next = [...sources, label];
  await SystemSetting.updateOne({ key: 'leadSources' }, { key: 'leadSources', value: next }, { upsert: true });
  await recordAudit({
    user: user._id, username: user.username, action: 'leadSource.create', module: 'settings', newValues: { label }, ...meta,
  });
  return { data: next, message: 'Source added' };
}

async function removeLeadSource(user, name, meta) {
  const sources = await getLeadSources();
  if (sources.length <= 1) throw new AppError('Keep at least one source', 422);
  const next = sources.filter((source) => source.toLowerCase() !== String(name || '').trim().toLowerCase());
  if (next.length === sources.length) throw new AppError('Source not found', 404);
  await SystemSetting.updateOne({ key: 'leadSources' }, { value: next });
  await recordAudit({
    user: user._id, username: user.username, action: 'leadSource.delete', module: 'settings', oldValues: { name }, ...meta,
  });
  return { data: next, message: 'Source removed' };
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
  const { Lead } = require('../models');
  await Lead.updateMany(
    { deletedAt: null, fromSheet: true, $or: [{ priority: { $in: ['medium', 'low', null] } }, { priorityRank: { $exists: false } }, { priorityRank: { $lt: 30 } }] },
    { $set: { priority: 'high', priorityRank: 30 } },
  );
  await Lead.updateMany(
    { deletedAt: null, priority: 'urgent', $or: [{ priorityRank: { $ne: 40 } }, { priorityRank: { $exists: false } }] },
    { $set: { priorityRank: 40 } },
  );
  await Lead.updateMany(
    { deletedAt: null, priority: 'high', $or: [{ priorityRank: { $ne: 30 } }, { priorityRank: { $exists: false } }] },
    { $set: { priorityRank: 30 } },
  );
  await Lead.updateMany(
    { deletedAt: null, priority: 'medium', $or: [{ priorityRank: { $ne: 20 } }, { priorityRank: { $exists: false } }] },
    { $set: { priorityRank: 20 } },
  );
  await Lead.updateMany(
    { deletedAt: null, priority: 'low', $or: [{ priorityRank: { $ne: 10 } }, { priorityRank: { $exists: false } }] },
    { $set: { priorityRank: 10 } },
  );
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
  if (!await SystemSetting.findOne({ key: 'leadRoles' })) {
    await SystemSetting.create({ key: 'leadRoles', value: LEAD_ROLES });
  }
  if (!await SystemSetting.findOne({ key: 'leadFirms' })) {
    await SystemSetting.create({ key: 'leadFirms', value: LEAD_FIRMS });
  }
  const storedSources = await SystemSetting.findOne({ key: 'leadSources' });
  if (!storedSources) {
    await SystemSetting.create({ key: 'leadSources', value: LEAD_SOURCES });
  } else if (Array.isArray(storedSources.value)) {
    const sameAsOriginal = storedSources.value.length === ORIGINAL_LEAD_SOURCES.length
      && ORIGINAL_LEAD_SOURCES.every((source) => storedSources.value.includes(source));
    if (sameAsOriginal) {
      storedSources.value = LEAD_SOURCES;
      storedSources.markModified('value');
      await storedSources.save();
    }
  }
  if (!await SystemSetting.findOne({ key: 'leaderboardWeights' })) {
    await SystemSetting.create({ key: 'leaderboardWeights', value: LEADERBOARD_WEIGHTS });
  }
  if (!await SystemSetting.findOne({ key: 'rolePermissions' })) {
    await SystemSetting.create({ key: 'rolePermissions', value: ROLE_PERMISSIONS });
  } else {
    const rolesDoc = await SystemSetting.findOne({ key: 'rolePermissions' });
    const value = { ...(rolesDoc.value || {}) };
    let rolesTouched = false;
    ['ADMIN', 'SUPER_ADMIN'].forEach((role) => {
      const current = Array.isArray(value[role]) ? value[role] : [...(ROLE_PERMISSIONS[role] || [])];
      if (!current.includes('connections.manage')) {
        value[role] = [...current, 'connections.manage'];
        rolesTouched = true;
      }
    });
    if (rolesTouched) {
      await SystemSetting.updateOne({ key: 'rolePermissions' }, { value });
      await User.updateMany(
        { role: { $in: ['ADMIN', 'SUPER_ADMIN'] }, permissionMode: 'role', deletedAt: null },
        { $addToSet: { permissions: 'connections.manage' } },
      );
    }
  }
  await Promise.all(LEAD_STATUSES.map((status) => CustomLeadStatus.updateOne(
    { key: status.key },
    { $setOnInsert: { ...status, isSystem: true, isActive: true } },
    { upsert: true }
  )));
  for (const key of ['rnp', 'utc', 'prospect', 'may_buy_later', 'dp_received', 'interested_to_buy', 'demo_confirmed', 'demo_rescheduled', 'demo_completed', 'demo_cancelled']) {
    const status = LEAD_STATUSES.find((item) => item.key === key);
    if (!status) continue;
    await CustomLeadStatus.updateOne(
      { key },
      { $set: { label: status.label, category: status.category, sortOrder: status.sortOrder, isSystem: true, isActive: true } },
      { upsert: true },
    );
  }
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
  if (!await SystemSetting.findOne({ key: 'bdaWorkingTarget' })) {
    await SystemSetting.create({ key: 'bdaWorkingTarget', value: BDA_WORKING_TARGET });
  }
  await User.updateMany(
    {
      role: { $in: ['STAFF', 'TEAM_LEADER'] },
      deletedAt: null,
      $or: [
        { workStart: { $in: [null, ''] } },
        { workStart: { $exists: false } },
        { workEnd: { $in: [null, ''] } },
        { workEnd: { $exists: false } },
      ],
    },
    { $set: { workStart: '11:00', workEnd: '20:00' } }
  );
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

async function listStatuses() {
  return { data: await activeStatuses() };
}

async function removeStatus(user, id, meta) {
  const doc = await CustomLeadStatus.findById(id);
  if (!doc || !doc.isActive) throw new AppError('Status not found', 404);
  const activeCount = await CustomLeadStatus.countDocuments({ isActive: true });
  if (activeCount <= 1) throw new AppError('Keep at least one status', 422);
  doc.isActive = false;
  await doc.save();
  await recordAudit({
    user: user._id, username: user.username, action: 'status.delete', module: 'settings', recordId: doc.id, oldValues: { key: doc.key, label: doc.label }, ...meta,
  });
  return { data: { id: doc.id, key: doc.key }, message: 'Status removed' };
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
  getLeadRoles,
  assertLeadRole,
  addLeadRole,
  removeLeadRole,
  getLeadFirms,
  assertLeadFirm,
  addLeadFirm,
  removeLeadFirm,
  getLeadSources,
  assertLeadSource,
  addLeadSource,
  removeLeadSource,
  getWeights,
  roleTemplate,
  permissionsFor,
  listSettings,
  updateSetting,
  updateRolePermissions,
  ensureReferenceData,
  activeStatuses,
  activeStages,
  listStatuses,
  saveStatus,
  removeStatus,
  saveStage,
  updateAlertRule,
};
