const xlsx = require('xlsx');
const { LeadImport, Lead } = require('../models');
const { AppError, paging, metaFor } = require('../utils/http');
const { normalizePhone, isValidPhone } = require('../utils/phone');
const { HEADER_ALIASES, IMPORT_FIELDS, PRIORITIES, QUALITIES } = require('../config/constants');
const { getGeneral, getLeadSources } = require('./settings');
const { nextLeadCode, presentLead } = require('./leads');
const { addActivity } = require('./activity');
const { recordAudit } = require('./audit');
const { hasPermission } = require('./access');

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

async function validateRows(rawRows, mapping, countryCode, sources) {
  const prepared = rawRows.map((raw, index) => ({ raw, mapped: applyMapping(raw, mapping), rowNumber: index + 2 }));
  const seen = new Map();
  const phones = prepared.map((row) => normalizePhone(row.mapped.phone, countryCode)).filter(Boolean);
  const existing = phones.length
    ? await Lead.find({ deletedAt: null, phoneNormalized: { $in: phones } }).select('phoneNormalized leadCode').lean()
    : [];
  const existingByPhone = new Map(existing.map((lead) => [lead.phoneNormalized, lead]));
  return prepared.map((row) => {
    const errors = [];
    const phoneNormalized = normalizePhone(row.mapped.phone, countryCode);
    if (!row.mapped.name) errors.push('Name is required');
    if (!row.mapped.phone) errors.push('Phone is required');
    else if (!isValidPhone(phoneNormalized)) errors.push('Phone number is invalid');
    if (row.mapped.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.mapped.email)) errors.push('Email is invalid');
    if (row.mapped.source && !sources.includes(row.mapped.source)) errors.push('Source is not configured');
    if (row.mapped.priority && !PRIORITIES.includes(row.mapped.priority.toLowerCase())) errors.push('Priority is invalid');
    if (row.mapped.quality && !QUALITIES.includes(row.mapped.quality.toLowerCase())) errors.push('Quality is invalid');
    let duplicateInFile = false;
    if (phoneNormalized) {
      if (seen.has(phoneNormalized)) duplicateInFile = true;
      seen.set(phoneNormalized, row.rowNumber);
    }
    const existingLead = phoneNormalized ? existingByPhone.get(phoneNormalized) : null;
    return {
      rowNumber: row.rowNumber,
      raw: row.raw,
      mapped: { ...row.mapped, phoneNormalized },
      rowErrors: errors,
      duplicateInFile,
      duplicateLeadId: existingLead?._id,
      duplicateLeadCode: existingLead?.leadCode || '',
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
  const rows = await validateRows(rawRows, mapping, general.countryCode, sources);
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

function publicImport(doc, includeRows) {
  const value = doc.toObject ? doc.toObject() : doc;
  if (!includeRows) {
    return { ...value, rows: undefined, rowCount: (value.rows || []).length };
  }
  return value;
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
  const rawRows = doc.rows.map((row) => row.raw);
  doc.mapping = mapping;
  doc.rows = await validateRows(rawRows, mapping, general.countryCode, sources);
  doc.summary = summarize(doc.rows);
  await doc.save();
  return { data: publicImport(doc, true), message: 'Mapping updated' };
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
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const branch = user.branch || null;
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
            $set: fieldsFromMapped(row.mapped, sources),
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
        const lead = await Lead.create({
          leadCode: await nextLeadCode(),
          name: row.mapped.name,
          phone: row.mapped.phone,
          phoneNormalized,
          ...fieldsFromMapped(row.mapped, sources),
          source: sources.includes(row.mapped.source) ? row.mapped.source : 'Manual Upload',
          branch,
          createdBy: user._id,
          assignedTo: null,
          bucketStatus: 'unassigned',
          importBatch: doc._id,
          status: 'fresh',
        });
        await addActivity({
          lead, type: 'lead_imported', actor: user,
          description: `Imported from ${doc.fileName}`,
          metadata: { importId: doc.id, rowNumber: row.rowNumber },
        });
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

function fieldsFromMapped(mapped, sources) {
  const revenue = Number(String(mapped.expectedRevenue || '').replace(/[^0-9.]/g, ''));
  return {
    alternatePhone: mapped.alternatePhone || '',
    alternatePhoneNormalized: mapped.alternatePhone ? normalizePhone(mapped.alternatePhone) : '',
    email: mapped.email || '',
    company: mapped.company || '',
    district: mapped.district || '',
    city: mapped.city || '',
    state: mapped.state || '',
    country: mapped.country || 'India',
    category: mapped.category || '',
    priority: PRIORITIES.includes(String(mapped.priority || '').toLowerCase()) ? mapped.priority.toLowerCase() : 'medium',
    quality: QUALITIES.includes(String(mapped.quality || '').toLowerCase()) ? mapped.quality.toLowerCase() : '',
    expectedRevenue: Number.isFinite(revenue) ? revenue : 0,
    notes: mapped.notes || '',
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
  commit,
  failureRows,
  detectMapping,
  validateRows,
};
