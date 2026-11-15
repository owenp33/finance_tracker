import { FORECAST_DAYS, lastNinetyDaysStart, categoryShares, forecastInputs, forecastPoints } from '../utils/forecast';
import { shiftDays } from '../utils/dates';

const TODAY = '2026-11-08';      // the last 90 days: Aug 11 through Nov 8, 2026

// A transaction as the app lists it, amounts in dollars
const tx = (id, accountId, date, category, amount, extra = {}) => ({
  id, account_id: accountId, date, vendor: `Vendor ${id}`, category,
  amount_cents: Math.round(amount * 100), recurring_id: null, is_transfer: false, ...extra,
});

const TRANSACTIONS = [
  // Loan: $225 of $250 in series 5, exactly 90%
  tx(1, 6, '2026-08-31', 'Loan', -75, { recurring_id: 5 }),
  tx(2, 6, '2026-09-30', 'Loan', -75, { recurring_id: 5 }),
  tx(3, 6, '2026-10-31', 'Loan', -75, { recurring_id: 5 }),
  tx(4, 6, '2026-09-15', 'Loan', -25),
  // Medical: $174.76 of $324.76 in series 6, about 54%
  tx(5, 6, '2026-10-12', 'Medical', -87.38, { recurring_id: 6 }),
  tx(6, 6, '2026-10-26', 'Medical', -87.38, { recurring_id: 6 }),
  tx(7, 6, '2026-09-02', 'Medical', -150),
  // Grocery: none in a series, in two accounts; Aug 11 is the first of the last 90 days, Aug 10 isn't
  tx(8, 6, '2026-08-11', 'Grocery', -45),
  tx(9, 5, '2026-10-01', 'Grocery', -90),
  tx(10, 6, '2026-08-10', 'Grocery', -1000),
  tx(11, 6, '2026-10-02', 'Grocery', 10),                              // a refund isn't spending
  // Neither income nor transfers count as spending
  tx(12, 7, '2026-10-01', 'Income', 1700),
  tx(13, 6, '2026-10-15', 'Payment', -500, { is_transfer: true }),
  tx(14, 6, '2026-10-16', 'Transfer', -200, { is_transfer: true, recurring_id: 22 }),
];

// An occurrence as GET /recurring/projection lists it, amounts in dollars
const occurrence = (recurringId, accountId, date, category, amount) =>
  ({ recurring_id: recurringId, account_id: accountId, date, vendor: `Series ${recurringId}`, category, amount });

const SCHEDULED = [
  occurrence(6, 6, '2026-11-09', 'Medical', -87.38),          // its category is averaged
  occurrence(22, 6, '2026-11-15', 'Transfer', -200),          // a transfer series: no spending to measure
  occurrence(20, 5, '2026-11-20', 'Streaming', -15.99),       // a new subscription
  occurrence(21, 6, '2026-11-25', 'Grocery', -60),            // new, in an averaged category
  occurrence(5, 6, '2026-11-30', 'Loan', -75),                // its category is scheduled
  occurrence(13, 7, '2026-12-01', 'Income', 1700),            // scheduled income
];

test('the forecast learns from the last 90 days, today and the 89 before it, and reaches as far ahead', () => {
  expect(FORECAST_DAYS).toBe(90);
  expect(lastNinetyDaysStart(TODAY)).toBe('2026-08-11');
  expect(lastNinetyDaysStart('2026-03-01')).toBe('2025-12-02');
});

test("each category's spending over the last 90 days, the part in a recurring series, and whether that's at least 90%", () => {
  expect(categoryShares(TRANSACTIONS, TODAY)).toEqual({
    Loan: { total: 25000, linked: 22500, scheduled: true },
    Medical: { total: 32476, linked: 17476, scheduled: false },
    Grocery: { total: 13500, linked: 0, scheduled: false },
  });
});

test('just under 90% in a series is averaged', () => {
  const shares = categoryShares([
    tx(1, 6, '2026-10-01', 'Utility', -89.99, { recurring_id: 9 }),
    tx(2, 6, '2026-10-02', 'Utility', -10.02),
  ], TODAY);
  expect(shares.Utility).toEqual({ total: 10001, linked: 8999, scheduled: false });
});

test('net position keeps scheduled income, scheduled categories and series without recent spending, and averages the rest', () => {
  const { occurrences, averages } = forecastInputs(TRANSACTIONS, SCHEDULED, [5, 6, 7], TODAY);
  expect(occurrences.map(o => o.recurring_id)).toEqual([22, 20, 21, 5, 13]);
  // Medical's series charges are in its average; Loan's unlinked $25 isn't forecast
  expect(averages).toEqual({ Medical: 32476, Grocery: 13500 });
});

test("an account's forecast keeps only its own items and averages only its own spending, but the 90% test spans every account", () => {
  const checking = forecastInputs(TRANSACTIONS, SCHEDULED, [6], TODAY);
  expect(checking.occurrences.map(o => o.recurring_id)).toEqual([22, 21, 5]);
  expect(checking.averages).toEqual({ Medical: 32476, Grocery: 4500 });

  const discover = forecastInputs(TRANSACTIONS, SCHEDULED, [5], TODAY);
  expect(discover.occurrences.map(o => o.recurring_id)).toEqual([20]);
  expect(discover.averages).toEqual({ Grocery: 9000 });
});

test('a scheduled category whose series have all ended forecasts nothing', () => {
  const ended = [tx(1, 6, '2026-09-03', 'Rent', -652.50, { recurring_id: 10 })];
  expect(forecastInputs(ended, [], [6], TODAY)).toEqual({ occurrences: [], averages: {} });
});

describe('forecast points', () => {
  const END = shiftDays(TODAY, FORECAST_DAYS);      // Feb 6, 2027

  test("averages spread evenly over each day after today, adding up to the last 90 days' spending", () => {
    const points = forecastPoints(100000, { occurrences: [], averages: { Grocery: 9000 } }, TODAY, END);
    expect(points).toHaveLength(90);
    expect(points[0]).toEqual({ date: '2026-11-09', cents: 99900, kind: 'forecast', items: [], average: 100 });
    expect(points[89]).toEqual({ date: '2027-02-06', cents: 91000, kind: 'forecast', items: [], average: 100 });
  });

  test('a daily share in fractions of a cent rounds day by day without drifting', () => {
    const points = forecastPoints(0, { occurrences: [], averages: { Fun: 600, Gym: 400 } }, TODAY, END);
    expect(points.map(p => p.average).slice(0, 5)).toEqual([11, 11, 11, 11, 12]);
    expect(points.reduce((sum, p) => sum + p.average, 0)).toBe(1000);
    expect(points[points.length - 1].cents).toBe(-1000);
  });

  test('scheduled items land on their dates, one due today included, on top of the averages', () => {
    const dueToday = occurrence(1, 6, '2026-11-08', 'Bills', -10);
    const paycheck = occurrence(13, 7, '2026-11-10', 'Income', 1700);
    expect(forecastPoints(50000, { occurrences: [dueToday, paycheck], averages: { Grocery: 9000 } }, TODAY, '2026-11-10')).toEqual([
      { date: '2026-11-08', cents: 49000, kind: 'forecast', items: [dueToday], average: 0 },
      { date: '2026-11-09', cents: 48900, kind: 'forecast', items: [], average: 100 },
      { date: '2026-11-10', cents: 218800, kind: 'forecast', items: [paycheck], average: 100 },
    ]);
  });

  test("without averages it steps only on scheduled days, then runs level to its last day; items past it don't count", () => {
    const bill = occurrence(6, 6, '2026-11-09', 'Bills', -87.38);
    const later = occurrence(6, 6, '2027-02-07', 'Bills', -500);
    expect(forecastPoints(942168, { occurrences: [bill, later], averages: {} }, TODAY, END)).toEqual([
      { date: '2026-11-09', cents: 933430, kind: 'forecast', items: [bill], average: 0 },
      { date: '2027-02-06', cents: 933430, kind: 'forecast-end', items: [], average: 0 },
    ]);
    expect(forecastPoints(10000, { occurrences: [], averages: {} }, TODAY, END)).toEqual([
      { date: '2027-02-06', cents: 10000, kind: 'forecast-end', items: [], average: 0 },
    ]);
  });
});
