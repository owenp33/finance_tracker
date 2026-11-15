import { balanceAsOf, netPosition, rangeStart, rangePoints, forecastPoints } from '../utils/balances';

// A GET /api/balances entry: `days` as [date, cents]
const entry = (id, name, openingCents, days) => {
  const closing = days.length ? days[days.length - 1][1] : openingCents;
  return {
    id, account_name: name, opening: openingCents / 100, opening_cents: openingCents,
    days: days.map(([date, cents]) => ({ date, balance: cents / 100, balance_cents: cents })),
    closing: closing / 100, closing_cents: closing,
  };
};

const DISCOVER = entry(5, "Owen's Discover", 0, [['2026-02-10', -50000], ['2026-11-05', -85245]]);
const CHECKING = entry(6, "Owen's Checking", 0, [['2025-01-01', -98541], ['2026-05-01', 500000], ['2026-10-31', 727413]]);
const SAVINGS = entry(7, "Owen's Savings", 707429, [['2025-07-11', 49312], ['2026-09-28', 300000]]);
const BALANCES = [DISCOVER, CHECKING, SAVINGS];

test("a day's balance is the last end-of-day balance on or before it, or the opening before any", () => {
  expect(balanceAsOf(CHECKING, '2024-12-31')).toBe(0);
  expect(balanceAsOf(CHECKING, '2025-01-01')).toBe(-98541);
  expect(balanceAsOf(CHECKING, '2026-04-30')).toBe(-98541);
  expect(balanceAsOf(CHECKING, '2026-11-08')).toBe(727413);
  expect(balanceAsOf(SAVINGS, '2025-01-01')).toBe(707429);
});

test('net position adds every account up on each day any of them changed, carrying the rest forward', () => {
  expect(netPosition(BALANCES)).toEqual({
    opening_cents: 707429,
    days: [
      { date: '2025-01-01', balance_cents: 608888 },
      { date: '2025-07-11', balance_cents: -49229 },
      { date: '2026-02-10', balance_cents: -99229 },
      { date: '2026-05-01', balance_cents: 499312 },
      { date: '2026-09-28', balance_cents: 750000 },
      { date: '2026-10-31', balance_cents: 977413 },
      { date: '2026-11-05', balance_cents: 942168 },
    ],
    closing_cents: 942168,
  });
  expect(netPosition([])).toEqual({ opening_cents: 0, days: [], closing_cents: 0 });
});

test('a range starts 3, 6 or 12 months before today (clamped to a shorter month), or at the first day for All', () => {
  expect(rangeStart('3M', '2026-11-08', '2025-01-01')).toBe('2026-08-08');
  expect(rangeStart('6M', '2026-08-31', '2025-01-01')).toBe('2026-02-28');
  expect(rangeStart('1Y', '2026-11-08', '2025-01-01')).toBe('2025-11-08');
  expect(rangeStart('All', '2026-11-08', '2025-01-01')).toBe('2025-01-01');
});

// What GET /recurring/projection lists for the 30 days from Nov 8, 2026
const occurrence = (accountId, date, vendor, amount) => ({ recurring_id: 1, account_id: accountId, date, vendor, category: 'Bills', amount });
const SCHEDULED = [
  occurrence(6, '2026-11-09', 'Allina Health', -87.38),
  occurrence(6, '2026-11-30', 'ASPIRE', -75),
  occurrence(7, '2026-12-01', 'HLWW School District', 1700),
];

test("the forecast steps from today's balance by each day's scheduled items, through its last day", () => {
  expect(forecastPoints(942168, SCHEDULED, '2026-11-08', '2026-12-08')).toEqual([
    { date: '2026-11-09', cents: 933430, kind: 'forecast', items: [SCHEDULED[0]] },
    { date: '2026-11-30', cents: 925930, kind: 'forecast', items: [SCHEDULED[1]] },
    { date: '2026-12-01', cents: 1095930, kind: 'forecast', items: [SCHEDULED[2]] },
    { date: '2026-12-08', cents: 1095930, kind: 'forecast-end', items: [] },
  ]);
});

test("the forecast counts an item due today, and none after its last day; with none, it stays level", () => {
  const today = occurrence(6, '2026-11-08', 'Due today', -10);
  const later = occurrence(6, '2026-12-09', 'Past the window', -500);
  expect(forecastPoints(10000, [later, today], '2026-11-08', '2026-12-08')).toEqual([
    { date: '2026-11-08', cents: 9000, kind: 'forecast', items: [today] },
    { date: '2026-12-08', cents: 9000, kind: 'forecast-end', items: [] },
  ]);
  expect(forecastPoints(10000, [], '2026-11-08', '2026-12-08')).toEqual([
    { date: '2026-12-08', cents: 10000, kind: 'forecast-end', items: [] },
  ]);
});

test("a range's points: the balance carried in, each day's end-of-day balance, and today's", () => {
  expect(rangePoints(CHECKING, '2026-08-08', '2026-11-08')).toEqual([
    { date: '2026-08-08', cents: 500000, kind: 'start' },
    { date: '2026-10-31', cents: 727413, kind: 'day' },
    { date: '2026-11-08', cents: 727413, kind: 'end' },
  ]);
  // A change on the first day steps up from what was carried in; one today needs no extra point
  expect(rangePoints(DISCOVER, '2026-02-10', '2026-11-05')).toEqual([
    { date: '2026-02-10', cents: 0, kind: 'start' },
    { date: '2026-02-10', cents: -50000, kind: 'day' },
    { date: '2026-11-05', cents: -85245, kind: 'day' },
  ]);
});
