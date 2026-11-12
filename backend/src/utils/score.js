function leaderboardScore(metrics, weights) {
  const w = weights || {};
  const conversion = Number(metrics.conversionRate) || 0;
  const followRate = Number(metrics.followUpRate) || 0;
  const targetRate = Number(metrics.targetAchievement) || 0;
  const connected = Number(metrics.connectedCalls) || 0;
  const talkMinutes = (Number(metrics.talkTimeSeconds) || 0) / 60;
  return Math.round(
    (Number(metrics.revenueCollected) || 0) * ((w.revenueCollected || 0) / 100)
    + (Number(metrics.successfulSales) || 0) * 1000 * ((w.successfulSales || 0) / 100)
    + conversion * 100 * ((w.leadConversion || 0) / 100)
    + (Number(metrics.positiveLeads) || 0) * 500 * ((w.positiveLeads || 0) / 100)
    + (Number(metrics.demosCompleted) || 0) * 800 * ((w.demoCompletion || 0) / 100)
    + (connected * 10 + talkMinutes) * ((w.callingPerformance || 0) / 100)
    + followRate * 100 * ((w.followUpCompletion || 0) / 100)
    + targetRate * 50 * ((w.targetAchievement || 0) / 100)
  );
}

module.exports = { leaderboardScore };
