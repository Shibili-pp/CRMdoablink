const jwt = require('jsonwebtoken');
const { User, AndroidDevice } = require('../models');
const { AppError } = require('../utils/http');
const { hashToken } = require('../utils/tokens');
const { permissionsFor } = require('../services/settings');

function validationError(error) {
  return new AppError('Validation failed', 422, error.details.map((detail) => ({
    field: detail.path.join('.'),
    message: detail.message.replace(/"/g, ''),
  })));
}

function validate(schemas) {
  return (req, res, next) => {
    try {
      ['body', 'query', 'params'].forEach((key) => {
        if (!schemas[key]) return;
        const result = schemas[key].validate(req[key], { abortEarly: false, stripUnknown: true, convert: true });
        if (result.error) throw validationError(result.error);
        req[key] = result.value;
      });
      next();
    } catch (error) {
      next(error);
    }
  };
}

function stripOperators(value, seen = new Set()) {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);
  Object.keys(value).forEach((key) => {
    if (key.startsWith('$') || key.includes('.')) {
      throw new AppError('Invalid request field', 400);
    }
    stripOperators(value[key], seen);
  });
}

function sanitize(req, res, next) {
  try {
    stripOperators(req.body);
    stripOperators(req.query);
    stripOperators(req.params);
    next();
  } catch (error) {
    next(error);
  }
}

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new AppError('Authentication required', 401);
    const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    if (payload.type !== 'access') throw new AppError('Authentication required', 401);
    const user = await User.findOne({ _id: payload.sub, deletedAt: null, isActive: true });
    if (!user) throw new AppError('Authentication required', 401);
    if (user.isDemo && process.env.NODE_ENV === 'production') {
      throw new AppError('Demo accounts are disabled in production', 403);
    }
    user.permissions = await permissionsFor(user);
    req.user = user;
    next();
  } catch (error) {
    if (error.isOperational) return next(error);
    return next(new AppError('Authentication required', 401));
  }
}

function requirePermission(...permissions) {
  return (req, res, next) => {
    if (!req.user) return next(new AppError('Authentication required', 401));
    if (req.user.role === 'OWNER') return next();
    const missing = permissions.filter((permission) => !req.user.permissions.includes(permission));
    if (missing.length) return next(new AppError('You do not have permission to perform this action', 403));
    return next();
  };
}

function requireAny(...permissions) {
  return (req, res, next) => {
    if (!req.user) return next(new AppError('Authentication required', 401));
    if (req.user.role === 'OWNER') return next();
    const allowed = permissions.some((permission) => req.user.permissions.includes(permission));
    if (!allowed) return next(new AppError('You do not have permission to perform this action', 403));
    return next();
  };
}

async function requireDevice(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token.startsWith('dev_')) throw new AppError('A registered device token is required', 401);
    const device = await AndroidDevice.findOne({ tokenHash: hashToken(token), status: 'active' });
    if (!device) throw new AppError('This device is not registered or has been revoked', 401);
    const staff = await User.findOne({ _id: device.staff, deletedAt: null, isActive: true });
    if (!staff) throw new AppError('The staff member for this device is not active', 401);
    staff.permissions = await permissionsFor(staff);
    req.device = device;
    req.user = staff;
    device.lastSeenAt = new Date();
    await device.save();
    next();
  } catch (error) {
    next(error.isOperational ? error : new AppError('A registered device token is required', 401));
  }
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const multer = require('multer');
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'File exceeds the 5 MB limit' : err.message;
    return res.status(400).json({ success: false, message, data: null });
  }
  if (err && err.code === 11000) {
    return res.status(409).json({ success: false, message: 'A record with the same unique value already exists', data: null });
  }
  if (err && err.name === 'CastError') {
    return res.status(400).json({ success: false, message: 'Invalid identifier', data: null });
  }
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  return res.status(status).json({
    success: false,
    message: status >= 500 && process.env.NODE_ENV === 'production' ? 'Something went wrong' : err.message,
    errors: err.errors || undefined,
    data: null,
  });
}

module.exports = {
  validate,
  sanitize,
  requireAuth,
  requirePermission,
  requireAny,
  requireDevice,
  errorHandler,
};
