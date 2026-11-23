const xlsx = require('xlsx');
const { LeadImport, Lead, LeadAssignment, User } = require('../models');
const { AppError, paging, metaFor } = require('../utils/http');
const { coercePhoneText, normalizePhone, isValidPhone } = require('../utils/phone');
const { HEADER_ALIASES, IMPORT_FIELDS, PRIORITIES, QUALITIES } = require('../config/constants');
const { getGeneral, getLeadSources, assertLeadRole, assertLeadFirm, assertLeadSource, activeStatuses } = require('./settings');
const { nextLeadCode, presentLead } = require('./leads');
const { addActivity } = require('./activity');
const { recordAudit } = require('./audit');
const { notify } = require('./notify');
const { hasPermission, staffScope } = require('./access');

const MAX_ROWS = 2000;

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

function detectMapping(headers) {
  const mapping = {};
  headers.forEach((header) => {
    const normal = header.trim().toLowerCase();
    Object.entries(HEADER_ALIASES).forEach(([field, aliases]) => {
      if (!mapping[field] && aliases.includes(normal)) mapping[field] = header;
    });
  });
  return mapping;
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
  return String(value || '').trim().toLowerCase().replace(/[\s/-]+/g, '_');
}

function compactStatusToken(value) {
  return normalizeStatusToken(value).replace(/_/g, '');
}

// Staff Excel stage labels → CRM status keys
const STATUS_ALIASES = {
  dq: 'disqualified',
  disqualify: 'disqualified',
  disqualified: 'disqualified',
  ni: 'not_interested',
  notinterested: 'not_interested',
  notintrested: 'not_interested',
  rnr: 'rnp',
  ringnotpick: 'rnp',
  ringnopick: 'rnp',
  unabletoconnect: 'utc',
  followup: 'follow_up_required',
  followuprequired: 'follow_up_required',
  follow_up_required: 'follow_up_required',
  new: 'fresh',
  newlead: 'fresh',
  untouched: 'fresh',
  untouch: 'fresh',
  notcontacted: 'not_contacted',
  maybuylater: 'may_buy_later',
  may_buy_later: 'may_buy_later',
  buylater: 'may_buy_later',
  prospect: 'prospect',
  prospective: 'prospect',
  dpreceived: 'dp_received',
  dp_received: 'dp_received',
  interestedtobuy: 'interested_to_buy',
  interested_to_buy: 'interested_to_buy',
  demoover: 'demo_completed',
  demo_over: 'demo_completed',
  democomplete: 'demo_completed',
  democompleted: 'demo_completed',
  demobooked: 'demo_booked',
  democonfirmed: 'demo_confirmed',
  demo_confirmed: 'demo_confirmed',
  demorescheduled: 'demo_rescheduled',
  demo_rescheduled: 'demo_rescheduled',
  democancelled: 'demo_cancelled',
  demo_cancelled: 'demo_cancelled',
  democanceled: 'demo_cancelled',
  hold: 'follow_up_required',
  onhold: 'follow_up_required',
};

function resolveStatusKey(value, statuses) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const token = normalizeStatusToken(raw);
  const compact = compactStatusToken(raw);
  const alias = STATUS_ALIASES[token] || STATUS_ALIASES[compact];
  const match = (statuses || []).find((status) => (
    status.key === token
    || status.key === alias
    || compactStatusToken(status.key) === compact
    || normalizeStatusToken(status.label) === token
    || compactStatusToken(status.label) === compact
    || String(status.label || '').trim().toLowerCase() === raw.toLowerCase()
  ));
  return match ? match.key : (alias || null);
}

async function validateRows(rawRows, mapping, countryCode, sources, statuses) {
  const prepared = rawRows.map((raw, index) => ({ raw, mapped: applyMapping(raw, mapping), rowNumber: index + 2 }));
  const seen = new Map();
  const phones = prepared.map((row) => normalizePhone(row.mapped.phone, countryCode)).filter(Boolean);
  // Check every non-deleted lead in the database (bucket + already assigned to staff).
  const existing = phones.length
    ? await Lead.find({
      deletedAt: null,
      $or: [
        { phoneNormalized: { $in: phones } },
        { alternatePhoneNormalized: { $in: phones } },
      ],
    }).select('phoneNormalized alternatePhoneNormalized leadCode name assignedTo').populate('assignedTo', 'name').lean()
    : [];
  const existingByPhone = new Map();
  existing.forEach((lead) => {
    if (lead.phoneNormalized && !existingByPhone.has(lead.phoneNormalized)) existingByPhone.set(lead.phoneNormalized, lead);
    if (lead.alternatePhoneNormalized && !existingByPhone.has(lead.alternatePhoneNormalized)) {
      existingByPhone.set(lead.alternatePhoneNormalized, lead);
    }
  });
  return prepared.map((row) => {
    const errors = [];
    const phoneNormalized = normalizePhone(row.mapped.phone, countryCode);
    const name = String(row.mapped.name || '').trim() || 'NO Name';
    if (!row.mapped.phone) errors.push('Phone is required');
    else if (!isValidPhone(phoneNormalized)) errors.push('Phone number is invalid');
    if (row.mapped.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.mapped.email)) errors.push('Email is invalid');
    if (row.mapped.priority && !PRIORITIES.includes(row.mapped.priority.toLowerCase())) errors.push('Priority is invalid');
    if (row.mapped.quality && !QUALITIES.includes(row.mapped.quality.toLowerCase())) errors.push('Quality is invalid');
    let statusKey = '';
    let statusFallback = false;
    if (row.mapped.status) {
      statusKey = resolveStatusKey(row.mapped.status, statuses);
      // Unknown Excel stages should not block import — use CRM default on commit.
      if (!statusKey) statusFallback = true;
    }
    let duplicateInFile = false;
    if (phoneNormalized) {
      if (seen.has(phoneNormalized)) duplicateInFile = true;
      seen.set(phoneNormalized, row.rowNumber);
    }
    const existingLead = phoneNormalized ? existingByPhone.get(phoneNormalized) : null;
    return {
      rowNumber: row.rowNumber,
      raw: row.raw,
      mapped: {
        ...row.mapped,
        name,
        phone: coercePhoneText(row.mapped.phone) || row.mapped.phone,
        phoneNormalized,
        statusKey,
        statusFallback,
        excelStage: row.mapped.status || '',
      },
      rowErrors: errors,
      duplicateInFile,
      duplicateLeadId: existingLead?._id,
      duplicateLeadCode: existingLead?.leadCode || '',
      duplicateLeadName: existingLead?.name || '',
      duplicateAssignedTo: existingLead?.assignedTo?.name || '',
      valid: errors.length === 0,
    };
  });
}

async function createPreview(user, file, mappingOverride, meta) {
  if (!file) throw new AppError('Choose an Excel or CSV file', 400);
  const workbook = xlsx.read(file.buffer, { type: 'buffer', cellDates: true, raw: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new AppError('The file has no worksheet', 400);
  const json = xlsx.utils.sheet_to_json(sheet, { defval: '', raw: false });
  if (!json.length) throw new AppError('The file has no data rows', 400);
  if (json.length > MAX_ROWS) throw new AppError(`Import limit is ${MAX_ROWS} rows. Split the file and try again.`, 400);
  const rawRows = json.map(plainRow);
  const headers = Object.keys(rawRows[0] || {});
  const detected = detectMapping(headers);
  const mapping = { ...detected, ...(mappingOverride || {}) };
  const general = await getGeneral();
  const sources = await getLeadSources();
  const statuses = await activeStatuses();
  const rows = await validateRows(rawRows, mapping, general.countryCode, sources, statuses);
  const summary = summarize(rows);
  const doc = await LeadImport.create({
    uploadedBy: user._id,
    fileName: file.originalname,
    fileSize: file.size,
    status: 'preview',
    mapping,
    detectedColumns: headers,
    rows,
    summary,
    progress: 0,
  });
  await recordAudit({
    user: user._id, username: user.username, action: 'lead.import.preview', module: 'imports', recordId: doc.id,
    newValues: { fileName: file.originalname, ...summary }, ...meta,
  });
  return {
    data: publicImport(doc, true),
    message: 'Preview ready',
    status: 201,
  };
}

function summarize(rows, extra = {}) {
  return {
    total: rows.length,
    valid: rows.filter((row) => row.valid).length,
    invalid: rows.filter((row) => !row.valid).length,
    duplicates: rows.filter((row) => row.duplicateLeadId || row.duplicateInFile).length,
    imported: extra.imported || 0,
    updated: extra.updated || 0,
    skipped: extra.skipped || 0,
    failed: extra.failed || 0,
  };
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

function columnsFor(value) {
  const headers = value.detectedColumns || [];
  const sample = value.rows?.[0]?.raw || {};
  return headers.map((header, index) => ({
    letter: columnLetter(index),
    number: index + 1,
    header,
    sample: sample[header] || '',
  }));
}

function publicImport(doc, includeRows) {
  const value = doc.toObject ? doc.toObject() : doc;
  const columns = columnsFor(value);
  if (!includeRows) {
    return { ...value, columns, rows: undefined, rowCount: (value.rows || []).length };
  }
  return { ...value, columns };
}

async function list(user, query) {
  const { page, limit, skip } = paging(query);
  const filter = {};
  if (!['OWNER', 'SUPER_ADMIN'].includes(user.role)) filter.uploadedBy = user._id;
  const [rows, total] = await Promise.all([
    LeadImport.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
      .select('-rows')
      .populate('uploadedBy', 'name username')
      .lean(),
    LeadImport.countDocuments(filter),
  ]);
  return { data: rows, meta: metaFor(page, limit, total) };
}

async function getOne(user, id) {
  const doc = await LeadImport.findById(id).populate('uploadedBy', 'name username');
  if (!doc) throw new AppError('Import not found', 404);
  if (!['OWNER', 'SUPER_ADMIN'].includes(user.role) && String(doc.uploadedBy._id || doc.uploadedBy) !== String(user._id)) {
    throw new AppError('Import not found', 404);
  }
  return { data: publicImport(doc, true) };
}

async function remap(user, id, mapping) {
  const doc = await LeadImport.findById(id);
  if (!doc || doc.status !== 'preview') throw new AppError('Import preview not found', 404);
  const general = await getGeneral();
  const sources = await getLeadSources();
  const statuses = await activeStatuses();
  const rawRows = doc.rows.map((row) => row.raw);
  doc.mapping = mapping;
  doc.rows = await validateRows(rawRows, mapping, general.countryCode, sources, statuses);
  doc.summary = summarize(doc.rows);
  await doc.save();
  return { data: publicImport(doc, true), message: 'Mapping updated' };
}

async function removeDuplicates(user, id) {
  const doc = await LeadImport.findById(id);
  if (!doc || doc.status !== 'preview') throw new AppError('Import preview not found', 404);
  const kept = [];
  const seen = new Set();
  let removed = 0;
  doc.rows.forEach((row) => {
    const phone = row.mapped?.phoneNormalized || '';
    const isDuplicate = Boolean(row.duplicateLeadId) || Boolean(row.duplicateInFile) || (phone && seen.has(phone));
    if (isDuplicate) {
      removed += 1;
      return;
    }
    if (phone) seen.add(phone);
    kept.push(row);
  });
  doc.rows = kept;
  doc.summary = summarize(doc.rows);
  doc.markModified('rows');
  await doc.save();
  return {
    data: publicImport(doc, true),
    message: removed ? `Removed ${removed} duplicate row${removed === 1 ? '' : 's'}` : 'No duplicates to remove',
  };
}

async function commit(user, id, body, meta) {
  const doc = await LeadImport.findById(id);
  if (!doc || !['preview', 'failed'].includes(doc.status)) throw new AppError('Import is not ready to commit', 404);
  if (body.updateExisting && !hasPermission(user, 'leads.edit')) {
    throw new AppError('You do not have permission to update existing leads', 403);
  }
  doc.status = 'processing';
  doc.progress = 0;
  await doc.save();
  const selected = new Set((body.rowNumbers || []).map(Number));
  const general = await getGeneral();
  const sources = await getLeadSources();
  const statuses = await activeStatuses();
  const defaultStatus = statuses.some((item) => item.key === 'fresh') ? 'fresh' : (statuses[0]?.key || 'fresh');
  const leadRole = await assertLeadRole(body.leadRole);
  const firm = await assertLeadFirm(body.firm);
  const source = await assertLeadSource(body.source);
  let assignStaff = null;
  if (body.assignedTo) {
    if (!hasPermission(user, 'leads.assign') && user.role !== 'OWNER') {
      throw new AppError('You do not have permission to assign leads on import', 403);
    }
    assignStaff = await User.findOne({
      _id: body.assignedTo,
      deletedAt: null,
      isActive: true,
      role: { $in: ['STAFF', 'TEAM_LEADER'] },
      ...staffScope(user),
    });
    if (!assignStaff) throw new AppError('Selected staff member was not found or is not assignable', 422);
  }
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const branch = assignStaff?.branch || user.branch || null;
  for (let index = 0; index < doc.rows.length; index += 1) {
    const row = doc.rows[index];
    const selectedRow = !selected.size || selected.has(row.rowNumber);
    if (!selectedRow || !row.valid) {
      row.action = 'skipped';
      skipped += 1;
    } else if (row.duplicateInFile || row.duplicateLeadId) {
      if (row.duplicateLeadId && body.updateExisting && !row.duplicateInFile) {
        try {
          await Lead.updateOne({ _id: row.duplicateLeadId, deletedAt: null }, {
            $set: fieldsFromMapped(row.mapped, sources, defaultStatus),
          });
          row.action = 'updated';
          row.importedLeadId = row.duplicateLeadId;
          updated += 1;
        } catch (error) {
          row.action = 'failed';
          row.rowErrors = [...(row.rowErrors || []), error.message];
          failed += 1;
        }
      } else if (body.skipDuplicates !== false) {
        row.action = 'skipped';
        skipped += 1;
      } else {
        row.action = 'skipped';
        skipped += 1;
      }
    } else {
      try {
        const phoneNormalized = normalizePhone(row.mapped.phone, general.countryCode);
        const mappedFields = fieldsFromMapped(row.mapped, sources, defaultStatus);
        const now = new Date();
        const lead = await Lead.create({
          leadCode: await nextLeadCode(),
          name: row.mapped.name,
          phone: row.mapped.phone,
          phoneNormalized,
          ...mappedFields,
          source,
          leadRole: leadRole.key,
          firm: firm.key,
          branch,
          team: assignStaff?.team || null,
          createdBy: user._id,
          assignedTo: assignStaff ? assignStaff._id : null,
          assignmentDate: assignStaff ? now : undefined,
          bucketStatus: assignStaff ? 'assigned' : 'unassigned',
          callQueueTier: assignStaff
            ? require('../utils/callQueue').resolveCallQueueTier({
              fromSheet: false,
              mode: 'import',
              role: user.role,
            })
            : 3,
          importBatch: doc._id,
          status: mappedFields.status || defaultStatus,
          statusChangedAt: now,
        });
        await addActivity({
          lead, type: 'lead_imported', actor: user,
          description: assignStaff
            ? `Imported from ${doc.fileName} and assigned to ${assignStaff.name}`
            : `Imported from ${doc.fileName}`,
          metadata: { importId: doc.id, rowNumber: row.rowNumber, assignedTo: assignStaff?._id || null },
        });
        if (assignStaff) {
          await LeadAssignment.create({
            lead: lead._id,
            fromStaff: null,
            toStaff: assignStaff._id,
            fromTeam: null,
            toTeam: assignStaff.team || null,
            assignedBy: user._id,
            reason: 'Assigned on Excel import',
            mode: 'import',
          });
          await notify({
            user: assignStaff._id,
            type: 'lead_assigned',
            title: 'New lead assigned',
            body: `${lead.name} (${lead.leadCode})`,
            module: 'leads',
            recordId: lead.id,
            dedupeKey: `assign:${lead.id}:${assignStaff.id}`,
          });
        }
        row.action = 'imported';
        row.importedLeadId = lead._id;
        imported += 1;
      } catch (error) {
        row.action = 'failed';
        row.rowErrors = [...(row.rowErrors || []), error.message];
        failed += 1;
      }
    }
    if (index % 25 === 0) {
      doc.progress = Math.round((index / doc.rows.length) * 100);
      doc.markModified('rows');
      await doc.save();
    }
  }
  doc.status = 'completed';
  doc.progress = 100;
  doc.completedAt = new Date();
  doc.summary = summarize(doc.rows, { imported, updated, skipped, failed });
  doc.markModified('rows');
  await doc.save();
  await recordAudit({
    user: user._id, username: user.username, action: 'lead.import.commit', module: 'imports', recordId: doc.id,
    newValues: doc.summary, ...meta,
  });
  return { data: { id: doc.id, summary: doc.summary, status: doc.status }, message: 'Import completed' };
}

function fieldsFromMapped(mapped, sources, defaultStatus = 'fresh') {
  const revenue = Number(String(mapped.expectedRevenue || '').replace(/[^0-9.]/g, ''));
  const status = mapped.statusKey || defaultStatus;
  let remarks = mapped.remarks || '';
  if (mapped.statusFallback && mapped.excelStage) {
    const note = `Excel stage: ${mapped.excelStage}`;
    remarks = remarks ? `${remarks} · ${note}` : note;
  }
  return {
    alternatePhone: mapped.alternatePhone || '',
    alternatePhoneNormalized: mapped.alternatePhone ? normalizePhone(mapped.alternatePhone) : '',
    email: mapped.email || '',
    company: mapped.company || '',
    consultancyName: mapped.consultancyName || '',
    district: mapped.district || mapped.location || '',
    city: mapped.city || '',
    state: mapped.state || '',
    country: mapped.country || 'India',
    category: mapped.category || '',
    status,
    priority: PRIORITIES.includes(String(mapped.priority || '').toLowerCase()) ? mapped.priority.toLowerCase() : 'high',
    priorityRank: ({ urgent: 40, high: 30, medium: 20, low: 10 })[
      PRIORITIES.includes(String(mapped.priority || '').toLowerCase()) ? mapped.priority.toLowerCase() : 'high'
    ],
    quality: QUALITIES.includes(String(mapped.quality || '').toLowerCase()) ? mapped.quality.toLowerCase() : '',
    expectedRevenue: Number.isFinite(revenue) ? revenue : 0,
    notes: mapped.notes || '',
    comment: mapped.comment || '',
    remarks,
    tags: mapped.tags ? String(mapped.tags).split(/[|,]/).map((tag) => tag.trim()).filter(Boolean) : [],
    source: sources?.includes(mapped.source) ? mapped.source : undefined,
  };
}

async function failureRows(user, id) {
  const doc = await LeadImport.findById(id);
  if (!doc) throw new AppError('Import not found', 404);
  const rows = doc.rows.filter((row) => row.action === 'failed' || (!row.valid && row.action !== 'imported'));
  return rows.map((row) => ({
    Row: row.rowNumber,
    Name: row.mapped?.name || '',
    Phone: row.mapped?.phone || '',
    Errors: (row.rowErrors || []).join('; '),
    Action: row.action || 'invalid',
  }));
}

module.exports = {
  createPreview,
  list,
  getOne,
  remap,
  removeDuplicates,
  commit,
  failureRows,
  detectMapping,
  validateRows,
};
