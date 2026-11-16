// The money rules every Phase V chart and card agrees on (decision 2), in cents. Transfers move
// money between the user's own accounts, so they're never income or spending, and neither is
// anything on a loan account (`on_loan_account`): its transactions only move what's owed, and the
// bill they mirror is spent from the bank account. Income is money in, reimbursements included
// (totals show plain money in and out, so net matches the bank); spending is money out, never
// lowered by reimbursements (only budgets, on the server, and the balance forecast,
// utils/forecast.js, take them off); a zero amount is neither.

const counts = (t) => !t.is_transfer && !t.on_loan_account;

export const isIncome = (t) => counts(t) && t.amount_cents > 0;

export const isSpending = (t) => counts(t) && t.amount_cents < 0;

// A reimbursement: money in marked as one. An expense marked as one (paying someone back) is
// spending, as in budgets.
export const isReimbursement = (t) => isIncome(t) && t.is_reimbursement;

// Income, expenses (spending as a positive amount) and net of the transactions dated `from`
// through `to` (YYYY-MM-DD, both included)
export const cashFlow = (transactions, from, to) => {
  let income = 0;
  let expenses = 0;
  transactions.forEach(t => {
    if (t.date < from || t.date > to) return;
    if (isIncome(t)) income += t.amount_cents;
    else if (isSpending(t)) expenses -= t.amount_cents;
  });
  return { income, expenses, net: income - expenses };
};

// Each category's spending per month, as plain money out: {category: {'YYYY-MM': cents}}.
// Reimbursements aren't taken off: they're income here, and lower spending only in budgets
// (Owen, 2026-11-10, narrowing decision 2).
export const categorySpendingByMonth = (transactions) => {
  const categories = {};
  transactions.forEach(t => {
    if (!isSpending(t)) return;
    const months = (categories[t.category] = categories[t.category] || {});
    const month = t.date.slice(0, 7);
    months[month] = (months[month] || 0) - t.amount_cents;
  });
  return categories;
};

// The same totals for each month with money in or out: {'YYYY-MM': {income, expenses, net}}
export const cashFlowByMonth = (transactions) => {
  const months = {};
  transactions.forEach(t => {
    if (!isIncome(t) && !isSpending(t)) return;
    const key = t.date.slice(0, 7);
    if (!months[key]) months[key] = { income: 0, expenses: 0, net: 0 };
    if (isIncome(t)) months[key].income += t.amount_cents;
    else months[key].expenses -= t.amount_cents;
    months[key].net = months[key].income - months[key].expenses;
  });
  return months;
};
