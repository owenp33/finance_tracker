"""
loan_service.py - Loan entries: keeping a loan account in step with the payments that pay it down

A recurring series can pay down a loan account (RecurringModel.loan_account_id). Every payment in
such a series then has one loan entry on the loan (TransactionModel.loan_payment_id points at the
payment) for the opposite amount, on the payment's date, with its vendor and category: a $75 bill
in Checking is +$75 on a loan whose balance is what's owed (negative). The payment stays a bill
and counts as spending; the entry counts in no total (it's on a loan account), so nothing counts
twice. The series decides: every path that adds a payment to a series, changes one, or takes it
out calls sync() (or remove_for() before deleting it), and entries can't be changed on their own.
Depends on db_service.py only, so the account and recurring services can both use it.
"""
from extensions import db
from models.transaction import TransactionModel
from services.db_service import DbService

db_service = DbService()

ENTRY_IS_READ_ONLY = 'This is a loan entry: it follows the payment it mirrors, so change that payment instead.'


def is_loan_entry(transaction):
    """Whether a transaction is a loan entry (read-only: it follows its payment)."""
    return transaction.loan_payment_id is not None


class LoanService:

    def sync(self, payment):
        """
        Make the payment's loan entry match it: none when it's in no series that pays down a loan
        or its amount is 0; else one on that loan for the opposite amount, on its date, with its
        vendor and category. Moves the balances by any difference; doesn't commit.
        """
        rec = db_service.get_recurring(payment.recurring_id) if payment.recurring_id is not None else None
        loan_id = rec.loan_account_id if rec else None
        entry = db_service.get_loan_entry(payment.id)
        if loan_id is None or payment.amount_cents == 0:
            if entry:
                self._remove(entry)
            return

        cents = -payment.amount_cents
        if entry is None:
            entry = TransactionModel(account_id=loan_id, loan_payment_id=payment.id, amount_cents=cents,
                                     date=payment.date, vendor=payment.vendor, category=payment.category, notes='')
            db.session.add(entry)
            db.session.flush()
            db_service.adjust_balance(loan_id, cents)
            return

        if entry.account_id == loan_id:
            db_service.adjust_balance(loan_id, cents - entry.amount_cents)
        else:   # the series now pays down another loan
            db_service.adjust_balance(entry.account_id, -entry.amount_cents)
            db_service.adjust_balance(loan_id, cents)
        entry.account_id, entry.amount_cents = loan_id, cents
        entry.date, entry.vendor, entry.category = payment.date, payment.vendor, payment.category

    def sync_series(self, rec):
        """sync() every payment in the series (after it starts, changes or stops paying down a loan)."""
        db.session.flush()
        db.session.expire(rec, ['generated_transactions'])
        for payment in rec.generated_transactions:
            self.sync(payment)

    def remove_for(self, payment):
        """Remove the payment's loan entry, if it has one (before the payment is deleted). Doesn't commit."""
        entry = db_service.get_loan_entry(payment.id)
        if entry:
            self._remove(entry)

    def remove_series_entries(self, rec):
        """Remove the loan entries of every payment in the series (before the series goes). Doesn't commit."""
        for entry in db_service.get_loan_entries_mirroring_series(rec.id):
            self._remove(entry)

    def remove_entries_mirroring_account(self, account_id):
        """Remove the loan entries of the payments made from this account (before it's deleted). Doesn't commit."""
        for entry in db_service.get_loan_entries_mirroring_account(account_id):
            self._remove(entry)

    def _remove(self, entry):
        db_service.adjust_balance(entry.account_id, -entry.amount_cents)
        db.session.delete(entry)
        db.session.flush()
