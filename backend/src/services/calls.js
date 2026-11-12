const {
  AndroidDevice, CallLog, CallRecording, SyncedContact, SyncBatch, Lead, User,
} = require('../models');
const { AppError, paging, metaFor, escapeRegex, sortFrom } = require('../utils/http');
const { normalizePhone, isValidPhone, formatPhone } = require('../utils/phone');
const { classifyLeadMatch, callUniqueKey } = require('../utils/matching');
const { hashToken, randomToken } = require('../utils/tokens');
const { recordAudit } = require('./audit');
const { addActivity } = require('./activity');
const { notifyMany } = require('./notify');
const { getGeneral } = require('./settings');
const { viewRange } = require('../utils/time');
const { recordScope, combine, isElevated, hasPermission } = require('./access');
const { nextLeadCode } = require('./leads');

function presentCall(call) {
  return {
    ...call,
    id: call.id || call._id,
    phoneDisplay: formatPhone(call.phoneNormalized),
    verified: call.dataSource === 'android_sync',
  };
}

async function registerDevice(user, body, meta) {
  if (!body.consentAccepted) throw new AppError('Device registration requires explicit consent', 422);
  const existing = await AndroidDevice.findOne({ deviceIdentifier: body.deviceIdentifier });
  if (existing && String(existing.staff) !== String(user._id) && existing.status === 'active') {
    throw new AppError('This device is already registered to another staff member', 409);
  }
  const token = `dev_${randomToken(32)}`;
  const payload = {
    staff: user._id,
    deviceIdentifier: body.deviceIdentifier,
    deviceName: body.deviceName || 'Android device',
    manufacturer: body.manufacturer || '',
    model: body.model || '',
    osVersion: body.osVersion || '',
    appVersion: body.appVersion || '',
    tokenHash: hashToken(token),
    fcmToken: body.fcmToken || '',
    status: 'active',
    permissionSnapshot: {
      callLog: body.callLogPermission || 'unknown',
      contacts: body.contactsPermission || 'unknown',
      notifications: body.notificationPermission || 'unknown',
    },
    contactsSyncEnabled: Boolean(body.contactsConsent),
    callLogSyncEnabled: body.callLogPermission === 'granted',
    consentAcceptedAt: new Date(),
    revokedAt: null,
  };
  const device = existing
    ? await AndroidDevice.findByIdAndUpdate(existing.id, payload, { new: true })
    : await AndroidDevice.create(payload);
  await recordAudit({
    user: user._id, username: user.username, action: 'device.register', module: 'android', recordId: device.id,
    newValues: { deviceIdentifier: device.deviceIdentifier, deviceName: device.deviceName }, ...meta,
  });
  return {
    data: {
      deviceId: device.id,
      deviceToken: token,
      contactsSyncEnabled: device.contactsSyncEnabled,
      callLogSyncEnabled: device.callLogSyncEnabled,
    },
    message: 'Device registered. Store the device token securely. It is shown once.',
    status: 201,
  };
}

async function listDevices(user) {
  const filter = { ...recordScope(user, { staff: 'staff' }) };
  const rows = await AndroidDevice.find(filter).sort({ updatedAt: -1 }).populate('staff', 'name role').lean();
  return {
    data: rows.map((row) => ({
      ...row,
      tokenHash: undefined,
    })),
  };
}

async function revokeDevice(user, id, meta) {
  const device = await AndroidDevice.findOne({ _id: id, ...recordScope(user, { staff: 'staff' }) });
  if (!device) throw new AppError('Device not found', 404);
  device.status = 'revoked';
  device.revokedAt = new Date();
  device.revokedBy = user._id;
  device.tokenHash = hashToken(`revoked_${device.id}_${Date.now()}`);
  await device.save();
  await recordAudit({
    user: user._id, username: user.username, action: 'device.revoke', module: 'android', recordId: device.id, ...meta,
  });
  return { data: { id: device.id, status: device.status }, message: 'Device revoked' };
}

async function setContactSync(user, id, enabled, meta) {
  const device = await AndroidDevice.findOne({ _id: id, ...recordScope(user, { staff: 'staff' }) });
  if (!device) throw new AppError('Device not found', 404);
  device.contactsSyncEnabled = Boolean(enabled);
  await device.save();
  await recordAudit({
    user: user._id, username: user.username, action: 'device.contacts_sync', module: 'android', recordId: device.id,
    newValues: { contactsSyncEnabled: device.contactsSyncEnabled }, ...meta,
  });
  return { data: { contactsSyncEnabled: device.contactsSyncEnabled }, message: 'Contact sync setting saved' };
}

async function findLeadMatches(phoneNormalized) {
  if (!phoneNormalized) return [];
  return Lead.find({
    deletedAt: null,
    $or: [{ phoneNormalized }, { alternatePhoneNormalized: phoneNormalized }],
  }).select('_id leadCode name phoneNormalized').lean();
}

async function recordCall({ staff, device, payload, dataSource, actor }) {
  const general = await getGeneral();
  const phoneNormalized = normalizePhone(payload.phone, general.countryCode);
  if (!isValidPhone(phoneNormalized)) {
    return { ok: false, message: 'Invalid phone number' };
  }
  const startedAt = new Date(payload.startedAt);
  if (Number.isNaN(startedAt.getTime())) return { ok: false, message: 'Invalid call time' };
  let leadId = null;
  let matchStatus = 'unmatched';
  let candidateLeadIds = [];
  if (dataSource === 'manual' && payload.leadId) {
    const lead = await Lead.findOne({ _id: payload.leadId, deletedAt: null });
    if (!lead) return { ok: false, message: 'Lead not found' };
    leadId = lead._id;
    matchStatus = 'manual';
    candidateLeadIds = [lead._id];
  } else if (dataSource !== 'manual' || !payload.leadId) {
    const matches = await findLeadMatches(phoneNormalized);
    const classified = classifyLeadMatch(matches);
    leadId = classified.leadId;
    matchStatus = classified.matchStatus;
    candidateLeadIds = classified.candidateLeadIds;
  }
  const uniqueKey = callUniqueKey({
    deviceId: device?._id ? String(device._id) : `user:${staff._id}`,
    androidEventId: payload.androidEventId,
    phoneNormalized,
    startedAt,
    callType: payload.callType,
    durationSeconds: payload.durationSeconds || 0,
  });
  try {
    const call = await CallLog.create({
      uniqueKey,
      androidEventId: payload.androidEventId || undefined,
      staff: staff._id,
      device: device?._id,
      team: staff.team,
      branch: staff.branch,
      phone: payload.phone,
      phoneNormalized,
      lead: leadId,
      matchStatus,
      candidateLeadIds,
      callType: payload.callType,
      startedAt,
      durationSeconds: Math.max(0, Number(payload.durationSeconds) || 0),
      status: payload.status || (payload.callType === 'missed' ? 'missed' : 'unknown'),
      dataSource,
      recordingId: payload.recordingId || '',
      syncedAt: dataSource === 'android_sync' ? new Date() : undefined,
      enteredBy: actor?._id,
      isDemo: dataSource === 'demo_seed',
    });
    if (leadId) {
      const lead = await Lead.findById(leadId);
      const first = !lead.firstContactAt;
      lead.lastContactedAt = startedAt;
      if (!lead.firstContactAt || startedAt < lead.firstContactAt) lead.firstContactAt = startedAt;
      await lead.save();
      const sourceLabel = dataSource === 'android_sync'
        ? 'Verified Android call log'
        : dataSource === 'demo_seed'
          ? 'Demo seed call record, not a device-verified Android log'
          : 'Manually entered call';
      await addActivity({
        lead,
        type: first ? 'first_call' : (payload.callType === 'incoming' ? 'incoming_call' : 'outgoing_call'),
        actor: staff,
        description: `${sourceLabel}: ${payload.callType} call, ${Math.round((call.durationSeconds || 0) / 60)} min, ${call.status}`,
        metadata: { callId: call.id, dataSource, durationSeconds: call.durationSeconds },
      });
      if (call.status === 'connected') {
        await addActivity({
          lead, type: 'call_connected', actor: staff,
          description: `${sourceLabel}. Connected for ${Math.round((call.durationSeconds || 0) / 60)} min`,
          metadata: { callId: call.id, dataSource },
        });
      }
    }
    let recording = null;
    if (payload.recordingId) {
      recording = await saveRecording({
        recordingId: payload.recordingId,
        provider: payload.recordingProvider || (dataSource === 'manual' ? 'manual' : 'device'),
        call,
        staff,
        device,
        accessReference: payload.recordingReference || '',
        status: payload.recordingStatus || 'pending',
        dataSource,
      });
    }
    return { ok: true, call, matchStatus, duplicate: false, recording };
  } catch (error) {
    if (error && error.code === 11000) return { ok: true, duplicate: true, matchStatus };
    return { ok: false, message: error.message };
  }
}

async function saveRecording({ recordingId, provider, call, staff, device, accessReference, status, dataSource }) {
  const recordingKey = `${provider}:${recordingId}`;
  const existing = await CallRecording.findOne({ recordingKey });
  if (existing) return existing;
  const doc = await CallRecording.create({
    recordingKey,
    recordingId,
    provider,
    callLog: call?._id,
    lead: call?.lead,
    staff: staff._id,
    device: device?._id,
    status: status || 'pending',
    accessReference,
    durationSeconds: call?.durationSeconds,
    dataSource,
    isDemo: dataSource === 'demo_seed',
  });
  if (call?.lead) {
    await addActivity({
      lead: call.lead,
      type: 'call_recording',
      actor: staff,
      description: `Recording reference ${recordingId} stored. The audio file is not stored in the CRM.`,
      metadata: { recordingId, provider, dataSource },
    });
  }
  return doc;
}

async function syncCalls(device, staff, body) {
  if (!device.callLogSyncEnabled && device.permissionSnapshot?.callLog !== 'granted') {
    throw new AppError('Call log permission is not granted on this device', 403);
  }
  const events = body.events || [];
  let inserted = 0;
  let duplicates = 0;
  let failed = 0;
  let matched = 0;
  let unmatched = 0;
  let ambiguous = 0;
  const failures = [];
  for (const event of events) {
    const result = await recordCall({
      staff,
      device,
      payload: { ...event, leadId: undefined },
      dataSource: 'android_sync',
      actor: staff,
    });
    if (!result.ok) {
      failed += 1;
      if (failures.length < 50) failures.push({ androidEventId: event.androidEventId, message: result.message });
      continue;
    }
    if (result.duplicate) duplicates += 1;
    else inserted += 1;
    if (result.matchStatus === 'matched') matched += 1;
    else if (result.matchStatus === 'ambiguous') ambiguous += 1;
    else unmatched += 1;
  }
  device.lastSyncAt = new Date();
  device.callLogSyncEnabled = true;
  await device.save();
  await SyncBatch.create({
    device: device._id, staff: staff._id, kind: 'calls', received: events.length, inserted, duplicates, failed,
    details: { matched, unmatched, ambiguous },
  });
  if (ambiguous) {
    const reviewers = await User.find({
      isActive: true, deletedAt: null,
      $or: [
        { role: { $in: ['OWNER', 'SUPER_ADMIN'] } },
        { role: 'ADMIN', branch: staff.branch },
      ],
    }).select('_id');
    await notifyMany(reviewers.map((row) => row._id), {
      type: 'call_review',
      title: 'Calls need a lead match',
      body: `${ambiguous} synced calls match more than one lead and were not attached automatically.`,
      module: 'calls',
      dedupeKey: `ambiguous:${device.id}:${new Date().toISOString().slice(0, 13)}`,
    });
  }
  return {
    data: { received: events.length, inserted, duplicates, failed, matched, unmatched, ambiguous, failures },
    message: 'Call sync processed',
  };
}

async function syncContacts(device, staff, body) {
  if (!device.contactsSyncEnabled) {
    throw new AppError('Contact sync is disabled. Enable it with explicit consent before sending contacts.', 403);
  }
  const general = await getGeneral();
  let inserted = 0;
  let duplicates = 0;
  let failed = 0;
  for (const contact of body.contacts || []) {
    const phoneNormalized = normalizePhone(contact.phone, general.countryCode);
    if (!contact.deviceContactId || !isValidPhone(phoneNormalized)) {
      failed += 1;
      continue;
    }
    const matches = await findLeadMatches(phoneNormalized);
    const classified = classifyLeadMatch(matches);
    try {
      await SyncedContact.updateOne(
        { device: device._id, deviceContactId: String(contact.deviceContactId) },
        {
          $set: {
            staff: staff._id,
            name: contact.name || '',
            phone: contact.phone,
            phoneNormalized,
            lead: classified.leadId,
            matchStatus: classified.matchStatus,
            candidateLeadIds: classified.candidateLeadIds,
            syncedAt: new Date(),
            consentAt: device.consentAcceptedAt,
          },
        },
        { upsert: true }
      );
      inserted += 1;
    } catch (error) {
      if (error.code === 11000) duplicates += 1;
      else failed += 1;
    }
  }
  device.lastSyncAt = new Date();
  await device.save();
  await SyncBatch.create({
    device: device._id, staff: staff._id, kind: 'contacts',
    received: (body.contacts || []).length, inserted, duplicates, failed,
  });
  return { data: { received: (body.contacts || []).length, inserted, duplicates, failed }, message: 'Contacts synced' };
}

async function syncRecording(device, staff, body) {
  const call = body.androidEventId
    ? await CallLog.findOne({ device: device._id, androidEventId: body.androidEventId })
    : null;
  const recording = await saveRecording({
    recordingId: body.recordingId,
    provider: body.provider || 'device',
    call,
    staff,
    device,
    accessReference: body.accessReference || '',
    status: body.status || 'available',
    dataSource: 'android_sync',
  });
  await SyncBatch.create({
    device: device._id, staff: staff._id, kind: 'recordings', received: 1, inserted: 1, duplicates: 0, failed: 0,
  });
  return { data: { id: recording.id, recordingId: recording.recordingId, status: recording.status }, message: 'Recording reference stored' };
}

async function createManual(user, body, meta) {
  const staff = body.staffId && hasPermission(user, 'calls.view') && user.role !== 'STAFF'
    ? await User.findById(body.staffId)
    : user;
  if (!staff) throw new AppError('Staff member not found', 404);
  if (!isElevated(user) && user.role !== 'STAFF' && String(staff.branch || '') !== String(user.branch || '')) {
    throw new AppError('Staff member not found', 404);
  }
  if (user.role === 'STAFF' && String(staff._id) !== String(user._id)) {
    throw new AppError('You can only record your own calls', 403);
  }
  const result = await recordCall({ staff, payload: body, dataSource: 'manual', actor: user });
  if (!result.ok) throw new AppError(result.message, 422);
  if (result.duplicate) throw new AppError('This call is already recorded', 409);
  await recordAudit({
    user: user._id, username: user.username, action: 'call.manual', module: 'calls', recordId: result.call.id,
    newValues: { phone: result.call.phoneNormalized, dataSource: 'manual' }, ...meta,
  });
  return { data: presentCall(result.call.toObject()), message: 'Manual call recorded', status: 201 };
}

function callFilter(user, query) {
  const filter = {};
  if (query.callType) filter.callType = query.callType;
  if (query.status) filter.status = query.status;
  if (query.dataSource) filter.dataSource = query.dataSource;
  if (query.matchStatus) filter.matchStatus = query.matchStatus;
  if (query.leadId) filter.lead = query.leadId;
  if (query.phone) filter.phoneNormalized = normalizePhone(query.phone);
  if (query.staff && user.role !== 'STAFF') filter.staff = query.staff;
  if (query.team && isElevated(user)) filter.team = query.team;
  if (query.branch && isElevated(user)) filter.branch = query.branch;
  if (query.from || query.to || query.dateFrom || query.dateTo) {
    filter.startedAt = {};
    const from = query.from || query.dateFrom;
    const to = query.to || query.dateTo;
    if (from) filter.startedAt.$gte = new Date(from);
    if (to) filter.startedAt.$lte = new Date(to);
  }
  if (query.q) {
    const digits = String(query.q).replace(/\D/g, '');
    filter.$or = [
      { phoneNormalized: { $regex: escapeRegex(digits || query.q) } },
    ];
  }
  return combine(filter, recordScope(user, { staff: 'staff' }));
}

function withoutDates(query) {
  const next = { ...query };
  delete next.from;
  delete next.to;
  delete next.dateFrom;
  delete next.dateTo;
  delete next.startDate;
  delete next.endDate;
  delete next.date;
  delete next.preset;
  return next;
}

async function callsInRange(user, query) {
  const timezone = (await getGeneral()).timezone;
  const range = viewRange(query, timezone);
  const filter = callFilter(user, withoutDates(query));
  filter.startedAt = { $gte: range.start, $lt: range.end };
  return { filter, range, timezone };
}

async function listCalls(user, query) {
  const { page, limit, skip } = paging(query);
  const { filter } = await callsInRange(user, query);
  const sort = sortFrom(query, ['startedAt', 'durationSeconds', 'status'], 'startedAt');
  const [rows, total] = await Promise.all([
    CallLog.find(filter).sort(sort).skip(skip).limit(limit)
      .populate('staff', 'name')
      .populate('lead', 'leadCode name')
      .lean(),
    CallLog.countDocuments(filter),
  ]);
  return { data: rows.map(presentCall), meta: metaFor(page, limit, total) };
}

async function summarizeCalls(match) {
  const [totals, uniqueRows, sources, longest] = await Promise.all([
    CallLog.aggregate([
      { $match: match },
      { $group: {
        _id: null,
        total: { $sum: 1 },
        outgoing: { $sum: { $cond: [{ $eq: ['$callType', 'outgoing'] }, 1, 0] } },
        incoming: { $sum: { $cond: [{ $eq: ['$callType', 'incoming'] }, 1, 0] } },
        missed: { $sum: { $cond: [{ $eq: ['$callType', 'missed'] }, 1, 0] } },
        connected: { $sum: { $cond: [{ $eq: ['$status', 'connected'] }, 1, 0] } },
        notConnected: { $sum: { $cond: [{ $in: ['$status', ['not_connected', 'rejected']] }, 1, 0] } },
        duration: { $sum: '$durationSeconds' },
        longest: { $max: '$durationSeconds' },
        firstCall: { $min: '$startedAt' },
        lastCall: { $max: '$startedAt' },
      } },
    ]),
    CallLog.aggregate([
      { $match: match },
      { $group: { _id: '$phoneNormalized' } },
      { $count: 'count' },
    ]),
    CallLog.aggregate([
      { $match: match },
      { $group: { _id: '$dataSource', calls: { $sum: 1 }, duration: { $sum: '$durationSeconds' } } },
    ]),
    CallLog.findOne(match).sort({ durationSeconds: -1 }).select('durationSeconds phoneNormalized startedAt').lean(),
  ]);
  const row = totals[0] || {};
  const unique = uniqueRows[0]?.count || 0;
  const bySource = { android_sync: { calls: 0, duration: 0 }, manual: { calls: 0, duration: 0 }, demo_seed: { calls: 0, duration: 0 } };
  sources.forEach((source) => {
    bySource[source._id] = { calls: source.calls, duration: source.duration };
  });
  const connected = row.connected || 0;
  return {
    total: row.total || 0,
    outgoing: row.outgoing || 0,
    incoming: row.incoming || 0,
    missed: row.missed || 0,
    connected,
    notConnected: row.notConnected || 0,
    uniqueNumbers: unique,
    repeatCalls: Math.max(0, (row.total || 0) - unique),
    totalDuration: row.duration || 0,
    averageDuration: connected ? Math.round((row.duration || 0) / connected) : 0,
    longest: row.longest || 0,
    firstCall: row.firstCall || null,
    lastCall: row.lastCall || null,
    bySource,
    longestCall: longest,
  };
}

async function analytics(user, query = {}) {
  const { filter: match, range, timezone } = await callsInRange(user, query);
  const [summary, hourly, daily, byStaff] = await Promise.all([
    summarizeCalls(match),
    CallLog.aggregate([
      { $match: match },
      { $group: {
        _id: { $dateToString: { format: '%H', date: '$startedAt', timezone } },
        count: { $sum: 1 },
        connected: { $sum: { $cond: [{ $eq: ['$status', 'connected'] }, 1, 0] } },
        duration: { $sum: '$durationSeconds' },
      } },
      { $sort: { _id: 1 } },
    ]),
    CallLog.aggregate([
      { $match: match },
      { $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$startedAt', timezone } },
        count: { $sum: 1 },
        duration: { $sum: '$durationSeconds' },
      } },
      { $sort: { _id: 1 } },
    ]),
    CallLog.aggregate([
      { $match: match },
      { $group: {
        _id: '$staff',
        total: { $sum: 1 },
        connected: { $sum: { $cond: [{ $eq: ['$status', 'connected'] }, 1, 0] } },
        duration: { $sum: '$durationSeconds' },
      } },
      { $sort: { connected: -1 } },
      { $limit: 20 },
    ]),
  ]);
  const staffIds = byStaff.map((row) => row._id);
  const people = await User.find({ _id: { $in: staffIds } }).select('name team').populate('team', 'name').lean();
  const peopleById = new Map(people.map((person) => [String(person._id), person]));
  return {
    data: {
      summary,
      timezone,
      period: { preset: range.preset, label: range.label, from: range.from, to: range.to, start: range.start, end: range.end },
      note: `${range.label} is read from the database. Android sync rows are device-verified call logs. Demo seed and manual rows are not device-verified.`,
      hourly: hourly.map((row) => ({ hour: row._id, count: row.count, connected: row.connected })),
      daily: daily.map((row) => ({ date: row._id, count: row.count, duration: row.duration })),
      staff: byStaff.map((row) => ({
        staffId: row._id,
        name: peopleById.get(String(row._id))?.name || 'Unknown',
        team: peopleById.get(String(row._id))?.team?.name || '',
        total: row.total,
        connected: row.connected,
        duration: row.duration,
      })),
    },
  };
}

async function listContacts(user, query) {
  const { page, limit, skip } = paging(query);
  const filter = { ...recordScope(user, { staff: 'staff' }) };
  if (query.matchStatus) filter.matchStatus = query.matchStatus;
  if (query.q) {
    const q = escapeRegex(query.q);
    filter.$or = [{ name: { $regex: q, $options: 'i' } }, { phoneNormalized: { $regex: q.replace(/\D/g, '') || q } }];
  }
  const [rows, total] = await Promise.all([
    SyncedContact.find(filter).sort({ syncedAt: -1 }).skip(skip).limit(limit).populate('lead', 'leadCode name').populate('staff', 'name').lean(),
    SyncedContact.countDocuments(filter),
  ]);
  return { data: rows, meta: metaFor(page, limit, total) };
}

async function createLeadFromContact(user, id, meta) {
  const contact = await SyncedContact.findOne({ _id: id, ...recordScope(user, { staff: 'staff' }) });
  if (!contact) throw new AppError('Contact not found', 404);
  if (contact.lead && contact.matchStatus === 'matched') {
    throw new AppError('This contact already matches a lead. Open that lead instead of creating another.', 409);
  }
  const lead = await Lead.create({
    leadCode: await nextLeadCode(),
    name: contact.name || 'Unnamed contact',
    phone: contact.phone,
    phoneNormalized: contact.phoneNormalized,
    source: 'Device Contact',
    status: 'fresh',
    assignedTo: user._id,
    team: user.team,
    branch: user.branch,
    createdBy: user._id,
    bucketStatus: 'assigned',
    assignmentDate: new Date(),
    priority: 'medium',
  });
  contact.lead = lead._id;
  contact.matchStatus = 'matched';
  await contact.save();
  await addActivity({
    lead, type: 'lead_created', actor: user,
    description: 'Lead created from a synced device contact. Other contacts were not imported.',
  });
  await recordAudit({
    user: user._id, username: user.username, action: 'contact.create_lead', module: 'contacts', recordId: lead.id, ...meta,
  });
  return { data: lead, message: 'Lead created from the selected contact', status: 201 };
}

async function listRecordings(user, query) {
  const { page, limit, skip } = paging(query);
  const filter = { ...recordScope(user, { staff: 'staff' }) };
  if (query.recordingId) filter.recordingId = query.recordingId.trim();
  if (query.leadId) filter.lead = query.leadId;
  if (query.q) filter.recordingId = { $regex: escapeRegex(query.q.trim()), $options: 'i' };
  const [rows, total] = await Promise.all([
    CallRecording.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
      .populate('staff', 'name')
      .populate('lead', 'leadCode name')
      .lean(),
    CallRecording.countDocuments(filter),
  ]);
  return { data: rows, meta: metaFor(page, limit, total) };
}

async function revealRecording(user, id, meta) {
  const recording = await CallRecording.findOne({ _id: id, ...recordScope(user, { staff: 'staff' }) }).select('+accessReference');
  if (!recording) throw new AppError('Recording reference not found', 404);
  await recordAudit({
    user: user._id, username: user.username, action: 'recording.access', module: 'recordings', recordId: recording.id,
    newValues: { recordingId: recording.recordingId }, ...meta,
  });
  return {
    data: {
      id: recording.id,
      recordingId: recording.recordingId,
      provider: recording.provider,
      status: recording.status,
      accessReference: recording.accessReference || '',
      lead: recording.lead,
      staff: recording.staff,
    },
    message: 'Access recorded in the audit log',
  };
}

async function syncHistory(user, query) {
  const { page, limit, skip } = paging(query);
  const filter = { ...recordScope(user, { staff: 'staff' }) };
  const [rows, total] = await Promise.all([
    SyncBatch.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    SyncBatch.countDocuments(filter),
  ]);
  return { data: rows, meta: metaFor(page, limit, total) };
}

async function syncStatus(user) {
  const devices = await AndroidDevice.find({ staff: user._id }).lean();
  const last = await SyncBatch.findOne({ staff: user._id }).sort({ createdAt: -1 }).lean();
  return { data: { devices: devices.map((device) => ({ ...device, tokenHash: undefined })), lastBatch: last } };
}

module.exports = {
  registerDevice,
  listDevices,
  revokeDevice,
  setContactSync,
  syncCalls,
  syncContacts,
  syncRecording,
  createManual,
  listCalls,
  analytics,
  summarizeCalls,
  listContacts,
  createLeadFromContact,
  listRecordings,
  revealRecording,
  syncHistory,
  syncStatus,
  recordCall,
  callFilter,
};
