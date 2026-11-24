import { withLoanPayments } from './loanPayments';

// An interest hit (GET /api/interest) as a row like a transaction's, marked `interest`
const interestRow = (hit) => ({
  id: `interest-${hit.id}`, account_id: hit.account_id, date: hit.date, vendor: 'Interest', category: 'Interest',
  amount: hit.amount, amount_cents: hit.amount_cents, interest: true,
});

// Everything that moved a balance, as rows like transactions: each approved interest hit first (a
// record of its own, on the balance at the end of the day before; one waiting for approval has moved
// nothing), then every transaction, and each loan payment again on its loan (withLoanPayments). For
// what a balance did (a goal's progress this month, the balance chart's tooltip) only: the rows keep
// the transactions' flags, so they must never reach a total (moneyRules).
export const balanceMoves = (transactions, recurring, interest) =>
  [...interest.filter(hit => hit.approved).map(interestRow), ...withLoanPayments(transactions, recurring)];
