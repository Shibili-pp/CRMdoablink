const PERMISSIONS = [
  { key: 'dashboard.view', group: 'Dashboard', label: 'View dashboard' },
  { key: 'leads.view', group: 'Leads', label: 'View leads' },
  { key: 'leads.create', group: 'Leads', label: 'Create leads' },
  { key: 'leads.edit', group: 'Leads', label: 'Edit leads' },
  { key: 'leads.delete', group: 'Leads', label: 'Delete leads' },
  { key: 'leads.assign', group: 'Leads', label: 'Assign and reassign leads' },
  { key: 'leads.swap', group: 'Leads', label: 'Request or review lead swaps' },
  { key: 'leads.export', group: 'Leads', label: 'Export leads' },
  { key: 'leads.import', group: 'Leads', label: 'Import leads' },
  { key: 'staff.view', group: 'Staff', label: 'View staff' },
  { key: 'staff.manage', group: 'Staff', label: 'Manage staff' },
  { key: 'users.manage', group: 'Staff', label: 'Create and deactivate users' },
  { key: 'teams.manage', group: 'Organization', label: 'Manage teams' },
  { key: 'branches.manage', group: 'Organization', label: 'Manage branches' },
  { key: 'followups.view', group: 'Follow-ups', label: 'View follow-ups' },
  { key: 'followups.manage', group: 'Follow-ups', label: 'Create and complete follow-ups' },
  { key: 'calls.view', group: 'Calling', label: 'View calling analytics' },
  { key: 'calls.sync', group: 'Calling', label: 'Sync device calls' },
  { key: 'calls.manual', group: 'Calling', label: 'Enter a manual call' },
  { key: 'recordings.view', group: 'Calling', label: 'View recording references' },
  { key: 'contacts.view', group: 'Calling', label: 'View synced contacts' },
  { key: 'contacts.sync', group: 'Calling', label: 'Sync device contacts' },
  { key: 'reports.view', group: 'Reports', label: 'View reports' },
  { key: 'reports.export', group: 'Reports', label: 'Export reports' },
  { key: 'targets.view', group: 'Targets', label: 'View targets' },
  { key: 'targets.manage', group: 'Targets', label: 'Manage targets' },
  { key: 'revenue.view', group: 'Revenue', label: 'View revenue' },
  { key: 'revenue.manage', group: 'Revenue', label: 'Manage pipeline and payments' },
  { key: 'leaderboard.view', group: 'Leaderboard', label: 'View leaderboard' },
  { key: 'hourly.view', group: 'Reports', label: 'View hourly reports' },
  { key: 'notifications.view', group: 'Notifications', label: 'View notifications' },
  { key: 'notifications.manage', group: 'Notifications', label: 'Send announcements' },
  { key: 'audit.view', group: 'Security', label: 'View audit logs' },
  { key: 'settings.manage', group: 'Settings', label: 'Manage system settings' },
  { key: 'pipeline.manage', group: 'Settings', label: 'Manage statuses and pipelines' },
  { key: 'roles.manage', group: 'Security', label: 'Manage role permissions' },
  { key: 'leaves.apply', group: 'Staff', label: 'Apply for leave' },
  { key: 'leaves.review', group: 'Staff', label: 'Review leave' },
];

const ALL_PERMISSIONS = PERMISSIONS.map((item) => item.key);

const STAFF = [
  'dashboard.view',
  'leads.view',
  'leads.create',
  'leads.edit',
  'leads.swap',
  'followups.view',
  'followups.manage',
  'calls.view',
  'calls.sync',
  'calls.manual',
  'recordings.view',
  'contacts.view',
  'contacts.sync',
  'targets.view',
  'revenue.view',
  'leaderboard.view',
  'hourly.view',
  'notifications.view',
  'leaves.apply',
];

const TEAM_LEADER = [
  ...STAFF,
  'leads.assign',
  'leads.export',
  'staff.view',
  'reports.view',
  'reports.export',
  'leaves.review',
];

const ADMIN = [
  ...TEAM_LEADER,
  'leads.delete',
  'leads.import',
  'staff.manage',
  'users.manage',
  'teams.manage',
  'targets.manage',
  'revenue.manage',
  'notifications.manage',
  'pipeline.manage',
];

const SUPER_ADMIN = ALL_PERMISSIONS.filter((key) => key !== 'system.owner');

const ROLE_PERMISSIONS = {
  OWNER: ALL_PERMISSIONS,
  SUPER_ADMIN,
  ADMIN,
  TEAM_LEADER,
  STAFF,
};

function listForRole(role) {
  return ROLE_PERMISSIONS[role] ? [...ROLE_PERMISSIONS[role]] : [];
}

module.exports = {
  PERMISSIONS,
  ALL_PERMISSIONS,
  ROLE_PERMISSIONS,
  listForRole,
};
