import { loanPayments, withLoanPayments } from '../utils/loanPayments';

// ASPIRE (series 5, in Checking) pays down the Student Loan (account 16); Spotify (series 6) pays down nothing
const RECURRING = [
  { id: 5, account_id: 6, loan_account_id: 16 },
  { id: 6, account_id: 6, loan_account_id: null },
];
const tx = (id, accountId, recurringId, cents) => ({
  id, account_id: accountId, recurring_id: recurringId, date: '2026-10-31', vendor: 'V', amount: cents / 100, amount_cents: cents,
});
const TRANSACTIONS = [
  tx(1, 6, 5, -7500),        // a payment
  tx(2, 6, 5, 0),            // moves nothing
  tx(3, 6, 6, -999),         // another series
  tx(4, 6, null, -7500),     // in no series
  tx(5, 16, null, -41996),   // interest, on the loan itself
];

test("a loan's payments are the non-zero transactions of the series paying it down, as they are", () => {
  expect(loanPayments(TRANSACTIONS, RECURRING, 16)).toEqual([TRANSACTIONS[0]]);
  expect(loanPayments(TRANSACTIONS, RECURRING, 7)).toEqual([]);
});

test('with the loan payments, each payment also moves its loan, for the opposite amount', () => {
  expect(withLoanPayments(TRANSACTIONS, RECURRING)).toEqual([
    ...TRANSACTIONS,
    { ...TRANSACTIONS[0], account_id: 16, amount: 75, amount_cents: 7500, loanPayment: true },
  ]);
  expect(withLoanPayments(TRANSACTIONS, [RECURRING[1]])).toBe(TRANSACTIONS);     // no loan: the same list
});
