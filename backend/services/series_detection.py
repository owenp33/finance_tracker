"""
series_detection.py - Finding recurring series among a user's transactions

Pure functions behind the Recurring tab's "Find recurring": payments to one vendor on one
account that keep one of the app's schedules. No database access; RecurringService loads the
transactions, and the user confirms each series found.
"""
import statistics
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Optional

from models.recurring import MATCH_WINDOW_DAYS, shift_date
from services.vendor_match import amount_close, vendor_key

# The schedules a template can have, (frequency, unit): weekly, biweekly, monthly, quarterly, annually
SCHEDULES = ((7, 'days'), (14, 'days'), (1, 'months'), (3, 'months'), (12, 'months'))

# A series needs at least this many payments...
MIN_PAYMENTS = 4

# ...and must keep at least this share of its schedule (see _fit)
MIN_SCHEDULE_SHARE = 0.7

# How many days a payment may be from a scheduled date: MATCH_WINDOW_DAYS, except on weekly and
# biweekly schedules, where 3 days either way would cover half the period or more, so any habit
# would pass for a schedule
SHORT_SCHEDULE_WINDOWS = {(7, 'days'): 1, (14, 'days'): 2}


def _window(frequency, unit):
    """How far from a scheduled date a payment still keeps it, on this schedule."""
    return timedelta(days=SHORT_SCHEDULE_WINDOWS.get((frequency, unit), MATCH_WINDOW_DAYS))


@dataclass(frozen=True)
class DetectedSeries:
    """A series found among the transactions: its payments (oldest first), schedule, and where it stands."""
    account_id: int
    vendor: str              # the most common spelling
    category: str            # the most common category
    frequency: int
    frequency_unit: str
    anchor: date             # a date on the schedule (one of the payments'); monthly schedules keep its day
    transactions: tuple
    ongoing: bool
    next_date: Optional[date]   # ongoing only: the schedule's first date on or after today

    @property
    def amount_cents(self):
        """The latest payment's amount."""
        return self.transactions[-1].amount_cents


def detect_series(transactions, today, tracked=frozenset()):
    """
    Recurring series among a user's transactions: at least MIN_PAYMENTS payments on one account
    to one vendor (vendor_key), moving money the same way and within vendor_match's tolerance of
    each other in size, that keep at least MIN_SCHEDULE_SHARE of one of SCHEDULES (_fit).
    Transactions already in a series, transfers, and vendors in `tracked` ((account_id,
    vendor_key) pairs that already have a template) are left out; every transaction still counts
    toward its account's newest date.
    A series is ongoing when its next scheduled payment is overdue by no more than its schedule's
    window by its account's newest transaction (not by today, since imports lag); its next_date is then the
    schedule's first date on or after today, so nothing in the past would be generated. Ongoing
    series come first, then the most recently paid.
    """
    newest = {}
    by_vendor = defaultdict(list)   # (account id, vendor key, is expense) -> payments
    for t in transactions:
        newest[t.account_id] = max(newest.get(t.account_id, t.date), t.date)
        key = (t.account_id, vendor_key(t.vendor))
        if t.recurring_id is None and not t.is_transfer and t.amount_cents != 0 and key not in tracked:
            by_vendor[(*key, t.amount_cents < 0)].append(t)

    found = []
    for vendor_payments in by_vendor.values():
        for payments in _amount_groups(vendor_payments):
            if len(payments) < MIN_PAYMENTS:
                continue
            payments.sort(key=lambda t: (t.date, t.id))
            frequency, unit, anchor, share = _schedule(payments)
            if share >= MIN_SCHEDULE_SHARE:
                found.append(_series(payments, frequency, unit, anchor, newest[payments[0].account_id], today))

    return sorted(found, key=lambda s: (not s.ongoing, -s.transactions[-1].date.toordinal(),
                                        s.account_id, vendor_key(s.vendor), s.amount_cents))


def _amount_groups(payments):
    """One vendor's payments split by size: a payment too far from its group's median starts a new group."""
    groups = []
    for t in sorted(payments, key=lambda t: abs(t.amount_cents)):
        if groups and amount_close(abs(t.amount_cents), statistics.median(abs(p.amount_cents) for p in groups[-1])):
            groups[-1].append(t)
        else:
            groups.append([t])
    return groups


def _schedule(payments):
    """(frequency, unit, anchor, share) of the schedule the payments keep best; anchors are their dates."""
    best, best_rank = None, None
    for frequency, unit in SCHEDULES:
        for anchor in sorted({t.date for t in payments}):
            share, offset = _fit(payments, frequency, unit, anchor)
            if best_rank is None or (share, -offset) > best_rank:
                best, best_rank = (frequency, unit, anchor, share), (share, -offset)
    return best


def _fit(payments, frequency, unit, anchor):
    """
    How well the payments keep the schedule through anchor: (share, total days off). Each of its
    dates from the first payment to the last can be kept by one payment within the schedule's
    window (_window; the nearest payment); share is the dates kept over all payments plus the
    dates missed, so a missed date and an extra payment both count against it, and a late
    payment only once.
    """
    window = _window(frequency, unit)
    dates = _schedule_dates(anchor, frequency, unit, payments[0].date - window, payments[-1].date + window)
    kept, days_off = 0, 0
    for t in payments:
        near = [d for d in dates if abs(t.date - d) <= window]
        if near:
            nearest = min(near, key=lambda d: abs((t.date - d).days))
            dates.remove(nearest)
            kept += 1
            days_off += abs((t.date - nearest).days)
    return kept / (len(payments) + len(dates)), days_off


def _schedule_dates(anchor, frequency, unit, start, end):
    """The schedule's dates through anchor from start to end (inclusive), in order."""
    steps = 0
    while shift_date(anchor, frequency, unit, steps - 1) >= start:
        steps -= 1
    dates = []
    while (day := shift_date(anchor, frequency, unit, steps)) <= end:
        dates.append(day)
        steps += 1
    return dates


def _first_after(anchor, frequency, unit, after):
    """The schedule's first date (through anchor) later than `after`."""
    steps = 0
    while shift_date(anchor, frequency, unit, steps) <= after:
        steps += 1
    return shift_date(anchor, frequency, unit, steps)


def _most_common(values):
    """The most common of values (oldest first); a tie goes to the latest."""
    counts = Counter(values)
    return max(reversed(values), key=lambda v: counts[v])


def _series(payments, frequency, unit, anchor, account_newest, today):
    # The next payment is due on the first scheduled date the last payment can't have kept
    window = _window(frequency, unit)
    last_kept = payments[-1].date + window
    expected = _first_after(anchor, frequency, unit, last_kept)
    ongoing = expected + window >= account_newest
    return DetectedSeries(
        account_id=payments[0].account_id,
        vendor=_most_common([t.vendor for t in payments]),
        category=_most_common([t.category for t in payments]),
        frequency=frequency,
        frequency_unit=unit,
        anchor=anchor,
        transactions=tuple(payments),
        ongoing=ongoing,
        next_date=_first_after(anchor, frequency, unit, max(last_kept, today - timedelta(days=1))) if ongoing else None,
    )
