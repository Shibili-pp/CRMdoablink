function weightedValue(expectedRevenue, probability) {
  const expected = Number(expectedRevenue) || 0;
  const chance = Number(probability) || 0;
  return Math.round(expected * (chance / 100) * 100) / 100;
}

function summarizeMoney(opportunities, payments) {
  const rows = opportunities || [];
  const paid = (payments || []).reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
  let expectedPipeline = 0;
  let weightedPipeline = 0;
  let confirmed = 0;
  let lost = 0;
  rows.forEach((row) => {
    const expected = Number(row.expectedRevenue) || 0;
    const deal = Number(row.dealValue) || 0;
    if (row.status === 'lost') {
      lost += deal || expected;
      return;
    }
    if (row.status === 'won') {
      confirmed += deal;
      return;
    }
    expectedPipeline += expected;
    weightedPipeline += weightedValue(expected, row.probability);
  });
  const collected = paid;
  const pendingCollection = Math.max(0, Math.round((confirmed - collected) * 100) / 100);
  return {
    expectedPipeline: round(expectedPipeline),
    weightedPipeline: round(weightedPipeline),
    confirmed: round(confirmed),
    collected: round(collected),
    pendingCollection,
    lost: round(lost),
  };
}

function round(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

module.exports = { weightedValue, summarizeMoney, round };
