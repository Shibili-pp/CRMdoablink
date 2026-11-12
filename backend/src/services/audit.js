const { AuditLog } = require('../models');

async function recordAudit(entry, session) {
  const doc = {
    user: entry.user || undefined,
    username: entry.username || '',
    action: entry.action,
    module: entry.module,
    recordId: entry.recordId ? String(entry.recordId) : undefined,
    oldValues: entry.oldValues,
    newValues: entry.newValues,
    ip: entry.ip,
    userAgent: entry.userAgent,
    at: new Date(),
  };
  if (session) await AuditLog.create([doc], { session });
  else await AuditLog.create(doc);
}

function changed(previous, patch) {
  const oldValues = {};
  const newValues = {};
  Object.keys(patch || {}).forEach((key) => {
    const before = previous?.[key];
    const after = patch[key];
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      oldValues[key] = before instanceof Date ? before.toISOString() : before;
      newValues[key] = after instanceof Date ? after.toISOString() : after;
    }
  });
  return { oldValues, newValues, changed: Object.keys(newValues).length > 0 };
}

async function listAudits(query) {
  const { AuditLog, User } = require('../models');
  const { paging, metaFor, escapeRegex } = require('../utils/http');
  const { page, limit, skip } = paging(query);
  const filter = {};
  if (query.module) filter.module = query.module;
  if (query.action) filter.action = query.action;
  if (query.q) filter.username = { $regex: escapeRegex(query.q), $options: 'i' };
  if (query.startDate || query.endDate) {
    filter.at = {};
    if (query.startDate) filter.at.$gte = new Date(query.startDate);
    if (query.endDate) filter.at.$lte = new Date(query.endDate);
  }
  const [rows, total] = await Promise.all([
    AuditLog.find(filter).sort({ at: -1 }).skip(skip).limit(limit).lean(),
    AuditLog.countDocuments(filter),
  ]);
  return { data: rows, meta: metaFor(page, limit, total), users: User.modelName };
}

module.exports = { recordAudit, changed, listAudits };
