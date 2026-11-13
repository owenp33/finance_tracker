import { isIncome, isSpending, cashFlow, cashFlowByMonth, categorySpendingByMonth } from '../utils/moneyRules';

const tx = (date, amountCents, overrides) => ({
  date, amount_cents: amountCents, is_transfer: false, is_reimbursement: false, ...overrides,
});

test('income is money in, reimbursements included; transfers and zero amounts are neither', () => {
  expect(isIncome(tx('2026-11-01', 125000))).toBe(true);
  expect(isIncome(tx('2026-11-03', 3000, { is_reimbursement: true }))).toBe(true);
  expect(isIncome(tx('2026-11-04', 50000, { is_transfer: true }))).toBe(false);
  expect(isIncome(tx('2026-11-05', 0))).toBe(false);
  expect(isIncome(tx('2026-11-05', -100))).toBe(false);
});

test('spending is money out; transfers and zero amounts are neither', () => {
  expect(isSpending(tx('2026-11-02', -30000))).toBe(true);
  expect(isSpending(tx('2026-11-04', -50000, { is_transfer: true }))).toBe(false);
  expect(isSpending(tx('2026-11-05', 0))).toBe(false);
  expect(isSpending(tx('2026-11-05', 100))).toBe(false);
});

test('cash flow totals income, expenses (as a positive amount) and net between two dates, both included', () => {
  const transactions = [
    tx('2026-10-31', 100000),                          // before
    tx('2026-11-01', 125000),
    tx('2026-11-03', 3000, { is_reimbursement: true }),
    tx('2026-11-04', -38940),
    tx('2026-11-04', -50000, { is_transfer: true }),
    tx('2026-11-05', 0),
    tx('2026-11-05', -1000),
    tx('2026-11-06', -99900),                          // after
  ];
  expect(cashFlow(transactions, '2026-11-01', '2026-11-05')).toEqual({ income: 128000, expenses: 39940, net: 88060 });
});

test('cash flow by month: the same rules, one entry per month with money in or out', () => {
  expect(cashFlowByMonth([
    tx('2026-10-31', 100000),
    tx('2026-11-01', 125000),
    tx('2026-11-03', 3000, { is_reimbursement: true }),
    tx('2026-11-04', -38940),
    tx('2026-11-04', -50000, { is_transfer: true }),
    tx('2026-11-05', 0),
    tx('2026-12-01', -1000),
  ])).toEqual({
    '2026-10': { income: 100000, expenses: 0, net: 100000 },
    '2026-11': { income: 128000, expenses: 38940, net: 89060 },
    '2026-12': { income: 0, expenses: 1000, net: -1000 },
  });
});

test("category spending by month is plain money out: reimbursements aren't taken off (only budgets do that)", () => {
  expect(categorySpendingByMonth([
    tx('2026-10-10', -40000, { category: 'Groceries' }),
    tx('2026-10-15', 5000, { category: 'Groceries', is_reimbursement: true }),   // income, not less spending
    tx('2026-11-02', -2000, { category: 'Groceries' }),
    tx('2026-11-03', 3000, { category: 'Groceries', is_reimbursement: true }),
    tx('2026-10-01', 200000, { category: 'Paycheck' }),                         // income isn't spending
    tx('2026-10-05', -50000, { category: 'Transfer', is_transfer: true }),      // never counts
    tx('2026-10-06', 0, { category: 'Misc' }),                                  // neither
    tx('2026-10-07', -1250, { category: 'Fun' }),
  ])).toEqual({
    Groceries: { '2026-10': 40000, '2026-11': 2000 },
    Fun: { '2026-10': 1250 },
  });
});

test('no transactions, no money', () => {
  expect(cashFlow([], '2026-11-01', '2026-11-05')).toEqual({ income: 0, expenses: 0, net: 0 });
});
