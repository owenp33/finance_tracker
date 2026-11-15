"""
Recurring projection tests: GET /api/recurring/projection, the recurring occurrences still to come.
"""
from datetime import date

import pytest

from extensions import db as _db
from models.account import AccountModel
from models.recurring import RecurringModel
from models.user import User
from services.account_service import AccountService
from services.recurring_service import RecurringService

account_svc = AccountService()
recurring_svc = RecurringService()

TODAY = date(2026, 10, 28)
BAD_DAYS = "'days' must be a whole number from 1 to 366."


def monthly(account_id, next_date, vendor='Streaming', amount=-20.0, **fields):
    return recurring_svc.add_recurring(account_id, next_date, vendor, 'Subscriptions', amount,
                                       next_date=next_date, frequency=1, frequency_unit='months', **fields)


def projection(client, headers, days=None):
    query = '' if days is None else f'?days={days}'
    return client.get(f'/api/recurring/projection{query}', headers=headers)


def dates(resp):
    assert resp.status_code == 200, resp.json
    return [o['date'] for o in resp.json['occurrences']]


def set_progress(rec, idx, number):
    """Make rec a limited series with idx - 1 occurrences behind it."""
    rec.idx, rec.number = idx, number
    _db.session.commit()


class TestProjection:
    def test_requires_login(self, client):
        assert client.get('/api/recurring/projection').status_code == 401

    def test_a_monthly_template_lists_its_coming_dates(self, client, auth_headers, account, pin_today):
        pin_today(TODAY)
        rec_id = monthly(account.id, date(2026, 11, 2)).id
        resp = projection(client, auth_headers, 60)     # through Dec 27
        occurrence = {'recurring_id': rec_id, 'account_id': account.id, 'vendor': 'Streaming',
                      'category': 'Subscriptions', 'amount': -20.0}
        assert resp.json == {'success': True, 'occurrences': [
            {**occurrence, 'date': '2026-11-02'},
            {**occurrence, 'date': '2026-12-02'},
        ]}

    def test_sixty_days_by_default(self, client, auth_headers, account, pin_today):
        pin_today(TODAY)
        monthly(account.id, date(2026, 11, 2))
        assert dates(projection(client, auth_headers)) == ['2026-11-02', '2026-12-02']
        assert dates(projection(client, auth_headers, 70)) == ['2026-11-02', '2026-12-02', '2027-01-02']

    def test_the_window_includes_today_and_its_last_day(self, client, auth_headers, account, pin_today):
        pin_today(TODAY)
        recurring_svc.add_recurring(account.id, TODAY, 'Gym', 'Fun', -10.0, next_date=TODAY, frequency=7)
        assert dates(projection(client, auth_headers, 7)) == ['2026-10-28', '2026-11-04']
        assert dates(projection(client, auth_headers, 6)) == ['2026-10-28']

    def test_a_biweekly_template(self, client, auth_headers, account, pin_today):
        pin_today(TODAY)
        recurring_svc.add_recurring(account.id, date(2026, 10, 30), 'Clinic', 'Medical', -87.38,
                                    next_date=date(2026, 10, 30), frequency=14)
        assert dates(projection(client, auth_headers, 30)) == ['2026-10-30', '2026-11-13', '2026-11-27']

    def test_month_ends_clamp_and_come_back(self, client, auth_headers, account, pin_today):
        pin_today(TODAY)
        monthly(account.id, date(2026, 10, 31))
        assert dates(projection(client, auth_headers, 70)) == ['2026-10-31', '2026-11-30', '2026-12-31']

    def test_a_limited_series_stops_at_its_last_occurrence(self, client, auth_headers, account, pin_today):
        pin_today(TODAY)
        set_progress(monthly(account.id, date(2026, 11, 2)), idx=4, number=5)   # 2 occurrences left
        assert dates(projection(client, auth_headers, 200)) == ['2026-11-02', '2026-12-02']

    def test_a_finished_series_lists_nothing(self, client, auth_headers, account, pin_today):
        pin_today(TODAY)
        set_progress(monthly(account.id, date(2026, 11, 2)), idx=4, number=3)
        assert dates(projection(client, auth_headers)) == []

    def test_an_occurrence_whose_charge_is_already_in_is_left_out(self, client, auth_headers, account, pin_today):
        pin_today(TODAY)
        monthly(account.id, date(2026, 11, 2))
        account_svc.add_transaction(account.id, date(2026, 11, 1), 'Streaming', 'Subscriptions', -20.0)   # entered early
        assert dates(projection(client, auth_headers)) == ['2026-12-02']

    def test_one_charge_stands_in_for_one_occurrence_only(self, client, auth_headers, account, pin_today):
        pin_today(TODAY)
        # Every 3 days (the backend allows any number of days): Nov 1 is within 3 days of both
        # Oct 30 and Nov 2, and, as generation would, it goes to the earlier one
        recurring_svc.add_recurring(account.id, date(2026, 10, 30), 'Gym', 'Fun', -10.0,
                                    next_date=date(2026, 10, 30), frequency=3)
        account_svc.add_transaction(account.id, date(2026, 11, 1), 'Gym', 'Fun', -10.0)
        assert dates(projection(client, auth_headers, 10)) == ['2026-11-02', '2026-11-05']

    def test_occurrences_before_today_are_left_out(self, client, auth_headers, account, pin_today):
        pin_today(TODAY)
        monthly(account.id, date(2026, 10, 20))     # due, not generated yet: the next page load does that
        assert dates(projection(client, auth_headers)) == ['2026-11-20', '2026-12-20']

    def test_every_account_and_income_appear_in_date_order(self, client, auth_headers, account, user, pin_today):
        pin_today(TODAY)
        savings = AccountModel(user_id=user.id, acct_id_str='savings-5678', acct_name='Test Savings')
        _db.session.add(savings)
        _db.session.commit()
        recurring_svc.add_recurring(savings.id, date(2026, 11, 6), 'Employer', 'Income', 500.0,
                                    next_date=date(2026, 11, 6), frequency=14)
        monthly(account.id, date(2026, 11, 2))
        resp = projection(client, auth_headers, 14)     # through Nov 11
        assert [(o['date'], o['account_id'], o['amount']) for o in resp.json['occurrences']] == [
            ('2026-11-02', account.id, -20.0),
            ('2026-11-06', savings.id, 500.0),
        ]

    def test_other_users_templates_are_left_out(self, client, auth_headers, account, pin_today):
        pin_today(TODAY)
        other = User(username='other', email='other@example.com')
        other.set_password('otherpass')
        _db.session.add(other)
        _db.session.flush()
        theirs = AccountModel(user_id=other.id, acct_id_str='other-0001', acct_name='Other Checking')
        _db.session.add(theirs)
        _db.session.commit()
        monthly(theirs.id, date(2026, 11, 2))
        assert dates(projection(client, auth_headers)) == []

    @pytest.mark.parametrize('days', ['abc', '0', '367', '-5', '1.5', ''])
    def test_bad_days_are_rejected(self, client, auth_headers, days):
        resp = projection(client, auth_headers, days)
        assert (resp.status_code, resp.json) == (400, {'success': False, 'error': BAD_DAYS})
