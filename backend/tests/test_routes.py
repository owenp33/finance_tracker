"""
HTTP integration tests — hit the actual Flask routes via test client.
These verify the full request/response cycle including auth middleware.
"""
from datetime import date

import pytest


# ── Auth ──────────────────────────────────────────────────────────────────────

class TestAuth:
    def test_login_returns_token(self, client, user):
        resp = client.post('/api/auth/login', json={'username': 'testuser', 'password': 'testpass'})
        assert resp.status_code == 200
        assert 'access_token' in resp.json

    def test_login_wrong_password(self, client, user):
        resp = client.post('/api/auth/login', json={'username': 'testuser', 'password': 'wrong'})
        assert resp.status_code == 401

    def test_login_unknown_user(self, client):
        resp = client.post('/api/auth/login', json={'username': 'nobody', 'password': 'x'})
        assert resp.status_code == 401

    @pytest.mark.parametrize('body, content_type', [
        ('null',              'application/json'),
        ('["testuser"]',      'application/json'),
        ('username=testuser', 'text/plain'),
    ])
    def test_login_malformed_body_returns_400(self, client, body, content_type):
        resp = client.post('/api/auth/login', data=body, content_type=content_type)
        assert resp.status_code == 400
        assert resp.json == {'success': False, 'error': 'Missing credentials'}

    def test_login_non_string_password_returns_401(self, client, user):
        resp = client.post('/api/auth/login', json={'username': 'testuser', 'password': ['testpass']})
        assert resp.status_code == 401
        assert resp.json == {'success': False, 'error': 'Invalid credentials'}

    def test_protected_route_requires_token(self, client, account):
        resp = client.get(f'/api/accounts/{account.id}/transactions')
        assert resp.status_code == 401

    def test_me_returns_user(self, client, auth_headers, user):
        resp = client.get('/api/auth/me', headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json['user']['username'] == 'testuser'

    def test_register_returns_usable_token(self, client):
        resp = client.post('/api/auth/register',
                           json={'username': 'newuser', 'email': 'new@example.com', 'password': 'long-enough'})
        assert resp.status_code == 201

        me = client.get('/api/auth/me',
                        headers={'Authorization': f"Bearer {resp.json['access_token']}"})
        assert me.status_code == 200
        assert me.json['user']['username'] == 'newuser'


class TestRegisterValidation:
    VALID = {'username': 'newuser', 'email': 'new@example.com', 'password': 'long-enough'}

    def _register(self, client, **overrides):
        return client.post('/api/auth/register', json={**self.VALID, **overrides})

    @pytest.mark.parametrize('overrides, message', [
        ({'username': None},                'Missing required fields: username'),
        ({'username': '   '},               'Missing required fields: username'),
        ({'username': 123},                 'Missing required fields: username'),
        ({'email': None, 'password': None}, 'Missing required fields: email, password'),
        ({'username': 'u' * 51},            'Username must be at most 50 characters.'),
        ({'email': 'not-an-email'},         'Enter a valid email address.'),
        ({'password': 'short'},             'Password must be at least 8 characters.'),
    ])
    def test_invalid_input_returns_400(self, client, overrides, message):
        resp = self._register(client, **overrides)
        assert resp.status_code == 400
        assert resp.json == {'success': False, 'error': message}

    def test_non_json_body_returns_400(self, client):
        resp = client.post('/api/auth/register', data='not json', content_type='text/plain')
        assert resp.status_code == 400

    def test_taken_username_returns_409(self, client, user):
        resp = self._register(client, username='testuser')
        assert resp.status_code == 409
        assert resp.json['error'] == 'That username is already taken.'

    def test_taken_email_returns_409_regardless_of_case(self, client, user):
        resp = self._register(client, email='TEST@Example.com')
        assert resp.status_code == 409
        assert resp.json['error'] == 'An account with that email already exists.'


# ── Accounts ──────────────────────────────────────────────────────────────────

class TestAccountRoutes:
    def test_list_includes_needs_attention(self, client, auth_headers, account):
        resp = client.get('/api/accounts', headers=auth_headers)
        assert resp.json['accounts'][0]['needs_attention'] is False

    def test_looks_good_clears_needs_attention(self, client, auth_headers, account):
        from extensions import db as _db
        account.needs_attention = True
        _db.session.commit()
        resp = client.patch(f'/api/accounts/{account.id}', json={'needs_attention': False},
                            headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json['account']['needs_attention'] is False

    def test_invalid_needs_attention_returns_400(self, client, auth_headers, account):
        resp = client.patch(f'/api/accounts/{account.id}', json={'needs_attention': 'yes'},
                            headers=auth_headers)
        assert resp.status_code == 400
        assert resp.json == {'success': False, 'error': 'needs_attention can only be set to false'}

    def test_rename_returns_the_trimmed_name(self, client, auth_headers, account):
        resp = client.patch(f'/api/accounts/{account.id}', json={'account_name': ' Joint Checking '},
                            headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json['account']['account_name'] == 'Joint Checking'

    @pytest.mark.parametrize('body, error', [
        ({'account_name': 'x' * 101}, 'Display name must be at most 100 characters.'),
        ({'account_id': '  '}, "Account ID can't be empty."),
    ], ids=['long-name', 'blank-id'])
    def test_invalid_name_or_id_returns_400(self, client, auth_headers, account, body, error):
        resp = client.patch(f'/api/accounts/{account.id}', json=body, headers=auth_headers)
        assert resp.status_code == 400
        assert resp.json == {'success': False, 'error': error}

    def test_setting_the_starting_balance_returns_the_new_balance(self, client, auth_headers, account):
        resp = client.patch(f'/api/accounts/{account.id}', json={'opening_balance': 1500.25},
                            headers=auth_headers)
        assert resp.status_code == 200
        assert (resp.json['account']['opening_balance'], resp.json['account']['balance']) == (1500.25, 1500.25)

    def test_invalid_starting_balance_returns_400(self, client, auth_headers, account):
        resp = client.patch(f'/api/accounts/{account.id}', json={'opening_balance': 'lots'},
                            headers=auth_headers)
        assert resp.status_code == 400
        assert resp.json == {'success': False, 'error': 'Starting balance must be a number.'}


# ── Transaction CRUD via HTTP ─────────────────────────────────────────────────

class TestTransactionRoutes:
    def _add(self, client, account, auth_headers, **kwargs):
        payload = {'date': '2026-01-15', 'vendor': 'Netflix',
                   'category': 'Subscriptions', 'amount': -20.00}
        payload.update(kwargs)
        return client.post(f'/api/accounts/{account.id}/transactions',
                           json=payload, headers=auth_headers)

    def test_add_transaction(self, client, account, auth_headers):
        resp = self._add(client, account, auth_headers)
        assert resp.status_code == 201
        assert resp.json['transaction']['vendor'] == 'Netflix'
        assert resp.json['transaction']['amount'] == pytest.approx(-20.00)

    def test_add_transaction_updates_balance(self, client, account, auth_headers):
        resp = self._add(client, account, auth_headers, amount=-50.00)
        assert resp.json['new_balance'] == pytest.approx(-50.00)

    def test_update_transaction(self, client, account, auth_headers):
        add_resp = self._add(client, account, auth_headers)
        tx_id = add_resp.json['transaction']['id']

        resp = client.put(f'/api/transactions/{tx_id}',
                          json={'vendor': 'Hulu', 'date': '2026-01-15',
                                'category': 'Subscriptions', 'amount': -20.00,
                                'notes': '', 'account_id': account.id},
                          headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json['transaction']['vendor'] == 'Hulu'

    def test_update_amount_adjusts_balance(self, client, account, auth_headers):
        add_resp = self._add(client, account, auth_headers, amount=-20.00)
        tx_id = add_resp.json['transaction']['id']

        resp = client.put(f'/api/transactions/{tx_id}',
                          json={'vendor': 'Netflix', 'date': '2026-01-15',
                                'category': 'Subscriptions', 'amount': -30.00,
                                'notes': '', 'account_id': account.id},
                          headers=auth_headers)
        assert resp.json['new_balance'] == pytest.approx(-30.00)

    def test_delete_transaction(self, client, account, auth_headers):
        add_resp = self._add(client, account, auth_headers)
        tx_id = add_resp.json['transaction']['id']

        resp = client.delete(f'/api/transactions/{tx_id}', headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json['new_balance'] == pytest.approx(0.00)

    def test_cannot_access_other_users_transaction(self, client, account, auth_headers):
        from models.user import User
        from models.account import AccountModel
        from extensions import db as _db

        other = User(username='other', email='other@example.com')
        other.set_password('pass')
        _db.session.add(other)
        _db.session.flush()
        other_acct = AccountModel(user_id=other.id, acct_id_str='other-1', acct_name='Other')
        _db.session.add(other_acct)
        _db.session.commit()

        add_resp = client.post(f'/api/accounts/{other_acct.id}/transactions',
                               json={'date': '2026-01-15', 'vendor': 'Test',
                                     'category': 'Other', 'amount': -10.00},
                               headers={'Authorization': 'Bearer ' +
                                        client.post('/api/auth/login',
                                                    json={'username': 'other', 'password': 'pass'}).json['access_token']})
        tx_id = add_resp.json['transaction']['id']

        resp = client.delete(f'/api/transactions/{tx_id}', headers=auth_headers)
        assert resp.status_code == 403


# ── Recurring routes ──────────────────────────────────────────────────────────

class TestRecurringRoutes:
    def test_add_recurring(self, client, account, auth_headers):
        resp = client.post(f'/api/accounts/{account.id}/recurring',
                           json={'start_date': '2026-01-01', 'vendor': 'Spotify',
                                 'category': 'Subscriptions', 'amount': -9.99,
                                 'frequency': 30, 'next_date': '2099-01-01'},
                           headers=auth_headers)
        assert resp.status_code == 201
        assert resp.json['recurring']['vendor'] == 'Spotify'

    def test_add_recurring_generates_due_transactions(self, client, account, auth_headers):
        from datetime import date, timedelta
        past = (date.today() - timedelta(days=1)).isoformat()
        resp = client.post(f'/api/accounts/{account.id}/recurring',
                           json={'start_date': past, 'vendor': 'Quizlet',
                                 'category': 'Subscriptions', 'amount': -20.67,
                                 'frequency': 30, 'next_date': past},
                           headers=auth_headers)
        assert resp.status_code == 201

        txns_resp = client.get(f'/api/accounts/{account.id}/transactions', headers=auth_headers)
        vendors = [t['vendor'] for t in txns_resp.json['transactions']]
        assert 'Quizlet' in vendors

    def _add(self, client, account, auth_headers, **fields):
        body = {'start_date': '2099-01-31', 'vendor': 'ASPIRE', 'category': 'Loan', 'amount': -75,
                'frequency': 1, 'frequency_unit': 'months', **fields}
        return client.post(f'/api/accounts/{account.id}/recurring', json=body, headers=auth_headers)

    def test_add_monthly_recurring(self, client, account, auth_headers):
        resp = self._add(client, account, auth_headers)
        assert resp.status_code == 201
        assert (resp.json['recurring']['frequency'], resp.json['recurring']['frequency_unit']) == (1, 'months')

    @pytest.mark.parametrize('fields, error', [
        ({'frequency': 0}, 'Frequency must be a whole number of at least 1.'),
        ({'frequency_unit': 'weeks'}, "Frequency unit must be 'days' or 'months'."),
    ], ids=['zero-frequency', 'unknown-unit'])
    def test_add_invalid_schedule_returns_400(self, client, account, auth_headers, fields, error):
        resp = self._add(client, account, auth_headers, **fields)
        assert resp.status_code == 400
        assert resp.json == {'success': False, 'error': error}

    def test_add_skipping_past_occurrences(self, client, account, auth_headers, pin_today):
        pin_today(date(2026, 10, 24))
        resp = self._add(client, account, auth_headers, start_date='2025-01-31', skip_past=True)
        assert resp.status_code == 201
        assert (resp.json['recurring']['date'], resp.json['recurring']['next_date']) == ('2026-10-31', '2026-10-31')
        txns = client.get(f'/api/accounts/{account.id}/transactions', headers=auth_headers).json['transactions']
        assert txns == []

    def _aspire_with_history(self, client, account, auth_headers, pin_today):
        """A monthly ASPIRE template from Oct 31 and one $75 payment on Sep 30 that isn't linked."""
        pin_today(date(2026, 10, 25))
        tx_id = client.post(f'/api/accounts/{account.id}/transactions', headers=auth_headers, json={
            'date': '2026-09-30', 'vendor': 'ASPIRE', 'category': 'Loan', 'amount': -75}).json['transaction']['id']
        rec_id = self._add(client, account, auth_headers, start_date='2026-10-31').json['recurring']['id']
        return rec_id, tx_id

    def test_suggestions_list_matching_transactions(self, client, account, auth_headers, pin_today):
        rec_id, tx_id = self._aspire_with_history(client, account, auth_headers, pin_today)
        resp = client.get(f'/api/recurring/{rec_id}/suggestions', headers=auth_headers)
        assert resp.status_code == 200
        [suggestion] = resp.json['suggestions']
        assert (suggestion['date'], suggestion['kind'], suggestion['linked']) == ('2026-09-30', 'history', [])
        assert [t['id'] for t in suggestion['candidates']] == [tx_id]

    def test_link_and_unlink_a_transaction(self, client, account, auth_headers, pin_today):
        rec_id, tx_id = self._aspire_with_history(client, account, auth_headers, pin_today)
        url = f'/api/recurring/{rec_id}/transactions/{tx_id}'

        linked = client.post(url, headers=auth_headers)
        assert linked.status_code == 200
        assert (linked.json['recurring']['date'], linked.json['recurring']['idx']) == ('2026-09-30', 2)
        assert client.get(f'/api/transactions/{tx_id}', headers=auth_headers).json['transaction']['recurring_id'] == rec_id
        assert client.get(f'/api/recurring/{rec_id}/suggestions', headers=auth_headers).json['suggestions'] == []

        unlinked = client.delete(url, headers=auth_headers)
        assert unlinked.status_code == 200
        assert unlinked.json['recurring']['idx'] == 1
        assert client.get(f'/api/transactions/{tx_id}', headers=auth_headers).json['transaction']['recurring_id'] is None

    def test_invalid_link_or_unlink_returns_400(self, client, account, auth_headers, pin_today):
        rec_id, tx_id = self._aspire_with_history(client, account, auth_headers, pin_today)
        url = f'/api/recurring/{rec_id}/transactions/{tx_id}'
        unlinked = client.delete(url, headers=auth_headers)
        assert (unlinked.status_code, unlinked.json['error']) == (400, "That transaction isn't part of this recurring series.")
        client.post(url, headers=auth_headers)
        again = client.post(url, headers=auth_headers)
        assert (again.status_code, again.json['error']) == (400, 'That transaction is already part of a recurring series.')

    def test_templates_report_whether_they_need_attention(self, client, account, auth_headers, pin_today):
        rec_id, _ = self._aspire_with_history(client, account, auth_headers, pin_today)
        [listed] = client.get(f'/api/accounts/{account.id}/recurring', headers=auth_headers).json['recurring']
        single = client.get(f'/api/recurring/{rec_id}', headers=auth_headers).json['recurring']
        for template in (listed, single):
            assert (template['suggestion_count'], template['needs_attention']) == (1, True)

    def test_dismiss_and_undo(self, client, account, auth_headers, pin_today):
        rec_id, tx_id = self._aspire_with_history(client, account, auth_headers, pin_today)
        url = f'/api/recurring/{rec_id}/dismissals/{tx_id}'
        dismissed = client.post(url, headers=auth_headers)
        assert dismissed.status_code == 200
        assert (dismissed.json['recurring']['suggestion_count'], dismissed.json['recurring']['needs_attention']) == (0, False)
        undone = client.delete(url, headers=auth_headers)
        assert (undone.status_code, undone.json['recurring']['suggestion_count']) == (200, 1)

    def test_missing_transaction_returns_404(self, client, account, auth_headers, pin_today):
        rec_id, _ = self._aspire_with_history(client, account, auth_headers, pin_today)
        resp = client.post(f'/api/recurring/{rec_id}/transactions/999999', headers=auth_headers)
        assert (resp.status_code, resp.json['error']) == (404, 'Transaction not found')

    def test_creating_with_past_occurrences_does_not_duplicate_history(self, client, account, auth_headers, pin_today):
        pin_today(date(2026, 10, 25))
        client.post(f'/api/accounts/{account.id}/transactions', headers=auth_headers, json={
            'date': '2026-09-30', 'vendor': 'ASPIRE', 'category': 'Loan', 'amount': -75})
        self._add(client, account, auth_headers, start_date='2026-09-30')   # past occurrences added
        txns = client.get(f'/api/accounts/{account.id}/transactions', headers=auth_headers).json['transactions']
        assert [(t['date'], t['recurring_index']) for t in txns] == [('2026-09-30', 1)]

    def test_switch_a_template_to_monthly(self, client, account, auth_headers):
        rec_id = self._add(client, account, auth_headers, frequency=30, frequency_unit='days').json['recurring']['id']
        resp = client.patch(f'/api/recurring/{rec_id}', json={'frequency': 1, 'frequency_unit': 'months'},
                            headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json['recurring']['frequency_unit'] == 'months'
