const PRIMARY_FIRMS = ['doablink', 'studlink'];

function firmKey(lead) {
  const key = String(lead?.firm || '').toLowerCase().trim();
  if (PRIMARY_FIRMS.includes(key)) return key;
  return key || 'other';
}

function buildFirmPools(leads) {
  const pools = { doablink: [], studlink: [], other: [] };
  leads.forEach((lead) => {
    const key = firmKey(lead);
    if (key === 'doablink' || key === 'studlink') pools[key].push(lead);
    else pools.other.push(lead);
  });
  return pools;
}

function poolSize(pools) {
  return (pools.doablink?.length || 0) + (pools.studlink?.length || 0) + (pools.other?.length || 0);
}

function pullFromPool(pool, staff, preferLead) {
  if (!pool?.length) return null;
  if (typeof preferLead === 'function') {
    const index = pool.findIndex((lead) => preferLead(lead, staff));
    if (index >= 0) {
      const [lead] = pool.splice(index, 1);
      return lead;
    }
  }
  return pool.shift();
}

/** Cap a lead list to `limit` while keeping Doablink/Studlink as even as possible. */
function takeBalancedPool(leads, limit) {
  if (!Array.isArray(leads) || !leads.length || limit <= 0) return [];
  if (leads.length <= limit) return [...leads];

  const pools = buildFirmPools([...leads]);
  const out = [];
  const firmGot = { doablink: 0, studlink: 0, other: 0 };
  while (out.length < limit) {
    const taken = takeLeadForStaff(pools, firmGot);
    if (!taken) break;
    out.push(taken.lead);
    firmGot[taken.firm] = (firmGot[taken.firm] || 0) + 1;
  }
  return out;
}

/**
 * Prefer 50-50 Doablink/Studlink for each staff.
 * If one firm runs low, fill remaining quota from the other firm (then other).
 * Returns { lead, firm } or null.
 */
function takeLeadForStaff(pools, firmGot, staff = null, preferLead = null) {
  if (!poolSize(pools)) return null;
  const d = firmGot.doablink || 0;
  const s = firmGot.studlink || 0;
  const prefer = d <= s ? 'doablink' : 'studlink';
  const other = prefer === 'doablink' ? 'studlink' : 'doablink';

  let lead = pullFromPool(pools[prefer], staff, preferLead);
  if (lead) return { lead, firm: prefer };

  lead = pullFromPool(pools[other], staff, preferLead);
  if (lead) return { lead, firm: other };

  lead = pullFromPool(pools.other, staff, preferLead);
  if (lead) return { lead, firm: 'other' };

  return null;
}

/**
 * Distribute leads to staff with per-staff quotas, balancing firms 50-50.
 * rotateHintStaffId: preferred first recipient (RNP/UTC previous owner → next).
 * preferLead(lead, staff): optional — prefer leads that should rotate to this staff.
 * assignOne(lead, staff) => Promise<{ ok: boolean }>
 */
async function distributeWithFirmBalance({
  leads,
  eligible,
  quotas,
  assignOne,
  rotateHintStaffId = null,
  gotCounts = null,
  preferLead = null,
}) {
  if (!leads?.length || !eligible?.length) {
    return { assigned: 0, skipped: leads?.length || 0, byFirm: {} };
  }

  const pools = buildFirmPools([...leads]);
  const left = new Map(eligible.map((person) => [String(person._id), Number(quotas.get(String(person._id)) || 0)]));
  const got = gotCounts || new Map(eligible.map((person) => [String(person._id), 0]));
  const firmGot = new Map(eligible.map((person) => [String(person._id), { doablink: 0, studlink: 0, other: 0 }]));

  let assigned = 0;
  let skipped = 0;
  let lastAssignedStaffId = null;
  const byFirm = { doablink: 0, studlink: 0, other: 0 };

  const orderedStaff = [...eligible].sort((a, b) => String(a._id).localeCompare(String(b._id)));
  let startAt = 0;
  if (rotateHintStaffId) {
    const idx = orderedStaff.findIndex((person) => String(person._id) === String(rotateHintStaffId));
    if (idx >= 0) startAt = (idx + 1) % orderedStaff.length;
  }

  while (poolSize(pools) > 0) {
    const candidates = orderedStaff
      .map((person, index) => {
        const sid = String(person._id);
        return {
          person,
          sid,
          left: left.get(sid) || 0,
          got: got.get(sid) || 0,
          rotate: (index - startAt + orderedStaff.length) % orderedStaff.length,
          firms: firmGot.get(sid),
        };
      })
      .filter((row) => row.left > 0)
      .sort((a, b) => {
        if (a.got !== b.got) return a.got - b.got;
        if (a.rotate !== b.rotate) return a.rotate - b.rotate;
        return a.sid.localeCompare(b.sid);
      });

    if (!candidates.length) break;

    const pick = candidates[0];
    const taken = takeLeadForStaff(pools, pick.firms, pick.person, preferLead);
    if (!taken) break;

    const result = await assignOne(taken.lead, pick.person);
    if (!result?.ok) {
      skipped += 1;
      continue;
    }

    assigned += 1;
    lastAssignedStaffId = pick.sid;
    left.set(pick.sid, (left.get(pick.sid) || 0) - 1);
    got.set(pick.sid, (got.get(pick.sid) || 0) + 1);
    const firms = firmGot.get(pick.sid);
    firms[taken.firm] = (firms[taken.firm] || 0) + 1;
    byFirm[taken.firm] = (byFirm[taken.firm] || 0) + 1;
    startAt = (orderedStaff.findIndex((person) => String(person._id) === pick.sid) + 1) % orderedStaff.length;
  }

  skipped += poolSize(pools);
  return {
    assigned,
    skipped,
    byFirm,
    gotCounts: got,
    lastAssignedStaffId,
    nextCursor: startAt,
  };
}

module.exports = {
  PRIMARY_FIRMS,
  firmKey,
  buildFirmPools,
  takeBalancedPool,
  takeLeadForStaff,
  distributeWithFirmBalance,
};
