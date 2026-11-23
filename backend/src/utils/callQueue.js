/** Calls Today order: 1 inbound/sheet → 2 Admin+ manual → 3 everything else. */
const CALL_QUEUE_INBOUND = 1;
const CALL_QUEUE_ADMIN_MANUAL = 2;
const CALL_QUEUE_OTHER = 3;

const ADMIN_PLUS_ROLES = ['OWNER', 'SUPER_ADMIN', 'ADMIN'];
const MANUAL_ASSIGN_MODES = ['manual', 'import', 'create', 'swap', 'equal_workload', 'capacity', 'team'];

function resolveCallQueueTier({ fromSheet = false, mode = 'manual', role = '' } = {}) {
  if (fromSheet) return CALL_QUEUE_INBOUND;
  const adminPlus = ADMIN_PLUS_ROLES.includes(String(role || ''));
  const manualLike = MANUAL_ASSIGN_MODES.includes(String(mode || 'manual'));
  if (adminPlus && manualLike) return CALL_QUEUE_ADMIN_MANUAL;
  return CALL_QUEUE_OTHER;
}

module.exports = {
  CALL_QUEUE_INBOUND,
  CALL_QUEUE_ADMIN_MANUAL,
  CALL_QUEUE_OTHER,
  ADMIN_PLUS_ROLES,
  resolveCallQueueTier,
};
