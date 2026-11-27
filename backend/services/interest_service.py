"""
interest_service.py - Interest on accounts: a yearly rate that hits monthly, quarterly or yearly

An account with a rate (AccountModel.apr_bps, a yearly percentage) and a frequency
(interest_frequency) gets an interest hit on the 1st of each period (InterestHitModel, a record of
its own, not a transaction): the rate's share for the period (a 12th monthly, a 4th quarterly, all
of it yearly) of the balance at the end of the period before. A loan is charged on what it owes,
earlier interest included, so it adds to the debt; a bank account is paid on a positive balance.
Each hit waits for the user's approval: until then it moves nothing, its amount can be changed to the
bank's figure, or it can be deleted (the period stays done). Approved, it moves the balance, once,
and stays as it is; it counts in no income or spending total either way. The next period's interest
counts the hits still waiting, since the bank charges them whether or not they're approved here.
Periods start on Jan 1 (yearly), Jan/Apr/Jul/Oct 1 (quarterly) or
each 1st (monthly). interest_through is the start of the last period booked: each period moves it
by compare-and-set before its interest is booked, so it's booked once however many runs overlap.
Depends on db_service.py only, so the account service can use its period helpers.
"""
import math
from datetime import date
from extensions import db
from models.account import MAX_BALANCE
from models.interest_hit import InterestHitModel
from services.db_service import DbService

db_service = DbService()

INTEREST_FREQUENCIES = {'monthly': 1, 'quarterly': 3, 'yearly': 12}   # how often -> months between hits


def period_start(day, frequency):
    """The first day of the period `day` falls in: its month's 1st, its quarter's first 1st, or Jan 1."""
    months = INTEREST_FREQUENCIES[frequency]
    return date(day.year, (day.month - 1) // months * months + 1, 1)


def next_period(start, frequency):
    """The first day of the period after the one starting on `start`."""
    total = start.year * 12 + start.month - 1 + INTEREST_FREQUENCIES[frequency]
    return date(total // 12, total % 12 + 1, 1)


def _interest_cents(amount):
    """A changed hit's amount: dollars, 0 or more, as cents; ValueError in the account form's words."""
    if isinstance(amount, bool) or not isinstance(amount, (int, float)) or not math.isfinite(amount):
        raise ValueError('Interest must be a number.')
    if amount < 0:
        raise ValueError("Interest can't be negative.")
    if amount > MAX_BALANCE:
        raise ValueError(f'Interest must be at most ${MAX_BALANCE:,.2f}.')
    return int(round(amount * 100))


class InterestService:

    def accrue(self, account_id, today=None):
        """
        Book an account's interest due through today, each hit waiting for approval: on the first day
        of each period after interest_through, up to the period today falls in, the rate's share for a
        period of the balance at the end of the day before (hits still waiting included), rounded half
        up: charged on what a loan owes, paid on what a bank account holds; nothing when there's
        nothing to charge or pay on, though the period still counts as done. Missed periods are caught
        up in order, each on its balance then. An account without a start (interest_through None)
        starts going forward from the period today falls in. Accounts without a rate and frequency
        are left alone. Commits; returns how many interest hits it booked.
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
            before = db_service.get_transaction_totals_before([account.id], start, pending_interest=True).get(account.id, 0)
            held = account.opening_balance_cents + before
            base = max(-held if loan else held, 0)
            cents = (base * account.apr_bps * months + 60_000) // 120_000   # rate (bps) × months / 12, half up
            if cents:
                db.session.add(InterestHitModel(account_id=account.id, date=start, amount_cents=-cents if loan else cents,
                                                apr_bps=account.apr_bps, frequency=frequency, base_cents=base))
                booked += 1
            booked_through, start = start, next_period(start, frequency)
        db.session.commit()
        return booked

    def update_hit(self, hit_id, amount):
        """
        Change a hit waiting for approval to `amount` (dollars, 0 or more: the bank's figure), charged
        on a loan (what's owed grows) and paid on any other account. Its date and period stay, so a
        hit set to 0 isn't booked again. Raises ValueError for a missing hit, an amount that isn't
        one, or a hit already approved; commits and returns the hit.
        """
        hit = self._hit(hit_id)
        cents = _interest_cents(amount)
        if not db_service.set_pending_interest_amount(hit_id, -cents if hit.account.kind == 'loan' else cents):
            raise ValueError("Approved interest can't be changed.")
        db.session.commit()
        return hit

    def approve_hit(self, hit_id):
        """
        Approve a hit waiting for approval: it moves its account's balance, once, and stays as it is
        from then on. Raises ValueError for a missing hit or one already approved; commits and
        returns the hit.
        """
        hit = self._hit(hit_id)
        if not db_service.approve_interest_hit(hit_id):
            raise ValueError('That interest is already approved.')
        db_service.adjust_balance(hit.account_id, hit.amount_cents)
        db.session.commit()
        return hit

    def delete_hit(self, hit_id):
        """
        Delete a hit waiting for approval: nothing was applied, and its period stays done, so it isn't
        booked again. Raises ValueError for a missing hit or one already approved; commits.
        """
        self._hit(hit_id)
        if not db_service.delete_pending_interest_hit(hit_id):
            raise ValueError("Approved interest can't be deleted.")
        db.session.commit()

    @staticmethod
    def _hit(hit_id):
        hit = db_service.get_interest_hit(hit_id)
        if hit is None:
            raise ValueError('Interest not found.')
        return hit
