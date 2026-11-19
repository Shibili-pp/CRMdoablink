const ExcelJS = require('exceljs');
const { HourlyReport, HourlyManual, HourlyCheckIn, CallLog, FollowUp, Lead, LeadActivity, Payment, User } = require('../models');
const { AppError, metaFor } = require('../utils/http');
const { localHourRange, dateKeyFromDate, zonedParts, viewRange, combineLocal } = require('../utils/time');
const { getGeneral } = require('./settings');
const { recordAudit } = require('./audit');
const { summarizeCalls } = require('./calls');
const { recordScope, isElevated, staffScope } = require('./access');
const { workingTarget } = require('./targets');
const { COMPANY, WON_STATUSES, POSITIVE_STATUSES } = require('../config/constants');

const SHEET_COLUMNS = [
  ['totalCalls', 'Total Calls'],
  ['incomingCalls', 'Incoming'],
  ['outgoingCalls', 'Outgoing'],
  ['connectedCalls', 'Connected Calls'],
  ['prospective', 'Prospective'],
  ['demoBooked', 'Demo Booked'],
  ['demoCompleted', 'Demo Completed'],
  ['followups', 'Follow-ups'],
  ['interestedToBuy', 'Interested to Buy'],
  ['subscriptionClosed', 'Subscription Closed'],
  ['paymentCollected', 'Payment Collected'],
  ['notInterested', 'Not Interested'],
  ['dnp', 'DNP'],
  ['rescheduled', 'Rescheduled'],
  ['totalCallDuration', 'Total Call Duration'],
];

function emptySheet() {
  return {
    totalCalls: 0,
    incomingCalls: 0,
    outgoingCalls: 0,
    connectedCalls: 0,
    prospective: 0,
    demoBooked: 0,
    demoCompleted: 0,
    followups: 0,
    interestedToBuy: 0,
    subscriptionClosed: 0,
    paymentCollected: 0,
    notInterested: 0,
    dnp: 0,
    rescheduled: 0,
    totalCallDuration: 0,
  };
}

function formatDuration(seconds) {
  const minutes = Math.max(0, Math.round((Number(seconds) || 0) / 60));
  return `${minutes} min`;
}

function formatMoney(amount) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(amount) || 0);
}

function displayValue(key, value) {
  if (key === 'paymentCollected') return formatMoney(value);
  if (key === 'totalCallDuration') return formatDuration(value);
  return Number(value) || 0;
}

function sheetLines(sheet) {
  return SHEET_COLUMNS.map(([key, label]) => `${label}: ${displayValue(key, sheet?.[key])}`);
}

function sumSheets(sheets) {
  const totals = emptySheet();
  sheets.forEach((sheet) => {
    SHEET_COLUMNS.forEach(([key]) => {
      totals[key] += Number(sheet?.[key] || 0);
    });
  });
  return totals;
}

function clock(value, fallback) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  const hour = Math.min(23, Math.max(0, match ? Number(match[1]) : fallback[0]));
  const minute = Math.min(59, Math.max(0, match ? Number(match[2]) : fallback[1]));
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function windowBounds(query, timeZone) {
  const dateKey = typeof query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(query.date)
    ? query.date
    : dateKeyFromDate(new Date(), timeZone);
  const fromFallback = query.fromHour == null || query.fromHour === '' ? [0, 0] : [Number(query.fromHour), 0];
  const toFallback = query.toHour == null || query.toHour === '' ? [23, 59] : [Number(query.toHour), 59];
  let fromTime = clock(query.fromTime, fromFallback);
  let toTime = clock(query.toTime, toFallback);
  if (fromTime > toTime) {
    const swap = fromTime;
    fromTime = toTime;
    toTime = swap;
  }
  const start = combineLocal(dateKey, fromTime, timeZone);
  const end = new Date(combineLocal(dateKey, toTime, timeZone).getTime() + 60000);
  return { dateKey, fromTime, toTime, start, end, label: `${dateKey} ${fromTime}–${toTime}` };
}

function hasActivity(sheet) {
  return SHEET_COLUMNS.some(([key]) => Number(sheet?.[key]) > 0);
}

function cleanValues(values) {
  const next = {};
  SHEET_COLUMNS.forEach(([key]) => {
    if (values?.[key] == null || values[key] === '') return;
    const number = Number(values[key]);
    if (!Number.isFinite(number) || number < 0) return;
    next[key] = key === 'paymentCollected' ? Math.round(number * 100) / 100 : Math.round(number);
  });
  return next;
}

function applyManual(computed, manual) {
  if (!manual?.values) return { ...computed, edited: false };
  return { ...computed, ...cleanValues(manual.values), edited: true };
}

function whatsappText({ name, dateKey, hour, sheet }) {
  const end = String((hour + 1) % 24).padStart(2, '0');
  const start = String(hour).padStart(2, '0');
  return [
    'DoablinkOrbit hourly report',
    `${name}`,
    `${dateKey} ${start}:00–${end}:00`,
    ...sheetLines(sheet),
  ].join('\n');
}

async function countDistinct(match) {
  const rows = await LeadActivity.aggregate([
    { $match: match },
    { $group: { _id: '$lead' } },
    { $count: 'count' },
  ]);
  return rows[0]?.count || 0;
}

async function sheetFor(staff, start, end) {
  const staffId = staff._id;
  const sheet = emptySheet();
  const [callRows, followups, payments, leadIds] = await Promise.all([
    CallLog.aggregate([
      { $match: { staff: staffId, startedAt: { $gte: start, $lt: end } } },
      { $group: {
        _id: null,
        outgoingCalls: { $sum: { $cond: [{ $eq: ['$callType', 'outgoing'] }, 1, 0] } },
        incomingCalls: { $sum: { $cond: [{ $in: ['$callType', ['incoming', 'missed']] }, 1, 0] } },
        connectedCalls: { $sum: { $cond: [{ $and: [{ $eq: ['$callType', 'outgoing'] }, { $eq: ['$status', 'connected'] }] }, 1, 0] } },
        dnp: { $sum: { $cond: [{ $and: [{ $eq: ['$callType', 'outgoing'] }, { $ne: ['$status', 'connected'] }] }, 1, 0] } },
        totalCallDuration: { $sum: { $cond: [{ $eq: ['$callType', 'outgoing'] }, '$durationSeconds', 0] } },
      } },
    ]),
    FollowUp.countDocuments({ assignedTo: staffId, status: 'completed', completedAt: { $gte: start, $lt: end } }),
    Payment.aggregate([
      { $match: { staff: staffId, paidAt: { $gte: start, $lt: end } } },
      { $group: { _id: null, amount: { $sum: '$amount' } } },
    ]),
    Lead.find({ assignedTo: staffId, deletedAt: null }).distinct('_id'),
  ]);
  const calls = callRows[0] || {};
  sheet.incomingCalls = calls.incomingCalls || 0;
  sheet.outgoingCalls = calls.outgoingCalls || 0;
  sheet.totalCalls = sheet.incomingCalls + sheet.outgoingCalls;
  sheet.connectedCalls = calls.connectedCalls || 0;
  sheet.dnp = calls.dnp || 0;
  sheet.totalCallDuration = calls.totalCallDuration || 0;
  sheet.followups = followups;
  sheet.paymentCollected = payments[0]?.amount || 0;
  sheet.prospective = await countDistinct({ actor: staffId, at: { $gte: start, $lt: end }, type: 'pipeline_added' });
  if (!leadIds.length) return sheet;
  const inHour = { lead: { $in: leadIds }, at: { $gte: start, $lt: end } };
  const [demoBooked, demoCompleted, interestedToBuy, notInterested, subscriptionClosed, rescheduled] = await Promise.all([
    countDistinct({ ...inHour, type: 'status_changed', newValue: 'demo_booked' }),
    countDistinct({ ...inHour, type: 'status_changed', newValue: 'demo_completed' }),
    countDistinct({ ...inHour, type: 'status_changed', newValue: 'interested' }),
    countDistinct({ ...inHour, type: 'status_changed', newValue: 'not_interested' }),
    countDistinct({ ...inHour, type: 'status_changed', newValue: { $in: WON_STATUSES } }),
    countDistinct({
      ...inHour,
      $or: [
        { type: 'followup_rescheduled', 'metadata.demo': true },
        { type: 'status_changed', oldValue: 'demo_booked', newValue: { $nin: ['demo_booked', 'demo_completed'] } },
      ],
    }),
  ]);
  sheet.demoBooked = demoBooked;
  sheet.demoCompleted = demoCompleted;
  sheet.interestedToBuy = interestedToBuy;
  sheet.notInterested = notInterested;
  sheet.subscriptionClosed = subscriptionClosed;
  sheet.rescheduled = rescheduled;
  return sheet;
}

async function hourIsStale(existing, staffId, start, end) {
  if (!existing?.sheet) return true;
  const now = new Date();
  if (start <= now && now < end) return true;
  const stamp = existing.generatedAt;
  const [call, payment, follow, activity] = await Promise.all([
    CallLog.exists({ staff: staffId, startedAt: { $gte: start, $lt: end }, createdAt: { $gt: stamp } }),
    Payment.exists({ staff: staffId, paidAt: { $gte: start, $lt: end }, createdAt: { $gt: stamp } }),
    FollowUp.exists({ assignedTo: staffId, completedAt: { $gte: start, $lt: end }, updatedAt: { $gt: stamp } }),
    LeadActivity.exists({ actor: staffId, at: { $gt: stamp, $gte: start, $lt: end } }),
  ]);
  return Boolean(call || payment || follow || activity);
}

async function generateForStaff(staff, dateKey, hour, timezone) {
  const { start, end } = localHourRange(dateKey, hour, timezone);
  const callMatch = { staff: staff._id, startedAt: { $gte: start, $lt: end } };
  const [callMetrics, sheet] = await Promise.all([
    summarizeCalls(callMatch),
    sheetFor(staff, start, end),
  ]);
  const leadIds = await Lead.find({ assignedTo: staff._id, deletedAt: null }).distinct('_id');
  const [positiveLeads, interestedLeads, demosBooked, followupsCompleted, freshLeadsContacted, notes] = await Promise.all([
    LeadActivity.countDocuments({ lead: { $in: leadIds }, at: { $gte: start, $lt: end }, type: 'status_changed', newValue: { $in: POSITIVE_STATUSES } }),
    LeadActivity.countDocuments({ lead: { $in: leadIds }, at: { $gte: start, $lt: end }, type: 'status_changed', newValue: 'interested' }),
    LeadActivity.countDocuments({ lead: { $in: leadIds }, at: { $gte: start, $lt: end }, type: 'status_changed', newValue: 'demo_booked' }),
    FollowUp.countDocuments({ assignedTo: staff._id, status: 'completed', completedAt: { $gte: start, $lt: end } }),
    Lead.countDocuments({ assignedTo: staff._id, deletedAt: null, firstContactAt: { $gte: start, $lt: end } }),
    LeadActivity.countDocuments({ actor: staff._id, at: { $gte: start, $lt: end }, type: 'note_added' }),
  ]);
  const activityMetrics = { positiveLeads, interestedLeads, demosBooked, followupsCompleted, freshLeadsContacted, notes };
  const text = whatsappText({ name: staff.name, dateKey, hour, sheet });
  const report = await HourlyReport.findOneAndUpdate(
    { staff: staff._id, periodStart: start },
    {
      staff: staff._id,
      team: staff.team,
      branch: staff.branch,
      periodStart: start,
      periodEnd: end,
      dateKey,
      hour,
      timezone,
      callMetrics,
      activityMetrics,
      sheet,
      sourceBreakdown: callMetrics.bySource,
      whatsappText: text,
      generatedAt: new Date(),
    },
    { upsert: true, new: true }
  );
  return report;
}

async function generateElapsed(dateKey, staffId) {
  const general = await getGeneral();
  const now = new Date();
  const todayKey = dateKeyFromDate(now, general.timezone);
  const currentHour = zonedParts(now, general.timezone).hour;
  const lastHour = dateKey === todayKey ? currentHour : 23;
  const people = staffId
    ? await User.find({ _id: staffId, deletedAt: null })
    : await User.find({ deletedAt: null, isActive: true, role: { $in: ['STAFF', 'TEAM_LEADER'] } });
  const reports = [];
  for (const person of people) {
    for (let hour = 0; hour <= lastHour; hour += 1) {
      const { start, end } = localHourRange(dateKey, hour, general.timezone);
      if (start > now) continue;
      const existing = await HourlyReport.findOne({ staff: person._id, periodStart: start }).select('generatedAt sheet');
      if (existing && !(await hourIsStale(existing, person._id, start, end))) {
        reports.push(existing);
        continue;
      }
      reports.push(await generateForStaff(person, dateKey, hour, general.timezone));
    }
  }
  return reports;
}

function pageOf(query) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(300, Math.max(1, Number(query.limit) || 100));
  return { page, limit, skip: (page - 1) * limit };
}

async function list(user, query) {
  const general = await getGeneral();
  const dateKey = query.date || dateKeyFromDate(new Date(), general.timezone);
  let staffId = query.staff;
  if (user.role === 'STAFF') staffId = String(user._id);
  const shouldEnsure = query.ensure === '1' || Boolean(staffId);
  if (shouldEnsure) await generateElapsed(dateKey, staffId);
  const { page, limit, skip } = pageOf(query);
  const filter = { dateKey, ...recordScope(user, { staff: 'staff' }) };
  if (staffId && user.role !== 'STAFF') filter.staff = staffId;
  if (query.team && isElevated(user)) filter.team = query.team;
  const [rows, total] = await Promise.all([
    HourlyReport.find(filter).sort({ hour: 1 }).skip(skip).limit(limit).populate('staff', 'name').lean(),
    HourlyReport.countDocuments(filter),
  ]);
  return { data: rows, meta: metaFor(page, limit, total) };
}

async function peopleFor(user, query) {
  if (user.role === 'STAFF') return User.find({ _id: user._id }).select('name team branch');
  const filter = { deletedAt: null, isActive: true, role: { $in: ['STAFF', 'TEAM_LEADER'] }, ...staffScope(user) };
  if (query.staff) filter._id = query.staff;
  return User.find(filter).select('name team branch').sort({ name: 1 });
}

async function windowReport(user, query) {
  const general = await getGeneral();
  const bounds = windowBounds(query, general.timezone);
  const people = await peopleFor(user, query);
  const manuals = await HourlyManual.find({
    staff: { $in: people.map((person) => person._id) },
    dateKey: bounds.dateKey,
    fromTime: bounds.fromTime,
    toTime: bounds.toTime,
  }).lean();
  const manualByStaff = new Map(manuals.map((row) => [String(row.staff), row]));
  const rows = [];
  for (const person of people) {
    const computed = await sheetFor(person, bounds.start, bounds.end);
    const manual = manualByStaff.get(String(person._id));
    const sheet = applyManual(computed, manual);
    if (!hasActivity(sheet) && !manual) continue;
    rows.push({ staffId: person._id, name: person.name, ...sheet });
  }
  const totals = sumSheets(rows);
  const blocks = rows.map((row) => ['DoablinkOrbit hourly report', row.name, bounds.label, ...sheetLines(row)].join('\n'));
  if (rows.length) blocks.push(['Total for selected time', bounds.label, ...sheetLines(totals)].join('\n'));
  return {
    data: {
      period: bounds,
      rows,
      totals: { name: 'Total', ...totals },
      text: blocks.join('\n\n'),
    },
  };
}

async function day(user, query) {
  const general = await getGeneral();
  const range = viewRange(query, general.timezone);
  const people = await peopleFor(user, query);
  const rows = [];
  for (const person of people) {
    const sheet = await sheetFor(person, range.start, range.end);
    if (!hasActivity(sheet)) continue;
    rows.push({ staffId: person._id, name: person.name, ...sheet });
  }
  const totals = sumSheets(rows);
  const columns = SHEET_COLUMNS.map(([key, label]) => ({ key, label }));
  const blocks = rows.map((row) => ['DoablinkOrbit day report', row.name, range.label, ...sheetLines(row)].join('\n'));
  blocks.push(['Total', range.label, ...sheetLines(totals)].join('\n'));
  return {
    data: {
      period: { preset: range.preset, label: range.label, from: range.from, to: range.to, start: range.start, end: range.end },
      columns,
      rows,
      totals: { name: 'Total', ...totals },
      text: blocks.join('\n\n'),
    },
  };
}

async function personInScope(user, staffId) {
  const people = await peopleFor(user, { staff: staffId });
  return people.find((person) => String(person._id) === String(staffId));
}

function assertCanEdit(user) {
  if (user.role === 'STAFF') throw new AppError('Staff cannot edit hourly numbers', 403);
}

async function saveManual(user, body, meta) {
  assertCanEdit(user);
  const person = await personInScope(user, body.staffId);
  if (!person) throw new AppError('That person is outside your report', 403);
  const general = await getGeneral();
  const bounds = windowBounds(body, general.timezone);
  const values = cleanValues(body.values);
  const doc = await HourlyManual.findOneAndUpdate(
    { staff: person._id, dateKey: bounds.dateKey, fromTime: bounds.fromTime, toTime: bounds.toTime },
    {
      staff: person._id,
      team: person.team,
      branch: person.branch,
      dateKey: bounds.dateKey,
      fromTime: bounds.fromTime,
      toTime: bounds.toTime,
      periodStart: bounds.start,
      periodEnd: bounds.end,
      values,
      updatedBy: user._id,
    },
    { upsert: true, new: true }
  );
  await recordAudit({
    user: user._id, username: user.username, action: 'hourly.manual', module: 'hourly', recordId: doc.id,
    newValues: { staff: person.name, period: bounds.label, values }, ...meta,
  });
  return { data: { id: doc.id, staffId: person._id, ...values, edited: true }, message: 'Hourly numbers saved' };
}

async function clearManual(user, body, meta) {
  assertCanEdit(user);
  const person = await personInScope(user, body.staffId);
  if (!person) throw new AppError('That person is outside your report', 403);
  const general = await getGeneral();
  const bounds = windowBounds(body, general.timezone);
  const removed = await HourlyManual.findOneAndDelete({
    staff: person._id, dateKey: bounds.dateKey, fromTime: bounds.fromTime, toTime: bounds.toTime,
  });
  if (removed) {
    await recordAudit({
      user: user._id, username: user.username, action: 'hourly.manual.clear', module: 'hourly', recordId: removed.id,
      oldValues: { staff: person.name, period: bounds.label }, ...meta,
    });
  }
  return { data: { cleared: Boolean(removed) }, message: 'Activity numbers restored' };
}

async function generate(user, body) {
  const general = await getGeneral();
  const dateKey = body.date || dateKeyFromDate(new Date(), general.timezone);
  const hour = body.hour != null ? Number(body.hour) : (zonedParts(new Date(), general.timezone).hour + 23) % 24;
  const people = body.staffId
    ? await User.find({ _id: body.staffId, deletedAt: null })
    : await User.find({ deletedAt: null, isActive: true, role: { $in: ['STAFF', 'TEAM_LEADER'] }, ...(isElevated(user) ? {} : { branch: user.branch }) });
  const reports = [];
  for (const person of people) {
    reports.push(await generateForStaff(person, dateKey, hour, general.timezone));
  }
  return { data: reports, message: 'Hourly reports generated' };
}

async function whatsapp(user, query) {
  const result = await windowReport(user, query);
  if (!result.data.rows.length) throw new AppError('No hourly report is available for that selection', 404);
  return { data: { text: result.data.text, fromTime: result.data.period.fromTime, toTime: result.data.period.toTime } };
}

function excelRows(headers, records) {
  return records.map((record) => headers.map((header) => {
    if (header === 'Hour') return record.hour;
    if (header === 'Staff') return record.staff;
    const column = SHEET_COLUMNS.find(([, label]) => label === header);
    if (!column) return '';
    const [key] = column;
    if (key === 'totalCallDuration') return formatDuration(record[key]);
    return Number(record[key] || 0);
  }));
}

async function toXlsx(title, periodLabel, headers, records) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = COMPANY.productName;
  const sheet = workbook.addWorksheet(title.slice(0, 28) || 'Report');
  sheet.addRow([COMPANY.productName, periodLabel]);
  sheet.getRow(1).font = { bold: true, color: { argb: 'FF002546' } };
  sheet.addRow(headers);
  sheet.getRow(2).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF002546' } };
  excelRows(headers, records).forEach((cells) => sheet.addRow(cells));
  headers.forEach((header, index) => {
    sheet.getColumn(index + 1).width = Math.min(28, Math.max(14, header.length + 2));
  });
  const paymentIndex = headers.indexOf('Payment Collected') + 1;
  if (paymentIndex > 0) {
    for (let row = 3; row <= sheet.rowCount; row += 1) {
      sheet.getRow(row).getCell(paymentIndex).numFmt = '"₹"#,##0';
    }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function exportReport(user, query) {
  const headers = ['Staff', ...SHEET_COLUMNS.map(([, label]) => label)];
  let title;
  let periodLabel;
  let records;
  let filename;
  if (query.view === 'day') {
    const result = await day(user, query);
    title = 'Day report';
    periodLabel = result.data.period.label;
    records = [
      ...result.data.rows.map((row) => ({ ...row, staff: row.name })),
      { ...result.data.totals, staff: 'Total' },
    ];
    filename = `doablinkorbit-day-report-${result.data.period.from}-to-${result.data.period.to}.xlsx`;
  } else {
    const result = await windowReport(user, query);
    title = 'Hourly report';
    periodLabel = result.data.period.label;
    records = [
      ...result.data.rows.map((row) => ({ ...row, staff: row.name })),
      ...(result.data.rows.length ? [{ ...result.data.totals, staff: 'Total' }] : []),
    ];
    const fromStamp = result.data.period.fromTime.replace(':', '');
    const toStamp = result.data.period.toTime.replace(':', '');
    filename = `doablinkorbit-hourly-report-${result.data.period.dateKey}-${fromStamp}-${toStamp}.xlsx`;
  }
  const buffer = await toXlsx(title, periodLabel, headers, records);
  return {
    download: {
      buffer,
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename,
    },
  };
}

async function assertHourlySums(staffId, dateKey) {
  const reports = await HourlyReport.find({ staff: staffId, dateKey });
  const summed = reports.reduce((total, report) => total + (report.callMetrics?.total || 0), 0);
  const general = await getGeneral();
  const first = localHourRange(dateKey, 0, general.timezone).start;
  const last = localHourRange(dateKey, 23, general.timezone).end;
  const actual = await CallLog.countDocuments({ staff: staffId, startedAt: { $gte: first, $lt: last } });
  return { summed, actual, matches: summed === actual };
}

function minutesOf(value) {
  const match = String(value || '').match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function shiftHoursOf(start, end) {
  const span = minutesOf(end) - minutesOf(start);
  const wallHours = span > 0 ? span / 60 : 1;
  // Wall clock includes a 1-hour lunch break; hourly KPI uses the productive hours only.
  return Math.max(1, wallHours - 1);
}

function completedWorkHours(start, end, parts) {
  const startMin = minutesOf(start);
  const endMin = minutesOf(end);
  const nowMin = parts.hour * 60 + parts.minute;
  if (startMin == null || endMin == null || endMin <= startMin) return [];
  const hours = [];
  for (let hour = 0; hour < 24; hour += 1) {
    const open = hour * 60;
    const close = open + 60;
    if (open >= startMin && close <= endMin && close <= nowMin) hours.push(hour);
  }
  return hours;
}

function countLabel(value) {
  const rounded = Math.round(Number(value) * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

async function uniqueOutgoing(staffId, start, end) {
  const rows = await CallLog.aggregate([
    { $match: { staff: staffId, callType: 'outgoing', startedAt: { $gte: start, $lt: end }, phoneNormalized: { $nin: [null, ''] } } },
    { $group: { _id: '$phoneNormalized' } },
    { $count: 'count' },
  ]);
  return rows[0]?.count || 0;
}

async function staffShift(user) {
  let start = user.workStart;
  let end = user.workEnd;
  const missingStart = minutesOf(start) == null;
  const missingEnd = minutesOf(end) == null;
  if (user.role === 'STAFF' && (missingStart || missingEnd)) {
    start = missingStart ? '11:00' : start;
    end = missingEnd ? '20:00' : end;
    await User.updateOne({ _id: user._id }, { $set: { workStart: start, workEnd: end } });
  }
  if (minutesOf(start) == null) start = '11:00';
  if (minutesOf(end) == null) end = '20:00';
  return { start, end };
}

function metricActual(metric, sheet, unique) {
  if (metric.key === 'uniqueProspects') return unique;
  if (metric.unit === 'minutes') return Number(sheet.totalCallDuration) || 0;
  return Number(sheet[metric.sheet]) || 0;
}

function metricTarget(metric, hours) {
  if (metric.unit === 'minutes') return (metric.daily / hours) * 60;
  return metric.daily / hours;
}

function metricLabels(metric, actual, target) {
  if (metric.unit === 'minutes') {
    return { actualLabel: formatDuration(actual), targetLabel: formatDuration(target) };
  }
  return {
    actualLabel: countLabel(actual),
    targetLabel: String(Math.max(0, Math.round(Number(target) || 0))),
  };
}

async function buildHourCheck(user, dateKey, hour, timezone) {
  const standard = await workingTarget();
  const { start, end } = localHourRange(dateKey, hour, timezone);
  const person = await User.findById(user._id).select('name team branch workStart workEnd role');
  const shift = await staffShift(person || user);
  const hours = shiftHoursOf(shift.start, shift.end);
  const [computed, manual, unique] = await Promise.all([
    sheetFor(person || user, start, end),
    HourlyManual.findOne({
      staff: user._id,
      dateKey,
      fromTime: `${String(hour).padStart(2, '0')}:00`,
      toTime: `${String(hour).padStart(2, '0')}:59`,
    }).lean(),
    uniqueOutgoing(user._id, start, end),
  ]);
  const sheet = applyManual(computed, manual);
  const checks = standard.metrics.map((metric) => {
    const actual = metricActual(metric, sheet, unique);
    const target = metricTarget(metric, hours);
    const labels = metricLabels(metric, actual, target);
    return {
      key: metric.key,
      label: metric.label,
      unit: metric.unit,
      actual,
      target,
      short: metric.unit === 'minutes'
        ? Math.round(actual / 60) < Math.round(target / 60)
        : actual < Math.round(target),
      ...labels,
    };
  });
  const gaps = checks.filter((row) => row.short).map((row) => ({
    key: row.key, label: row.label, actual: row.actual, target: row.target, unit: row.unit,
  }));
  const fromLabel = String(hour);
  const toLabel = String((hour + 1) % 24);
  return {
    dateKey,
    hour,
    fromLabel,
    toLabel,
    label: `${fromLabel}–${toLabel}`,
    workStart: shift.start,
    workEnd: shift.end,
    shiftHours: hours,
    reportText: whatsappText({ name: (person || user).name, dateKey, hour, sheet }),
    checks,
    gaps,
    reached: gaps.length === 0,
  };
}

async function dueCheckIn(user) {
  if (user.role !== 'STAFF') return { data: null };
  const general = await getGeneral();
  const now = new Date();
  const dateKey = dateKeyFromDate(now, general.timezone);
  const shift = await staffShift(user);
  const finished = completedWorkHours(shift.start, shift.end, zonedParts(now, general.timezone));
  if (!finished.length) return { data: null };
  const done = await HourlyCheckIn.find({ staff: user._id, dateKey, hour: { $in: finished } }).select('hour').lean();
  const doneHours = new Set(done.map((row) => row.hour));
  const waiting = finished.filter((hour) => !doneHours.has(hour));
  if (!waiting.length) return { data: null };
  const current = await buildHourCheck(user, dateKey, waiting[0], general.timezone);
  return { data: { ...current, pending: waiting.length } };
}

async function submitCheckIn(user, body) {
  if (user.role !== 'STAFF') throw new AppError('Only staff submit the hourly report', 403);
  const due = await dueCheckIn(user);
  if (!due.data) throw new AppError('No hourly report is waiting', 404);
  if (due.data.dateKey !== body.dateKey || due.data.hour !== Number(body.hour)) {
    throw new AppError('Submit the hour that is waiting', 422);
  }
  const reason = String(body.reason || '').trim();
  if (!due.data.reached && reason.length < 3) throw new AppError('Enter why the target was not reached', 422);
  try {
    await HourlyCheckIn.create({
      staff: user._id,
      team: user.team || null,
      branch: user.branch || null,
      dateKey: due.data.dateKey,
      hour: due.data.hour,
      fromLabel: due.data.fromLabel,
      toLabel: due.data.toLabel,
      reportText: due.data.reportText,
      sheet: {},
      gaps: due.data.gaps,
      reached: due.data.reached,
      reason: due.data.reached ? '' : reason,
      submittedAt: new Date(),
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }
  return { data: { submitted: true }, message: 'Hourly report submitted' };
}

async function listCheckIns(user, query) {
  const general = await getGeneral();
  const dateKey = query.date || dateKeyFromDate(new Date(), general.timezone);
  const filter = { dateKey, ...recordScope(user, { staff: 'staff' }) };
  const rows = await HourlyCheckIn.find(filter).sort({ hour: 1 }).populate('staff', 'name role').lean();
  return {
    data: rows.map((row) => ({
      id: String(row._id),
      staffId: row.staff?._id ? String(row.staff._id) : String(row.staff),
      staffName: row.staff?.name || 'Staff',
      dateKey: row.dateKey,
      hour: row.hour,
      label: `${row.fromLabel}–${row.toLabel}`,
      reportText: row.reportText || '',
      gaps: row.gaps || [],
      reached: row.reached,
      reason: row.reason || '',
      submittedAt: row.submittedAt,
    })),
  };
}

module.exports = {
  list, generate, whatsapp, day, windowReport, exportReport, saveManual, clearManual, generateForStaff, generateElapsed, whatsappText, assertHourlySums, SHEET_COLUMNS,
  dueCheckIn, submitCheckIn, listCheckIns,
};
