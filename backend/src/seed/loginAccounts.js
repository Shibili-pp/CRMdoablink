const bcrypt = require('bcryptjs');
const { User } = require('../models');
const { roleTemplate } = require('../services/settings');

const LOGINS = [
  { username: 'owner', name: 'Owner', role: 'OWNER' },
  { username: 'superadmin', name: 'Super Admin', role: 'SUPER_ADMIN' },
  { username: 'admin', name: 'Admin', role: 'ADMIN' },
  { username: 'teamleader', name: 'Team Leader', role: 'TEAM_LEADER' },
  { username: 'staff', name: 'Staff', role: 'STAFF' },
];

async function ensureLoginAccounts() {
  const passwordHash = await bcrypt.hash('1234567', 10);
  for (const spec of LOGINS) {
    const existing = await User.findOne({ username: spec.username, deletedAt: null });
    if (existing) {
      if (existing.isDemo) {
        existing.isDemo = false;
        await existing.save();
      }
      continue;
    }
    await User.create({
      username: spec.username,
      email: `${spec.username}@users.doablinkorbit.local`,
      passwordHash,
      name: spec.name,
      role: spec.role,
      permissions: await roleTemplate(spec.role),
      permissionMode: 'role',
      joiningDate: new Date(),
      employmentStatus: 'active',
      isActive: true,
      isDemo: false,
    });
  }
  console.log('Login accounts are ready. No sample leads were added.');
}

module.exports = { ensureLoginAccounts };
