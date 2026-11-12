const mongoose = require('mongoose');

const { Schema } = mongoose;

const refreshTokenSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
  revokedAt: Date,
  replacedByHash: String,
  userAgent: String,
  ip: String,
}, { timestamps: true });
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const branchSchema = new Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  city: String,
  state: String,
  country: { type: String, default: 'India' },
  phone: String,
  isActive: { type: Boolean, default: true },
  isDemo: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
}, { timestamps: true });

const teamSchema = new Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  branch: { type: Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
  leader: { type: Schema.Types.ObjectId, ref: 'User' },
  description: String,
  isActive: { type: Boolean, default: true },
  isDemo: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
}, { timestamps: true });

const userSchema = new Schema({
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  name: { type: String, required: true, trim: true },
  phone: String,
  phoneNormalized: String,
  employeeId: { type: String, unique: true, sparse: true },
  role: { type: String, enum: ['OWNER', 'SUPER_ADMIN', 'ADMIN', 'TEAM_LEADER', 'STAFF'], required: true, index: true },
  permissions: { type: [String], default: [] },
  permissionMode: { type: String, enum: ['role', 'custom'], default: 'role' },
  branch: { type: Schema.Types.ObjectId, ref: 'Branch', index: true },
  team: { type: Schema.Types.ObjectId, ref: 'Team', index: true },
  managedTeams: [{ type: Schema.Types.ObjectId, ref: 'Team' }],
  manager: { type: Schema.Types.ObjectId, ref: 'User' },
  joiningDate: Date,
  employmentStatus: { type: String, enum: ['active', 'inactive', 'on_leave'], default: 'active', index: true },
  isActive: { type: Boolean, default: true, index: true },
  isDemo: { type: Boolean, default: false },
  maxLeadAllocation: { type: Number, default: 50 },
  failedLoginCount: { type: Number, default: 0 },
  lockUntil: Date,
  lastLoginAt: Date,
  deletedAt: { type: Date, default: null, index: true },
}, { timestamps: true });

const leadSchema = new Schema({
  leadCode: { type: String, required: true, unique: true },
  isDemo: { type: Boolean, default: false },
  name: { type: String, required: true, trim: true },
  phone: { type: String, required: true },
  phoneNormalized: { type: String, required: true, index: true },
  alternatePhone: String,
  alternatePhoneNormalized: { type: String, index: true },
  email: String,
  company: String,
  district: { type: String, index: true },
  city: String,
  state: String,
  country: { type: String, default: 'India' },
  source: { type: String, index: true },
  category: String,
  priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium', index: true },
  quality: { type: String, enum: ['cold', 'warm', 'hot', ''], default: '' },
  assignedTo: { type: Schema.Types.ObjectId, ref: 'User', index: true, default: null },
  team: { type: Schema.Types.ObjectId, ref: 'Team', index: true, default: null },
  branch: { type: Schema.Types.ObjectId, ref: 'Branch', index: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  assignmentDate: Date,
  firstContactAt: Date,
  lastContactedAt: Date,
  lastActivityAt: { type: Date, default: Date.now, index: true },
  status: { type: String, default: 'fresh', index: true },
  statusChangedAt: { type: Date, default: Date.now },
  nextActionTitle: String,
  nextActionDueAt: Date,
  expectedRevenue: { type: Number, default: 0 },
  revenueProbability: { type: Number, default: 0 },
  followUpAt: Date,
  notes: String,
  lostReason: String,
  inPipeline: { type: Boolean, default: false, index: true },
  pipelineAddedAt: Date,
  consultancyName: { type: String, default: '' },
  proposedPlan: { type: Number, default: 0 },
  remarks: { type: String, default: '' },
  tags: { type: [String], default: [] },
  bucketStatus: { type: String, enum: ['unassigned', 'assigned'], default: 'unassigned', index: true },
  importBatch: { type: Schema.Types.ObjectId, ref: 'LeadImport' },
  deletedAt: { type: Date, default: null, index: true },
}, { timestamps: true });
leadSchema.index({ deletedAt: 1, assignedTo: 1, status: 1 });
leadSchema.index({ deletedAt: 1, branch: 1, createdAt: -1 });
leadSchema.index({ deletedAt: 1, team: 1, status: 1 });
leadSchema.index({ name: 1 });

const leadAssignmentSchema = new Schema({
  lead: { type: Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
  fromStaff: { type: Schema.Types.ObjectId, ref: 'User' },
  toStaff: { type: Schema.Types.ObjectId, ref: 'User' },
  fromTeam: { type: Schema.Types.ObjectId, ref: 'Team' },
  toTeam: { type: Schema.Types.ObjectId, ref: 'Team' },
  assignedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  reason: String,
  mode: { type: String, enum: ['manual', 'round_robin', 'equal_workload', 'capacity', 'team', 'swap', 'import', 'create'], default: 'manual' },
}, { timestamps: true });

const leadActivitySchema = new Schema({
  lead: { type: Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
  type: { type: String, required: true, index: true },
  actor: { type: Schema.Types.ObjectId, ref: 'User' },
  actorName: String,
  description: { type: String, required: true },
  oldValue: Schema.Types.Mixed,
  newValue: Schema.Types.Mixed,
  metadata: Schema.Types.Mixed,
  at: { type: Date, default: Date.now, index: true },
}, { timestamps: false });
leadActivitySchema.index({ lead: 1, at: -1 });

const leadSwapSchema = new Schema({
  lead: { type: Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
  requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  fromStaff: { type: Schema.Types.ObjectId, ref: 'User' },
  toStaff: { type: Schema.Types.ObjectId, ref: 'User' },
  reason: { type: String, required: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'], default: 'pending', index: true },
  reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  reviewNote: String,
  reviewedAt: Date,
}, { timestamps: true });

const importRowSchema = new Schema({
  rowNumber: Number,
  raw: Schema.Types.Mixed,
  mapped: Schema.Types.Mixed,
  rowErrors: [String],
  duplicateInFile: Boolean,
  duplicateLeadId: Schema.Types.ObjectId,
  duplicateLeadCode: String,
  valid: Boolean,
  action: String,
  importedLeadId: Schema.Types.ObjectId,
}, { _id: false });

const leadImportSchema = new Schema({
  uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  fileName: String,
  fileSize: Number,
  status: { type: String, enum: ['preview', 'processing', 'completed', 'failed'], default: 'preview', index: true },
  mapping: Schema.Types.Mixed,
  detectedColumns: [String],
  rows: [importRowSchema],
  progress: { type: Number, default: 0 },
  summary: Schema.Types.Mixed,
  errorMessage: String,
  completedAt: Date,
}, { timestamps: true });

const followUpSchema = new Schema({
  lead: { type: Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
  leadName: String,
  leadCode: String,
  assignedTo: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  team: { type: Schema.Types.ObjectId, ref: 'Team', index: true },
  branch: { type: Schema.Types.ObjectId, ref: 'Branch', index: true },
  title: { type: String, required: true },
  description: String,
  dueAt: { type: Date, required: true, index: true },
  priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  status: { type: String, enum: ['pending', 'completed', 'missed', 'cancelled'], default: 'pending', index: true },
  completedAt: Date,
  completionNotes: String,
  completedOnTime: Boolean,
  reminderSentAt: Date,
  missedMarkedAt: Date,
  remindReason: String,
  remindedAt: Date,
  remindAt: Date,
  isDemo: { type: Boolean, default: false },
}, { timestamps: true });
followUpSchema.index({ assignedTo: 1, status: 1, dueAt: 1 });

const callLogSchema = new Schema({
  uniqueKey: { type: String, required: true, unique: true },
  androidEventId: String,
  staff: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  device: { type: Schema.Types.ObjectId, ref: 'AndroidDevice', index: true },
  team: { type: Schema.Types.ObjectId, ref: 'Team', index: true },
  branch: { type: Schema.Types.ObjectId, ref: 'Branch', index: true },
  phone: String,
  phoneNormalized: { type: String, index: true },
  lead: { type: Schema.Types.ObjectId, ref: 'Lead', index: true },
  matchStatus: { type: String, enum: ['matched', 'unmatched', 'ambiguous', 'manual'], default: 'unmatched', index: true },
  candidateLeadIds: [{ type: Schema.Types.ObjectId, ref: 'Lead' }],
  callType: { type: String, enum: ['incoming', 'outgoing', 'missed'], required: true },
  startedAt: { type: Date, required: true, index: true },
  durationSeconds: { type: Number, default: 0 },
  status: { type: String, enum: ['connected', 'not_connected', 'missed', 'rejected', 'unknown'], default: 'unknown' },
  dataSource: { type: String, enum: ['android_sync', 'manual', 'demo_seed'], required: true, index: true },
  recordingId: String,
  syncedAt: Date,
  enteredBy: { type: Schema.Types.ObjectId, ref: 'User' },
  isDemo: { type: Boolean, default: false },
}, { timestamps: true });
callLogSchema.index({ device: 1, androidEventId: 1 }, { unique: true, sparse: true });
callLogSchema.index({ staff: 1, startedAt: -1 });

const callRecordingSchema = new Schema({
  recordingKey: { type: String, required: true, unique: true },
  recordingId: { type: String, required: true, index: true },
  provider: { type: String, default: 'device' },
  callLog: { type: Schema.Types.ObjectId, ref: 'CallLog' },
  lead: { type: Schema.Types.ObjectId, ref: 'Lead', index: true },
  staff: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  device: { type: Schema.Types.ObjectId, ref: 'AndroidDevice' },
  status: { type: String, enum: ['available', 'pending', 'unavailable', 'restricted'], default: 'pending' },
  accessReference: { type: String, select: false },
  durationSeconds: Number,
  dataSource: { type: String, enum: ['android_sync', 'manual', 'demo_seed'], default: 'android_sync' },
  isDemo: { type: Boolean, default: false },
}, { timestamps: true });

const androidDeviceSchema = new Schema({
  staff: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  deviceIdentifier: { type: String, required: true },
  deviceName: String,
  manufacturer: String,
  model: String,
  osVersion: String,
  appVersion: String,
  tokenHash: { type: String, required: true, unique: true },
  fcmToken: String,
  status: { type: String, enum: ['active', 'revoked'], default: 'active', index: true },
  lastSyncAt: Date,
  lastSeenAt: Date,
  permissionSnapshot: {
    callLog: String,
    contacts: String,
    notifications: String,
  },
  contactsSyncEnabled: { type: Boolean, default: false },
  callLogSyncEnabled: { type: Boolean, default: false },
  consentAcceptedAt: Date,
  revokedAt: Date,
  revokedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });
androidDeviceSchema.index({ deviceIdentifier: 1 }, { unique: true });

const syncedContactSchema = new Schema({
  device: { type: Schema.Types.ObjectId, ref: 'AndroidDevice', required: true },
  staff: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  deviceContactId: { type: String, required: true },
  name: String,
  phone: String,
  phoneNormalized: { type: String, index: true },
  lead: { type: Schema.Types.ObjectId, ref: 'Lead' },
  matchStatus: { type: String, enum: ['matched', 'unmatched', 'ambiguous'], default: 'unmatched' },
  candidateLeadIds: [{ type: Schema.Types.ObjectId, ref: 'Lead' }],
  syncedAt: { type: Date, default: Date.now },
  consentAt: Date,
}, { timestamps: true });
syncedContactSchema.index({ device: 1, deviceContactId: 1 }, { unique: true });

const syncBatchSchema = new Schema({
  device: { type: Schema.Types.ObjectId, ref: 'AndroidDevice' },
  staff: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  kind: { type: String, enum: ['calls', 'contacts', 'recordings'], required: true },
  received: Number,
  inserted: Number,
  duplicates: Number,
  failed: Number,
  details: Schema.Types.Mixed,
}, { timestamps: true });

const hourlyReportSchema = new Schema({
  staff: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  team: { type: Schema.Types.ObjectId, ref: 'Team', index: true },
  branch: { type: Schema.Types.ObjectId, ref: 'Branch', index: true },
  periodStart: { type: Date, required: true },
  periodEnd: { type: Date, required: true },
  dateKey: { type: String, required: true, index: true },
  hour: { type: Number, required: true },
  timezone: { type: String, default: 'Asia/Kolkata' },
  callMetrics: Schema.Types.Mixed,
  activityMetrics: Schema.Types.Mixed,
  sheet: Schema.Types.Mixed,
  sourceBreakdown: Schema.Types.Mixed,
  whatsappText: String,
  generatedAt: { type: Date, default: Date.now },
}, { timestamps: true });
hourlyReportSchema.index({ staff: 1, periodStart: 1 }, { unique: true });

const targetSchema = new Schema({
  name: { type: String, required: true },
  type: { type: String, required: true, index: true },
  assigneeType: { type: String, enum: ['staff', 'team', 'branch', 'user'], required: true },
  staff: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  team: { type: Schema.Types.ObjectId, ref: 'Team', index: true },
  branch: { type: Schema.Types.ObjectId, ref: 'Branch', index: true },
  user: { type: Schema.Types.ObjectId, ref: 'User' },
  value: { type: Number, required: true },
  period: { type: String, enum: ['daily', 'weekly', 'monthly', 'custom'], default: 'monthly' },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  isActive: { type: Boolean, default: true },
  history: [{
    at: Date,
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    oldValue: Number,
    newValue: Number,
    note: String,
  }],
  isDemo: { type: Boolean, default: false },
}, { timestamps: true });

const opportunitySchema = new Schema({
  lead: { type: Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
  staff: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  team: { type: Schema.Types.ObjectId, ref: 'Team', index: true },
  branch: { type: Schema.Types.ObjectId, ref: 'Branch', index: true },
  title: { type: String, required: true },
  expectedRevenue: { type: Number, default: 0 },
  dealValue: { type: Number, default: 0 },
  probability: { type: Number, default: 0 },
  expectedCloseDate: Date,
  stage: { type: String, default: 'new', index: true },
  status: { type: String, enum: ['open', 'won', 'lost'], default: 'open', index: true },
  collectedAmount: { type: Number, default: 0 },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  isDemo: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
}, { timestamps: true });

const paymentSchema = new Schema({
  opportunity: { type: Schema.Types.ObjectId, ref: 'RevenueOpportunity', index: true },
  lead: { type: Schema.Types.ObjectId, ref: 'Lead', index: true },
  invoice: { type: Schema.Types.ObjectId, ref: 'Invoice' },
  staff: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  team: { type: Schema.Types.ObjectId, ref: 'Team' },
  branch: { type: Schema.Types.ObjectId, ref: 'Branch' },
  amount: { type: Number, required: true },
  paidAt: { type: Date, required: true, index: true },
  method: { type: String, enum: ['cash', 'upi', 'bank_transfer', 'card', 'cheque', 'other'], default: 'upi' },
  transactionRef: String,
  invoiceRef: String,
  recordedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  notes: String,
  isDemo: { type: Boolean, default: false },
}, { timestamps: true });

const invoiceSchema = new Schema({
  invoiceNumber: { type: String, required: true, unique: true },
  opportunity: { type: Schema.Types.ObjectId, ref: 'RevenueOpportunity' },
  lead: { type: Schema.Types.ObjectId, ref: 'Lead', index: true },
  amount: { type: Number, required: true },
  status: { type: String, enum: ['draft', 'issued', 'partial', 'paid', 'void'], default: 'issued' },
  issuedAt: Date,
  notes: String,
  isDemo: { type: Boolean, default: false },
}, { timestamps: true });

const notificationSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, required: true, index: true },
  title: { type: String, required: true },
  body: String,
  module: String,
  recordId: String,
  dedupeKey: { type: String },
  readAt: Date,
}, { timestamps: true });
notificationSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true });
notificationSchema.index({ user: 1, createdAt: -1 });

const auditLogSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  username: String,
  action: { type: String, required: true, index: true },
  module: { type: String, required: true, index: true },
  recordId: String,
  oldValues: Schema.Types.Mixed,
  newValues: Schema.Types.Mixed,
  ip: String,
  userAgent: String,
  at: { type: Date, default: Date.now, index: true },
}, { timestamps: false });

const leaveSchema = new Schema({
  staff: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  team: { type: Schema.Types.ObjectId, ref: 'Team' },
  branch: { type: Schema.Types.ObjectId, ref: 'Branch' },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  type: { type: String, enum: ['casual', 'sick', 'earned', 'unpaid', 'other'], default: 'casual' },
  reason: String,
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'], default: 'pending', index: true },
  reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  reviewNote: String,
  reviewedAt: Date,
  isDemo: { type: Boolean, default: false },
}, { timestamps: true });

const settingSchema = new Schema({
  key: { type: String, required: true, unique: true },
  value: Schema.Types.Mixed,
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

const statusSchema = new Schema({
  key: { type: String, required: true, unique: true },
  label: { type: String, required: true },
  category: { type: String, enum: ['open', 'positive', 'won', 'lost'], default: 'open' },
  sortOrder: { type: Number, default: 0 },
  isSystem: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

const stageSchema = new Schema({
  key: { type: String, required: true, unique: true },
  label: { type: String, required: true },
  probability: { type: Number, default: 0 },
  sortOrder: { type: Number, default: 0 },
  isWon: { type: Boolean, default: false },
  isLost: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

const alertRuleSchema = new Schema({
  key: { type: String, required: true, unique: true },
  label: { type: String, required: true },
  threshold: { type: Number, required: true },
  unit: { type: String, required: true },
  enabled: { type: Boolean, default: true },
}, { timestamps: true });

const counterSchema = new Schema({
  _id: { type: String },
  seq: { type: Number, default: 0 },
});

const model = (name, schema) => mongoose.models[name] || mongoose.model(name, schema);

module.exports = {
  RefreshToken: model('RefreshToken', refreshTokenSchema),
  Branch: model('Branch', branchSchema),
  Team: model('Team', teamSchema),
  User: model('User', userSchema),
  Lead: model('Lead', leadSchema),
  LeadAssignment: model('LeadAssignment', leadAssignmentSchema),
  LeadActivity: model('LeadActivity', leadActivitySchema),
  LeadSwapRequest: model('LeadSwapRequest', leadSwapSchema),
  LeadImport: model('LeadImport', leadImportSchema),
  FollowUp: model('FollowUp', followUpSchema),
  CallLog: model('CallLog', callLogSchema),
  CallRecording: model('CallRecording', callRecordingSchema),
  AndroidDevice: model('AndroidDevice', androidDeviceSchema),
  SyncedContact: model('SyncedContact', syncedContactSchema),
  SyncBatch: model('SyncBatch', syncBatchSchema),
  HourlyReport: model('HourlyReport', hourlyReportSchema),
  Target: model('Target', targetSchema),
  RevenueOpportunity: model('RevenueOpportunity', opportunitySchema),
  Payment: model('Payment', paymentSchema),
  Invoice: model('Invoice', invoiceSchema),
  Notification: model('Notification', notificationSchema),
  AuditLog: model('AuditLog', auditLogSchema),
  LeaveRequest: model('LeaveRequest', leaveSchema),
  SystemSetting: model('SystemSetting', settingSchema),
  CustomLeadStatus: model('CustomLeadStatus', statusSchema),
  PipelineStage: model('PipelineStage', stageSchema),
  AlertRule: model('AlertRule', alertRuleSchema),
  Counter: model('Counter', counterSchema),
};
