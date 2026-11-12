const {
  Lead, LeadAssignment, LeadActivity, LeadSwapRequest, User, Team, Counter, Payment,
} = require('../models');
const { AppError, paging, metaFor, escapeRegex, sortFrom, clean } = require('../utils/http');
const { normalizePhone, isValidPhone, formatPhone } = require('../utils/phone');
const { recordAudit, changed } = require('./audit');
const { notify, notifyMany } = require('./notify');
const { addActivity, statusLabel } = require('./activity');
const { getGeneral, getLeadSources, activeStatuses } = require('./settings');
const {
  leadScope, bucketScope, staffScope, combine, isElevated, hasPermission,
} = require('./access');
const { staffOnLeave } = require('./org');
const { LOST_STATUSES } = require('../config/constants');
const { dateKeyOf, dayBounds } = require('../utils/time');

const LEAD_SORT = ['createdAt', 'name', 'expectedRevenue', 'status', 'priority', 'followUpAt', 'leadCode', 'lastContactedAt', 'assignmentDate'];
const STAFF_FIELDS = ['status', 'nextActionTitle', 'nextActionDueAt', 'notes', 'lostReason', 'tags', 'followUpAt', 'priority', 'quality'];

async function nextLeadCode() {
  await Counter.updateOne({ _id: 'lead' }, { $setOnInsert: { seq: 10000 } }, { upsert: true });
  const counter = await Counter.findOneAndUpdate({ _id: 'lead' }, { $inc: { seq: 1 } }, { new: true });
  return `ORB-${String(counter.seq).padStart(5, '0')}`;
}

function presentLead(lead) {
  if (!lead) return null;
  const created = new Date(lead.createdAt);
  const ageDays = Math.max(0, Math.floor((Date.now() - created.getTime()) / 86400000));
  return {
    ...lead,
    id: lead.id || lead._id,
    phoneDisplay: formatPhone(lead.phoneNormalized),
    alternatePhoneDisplay: formatPhone(lead.alternatePhoneNormalized),
    ageDays,
  };
}

async function buildLeadFilter(user, query, { bucket = false } = {}) {
  const scope = bucket ? bucketScope(user) : leadScope(user);
  const filter = { deletedAt: null };
  if (query.q) {
    const q = escapeRegex(query.q.trim());
    const digits = query.q.replace(/\D/g, '');
    const or = [
      { name: { $regex: q, $options: 'i' } },
      { leadCode: { $regex: q, $options: 'i' } },
      { company: { $regex: q, $options: 'i' } },
    ];
    if (digits) or.push({ phoneNormalized: { $regex: escapeRegex(digits) } });
    filter.$or = or;
  }
  ['status', 'source', 'priority', 'district', 'category'].forEach((key) => {
    if (clean(query[key])) filter[key] = query[key];
  });
  if (clean(query.staff)) filter.assignedTo = query.staff;
  if (clean(query.team)) filter.team = query.team;
  if (clean(query.branch) && isElevated(user)) filter.branch = query.branch;
  if (query.bucket === 'unassigned') filter.assignedTo = null;
  if (query.bucket === 'assigned') filter.assignedTo = { $ne: null };
  if (query.assignedFrom || query.assignedTo) {
    const fromKey = dateKeyOf(query.assignedFrom, 'Asia/Kolkata');
    const toKey = dateKeyOf(query.assignedTo, 'Asia/Kolkata');
    if (fromKey || toKey) {
      const startKey = fromKey && toKey && fromKey > toKey ? toKey : (fromKey || toKey);
      const endKey = fromKey && toKey && fromKey > toKey ? fromKey : (toKey || fromKey);
      filter.assignmentDate = {
        $gte: dayBounds(startKey, 'Asia/Kolkata').start,
        $lt: dayBounds(endKey, 'Asia/Kolkata').end,
      };
    }
  }
  if (query.dateFrom || query.dateTo) {
    filter.createdAt = {};
    if (query.dateFrom) filter.createdAt.$gte = new Date(query.dateFrom);
    if (query.dateTo) filter.createdAt.$lte = new Date(query.dateTo);
  }
  if (query.revenueMin != null || query.revenueMax != null) {
    filter.expectedRevenue = {};
    if (query.revenueMin != null) filter.expectedRevenue.$gte = Number(query.revenueMin);
    if (query.revenueMax != null) filter.expectedRevenue.$lte = Number(query.revenueMax);
  }
  return combine(filter, scope);
}

async function list(user, query) {
  const bucket = query.view === 'bucket';
  const { page, limit, skip } = paging(query);
  const filter = await buildLeadFilter(user, query, { bucket });
  const sort = sortFrom(query, LEAD_SORT);
  const [rows, total] = await Promise.all([
    Lead.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate('assignedTo', 'name employeeId role')
      .populate('team', 'name code')
      .populate('branch', 'name code')
      .lean(),
    Lead.countDocuments(filter),
  ]);
  return { data: rows.map(presentLead), meta: metaFor(page, limit, total) };
}

async function findInScope(user, id, { bucket = false } = {}) {
  const scope = bucket ? bucketScope(user) : leadScope(user);
  const lead = await Lead.findOne({ _id: id, deletedAt: null, ...scope });
  if (!lead) throw new AppError('Lead not found', 404);
  return lead;
}

async function getById(user, id) {
  const scope = leadScope(user);
  const lead = await Lead.findOne({ _id: id, deletedAt: null, ...scope })
    .populate('assignedTo', 'name employeeId role phone')
    .populate('team', 'name code')
    .populate('branch', 'name code')
    .populate('createdBy', 'name role');
  if (!lead) throw new AppError('Lead not found', 404);
  return { data: presentLead(lead.toObject()) };
}

async function assertStatus(status) {
  const statuses = await activeStatuses();
  const match = statuses.find((item) => item.key === status);
  if (!match) throw new AppError('Unknown lead status', 422);
  return match;
}

async function preparePhones(body, countryCode) {
  const phoneNormalized = normalizePhone(body.phone, countryCode);
  if (!isValidPhone(phoneNormalized)) throw new AppError('Enter a valid phone number', 422);
  let alternatePhoneNormalized = '';
  if (body.alternatePhone) {
    alternatePhoneNormalized = normalizePhone(body.alternatePhone, countryCode);
    if (!isValidPhone(alternatePhoneNormalized)) throw new AppError('Enter a valid alternate phone number', 422);
  }
  return { phoneNormalized, alternatePhoneNormalized };
}

async function create(user, body, meta) {
  const general = await getGeneral();
  const sources = await getLeadSources();
  if (!sources.includes(body.source)) throw new AppError('Choose a configured lead source', 422);
  await assertStatus(body.status || 'fresh');
  const phones = await preparePhones(body, general.countryCode);
  let assignedTo = body.assignedTo || null;
  let team = body.team || null;
  let branch = body.branch || user.branch || null;
  if (user.role === 'STAFF') {
    assignedTo = user._id;
    team = user.team;
    branch = user.branch;
  } else if (user.role === 'TEAM_LEADER' && !assignedTo) {
    team = team || user.team;
    branch = user.branch;
  } else if (!isElevated(user)) {
    branch = user.branch;
  }
  if (assignedTo) {
    const staff = await User.findOne({ _id: assignedTo, deletedAt: null, isActive: true });
    if (!staff) throw new AppError('Assigned staff member was not found', 422);
    if (!isElevated(user) && String(staff.branch || '') !== String(user.branch || '')) {
      throw new AppError('You can only assign staff in your branch', 403);
    }
    team = staff.team || team;
    branch = staff.branch || branch;
  }
  const lead = await Lead.create({
    leadCode: await nextLeadCode(),
    name: body.name.trim(),
    phone: body.phone,
    phoneNormalized: phones.phoneNormalized,
    alternatePhone: body.alternatePhone || '',
    alternatePhoneNormalized: phones.alternatePhoneNormalized,
    email: body.email || '',
    company: body.company || '',
    district: body.district || '',
    city: body.city || '',
    state: body.state || '',
    country: body.country || 'India',
    source: body.source,
    category: body.category || '',
    priority: body.priority || 'medium',
    quality: body.quality || '',
    assignedTo,
    team,
    branch,
    createdBy: user._id,
    assignmentDate: assignedTo ? new Date() : null,
    status: body.status || 'fresh',
    statusChangedAt: new Date(),
    nextActionTitle: body.nextActionTitle || '',
    nextActionDueAt: body.nextActionDueAt || null,
    expectedRevenue: body.expectedRevenue || 0,
    revenueProbability: body.revenueProbability || 0,
    followUpAt: body.followUpAt || body.nextActionDueAt || null,
    notes: body.notes || '',
    lostReason: body.lostReason || '',
    tags: body.tags || [],
    bucketStatus: assignedTo ? 'assigned' : 'unassigned',
  });
  await addActivity({
    lead, type: 'lead_created', actor: user,
    description: `Lead ${lead.leadCode} created`,
    newValue: { status: lead.status, source: lead.source },
  });
  if (assignedTo) {
    await LeadAssignment.create({
      lead: lead._id, toStaff: assignedTo, toTeam: team, assignedBy: user._id, reason: 'Created with an owner', mode: 'create',
    });
    await addActivity({
      lead, type: 'lead_assigned', actor: user, description: 'Lead assigned at creation', newValue: { assignedTo },
    });
    await notify({
      user: assignedTo, type: 'lead_assigned', title: 'New lead assigned', body: `${lead.name} (${lead.leadCode}) is now assigned to you`,
      module: 'leads', recordId: lead.id,
    });
  }
  await recordAudit({
    user: user._id, username: user.username, action: 'lead.create', module: 'leads', recordId: lead.id,
    newValues: { leadCode: lead.leadCode, name: lead.name, phoneNormalized: lead.phoneNormalized }, ...meta,
  });
  return { data: presentLead(lead.toObject()), message: 'Lead created', status: 201 };
}

async function update(user, id, body, meta) {
  const lead = await findInScope(user, id);
  const general = await getGeneral();
  const patch = {};
  const editable = user.role === 'STAFF' ? STAFF_FIELDS : null;
  const assignKeys = ['assignedTo', 'team', 'branch'];
  Object.keys(body).forEach((key) => {
    if (body[key] === undefined) return;
    if (editable && !editable.includes(key)) return;
    if (assignKeys.includes(key) && !hasPermission(user, 'leads.assign') && user.role !== 'OWNER') return;
    patch[key] = body[key];
  });
  if (patch.phone || patch.alternatePhone !== undefined) {
    const phones = await preparePhones({
      phone: patch.phone || lead.phone,
      alternatePhone: patch.alternatePhone !== undefined ? patch.alternatePhone : lead.alternatePhone,
    }, general.countryCode);
    if (patch.phone) patch.phoneNormalized = phones.phoneNormalized;
    if (patch.alternatePhone !== undefined) patch.alternatePhoneNormalized = phones.alternatePhoneNormalized;
  }
  if (patch.source) {
    const sources = await getLeadSources();
    if (!sources.includes(patch.source)) throw new AppError('Choose a configured lead source', 422);
  }
  let statusMeta = null;
  if (patch.status && patch.status !== lead.status) {
    statusMeta = await assertStatus(patch.status);
    if (LOST_STATUSES.includes(patch.status) || statusMeta.category === 'lost') {
      if (!patch.lostReason && !lead.lostReason) throw new AppError('A lost reason is required', 422);
    }
    patch.statusChangedAt = new Date();
  }
  if (patch.assignedTo && String(patch.assignedTo) !== String(lead.assignedTo || '')) {
    const staff = await User.findOne({ _id: patch.assignedTo, isActive: true, deletedAt: null });
    if (!staff) throw new AppError('Assigned staff member was not found', 422);
    patch.team = staff.team;
    patch.branch = staff.branch || lead.branch;
    patch.assignmentDate = new Date();
    patch.bucketStatus = 'assigned';
  }
  const diff = changed(lead.toObject(), patch);
  Object.assign(lead, patch);
  if (patch.tags) lead.tags = patch.tags;
  await lead.save();
  if (patch.status && diff.oldValues.status) {
    const from = await statusLabel(diff.oldValues.status);
    const to = await statusLabel(patch.status);
    const type = patch.status === 'demo_completed'
      ? 'demo_completed'
      : patch.status === 'onboarded'
        ? 'onboarding_completed'
        : 'status_changed';
    await addActivity({
      lead, type, actor: user,
      description: `Status changed from ${from} to ${to}`,
      oldValue: diff.oldValues.status, newValue: patch.status,
    });
  }
  if (patch.assignedTo && diff.oldValues.assignedTo !== undefined) {
    await LeadAssignment.create({
      lead: lead._id,
      fromStaff: diff.oldValues.assignedTo || null,
      toStaff: patch.assignedTo,
      assignedBy: user._id,
      reason: body.reason || 'Reassigned from the lead form',
      mode: 'manual',
    });
    await addActivity({
      lead, type: 'lead_reassigned', actor: user, description: 'Lead reassigned',
      oldValue: diff.oldValues.assignedTo, newValue: patch.assignedTo,
    });
    await notify({
      user: patch.assignedTo, type: 'lead_assigned', title: 'Lead reassigned to you',
      body: `${lead.name} (${lead.leadCode})`, module: 'leads', recordId: lead.id,
    });
  }
  if (patch.expectedRevenue != null && diff.changed) {
    await addActivity({
      lead, type: 'revenue_updated', actor: user, description: 'Expected revenue updated',
      oldValue: diff.oldValues.expectedRevenue, newValue: patch.expectedRevenue,
    });
  }
  if (diff.changed) {
    await recordAudit({
      user: user._id, username: user.username, action: 'lead.update', module: 'leads', recordId: lead.id,
      oldValues: diff.oldValues, newValues: diff.newValues, ...meta,
    });
  }
  return { data: presentLead(lead.toObject()), message: 'Lead updated' };
}

async function remove(user, id, meta) {
  const lead = await findInScope(user, id);
  lead.deletedAt = new Date();
  await lead.save();
  await recordAudit({
    user: user._id, username: user.username, action: 'lead.delete', module: 'leads', recordId: lead.id,
    oldValues: { leadCode: lead.leadCode, name: lead.name }, ...meta,
  });
  return { data: null, message: 'Lead archived' };
}

async function addNote(user, id, body, meta) {
  const lead = await findInScope(user, id);
  const previous = lead.notes || '';
  lead.notes = body.text.trim();
  await lead.save();
  await addActivity({
    lead, type: 'note_added', actor: user, description: body.text.trim(), oldValue: previous, newValue: lead.notes,
  });
  await recordAudit({
    user: user._id, username: user.username, action: 'lead.note', module: 'leads', recordId: lead.id,
    newValues: { notes: lead.notes }, ...meta,
  });
  return { data: presentLead(lead.toObject()), message: 'Note added' };
}

async function timeline(user, id, query) {
  await findInScope(user, id);
  const { page, limit, skip } = paging(query);
  const filter = { lead: id };
  const [rows, total] = await Promise.all([
    LeadActivity.find(filter).sort({ at: -1 }).skip(skip).limit(limit).lean(),
    LeadActivity.countDocuments(filter),
  ]);
  return { data: rows, meta: metaFor(page, limit, total) };
}

async function involvement(user, id) {
  const lead = await findInScope(user, id);
  const [assignments, activities, payments] = await Promise.all([
    LeadAssignment.find({ lead: id }).sort({ createdAt: 1 }).populate('fromStaff', 'name role').populate('toStaff', 'name role').populate('assignedBy', 'name role').lean(),
    LeadActivity.find({ lead: id }).sort({ at: 1 }).lean(),
    Payment.find({ lead: id }).populate('recordedBy', 'name role').lean(),
  ]);
  const people = (rows, pick) => {
    const map = new Map();
    rows.forEach((row) => {
      const person = pick(row);
      if (!person) return;
      const key = String(person._id || person);
      if (!map.has(key)) map.set(key, person._id ? { id: person._id, name: person.name, role: person.role } : { id: person });
    });
    return [...map.values()];
  };
  return {
    data: {
      currentOwner: lead.assignedTo,
      previousOwners: assignments.filter((row) => row.fromStaff).map((row) => ({
        staff: row.fromStaff, at: row.createdAt, reason: row.reason, mode: row.mode,
      })),
      assignmentHistory: assignments,
      contactedBy: people(activities.filter((row) => ['first_call', 'incoming_call', 'outgoing_call', 'call_connected'].includes(row.type)), (row) => (
        row.actor ? { _id: row.actor, name: row.actorName } : null
      )),
      demos: activities.filter((row) => row.type === 'demo_completed').map((row) => ({
        staffName: row.actorName, staffId: row.actor, at: row.at, description: row.description,
      })),
      payments: payments.map((row) => ({
        amount: row.amount, paidAt: row.paidAt, staff: row.recordedBy, method: row.method,
      })),
      onboarding: activities.filter((row) => row.type === 'onboarding_completed').map((row) => ({
        staffName: row.actorName, staffId: row.actor, at: row.at,
      })),
    },
  };
}

async function bulkStatus(user, body, meta) {
  const status = await assertStatus(body.status);
  const results = [];
  for (const id of body.leadIds) {
    try {
      const updated = await update(user, id, { status: body.status, lostReason: body.lostReason }, meta);
      results.push({ id, ok: true, leadCode: updated.data.leadCode });
    } catch (error) {
      results.push({ id, ok: false, message: error.message });
    }
  }
  return { data: { status: status.key, results }, message: 'Bulk status update finished' };
}

async function rowsForExport(user, query) {
  const filter = await buildLeadFilter(user, query, { bucket: query.view === 'bucket' });
  const rows = await Lead.find(filter).sort(sortFrom(query, LEAD_SORT)).limit(5000)
    .populate('assignedTo', 'name')
    .lean();
  return rows.map((lead) => ({
    'Assigned day': dateKeyOf(lead.assignmentDate, 'Asia/Kolkata') || '',
    'Lead ID': lead.leadCode,
    Name: lead.name,
    Phone: formatPhone(lead.phoneNormalized),
    Source: lead.source,
    Status: lead.status,
    'Assigned staff': lead.assignedTo?.name || '',
    'Expected revenue': lead.expectedRevenue || 0,
    'Next follow-up': lead.followUpAt ? new Date(lead.followUpAt).toISOString() : '',
    'Last contacted': lead.lastContactedAt ? new Date(lead.lastContactedAt).toISOString() : '',
    District: lead.district || '',
    City: lead.city || '',
  }));
}

async function listAssignments(user, query) {
  const { page, limit, skip } = paging(query);
  const leadIds = await Lead.find({ deletedAt: null, ...leadScope(user) }).distinct('_id');
  const filter = { lead: { $in: leadIds } };
  const [rows, total] = await Promise.all([
    LeadAssignment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
      .populate('lead', 'leadCode name phoneNormalized')
      .populate('fromStaff', 'name')
      .populate('toStaff', 'name')
      .populate('assignedBy', 'name')
      .lean(),
    LeadAssignment.countDocuments(filter),
  ]);
  return { data: rows, meta: metaFor(page, limit, total) };
}

async function assignOne(user, { leadId, toStaff, reason, mode, expectedStaffId, session }) {
  const lead = await Lead.findOne({ _id: leadId, deletedAt: null, ...(isElevated(user) ? {} : { branch: user.branch || leadScope(user).branch }) });
  if (!lead) return { ok: false, conflict: false, message: 'Lead not found' };
  if (user.role === 'TEAM_LEADER' && lead.team && String(lead.team) !== String(user.team)) {
    return { ok: false, message: 'Lead is outside your team' };
  }
  const staff = toStaff ? await User.findOne({ _id: toStaff, isActive: true, deletedAt: null }) : null;
  if (toStaff && !staff) return { ok: false, message: 'Staff member not found' };
  if (staff && !isElevated(user) && String(staff.branch || '') !== String(user.branch || '')) {
    return { ok: false, message: 'Staff member is outside your branch' };
  }
  const expected = expectedStaffId !== undefined && expectedStaffId !== '' ? expectedStaffId : lead.assignedTo;
  const filter = { _id: lead._id, deletedAt: null, assignedTo: expected || null };
  const updated = await Lead.findOneAndUpdate(filter, {
    $set: {
      assignedTo: staff ? staff._id : null,
      team: staff ? staff.team : lead.team,
      branch: staff?.branch || lead.branch,
      assignmentDate: staff ? new Date() : lead.assignmentDate,
      bucketStatus: staff ? 'assigned' : 'unassigned',
    },
  }, { new: true, session: session || undefined });
  if (!updated) return { ok: false, conflict: true, message: 'This lead was assigned by someone else' };
  await LeadAssignment.create([{
    lead: lead._id,
    fromStaff: lead.assignedTo,
    toStaff: staff ? staff._id : null,
    fromTeam: lead.team,
    toTeam: staff ? staff.team : null,
    assignedBy: user._id,
    reason: reason || '',
    mode: mode || 'manual',
  }], session ? { session } : undefined);
  await addActivity({
    lead: updated,
    type: staff ? 'lead_assigned' : 'lead_reassigned',
    actor: user,
    description: staff ? `Assigned to ${staff.name}` : 'Returned to the lead bucket',
    oldValue: lead.assignedTo, newValue: staff ? staff._id : null, metadata: { reason, mode }, session,
  });
  if (staff) {
    await notify({
      user: staff._id, type: 'lead_assigned', title: 'New lead assigned',
      body: `${updated.name} (${updated.leadCode})`, module: 'leads', recordId: updated.id, dedupeKey: `assign:${updated.id}:${staff.id}`,
    });
  }
  return { ok: true, lead: updated, staff };
}

async function assign(user, body, meta) {
  const results = [];
  for (const leadId of body.leadIds) {
    const result = await assignOne(user, {
      leadId,
      toStaff: body.staffId || null,
      reason: body.reason,
      mode: 'manual',
      expectedStaffId: body.expectedStaffId,
    });
    results.push({ leadId, ...result, lead: undefined });
  }
  const assigned = results.filter((row) => row.ok).length;
  await recordAudit({
    user: user._id, username: user.username, action: 'lead.assign', module: 'leads',
    newValues: { leadIds: body.leadIds, staffId: body.staffId || null, assigned }, ...meta,
  });
  return { data: { assigned, conflicts: results.filter((row) => row.conflict), results }, message: 'Assignment completed' };
}

async function workload(user) {
  const staffFilter = { deletedAt: null, isActive: true, role: { $in: ['STAFF', 'TEAM_LEADER'] } };
  if (!isElevated(user)) staffFilter.branch = user.branch;
  if (user.role === 'TEAM_LEADER') staffFilter.team = user.team;
  const people = await User.find(staffFilter).select('name role team branch maxLeadAllocation employmentStatus').lean();
  const onLeave = await staffOnLeave(new Date());
  const counts = await Lead.aggregate([
    { $match: { deletedAt: null, assignedTo: { $in: people.map((person) => person._id) } } },
    { $group: {
      _id: '$assignedTo',
      open: { $sum: 1 },
      fresh: { $sum: { $cond: [{ $in: ['$status', ['fresh', 'not_contacted']] }, 1, 0] } },
    } },
  ]);
  const byId = new Map(counts.map((row) => [String(row._id), row]));
  return {
    data: people.map((person) => {
      const row = byId.get(String(person._id)) || { open: 0, fresh: 0 };
      const leave = onLeave.has(String(person._id)) || person.employmentStatus === 'on_leave';
      return {
        id: person._id,
        name: person.name,
        role: person.role,
        team: person.team,
        openLeads: row.open,
        freshLeads: row.fresh,
        capacity: person.maxLeadAllocation || 50,
        remaining: Math.max(0, (person.maxLeadAllocation || 50) - row.open),
        available: !leave && person.employmentStatus === 'active',
      };
    }),
  };
}

async function distribute(user, body, meta) {
  const pool = await workload(user);
  let candidates = pool.data.filter((person) => person.available);
  if (body.staffIds?.length) {
    const allowed = new Set(body.staffIds.map(String));
    candidates = candidates.filter((person) => allowed.has(String(person.id)));
  }
  if (body.teamId) {
    candidates = candidates.filter((person) => String(person.team) === String(body.teamId));
  }
  if (!candidates.length) throw new AppError('No available staff match this distribution', 422);
  const maxPer = body.maxPerStaff || null;
  const leads = await Lead.find({
    _id: { $in: body.leadIds },
    deletedAt: null,
    assignedTo: null,
    ...(isElevated(user) ? {} : { branch: user.branch }),
  });
  if (body.mode === 'equal_workload' || body.mode === 'capacity') {
    candidates.sort((a, b) => a.openLeads - b.openLeads);
  }
  const results = [];
  let cursor = 0;
  for (const lead of leads) {
    let receiver = null;
    if (body.mode === 'capacity') {
      receiver = candidates.find((person) => person.remaining > 0 && (!maxPer || person.openLeads < maxPer));
    } else {
      for (let attempt = 0; attempt < candidates.length; attempt += 1) {
        const person = candidates[cursor % candidates.length];
        cursor += 1;
        if (maxPer && person.openLeads >= maxPer) continue;
        if (person.remaining <= 0 && body.mode === 'capacity') continue;
        receiver = person;
        break;
      }
    }
    if (!receiver) {
      results.push({ leadId: lead.id, ok: false, message: 'Capacity reached' });
      continue;
    }
    const assigned = await assignOne(user, {
      leadId: lead.id, toStaff: receiver.id, reason: body.reason || `Distributed by ${body.mode}`, mode: body.mode,
    });
    if (assigned.ok) {
      receiver.openLeads += 1;
      receiver.remaining -= 1;
    }
    results.push({ leadId: lead.id, ok: assigned.ok, staffId: receiver.id, conflict: assigned.conflict, message: assigned.message });
  }
  await recordAudit({
    user: user._id, username: user.username, action: 'lead.distribute', module: 'leads',
    newValues: { mode: body.mode, count: results.filter((row) => row.ok).length }, ...meta,
  });
  return { data: { results, assigned: results.filter((row) => row.ok).length }, message: 'Distribution finished' };
}

async function listSwaps(user, query) {
  const { page, limit, skip } = paging(query);
  const filter = {};
  if (user.role === 'STAFF') filter.requestedBy = user._id;
  else if (!isElevated(user)) {
    const leadIds = await Lead.find({ deletedAt: null, ...leadScope(user) }).distinct('_id');
    filter.lead = { $in: leadIds };
  }
  if (query.status) filter.status = query.status;
  const [rows, total] = await Promise.all([
    LeadSwapRequest.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
      .populate('lead', 'leadCode name')
      .populate('requestedBy', 'name')
      .populate('fromStaff', 'name')
      .populate('toStaff', 'name')
      .lean(),
    LeadSwapRequest.countDocuments(filter),
  ]);
  return { data: rows, meta: metaFor(page, limit, total) };
}

async function requestSwap(user, body, meta) {
  const lead = await findInScope(user, body.leadId);
  if (user.role === 'STAFF' && String(lead.assignedTo || '') !== String(user._id)) {
    throw new AppError('You can only request a transfer for your own lead', 403);
  }
  const existing = await LeadSwapRequest.findOne({ lead: lead._id, status: 'pending' });
  if (existing) throw new AppError('This lead already has a pending swap request', 409);
  const swap = await LeadSwapRequest.create({
    lead: lead._id,
    requestedBy: user._id,
    fromStaff: lead.assignedTo,
    toStaff: body.toStaff || null,
    reason: body.reason.trim(),
  });
  const reviewers = await User.find({
    isActive: true, deletedAt: null, role: { $in: ['OWNER', 'SUPER_ADMIN', 'ADMIN', 'TEAM_LEADER'] },
    ...(lead.branch ? { $or: [{ role: { $in: ['OWNER', 'SUPER_ADMIN'] } }, { branch: lead.branch }] } : {}),
  }).select('_id');
  await notifyMany(reviewers.map((row) => row._id), {
    type: 'swap_request', title: 'Lead swap requested', body: `${lead.leadCode}: ${body.reason}`, module: 'swaps', recordId: swap.id, dedupeKey: `swap:${swap.id}`,
  });
  await recordAudit({
    user: user._id, username: user.username, action: 'lead.swap.request', module: 'leads', recordId: swap.id, newValues: { reason: body.reason }, ...meta,
  });
  return { data: swap, message: 'Swap request submitted', status: 201 };
}

async function reviewSwap(user, id, body, meta) {
  const swap = await LeadSwapRequest.findById(id);
  if (!swap || swap.status !== 'pending') throw new AppError('Swap request not found', 404);
  const lead = await findInScope(user, swap.lead);
  if (body.status === 'approved') {
    if (!body.toStaff && !swap.toStaff) throw new AppError('Choose the staff member who should receive this lead', 422);
    const result = await assignOne(user, {
      leadId: lead.id,
      toStaff: body.toStaff || swap.toStaff,
      reason: swap.reason,
      mode: 'swap',
      expectedStaffId: swap.fromStaff,
    });
    if (!result.ok) throw new AppError(result.message || 'The lead could not be transferred', 409);
    await addActivity({
      lead, type: 'lead_swapped', actor: user, description: `Swap approved. ${swap.reason}`,
      oldValue: swap.fromStaff, newValue: body.toStaff || swap.toStaff,
    });
  }
  swap.status = body.status;
  swap.reviewNote = body.reviewNote || '';
  swap.reviewedBy = user._id;
  swap.reviewedAt = new Date();
  if (body.toStaff) swap.toStaff = body.toStaff;
  await swap.save();
  await notify({
    user: swap.requestedBy, type: 'swap_review', title: `Swap ${body.status}`,
    body: `${lead.leadCode}: ${swap.reviewNote || swap.reason}`, module: 'swaps', recordId: swap.id,
  });
  await recordAudit({
    user: user._id, username: user.username, action: `lead.swap.${body.status}`, module: 'leads', recordId: swap.id,
    newValues: { status: body.status, reason: swap.reason }, ...meta,
  });
  return { data: swap, message: `Swap ${body.status}` };
}

function ownLead(user, lead) {
  if (user.role === 'STAFF' && String(lead.assignedTo || '') !== String(user._id)) {
    throw new AppError('You can only update leads assigned to you', 403);
  }
}

async function addToPipeline(user, id, meta) {
  const lead = await findInScope(user, id);
  ownLead(user, lead);
  if (!lead.inPipeline) {
    lead.inPipeline = true;
    lead.pipelineAddedAt = new Date();
    lead.consultancyName = lead.consultancyName || lead.company || '';
    lead.proposedPlan = lead.proposedPlan || lead.expectedRevenue || 0;
    lead.remarks = lead.remarks || lead.notes || '';
    await lead.save();
    await addActivity({
      lead, type: 'pipeline_added', actor: user,
      description: `${lead.leadCode} added to the pipeline`,
    });
    await recordAudit({
      user: user._id, username: user.username, action: 'lead.pipeline', module: 'leads', recordId: lead.id,
      newValues: { inPipeline: true }, ...meta,
    });
  }
  return { data: presentLead(lead.toObject()), message: 'Added to pipeline' };
}

async function updatePipeline(user, id, body, meta) {
  if (body.status) await update(user, id, { status: body.status, lostReason: body.lostReason || '' }, meta);
  const lead = await findInScope(user, id);
  ownLead(user, lead);
  if (!lead.inPipeline) throw new AppError('Add this lead to the pipeline first', 400);
  if (body.consultancyName !== undefined) lead.consultancyName = String(body.consultancyName || '').trim();
  if (body.proposedPlan !== undefined) lead.proposedPlan = Math.max(0, Number(body.proposedPlan) || 0);
  if (body.remarks !== undefined) lead.remarks = String(body.remarks || '').trim();
  await lead.save();
  return { data: presentLead(lead.toObject()), message: 'Pipeline updated' };
}

async function pipelineReport(user, query) {
  const filter = { deletedAt: null, inPipeline: true };
  let selected = null;
  if (user.role === 'STAFF') {
    filter.assignedTo = user._id;
  } else if (query.staff) {
    selected = await User.findOne({ _id: query.staff, deletedAt: null, isActive: true, ...staffScope(user) }).select('name');
    if (!selected) throw new AppError('Staff member was not found', 404);
    filter.assignedTo = selected._id;
  }
  const rows = await Lead.find(combine(filter, leadScope(user)))
    .populate('assignedTo', 'name')
    .sort({ name: 1 })
    .lean();
  const groups = new Map();
  rows.forEach((lead) => {
    const key = String(lead.assignedTo?._id || 'unassigned');
    if (!groups.has(key)) {
      groups.set(key, { staffId: lead.assignedTo?._id || null, staffName: lead.assignedTo?.name || 'Unassigned', rows: [] });
    }
    groups.get(key).rows.push(presentLead(lead));
  });
  let reports = [...groups.values()].sort((a, b) => a.staffName.localeCompare(b.staffName)).map((group) => ({
    staffId: group.staffId,
    staffName: group.staffName,
    title: `${group.staffName.toUpperCase()} REPORT`,
    rows: group.rows.map((row, index) => ({ ...row, sl: index + 1 })),
  }));
  if (selected && !reports.length) {
    reports = [{ staffId: selected._id, staffName: selected.name, title: `${selected.name.toUpperCase()} REPORT`, rows: [] }];
  }
  const people = user.role === 'STAFF'
    ? []
    : await User.find({ deletedAt: null, isActive: true, role: { $in: ['STAFF', 'TEAM_LEADER'] }, ...staffScope(user) }).select('name role').sort({ name: 1 }).lean();
  return { data: reports, meta: { view: user.role === 'STAFF' || query.staff ? 'staff' : 'all', staff: people } };
}

module.exports = {
  nextLeadCode,
  presentLead,
  list,
  getById,
  create,
  update,
  remove,
  addNote,
  timeline,
  involvement,
  bulkStatus,
  rowsForExport,
  listAssignments,
  assign,
  workload,
  distribute,
  listSwaps,
  requestSwap,
  reviewSwap,
  findInScope,
  buildLeadFilter,
  addToPipeline,
  updatePipeline,
  pipelineReport,
};
