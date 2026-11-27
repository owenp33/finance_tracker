"""
loan_service.py - A loan's balance follows the payments that pay it down

A recurring series can pay down a loan account (RecurringModel.loan_account_id). Every payment in
it (a $75 bill in Checking) then also counts on the loan for the opposite amount ($75 less owed),
with nothing booked there: the loan's balance is its starting balance plus its own transactions
less those payments (DbService._transaction_total), and its ledger lists them (BalanceService). The
payment stays a bill in its own account and counts as spending once. Every path that adds a payment
to such a series, changes its amount, or takes it out calls refresh() for the loan it pays down,
which sets the loan's stored balance again from the database in one statement.
Depends on db_service.py only, so the account and recurring services can both use it.
"""
from services.db_service import DbService

db_service = DbService()


class LoanService:

    def loan_paid_down_by(self, transaction):
        """The id of the loan account the transaction's series pays down, or None."""
        rec = db_service.get_recurring(transaction.recurring_id) if transaction.recurring_id is not None else None
        return rec.loan_account_id if rec else None

    def refresh(self, *loan_account_ids):
        """
        Set each loan's stored balance again from its starting balance, its transactions and the
        payments paying it down (after they changed). None and missing accounts are skipped;
        doesn't commit.
        """
        for loan_id in dict.fromkeys(i for i in loan_account_ids if i is not None):
            if db_service.get_account(loan_id):
                db_service.recompute_balance(loan_id)
