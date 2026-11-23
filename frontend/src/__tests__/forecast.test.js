import {
  forecastFor,
  FORECAST_DAYS, lastNinetyDaysStart, categoryShares, forecastInputs, forecastPoints, forecastAssumptions, accountInputs,
} from '../utils/forecast';
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

// A recurring template, as far as the forecast reads it: unlimited (`number` -1) unless given,
// finished once `idx` passes `number`
const template = (id, number = -1, idx = 1) => ({ id, number, idx });
const ACTIVE = [template(5), template(6), template(22)];

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
  expect(categoryShares(TRANSACTIONS, ACTIVE, TODAY)).toEqual({
    Loan: { total: 25000, linked: 22500, reimbursed: 0, scheduled: true },
    Medical: { total: 32476, linked: 17476, reimbursed: 0, scheduled: false },
    Grocery: { total: 13500, linked: 0, reimbursed: 0, scheduled: false },
  });
});

// Medical: $174.76 in series 6, and a $150 purchase in Discover paid back with $160 into Checking
const MEDICAL = [
  tx(1, 6, '2026-10-12', 'Medical', -87.38, { recurring_id: 6 }),
  tx(2, 6, '2026-10-26', 'Medical', -87.38, { recurring_id: 6 }),
  tx(3, 5, '2026-08-24', 'Medical', -150),
  tx(4, 6, '2026-08-24', 'Medical', 160, { is_reimbursement: true }),
];
const ALLINA = [occurrence(6, 6, '2026-11-23', 'Medical', -87.38)];

test("a category's reimbursements come off its spending, so a paid-back purchase no longer outweighs its series", () => {
  // $324.76 − $160 leaves $164.76, all of it covered by the series' $174.76: scheduled
  expect(categoryShares(MEDICAL, [template(6)], TODAY)).toEqual({
    Medical: { total: 32476, linked: 17476, reimbursed: 16000, scheduled: true },
  });
  expect(forecastInputs(MEDICAL, [template(6)], ALLINA, [5, 6, 7], TODAY)).toEqual({ occurrences: ALLINA, averages: {} });
  // Money in that isn't marked as a reimbursement takes nothing off: 53% in the series, averaged
  const unmarked = MEDICAL.map(t => (t.id === 4 ? { ...t, is_reimbursement: false } : t));
  expect(forecastInputs(unmarked, [template(6)], ALLINA, [5, 6, 7], TODAY)).toEqual({ occurrences: [], averages: { Medical: 32476 } });
  // Paid back in full, nothing is left to forecast: neither its series' charges nor an average
  const paidBack = [...MEDICAL.slice(0, 2), tx(5, 6, '2026-10-27', 'Medical', 174.76, { is_reimbursement: true })];
  expect(forecastInputs(paidBack, [template(6)], ALLINA, [5, 6, 7], TODAY)).toEqual({ occurrences: [], averages: {} });
});

test("an averaged category's average is its spending less the reimbursements in the accounts shown, never below 0", () => {
  const utility = [
    tx(1, 6, '2026-09-05', 'Utility', -120),                              // Checking pays the bill
    tx(2, 6, '2026-09-06', 'Utility', -10, { is_reimbursement: true }),  // paying someone back is spending
    tx(3, 6, '2026-09-20', 'Utility', 40, { is_reimbursement: true }),   // a roommate pays back into Checking
    tx(4, 5, '2026-10-05', 'Utility', -30),                               // Discover
    tx(5, 7, '2026-10-06', 'Utility', 50, { is_reimbursement: true }),   // and into Savings
  ];
  expect(categoryShares(utility, [], TODAY)).toEqual({ Utility: { total: 16000, linked: 0, reimbursed: 9000, scheduled: false } });
  expect(forecastInputs(utility, [], [], [5, 6, 7], TODAY).averages).toEqual({ Utility: 7000 });
  expect(forecastInputs(utility, [], [], [6], TODAY).averages).toEqual({ Utility: 9000 });
  expect(forecastInputs(utility, [], [], [5], TODAY).averages).toEqual({ Utility: 3000 });
  expect(forecastInputs(utility, [], [], [7], TODAY).averages).toEqual({});
});

test('just under 90% in a series is averaged', () => {
  const shares = categoryShares([
    tx(1, 6, '2026-10-01', 'Utility', -89.99, { recurring_id: 9 }),
    tx(2, 6, '2026-10-02', 'Utility', -10.02),
  ], [template(9)], TODAY);
  expect(shares.Utility).toEqual({ total: 10001, linked: 8999, reimbursed: 0, scheduled: false });
});

test('net position keeps scheduled income, scheduled categories and series without recent spending, and averages the rest', () => {
  const { occurrences, averages } = forecastInputs(TRANSACTIONS, ACTIVE, SCHEDULED, [5, 6, 7], TODAY);
  expect(occurrences.map(o => o.recurring_id)).toEqual([22, 20, 21, 5, 13]);
  // Medical's series charges are in its average; Loan's unlinked $25 isn't forecast
  expect(averages).toEqual({ Medical: 32476, Grocery: 13500 });
});

test("an account's forecast keeps only its own items and averages only its own spending, but the 90% test spans every account", () => {
  const checking = forecastInputs(TRANSACTIONS, ACTIVE, SCHEDULED, [6], TODAY);
  expect(checking.occurrences.map(o => o.recurring_id)).toEqual([22, 21, 5]);
  expect(checking.averages).toEqual({ Medical: 32476, Grocery: 4500 });

  const discover = forecastInputs(TRANSACTIONS, ACTIVE, SCHEDULED, [5], TODAY);
  expect(discover.occurrences.map(o => o.recurring_id)).toEqual([20]);
  expect(discover.averages).toEqual({ Grocery: 9000 });
});

test("an ended series' charges won't come again, so the 90% test and the averages leave them out", () => {
  const rent = [
    tx(1, 6, '2026-09-03', 'Rent', -652.50, { recurring_id: 10 }),
    tx(2, 6, '2026-09-10', 'Rent', -50),
  ];
  // Still running, the series makes Rent 93% scheduled; with no charges to come, it forecasts nothing
  expect(forecastInputs(rent, [template(10)], [], [6], TODAY)).toEqual({ occurrences: [], averages: {} });
  // Ended (12 payments of 12), only the $50 outside it is left, and that's averaged
  const ended = [template(10, 12, 13)];
  expect(categoryShares(rent, ended, TODAY)).toEqual({ Rent: { total: 5000, linked: 0, reimbursed: 0, scheduled: false } });
  expect(forecastInputs(rent, ended, [], [6], TODAY)).toEqual({ occurrences: [], averages: { Rent: 5000 } });
  // A category that only had the ended series isn't forecast at all
  expect(forecastInputs([rent[0]], ended, [], [6], TODAY)).toEqual({ occurrences: [], averages: {} });
});

describe('forecast points', () => {
  const END = shiftDays(TODAY, FORECAST_DAYS);      // Feb 6, 2027

  test("averages spread evenly over each day after today, adding up to the last 90 days' spending", () => {
    const points = forecastPoints(100000, { occurrences: [], averages: { Grocery: 9000 } }, TODAY, END);
    expect(points).toHaveLength(90);
    expect(points[0]).toEqual({ date: '2026-11-09', cents: 99900, kind: 'forecast', items: [], average: 100, interest: 0 });
    expect(points[89]).toEqual({ date: '2027-02-06', cents: 91000, kind: 'forecast', items: [], average: 100, interest: 0 });
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
      { date: '2026-11-08', cents: 49000, kind: 'forecast', items: [dueToday], average: 0, interest: 0 },
      { date: '2026-11-09', cents: 48900, kind: 'forecast', items: [], average: 100, interest: 0 },
      { date: '2026-11-10', cents: 218800, kind: 'forecast', items: [paycheck], average: 100, interest: 0 },
    ]);
  });

  test("without averages it steps only on scheduled days, then runs level to its last day; items past it don't count", () => {
    const bill = occurrence(6, 6, '2026-11-09', 'Bills', -87.38);
    const later = occurrence(6, 6, '2027-02-07', 'Bills', -500);
    expect(forecastPoints(942168, { occurrences: [bill, later], averages: {} }, TODAY, END)).toEqual([
      { date: '2026-11-09', cents: 933430, kind: 'forecast', items: [bill], average: 0, interest: 0 },
      { date: '2027-02-06', cents: 933430, kind: 'forecast-end', items: [], average: 0, interest: 0 },
    ]);
    expect(forecastPoints(10000, { occurrences: [], averages: {} }, TODAY, END)).toEqual([
      { date: '2027-02-06', cents: 10000, kind: 'forecast-end', items: [], average: 0, interest: 0 },
    ]);
  });
});

describe('loans and interest', () => {
  // ASPIRE (template 5, on Checking) pays down the loan (account 9); another series doesn't
  const RECURRING = [{ id: 5, loan_account_id: 9 }, { id: 6, loan_account_id: null }];
  const payment = (recurringId, date, amount) => ({ recurring_id: recurringId, account_id: 6, date, vendor: `Series ${recurringId}`,
                                                    category: 'Loan', amount });
  const OCCURRENCES = [payment(5, '2026-11-17', -75), payment(6, '2026-11-17', -20), payment(5, '2026-12-17', -75)];
  // $10,000 owed at 7.3% a year, charged monthly
  const LOAN = { id: 9, name: 'ASPIRE loan', kind: 'loan', apr: 7.3, frequency: 'monthly', startCents: -1000000 };
  // $3,000 held at 0.5% a year, paid yearly
  const SAVINGS = { id: 7, name: 'Savings', kind: 'bank', apr: 0.5, frequency: 'yearly', startCents: 300000 };
  const inputs = (accounts, occurrences = OCCURRENCES) => accountInputs(accounts, [], RECURRING, occurrences, '2026-11-15');
  const run = (startCents, accounts, occurrences, to) =>
    forecastPoints(startCents, { occurrences, averages: {}, accounts }, '2026-11-15', to);

  test("a loan gets its paying series' scheduled payments, mirrored as money paid in; a bank account none", () => {
    const [loan, savings] = inputs([LOAN, SAVINGS]);
    expect(loan).toMatchObject({ id: 9, name: 'ASPIRE loan', apr: 7.3, frequency: 'monthly', startCents: -1000000 });
    expect(loan.payments.map(p => [p.date, p.account_id, p.amount, p.vendor, p.loanPayment])).toEqual([
      ['2026-11-17', 9, 75, 'Series 5', true],
      ['2026-12-17', 9, 75, 'Series 5', true],
    ]);
    expect(savings.payments).toEqual([]);
  });

  test('a loan is charged on the 1st of each month, a 12th of its yearly rate on what it owed the day before', () => {
    // Dec 1: $9,925.00 owed × 7.3% ÷ 12 = $60.38; Jan 1: $9,910.38 owed (after Dec 17's $75) = $60.29
    expect(run(-1000000, inputs([LOAN]), [], '2027-01-20').map(p => [p.date, p.cents, p.interest])).toEqual([
      ['2026-11-17', -992500, 0],
      ['2026-12-01', -998538, -6038],
      ['2026-12-17', -991038, 0],
      ['2027-01-01', -997067, -6029],
      ['2027-01-20', -997067, 0],
    ]);
  });

  test('a savings account is paid on its positive balance, its own scheduled items included', () => {
    // A $1,700 paycheck lands in Savings on Dec 1, so Jan 1 pays 0.5% of $4,700.00 = $23.50
    const paycheck = { recurring_id: 13, account_id: 7, date: '2026-12-01', vendor: 'Paycheck', category: 'Income', amount: 1700 };
    const points = run(300000, inputs([SAVINGS], [paycheck]), [paycheck], '2027-02-12');
    expect(points.map(p => [p.date, p.cents, p.interest])).toEqual([
      ['2026-12-01', 470000, 0],
      ['2027-01-01', 472350, 2350],
      ['2027-02-12', 472350, 0],
    ]);
  });

  test('quarterly interest hits on each quarter\'s first day; nothing without a rate or a balance to earn on', () => {
    const quarterly = { ...SAVINGS, apr: 4, frequency: 'quarterly', startCents: 1000000 };
    expect(run(1000000, inputs([quarterly]), [], '2027-02-12').map(p => [p.date, p.interest])).toEqual([
      ['2027-01-01', 10000], ['2027-02-12', 0],
    ]);
    expect(run(300000, inputs([{ ...SAVINGS, apr: null }]), [], '2027-02-12').map(p => p.interest)).toEqual([0]);
    expect(run(-5000, inputs([{ ...SAVINGS, startCents: -5000 }]), [], '2027-02-12').map(p => p.interest)).toEqual([0]);
  });

  test("in net position a loan's payment and its entry cancel out, leaving the interest", () => {
    // Checking's $5,000 and the loan's -$10,000; ASPIRE's Nov 17 charge leaves Checking, its entry pays the loan
    const points = run(500000 - 1000000, inputs([LOAN]), [OCCURRENCES[0]], '2026-12-01');
    expect(points.map(p => [p.date, p.cents])).toEqual([['2026-11-17', -500000], ['2026-12-01', -506038]]);
    expect(points[0].items.map(i => [i.vendor, i.amount])).toEqual([['Series 5', -75], ['Series 5', 75]]);
  });

  test("what the forecast assumes gives each account's payments and the interest the forecast books", () => {
    const accounts = inputs([LOAN, SAVINGS, { ...LOAN, id: 10, name: 'No APR loan', apr: null }]);
    const { accounts: rows } = forecastAssumptions([], RECURRING, [], [7, 9, 10], '2026-11-15', accounts);
    const booked = run(-1000000, [accounts[0]], [], shiftDays('2026-11-15', FORECAST_DAYS)).reduce((sum, p) => sum + p.interest, 0);
    expect(rows).toEqual([
      { id: 9, name: 'ASPIRE loan', kind: 'loan', apr: 7.3, frequency: 'monthly', payments: { cents: 15000, count: 2 }, interest: booked },
      { id: 7, name: 'Savings', kind: 'bank', apr: 0.5, frequency: 'yearly', payments: { cents: 0, count: 0 }, interest: 1500 },
      { id: 10, name: 'No APR loan', kind: 'loan', apr: null, frequency: 'monthly', payments: { cents: 0, count: 0 }, interest: 0 },
    ]);
    expect(booked).toBe(-6038 - 6029 - 6065);    // Dec 1, Jan 1 and Feb 1, a 12th of 7.3% each on what was owed
  });
});

describe('what the forecast assumes', () => {
  const NONE = { cents: 0, count: 0, series: 0 };

  test("net position: each category's spending, share in a series and basis, largest forecast first, and the scheduled income", () => {
    expect(forecastAssumptions(TRANSACTIONS, ACTIVE, SCHEDULED, [5, 6, 7], TODAY)).toEqual({
      categories: [
        { category: 'Medical', spent: 32476, reimbursed: 0, share: 53, basis: 'average', average: 32476, scheduled: 0, count: 0, forecast: -32476 },
        { category: 'Transfer', spent: 0, reimbursed: 0, share: null, basis: 'no-history', average: 0, scheduled: -20000, count: 1, forecast: -20000 },
        { category: 'Grocery', spent: 13500, reimbursed: 0, share: 0, basis: 'average', average: 13500, scheduled: -6000, count: 1, forecast: -19500 },
        { category: 'Loan', spent: 25000, reimbursed: 0, share: 90, basis: 'scheduled', average: 0, scheduled: -7500, count: 1, forecast: -7500 },
        { category: 'Streaming', spent: 0, reimbursed: 0, share: null, basis: 'no-history', average: 0, scheduled: -1599, count: 1, forecast: -1599 },
      ],
      income: { cents: 170000, count: 1, series: 1 },
      accounts: [],
    });
  });

  test('a reimbursed category shows what came off, and its share is of the spending left', () => {
    expect(forecastAssumptions(MEDICAL, [template(6)], ALLINA, [5, 6, 7], TODAY).categories).toEqual([
      { category: 'Medical', spent: 32476, reimbursed: 16000, share: 100, basis: 'scheduled', average: 0, scheduled: -8738, count: 1, forecast: -8738 },
    ]);
    // Discover paid the purchase; the payback and the charge due are Checking's
    expect(forecastAssumptions(MEDICAL, [template(6)], ALLINA, [5], TODAY).categories).toEqual([
      { category: 'Medical', spent: 15000, reimbursed: 0, share: 100, basis: 'scheduled', average: 0, scheduled: 0, count: 0, forecast: 0 },
    ]);
  });

  test("an account lists only the categories it spent in or has charges due in; the share still spans every account", () => {
    expect(forecastAssumptions(TRANSACTIONS, ACTIVE, SCHEDULED, [5], TODAY)).toEqual({
      categories: [
        { category: 'Grocery', spent: 9000, reimbursed: 0, share: 0, basis: 'average', average: 9000, scheduled: 0, count: 0, forecast: -9000 },
        { category: 'Streaming', spent: 0, reimbursed: 0, share: null, basis: 'no-history', average: 0, scheduled: -1599, count: 1, forecast: -1599 },
      ],
      income: NONE,
      accounts: [],
    });
  });

  test('a scheduled category with nothing due in the next 90 days still shows, adding nothing; the share rounds down', () => {
    const loan = TRANSACTIONS.slice(0, 4);
    const pastTheEnd = occurrence(5, 6, '2027-02-07', 'Loan', -75);
    expect(forecastAssumptions(loan, ACTIVE, [pastTheEnd], [6], TODAY)).toEqual({
      categories: [{ category: 'Loan', spent: 25000, reimbursed: 0, share: 90, basis: 'scheduled', average: 0, scheduled: 0, count: 0, forecast: 0 }],
      income: NONE,
      accounts: [],
    });
    const utility = [
      tx(1, 6, '2026-10-01', 'Utility', -89.99, { recurring_id: 9 }),
      tx(2, 6, '2026-10-02', 'Utility', -10.02),
    ];
    expect(forecastAssumptions(utility, [template(9)], [], [6], TODAY).categories[0]).toMatchObject({ share: 89, basis: 'average' });
  });
});

describe('a forecast of several accounts together', () => {
  test("adds up their scheduled items and each one's interest on its own balance", () => {
    const accounts = [
      { id: 6, account_name: 'Checking', kind: 'bank', apr: null, balance: 7000 },
      { id: 7, account_name: 'Savings', kind: 'bank', apr: 0.5, interest_frequency: 'yearly', balance: 3000 },
    ];
    const recurring = [{ id: 5, amount: -75, frequency: 1, frequency_unit: 'months', number: -1, idx: 1 },
                       { id: 13, amount: 1700, frequency: 14, frequency_unit: 'days', number: -1, idx: 1 }];
    const occurrences = [
      { recurring_id: 5, account_id: 6, date: '2026-11-30', vendor: 'ASPIRE', category: 'Loan', amount: -75 },
      { recurring_id: 13, account_id: 7, date: '2026-12-01', vendor: 'Paycheck', category: 'Income', amount: 1700 },
    ];
    const { points, interestAccounts } = forecastFor({
      accounts, accountIds: [6, 7], startCents: 1000000, startOf: account => Math.round(account.balance * 100),
      transactions: [], recurring, occurrences, today: '2026-11-16',
    });
    expect(interestAccounts.map(account => account.id)).toEqual([7]);
    // $10,000.00 − $75.00 + $1,700.00, then Savings' yearly 0.50% on Jan 1 on the $4,700.00 it holds: $23.50
    expect(points[points.length - 1]).toMatchObject({ date: '2027-02-14', cents: 1164850 });
  });
});
