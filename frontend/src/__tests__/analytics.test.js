import { computeAnalytics, presetDates } from '../components/insights/analytics';

const tx = (date, amount, category, vendor, flags) => ({
  id: `${date}-${vendor}`, date, amount, amount_cents: Math.round(amount * 100), category, vendor,
  is_transfer: false, is_reimbursement: false, ...flags,
});

const TRANSACTIONS = [
  tx('2026-01-05', 1000, 'Paycheck', 'Employer'),
  tx('2026-01-10', -50.10, 'Groceries', 'Cub'),
  tx('2026-01-12', -20.20, 'Groceries', 'Cub'),
  tx('2026-01-15', 30.30, 'Groceries', 'Cub refund', { is_reimbursement: true }),   // income in the totals
  tx('2026-02-01', -500, 'Transfer', 'To savings', { is_transfer: true }),           // never counts
  tx('2026-02-03', 0, 'Misc', 'Nothing'),                                            // neither income nor spending
  tx('2026-02-10', -100, 'Fun', 'Concert'),
];

describe('the Overview analytics, by the shared money rules', () => {
  const analytics = () => computeAnalytics(TRANSACTIONS);

  test('totals count income and spending only: no transfers, no zero amounts; sums are exact', () => {
    expect(analytics().summary).toEqual({
      transaction_count: 5, total_income: 1030.3, total_expenses: 170.3, net_amount: 860, avg_transaction: 240.12,
    });
  });

  test('spending and income by category, largest first, with each share of its total', () => {
    expect(analytics().spending_by_category).toEqual([
      { category: 'Fun', total: 100, average: 100, count: 1, percentage: '58.7' },
      { category: 'Groceries', total: 70.3, average: 35.15, count: 2, percentage: '41.3' },
    ]);
    expect(analytics().income_by_category).toEqual([
      { category: 'Paycheck', total: 1000, average: 1000, count: 1, percentage: '97.1' },
      { category: 'Groceries', total: 30.3, average: 30.3, count: 1, percentage: '2.9' },
    ]);
  });

  test('by month, newest first, and the top vendors by spending', () => {
    expect(analytics().monthly_summary).toEqual([
      { month: '2026-02', income: 0, expenses: 100, net: -100 },
      { month: '2026-01', income: 1030.3, expenses: 70.3, net: 960 },
    ]);
    expect(analytics().top_vendors).toEqual([{ vendor: 'Concert', amount: 100 }, { vendor: 'Cub', amount: 70.3 }]);
  });

  test('weekly averages over the days from the first counted transaction to the last', () => {
    const { trends } = analytics();
    expect(trends.weekly_avg_income).toBeCloseTo(1030.3 / (36 / 7), 6);      // Jan 5 to Feb 10
    expect(trends.weekly_avg_expenses).toBeCloseTo(170.3 / (36 / 7), 6);
  });

  test('nothing to analyse is null; only transfers analyse to zeros', () => {
    expect(computeAnalytics([])).toBeNull();
    expect(computeAnalytics([TRANSACTIONS[4]]).summary).toEqual({
      transaction_count: 0, total_income: 0, total_expenses: 0, net_amount: 0, avg_transaction: 0,
    });
  });
});

describe('date presets', () => {
  afterEach(() => jest.useRealTimers());

  test("end today by the local date, even late in the evening when it's tomorrow in UTC", () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 10, 8, 23, 30));     // Nov 8, 2026, 11:30 pm
    expect(presetDates('3m')).toEqual({ start: '2026-08-08', end: '2026-11-08' });
    expect(presetDates('ytd')).toEqual({ start: '2026-01-01', end: '2026-11-08' });
    expect(presetDates('all')).toEqual({ start: '', end: '' });
  });

  test("a month back from the 31st is the shorter month's last day, not a day in this month", () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 2, 31, 12));         // Mar 31, 2026
    expect(presetDates('1m')).toEqual({ start: '2026-02-28', end: '2026-03-31' });
    expect(presetDates('1y')).toEqual({ start: '2025-03-31', end: '2026-03-31' });
  });
});
