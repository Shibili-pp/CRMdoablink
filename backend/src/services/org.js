const bcrypt = require('bcryptjs');
const {
  User, Branch, Team, LeaveRequest, FollowUp,
} = require('../models');
const { AppError, paging, metaFor, escapeRegex, sortFrom } = require('../utils/http');
const { normalizePhone, isValidPhone } = require('../utils/phone');
const { recordAudit } = require('./audit');
const { notify } = require('./notify');
const { roleTemplate } = require('./settings');
const { canManageRole, staffScope, combine, isElevated, hasPermission } = require('./access');
const { publicUser } = require('./auth');
const { getGeneral } = require('./settings');

async function listUsers(actor, query) {
  const { page, limit, skip } = paging(query);
  const filter = { deletedAt: null, ...staffScope(actor) };
  if (actor.role === 'ADMIN') filter.role = { $in: ['ADMIN', 'TEAM_LEADER', 'STAFF'] };
  if (query.role) filter.role = query.role;
  if (query.team) filter.team = query.team;
  if (query.branch) filter.branch = query.branch;
  if (query.q) {
    const q = escapeRegex(query.q);
    filter.$or = [
      { name: { $regex: q, $options: 'i' } },
      { username: { $regex: q, $options: 'i' } },
      { email: { $regex: q, $options: 'i' } },
      { employeeId: { $regex: q, $options: 'i' } },
    ];
  }
  if (query.employmentStatus) filter.employmentStatus = query.employmentStatus;
  const sort = sortFrom(query, ['name', 'createdAt', 'role', 'employeeId'], 'name');
  const [rows, total] = await Promise.all([
    User.find(filter).sort(sort).skip(skip).limit(limit)
      .populate('branch', 'name code')
      .populate('team', 'name code')
      .populate('manager', 'name role')
      .lean(),
    User.countDocuments(filter),
  ]);
  return { data: rows.map(publicUser), meta: metaFor(page, limit, total) };
}

async function getUser(actor, id) {
  const user = await User.findOne({ _id: id, deletedAt: null, ...staffScope(actor) })
    .populate('branch', 'name code')
    .populate('team', 'name code')
    .populate('manager', 'name role');
  if (!user) throw new AppError('Staff member not found', 404);
  if (actor.role === 'ADMIN' && (user.role === 'OWNER' || user.role === 'SUPER_ADMIN')) {
    throw new AppError('Staff member not found', 404);
  }
  return { data: publicUser(user) };
}

async function createUser(actor, body, meta) {
  if (!canManageRole(actor.role, body.role)) {
    throw new AppError('You can only create users below your role', 403);
  }
  const general = await getGeneral();
  const phoneNormalized = body.phone ? normalizePhone(body.phone, general.countryCode) : '';
  if (body.phone && !isValidPhone(phoneNormalized)) throw new AppError('Enter a valid phone number', 422);
  const username = body.username.toLowerCase().trim();
  const email = (body.email || `${username}@users.doablinkorbit.local`).toLowerCase().trim();
  const name = (body.name || username).trim();
  const taken = await User.findOne({ $or: [{ username }, { email }], deletedAt: null }).select('username email');
  if (taken) throw new AppError(taken.username === username ? 'That user ID is already used' : 'That email is already used', 409);
  let branch = body.branch || null;
  let team = body.team || null;
  if (!isElevated(actor)) {
    branch = actor.branch;
    if (actor.role === 'TEAM_LEADER') team = actor.team;
  }
  if (team) {
    const teamDoc = await Team.findOne({ _id: team, deletedAt: null });
    if (!teamDoc) throw new AppError('Team not found', 404);
    if (branch && String(teamDoc.branch) !== String(branch)) throw new AppError('Team does not belong to that branch', 422);
    branch = branch || teamDoc.branch;
  }
  const permissions = await roleTemplate(body.role);
  const user = await User.create({
    username,
    email,
    passwordHash: await bcrypt.hash(body.password, 10),
    name,
    phone: body.phone || '',
    phoneNormalized,
    employeeId: body.employeeId || undefined,
    role: body.role,
    permissions,
    permissionMode: 'role',
    branch,
    team,
    manager: body.manager || (actor.role === 'TEAM_LEADER' ? actor._id : body.manager),
    joiningDate: body.joiningDate || new Date(),
    employmentStatus: 'active',
    isActive: true,
    isDemo: false,
    maxLeadAllocation: body.maxLeadAllocation || 50,
  });
  await recordAudit({
    user: actor._id, username: actor.username, action: 'user.create', module: 'users', recordId: user.id,
    newValues: { username: user.username, role: user.role, team, branch }, ...meta,
  });
  return { data: publicUser(user), message: 'User created', status: 201 };
}

async function updateUser(actor, id, body, meta) {
  const user = await User.findOne({ _id: id, deletedAt: null });
  if (!user) throw new AppError('Staff member not found', 404);
  if (user.role === 'OWNER' && actor.role !== 'OWNER') throw new AppError('Staff member not found', 404);
  if (!isElevated(actor) && String(user.branch || '') !== String(actor.branch || '')) {
    throw new AppError('Staff member not found', 404);
  }
  if (body.role && body.role !== user.role && !canManageRole(actor.role, body.role)) {
    throw new AppError('You cannot assign that role', 403);
  }
  if (body.role && !canManageRole(actor.role, user.role) && String(user._id) !== String(actor._id)) {
    throw new AppError('You cannot edit this user', 403);
  }
  if ((body.username || body.password) && !canManageRole(actor.role, user.role)) {
    throw new AppError('You cannot change this login', 403);
  }
  const previous = publicUser(user);
  const general = await getGeneral();
  if (body.name) user.name = body.name.trim();
  if (body.username && body.username.toLowerCase().trim() !== user.username) {
    const username = body.username.toLowerCase().trim();
    const taken = await User.findOne({ username, _id: { $ne: user._id }, deletedAt: null });
    if (taken) throw new AppError('That user ID is already used', 409);
    user.username = username;
  }
  if (body.email) user.email = body.email.toLowerCase().trim();
  if (body.phone !== undefined) {
    const phoneNormalized = body.phone ? normalizePhone(body.phone, general.countryCode) : '';
    if (body.phone && !isValidPhone(phoneNormalized)) throw new AppError('Enter a valid phone number', 422);
    user.phone = body.phone;
    user.phoneNormalized = phoneNormalized;
  }
  if (body.employeeId !== undefined) user.employeeId = body.employeeId || undefined;
  if (body.role && body.role !== user.role) {
    user.role = body.role;
    if (user.permissionMode === 'role') user.permissions = await roleTemplate(body.role);
  }
  if (isElevated(actor) || actor.role === 'ADMIN') {
    if (body.branch) user.branch = body.branch;
    if (body.team !== undefined) user.team = body.team || null;
    if (body.manager !== undefined) user.manager = body.manager || null;
    if (body.managedTeams) user.managedTeams = body.managedTeams;
  }
  if (body.employmentStatus) user.employmentStatus = body.employmentStatus;
  if (body.maxLeadAllocation != null) user.maxLeadAllocation = body.maxLeadAllocation;
  if (body.joiningDate) user.joiningDate = body.joiningDate;
  if (body.password) user.passwordHash = await bcrypt.hash(body.password, 10);
  await user.save();
  await recordAudit({
    user: actor._id, username: actor.username, action: 'user.update', module: 'users', recordId: user.id,
    oldValues: previous, newValues: publicUser(user), ...meta,
  });
  return { data: publicUser(user), message: 'User updated' };
}

async function setActive(actor, id, active, meta) {
  const user = await User.findOne({ _id: id, deletedAt: null });
  if (!user) throw new AppError('Staff member not found', 404);
  if (String(user._id) === String(actor._id)) throw new AppError('You cannot change your own access', 400);
  if (!canManageRole(actor.role, user.role)) throw new AppError('You cannot change this user', 403);
  if (!active && user.role === 'OWNER') {
    const owners = await User.countDocuments({ role: 'OWNER', isActive: true, deletedAt: null });
    if (owners <= 1) throw new AppError('The last active owner cannot be deactivated', 400);
  }
  user.isActive = active;
  user.employmentStatus = active ? 'active' : 'inactive';
  if (!active) user.deletedAt = null;
  await user.save();
  await recordAudit({
    user: actor._id, username: actor.username, action: active ? 'user.activate' : 'user.deactivate',
    module: 'users', recordId: user.id, newValues: { isActive: active }, ...meta,
  });
  return { data: publicUser(user), message: active ? 'User activated' : 'User deactivated' };
}

async function setPermissions(actor, id, permissions, meta) {
  const user = await User.findOne({ _id: id, deletedAt: null });
  if (!user) throw new AppError('Staff member not found', 404);
  if (user.role === 'OWNER') throw new AppError('Owner permissions cannot be reduced', 400);
  if (!canManageRole(actor.role, user.role)) throw new AppError('You cannot change this user', 403);
  const { ALL_PERMISSIONS } = require('../config/permissions');
  user.permissionMode = 'custom';
  user.permissions = [...new Set(permissions.filter((key) => ALL_PERMISSIONS.includes(key)))];
  await user.save();
  await recordAudit({
    user: actor._id, username: actor.username, action: 'user.permissions', module: 'users', recordId: user.id,
    newValues: { permissions: user.permissions }, ...meta,
  });
  return { data: publicUser(user), message: 'Permissions updated' };
}

async function listBranches(actor) {
  const filter = { deletedAt: null };
  if (!isElevated(actor)) filter._id = actor.branch;
  const rows = await Branch.find(filter).sort({ name: 1 }).lean();
  return { data: rows };
}

async function saveBranch(actor, body, meta, id) {
  const payload = {
    name: body.name.trim(),
    code: body.code.toUpperCase().trim(),
    city: body.city || '',
    state: body.state || '',
    country: body.country || 'India',
    phone: body.phone || '',
    isActive: body.isActive !== false,
  };
  const doc = id
    ? await Branch.findOneAndUpdate({ _id: id, deletedAt: null }, payload, { new: true })
    : await Branch.create(payload);
  if (!doc) throw new AppError('Branch not found', 404);
  await recordAudit({
    user: actor._id, username: actor.username, action: id ? 'branch.update' : 'branch.create', module: 'branches', recordId: doc.id, newValues: payload, ...meta,
  });
  return { data: doc, message: id ? 'Branch updated' : 'Branch created', status: id ? 200 : 201 };
}

async function archiveBranch(actor, id, meta) {
  const doc = await Branch.findOneAndUpdate({ _id: id, deletedAt: null }, { deletedAt: new Date(), isActive: false }, { new: true });
  if (!doc) throw new AppError('Branch not found', 404);
  await recordAudit({
    user: actor._id, username: actor.username, action: 'branch.archive', module: 'branches', recordId: id, ...meta,
  });
  return { data: doc, message: 'Branch archived' };
}

async function listTeams(actor, query) {
  const filter = { deletedAt: null };
  if (!isElevated(actor)) filter.branch = actor.branch;
  if (query.branch && isElevated(actor)) filter.branch = query.branch;
  const rows = await Team.find(filter).populate('branch', 'name code').populate('leader', 'name role').sort({ name: 1 }).lean();
  return { data: rows };
}

async function saveTeam(actor, body, meta, id) {
  let branch = body.branch;
  if (!isElevated(actor)) branch = actor.branch;
  const payload = {
    name: body.name.trim(),
    code: body.code.toUpperCase().trim(),
    branch,
    leader: body.leader || null,
    description: body.description || '',
    isActive: body.isActive !== false,
  };
  const doc = id
    ? await Team.findOneAndUpdate({ _id: id, deletedAt: null, ...(isElevated(actor) ? {} : { branch: actor.branch }) }, payload, { new: true })
    : await Team.create(payload);
  if (!doc) throw new AppError('Team not found', 404);
  if (payload.leader) await User.updateOne({ _id: payload.leader }, { team: doc._id, branch });
  await recordAudit({
    user: actor._id, username: actor.username, action: id ? 'team.update' : 'team.create', module: 'teams', recordId: doc.id, newValues: payload, ...meta,
  });
  return { data: doc, message: id ? 'Team updated' : 'Team created', status: id ? 200 : 201 };
}

async function transferStaff(actor, teamId, body, meta) {
  const team = await Team.findOne({ _id: teamId, deletedAt: null });
  if (!team) throw new AppError('Team not found', 404);
  if (!isElevated(actor) && String(team.branch) !== String(actor.branch)) throw new AppError('Team not found', 404);
  const user = await User.findOne({ _id: body.staffId, deletedAt: null });
  if (!user) throw new AppError('Staff member not found', 404);
  if (!canManageRole(actor.role, user.role) && String(user._id) !== String(actor._id)) {
    throw new AppError('You cannot transfer this user', 403);
  }
  const previous = { team: user.team, branch: user.branch };
  user.team = team._id;
  user.branch = team.branch;
  await user.save();
  await recordAudit({
    user: actor._id, username: actor.username, action: 'staff.transfer', module: 'teams', recordId: user.id,
    oldValues: previous, newValues: { team: team.id, branch: team.branch }, ...meta,
  });
  return { data: publicUser(user), message: 'Staff member transferred' };
}

async function listLeaves(actor, query) {
  const { page, limit, skip } = paging(query);
  const scope = actor.role === 'STAFF' || !hasPermission(actor, 'leaves.review')
    ? { staff: actor._id }
    : staffScope(actor);
  const filter = combine({}, scope);
  if (query.status) filter.status = query.status;
  const [rows, total] = await Promise.all([
    LeaveRequest.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('staff', 'name employeeId role').lean(),
    LeaveRequest.countDocuments(filter),
  ]);
  return { data: rows, meta: metaFor(page, limit, total) };
}

async function applyLeave(actor, body, meta) {
  if (new Date(body.endDate) < new Date(body.startDate)) throw new AppError('End date is before the start date', 422);
  const leave = await LeaveRequest.create({
    staff: actor._id,
    team: actor.team,
    branch: actor.branch,
    startDate: body.startDate,
    endDate: body.endDate,
    type: body.type,
    reason: body.reason || '',
  });
  if (actor.manager) {
    await notify({
      user: actor.manager, type: 'leave_request', title: 'Leave request', body: `${actor.name} requested leave`, module: 'leaves', recordId: leave.id,
    });
  }
  await recordAudit({
    user: actor._id, username: actor.username, action: 'leave.apply', module: 'leaves', recordId: leave.id, newValues: body, ...meta,
  });
  return { data: leave, message: 'Leave request submitted', status: 201 };
}

async function reviewLeave(actor, id, body, meta) {
  const leave = await LeaveRequest.findById(id);
  if (!leave || leave.status !== 'pending') throw new AppError('Leave request not found', 404);
  const staff = await User.findById(leave.staff);
  if (!staff) throw new AppError('Leave request not found', 404);
  if (!isElevated(actor) && String(staff.branch || '') !== String(actor.branch || '')) {
    throw new AppError('Leave request not found', 404);
  }
  leave.status = body.status;
  leave.reviewNote = body.reviewNote || '';
  leave.reviewedBy = actor._id;
  leave.reviewedAt = new Date();
  await leave.save();
  if (body.status === 'approved') {
    const today = new Date();
    if (leave.startDate <= today && leave.endDate >= today) {
      staff.employmentStatus = 'on_leave';
      await staff.save();
    }
  }
  await notify({
    user: staff._id,
    type: 'leave_review',
    title: `Leave ${body.status}`,
    body: leave.reviewNote || `Your leave request was ${body.status}`,
    module: 'leaves',
    recordId: leave.id,
  });
  await recordAudit({
    user: actor._id, username: actor.username, action: 'leave.review', module: 'leaves', recordId: leave.id, newValues: { status: body.status }, ...meta,
  });
  const urgentFollowUps = body.status === 'approved'
    ? await FollowUp.countDocuments({ assignedTo: staff._id, status: 'pending', dueAt: { $lte: leave.endDate } })
    : 0;
  return {
    data: { leave, urgentFollowUps },
    message: urgentFollowUps
      ? `Leave ${body.status}. ${urgentFollowUps} pending follow-ups can be reassigned.`
      : `Leave ${body.status}`,
  };
}

async function staffOnLeave(date = new Date()) {
  const rows = await LeaveRequest.find({
    status: 'approved',
    startDate: { $lte: date },
    endDate: { $gte: date },
  }).distinct('staff');
  return new Set(rows.map(String));
}

module.exports = {
  listUsers,
  getUser,
  createUser,
  updateUser,
  setActive,
  setPermissions,
  listBranches,
  saveBranch,
  archiveBranch,
  listTeams,
  saveTeam,
  transferStaff,
  listLeaves,
  applyLeave,
  reviewLeave,
  staffOnLeave,
};
