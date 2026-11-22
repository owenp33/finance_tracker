import {
  isIncome, isSpending, isReimbursement, cashFlow, cashFlowByMonth, categorySpendingByMonth, unbudgetableCategories,
} from '../utils/moneyRules';

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

test('a reimbursement is money in marked as one; paying someone back (money out) is spending, and transfers are neither', () => {
  expect(isReimbursement(tx('2026-11-03', 3000, { is_reimbursement: true }))).toBe(true);
  expect(isReimbursement(tx('2026-11-03', 3000))).toBe(false);
  expect(isReimbursement(tx('2026-11-03', -3000, { is_reimbursement: true }))).toBe(false);
  expect(isSpending(tx('2026-11-03', -3000, { is_reimbursement: true }))).toBe(true);
  expect(isReimbursement(tx('2026-11-04', 3000, { is_reimbursement: true, is_transfer: true }))).toBe(false);
});

test("a loan account's transactions are never income, spending or a reimbursement: they only move what's owed", () => {
  const onLoan = (amountCents, overrides) => tx('2026-11-30', amountCents, { on_loan_account: true, ...overrides });
  expect(isIncome(onLoan(7500))).toBe(false);                              // a payment's entry
  expect(isSpending(onLoan(-1250))).toBe(false);                           // an interest charge
  expect(isReimbursement(onLoan(3000, { is_reimbursement: true }))).toBe(false);
  const transactions = [tx('2026-11-30', -7500, { category: 'Loan' }), onLoan(7500, { category: 'Loan' }), onLoan(-1250, { category: 'Loan' })];
  expect(cashFlow(transactions, '2026-11-01', '2026-11-30')).toEqual({ income: 0, expenses: 7500, net: -7500 });
  expect(cashFlowByMonth(transactions)).toEqual({ '2026-11': { income: 0, expenses: 7500, net: -7500 } });
  expect(categorySpendingByMonth(transactions)).toEqual({ Loan: { '2026-11': 7500 } });
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

describe("the categories that can't have a budget (the server's rule)", () => {
  const spent = (category, cents, overrides) => tx('2026-10-01', cents, { category, ...overrides });

  test('money in outweighing money out, in dollars over all time, rules a category out', () => {
    const transactions = [
      spent('Income', 300000), spent('Income', -8395),
      // Loan: one disbursement in outweighs five payments out
      spent('Loan', 100000), ...[1, 2, 3, 4, 5].map(() => spent('Loan', -7500)),
      // Utility: three deposits, but more out in dollars
      spent('Utility', 4000), spent('Utility', 4000), spent('Utility', 4000), spent('Utility', -15000),
      // Gifts: as much in as out
      spent('Gifts', 5000), spent('Gifts', -5000),
      spent('Grocery', -6000),
    ];
    expect([...unbudgetableCategories(transactions)].sort()).toEqual(['Income', 'Loan']);
  });

  test('so does having transactions none of which count: transfers, or on a loan account', () => {
    const transactions = [
      spent('Transfer', -50000, { is_transfer: true }), spent('Transfer', 20000, { is_transfer: true }),
      spent('Interest', -41996, { on_loan_account: true }),
      // Bills: the loan's mirrored entries never count; the bill paid from the bank does
      spent('Bills', -7500), spent('Bills', 7500, { on_loan_account: true }), spent('Bills', 7500, { on_loan_account: true }),
      // Money in and out on transfers aside, Rent is spending
      spent('Rent', -90000), spent('Rent', 200000, { is_transfer: true }),
    ];
    expect([...unbudgetableCategories(transactions)].sort()).toEqual(['Interest', 'Transfer']);
  });

  test('no transactions, nothing ruled out', () => {
    expect(unbudgetableCategories([]).size).toBe(0);
  });
});
