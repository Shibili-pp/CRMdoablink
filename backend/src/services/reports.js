const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const {
  Lead, User, FollowUp, CallLog, Payment, RevenueOpportunity, LeadAssignment,
  LeadSwapRequest, LeadActivity, HourlyReport, Target, Team,
} = require('../models');
const { AppError } = require('../utils/http');
const { formatPhone } = require('../utils/phone');
const { periodRange } = require('../utils/time');
const { getGeneral } = require('./settings');
const { leadScope, recordScope, isElevated } = require('./access');
const { summarizeCalls, callFilter } = require('./calls');
const { withProgress } = require('./targets');
const { POSITIVE_STATUSES, WON_STATUSES, LOST_STATUSES, COMPANY } = require('../config/constants');
const { recordAudit } = require('./audit');

function leadBase(user, query) {
  const filter = { deletedAt: null, ...leadScope(user) };
  if (query.status) filter.status = query.status;
  if (query.source) filter.source = query.source;
  if (query.staff && user.role !== 'STAFF') filter.assignedTo = query.staff;
  if (query.team && user.role !== 'STAFF') filter.team = query.team;
  if (query.branch && isElevated(user)) filter.branch = query.branch;
  if (query.startDate || query.endDate) {
    filter.createdAt = {};
    if (query.startDate) filter.createdAt.$gte = new Date(query.startDate);
    if (query.endDate) filter.createdAt.$lte = new Date(query.endDate);
  }
  if (query.q) filter.name = { $regex: String(query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  return filter;
}

function rangeMatch(query, field) {
  if (!query.startDate && !query.endDate) return {};
  const match = {};
  match[field] = {};
  if (query.startDate) match[field].$gte = new Date(query.startDate);
  if (query.endDate) match[field].$lte = new Date(query.endDate);
  return match;
}

async function staffPerformance(user, query) {
  const filter = { deletedAt: null, isActive: true, role: { $in: ['STAFF', 'TEAM_LEADER'] } };
  if (!isElevated(user)) filter.branch = user.branch;
  if (user.role === 'TEAM_LEADER') filter.team = user.team;
  if (query.staff) filter._id = query.staff;
  const people = await User.find(filter).populate('team', 'name').lean();
  const rows = [];
  for (const person of people) {
    const calls = await summarizeCalls({ staff: person._id, ...rangeMatch(query, 'startedAt') });
    const leads = await Lead.countDocuments({ deletedAt: null, assignedTo: person._id });
    const won = await Lead.countDocuments({ deletedAt: null, assignedTo: person._id, status: { $in: WON_STATUSES } });
    const overdue = await FollowUp.countDocuments({ assignedTo: person._id, status: { $in: ['pending', 'missed'] }, dueAt: { $lt: new Date() } });
    rows.push({
      Staff: person.name,
      Team: person.team?.name || '',
      Leads: leads,
      Won: won,
      'Conversion %': leads ? Math.round((won / leads) * 1000) / 10 : 0,
      Calls: calls.total,
      Connected: calls.connected,
      'Talk minutes': Math.round((calls.totalDuration || 0) / 60),
      'Overdue follow-ups': overdue,
    });
  }
  return rows;
}

async function teamPerformance(user) {
  const filter = { deletedAt: null };
  if (!isElevated(user)) filter.branch = user.branch;
  const teams = await Team.find(filter).lean();
  const rows = [];
  for (const team of teams) {
    const leads = await Lead.countDocuments({ deletedAt: null, team: team._id });
    const won = await Lead.countDocuments({ deletedAt: null, team: team._id, status: { $in: WON_STATUSES } });
    const calls = await summarizeCalls({ team: team._id });
    rows.push({ Team: team.name, Leads: leads, Won: won, Calls: calls.total, Connected: calls.connected, 'Talk seconds': calls.totalDuration });
  }
  return rows;
}

const REPORTS = {
  staff_performance: { title: 'Staff-wise performance', run: staffPerformance },
  team_performance: { title: 'Team-wise performance', run: (user) => teamPerformance(user) },
  lead_history: {
    title: 'Lead-wise history',
    run: async (user, query) => {
      const leads = await Lead.find(leadBase(user, query)).select('_id leadCode name').limit(200).lean();
      const activities = await LeadActivity.find({ lead: { $in: leads.map((lead) => lead._id) } }).sort({ at: -1 }).limit(2000).lean();
      const byLead = new Map(leads.map((lead) => [String(lead._id), lead]));
      return activities.map((row) => ({
        'Lead ID': byLead.get(String(row.lead))?.leadCode || '',
        Lead: byLead.get(String(row.lead))?.name || '',
        When: new Date(row.at).toISOString(),
        Type: row.type,
        Staff: row.actorName || '',
        Description: row.description,
      }));
    },
  },
  lead_source: {
    title: 'Lead source performance',
    run: async (user, query) => {
      const rows = await Lead.aggregate([
        { $match: leadBase(user, query) },
        { $group: {
          _id: '$source',
          leads: { $sum: 1 },
          won: { $sum: { $cond: [{ $in: ['$status', WON_STATUSES] }, 1, 0] } },
          expected: { $sum: '$expectedRevenue' },
        } },
        { $sort: { leads: -1 } },
      ]);
      return rows.map((row) => ({
        Source: row._id || 'Unknown', Leads: row.leads, Won: row.won,
        'Conversion %': row.leads ? Math.round((row.won / row.leads) * 1000) / 10 : 0,
        'Lead-stated expected': row.expected,
      }));
    },
  },
  lead_assignment: {
    title: 'Lead assignment report',
    run: async (user, query) => {
      const ids = await Lead.find(leadBase(user, query)).distinct('_id');
      const rows = await LeadAssignment.find({ lead: { $in: ids }, ...rangeMatch(query, 'createdAt') })
        .sort({ createdAt: -1 }).limit(2000).populate('lead', 'leadCode').populate('fromStaff', 'name').populate('toStaff', 'name').populate('assignedBy', 'name').lean();
      return rows.map((row) => ({
        When: new Date(row.createdAt).toISOString(),
        'Lead ID': row.lead?.leadCode || '',
        From: row.fromStaff?.name || '',
        To: row.toStaff?.name || 'Bucket',
        By: row.assignedBy?.name || '',
        Mode: row.mode,
        Reason: row.reason || '',
      }));
    },
  },
  lead_swap: {
    title: 'Lead swap report',
    run: async (user, query) => {
      const ids = await Lead.find(leadBase(user, query)).distinct('_id');
      const rows = await LeadSwapRequest.find({ lead: { $in: ids } }).sort({ createdAt: -1 }).limit(2000)
        .populate('lead', 'leadCode').populate('requestedBy', 'name').populate('fromStaff', 'name').populate('toStaff', 'name').lean();
      return rows.map((row) => ({
        When: new Date(row.createdAt).toISOString(),
        'Lead ID': row.lead?.leadCode || '',
        From: row.fromStaff?.name || '',
        To: row.toStaff?.name || '',
        RequestedBy: row.requestedBy?.name || '',
        Status: row.status,
        Reason: row.reason,
      }));
    },
  },
  lead_conversion: {
    title: 'Lead conversion report',
    run: async (user, query) => staffPerformance(user, query),
  },
  lost_leads: {
    title: 'Lost lead report',
    run: async (user, query) => {
      const rows = await Lead.find({ ...leadBase(user, query), status: { $in: LOST_STATUSES } }).limit(2000).populate('assignedTo', 'name').lean();
      return rows.map((row) => ({
        'Lead ID': row.leadCode, Name: row.name, Phone: formatPhone(row.phoneNormalized), Status: row.status,
        Reason: row.lostReason || '', Staff: row.assignedTo?.name || '', Source: row.source,
      }));
    },
  },
  followups: {
    title: 'Follow-up report',
    run: async (user, query) => {
      const rows = await FollowUp.find({ ...recordScope(user, { staff: 'assignedTo' }), ...rangeMatch(query, 'dueAt') }).limit(2000).lean();
      return rows.map((row) => ({
        'Lead ID': row.leadCode, Lead: row.leadName, Title: row.title, Due: new Date(row.dueAt).toISOString(),
        Status: row.status, 'On time': row.completedOnTime == null ? '' : row.completedOnTime ? 'Yes' : 'No',
      }));
    },
  },
  overdue_followups: {
    title: 'Overdue follow-up report',
    run: async (user) => {
      const rows = await FollowUp.find({
        ...recordScope(user, { staff: 'assignedTo' }),
        status: { $in: ['pending', 'missed'] },
        dueAt: { $lt: new Date() },
      }).limit(2000).lean();
      return rows.map((row) => ({
        'Lead ID': row.leadCode, Lead: row.leadName, Title: row.title, Due: new Date(row.dueAt).toISOString(), Status: row.status,
      }));
    },
  },
  hourly_performance: {
    title: 'Hourly performance report',
    run: async (user, query) => {
      const filter = { ...recordScope(user, { staff: 'staff' }) };
      if (query.date) filter.dateKey = query.date;
      const rows = await HourlyReport.find(filter).sort({ dateKey: 1, hour: 1 }).limit(2000).populate('staff', 'name').lean();
      return rows.map((row) => ({
        Date: row.dateKey, Hour: row.hour, Staff: row.staff?.name || '',
        Calls: row.callMetrics?.total || 0, Connected: row.callMetrics?.connected || 0,
        Unique: row.callMetrics?.uniqueNumbers || 0,
        'Follow-ups completed': row.activityMetrics?.followupsCompleted || 0,
      }));
    },
  },
  daily_performance: { title: 'Daily performance report', run: (user, query) => periodPerformance(user, query, 'day') },
  weekly_performance: { title: 'Weekly performance report', run: (user, query) => periodPerformance(user, query, 'week') },
  monthly_performance: { title: 'Monthly performance report', run: (user, query) => periodPerformance(user, query, 'month') },
  call_analytics: {
    title: 'Call analytics report',
    run: async (user, query) => {
      const summary = await summarizeCalls(callFilter(user, query));
      return [
        { Metric: 'Total calls', Value: summary.total },
        { Metric: 'Outgoing', Value: summary.outgoing },
        { Metric: 'Incoming', Value: summary.incoming },
        { Metric: 'Connected', Value: summary.connected },
        { Metric: 'Not connected', Value: summary.notConnected },
        { Metric: 'Missed', Value: summary.missed },
        { Metric: 'Unique numbers', Value: summary.uniqueNumbers },
        { Metric: 'Repeat calls', Value: summary.repeatCalls },
        { Metric: 'Talk seconds', Value: summary.totalDuration },
        { Metric: 'Average connected seconds', Value: summary.averageDuration },
        { Metric: 'Android sync calls', Value: summary.bySource.android_sync?.calls || 0 },
        { Metric: 'Manual calls', Value: summary.bySource.manual?.calls || 0 },
        { Metric: 'Demo seed calls', Value: summary.bySource.demo_seed?.calls || 0 },
      ];
    },
  },
  unique_calls: {
    title: 'Unique calls report',
    run: async (user, query) => {
      const rows = await CallLog.aggregate([
        { $match: callFilter(user, query) },
        { $group: { _id: '$phoneNormalized', calls: { $sum: 1 }, duration: { $sum: '$durationSeconds' }, staff: { $addToSet: '$staff' } } },
        { $sort: { calls: -1 } },
        { $limit: 2000 },
      ]);
      return rows.map((row) => ({ Phone: formatPhone(row._id), Calls: row.calls, 'Talk seconds': row.duration, 'Staff count': row.staff.length }));
    },
  },
  call_duration: {
    title: 'Call duration report',
    run: async (user, query) => {
      const rows = await CallLog.find(callFilter(user, query)).sort({ durationSeconds: -1 }).limit(2000).populate('staff', 'name').populate('lead', 'leadCode').lean();
      return rows.map((row) => ({
        When: new Date(row.startedAt).toISOString(), Staff: row.staff?.name || '', Phone: formatPhone(row.phoneNormalized),
        'Lead ID': row.lead?.leadCode || '', Type: row.callType, Status: row.status, Minutes: Math.round((row.durationSeconds || 0) / 60), Source: row.dataSource,
      }));
    },
  },
  revenue_pipeline: {
    title: 'Revenue pipeline report',
    run: async (user) => {
      const rows = await RevenueOpportunity.find({ deletedAt: null, ...recordScope(user, { staff: 'staff' }) }).populate('lead', 'leadCode name').populate('staff', 'name').lean();
      return rows.map((row) => ({
        'Lead ID': row.lead?.leadCode || '', Lead: row.lead?.name || '', Staff: row.staff?.name || '',
        Stage: row.stage, Status: row.status, Expected: row.expectedRevenue, Probability: row.probability,
        Weighted: Math.round((row.expectedRevenue || 0) * ((row.probability || 0) / 100)),
        'Deal value': row.dealValue, Collected: row.collectedAmount,
      }));
    },
  },
  revenue_collection: {
    title: 'Revenue collection report',
    run: async (user, query) => {
      const rows = await Payment.find({ ...recordScope(user, { staff: 'staff' }), ...rangeMatch(query, 'paidAt') }).populate('lead', 'leadCode').populate('recordedBy', 'name').lean();
      return rows.map((row) => ({
        When: new Date(row.paidAt).toISOString(), 'Lead ID': row.lead?.leadCode || '', Amount: row.amount,
        Method: row.method, Reference: row.transactionRef || '', 'Recorded by': row.recordedBy?.name || '',
      }));
    },
  },
  target_achievement: {
    title: 'Target achievement report',
    run: async (user) => {
      const rows = await Target.find({ isActive: true }).populate('staff', 'name').populate('team', 'name').limit(500);
      const data = [];
      for (const target of rows) {
        if (!isElevated(user) && target.branch && String(target.branch) !== String(user.branch)) continue;
        const progress = await withProgress(target);
        data.push({
          Target: target.name, Type: target.type, Assignee: target.staff?.name || target.team?.name || target.assigneeType,
          Goal: progress.progress.goal, Actual: progress.progress.actual, 'Achievement %': progress.progress.percentage,
          Pending: progress.progress.pending,
        });
      }
      return data;
    },
  },
  demos: {
    title: 'Demo report',
    run: async (user, query) => {
      const ids = await Lead.find(leadBase(user, query)).distinct('_id');
      const rows = await LeadActivity.find({ lead: { $in: ids }, type: 'demo_completed' }).sort({ at: -1 }).limit(2000).lean();
      const leads = await Lead.find({ _id: { $in: rows.map((row) => row.lead) } }).select('leadCode name').lean();
      const map = new Map(leads.map((lead) => [String(lead._id), lead]));
      return rows.map((row) => ({
        When: new Date(row.at).toISOString(), 'Lead ID': map.get(String(row.lead))?.leadCode || '',
        Lead: map.get(String(row.lead))?.name || '', Staff: row.actorName || '',
      }));
    },
  },
  payment_pending: {
    title: 'Payment pending report',
    run: async (user, query) => {
      const rows = await Lead.find({ ...leadBase(user, query), status: 'payment_pending' }).populate('assignedTo', 'name').lean();
      return rows.map((row) => ({
        'Lead ID': row.leadCode, Name: row.name, Staff: row.assignedTo?.name || '',
        'Expected revenue': row.expectedRevenue, 'Next action': row.nextActionTitle || '',
      }));
    },
  },
  staff_activity: {
    title: 'Staff activity report',
    run: async (user, query) => {
      const ids = await Lead.find(leadBase(user, query)).distinct('_id');
      const rows = await LeadActivity.find({ lead: { $in: ids }, ...rangeMatch(query, 'at') }).sort({ at: -1 }).limit(2000).lean();
      return rows.map((row) => ({
        When: new Date(row.at).toISOString(), Staff: row.actorName || '', Type: row.type, Description: row.description,
      }));
    },
  },
  lead_ageing: {
    title: 'Lead ageing report',
    run: async (user, query) => {
      const rows = await Lead.find({
        ...leadBase(user, query),
        status: { $nin: [...WON_STATUSES, ...LOST_STATUSES] },
      }).limit(2000).lean();
      const buckets = { '0-1 days': 0, '2-3 days': 0, '4-7 days': 0, '8-14 days': 0, '15-30 days': 0, '30+ days': 0 };
      rows.forEach((row) => {
        const age = Math.floor((Date.now() - new Date(row.createdAt).getTime()) / 86400000);
        if (age <= 1) buckets['0-1 days'] += 1;
        else if (age <= 3) buckets['2-3 days'] += 1;
        else if (age <= 7) buckets['4-7 days'] += 1;
        else if (age <= 14) buckets['8-14 days'] += 1;
        else if (age <= 30) buckets['15-30 days'] += 1;
        else buckets['30+ days'] += 1;
      });
      return Object.entries(buckets).map(([bucket, count]) => ({ 'Age bucket': bucket, Leads: count }));
    },
  },
};

async function periodPerformance(user, query, kind) {
  const general = await getGeneral();
  const range = periodRange(kind, general.timezone);
  const calls = await summarizeCalls({
    ...recordScope(user, { staff: 'staff' }),
    startedAt: { $gte: query.startDate ? new Date(query.startDate) : range.start, $lt: query.endDate ? new Date(query.endDate) : range.end },
  });
  const leads = await Lead.countDocuments(leadBase(user, query));
  return [{
    Period: kind,
    From: (query.startDate ? new Date(query.startDate) : range.start).toISOString(),
    To: (query.endDate ? new Date(query.endDate) : range.end).toISOString(),
    Leads: leads,
    Calls: calls.total,
    Connected: calls.connected,
    'Unique numbers': calls.uniqueNumbers,
    'Talk minutes': Math.round((calls.totalDuration || 0) / 60),
    'Android sync calls': calls.bySource.android_sync?.calls || 0,
    'Manual calls': calls.bySource.manual?.calls || 0,
    'Demo seed calls': calls.bySource.demo_seed?.calls || 0,
  }];
}

function catalog() {
  return {
    data: Object.entries(REPORTS).map(([key, report]) => ({ key, title: report.title })),
  };
}

async function run(user, type, query) {
  const report = REPORTS[type];
  if (!report) throw new AppError('Unknown report', 404);
  const rows = await report.run(user, query);
  const columns = rows[0] ? Object.keys(rows[0]) : [];
  return { data: { key: type, title: report.title, columns, rows } };
}

async function toCsv(columns, rows) {
  const escape = (value) => {
    const text = value == null ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [columns.join(',')];
  rows.forEach((row) => lines.push(columns.map((column) => escape(row[column])).join(',')));
  return Buffer.from(`\uFEFF${lines.join('\n')}`, 'utf8');
}

async function toXlsx(title, columns, rows) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = COMPANY.productName;
  const sheet = workbook.addWorksheet(title.slice(0, 28) || 'Report');
  sheet.addRow(columns);
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF002546' } };
  rows.forEach((row) => sheet.addRow(columns.map((column) => row[column] ?? '')));
  columns.forEach((column, index) => {
    sheet.getColumn(index + 1).width = Math.min(40, Math.max(14, column.length + 2));
  });
  return workbook.xlsx.writeBuffer();
}

function toPdf(title, columns, rows) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ margin: 36, size: 'A4', layout: 'landscape' });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.rect(0, 0, doc.page.width, 56).fill('#002546');
    doc.fillColor('#FFFFFF').fontSize(16).text(COMPANY.productName, 36, 16);
    doc.fontSize(9).fillColor('#FE893C').text(COMPANY.legalName, 36, 36);
    doc.fillColor('#172B4D').fontSize(14).text(title, 36, 72);
    doc.fontSize(8).fillColor('#718096').text(`Generated ${new Date().toISOString()}`, 36, 92);
    const usable = columns.slice(0, 8);
    const startY = 114;
    const colWidth = (doc.page.width - 72) / Math.max(usable.length, 1);
    doc.fontSize(8).fillColor('#002546');
    usable.forEach((column, index) => doc.text(column, 36 + index * colWidth, startY, { width: colWidth - 6 }));
    doc.moveTo(36, startY + 14).lineTo(doc.page.width - 36, startY + 14).strokeColor('#FE893C').stroke();
    let y = startY + 20;
    rows.slice(0, 500).forEach((row) => {
      if (y > doc.page.height - 40) {
        doc.addPage();
        y = 48;
      }
      doc.fillColor('#172B4D');
      usable.forEach((column, index) => {
        doc.text(String(row[column] ?? ''), 36 + index * colWidth, y, { width: colWidth - 6, height: 16 });
      });
      y += 18;
    });
    if (rows.length > 500) {
      doc.fillColor('#718096').text('Showing the first 500 rows. Use Excel for the full extract.', 36, y + 8);
    }
    doc.end();
  });
}

async function exportReport(user, type, query, meta) {
  const result = await run(user, type, query);
  const format = query.format || 'xlsx';
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `doablinkorbit-${type}-${stamp}`;
  let buffer;
  let mime;
  let filename;
  if (format === 'csv') {
    buffer = await toCsv(result.data.columns, result.data.rows);
    mime = 'text/csv; charset=utf-8';
    filename = `${base}.csv`;
  } else if (format === 'pdf') {
    buffer = await toPdf(result.data.title, result.data.columns, result.data.rows);
    mime = 'application/pdf';
    filename = `${base}.pdf`;
  } else {
    buffer = Buffer.from(await toXlsx(result.data.title, result.data.columns, result.data.rows));
    mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    filename = `${base}.xlsx`;
  }
  await recordAudit({
    user: user._id, username: user.username, action: 'report.export', module: 'reports', recordId: type,
    newValues: { format, rows: result.data.rows.length }, ...meta,
  });
  return { download: { buffer, mime, filename } };
}

async function exportLeads(user, rows, format, meta) {
  const columns = rows[0] ? Object.keys(rows[0]) : ['Lead ID'];
  const stamp = new Date().toISOString().slice(0, 10);
  let buffer;
  let mime;
  let filename;
  if (format === 'csv') {
    buffer = await toCsv(columns, rows);
    mime = 'text/csv; charset=utf-8';
    filename = `doablinkorbit-leads-${stamp}.csv`;
  } else if (format === 'pdf') {
    buffer = await toPdf('Leads', columns, rows);
    mime = 'application/pdf';
    filename = `doablinkorbit-leads-${stamp}.pdf`;
  } else {
    buffer = Buffer.from(await toXlsx('Leads', columns, rows));
    mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    filename = `doablinkorbit-leads-${stamp}.xlsx`;
  }
  await recordAudit({
    user: user._id, username: user.username, action: 'leads.export', module: 'leads', newValues: { format, rows: rows.length }, ...meta,
  });
  return { download: { buffer, mime, filename } };
}

module.exports = { catalog, run, exportReport, exportLeads, REPORTS };
