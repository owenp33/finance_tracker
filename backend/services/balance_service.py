"""
balance_service.py - Account ledgers: balances over time

For each account: the balance at the start of a period (its starting balance plus every earlier
transaction), each transaction in the period with the balance right after it, and the balance at
the end. Transfers and reimbursements count, since money really moved. Read-only; used by the
exports, and (as end-of-day balances) by GET /api/balances for the Insights balance chart.
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
    balance_cents: int          # the account's balance right after this transaction


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


def running_balances(opening_cents, transactions):
    """Each transaction, in the order given, with the balance right after it."""
    rows, balance = [], opening_cents
    for t in transactions:
        balance += t.amount_cents
        rows.append(LedgerRow(t, balance))
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
        earlier = db_service.get_transaction_totals_before(ids, start_date) if start_date else {}
        in_period = defaultdict(list)
        for t in db_service.get_user_transactions_filtered(user_id, ids, start_date, end_date):
            in_period[t.account_id].append(t)

        ledgers = []
        for a in accounts:
            opening = a.opening_balance_cents + earlier.get(a.id, 0)
            rows = running_balances(opening, sorted(in_period[a.id], key=lambda t: (t.date, t.id)))
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
