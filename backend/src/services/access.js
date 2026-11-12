const { ROLE_RANK } = require('../config/constants');

function isElevated(user) {
  return user && (user.role === 'OWNER' || user.role === 'SUPER_ADMIN');
}

function canManageRole(actorRole, targetRole) {
  return (ROLE_RANK[actorRole] || 0) > (ROLE_RANK[targetRole] || 0);
}

function hasPermission(user, permission) {
  if (!user) return false;
  if (user.role === 'OWNER') return true;
  return Array.isArray(user.permissions) && user.permissions.includes(permission);
}

function leadScope(user) {
  if (isElevated(user)) return {};
  if (user.role === 'ADMIN') return { branch: user.branch };
  if (user.role === 'TEAM_LEADER') return { team: user.team };
  return { assignedTo: user._id };
}

function bucketScope(user) {
  if (isElevated(user)) return { assignedTo: null };
  if (user.role === 'ADMIN' || user.role === 'TEAM_LEADER') return { assignedTo: null, branch: user.branch };
  return { _id: null };
}

function staffScope(user) {
  if (isElevated(user)) return {};
  if (user.role === 'ADMIN') return { branch: user.branch };
  if (user.role === 'TEAM_LEADER') return { team: user.team };
  return { _id: user._id };
}

function recordScope(user, fields = {}) {
  const staffField = fields.staff || 'assignedTo';
  const teamField = fields.team || 'team';
  const branchField = fields.branch || 'branch';
  if (isElevated(user)) return {};
  if (user.role === 'ADMIN') return { [branchField]: user.branch };
  if (user.role === 'TEAM_LEADER') return { [teamField]: user.team };
  return { [staffField]: user._id };
}

function combine(base, scope) {
  const left = base || {};
  if (!scope || Object.keys(scope).length === 0) return left;
  return { $and: [left, scope] };
}

module.exports = {
  isElevated,
  canManageRole,
  hasPermission,
  leadScope,
  bucketScope,
  staffScope,
  recordScope,
  combine,
};
