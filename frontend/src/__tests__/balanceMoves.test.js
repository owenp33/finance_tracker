import { balanceMoves } from '../utils/balanceMoves';

// ASPIRE (series 5, in Checking) pays down the Student Loan (account 16), charged interest on the 1st
const RECURRING = [{ id: 5, account_id: 6, loan_account_id: 16 }];
const PAYMENT = {
  id: 1, account_id: 6, recurring_id: 5, date: '2026-10-31', vendor: 'ASPIRE', category: 'Loan', amount: -75, amount_cents: -7500,
};
const GROCERIES = { id: 2, account_id: 6, recurring_id: null, date: '2026-10-31', vendor: 'Cub Foods', amount: -42.1, amount_cents: -4210 };
const HIT = {
  id: 3, account_id: 16, date: '2026-12-01', amount: -419.96, amount_cents: -41996, apr: 6.7, frequency: 'monthly', base_cents: 7521700,
};

test("everything that moved a balance: each interest hit first, then the transactions and each loan payment on its loan", () => {
  expect(balanceMoves([PAYMENT, GROCERIES], RECURRING, [HIT])).toEqual([
    { id: 'interest-3', account_id: 16, date: '2026-12-01', vendor: 'Interest', category: 'Interest', amount: -419.96,
      amount_cents: -41996, interest: true },
    PAYMENT,
    GROCERIES,
    { ...PAYMENT, account_id: 16, amount: 75, amount_cents: 7500, loanPayment: true },
  ]);
});

test('without interest or a series paying a loan down, the transactions as they are', () => {
  expect(balanceMoves([GROCERIES], [], [])).toEqual([GROCERIES]);
});
