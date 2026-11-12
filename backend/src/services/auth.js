const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, RefreshToken } = require('../models');
const { AppError } = require('../utils/http');
const { hashToken, randomToken } = require('../utils/tokens');
const { recordAudit } = require('./audit');
const { permissionsFor } = require('./settings');

const REFRESH_COOKIE = 'orbit_refresh';

function accessTokenFor(user) {
  return jwt.sign(
    { sub: String(user._id), role: user.role, type: 'access' },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: process.env.JWT_ACCESS_TTL || '15m' }
  );
}

function publicUser(user) {
  return {
    id: user.id || String(user._id),
    username: user.username,
    email: user.email,
    name: user.name,
    phone: user.phone,
    employeeId: user.employeeId,
    role: user.role,
    permissions: user.role === 'OWNER'
      ? user.permissions
      : user.permissions,
    permissionMode: user.permissionMode,
    branch: user.branch,
    team: user.team,
    managedTeams: user.managedTeams || [],
    manager: user.manager,
    joiningDate: user.joiningDate,
    employmentStatus: user.employmentStatus,
    isActive: user.isActive,
    isDemo: Boolean(user.isDemo),
    maxLeadAllocation: user.maxLeadAllocation,
    lastLoginAt: user.lastLoginAt,
  };
}

function cookieOptions() {
  const days = Number(process.env.JWT_REFRESH_DAYS || 7);
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: days * 24 * 60 * 60 * 1000,
    path: '/api/v1/auth',
  };
}

async function issueSession(user, meta, res) {
  const accessToken = accessTokenFor(user);
  const refreshToken = randomToken(48);
  const days = Number(process.env.JWT_REFRESH_DAYS || 7);
  await RefreshToken.create({
    user: user._id,
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(Date.now() + days * 86400000),
    userAgent: meta.userAgent,
    ip: meta.ip,
  });
  if (res) res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions());
  return { accessToken, refreshToken };
}

async function login(body, meta, res) {
  const username = String(body.username || '').toLowerCase().trim();
  const user = await User.findOne({ username, deletedAt: null }).select('+passwordHash');
  const invalid = new AppError('Invalid username or password', 401);
  if (!user) {
    await recordAudit({ action: 'auth.login_failed', module: 'auth', newValues: { username }, ...meta });
    throw invalid;
  }
  if (user.lockUntil && user.lockUntil > new Date()) {
    throw new AppError('This account is temporarily locked after repeated failed sign-ins. Try again later.', 423);
  }
  const matches = await bcrypt.compare(body.password, user.passwordHash);
  if (!matches) {
    user.failedLoginCount = (user.failedLoginCount || 0) + 1;
    if (user.failedLoginCount >= 10) {
      user.lockUntil = new Date(Date.now() + 10 * 60 * 1000);
      user.failedLoginCount = 0;
    }
    await user.save();
    await recordAudit({
      user: user._id, username: user.username, action: 'auth.login_failed', module: 'auth', recordId: user._id, ...meta,
    });
    throw invalid;
  }
  if (user.isDemo && process.env.NODE_ENV === 'production') {
    throw new AppError('Demo accounts are disabled in production', 403);
  }
  if (!user.isActive || user.employmentStatus === 'inactive') {
    throw new AppError('This account is deactivated', 403);
  }
  user.permissions = await permissionsFor(user);
  user.failedLoginCount = 0;
  user.lockUntil = undefined;
  user.lastLoginAt = new Date();
  await user.save();
  await recordAudit({
    user: user._id, username: user.username, action: 'auth.login', module: 'auth', recordId: user._id, ...meta,
  });
  const tokens = await issueSession(user, meta, res);
  return {
    data: { ...tokens, user: publicUser(user) },
    message: 'Signed in',
  };
}

async function refresh(req, res) {
  const token = req.body?.refreshToken || req.cookies?.[REFRESH_COOKIE];
  if (!token) throw new AppError('Refresh token is required', 401);
  const existing = await RefreshToken.findOne({ tokenHash: hashToken(token), revokedAt: null });
  if (!existing || existing.expiresAt < new Date()) throw new AppError('Session expired. Sign in again.', 401);
  const user = await User.findOne({ _id: existing.user, deletedAt: null, isActive: true });
  if (!user) throw new AppError('Session expired. Sign in again.', 401);
  if (user.isDemo && process.env.NODE_ENV === 'production') {
    throw new AppError('Demo accounts are disabled in production', 403);
  }
  user.permissions = await permissionsFor(user);
  const tokens = await issueSession(user, { ip: req.ip, userAgent: req.get('user-agent') || '' }, res);
  existing.revokedAt = new Date();
  existing.replacedByHash = hashToken(tokens.refreshToken);
  await existing.save();
  return { data: { ...tokens, user: publicUser(user) }, message: 'Session refreshed' };
}

async function logout(req, res) {
  const token = req.body?.refreshToken || req.cookies?.[REFRESH_COOKIE];
  if (token) {
    await RefreshToken.updateOne({ tokenHash: hashToken(token) }, { revokedAt: new Date() });
  }
  if (req.user) {
    await recordAudit({
      user: req.user._id, username: req.user.username, action: 'auth.logout', module: 'auth', recordId: req.user._id, ip: req.ip, userAgent: req.get('user-agent'),
    });
  }
  res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  return { data: null, message: 'Signed out' };
}

async function me(user) {
  const fresh = await User.findById(user._id)
    .populate('branch', 'name code')
    .populate('team', 'name code')
    .populate('manager', 'name role');
  if (!fresh || !fresh.isActive || fresh.deletedAt) throw new AppError('Account not available', 401);
  fresh.permissions = await permissionsFor(fresh);
  return { data: publicUser(fresh) };
}

async function changePassword(user, body, meta) {
  const full = await User.findById(user._id).select('+passwordHash');
  const matches = await bcrypt.compare(body.currentPassword, full.passwordHash);
  if (!matches) throw new AppError('Current password is incorrect', 400);
  full.passwordHash = await bcrypt.hash(body.newPassword, 10);
  await full.save();
  await RefreshToken.updateMany({ user: user._id, revokedAt: null }, { revokedAt: new Date() });
  await recordAudit({
    user: user._id, username: user.username, action: 'auth.password', module: 'auth', recordId: user._id, ...meta,
  });
  return { data: null, message: 'Password updated. Sign in again on other devices.' };
}

module.exports = {
  login,
  refresh,
  logout,
  me,
  changePassword,
  publicUser,
  REFRESH_COOKIE,
};
