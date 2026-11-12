const { Notification, User } = require('../models');
const { paging, metaFor, AppError } = require('../utils/http');
const { notifyMany } = require('./notify');
const { recordAudit } = require('./audit');

async function list(user, query) {
  const { page, limit, skip } = paging(query);
  const filter = { user: user._id };
  if (query.read === 'false') filter.readAt = null;
  if (query.read === 'true') filter.readAt = { $ne: null };
  if (query.type) filter.type = query.type;
  const [rows, total, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ user: user._id, readAt: null }),
  ]);
  return { data: rows, meta: { ...metaFor(page, limit, total), unread } };
}

async function markRead(user, id) {
  const row = await Notification.findOneAndUpdate({ _id: id, user: user._id }, { readAt: new Date() }, { new: true });
  if (!row) throw new AppError('Notification not found', 404);
  return { data: row, message: 'Notification marked read' };
}

async function markAll(user) {
  await Notification.updateMany({ user: user._id, readAt: null }, { readAt: new Date() });
  return { data: null, message: 'All notifications marked read' };
}

async function announce(user, body, meta) {
  const filter = { isActive: true, deletedAt: null };
  if (body.role) filter.role = body.role;
  if (body.branch) filter.branch = body.branch;
  const people = await User.find(filter).select('_id');
  await notifyMany(people.map((person) => person._id), {
    type: 'announcement',
    title: body.title,
    body: body.body,
    module: 'notifications',
    dedupeKey: `announce:${user._id}:${Date.now()}`,
  });
  await recordAudit({
    user: user._id, username: user.username, action: 'notification.announce', module: 'notifications',
    newValues: { title: body.title, recipients: people.length }, ...meta,
  });
  return { data: { recipients: people.length }, message: 'Announcement sent' };
}

module.exports = { list, markRead, markAll, announce };
