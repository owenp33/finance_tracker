import { isIncome, isSpending, cashFlow } from '../utils/moneyRules';

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

test('no transactions, no money', () => {
  expect(cashFlow([], '2026-11-01', '2026-11-05')).toEqual({ income: 0, expenses: 0, net: 0 });
});
