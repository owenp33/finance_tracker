// The money rules every Phase V chart and card agrees on (decision 2), in cents. Transfers move
// money between the user's own accounts, so they're never income or spending. Income is money in,
// reimbursements included (totals show plain money in and out, so net matches the bank);
// spending is money out; a zero amount is neither.

export const isIncome = (t) => !t.is_transfer && t.amount_cents > 0;

export const isSpending = (t) => !t.is_transfer && t.amount_cents < 0;

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
