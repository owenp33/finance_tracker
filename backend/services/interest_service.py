"""
interest_service.py - Interest on accounts: a yearly rate that hits monthly, quarterly or yearly

An account with a rate (AccountModel.apr_bps, a yearly percentage) and a frequency
(interest_frequency) gets an "Interest" transaction on the 1st of each period: the rate's share
for the period (a 12th monthly, a 4th quarterly, all of it yearly) of the balance at the end of the
period before. A loan is charged on what it owes, earlier interest included, so it adds to the
debt (and, being on a loan account, counts in no total); a bank account is paid on a positive
balance, and that's income. Periods start on Jan 1 (yearly), Jan/Apr/Jul/Oct 1 (quarterly) or each
1st (monthly). interest_through is the start of the last period booked: each period moves it by
compare-and-set before its interest is booked, so it's booked once however many runs overlap.
Depends on db_service.py only, so the account service can use its period helpers.
"""
from datetime import date
from extensions import db
from models.transaction import TransactionModel
from services.db_service import DbService

db_service = DbService()

INTEREST = 'Interest'   # the vendor and category of an interest charge or payment

INTEREST_FREQUENCIES = {'monthly': 1, 'quarterly': 3, 'yearly': 12}   # how often -> months between hits


def period_start(day, frequency):
    """The first day of the period `day` falls in: its month's 1st, its quarter's first 1st, or Jan 1."""
    months = INTEREST_FREQUENCIES[frequency]
    return date(day.year, (day.month - 1) // months * months + 1, 1)


def next_period(start, frequency):
    """The first day of the period after the one starting on `start`."""
    total = start.year * 12 + start.month - 1 + INTEREST_FREQUENCIES[frequency]
    return date(total // 12, total % 12 + 1, 1)


def _dollars(cents):
    return f'${cents / 100:,.2f}'


class InterestService:

    def accrue(self, account_id, today=None):
        """
        Book an account's interest due through today: on the first day of each period after
        interest_through, up to the period today falls in, the rate's share for a period of the
        balance at the end of the day before, rounded half up: charged on what a loan owes, paid on
        what a bank account holds; nothing when there's nothing to charge or pay on, though the
        period still counts as done. Missed periods are caught up in order, each on its balance
        then. An account without a start (interest_through None) starts going forward from the
        period today falls in. Accounts without a rate and frequency are left alone. Commits;
        returns how many interest transactions it booked.
        """
        account = db_service.get_account(account_id)
        if account is None or account.apr_bps is None or account.interest_frequency is None:
            return 0
        frequency = account.interest_frequency
        latest = period_start(today or date.today(), frequency)
        booked_through = account.interest_through
        if booked_through is None:
            db_service.claim_interest_period(account.id, None, latest)
            db.session.commit()
            return 0

        loan = account.kind == 'loan'
        months = INTEREST_FREQUENCIES[frequency]
        booked = 0
        start = next_period(booked_through, frequency)
        while start <= latest:
            if not db_service.claim_interest_period(account.id, booked_through, start):
                break   # another run is booking these periods
            before = db_service.get_transaction_totals_before([account.id], start).get(account.id, 0)
            held = account.opening_balance_cents + before
            base = max(-held if loan else held, 0)
            cents = (base * account.apr_bps * months + 60_000) // 120_000   # rate (bps) × months / 12, half up
            if cents:
                db.session.add(TransactionModel(
                    account_id=account.id, date=start, vendor=INTEREST, category=INTEREST,
                    amount_cents=-cents if loan else cents,
                    notes=(f'{account.apr_bps / 100:.2f}% a year, {"charged" if loan else "paid"} {frequency}, '
                           f'on {_dollars(base)}{" owed" if loan else ""}'),
                ))
                db.session.flush()
                db_service.adjust_balance(account.id, -cents if loan else cents)
                booked += 1
            booked_through, start = start, next_period(start, frequency)
        db.session.commit()
        return booked
