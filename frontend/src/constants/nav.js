export const NAV = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', permission: 'dashboard.view' },
  { to: '/leads', label: 'Lead Management', icon: 'leads', permission: 'leads.view' },
  { to: '/pipeline', label: 'Pipeline', icon: 'pipeline', permission: 'leads.view' },
  { to: '/lead-bucket', label: 'Lead Bucket', icon: 'bucket', permission: 'leads.assign' },
  { to: '/assignments', label: 'Lead Assignment', icon: 'assign', permission: 'leads.assign' },
  { to: '/followups', label: 'Follow-ups', icon: 'followups', permission: 'followups.view' },
  { to: '/calls', label: 'Calling Analytics', icon: 'calls', permission: 'calls.view' },
  { to: '/hourly-reports', label: 'Hourly Reports', icon: 'hourly', permission: 'hourly.view' },
  { to: '/staff', label: 'Staff Management', icon: 'staff', permission: 'staff.view' },
  { to: '/users', label: 'User Management', icon: 'users', permission: 'roles.manage' },
  { to: '/targets', label: 'Targets & Revenue', icon: 'targets', any: ['targets.view', 'revenue.view'] },
  { to: '/leaderboard', label: 'Leaderboard', icon: 'leaderboard', permission: 'leaderboard.view' },
  { to: '/reports', label: 'Reports & Exports', icon: 'reports', permission: 'reports.view' },
  { to: '/notifications', label: 'Notifications', icon: 'alerts', permission: 'notifications.view' },
  { to: '/audit-logs', label: 'Audit Logs', icon: 'audit', permission: 'audit.view' },
  { to: '/branches', label: 'Branch Management', icon: 'branches', any: ['branches.manage', 'teams.manage'] },
  { to: '/settings', label: 'Settings', icon: 'settings', any: ['settings.manage', 'pipeline.manage'] },
];

export const DEMOS = [
  { role: 'OWNER', username: 'owner', password: '1234567', blurb: 'Full company access' },
  { role: 'SUPER ADMIN', username: 'superadmin', password: '1234567', blurb: 'Operations and settings' },
  { role: 'ADMIN', username: 'admin', password: '1234567', blurb: 'Head Office teams' },
  { role: 'TEAM LEADER', username: 'teamleader', password: '1234567', blurb: 'Inside Sales team' },
  { role: 'STAFF', username: 'staff', password: '1234567', blurb: 'Personal pipeline' },
];
