const express = require('express');
const multer = require('multer');
const { validate, requireAuth, requirePermission, requireAny, requireDevice } = require('../middleware');
const { action } = require('../controllers/action');
const schemas = require('../validators/schemas');
const auth = require('../services/auth');
const org = require('../services/org');
const settings = require('../services/settings');
const leads = require('../services/leads');
const imports = require('../services/imports');
const followups = require('../services/followups');
const calls = require('../services/calls');
const hourly = require('../services/hourly');
const targets = require('../services/targets');
const revenue = require('../services/revenue');
const dashboard = require('../services/dashboard');
const board = require('../services/leaderboard');
const reports = require('../services/reports');
const inbox = require('../services/inbox');
const audit = require('../services/audit');
const alerts = require('../services/alerts');
const { PERMISSIONS, ROLE_PERMISSIONS } = require('../config/permissions');
const { TARGET_TYPES, PRIORITIES, QUALITIES, ROLES } = require('../config/constants');
const { AppError } = require('../utils/http');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const q = validate({ query: schemas.query });
const id = validate({ params: schemas.idParam });

router.get('/health', (req, res) => {
  const mongoose = require('mongoose');
  res.json({
    success: true,
    message: 'DoablinkOrbit API',
    data: { product: 'DoablinkOrbit', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' },
  });
});

router.post('/auth/login', validate({ body: schemas.login }), action((req, meta) => auth.login(req.body, meta, req.res), 'Signed in'));
router.post('/auth/refresh', validate({ body: schemas.refresh }), action((req) => auth.refresh(req, req.res)));
router.post('/auth/logout', action((req) => auth.logout(req, req.res)));

router.post('/android/calls/sync', requireDevice, validate({ body: schemas.callSync }), action((req) => calls.syncCalls(req.device, req.user, req.body)));
router.post('/android/contacts/sync', requireDevice, validate({ body: schemas.contactSync }), action((req) => calls.syncContacts(req.device, req.user, req.body)));
router.post('/android/recordings/sync', requireDevice, validate({ body: schemas.recordingSync }), action((req) => calls.syncRecording(req.device, req.user, req.body)));

router.use(requireAuth);
router.get('/auth/me', action((req) => auth.me(req.user)));
router.post('/auth/change-password', validate({ body: schemas.password }), action((req, meta) => auth.changePassword(req.user, req.body, meta)));

router.get('/meta', action(async () => ({
  data: {
    roles: ROLES,
    priorities: PRIORITIES,
    qualities: QUALITIES,
    targetTypes: TARGET_TYPES,
    permissions: PERMISSIONS,
    rolePermissions: ROLE_PERMISSIONS,
    sources: await settings.getLeadSources(),
    statuses: await settings.activeStatuses(),
    stages: await settings.activeStages(),
    general: await settings.getGeneral(),
  },
})));

router.get('/users', requirePermission('staff.view'), q, action((req) => org.listUsers(req.user, req.query)));
router.post('/users', requirePermission('users.manage'), validate({ body: schemas.userCreate }), action((req, meta) => org.createUser(req.user, req.body, meta)));
router.get('/users/:id', requirePermission('staff.view'), id, action((req) => org.getUser(req.user, req.params.id)));
router.patch('/users/:id', requirePermission('staff.manage'), id, validate({ body: schemas.userPatch }), action((req, meta) => org.updateUser(req.user, req.params.id, req.body, meta)));
router.post('/users/:id/deactivate', requirePermission('users.manage'), id, action((req, meta) => org.setActive(req.user, req.params.id, false, meta)));
router.post('/users/:id/activate', requirePermission('users.manage'), id, action((req, meta) => org.setActive(req.user, req.params.id, true, meta)));
router.put('/users/:id/permissions', requirePermission('roles.manage'), id, validate({ body: schemas.permissions }), action((req, meta) => org.setPermissions(req.user, req.params.id, req.body.permissions, meta)));

router.get('/roles', requirePermission('roles.manage'), action(async () => ({ data: ROLE_PERMISSIONS })));
router.get('/permissions', requirePermission('roles.manage'), action(async () => ({ data: PERMISSIONS })));
router.put('/roles/:role/permissions', requirePermission('roles.manage'), validate({ params: schemas.roleParam, body: schemas.permissions }), action((req, meta) => settings.updateRolePermissions(req.user, req.params.role, req.body.permissions, meta)));

router.get('/branches', requireAuth, action((req) => org.listBranches(req.user)));
router.post('/branches', requirePermission('branches.manage'), validate({ body: schemas.branch }), action((req, meta) => org.saveBranch(req.user, req.body, meta)));
router.patch('/branches/:id', requirePermission('branches.manage'), id, validate({ body: schemas.branch }), action((req, meta) => org.saveBranch(req.user, req.body, meta, req.params.id)));
router.delete('/branches/:id', requirePermission('branches.manage'), id, action((req, meta) => org.archiveBranch(req.user, req.params.id, meta)));
router.get('/teams', q, action((req) => org.listTeams(req.user, req.query)));
router.post('/teams', requirePermission('teams.manage'), validate({ body: schemas.team }), action((req, meta) => org.saveTeam(req.user, req.body, meta)));
router.patch('/teams/:id', requirePermission('teams.manage'), id, validate({ body: schemas.team }), action((req, meta) => org.saveTeam(req.user, req.body, meta, req.params.id)));
router.post('/teams/:id/transfer', requirePermission('teams.manage'), id, validate({ body: schemas.transfer }), action((req, meta) => org.transferStaff(req.user, req.params.id, req.body, meta)));

router.get('/leaves', q, action((req) => org.listLeaves(req.user, req.query)));
router.post('/leaves', requirePermission('leaves.apply'), validate({ body: schemas.leave }), action((req, meta) => org.applyLeave(req.user, req.body, meta)));
router.post('/leaves/:id/review', requirePermission('leaves.review'), id, validate({ body: schemas.leaveReview }), action((req, meta) => org.reviewLeave(req.user, req.params.id, req.body, meta)));

router.get('/pipeline', requirePermission('leads.view'), q, action((req) => leads.pipelineReport(req.user, req.query)));
router.get('/leads/export', requirePermission('leads.export'), q, action(async (req, meta) => {
  const rows = await leads.rowsForExport(req.user, req.query);
  return reports.exportLeads(req.user, rows, req.query.format || 'xlsx', meta);
}));
router.get('/leads', requirePermission('leads.view'), q, action((req) => leads.list(req.user, req.query)));
router.post('/leads', requirePermission('leads.create'), validate({ body: schemas.lead }), action((req, meta) => leads.create(req.user, req.body, meta)));
router.post('/leads/bulk/status', requirePermission('leads.edit'), validate({ body: schemas.bulkStatus }), action((req, meta) => leads.bulkStatus(req.user, req.body, meta)));
router.get('/leads/:id', requirePermission('leads.view'), id, action((req) => leads.getById(req.user, req.params.id)));
router.patch('/leads/:id', requirePermission('leads.edit'), id, validate({ body: schemas.leadPatch }), action((req, meta) => leads.update(req.user, req.params.id, req.body, meta)));
router.delete('/leads/:id', requirePermission('leads.delete'), id, action((req, meta) => leads.remove(req.user, req.params.id, meta)));
router.post('/leads/:id/notes', requirePermission('leads.edit'), id, validate({ body: schemas.note }), action((req, meta) => leads.addNote(req.user, req.params.id, req.body, meta)));
router.post('/leads/:id/pipeline', requirePermission('leads.edit'), id, action((req, meta) => leads.addToPipeline(req.user, req.params.id, meta)));
router.patch('/leads/:id/pipeline', requirePermission('leads.edit'), id, validate({ body: schemas.pipelinePatch }), action((req, meta) => leads.updatePipeline(req.user, req.params.id, req.body, meta)));
router.get('/leads/:id/timeline', requirePermission('leads.view'), id, q, action((req) => leads.timeline(req.user, req.params.id, req.query)));
router.get('/leads/:id/involvement', requirePermission('leads.view'), id, action((req) => leads.involvement(req.user, req.params.id)));

router.get('/lead-imports', requirePermission('leads.import'), q, action((req) => imports.list(req.user, req.query)));
router.post('/lead-imports', requirePermission('leads.import'), upload.single('file'), action(async (req, meta) => {
  if (!req.file || !/\.(xlsx|xls|csv)$/i.test(req.file.originalname)) throw new AppError('Upload an .xlsx, .xls, or .csv file', 400);
  let mapping;
  if (req.body.mapping) {
    try { mapping = JSON.parse(req.body.mapping); } catch (error) { throw new AppError('Column mapping must be JSON', 400); }
  }
  return imports.createPreview(req.user, req.file, mapping, meta);
}));
router.get('/lead-imports/:id', requirePermission('leads.import'), id, action((req) => imports.getOne(req.user, req.params.id)));
router.post('/lead-imports/:id/mapping', requirePermission('leads.import'), id, validate({ body: schemas.mapping }), action((req) => imports.remap(req.user, req.params.id, req.body.mapping)));
router.post('/lead-imports/:id/commit', requirePermission('leads.import'), id, validate({ body: schemas.commit }), action((req, meta) => imports.commit(req.user, req.params.id, req.body, meta)));
router.get('/lead-imports/:id/failures', requirePermission('leads.import'), id, action(async (req, meta) => {
  const rows = await imports.failureRows(req.user, req.params.id);
  return reports.exportLeads(req.user, rows, req.query.format || 'csv', meta);
}));

router.get('/lead-assignments/workload', requirePermission('leads.assign'), action((req) => leads.workload(req.user)));
router.get('/lead-assignments', requirePermission('leads.assign'), q, action((req) => leads.listAssignments(req.user, req.query)));
router.post('/lead-assignments', requirePermission('leads.assign'), validate({ body: schemas.assign }), action((req, meta) => leads.assign(req.user, req.body, meta)));
router.post('/lead-assignments/distribute', requirePermission('leads.assign'), validate({ body: schemas.distribute }), action((req, meta) => leads.distribute(req.user, req.body, meta)));

router.get('/lead-swaps', requirePermission('leads.swap'), q, action((req) => leads.listSwaps(req.user, req.query)));
router.post('/lead-swaps', requirePermission('leads.swap'), validate({ body: schemas.swap }), action((req, meta) => leads.requestSwap(req.user, req.body, meta)));
router.post('/lead-swaps/:id/approve', requirePermission('leads.assign'), id, validate({ body: schemas.swapReview }), action((req, meta) => leads.reviewSwap(req.user, req.params.id, { ...req.body, status: 'approved' }, meta)));
router.post('/lead-swaps/:id/reject', requirePermission('leads.assign'), id, validate({ body: schemas.swapReview }), action((req, meta) => leads.reviewSwap(req.user, req.params.id, { ...req.body, status: 'rejected' }, meta)));

router.get('/followups/popups', requirePermission('followups.view'), action((req) => followups.popups(req.user)));
router.get('/followups/summary', requirePermission('followups.view'), action((req) => followups.summary(req.user)));
router.get('/followups/calendar', requirePermission('followups.view'), q, action((req) => followups.calendar(req.user, req.query)));
router.get('/followups', requirePermission('followups.view'), q, action((req) => followups.list(req.user, req.query)));
router.post('/followups', requirePermission('followups.manage'), validate({ body: schemas.followUp }), action((req, meta) => followups.create(req.user, req.body, meta)));
router.patch('/followups/:id', requirePermission('followups.manage'), id, validate({ body: schemas.followUpPatch }), action((req, meta) => followups.update(req.user, req.params.id, req.body, meta)));
router.post('/followups/:id/complete', requirePermission('followups.manage'), id, validate({ body: schemas.complete }), action((req, meta) => followups.complete(req.user, req.params.id, req.body, meta)));
router.post('/followups/:id/remind', requirePermission('followups.manage'), id, validate({ body: schemas.remindLater }), action((req, meta) => followups.remindLater(req.user, req.params.id, req.body, meta)));
router.post('/followups/reassign', requirePermission('followups.manage'), validate({ body: schemas.reassign }), action((req, meta) => followups.reassignFromStaff(req.user, req.body, meta)));

router.get('/calls/analytics', requirePermission('calls.view'), q, action((req) => calls.analytics(req.user, req.query)));
router.get('/calls', requirePermission('calls.view'), q, action((req) => calls.listCalls(req.user, req.query)));
router.post('/calls/manual', requirePermission('calls.manual'), validate({ body: schemas.manualCall }), action((req, meta) => calls.createManual(req.user, req.body, meta)));
router.get('/call-recordings', requirePermission('recordings.view'), q, action((req) => calls.listRecordings(req.user, req.query)));
router.get('/call-recordings/:id', requirePermission('recordings.view'), id, action((req, meta) => calls.revealRecording(req.user, req.params.id, meta)));
router.get('/contacts', requirePermission('contacts.view'), q, action((req) => calls.listContacts(req.user, req.query)));
router.post('/contacts/:id/create-lead', requirePermission('leads.create'), id, action((req, meta) => calls.createLeadFromContact(req.user, req.params.id, meta)));

router.post('/android/devices/register', requirePermission('calls.sync'), validate({ body: schemas.device }), action((req, meta) => calls.registerDevice(req.user, req.body, meta)));
router.get('/android/devices', requireAny('calls.view', 'calls.sync'), action((req) => calls.listDevices(req.user)));
router.post('/android/devices/:id/revoke', requireAny('staff.manage', 'calls.sync'), id, action((req, meta) => calls.revokeDevice(req.user, req.params.id, meta)));
router.post('/android/devices/:id/contacts-sync', requirePermission('contacts.sync'), id, validate({ body: schemas.contactToggle }), action((req, meta) => calls.setContactSync(req.user, req.params.id, req.body.enabled, meta)));
router.get('/android/sync-status', requirePermission('calls.sync'), action((req) => calls.syncStatus(req.user)));
router.get('/android/sync-history', requireAny('calls.view', 'calls.sync'), q, action((req) => calls.syncHistory(req.user, req.query)));

router.get('/hourly-reports/window', requirePermission('hourly.view'), q, action((req) => hourly.windowReport(req.user, req.query)));
router.get('/hourly-reports/whatsapp', requirePermission('hourly.view'), q, action((req) => hourly.whatsapp(req.user, req.query)));
router.get('/hourly-reports/day', requirePermission('hourly.view'), q, action((req) => hourly.day(req.user, req.query)));
router.get('/hourly-reports/export', requirePermission('hourly.view'), q, action((req) => hourly.exportReport(req.user, req.query)));
router.get('/hourly-reports', requirePermission('hourly.view'), q, action((req) => hourly.list(req.user, req.query)));
router.post('/hourly-reports/generate', requirePermission('hourly.view'), validate({ body: schemas.hourlyGenerate }), action((req) => hourly.generate(req.user, req.body)));

router.get('/targets', requirePermission('targets.view'), q, action((req) => targets.list(req.user, req.query)));
router.post('/targets', requirePermission('targets.manage'), validate({ body: schemas.target }), action((req, meta) => targets.create(req.user, req.body, meta)));
router.get('/targets/:id', requirePermission('targets.view'), id, action((req) => targets.getOne(req.user, req.params.id)));
router.patch('/targets/:id', requirePermission('targets.manage'), id, validate({ body: schemas.targetPatch }), action((req, meta) => targets.update(req.user, req.params.id, req.body, meta)));

router.get('/revenue/summary', requirePermission('revenue.view'), action((req) => revenue.summary(req.user)));
router.get('/revenue', requirePermission('revenue.view'), q, action((req) => revenue.list(req.user, req.query)));
router.post('/revenue', requirePermission('revenue.manage'), validate({ body: schemas.opportunity }), action((req, meta) => revenue.create(req.user, req.body, meta)));
router.patch('/revenue/:id', requirePermission('revenue.manage'), id, validate({ body: schemas.opportunityPatch }), action((req, meta) => revenue.update(req.user, req.params.id, req.body, meta)));
router.get('/payments', requirePermission('revenue.view'), q, action((req) => revenue.listPayments(req.user, req.query)));
router.post('/payments', requirePermission('revenue.manage'), validate({ body: schemas.payment }), action((req, meta) => revenue.addPayment(req.user, req.body, meta)));
router.get('/invoices', requirePermission('revenue.view'), q, action((req) => revenue.listInvoices(req.user, req.query)));
router.post('/invoices', requirePermission('revenue.manage'), validate({ body: schemas.invoice }), action((req, meta) => revenue.createInvoice(req.user, req.body, meta)));

router.get('/dashboards/me', requirePermission('dashboard.view'), q, action((req) => dashboard.build(req.user, req.query)));
router.get('/leaderboard', requirePermission('leaderboard.view'), q, action((req) => (req.query.view === 'team' ? board.teamBoard(req.user, req.query) : board.leaderboard(req.user, req.query))));

router.get('/reports', requirePermission('reports.view'), action(() => reports.catalog()));
router.get('/reports/:type/export', requirePermission('reports.export'), validate({ params: schemas.typeParam, query: schemas.query }), action((req, meta) => reports.exportReport(req.user, req.params.type, req.query, meta)));
router.get('/reports/:type', requirePermission('reports.view'), validate({ params: schemas.typeParam, query: schemas.query }), action((req) => reports.run(req.user, req.params.type, req.query)));

router.get('/notifications', requirePermission('notifications.view'), q, action((req) => inbox.list(req.user, req.query)));
router.post('/notifications/read-all', requirePermission('notifications.view'), action((req) => inbox.markAll(req.user)));
router.post('/notifications/announce', requirePermission('notifications.manage'), validate({ body: schemas.announce }), action((req, meta) => inbox.announce(req.user, req.body, meta)));
router.post('/notifications/:id/read', requirePermission('notifications.view'), id, action((req) => inbox.markRead(req.user, req.params.id)));

router.get('/audit-logs', requirePermission('audit.view'), q, action((req) => audit.listAudits(req.query)));
router.get('/alert-rules', requireAny('settings.manage', 'dashboard.view'), action(() => alerts.listRules()));
router.patch('/alert-rules/:id', requirePermission('settings.manage'), id, validate({ body: schemas.alertPatch }), action((req, meta) => settings.updateAlertRule(req.user, req.params.id, req.body, meta)));

router.get('/settings', requireAny('settings.manage', 'pipeline.manage'), action(() => settings.listSettings()));
router.put('/settings/:key', requirePermission('settings.manage'), validate({ params: schemas.keyParam, body: schemas.setting }), action((req, meta) => settings.updateSetting(req.user, req.params.key, req.body.value, meta)));
router.post('/lead-statuses', requirePermission('pipeline.manage'), validate({ body: schemas.statusBody }), action((req, meta) => settings.saveStatus(req.user, req.body, meta)));
router.patch('/lead-statuses/:id', requirePermission('pipeline.manage'), id, validate({ body: schemas.statusBody }), action((req, meta) => settings.saveStatus(req.user, req.body, meta, req.params.id)));
router.post('/pipeline-stages', requirePermission('pipeline.manage'), validate({ body: schemas.stageBody }), action((req, meta) => settings.saveStage(req.user, req.body, meta)));
router.patch('/pipeline-stages/:id', requirePermission('pipeline.manage'), id, validate({ body: schemas.stageBody }), action((req, meta) => settings.saveStage(req.user, req.body, meta, req.params.id)));

module.exports = router;
