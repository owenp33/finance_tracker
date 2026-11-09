import {
  isFinished, monthlyEquivalent, paidBeyondSchedule, recurringCosts, paymentMarks, seriesTimeline,
} from '../utils/recurring';

const template = (overrides) => ({
  id: 5, account_id: 1, date: '2025-01-31', vendor: 'ASPIRE', category: 'Loan', amount: -75, notes: '',
  next_date: '2026-11-30', last_date: '2026-10-31', frequency: 1, frequency_unit: 'months', number: -1, idx: 36,
  ...overrides,
});

const payment = (recurringId, date, amount) => ({
  id: `${recurringId}-${date}`, account_id: 1, date, vendor: 'Vendor', category: 'Bills', notes: '',
  amount, amount_cents: Math.round(amount * 100), recurring_id: recurringId, is_transfer: false, is_reimbursement: false,
});

const monthsFrom = (from, count) => Array.from({ length: count }, (_, i) => {
  const [year, month] = from.split('-').map(Number);
  const d = new Date(year, month - 1 + i, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
});

const ASPIRE = template();
const ALLINA = template({
  id: 6, vendor: 'Allina Health', category: 'Medical', amount: -87.38, frequency: 14, frequency_unit: 'days',
  number: 8, idx: 8, date: '2026-07-20', next_date: '2026-11-09',
});
const ANTHROPIC = template({ id: 7, account_id: 2, vendor: 'Anthropic', category: 'Subscriptions', amount: -20, date: '2026-04-02' });
const MILLENIUM = template({ id: 10, vendor: 'Millenium Apartments', category: 'Rent', amount: -652.50, number: 12, idx: 13 });
const SHELBY = template({
  id: 11, vendor: 'Shelby Jackson LLC', category: 'Rent', amount: -900, number: 7, idx: 8, last_date: '2025-07-01',
});
const PAYCHECK = template({
  id: 13, account_id: 3, vendor: 'HLWW School District', category: 'Income', amount: 1700, frequency: 14,
  frequency_unit: 'days', date: '2026-12-01', next_date: '2026-12-01', idx: 1,
});
const TEMPLATES = [ASPIRE, ALLINA, ANTHROPIC, MILLENIUM, SHELBY, PAYCHECK];

const TRANSACTIONS = [
  // ASPIRE: $75 every month Nov 2025–Oct 2026 plus $105 of extra payments; one before, one not its own
  ...monthsFrom('2025-11', 12).map(m => payment(5, `${m}-28`, -75)),
  payment(5, '2026-02-12', -60),
  payment(5, '2026-06-03', -45),
  payment(5, '2025-10-31', -75),
  payment(99, '2026-03-15', -500),
  // Anthropic: $20 every month since April, this month's too
  ...monthsFrom('2026-04', 8).map(m => payment(7, `${m}-02`, -20)),
  // Allina: seven biweekly charges since July 20
  ...['2026-07-20', '2026-08-03', '2026-08-17', '2026-08-31', '2026-09-14', '2026-09-28', '2026-10-26']
    .map(d => payment(6, d, -87.38)),
  // Millenium's last two rents
  payment(10, '2026-08-02', -652.50),
  payment(10, '2026-09-02', -652.50),
];

const TODAY = '2026-11-05';

// What GET /recurring/projection lists from Nov 5, 2026 through Feb 28, 2027
const occurrence = (recurringId, date) => ({ recurring_id: recurringId, account_id: 1, date, vendor: 'Vendor', category: 'Bills', amount: -1 });
const OCCURRENCES = [
  ...['2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28'].map(d => occurrence(5, d)),
  occurrence(6, '2026-11-09'),                                                       // Allina's last
  ...['2026-12-02', '2027-01-02', '2027-02-02'].map(d => occurrence(7, d)),
  ...['2026-12-01', '2026-12-15', '2026-12-29', '2027-01-12', '2027-01-26', '2027-02-09', '2027-02-23'].map(d => occurrence(13, d)),
];

describe('a series per month', () => {
  test('weekly × 52/12, biweekly × 26/12, monthly × 1, quarterly ÷ 3, annually ÷ 12, signed like its amount', () => {
    const per = (amount, frequency, frequency_unit) => monthlyEquivalent(template({ amount, frequency, frequency_unit }));
    expect(per(-10, 7, 'days')).toBe(-4333);
    expect(per(-87.38, 14, 'days')).toBe(-18932);
    expect(per(-20, 1, 'months')).toBe(-2000);
    expect(per(-90, 3, 'months')).toBe(-3000);
    expect(per(-120, 12, 'months')).toBe(-1000);
    expect(per(1700, 14, 'days')).toBe(368333);
  });

  test('an older schedule of N days repeats 364/N times a year', () => {
    expect(monthlyEquivalent(template({ amount: -10, frequency: 30, frequency_unit: 'days' }))).toBe(-1011);
  });
});

test('a limited series is finished once every occurrence is used', () => {
  expect(isFinished(ASPIRE)).toBe(false);
  expect(isFinished(ALLINA)).toBe(false);         // its 8th and last is still to come
  expect(isFinished(MILLENIUM)).toBe(true);
});

describe('paid beyond schedule', () => {
  test("compares the last 12 full months' payments with the schedule", () => {
    expect(paidBeyondSchedule(ASPIRE, TRANSACTIONS, TODAY)).toEqual({
      from: '2025-11', to: '2026-10', months: 12, paid: 100500, scheduled: 90000, extra: 10500,
    });
  });

  test('a younger series is compared from the month of its first payment', () => {
    expect(paidBeyondSchedule(ANTHROPIC, TRANSACTIONS, TODAY)).toEqual({
      from: '2026-04', to: '2026-10', months: 7, paid: 14000, scheduled: 14000, extra: 0,
    });
  });

  test('paying less than scheduled is no extra', () => {
    expect(paidBeyondSchedule(ALLINA, TRANSACTIONS, TODAY)).toMatchObject({ paid: 61166, scheduled: 75728, extra: 0 });
  });

  test("a series with no payment before this month can't be compared yet", () => {
    expect(paidBeyondSchedule(ASPIRE, [payment(5, '2026-11-01', -75)], TODAY)).toBeNull();
    expect(paidBeyondSchedule(ASPIRE, [], TODAY)).toBeNull();
  });

  test('transfers never count', () => {
    const transfer = { ...payment(5, '2026-10-15', -500), is_transfer: true };
    expect(paidBeyondSchedule(ASPIRE, [...TRANSACTIONS, transfer], TODAY).extra).toBe(10500);
  });
});

test('recurring costs: active series first, then ended ones, each costliest first; the total is the active ones', () => {
  const { series, total, activeCount, incomeCount } = recurringCosts(TEMPLATES, TRANSACTIONS, TODAY);
  expect(series.map(s => [s.template.vendor, s.monthly, s.ended])).toEqual([
    ['Allina Health', 18932, null],
    ['ASPIRE', 7500, null],
    ['Anthropic', 2000, null],
    ['Shelby Jackson LLC', 90000, '2025-07'],         // no payments: its schedule's last date
    ['Millenium Apartments', 65250, '2026-09'],       // its last payment
  ]);
  expect(series.map(s => s.beyond?.extra ?? null)).toEqual([0, 10500, 0, null, null]);
  expect([total, activeCount, incomeCount]).toEqual([28432, 3, 1]);
});

describe('payment marks', () => {
  test('a ring where the amount changed from the payment before, a dot for each payment beyond the first in its month', () => {
    const payments = [
      payment(5, '2026-04-30', -75),
      payment(5, '2026-01-31', -75),
      payment(5, '2026-02-27', -75),
      payment(5, '2026-03-02', -45),
      payment(5, '2026-03-31', -45),
      payment(5, '2026-04-02', -105),
      payment(99, '2026-02-10', -500),                              // another series
      { ...payment(5, '2026-02-11', -500), is_transfer: true },      // a transfer
    ];
    expect(paymentMarks(ASPIRE, payments).map(p => [p.date, p.changed, p.extra])).toEqual([
      ['2026-01-31', false, false],
      ['2026-02-27', false, false],
      ['2026-03-02', true, false],
      ['2026-03-31', false, true],
      ['2026-04-02', true, false],
      ['2026-04-30', true, true],
    ]);
  });

  test("a biweekly series' periods are 14 days from its first payment, so three charges in August aren't extra", () => {
    const payments = TRANSACTIONS.filter(t => t.recurring_id === 6);
    expect(paymentMarks(ALLINA, payments).filter(p => p.extra)).toEqual([]);
    const marks = paymentMarks(ALLINA, [...payments, payment(6, '2026-08-05', -87.38)]);
    expect(marks.filter(p => p.extra).map(p => p.date)).toEqual(['2026-08-05']);
  });
});

describe('the series timeline', () => {
  const rows = () => seriesTimeline(TEMPLATES, TRANSACTIONS, OCCURRENCES, TODAY, '2027-02-28');

  test('a row per series, income included, earliest first; one with nothing to draw goes last', () => {
    expect(rows().map(r => [r.template.vendor, r.kind, r.active])).toEqual([
      ['ASPIRE', 'cost', true],
      ['Anthropic', 'cost', true],
      ['Allina Health', 'cost', true],
      ['Millenium Apartments', 'cost', false],
      ['HLWW School District', 'income', true],
      ['Shelby Jackson LLC', 'cost', false],
    ]);
  });

  test('posted runs from the first payment to the last; still scheduled from today to the last occurrence, or past the window', () => {
    const byVendor = Object.fromEntries(rows().map(r => [r.template.vendor, [r.posted, r.scheduled, r.continues]]));
    expect(byVendor).toEqual({
      'ASPIRE':               [{ from: '2025-10-31', to: '2026-10-28' }, { from: '2026-11-05', to: '2027-02-28' }, true],
      'Anthropic':            [{ from: '2026-04-02', to: '2026-11-02' }, { from: '2026-11-05', to: '2027-02-28' }, true],
      'Allina Health':        [{ from: '2026-07-20', to: '2026-10-26' }, { from: '2026-11-05', to: '2026-11-09' }, false],
      'Millenium Apartments': [{ from: '2026-08-02', to: '2026-09-02' }, null, false],
      'HLWW School District': [null, { from: '2026-12-01', to: '2027-02-28' }, true],      // starts Dec 1
      'Shelby Jackson LLC':   [null, null, false],
    });
  });

  test("each row carries its payments' marks", () => {
    const aspire = rows()[0];
    expect(aspire.payments).toHaveLength(15);
    expect(aspire.payments.filter(p => p.changed).map(p => p.date)).toEqual(['2026-02-12', '2026-02-28', '2026-06-03', '2026-06-28']);
    expect(aspire.payments.filter(p => p.extra).map(p => p.date)).toEqual(['2026-02-28', '2026-06-28']);
  });
});

test('no templates, no costs', () => {
  expect(recurringCosts([], [], TODAY)).toEqual({ series: [], total: 0, activeCount: 0, incomeCount: 0 });
});
