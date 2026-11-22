const {
  Lead, LeadAssignment, LeadActivity, LeadSwapRequest, User, Team, Counter, Payment, FollowUp, RevenueOpportunity,
} = require('../models');
const { AppError, paging, metaFor, escapeRegex, sortFrom, clean } = require('../utils/http');
const { normalizePhone, isValidPhone, formatPhone } = require('../utils/phone');
const { recordAudit, changed } = require('./audit');
const { notify, notifyMany } = require('./notify');
const { addActivity, statusLabel } = require('./activity');
const { getGeneral, getLeadSources, assertLeadRole, assertLeadFirm, activeStatuses } = require('./settings');
const {
  leadScope, bucketScope, staffScope, combine, isElevated, hasPermission,
} = require('./access');
const { staffOnLeave } = require('./org');
const { LOST_STATUSES } = require('../config/constants');
const { dateKeyOf, dayBounds, combineLocal } = require('../utils/time');

const LEAD_SORT = ['createdAt', 'name', 'expectedRevenue', 'status', 'priority', 'priorityRank', 'followUpAt', 'leadCode', 'lastContactedAt', 'assignmentDate'];
const STAFF_FIELDS = ['name', 'phone', 'status', 'nextActionTitle', 'nextActionDueAt', 'notes', 'comment', 'consultancyName', 'remarks', 'lostReason', 'tags', 'followUpAt', 'priority', 'quality', 'leadRole', 'expectedRevenue'];
const PRIORITY_RANK = { urgent: 40, high: 30, medium: 20, low: 10 };

function priorityRankOf(priority) {
  return PRIORITY_RANK[String(priority || '').toLowerCase()] || PRIORITY_RANK.high;
}

function leadListSort(query) {
  if (!query.sort || query.sort === 'assignmentDate' || query.sort === 'priority') {
    const dateDir = query.sort === 'assignmentDate' && query.order === 'asc' ? 1 : -1;
    const rankDir = query.sort === 'priority' && query.order === 'asc' ? 1 : -1;
    return { priorityRank: rankDir, assignmentDate: dateDir, createdAt: -1 };
  }
  return sortFrom(query, LEAD_SORT);
}

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
  if (clean(query.leadRole)) filter.leadRole = query.leadRole;
  if (clean(query.firm)) filter.firm = query.firm;
  if (query.fromSheet === 'true') filter.fromSheet = true;
  if (query.fromSheet === 'false') filter.fromSheet = { $ne: true };
  if (clean(query.team)) filter.team = query.team;
  if (clean(query.branch) && isElevated(user)) filter.branch = query.branch;
  if (query.bucket === 'unassigned') filter.assignedTo = null;
  if (query.bucket === 'assigned') filter.assignedTo = { $ne: null };
  if (query.bucket === 'rnp' || query.section === 'rnp') {
    filter.status = 'rnp';
    filter.assignedTo = null;
  } else if (query.bucket === 'utc' || query.section === 'utc') {
    filter.status = 'utc';
    filter.assignedTo = null;
  } else if (bucket && query.section !== 'all') {
    filter.status = { $nin: ['rnp', 'utc'] };
  }
  // Lead Management hides bucket leads. Owner/SA “All leads” (view=all) includes everything.
  if (!bucket && query.view !== 'all' && query.bucket !== 'unassigned' && query.bucket !== 'assigned' && !clean(query.staff)) {
    filter.assignedTo = { $ne: null };
  }
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

const STATUS_TOUCH_TYPES = ['status_changed', 'demo_completed', 'onboarding_completed'];

async function untouchedLeadIds(filter) {
  const leads = await Lead.find(filter).select('_id assignedTo assignmentDate createdAt').lean();
  const assigned = leads.filter((lead) => lead.assignedTo);
  if (!assigned.length) return [];
  const activities = await LeadActivity.find({
    lead: { $in: assigned.map((lead) => lead._id) },
    type: { $in: STATUS_TOUCH_TYPES },
  }).select('lead actor at').lean();
  const byLead = new Map(assigned.map((lead) => [String(lead._id), lead]));
  const touched = new Set();
  activities.forEach((activity) => {
    const lead = byLead.get(String(activity.lead));
    if (!lead || String(activity.actor) !== String(lead.assignedTo)) return;
    const since = new Date(lead.assignmentDate || lead.createdAt || 0).getTime();
    if (new Date(activity.at).getTime() >= since) touched.add(String(lead._id));
  });
  return assigned.filter((lead) => !touched.has(String(lead._id))).map((lead) => lead._id);
}

async function list(user, query) {
  const bucket = query.view === 'bucket';
  const allView = query.view === 'all';
  const { page, limit, skip } = paging(query);
  const filter = await buildLeadFilter(user, query, { bucket });
  const sort = bucket
    ? (query.sort ? sortFrom(query, LEAD_SORT) : { createdAt: -1 })
    : (allView && query.sort ? sortFrom(query, LEAD_SORT) : leadListSort(query));
  if (!bucket && !allView && (query.touch === 'untouched' || query.touch === 'worked')) {
    const ids = await untouchedLeadIds(filter);
    if (query.touch === 'untouched') filter._id = { $in: ids };
    else if (ids.length) filter._id = { $nin: ids };
  }
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

function facetRows(rows, keyField = '_id') {
  return (rows || []).map((row) => ({
    key: row[keyField] == null || row[keyField] === '' ? '' : String(row[keyField]),
    count: row.count || 0,
  })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** Owner/SA all-leads filter counts. Facets ignore their own selected value so options stay visible. */
async function allLeadFacets(user, query = {}) {
  if (!isElevated(user)) throw new AppError('Only Owner or Super Admin can open all leads', 403);
  const baseQuery = { ...query, view: 'all' };
  const fullFilter = await buildLeadFilter(user, baseQuery, { bucket: false });
  const without = async (omitKeys = []) => {
    const next = { ...baseQuery };
    omitKeys.forEach((key) => { delete next[key]; });
    return buildLeadFilter(user, next, { bucket: false });
  };

  const [
    total,
    status,
    firm,
    leadRole,
    source,
    priority,
    staff,
    fromSheet,
    assignment,
  ] = await Promise.all([
    Lead.countDocuments(fullFilter),
    Lead.aggregate([{ $match: await without(['status']) }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    Lead.aggregate([{ $match: await without(['firm']) }, { $group: { _id: '$firm', count: { $sum: 1 } } }]),
    Lead.aggregate([{ $match: await without(['leadRole']) }, { $group: { _id: '$leadRole', count: { $sum: 1 } } }]),
    Lead.aggregate([{ $match: await without(['source']) }, { $group: { _id: '$source', count: { $sum: 1 } } }]),
    Lead.aggregate([{ $match: await without(['priority']) }, { $group: { _id: '$priority', count: { $sum: 1 } } }]),
    Lead.aggregate([
      { $match: await without(['staff', 'bucket']) },
      { $match: { assignedTo: { $ne: null } } },
      { $group: { _id: '$assignedTo', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 200 },
    ]),
    Lead.aggregate([
      { $match: await without(['fromSheet']) },
      { $group: { _id: { $cond: ['$fromSheet', 'sheet', 'other'] }, count: { $sum: 1 } } },
    ]),
    Lead.aggregate([
      { $match: await without(['bucket', 'staff']) },
      { $group: { _id: { $cond: [{ $eq: ['$assignedTo', null] }, 'unassigned', 'assigned'] }, count: { $sum: 1 } } },
    ]),
  ]);

  const staffIds = staff.map((row) => row._id).filter(Boolean);
  const people = staffIds.length
    ? await User.find({ _id: { $in: staffIds } }).select('name role employeeId').lean()
    : [];
  const peopleById = new Map(people.map((person) => [String(person._id), person]));

  return {
    data: {
      total,
      status: facetRows(status),
      firm: facetRows(firm),
      leadRole: facetRows(leadRole),
      source: facetRows(source),
      priority: facetRows(priority),
      fromSheet: facetRows(fromSheet),
      assignment: facetRows(assignment),
      staff: staff.map((row) => {
        const person = peopleById.get(String(row._id));
        return {
          key: String(row._id),
          count: row.count || 0,
          name: person?.name || 'Staff',
          role: person?.role || '',
        };
      }),
    },
  };
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
  const statuses = await activeStatuses();
  const status = body.status || (statuses.some((item) => item.key === 'fresh') ? 'fresh' : statuses[0]?.key);
  await assertStatus(status);
  const leadRole = await assertLeadRole(body.leadRole);
  const firm = await assertLeadFirm(body.firm);
  const phones = await preparePhones(body, general.countryCode);
  const existingPhone = await Lead.findOne({
    deletedAt: null,
    $or: [
      { phoneNormalized: phones.phoneNormalized },
      { alternatePhoneNormalized: phones.phoneNormalized },
    ],
  }).select('leadCode name assignedTo').populate('assignedTo', 'name').lean();
  if (existingPhone) {
    const who = existingPhone.assignedTo?.name
      ? `assigned to ${existingPhone.assignedTo.name}`
      : 'in the lead bucket';
    throw new AppError(
      `This mobile number is already used by ${existingPhone.leadCode}${existingPhone.name ? ` (${existingPhone.name})` : ''}, ${who}. Duplicate check covers all leads in the database, not only the bucket.`,
      409,
    );
  }
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
    leadRole: leadRole.key,
    firm: firm.key,
    category: body.category || '',
    priority: body.priority || 'high',
    priorityRank: priorityRankOf(body.priority || 'high'),
    quality: body.quality || '',
    assignedTo,
    team,
    branch,
    createdBy: user._id,
    assignmentDate: assignedTo ? new Date() : null,
    status,
    statusChangedAt: new Date(),
    nextActionTitle: body.nextActionTitle || '',
    nextActionDueAt: body.nextActionDueAt || null,
    expectedRevenue: body.expectedRevenue || 0,
    revenueProbability: body.revenueProbability || 0,
    followUpAt: body.followUpAt || body.nextActionDueAt || null,
    notes: body.notes || '',
    comment: body.comment || '',
    consultancyName: body.consultancyName || '',
    remarks: body.remarks || '',
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
    if (patch.phone) {
      patch.phoneNormalized = phones.phoneNormalized;
      if (phones.phoneNormalized !== lead.phoneNormalized) {
        const existingPhone = await Lead.findOne({
          deletedAt: null,
          _id: { $ne: lead._id },
          $or: [
            { phoneNormalized: phones.phoneNormalized },
            { alternatePhoneNormalized: phones.phoneNormalized },
          ],
        }).select('leadCode name assignedTo').populate('assignedTo', 'name').lean();
        if (existingPhone) {
          const who = existingPhone.assignedTo?.name
            ? `assigned to ${existingPhone.assignedTo.name}`
            : 'in the lead bucket';
          throw new AppError(
            `This mobile number is already used by ${existingPhone.leadCode}${existingPhone.name ? ` (${existingPhone.name})` : ''}, ${who}. Duplicate check covers all leads in the database, not only the bucket.`,
            409,
          );
        }
      }
    }
    if (patch.alternatePhone !== undefined) patch.alternatePhoneNormalized = phones.alternatePhoneNormalized;
  }
  if (patch.priority) {
    patch.priority = String(patch.priority).toLowerCase();
    patch.priorityRank = priorityRankOf(patch.priority);
  }
  if (patch.leadRole) await assertLeadRole(patch.leadRole);
  if (patch.firm) await assertLeadFirm(patch.firm);
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
    if (patch.status === 'rnp') {
      const at = new Date();
      patch.rnpMarkedAt = at;
      patch.rnpNextCallAt = new Date(at.getTime() + (3 * 60 * 60 * 1000));
      patch.rnpLastNotifyAt = null;
      patch.rnpNotifyCount = 0;
      if (lead.assignedTo) patch.rnpLastStaff = lead.assignedTo;
    } else if (lead.status === 'rnp') {
      patch.rnpMarkedAt = null;
      patch.rnpNextCallAt = null;
      patch.rnpLastNotifyAt = null;
      patch.rnpNotifyCount = 0;
    }
    if (patch.status === 'utc') {
      if (lead.assignedTo) patch.utcLastStaff = lead.assignedTo;
    }
  }
  if (patch.assignedTo && String(patch.assignedTo) !== String(lead.assignedTo || '')) {
    const staff = await User.findOne({ _id: patch.assignedTo, isActive: true, deletedAt: null });
    if (!staff) throw new AppError('Assigned staff member was not found', 422);
    patch.team = staff.team;
    patch.branch = staff.branch || lead.branch;
    patch.assignmentDate = new Date();
    patch.bucketStatus = 'assigned';
  }
  let demoDueAt = null;
  if (patch.status === 'demo_booked' && patch.status !== lead.status) {
    if (!body.demoDate || !body.demoTime) {
      throw new AppError('Choose demo date and time', 422);
    }
    demoDueAt = combineLocal(body.demoDate, body.demoTime, general.timezone || 'Asia/Kolkata');
    if (Number.isNaN(demoDueAt.getTime())) throw new AppError('Invalid demo date or time', 422);
    if (demoDueAt.getTime() <= Date.now() - 60 * 1000) {
      throw new AppError('Demo time must be in the future', 422);
    }
    patch.followUpAt = demoDueAt;
    patch.nextActionTitle = 'Upcoming demo';
    patch.nextActionDueAt = demoDueAt;
  }
  delete patch.demoDate;
  delete patch.demoTime;

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
  if (demoDueAt && patch.status === 'demo_booked') {
    await FollowUp.updateMany(
      { lead: lead._id, isDemo: true, status: 'pending' },
      { $set: { status: 'cancelled' } },
    );
    const assignee = lead.assignedTo || user._id;
    const followUp = await FollowUp.create({
      lead: lead._id,
      leadName: lead.name,
      leadCode: lead.leadCode,
      assignedTo: assignee,
      team: lead.team,
      branch: lead.branch,
      title: 'Upcoming demo',
      description: `Demo booked for ${body.demoDate} ${body.demoTime}`,
      dueAt: demoDueAt,
      priority: 'high',
      createdBy: user._id,
      isDemo: true,
    });
    await addActivity({
      lead,
      type: 'followup_created',
      actor: user,
      description: `Demo booked for ${demoDueAt.toISOString()}`,
      newValue: { followUpId: followUp.id, dueAt: demoDueAt, demo: true },
    });
    if (String(assignee) !== String(user._id)) {
      await notify({
        user: assignee,
        type: 'demo_booked',
        title: 'Demo booked',
        body: `${lead.name} (${lead.leadCode}) · ${body.demoDate} ${body.demoTime}`,
        module: 'leads',
        recordId: lead.id,
      });
    }
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
  if (diff.oldValues.name !== undefined || diff.oldValues.phone !== undefined) {
    await addActivity({
      lead, type: 'lead_updated', actor: user,
      description: 'Name or mobile number updated',
      oldValue: { name: diff.oldValues.name, phone: diff.oldValues.phone },
      newValue: { name: lead.name, phone: lead.phone },
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
  const [rows, total, assignments] = await Promise.all([
    LeadActivity.find(filter).sort({ at: -1 }).skip(skip).limit(limit).lean(),
    LeadActivity.countDocuments(filter),
    LeadAssignment.find({ lead: id })
      .sort({ createdAt: -1 })
      .populate('fromStaff', 'name role')
      .populate('toStaff', 'name role')
      .populate('assignedBy', 'name role')
      .lean(),
  ]);

  const assignEvents = assignments.map((row) => {
    const fromName = row.fromStaff?.name || null;
    const toName = row.toStaff?.name || null;
    let description;
    if (toName && fromName) description = `Reassigned ${fromName} → ${toName}${row.reason ? ` · ${row.reason}` : ''}`;
    else if (toName) description = `Assigned to ${toName}${row.reason ? ` · ${row.reason}` : ''}`;
    else if (fromName) description = `Unassigned from ${fromName}${row.reason ? ` · ${row.reason}` : ''}`;
    else description = row.reason || 'Assignment updated';
    return {
      _id: `assign-${row._id}`,
      type: toName ? (fromName ? 'lead_reassigned' : 'lead_assigned') : 'lead_unassigned',
      actorName: row.assignedBy?.name || 'System',
      description,
      at: row.createdAt,
      metadata: {
        mode: row.mode,
        fromStaff: row.fromStaff ? { id: row.fromStaff._id, name: row.fromStaff.name } : null,
        toStaff: row.toStaff ? { id: row.toStaff._id, name: row.toStaff.name } : null,
        source: 'assignment',
      },
    };
  });

  const merged = [...rows, ...assignEvents]
    .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0))
    .slice(0, Math.max(limit, 50));

  return {
    data: merged,
    meta: {
      ...metaFor(page, limit, total + assignments.length),
      activityTotal: total,
      assignmentTotal: assignments.length,
    },
  };
}

function activityActionLabel(row) {
  const type = String(row.type || '').replaceAll('_', ' ');
  if (row.type === 'status_changed' || row.type === 'lead_status_changed') {
    const from = row.oldValue?.status || row.oldValue || '';
    const to = row.newValue?.status || row.newValue || '';
    if (from && to) return `Status ${String(from).replaceAll('_', ' ')} → ${String(to).replaceAll('_', ' ')}`;
    return row.description || 'Status changed';
  }
  if (row.type === 'note_added') return row.description ? `Note: ${row.description}` : 'Added a note';
  if (row.description) return row.description;
  return type;
}

function buildStaffHandlers(lead, assignments, activities) {
  const now = new Date();
  const stints = [];

  assignments.forEach((row, index) => {
    if (!row.toStaff) {
      // Returned to bucket / unassigned — close previous stint already handled by next bounds
      return;
    }
    const start = row.createdAt ? new Date(row.createdAt) : now;
    const next = assignments.slice(index + 1).find((item) => item.createdAt);
    const end = next?.createdAt ? new Date(next.createdAt) : (
      lead.assignedTo && String(lead.assignedTo._id || lead.assignedTo) === String(row.toStaff._id || row.toStaff)
        ? null
        : (next ? new Date(next.createdAt) : null)
    );
    stints.push({
      staff: {
        id: String(row.toStaff._id || row.toStaff),
        name: row.toStaff.name || 'Staff',
        role: row.toStaff.role || '',
      },
      fromStaff: row.fromStaff ? {
        id: String(row.fromStaff._id || row.fromStaff),
        name: row.fromStaff.name || 'Previous staff',
        role: row.fromStaff.role || '',
      } : null,
      assignedBy: row.assignedBy ? {
        id: String(row.assignedBy._id || row.assignedBy),
        name: row.assignedBy.name || 'System',
        role: row.assignedBy.role || '',
      } : null,
      assignedAt: start.toISOString(),
      endedAt: end ? end.toISOString() : null,
      current: !end && Boolean(lead.assignedTo) && String(lead.assignedTo._id || lead.assignedTo) === String(row.toStaff._id || row.toStaff),
      reason: row.reason || '',
      mode: row.mode || 'manual',
    });
  });

  // If lead has an owner but no assignment rows yet, still show current holder.
  if (!stints.length && lead.assignedTo) {
    const owner = lead.assignedTo;
    stints.push({
      staff: {
        id: String(owner._id || owner),
        name: owner.name || 'Staff',
        role: owner.role || '',
      },
      fromStaff: null,
      assignedBy: null,
      assignedAt: lead.assignmentDate ? new Date(lead.assignmentDate).toISOString() : (lead.createdAt ? new Date(lead.createdAt).toISOString() : null),
      endedAt: null,
      current: true,
      reason: 'Current owner',
      mode: 'manual',
    });
  }

  return stints.map((stint, index) => {
    const startMs = stint.assignedAt ? new Date(stint.assignedAt).getTime() : 0;
    const endMs = stint.endedAt ? new Date(stint.endedAt).getTime() : Number.POSITIVE_INFINITY;
    const during = activities.filter((row) => {
      const at = new Date(row.at || 0).getTime();
      if (at < startMs || at >= endMs) return false;
      if (!row.actor) return true;
      return String(row.actor) === String(stint.staff.id);
    });
    const actions = during.map((row) => ({
      id: String(row._id),
      type: row.type,
      label: activityActionLabel(row),
      at: row.at,
      actorName: row.actorName || stint.staff.name,
    }));
    const summaryParts = [];
    const statusMoves = during.filter((row) => row.type === 'status_changed' || row.type === 'lead_status_changed');
    if (statusMoves.length) summaryParts.push(`${statusMoves.length} status update${statusMoves.length === 1 ? '' : 's'}`);
    const calls = during.filter((row) => ['first_call', 'incoming_call', 'outgoing_call', 'call_connected', 'call_logged'].includes(row.type));
    if (calls.length) summaryParts.push(`${calls.length} call${calls.length === 1 ? '' : 's'}`);
    const notes = during.filter((row) => row.type === 'note_added');
    if (notes.length) summaryParts.push(`${notes.length} note${notes.length === 1 ? '' : 's'}`);
    const demos = during.filter((row) => row.type === 'demo_completed' || row.type === 'demo_booked');
    if (demos.length) summaryParts.push(`${demos.length} demo`);
    if (!summaryParts.length && during.length) summaryParts.push(`${during.length} update${during.length === 1 ? '' : 's'}`);
    if (!summaryParts.length) summaryParts.push(stint.current ? 'Holding lead' : 'No logged actions');

    return {
      order: index + 1,
      ...stint,
      summary: summaryParts.join(' · '),
      actions,
      actionCount: actions.length,
    };
  });
}

async function involvement(user, id) {
  const leadDoc = await findInScope(user, id);
  await leadDoc.populate('assignedTo', 'name role employeeId');
  const lead = leadDoc.toObject();
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
  const handlers = buildStaffHandlers(lead, assignments, activities);
  return {
    data: {
      currentOwner: lead.assignedTo,
      previousOwners: assignments.filter((row) => row.fromStaff).map((row) => ({
        staff: row.fromStaff, at: row.createdAt, reason: row.reason, mode: row.mode,
      })),
      assignmentHistory: assignments,
      handlers,
      handlerCount: handlers.length,
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

async function bulkRemove(user, body, meta) {
  const results = [];
  let deleted = 0;
  for (const id of body.leadIds) {
    try {
      const archived = await remove(user, id, meta);
      deleted += 1;
      results.push({ id, ok: true, message: archived.message });
    } catch (error) {
      results.push({ id, ok: false, message: error.message });
    }
  }
  return {
    data: { deleted, results },
    message: deleted ? `Deleted ${deleted} lead${deleted === 1 ? '' : 's'}` : 'No leads were deleted',
  };
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
    Role: lead.leadRole || '',
    Firm: lead.firm || '',
    'Consultancy name': lead.consultancyName || '',
    'Assigned staff': lead.assignedTo?.name || '',
    'Expected revenue': lead.expectedRevenue || 0,
    'Next follow-up': lead.followUpAt ? new Date(lead.followUpAt).toISOString() : '',
    'Last contacted': lead.lastContactedAt ? new Date(lead.lastContactedAt).toISOString() : '',
    District: lead.district || '',
    City: lead.city || '',
    Comment: lead.comment || '',
    Remark: lead.remarks || '',
    Notes: lead.notes || '',
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
  const assigningFromBucket = Boolean(staff) && !lead.assignedTo;
  const reassigningToOther = Boolean(staff) && lead.assignedTo && String(lead.assignedTo) !== String(staff._id);
  // New staff always sees the lead as fresh (RNP/UTC was for the previous owner only).
  const presentAsFresh = assigningFromBucket || (reassigningToOther && ['rnp', 'utc'].includes(lead.status));
  const updated = await Lead.findOneAndUpdate(filter, {
    $set: {
      assignedTo: staff ? staff._id : null,
      team: staff ? staff.team : lead.team,
      branch: staff?.branch || lead.branch,
      assignmentDate: staff ? new Date() : lead.assignmentDate,
      bucketStatus: staff ? 'assigned' : 'unassigned',
      ...(presentAsFresh ? {
        status: 'fresh',
        statusChangedAt: new Date(),
        rnpMarkedAt: null,
        rnpNextCallAt: null,
        rnpLastNotifyAt: null,
        rnpNotifyCount: 0,
        ...(lead.status === 'rnp' && lead.assignedTo ? { rnpLastStaff: lead.assignedTo } : {}),
        ...(lead.status === 'utc' && lead.assignedTo ? { utcLastStaff: lead.assignedTo } : {}),
      } : {}),
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
  if (staff) {
    const moved = { assignedTo: staff._id, team: staff.team || null, branch: staff.branch || updated.branch };
    await FollowUp.updateMany(
      { lead: updated._id, status: { $in: ['pending', 'missed'] } },
      { $set: { assignedTo: staff._id, team: moved.team, branch: moved.branch } },
    );
    await RevenueOpportunity.updateMany(
      { lead: updated._id, deletedAt: null, status: 'open' },
      { $set: { staff: staff._id, team: moved.team, branch: moved.branch } },
    );
  }
  const movedWord = mode === 'swap' ? 'Swapped to' : (lead.assignedTo ? 'Reassigned to' : 'Assigned to');
  await addActivity({
    lead: updated,
    type: staff ? 'lead_assigned' : 'lead_reassigned',
    actor: user,
    description: staff ? `${movedWord} ${staff.name}. Open follow-ups moved with this lead.` : 'Returned to the lead bucket',
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

async function swapSets(user, body, meta) {
  if (String(body.staffA) === String(body.staffB)) throw new AppError('Choose two different staff members', 422);
  const idsA = [...new Set((body.leadIdsA || []).map(String))];
  const idsB = [...new Set((body.leadIdsB || []).map(String))].filter((id) => !idsA.includes(id));
  if (!idsA.length && !idsB.length) throw new AppError('Select at least one lead', 422);
  const moved = [];
  for (const leadId of idsA) {
    moved.push(await assignOne(user, {
      leadId, toStaff: body.staffB, reason: 'Swap', mode: 'swap', expectedStaffId: body.staffA,
    }));
  }
  for (const leadId of idsB) {
    moved.push(await assignOne(user, {
      leadId, toStaff: body.staffA, reason: 'Swap', mode: 'swap', expectedStaffId: body.staffB,
    }));
  }
  const assigned = moved.filter((row) => row.ok).length;
  await recordAudit({
    user: user._id, username: user.username, action: 'lead.swap.direct', module: 'leads',
    newValues: { staffA: body.staffA, staffB: body.staffB, fromA: idsA.length, fromB: idsB.length, assigned }, ...meta,
  });
  const bothSides = idsA.length > 0 && idsB.length > 0;
  return {
    data: { assigned, conflicts: moved.filter((row) => !row.ok) },
    message: bothSides ? 'Leads swapped' : 'Leads reassigned',
  };
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

function canConfirmPayment(user) {
  return user.role !== 'STAFF';
}

async function updatePipeline(user, id, body, meta) {
  const approver = canConfirmPayment(user);
  if (body.paymentAction === 'submit') {
    const amount = Math.max(0, Number(body.paymentAmount) || 0);
    if (!amount) throw new AppError('Enter the payment amount', 422);
    const status = approver ? 'payment_received' : 'payment_pending';
    await update(user, id, { status }, meta);
    const lead = await findInScope(user, id);
    ownLead(user, lead);
    if (!lead.inPipeline) throw new AppError('Add this lead to the pipeline first', 400);
    lead.paymentAmount = amount;
    lead.paymentState = approver ? 'received' : 'awaiting';
    await lead.save();
    await addActivity({
      lead, type: 'payment_received', actor: user,
      description: approver ? `Payment of ₹${amount} received` : `Payment of ₹${amount} is waiting for confirmation`,
      newValue: { amount, state: lead.paymentState },
    });
    return { data: presentLead(lead.toObject()), message: approver ? 'Payment received' : 'Sent for confirmation' };
  }
  if (body.paymentAction === 'approve' || body.paymentAction === 'return') {
    if (!approver) throw new AppError('A team leader or above confirms the payment', 403);
    const lead = await findInScope(user, id);
    if (!lead.inPipeline) throw new AppError('Add this lead to the pipeline first', 400);
    if (lead.paymentState !== 'awaiting') throw new AppError('This payment is not waiting for confirmation', 422);
    if (body.paymentAction === 'approve') {
      await update(user, id, { status: 'payment_received' }, meta);
      const fresh = await findInScope(user, id);
      fresh.paymentState = 'received';
      await fresh.save();
      await addActivity({
        lead: fresh, type: 'payment_received', actor: user,
        description: `Payment of ₹${fresh.paymentAmount || 0} confirmed`,
        newValue: { amount: fresh.paymentAmount, state: 'received' },
      });
      return { data: presentLead(fresh.toObject()), message: 'Payment received' };
    }
    lead.paymentState = 'returned';
    lead.status = 'payment_pending';
    lead.statusChangedAt = new Date();
    await lead.save();
    await addActivity({
      lead, type: 'payment_received', actor: user,
      description: 'Payment was not received',
      newValue: { amount: lead.paymentAmount, state: 'returned' },
    });
    return { data: presentLead(lead.toObject()), message: 'Marked as not received' };
  }
  if (body.status === 'payment_received') throw new AppError('Enter the payment amount', 422);
  if (body.status) {
    await update(user, id, {
      status: body.status,
      lostReason: body.lostReason || '',
      demoDate: body.demoDate,
      demoTime: body.demoTime,
    }, meta);
  }
  const lead = await findInScope(user, id);
  ownLead(user, lead);
  if (!lead.inPipeline) throw new AppError('Add this lead to the pipeline first', 400);
  if (body.consultancyName !== undefined) lead.consultancyName = String(body.consultancyName || '').trim();
  if (body.proposedPlan !== undefined) lead.proposedPlan = Math.max(0, Number(body.proposedPlan) || 0);
  if (body.remarks !== undefined) lead.remarks = String(body.remarks || '').trim();
  if (body.status && !['payment_pending', 'payment_received'].includes(body.status)) {
    lead.paymentState = '';
    lead.paymentAmount = 0;
  }
  await lead.save();
  return { data: presentLead(lead.toObject()), message: 'Pipeline updated' };
}

async function pipelineReport(user, query) {
  const filter = { deletedAt: null, inPipeline: true };
  if (query.leadRole) filter.leadRole = query.leadRole;
  if (query.firm) filter.firm = query.firm;
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
  const approver = canConfirmPayment(user);
  const groups = new Map();
  const place = (lead) => {
    if (lead.paymentState === 'received' || lead.status === 'payment_received') return 'received';
    if (lead.paymentState === 'awaiting') return approver ? 'confirm' : 'pending';
    if (lead.paymentState === 'returned' || lead.status === 'payment_pending') return 'pending';
    return 'active';
  };
  rows.forEach((lead) => {
    const key = String(lead.assignedTo?._id || 'unassigned');
    if (!groups.has(key)) {
      groups.set(key, {
        staffId: lead.assignedTo?._id || null,
        staffName: lead.assignedTo?.name || 'Unassigned',
        active: [],
        pending: [],
        confirm: [],
        received: [],
      });
    }
    groups.get(key)[place(lead)].push(presentLead(lead));
  });
  const numberRows = (list) => list.map((row, index) => ({ ...row, sl: index + 1 }));
  let reports = [...groups.values()].sort((a, b) => a.staffName.localeCompare(b.staffName)).map((group) => ({
    staffId: group.staffId,
    staffName: group.staffName,
    title: `${group.staffName.toUpperCase()} REPORT`,
    rows: numberRows(group.active),
    pending: numberRows(group.pending),
    confirm: numberRows(group.confirm),
    received: numberRows(group.received),
  }));
  if (selected && !reports.length) {
    reports = [{ staffId: selected._id, staffName: selected.name, title: `${selected.name.toUpperCase()} REPORT`, rows: [], pending: [], confirm: [], received: [] }];
  }
  const people = user.role === 'STAFF'
    ? []
    : await User.find({ deletedAt: null, isActive: true, role: { $in: ['STAFF', 'TEAM_LEADER'] }, ...staffScope(user) }).select('name role').sort({ name: 1 }).lean();
  return { data: reports, meta: { view: user.role === 'STAFF' || query.staff ? 'staff' : 'all', staff: people } };
}

/** Leads staff must dial today: assigned today (Asia/Kolkata) Fresh or due RNP. */
async function todayCallQueue(user, query = {}) {
  const timezone = 'Asia/Kolkata';
  const todayKey = dateKeyOf(new Date(), timezone);
  const { start, end } = dayBounds(todayKey, timezone);
  const now = new Date();
  const { page, limit, skip } = paging(query);
  const base = {
    deletedAt: null,
    assignedTo: clean(query.staff) || { $ne: null },
    $or: [
      { status: 'fresh', assignmentDate: { $gte: start, $lt: end } },
      { status: 'rnp', $or: [{ assignmentDate: { $gte: start, $lt: end } }, { rnpNextCallAt: { $lte: now } }] },
      { status: 'utc', assignmentDate: { $gte: start, $lt: end } },
    ],
  };
  const filter = await combine(base, leadScope(user));

  const [rows, total, highPriority, rnpDue] = await Promise.all([
    Lead.find(filter)
      .sort({ priorityRank: -1, assignmentDate: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('assignedTo', 'name employeeId role')
      .populate('team', 'name code')
      .lean(),
    Lead.countDocuments(filter),
    Lead.countDocuments({ ...filter, priority: { $in: ['high', 'urgent'] } }),
    Lead.countDocuments(await combine({
      deletedAt: null,
      assignedTo: clean(query.staff) || { $ne: null },
      status: 'rnp',
      $or: [{ assignmentDate: { $gte: start, $lt: end } }, { rnpNextCallAt: { $lte: now } }],
    }, leadScope(user))),
  ]);

  return {
    data: rows.map(presentLead),
    meta: {
      ...metaFor(page, limit, total),
      date: todayKey,
      timezone,
      summary: {
        toCall: total,
        highPriority,
        rnpDue,
      },
    },
  };
}

module.exports = {
  nextLeadCode,
  presentLead,
  list,
  allLeadFacets,
  getById,
  create,
  update,
  remove,
  addNote,
  timeline,
  involvement,
  bulkStatus,
  bulkRemove,
  rowsForExport,
  listAssignments,
  assign,
  swapSets,
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
  todayCallQueue,
};
