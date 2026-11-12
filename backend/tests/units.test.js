const { normalizePhone, isValidPhone, formatPhone } = require('../src/utils/phone');
const { wallTimeToUtc, zonedParts, periodRange } = require('../src/utils/time');
const { summarizeMoney, weightedValue } = require('../src/utils/revenue');
const { classifyLeadMatch, callUniqueKey } = require('../src/utils/matching');
const { leaderboardScore } = require('../src/utils/score');

describe('phone numbers', () => {
  test('normalizes Indian mobiles and rejects short numbers', () => {
    expect(normalizePhone('99000 00001')).toBe('919900000001');
    expect(normalizePhone('+91 99000 00001')).toBe('919900000001');
    expect(normalizePhone('09900000001')).toBe('919900000001');
    expect(isValidPhone(normalizePhone('9900000001'))).toBe(true);
    expect(isValidPhone(normalizePhone('123'))).toBe(false);
    expect(formatPhone('919900000001')).toBe('+91 99000 00001');
  });
});

describe('timezone windows', () => {
  test('converts 10:00 IST to 04:30 UTC', () => {
    const utc = wallTimeToUtc(2026, 11, 10, 10, 0, 0, 'Asia/Kolkata');
    expect(utc.toISOString()).toBe('2026-11-10T04:30:00.000Z');
    expect(zonedParts(utc, 'Asia/Kolkata').hour).toBe(10);
  });

  test('week starts on Monday in the company timezone', () => {
    const range = periodRange('week', 'Asia/Kolkata', new Date('2026-11-10T04:30:00.000Z'));
    expect(zonedParts(range.start, 'Asia/Kolkata').day).toBe(9);
    expect(range.end > range.start).toBe(true);
  });
});

describe('revenue separation', () => {
  test('does not treat expected pipeline as collected cash', () => {
    const summary = summarizeMoney(
      [
        { status: 'open', expectedRevenue: 50000, dealValue: 50000, probability: 60 },
        { status: 'won', expectedRevenue: 80000, dealValue: 80000, probability: 100 },
        { status: 'lost', expectedRevenue: 15000, dealValue: 15000, probability: 0 },
      ],
      [{ amount: 30000 }]
    );
    expect(summary.expectedPipeline).toBe(50000);
    expect(summary.weightedPipeline).toBe(weightedValue(50000, 60));
    expect(summary.confirmed).toBe(80000);
    expect(summary.collected).toBe(30000);
    expect(summary.pendingCollection).toBe(50000);
    expect(summary.lost).toBe(15000);
    expect(summary.collected).not.toBe(summary.expectedPipeline);
  });
});

describe('call matching', () => {
  test('flags ambiguous numbers instead of guessing a lead', () => {
    expect(classifyLeadMatch([]).matchStatus).toBe('unmatched');
    expect(classifyLeadMatch([{ _id: 'a' }]).matchStatus).toBe('matched');
    const ambiguous = classifyLeadMatch([{ _id: 'a' }, { _id: 'b' }]);
    expect(ambiguous.matchStatus).toBe('ambiguous');
    expect(ambiguous.leadId).toBeNull();
  });

  test('builds a stable unique key for a device event', () => {
    const key = callUniqueKey({ deviceId: 'dev1', androidEventId: 'evt-1', phoneNormalized: '9199', startedAt: new Date(), callType: 'outgoing', durationSeconds: 10 });
    expect(key).toBe('dev1:evt-1');
  });
});

describe('leaderboard score', () => {
  test('does not rank on raw call volume alone', () => {
    const weights = { callingPerformance: 100, revenueCollected: 0, successfulSales: 0, leadConversion: 0, positiveLeads: 0, demoCompletion: 0, followUpCompletion: 0, targetAchievement: 0 };
    const noisy = leaderboardScore({ totalCalls: 500, connectedCalls: 0, talkTimeSeconds: 0 }, weights);
    const useful = leaderboardScore({ totalCalls: 10, connectedCalls: 8, talkTimeSeconds: 600 }, weights);
    expect(useful).toBeGreaterThan(noisy);
  });
});
