const crypto = require('crypto');
const { SystemSetting } = require('../models');
const { AppError } = require('../utils/http');

const SETTING_KEY = 'leadDeletePasskey';

function generateSixDigit() {
  return String(crypto.randomInt(100000, 1000000));
}

async function getDoc() {
  return SystemSetting.findOne({ key: SETTING_KEY }).lean();
}

async function getStatus(user) {
  const doc = await getDoc();
  const value = doc?.value || null;
  const hasPasskey = Boolean(value?.code);
  const isOwner = user?.role === 'OWNER';
  return {
    data: {
      hasPasskey,
      // Only Owner can see the live code (to share with Super Admin).
      code: isOwner && hasPasskey ? String(value.code) : null,
      createdAt: value?.createdAt || null,
      createdBy: value?.createdBy || null,
    },
  };
}

async function createPasskey(user) {
  if (user.role !== 'OWNER') {
    throw new AppError('Only Owner can create the lead delete passkey', 403);
  }
  const code = generateSixDigit();
  const now = new Date();
  const value = {
    code,
    createdAt: now.toISOString(),
    createdBy: { id: String(user._id), name: user.name, role: user.role },
  };
  await SystemSetting.updateOne(
    { key: SETTING_KEY },
    { key: SETTING_KEY, value, updatedBy: user._id },
    { upsert: true },
  );
  return {
    data: {
      hasPasskey: true,
      code,
      createdAt: value.createdAt,
      createdBy: value.createdBy,
    },
    message: `Passkey created: ${code}. Share this with Super Admin for lead deletes.`,
  };
}

async function assertDeletePasskey(passkey) {
  const doc = await getDoc();
  const expected = doc?.value?.code;
  if (!expected) {
    throw new AppError('Owner must create a delete passkey first', 422);
  }
  const entered = String(passkey || '').trim();
  if (!/^\d{6}$/.test(entered)) {
    throw new AppError('Enter the 6-digit delete passkey', 422);
  }
  if (entered !== String(expected)) {
    throw new AppError('Delete passkey is incorrect', 403);
  }
  return true;
}

module.exports = {
  getStatus,
  createPasskey,
  assertDeletePasskey,
};
