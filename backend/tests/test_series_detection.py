"""
Series detection tests: finding recurring series among a user's transactions (the pure rules in
series_detection), and the /api/recurring/detected endpoints (list, add, "Not recurring") end to end.
"""
import itertools
from datetime import date
from types import SimpleNamespace

import pytest

from extensions import db as _db
from models.account import AccountModel
from models.recurring import RecurringModel
from models.series_dismissal import SeriesDismissalModel
from models.transaction import TransactionModel
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


@pytest.mark.parametrize('tracked, found', [
    ({(1, 'netflix', -1549)}, False),
    ({(1, 'netflix', -1999)}, False),     # the template's amount went up: still that series
    ({(1, 'netflix', -65000)}, True),     # another series to the same vendor (a rent and its fee)
    ({(2, 'netflix', -1549)}, True),      # another account's template
], ids=['same', 'similar-amount', 'other-amount', 'other-account'])
def test_a_series_matching_a_template_is_left_out(tracked, found):
    assert len(detect_series(payments(MONTHLY, vendor=' NETFLIX'), TODAY, tracked=tracked)) == (1 if found else 0)


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


def test_the_due_date_and_typical_amount():
    other = tx('2026-10-20', vendor='Grocer', amount=-40.00)
    [series] = detect_series(payments(MONTHLY[:3], amount=-15.49) + payments(MONTHLY[3:], amount=-17.99) + [other],
                             TODAY)
    assert series.due_date == date(2026, 10, 5)     # the payment after Sep's, which never came
    assert series.typical_cents == -1549            # the median payment
    assert series.amount_cents == -1799             # the latest


@pytest.mark.parametrize('dismissed, found', [
    ({(1, 'netflix', -1549)}, False),
    ({(1, 'netflix', -1800)}, False),     # a similar size: the same series
    ({(1, 'netflix', -4000)}, True),      # another size: another series
    ({(1, 'netflix', 1549)}, True),       # income, not spending
    ({(2, 'netflix', -1549)}, True),      # another account
], ids=['same', 'similar-size', 'other-size', 'other-direction', 'other-account'])
def test_a_dismissed_series_is_left_out(dismissed, found):
    assert len(detect_series(payments(MONTHLY), TODAY, dismissed=dismissed)) == (1 if found else 0)


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


def detected(client, headers):
    return client.get('/api/recurring/detected', headers=headers).json['series']


def add_series(client, headers, transaction_ids):
    return client.post('/api/recurring/detected', json={'transaction_ids': transaction_ids}, headers=headers)


def dismiss_series(client, headers, transaction_ids):
    return client.post('/api/recurring/detected/dismissals', json={'transaction_ids': transaction_ids},
                       headers=headers)


CHANGED = 'That series has changed. Find recurring again.'
BAD_IDS = "'transaction_ids' must be a list of transaction ids."


class TestAddDetectedSeries:
    def test_requires_login(self, client):
        assert add_series(client, {}, [1]).status_code == 401

    def test_an_ongoing_series_becomes_a_template_that_starts_today_or_later(self, client, auth_headers,
                                                                             account, pin_today):
        pin_today(TODAY)
        ids = [t.id for t in add_payments(account.id, MONTHLY)]
        resp = add_series(client, auth_headers, ids)
        assert resp.status_code == 201
        assert resp.json['recurring']['next_date'] == '2026-11-05'
        rec = _db.session.get(RecurringModel, resp.json['recurring']['id'])
        assert (rec.account_id, rec.vendor, rec.category, rec.amount_cents) == (
            account.id, 'Netflix', 'Subscriptions', -1549)
        assert (rec.frequency, rec.frequency_unit, rec.day_of_month) == (1, 'months', 5)
        assert (rec.start_date, rec.next_date, rec.number, rec.idx) == (date(2026, 6, 5), date(2026, 11, 5), -1, 5)
        linked = sorted(rec.generated_transactions, key=lambda t: t.date)
        assert [(t.id, t.recurring_index) for t in linked] == [(tid, n) for n, tid in enumerate(ids, start=1)]

    def test_an_ongoing_series_never_fills_in_the_past(self, client, auth_headers, account, pin_today):
        pin_today(TODAY)
        add_series(client, auth_headers, [t.id for t in add_payments(account.id, MONTHLY)])
        assert recurring_svc.process_due_recurring(account.id) == 0          # Oct 5 stays empty
        pin_today(date(2026, 11, 5))
        assert recurring_svc.process_due_recurring(account.id) == 1          # Nov 5 comes due
        assert [t.date for t in TransactionModel.query.filter_by(vendor='Netflix').order_by(TransactionModel.date)][-2:] == [
            date(2026, 9, 4), date(2026, 11, 5)]

    def test_an_ended_series_becomes_a_finished_template(self, client, auth_headers, account, pin_today):
        pin_today(TODAY)
        ids = [t.id for t in add_payments(account.id, MONTHLY)]
        add_payments(account.id, ['2026-10-20'], vendor='Grocer', amount=-40.00)    # the account goes on without it
        resp = add_series(client, auth_headers, ids)
        assert resp.status_code == 201
        rec = _db.session.get(RecurringModel, resp.json['recurring']['id'])
        assert (rec.number, rec.idx, rec.next_date) == (4, 5, date(2026, 10, 5))
        assert resp.json['recurring']['last_date'] == '2026-09-05'
        assert recurring_svc.process_due_recurring(account.id) == 0          # finished: nothing to generate

    def test_an_added_series_is_no_longer_detected(self, client, auth_headers, account, pin_today):
        pin_today(TODAY)
        add_series(client, auth_headers, [t.id for t in add_payments(account.id, MONTHLY)])
        assert detected(client, auth_headers) == []

    def test_adding_the_rent_leaves_its_fee_to_add(self, client, auth_headers, account, pin_today):
        pin_today(TODAY)
        rent = add_payments(account.id, MONTHLY, vendor='Millenium Apartments', amount=-650.00, category='Rent')
        add_payments(account.id, MONTHLY, vendor='Millenium Apartments', amount=-2.49, category='Rent')
        add_series(client, auth_headers, [t.id for t in rent])
        [fee] = detected(client, auth_headers)
        assert fee['amount'] == -2.49
        assert add_series(client, auth_headers, [t['id'] for t in fee['transactions']]).status_code == 201

    @pytest.mark.parametrize('change', ['missing', 'extra', 'unknown'])
    def test_a_series_that_changed_is_rejected(self, client, auth_headers, account, pin_today, change):
        pin_today(TODAY)
        ids = [t.id for t in add_payments(account.id, MONTHLY)]
        extra = add_payments(account.id, ['2026-07-20'], vendor='Grocer', amount=-40.00)[0].id
        sent = {'missing': ids[:3], 'extra': ids + [extra], 'unknown': ids[:3] + [99999]}[change]
        resp = add_series(client, auth_headers, sent)
        assert (resp.status_code, resp.json['error']) == (400, CHANGED)
        assert RecurringModel.query.count() == 0

    def test_another_users_series_cannot_be_added(self, client, auth_headers, account, pin_today):
        pin_today(TODAY)
        other = User(username='other', email='other@example.com')
        other.set_password('otherpass')
        _db.session.add(other)
        _db.session.flush()
        theirs = AccountModel(user_id=other.id, acct_id_str='other-0001', acct_name='Other Checking')
        _db.session.add(theirs)
        _db.session.commit()
        resp = add_series(client, auth_headers, [t.id for t in add_payments(theirs.id, MONTHLY)])
        assert (resp.status_code, resp.json['error']) == (400, CHANGED)
        assert RecurringModel.query.count() == 0

    @pytest.mark.parametrize('body', [{}, {'transaction_ids': '1,2'}, {'transaction_ids': []},
                                      {'transaction_ids': [True]}, {'transaction_ids': ['1']}],
                             ids=['missing', 'text', 'empty', 'boolean', 'text-id'])
    def test_bad_transaction_ids_are_rejected(self, client, auth_headers, body):
        resp = client.post('/api/recurring/detected', json=body, headers=auth_headers)
        assert (resp.status_code, resp.json['error']) == (400, BAD_IDS)


class TestDismissDetectedSeries:
    def test_requires_login(self, client):
        assert dismiss_series(client, {}, [1]).status_code == 401

    def test_not_recurring_hides_the_series_for_good(self, client, auth_headers, account, pin_today):
        pin_today(TODAY)
        ids = [t.id for t in add_payments(account.id, MONTHLY)]
        resp = dismiss_series(client, auth_headers, ids)
        assert (resp.status_code, resp.json) == (200, {'success': True})
        assert detected(client, auth_headers) == []
        add_payments(account.id, ['2026-10-05'])        # the series goes on: still hidden
        assert detected(client, auth_headers) == []
        assert RecurringModel.query.count() == 0

    def test_dismissing_the_fee_keeps_the_rent(self, client, auth_headers, account, pin_today):
        pin_today(TODAY)
        add_payments(account.id, MONTHLY, vendor='Millenium Apartments', amount=-650.00, category='Rent')
        fee = add_payments(account.id, MONTHLY, vendor='Millenium Apartments', amount=-2.49, category='Rent')
        dismiss_series(client, auth_headers, [t.id for t in fee])
        assert [s['amount'] for s in detected(client, auth_headers)] == [-650.00]

    def test_a_series_that_changed_is_rejected(self, client, auth_headers, account, pin_today):
        pin_today(TODAY)
        ids = [t.id for t in add_payments(account.id, MONTHLY)]
        resp = dismiss_series(client, auth_headers, ids[:3])
        assert (resp.status_code, resp.json['error']) == (400, CHANGED)
        assert SeriesDismissalModel.query.count() == 0

    def test_bad_transaction_ids_are_rejected(self, client, auth_headers):
        resp = client.post('/api/recurring/detected/dismissals', json={'transaction_ids': 'all'}, headers=auth_headers)
        assert (resp.status_code, resp.json['error']) == (400, BAD_IDS)

    def test_deleting_the_account_deletes_its_dismissals(self, client, auth_headers, account, pin_today):
        pin_today(TODAY)
        dismiss_series(client, auth_headers, [t.id for t in add_payments(account.id, MONTHLY)])
        assert SeriesDismissalModel.query.count() == 1
        account_svc.delete_account(account.id)
        assert SeriesDismissalModel.query.count() == 0
