"""
Series detection tests: finding recurring series among a user's transactions (the pure rules in
series_detection), and GET /api/recurring/detected end to end.
"""
import itertools
from datetime import date
from types import SimpleNamespace

import pytest

from extensions import db as _db
from models.account import AccountModel
from models.user import User
from services.account_service import AccountService
from services.recurring_service import RecurringService
from services.series_detection import MIN_PAYMENTS, detect_series

account_svc = AccountService()
recurring_svc = RecurringService()

TODAY = date(2026, 10, 28)
_ids = itertools.count(1)


def tx(day, vendor='Netflix', amount=-15.49, account_id=1, category='Subscriptions', recurring_id=None,
       is_transfer=False):
    """A transaction as detect_series reads it."""
    return SimpleNamespace(id=next(_ids), account_id=account_id, date=date.fromisoformat(day), vendor=vendor,
                           category=category, amount_cents=round(amount * 100), recurring_id=recurring_id,
                           is_transfer=is_transfer)


def payments(days, **fields):
    return [tx(day, **fields) for day in days]


MONTHLY = ['2026-06-05', '2026-07-05', '2026-08-06', '2026-09-04']   # each within 3 days of the 5th
WEEKLY = ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24']


# ── The rules ─────────────────────────────────────────────────────────────────

def test_a_monthly_series_is_found_with_its_payments_oldest_first():
    [series] = detect_series(payments(MONTHLY[::-1]), TODAY)
    assert (series.account_id, series.vendor, series.category) == (1, 'Netflix', 'Subscriptions')
    assert (series.frequency, series.frequency_unit) == (1, 'months')
    assert [t.date.isoformat() for t in series.transactions] == MONTHLY
    assert series.amount_cents == -1549


@pytest.mark.parametrize('days, schedule', [
    (WEEKLY, (7, 'days')),
    (['2026-07-06', '2026-07-20', '2026-08-03', '2026-08-17'], (14, 'days')),
    (MONTHLY, (1, 'months')),
    (['2025-10-15', '2026-01-15', '2026-04-15', '2026-07-15'], (3, 'months')),
    (['2022-03-01', '2023-03-01', '2024-03-01', '2025-03-01'], (12, 'months')),
], ids=['weekly', 'biweekly', 'monthly', 'quarterly', 'annually'])
def test_each_of_the_five_schedules(days, schedule):
    [series] = detect_series(payments(days), TODAY)
    assert (series.frequency, series.frequency_unit) == schedule


def test_three_payments_are_not_enough():
    assert MIN_PAYMENTS == 4
    assert detect_series(payments(MONTHLY[:3]), TODAY) == []


@pytest.mark.parametrize('days, found', [
    (['2025-01-05', '2025-02-05', '2025-03-05', '2025-04-05', '2025-06-05'], True),   # May skipped: 5 of 6
    (['2025-01-05', '2025-02-05', '2025-05-05', '2025-06-05'], False),                # 4 of 6
], ids=['one-month-skipped', 'two-months-skipped'])
def test_most_of_the_schedule_must_be_kept(days, found):
    assert len(detect_series(payments(days), TODAY)) == (1 if found else 0)


@pytest.mark.parametrize('extras, found', [(2, True), (3, False)])
def test_extra_payments_count_against_the_schedule(extras, found):
    on_schedule = payments(['2025-01-05', '2025-02-05', '2025-03-05', '2025-04-05', '2025-05-05'])
    extra = payments(['2025-01-20', '2025-02-20', '2025-03-20'][:extras])    # 5 kept of 7 or of 8 payments
    assert len(detect_series(on_schedule + extra, TODAY)) == (1 if found else 0)


def test_biweekly_payments_must_land_within_two_days():
    # Oct 25 is 3 days from Oct 28, so only 3 of the 4 payments keep a date, and Nov 11 is missed
    tea = payments(['2025-10-14', '2025-10-25', '2025-11-25', '2025-12-09'], vendor='Kung Fu Tea', amount=-7.50)
    assert detect_series(tea, TODAY) == []


def test_a_late_payment_counts_against_one_date_only():
    # Rent paid around the start of the month, sometimes a few days late, once early (Feb 27 for March)
    rent = payments(['2025-09-02', '2025-10-02', '2025-11-06', '2025-12-02', '2026-01-05', '2026-02-03',
                     '2026-02-27', '2026-04-02', '2026-05-04', '2026-06-02', '2026-07-06', '2026-08-05'],
                    vendor='Millenium Apartments', amount=-650.00, category='Rent')
    [series] = detect_series(rent, TODAY)
    assert (series.frequency, series.frequency_unit, len(series.transactions)) == (1, 'months', 12)
    assert series.next_date == date(2026, 11, 3)     # the 3rd keeps the most payments (11 of 12)


def test_a_weekly_schedule_allows_a_day_either_way():
    [series] = detect_series(payments(['2026-08-03', '2026-08-10', '2026-08-18', '2026-08-23']), TODAY)
    assert (series.frequency, series.frequency_unit) == (7, 'days')


def test_a_weekly_habit_on_changing_days_is_not_a_schedule():
    # About once a week, but Mon, Thu, Sat, Tue: 3 days either way would cover every weekday
    gas = payments(['2026-08-03', '2026-08-13', '2026-08-22', '2026-08-25', '2026-09-03'], vendor='Holiday')
    assert detect_series(gas, TODAY) == []


def test_a_vendors_payments_split_by_size():
    rent = payments(MONTHLY, vendor='Millenium Apartments', amount=-650.00, category='Rent')
    fee = payments(MONTHLY, vendor='Millenium Apartments', amount=-2.49, category='Rent')
    assert sorted(s.amount_cents for s in detect_series(rent + fee, TODAY)) == [-65000, -249]


def test_amounts_within_half_of_each_other_stay_one_series():
    pay = [tx(day, vendor='Federal Express', amount=amount, category='Income')
           for day, amount in zip(WEEKLY, [214.26, 143.32, 309.32, 250.00])]
    [series] = detect_series(pay, TODAY)
    assert len(series.transactions) == 4
    assert series.amount_cents == 25000     # the latest payment's


def test_income_and_spending_are_separate():
    found = detect_series(payments(MONTHLY) + payments(MONTHLY, amount=15.49), TODAY)
    assert sorted(s.amount_cents for s in found) == [-1549, 1549]


def test_accounts_are_separate():
    assert detect_series(payments(MONTHLY[:2]) + payments(MONTHLY[2:], account_id=2), TODAY) == []


def test_vendor_spellings_group_together_and_the_most_common_names_win():
    mixed = [tx(MONTHLY[0], vendor='NETFLIX '), tx(MONTHLY[1]),
             tx(MONTHLY[2], category='Streaming'), tx(MONTHLY[3], category='Streaming')]
    [series] = detect_series(mixed, TODAY)
    assert series.vendor == 'Netflix'
    assert series.category == 'Streaming'     # a tie goes to the latest


@pytest.mark.parametrize('fields', [{'recurring_id': 5}, {'is_transfer': True}], ids=['in-a-series', 'transfers'])
def test_series_transactions_and_transfers_are_left_out(fields):
    assert detect_series(payments(MONTHLY, **fields), TODAY) == []


def test_vendors_with_a_template_on_the_account_are_left_out():
    assert detect_series(payments(MONTHLY, vendor=' NETFLIX'), TODAY, tracked={(1, 'netflix')}) == []
    assert len(detect_series(payments(MONTHLY), TODAY, tracked={(2, 'netflix')})) == 1   # another account's


def test_an_ongoing_series_starts_on_or_after_today():
    [series] = detect_series(payments(MONTHLY), TODAY)    # the account's newest transaction is Sep 4
    assert series.ongoing is True
    assert series.next_date == date(2026, 11, 5)          # its day is the 5th; Oct 5 has passed and isn't filled in


@pytest.mark.parametrize('newest, ongoing', [('2026-10-08', True), ('2026-10-09', False)],
                         ids=['3-days-overdue', '4-days-overdue'])
def test_ongoing_is_judged_by_the_accounts_newest_transaction(newest, ongoing):
    other = tx(newest, vendor='Grocer', amount=-40.00)    # Oct 5's payment is missing by then
    [series] = detect_series(payments(MONTHLY) + [other], TODAY)
    assert series.ongoing is ongoing
    assert series.next_date == (date(2026, 11, 5) if ongoing else None)


def test_a_month_end_series_stays_on_the_months_last_day():
    [series] = detect_series(payments(['2026-05-31', '2026-06-30', '2026-07-31', '2026-08-31']), TODAY)
    assert series.next_date == date(2026, 10, 31)


def test_ongoing_series_come_first_then_the_most_recently_paid():
    older = payments(['2025-03-05', '2025-04-05', '2025-05-05', '2025-06-05'], vendor='Older gym')
    ongoing = payments(['2026-07-05', '2026-08-05', '2026-09-05', '2026-10-05'], vendor='Netflix')
    recent = payments(['2026-03-05', '2026-04-05', '2026-05-05', '2026-06-05'], vendor='Old gym')
    found = detect_series(older + ongoing + recent, TODAY)
    assert [(s.vendor, s.ongoing) for s in found] == [('Netflix', True), ('Old gym', False), ('Older gym', False)]


# ── GET /api/recurring/detected ───────────────────────────────────────────────

def add_payments(account_id, days, vendor='Netflix', amount=-15.49, category='Subscriptions'):
    return [account_svc.add_transaction(account_id, date.fromisoformat(day), vendor, category, amount)
            for day in days]


class TestDetectedEndpoint:
    def test_requires_login(self, client):
        assert client.get('/api/recurring/detected').status_code == 401

    def test_lists_the_users_series_with_their_transactions(self, client, auth_headers, account, pin_today):
        pin_today(TODAY)
        ids = [t.id for t in add_payments(account.id, MONTHLY)]
        resp = client.get('/api/recurring/detected', headers=auth_headers)
        assert resp.status_code == 200
        [series] = resp.json['series']
        assert {k: v for k, v in series.items() if k != 'transactions'} == {
            'account_id': account.id, 'vendor': 'Netflix', 'category': 'Subscriptions', 'amount': -15.49,
            'frequency': 1, 'frequency_unit': 'months', 'ongoing': True, 'next_date': '2026-11-05',
        }
        assert [t['id'] for t in series['transactions']] == ids
        assert all(t['over_budget'] is False for t in series['transactions'])

    def test_other_users_transactions_are_not_scanned(self, client, auth_headers, account, pin_today):
        pin_today(TODAY)
        other = User(username='other', email='other@example.com')
        other.set_password('otherpass')
        _db.session.add(other)
        _db.session.flush()
        theirs = AccountModel(user_id=other.id, acct_id_str='other-0001', acct_name='Other Checking')
        _db.session.add(theirs)
        _db.session.commit()
        add_payments(theirs.id, MONTHLY)
        assert client.get('/api/recurring/detected', headers=auth_headers).json['series'] == []

    def test_a_vendor_with_a_template_is_left_out(self, client, auth_headers, account, pin_today):
        pin_today(TODAY)
        add_payments(account.id, MONTHLY)
        recurring_svc.add_recurring(account.id, date(2026, 6, 5), 'netflix', 'Subscriptions', -15.49,
                                    next_date=date(2026, 11, 5), frequency=1, frequency_unit='months')
        assert client.get('/api/recurring/detected', headers=auth_headers).json['series'] == []
