const ExcelJS = require('exceljs');
const { HourlyReport, CallLog, FollowUp, Lead, LeadActivity, Payment, User } = require('../models');
const { AppError, metaFor } = require('../utils/http');
const { localHourRange, dateKeyFromDate, zonedParts, viewRange, combineLocal } = require('../utils/time');
const { getGeneral } = require('./settings');
const { summarizeCalls } = require('./calls');
const { recordScope, isElevated, staffScope } = require('./access');
const { COMPANY, WON_STATUSES, POSITIVE_STATUSES } = require('../config/constants');

const SHEET_COLUMNS = [
  ['totalCalls', 'Total Calls'],
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
      { $match: { staff: staffId, startedAt: { $gte: start, $lt: end }, callType: 'outgoing' } },
      { $group: {
        _id: null,
        totalCalls: { $sum: 1 },
        connectedCalls: { $sum: { $cond: [{ $eq: ['$status', 'connected'] }, 1, 0] } },
        dnp: { $sum: { $cond: [{ $ne: ['$status', 'connected'] }, 1, 0] } },
        totalCallDuration: { $sum: '$durationSeconds' },
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
  sheet.totalCalls = calls.totalCalls || 0;
  sheet.connectedCalls = calls.connectedCalls || 0;
  sheet.dnp = calls.dnp || 0;
  sheet.totalCallDuration = calls.totalCallDuration || 0;
  sheet.followups = followups;
  sheet.paymentCollected = payments[0]?.amount || 0;
  if (!leadIds.length) return sheet;
  const inHour = { lead: { $in: leadIds }, at: { $gte: start, $lt: end } };
  const [prospective, demoBooked, demoCompleted, interestedToBuy, notInterested, subscriptionClosed, rescheduled] = await Promise.all([
    countDistinct({ ...inHour, type: 'status_changed', newValue: 'positive' }),
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
  sheet.prospective = prospective;
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
  const rows = [];
  for (const person of people) {
    const sheet = await sheetFor(person, bounds.start, bounds.end);
    if (!hasActivity(sheet)) continue;
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

module.exports = {
  list, generate, whatsapp, day, windowReport, exportReport, generateForStaff, generateElapsed, whatsappText, assertHourlySums, SHEET_COLUMNS,
};
