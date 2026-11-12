class AppError extends Error {
  constructor(message, status = 500, errors = null) {
    super(message);
    this.status = status;
    this.errors = errors;
    this.isOperational = true;
  }
}

function sendSuccess(res, { status = 200, message = 'OK', data = null, meta } = {}) {
  const body = { success: true, message, data };
  if (meta) body.meta = meta;
  return res.status(status).json(body);
}

function sendFailure(res, status, message, errors) {
  const body = { success: false, message, data: null };
  if (errors) body.errors = errors;
  return res.status(status).json(body);
}

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function metaOf(req) {
  return {
    ip: req.ip,
    userAgent: req.get('user-agent') || '',
  };
}

function paging(query) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  return { page, limit, skip: (page - 1) * limit };
}

function metaFor(page, limit, total) {
  return { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sortFrom(query, allowed, fallback = 'createdAt') {
  const field = allowed.includes(query.sort) ? query.sort : fallback;
  const direction = query.order === 'asc' ? 1 : -1;
  return { [field]: direction };
}

function clean(value) {
  if (value === undefined || value === null || value === '') return undefined;
  return value;
}

module.exports = {
  AppError,
  sendSuccess,
  sendFailure,
  asyncHandler,
  metaOf,
  paging,
  metaFor,
  escapeRegex,
  sortFrom,
  clean,
};
