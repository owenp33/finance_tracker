// A loan's payments (Phase F): a recurring series can pay down a loan account (its template's
// loan_account_id), and each of its non-zero payments then counts on the loan for the opposite
// amount, with nothing booked on the loan itself (the server's rule, services/loan_service.py).

// The loan account each template pays down, by template id (only those that pay one down)
const loansBySeries = (recurring) =>
  new Map(recurring.filter(r => r.loan_account_id != null).map(r => [r.id, r.loan_account_id]));

// The payments paying down the loan `loanId`, as they are (in the account they were paid from)
export const loanPayments = (transactions, recurring, loanId) => {
  const loanOf = loansBySeries(recurring);
  return transactions.filter(t => t.amount_cents !== 0 && loanOf.get(t.recurring_id) === loanId);
};

// Every transaction, then each loan payment again as it moves its loan: on the loan, for the
// opposite amount, marked `loanPayment` (for what a loan's balance did: a goal's progress this month,
// the balance chart's tooltip). The same list when no series pays a loan down.
export const withLoanPayments = (transactions, recurring) => {
  const loanOf = loansBySeries(recurring);
  const moves = transactions
    .filter(t => t.amount_cents !== 0 && loanOf.has(t.recurring_id))
    .map(t => ({ ...t, account_id: loanOf.get(t.recurring_id), amount: -t.amount, amount_cents: -t.amount_cents, loanPayment: true }));
  return moves.length > 0 ? [...transactions, ...moves] : transactions;
};
