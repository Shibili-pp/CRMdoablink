function classifyLeadMatch(leads) {
  const rows = leads || [];
  if (rows.length === 0) {
    return { matchStatus: 'unmatched', leadId: null, candidateLeadIds: [] };
  }
  if (rows.length === 1) {
    return { matchStatus: 'matched', leadId: rows[0]._id, candidateLeadIds: [rows[0]._id] };
  }
  return {
    matchStatus: 'ambiguous',
    leadId: null,
    candidateLeadIds: rows.map((lead) => lead._id),
  };
}

function callUniqueKey({ deviceId, androidEventId, phoneNormalized, startedAt, callType, durationSeconds }) {
  if (androidEventId) return `${deviceId || 'manual'}:${androidEventId}`;
  const when = startedAt ? new Date(startedAt).toISOString() : '';
  return `${deviceId || 'manual'}:${phoneNormalized}:${when}:${callType}:${durationSeconds || 0}`;
}

module.exports = { classifyLeadMatch, callUniqueKey };
