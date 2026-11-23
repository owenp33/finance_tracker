"""
balance_service.py - Account ledgers: balances over time

For each account: the balance at the start of a period (its starting balance plus every earlier
transaction), each transaction in the period with the balance right after it, and the balance at
the end. Transfers and reimbursements count, since money really moved. A loan's ledger also lists
the payments of the series that pay it down (made from another account), for the opposite amount
(loan_service.py). Read-only; used by the exports, and (as end-of-day balances) by GET
/api/balances for the Insights balance chart.
"""
from collections import defaultdict
from dataclasses import dataclass
from models.account import AccountModel
from models.transaction import TransactionModel
from services.db_service import DbService

db_service = DbService()


@dataclass(frozen=True)
class LedgerRow:
    transaction: TransactionModel
    balance_cents: int                  # the account's balance right after this row
    loan: AccountModel | None = None    # set on a payment paying down this loan: the loan

    @property
    def loan_payment(self):
        """A payment made from another account, in a series paying down this ledger's loan."""
        return self.loan is not None

    @property
    def amount_cents(self):
        """What the row moved this ledger's balance by (a loan's payment: the opposite of its amount)."""
        return -self.transaction.amount_cents if self.loan_payment else self.transaction.amount_cents

    @property
    def account(self):
        """The ledger's account: the transaction's own, or the loan a payment pays down."""
        return self.loan if self.loan_payment else self.transaction.account


@dataclass(frozen=True)
class AccountLedger:
    account: AccountModel
    opening_cents: int          # the balance just before the period starts
    rows: list[LedgerRow]       # in date, then id, order

    @property
    def closing_cents(self):
        """The balance at the end of the period."""
        return self.rows[-1].balance_cents if self.rows else self.opening_cents


@dataclass(frozen=True)
class DailyBalances:
    account: AccountModel
    opening_cents: int              # the balance just before the period starts
    days: list[tuple]               # (date, cents): each date with transactions, and its end-of-day balance

    @property
    def closing_cents(self):
        """The balance at the end of the period."""
        return self.days[-1][1] if self.days else self.opening_cents


def end_of_day(rows):
    """(date, cents) for each date in a ledger's rows: the balance after the date's last transaction."""
    days = {}
    for row in rows:
        days[row.transaction.date] = row.balance_cents
    return list(days.items())


def running_balances(opening_cents, entries):
    """
    Each (transaction, loan) in the order given, as a row with the balance right after it: loan is
    None for the account's own transaction, else the loan a payment pays down.
    """
    rows, balance = [], opening_cents
    for t, loan in entries:
        balance += t.amount_cents if loan is None else -t.amount_cents
        rows.append(LedgerRow(t, balance, loan))
    return rows


class BalanceService:

    def ledgers(self, user_id, account_ids=None, start_date=None, end_date=None):
        """
        One AccountLedger per account of the user (or per requested account), in account id
        order, covering start_date through end_date (both inclusive, both optional). Accounts
        without transactions in the period are included. Raises ValueError for an account that
        isn't the user's, or a start date after the end date.
        """
        if start_date and end_date and start_date > end_date:
            raise ValueError('The start date must be on or before the end date.')

        accounts = sorted(db_service.get_user_accounts(user_id), key=lambda a: a.id)
        if account_ids is not None:
            requested = set(account_ids)
            unknown = sorted(requested - {a.id for a in accounts})
            if unknown:
                raise ValueError(f"Unknown account: {', '.join(map(str, unknown))}")
            accounts = [a for a in accounts if a.id in requested]
        if not accounts:
            return []

        ids = [a.id for a in accounts]
        by_id = {a.id: a for a in accounts}
        earlier = db_service.get_transaction_totals_before(ids, start_date) if start_date else {}
        in_period = defaultdict(list)
        for t in db_service.get_user_transactions_filtered(user_id, ids, start_date, end_date):
            in_period[t.account_id].append((t, None))
        for loan_id, t in db_service.get_loan_payments(ids, start_date, end_date):
            in_period[loan_id].append((t, by_id[loan_id]))

        ledgers = []
        for a in accounts:
            opening = a.opening_balance_cents + earlier.get(a.id, 0)
            rows = running_balances(opening, sorted(in_period[a.id], key=lambda entry: (entry[0].date, entry[0].id)))
            ledgers.append(AccountLedger(a, opening, rows))
        return ledgers

    def daily_balances(self, user_id, account_ids=None, start_date=None, end_date=None):
        """
        One DailyBalances per account, selected as ledgers() selects them (and raising the same
        ValueErrors): the balance just before start_date, then the end-of-day balance of each date
        with transactions through end_date. Over all time, the last day's balance is the account's
        stored balance.
        """
        return [DailyBalances(ledger.account, ledger.opening_cents, end_of_day(ledger.rows))
                for ledger in self.ledgers(user_id, account_ids, start_date, end_date)]
