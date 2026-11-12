const { Notification } = require('../models');
const { getIo } = require('../sockets/io');

async function notify(input) {
  try {
    const doc = await Notification.create({
      user: input.user,
      type: input.type,
      title: input.title,
      body: input.body || '',
      module: input.module,
      recordId: input.recordId ? String(input.recordId) : undefined,
      dedupeKey: input.dedupeKey || undefined,
    });
    const io = getIo();
    if (io) {
      io.to(`user:${input.user}`).emit('notification', {
        id: doc.id,
        type: doc.type,
        title: doc.title,
        body: doc.body,
        createdAt: doc.createdAt,
      });
    }
    return doc;
  } catch (error) {
    if (error && error.code === 11000) return null;
    console.error('Notification failed:', error.message);
    return null;
  }
}

async function notifyMany(userIds, input) {
  const unique = [...new Set((userIds || []).filter(Boolean).map(String))];
  await Promise.all(unique.map((userId) => notify({
    ...input,
    user: userId,
    dedupeKey: input.dedupeKey ? `${userId}:${input.dedupeKey}` : undefined,
  })));
}

module.exports = { notify, notifyMany };
