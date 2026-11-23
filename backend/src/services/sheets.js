const xlsx = require('xlsx');
const { SheetConnection, Lead } = require('../models');
const { AppError } = require('../utils/http');
const { normalizePhone, isValidPhone } = require('../utils/phone');
const { HEADER_ALIASES, PRIORITIES, QUALITIES } = require('../config/constants');
const { getGeneral, getLeadSources, assertLeadRole, assertLeadFirm, assertLeadSource, activeStatuses } = require('./settings');
const { nextLeadCode } = require('./leads');
const { addActivity } = require('./activity');
const { recordAudit } = require('./audit');
const { autoAssignSheetLeads } = require('./autoAssign');

function parseSheetUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) throw new AppError('Paste a Google Sheet link', 422);
  const idMatch = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) throw new AppError('That does not look like a Google Sheet link', 422);
  const sheetId = idMatch[1];
  const gidMatch = raw.match(/[?#&]gid=([0-9]+)/) || raw.match(/gid=([0-9]+)/);
  const gid = gidMatch ? gidMatch[1] : '0';
  return { sheetId, gid, sheetUrl: raw };
}

function csvExportUrl(sheetId, gid) {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${encodeURIComponent(gid || '0')}`;
}

function detectMapping(headers) {
  const mapping = {};
  headers.forEach((header) => {
    const normal = String(header || '').trim().toLowerCase();
    Object.entries(HEADER_ALIASES).forEach(([field, aliases]) => {
      if (!mapping[field] && aliases.includes(normal)) mapping[field] = header;
    });
  });
  return mapping;
}

function plainCell(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function plainRow(row) {
  const out = {};
  Object.entries(row || {}).forEach(([key, value]) => {
    const cleanKey = String(key || '').trim();
    if (!cleanKey || cleanKey.startsWith('__') || cleanKey.includes('$') || cleanKey.includes('.')) return;
    out[cleanKey] = plainCell(value);
  });
  return out;
}

function applyMapping(raw, mapping) {
  const mapped = {};
  Object.entries(mapping || {}).forEach(([field, header]) => {
    if (!header) return;
    mapped[field] = raw[header] != null ? String(raw[header]).trim() : '';
  });
  return mapped;
}

function normalizeStatusToken(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function resolveStatusKey(value, statuses) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const token = normalizeStatusToken(raw);
  const match = (statuses || []).find((status) => (
    status.key === token
    || normalizeStatusToken(status.label) === token
    || String(status.label || '').trim().toLowerCase() === raw.toLowerCase()
  ));
  return match ? match.key : '';
}

function columnLetter(index) {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

async function fetchSheetRows(sheetId, gid) {
  const url = csvExportUrl(sheetId, gid);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new AppError('Could not read the Google Sheet. Share it as Anyone with the link can view, then try again.', 422);
  }
  const text = await response.text();
  if (!text || /sign in|accounts\.google|html>/i.test(text.slice(0, 400))) {
    throw new AppError('Could not read the Google Sheet. Share it as Anyone with the link can view, then try again.', 422);
  }
  const workbook = xlsx.read(text, { type: 'string', cellDates: true, raw: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new AppError('The sheet has no data', 422);
  const json = xlsx.utils.sheet_to_json(sheet, { defval: '', raw: false });
  const rows = json.map(plainRow);
  const headers = rows.length ? Object.keys(rows[0]) : [];
  return { rows, headers };
}

function publicConnection(doc) {
  const value = doc.toObject ? doc.toObject() : doc;
  return {
    ...value,
    id: value.id || String(value._id),
  };
}

async function listConnections(user, query = {}) {
  const filter = { deletedAt: null };
  if (query.firm) filter.firm = query.firm;
  const rows = await SheetConnection.find(filter).sort({ firm: 1, createdAt: -1 }).lean();
  return { data: rows.map(publicConnection) };
}

async function previewSheet(user, body) {
  const parsed = parseSheetUrl(body.sheetUrl);
  const { rows, headers } = await fetchSheetRows(parsed.sheetId, parsed.gid);
  const mapping = detectMapping(headers);
  const sample = rows[0] || {};
  const columns = headers.map((header, index) => ({
    letter: columnLetter(index),
    number: index + 1,
    header,
    sample: sample[header] || '',
  }));
  return {
    data: {
      ...parsed,
      columns,
      mapping,
      rowCount: rows.length,
    },
    message: 'Sheet columns ready',
  };
}

async function createConnection(user, body, meta) {
  const firm = await assertLeadFirm(body.firm);
  const leadRole = await assertLeadRole(body.leadRole);
  const source = await assertLeadSource(body.source);
  const parsed = parseSheetUrl(body.sheetUrl);
  if (!body.mapping?.name || !body.mapping?.phone) {
    throw new AppError('Choose columns for name and phone', 422);
  }
  const doc = await SheetConnection.create({
    name: String(body.name || 'Google Sheet').trim(),
    firm: firm.key,
    sheetUrl: parsed.sheetUrl,
    sheetId: parsed.sheetId,
    gid: parsed.gid,
    mapping: body.mapping,
    leadRole: leadRole.key,
    source,
    enabled: body.enabled !== false,
    createdBy: user._id,
  });
  await recordAudit({
    user: user._id, username: user.username, action: 'sheet.create', module: 'connections', recordId: doc.id,
    newValues: { name: doc.name, firm: doc.firm, sheetId: doc.sheetId }, ...meta,
  });
  let syncResult = null;
  try {
    syncResult = await syncConnection(doc._id, { quiet: true });
  } catch (error) {
    doc.lastSyncStatus = 'error';
    doc.lastSyncMessage = error.message;
    await doc.save();
  }
  return {
    data: { connection: publicConnection(doc), sync: syncResult?.data || null },
    message: 'Sheet connected. New rows will sync into the lead bucket.',
    status: 201,
  };
}

async function updateConnection(user, id, body, meta) {
  const doc = await SheetConnection.findOne({ _id: id, deletedAt: null });
  if (!doc) throw new AppError('Sheet connection not found', 404);
  if (body.name != null) doc.name = String(body.name).trim();
  if (body.enabled != null) doc.enabled = Boolean(body.enabled);
  if (body.mapping) {
    if (!body.mapping.name || !body.mapping.phone) throw new AppError('Choose columns for name and phone', 422);
    doc.mapping = body.mapping;
  }
  if (body.leadRole) doc.leadRole = (await assertLeadRole(body.leadRole)).key;
  if (body.source) doc.source = await assertLeadSource(body.source);
  if (body.sheetUrl) {
    const parsed = parseSheetUrl(body.sheetUrl);
    doc.sheetUrl = parsed.sheetUrl;
    doc.sheetId = parsed.sheetId;
    doc.gid = parsed.gid;
  }
  await doc.save();
  await recordAudit({
    user: user._id, username: user.username, action: 'sheet.update', module: 'connections', recordId: doc.id,
    newValues: { name: doc.name, enabled: doc.enabled }, ...meta,
  });
  return { data: publicConnection(doc), message: 'Sheet connection updated' };
}

async function removeConnection(user, id, meta) {
  const doc = await SheetConnection.findOne({ _id: id, deletedAt: null });
  if (!doc) throw new AppError('Sheet connection not found', 404);
  doc.deletedAt = new Date();
  doc.enabled = false;
  await doc.save();
  await recordAudit({
    user: user._id, username: user.username, action: 'sheet.delete', module: 'connections', recordId: doc.id,
    oldValues: { name: doc.name, firm: doc.firm }, ...meta,
  });
  return { data: { id: doc.id }, message: 'Sheet connection removed' };
}

function fieldsFromMapped(mapped, defaultStatus) {
  const revenue = Number(String(mapped.expectedRevenue || '').replace(/[^0-9.]/g, ''));
  const sheetStage = String(mapped.status || '').trim();
  const remarks = mapped.remarks || (sheetStage ? `Sheet stage: ${sheetStage}` : '');
  return {
    alternatePhone: mapped.alternatePhone || '',
    alternatePhoneNormalized: mapped.alternatePhone ? normalizePhone(mapped.alternatePhone) : '',
    email: mapped.email || '',
    company: mapped.company || '',
    consultancyName: mapped.consultancyName || '',
    district: mapped.district || '',
    city: mapped.city || '',
    state: mapped.state || '',
    country: mapped.country || 'India',
    category: mapped.category || '',
    // Keep Fresh until assigned staff changes status on Lead Management.
    status: defaultStatus,
    priority: PRIORITIES.includes(String(mapped.priority || '').toLowerCase()) ? mapped.priority.toLowerCase() : 'high',
    priorityRank: ({ urgent: 40, high: 30, medium: 20, low: 10 })[
      PRIORITIES.includes(String(mapped.priority || '').toLowerCase()) ? mapped.priority.toLowerCase() : 'high'
    ],
    quality: QUALITIES.includes(String(mapped.quality || '').toLowerCase()) ? mapped.quality.toLowerCase() : '',
    expectedRevenue: Number.isFinite(revenue) ? revenue : 0,
    notes: mapped.notes || '',
    comment: mapped.comment || '',
    remarks,
  };
}

async function syncConnection(id, options = {}) {
  const doc = await SheetConnection.findOne({ _id: id, deletedAt: null });
  if (!doc) throw new AppError('Sheet connection not found', 404);
  if (!doc.enabled && !options.force) throw new AppError('This sheet connection is paused', 422);
  if (!doc.mapping?.name || !doc.mapping?.phone) throw new AppError('Choose columns for name and phone first', 422);

  const general = await getGeneral();
  const statuses = await activeStatuses();
  const defaultStatus = statuses.some((item) => item.key === 'fresh') ? 'fresh' : (statuses[0]?.key || 'fresh');
  const { rows } = await fetchSheetRows(doc.sheetId, doc.gid);

  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (let index = 0; index < rows.length; index += 1) {
    const raw = rows[index];
    const mapped = applyMapping(raw, doc.mapping);
    const phoneNormalized = normalizePhone(mapped.phone, general.countryCode);
    if (!mapped.name || !mapped.phone || !isValidPhone(phoneNormalized)) {
      skipped += 1;
      continue;
    }
    if (mapped.status) {
      mapped.statusKey = resolveStatusKey(mapped.status, statuses);
    }
    const sheetRowKey = `${doc._id}:${phoneNormalized}`;
    const alreadyFromSheet = await Lead.findOne({ sheetRowKey, deletedAt: null }).select('_id').lean();
    if (alreadyFromSheet) {
      skipped += 1;
      continue;
    }
    const existing = await Lead.findOne({
      deletedAt: null,
      $or: [
        { phoneNormalized },
        { alternatePhoneNormalized: phoneNormalized },
      ],
    }).select('_id').lean();
    if (existing) {
      skipped += 1;
      continue;
    }
    try {
      const fields = fieldsFromMapped(mapped, defaultStatus);
      const lead = await Lead.create({
        leadCode: await nextLeadCode(),
        name: mapped.name,
        phone: mapped.phone,
        phoneNormalized,
        ...fields,
        source: doc.source,
        leadRole: doc.leadRole,
        firm: doc.firm,
        assignedTo: null,
        bucketStatus: 'unassigned',
        fromSheet: true,
        callQueueTier: 1,
        sheetConnection: doc._id,
        sheetRowKey,
        status: fields.status || defaultStatus,
        statusChangedAt: new Date(),
        createdBy: doc.createdBy || null,
      });
      await addActivity({
        lead,
        type: 'lead_imported',
        actor: doc.createdBy || null,
        description: `Imported from Google Sheet · ${doc.name}`,
        metadata: { sheetConnectionId: String(doc._id), row: index + 2 },
      });
      imported += 1;
    } catch (error) {
      failed += 1;
      if (error?.code === 11000) skipped += 1;
    }
  }

  doc.lastSyncedAt = new Date();
  doc.lastSyncStatus = failed && !imported ? 'error' : 'ok';
  doc.lastSyncMessage = `Imported ${imported}, skipped ${skipped}${failed ? `, failed ${failed}` : ''}`;
  doc.lastImported = imported;
  doc.lastSkipped = skipped;
  await doc.save();

  let autoAssign = null;
  if (imported > 0) {
    try {
      // Same-day fresh sheet leads go to staff marked present after Allow assigning.
      autoAssign = await autoAssignSheetLeads({ requireAllow: true });
    } catch (error) {
      autoAssign = { assigned: 0, error: error.message };
    }
  }

  return {
    data: {
      id: doc.id,
      imported,
      skipped,
      failed,
      lastSyncedAt: doc.lastSyncedAt,
      lastSyncMessage: doc.lastSyncMessage,
      autoAssign,
    },
    message: doc.lastSyncMessage,
  };
}

async function syncAllEnabled() {
  const rows = await SheetConnection.find({ deletedAt: null, enabled: true }).select('_id').lean();
  const results = [];
  for (const row of rows) {
    try {
      const result = await syncConnection(row._id, { quiet: true });
      results.push({ id: String(row._id), ok: true, ...result.data });
    } catch (error) {
      results.push({ id: String(row._id), ok: false, message: error.message });
      await SheetConnection.updateOne(
        { _id: row._id },
        { $set: { lastSyncedAt: new Date(), lastSyncStatus: 'error', lastSyncMessage: error.message } },
      );
    }
  }
  return results;
}

module.exports = {
  listConnections,
  previewSheet,
  createConnection,
  updateConnection,
  removeConnection,
  syncConnection,
  syncAllEnabled,
  parseSheetUrl,
};
