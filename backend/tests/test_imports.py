"""
Import tests: pin the two-step import flow (POST /api/import/preview, then
POST /api/import/confirm) through the HTTP routes. File content is built inline.
"""
import io
from datetime import date, datetime

import pandas as pd
import pytest

from extensions import db as _db
from models.account import AccountModel
from models.recurring import RecurringModel
from models.recurring_alias import RecurringAliasModel
from models.transaction import TransactionModel
from models.user import User
from services.account_service import AccountService
from services.recurring_service import RecurringService

account_svc = AccountService()
recurring_svc = RecurringService()

HEADER = 'date,vendor,category,amount,account,notes\n'


def preview(client, headers, content, filename='bank.csv', content_type='text/csv', **form):
    body = content if isinstance(content, bytes) else content.encode('utf-8')
    data = {'file': (io.BytesIO(body), filename, content_type), **form}
    return client.post('/api/import/preview', data=data, headers=headers,
                       content_type='multipart/form-data')


def confirm(client, headers, rows):
    return client.post('/api/import/confirm', json={'transactions': rows}, headers=headers)


def confirm_row(account_id, **overrides):
    """A row shaped like the ones the preview returns and the frontend sends back."""
    row = {'date': '2025-01-15', 'vendor': 'Grocer', 'category': 'Groceries', 'amount': -42.10,
           'notes': '', 'account_id': account_id, 'is_transfer': False}
    row.update(overrides)
    return row


def transactions_in(account_id):
    return TransactionModel.query.filter_by(account_id=account_id).order_by(TransactionModel.id).all()


@pytest.fixture
def savings(user):
    a = AccountModel(user_id=user.id, acct_id_str='savings-5678', acct_name='Test Savings')
    _db.session.add(a)
    _db.session.commit()
    return a


@pytest.fixture
def other_users_account():
    other = User(username='other', email='other@example.com')
    other.set_password('otherpass')
    _db.session.add(other)
    _db.session.flush()
    a = AccountModel(user_id=other.id, acct_id_str='other-0001', acct_name='Other Checking')
    _db.session.add(a)
    _db.session.commit()
    return a


# ── Preview: parsing ──────────────────────────────────────────────────────────

class TestPreviewParsing:
    def test_single_amount_column_with_currency_formatting(self, client, auth_headers, account):
        resp = preview(client, auth_headers, HEADER
                       + '2025-01-15,Landlord,Rent,"-$1,234.50",Test Checking,\n'
                       + '2025-01-16,Employer,Income,$20,Test Checking,\n')
        assert resp.status_code == 200
        assert [r['amount'] for r in resp.json['rows']] == [-1234.5, 20.0]

    @pytest.mark.parametrize('expense_col, income_col', [('expense', 'income'), ('withdrawal', 'deposit')])
    def test_expense_and_income_columns_become_a_signed_amount(self, client, auth_headers, account,
                                                               expense_col, income_col):
        resp = preview(client, auth_headers,
                       f'date,store,category,{expense_col},{income_col},account,description\n'
                       '01/23/2025,Fresh Thyme,Grocery,51.71,,Test Checking,Weekly groceries\n'
                       '01/24/2025,University,Loan,,"3,987.63",Test Checking,Disbursement\n')
        rows = resp.json['rows']
        assert [r['amount'] for r in rows] == [-51.71, 3987.63]
        assert rows[0]['vendor'] == 'Fresh Thyme'          # from the 'store' column
        assert rows[0]['notes'] == 'Weekly groceries'      # from the 'description' column

    @pytest.mark.parametrize('raw', ['01/15/2025', '2025-01-15', '01-15-2025', '2025-01-15 08:30:00', '45672'])
    def test_supported_date_formats(self, client, auth_headers, account, raw):
        resp = preview(client, auth_headers, HEADER + f'{raw},Grocer,Groceries,-5.00,Test Checking,\n')
        row = resp.json['rows'][0]
        assert (row['date'], row['invalid_date']) == ('2025-01-15', False)

    @pytest.mark.parametrize('raw, shown', [('1/5/25', '1/5/25'), (' Jan 5 ', 'Jan 5'), ('', '')])
    def test_unparseable_date_is_flagged(self, client, auth_headers, account, raw, shown):
        account_svc.add_transaction(account.id, date.today(), 'Grocer', 'Groceries', -5.00)
        resp = preview(client, auth_headers, HEADER + f'{raw},Grocer,Groceries,-5.00,Test Checking,\n')
        row = resp.json['rows'][0]
        assert row['invalid_date'] is True
        assert row['date'] == shown            # the original text, so the user can see what was wrong
        assert row['duplicate'] is False       # no date to compare, so no duplicate check
        assert resp.json['summary']['importable'] == 0

    def test_empty_excel_date_cell_is_flagged(self, client, auth_headers, account):
        buf = io.BytesIO()
        pd.DataFrame({'date': [datetime(2025, 1, 15), None], 'vendor': ['Grocer', 'Cafe'],
                      'category': ['Groceries', 'Dining'], 'amount': [-5.0, -4.5],
                      'account': ['Test Checking', 'Test Checking']}).to_excel(buf, index=False)
        resp = preview(client, auth_headers, buf.getvalue(), filename='bank.xlsx',
                       content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        assert [(r['date'], r['invalid_date']) for r in resp.json['rows']] == [('2025-01-15', False), ('', True)]

    @pytest.mark.parametrize('raw', ['(12.34)', '$(12.34)', '"($12.34)"'])
    def test_parenthesized_amount_reads_as_negative(self, client, auth_headers, account, raw):
        resp = preview(client, auth_headers, HEADER + f'2025-01-15,Grocer,Groceries,{raw},Test Checking,\n')
        row = resp.json['rows'][0]
        assert (row['amount'], row['zero_amount'], row['invalid_amount']) == (-12.34, False, False)

    def test_both_expense_and_income_blank_is_an_invalid_amount(self, client, auth_headers, account):
        resp = preview(client, auth_headers,
                       'date,vendor,category,expense,income,account\n'
                       '2025-01-15,Grocer,Groceries,,,Test Checking\n'
                       '2025-01-15,Cafe,Dining,abc,,Test Checking\n')
        assert [(r['amount'], r['invalid_amount']) for r in resp.json['rows']] == [('', True), ('abc', True)]

    def test_blank_values_get_defaults(self, client, auth_headers, account):
        resp = preview(client, auth_headers, HEADER + '2025-01-15,,,-5.00,Test Checking,\n')
        row = resp.json['rows'][0]
        assert (row['vendor'], row['category'], row['notes']) == ('Unknown', 'Uncategorized', '')

    def test_vendor_and_category_are_trimmed_and_truncated(self, client, auth_headers, account):
        resp = preview(client, auth_headers, HEADER
                       + '2025-01-15,  Coffee Shop  , Dining ,-4.50,Test Checking,\n'
                       + f'2025-01-15,{"V" * 120},{"C" * 60},-4.50,Test Checking,\n')
        first, second = resp.json['rows']
        assert (first['vendor'], first['category']) == ('Coffee Shop', 'Dining')
        assert (len(second['vendor']), len(second['category'])) == (100, 50)

    def test_headers_are_case_and_space_insensitive(self, client, auth_headers, account):
        resp = preview(client, auth_headers,
                       ' Date , VENDOR ,Category, Amount ,ACCOUNT\n2025-01-15,Grocer,Groceries,-5.00,Test Checking\n')
        assert resp.status_code == 200
        assert resp.json['rows'][0]['vendor'] == 'Grocer'

    def test_latin1_encoded_file(self, client, auth_headers, account):
        content = (HEADER + '2025-01-15,Café,Dining,-3.50,Test Checking,\n').encode('latin-1')
        resp = preview(client, auth_headers, content)
        assert resp.json['rows'][0]['vendor'] == 'Café'

    def test_xlsx_upload(self, client, auth_headers, account):
        buf = io.BytesIO()
        pd.DataFrame({'date': [datetime(2025, 1, 15)], 'vendor': ['Grocer'], 'category': ['Groceries'],
                      'amount': [-5.0], 'account': ['Test Checking']}).to_excel(buf, index=False)
        resp = preview(client, auth_headers, buf.getvalue(), filename='bank.xlsx',
                       content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        assert resp.status_code == 200
        assert resp.json['rows'][0]['date'] == '2025-01-15'

    def test_csv_extension_wins_over_an_excel_mime_type(self, client, auth_headers, account):
        resp = preview(client, auth_headers, HEADER + '2025-01-15,Grocer,Groceries,-5.00,Test Checking,\n',
                       content_type='application/vnd.ms-excel')
        assert resp.status_code == 200


# ── Preview: account matching ─────────────────────────────────────────────────

class TestPreviewAccounts:
    def test_matches_account_by_name_or_id_ignoring_case_and_spaces(self, client, auth_headers, account):
        resp = preview(client, auth_headers, HEADER
                       + '2025-01-15,Grocer,Groceries,-5.00, test checking ,\n'
                       + '2025-01-15,Grocer,Groceries,-6.00,CHECKING-1234,\n')
        for row in resp.json['rows']:
            assert (row['account_id'], row['account_name']) == (account.id, 'Test Checking')

    def test_other_users_accounts_are_not_matched(self, client, auth_headers, account, other_users_account):
        resp = preview(client, auth_headers, HEADER + '2025-01-15,Grocer,Groceries,-5.00,Other Checking,\n')
        assert resp.json['rows'][0]['account_id'] is None


# ── Preview: rows whose account isn't found ───────────────────────────────────

NO_ACCOUNT_COLUMN = 'date,vendor,category,amount\n2025-01-15,Grocer,Groceries,-5.00\n'
TOO_MANY_ACCOUNTS = ("This import would create 26 new accounts (the limit is 25). "
                     "Check the file's account column, or choose another option.")


class TestPreviewUnmatchedAccounts:
    def test_creates_new_accounts_by_default(self, client, auth_headers, account):
        resp = preview(client, auth_headers, HEADER
                       + '2025-01-15,Grocer,Groceries,-5.00,Mystery Bank,\n'
                       + '2025-01-16,Grocer,Groceries,-6.00, mystery bank ,\n'
                       + '2025-01-17,Grocer,Groceries,-7.00,Test Checking,\n')
        rows = resp.json['rows']
        assert [(r['account_id'], r['account_name'], r['new_account']) for r in rows] == [
            (None, 'Mystery Bank', True),
            (None, 'Mystery Bank', True),         # same account, first spelling wins
            (account.id, 'Test Checking', False),
        ]
        assert resp.json['summary']['new_accounts'] == ['Mystery Bank']
        assert (resp.json['summary']['importable'], resp.json['summary']['unmatched']) == (3, 0)
        assert resp.json['unmatched_account_names'] == ['Mystery Bank']

    def test_no_account_column_creates_an_account_named_after_the_file(self, client, auth_headers):
        resp = preview(client, auth_headers, NO_ACCOUNT_COLUMN, filename='chase_2025.csv')
        row = resp.json['rows'][0]
        assert (row['account_id'], row['account_name'], row['new_account']) == (None, 'chase_2025', True)

    def test_blank_account_cell_uses_the_file_name_account(self, client, auth_headers):
        resp = preview(client, auth_headers, HEADER + '2025-01-15,Grocer,Groceries,-5.00,,\n',
                       filename='chase_2025.csv')
        assert resp.json['rows'][0]['account_name'] == 'chase_2025'

    def test_file_name_account_created_by_an_earlier_import_is_reused(self, client, auth_headers, user):
        existing = AccountModel(user_id=user.id, acct_id_str='chase_2025', acct_name='chase_2025')
        _db.session.add(existing)
        _db.session.commit()
        resp = preview(client, auth_headers, NO_ACCOUNT_COLUMN, filename='chase_2025.csv')
        row = resp.json['rows'][0]
        assert (row['account_id'], row['new_account']) == (existing.id, False)

    def test_long_account_names_are_cut_to_the_column_limit(self, client, auth_headers):
        resp = preview(client, auth_headers, HEADER + f'2025-01-15,Grocer,Groceries,-5.00,{"A" * 120},\n')
        assert resp.json['rows'][0]['account_name'] == 'A' * 100

    def test_put_unmatched_rows_into_an_existing_account(self, client, auth_headers, account, savings):
        resp = preview(client, auth_headers, HEADER
                       + '2025-01-15,Grocer,Groceries,-5.00,Mystery Bank,\n'
                       + '2025-01-16,Grocer,Groceries,-6.00,Test Checking,\n',
                       unmatched='account', target_account_id=str(savings.id))
        assert [(r['account_id'], r['new_account']) for r in resp.json['rows']] == [
            (savings.id, False), (account.id, False),   # matched rows keep their own account
        ]
        assert resp.json['summary']['new_accounts'] == []

    def test_put_rows_of_a_file_without_account_column_into_an_existing_account(self, client, auth_headers, account):
        resp = preview(client, auth_headers, NO_ACCOUNT_COLUMN,
                       unmatched='account', target_account_id=str(account.id))
        row = resp.json['rows'][0]
        assert (row['account_id'], row['account_name']) == (account.id, 'Test Checking')

    def test_skip_leaves_unmatched_rows_out(self, client, auth_headers, account):
        resp = preview(client, auth_headers, HEADER + '2025-01-15,Grocer,Groceries,-5.00,Mystery Bank,\n',
                       unmatched='skip')
        row = resp.json['rows'][0]
        assert (row['account_id'], row['account_name'], row['new_account']) == (None, 'Mystery Bank', False)
        assert (resp.json['summary']['importable'], resp.json['summary']['unmatched']) == (0, 1)

    @pytest.mark.parametrize('form, message', [
        ({'unmatched': 'guess'},                              'Unknown option for unmatched accounts: guess'),
        ({'unmatched': 'account'},                            'Choose one of your accounts for the unmatched rows'),
        ({'unmatched': 'account', 'target_account_id': '0'},  'Choose one of your accounts for the unmatched rows'),
    ])
    def test_invalid_options_are_rejected(self, client, auth_headers, account, form, message):
        resp = preview(client, auth_headers, NO_ACCOUNT_COLUMN, **form)
        assert resp.status_code == 400
        assert resp.json == {'success': False, 'error': message}

    def test_another_users_account_cannot_be_the_target(self, client, auth_headers, account, other_users_account):
        resp = preview(client, auth_headers, NO_ACCOUNT_COLUMN,
                       unmatched='account', target_account_id=str(other_users_account.id))
        assert resp.status_code == 400

    def test_more_than_25_new_accounts_is_rejected(self, client, auth_headers):
        rows = ''.join(f'2025-01-15,Grocer,Groceries,-5.00,Bank {i},\n' for i in range(26))
        resp = preview(client, auth_headers, HEADER + rows)
        assert resp.status_code == 400
        assert resp.json['error'] == TOO_MANY_ACCOUNTS


# ── Preview: row flags and summary ────────────────────────────────────────────

class TestPreviewFlags:
    def test_duplicate_matches_an_existing_transaction_ignoring_vendor_case(self, client, auth_headers, account):
        account_svc.add_transaction(account.id, date(2025, 1, 15), 'Grocer', 'Groceries', -42.10)
        resp = preview(client, auth_headers, HEADER
                       + '2025-01-15,  GROCER ,Groceries,-42.10,Test Checking,\n'
                       + '2025-01-15,Grocer,Groceries,-42.11,Test Checking,\n')
        assert [r['duplicate'] for r in resp.json['rows']] == [True, False]

    def test_identical_rows_in_one_file_are_not_duplicates_of_each_other(self, client, auth_headers, account):
        resp = preview(client, auth_headers, HEADER
                       + '2025-01-15,Cafe,Dining,-4.50,Test Checking,\n'
                       + '2025-01-15,Cafe,Dining,-4.50,Test Checking,\n')
        assert [r['duplicate'] for r in resp.json['rows']] == [False, False]
        assert resp.json['summary']['importable'] == 2

    def test_zero_amount_is_flagged(self, client, auth_headers, account):
        resp = preview(client, auth_headers, HEADER + '2025-01-15,Grocer,Groceries,0,Test Checking,\n')
        row = resp.json['rows'][0]
        assert (row['zero_amount'], row['invalid_amount'], row['duplicate']) == (True, False, False)

    @pytest.mark.parametrize('raw, shown', [('', ''), ('abc', 'abc'), (' 12.34.56 ', '12.34.56')])
    def test_unreadable_amount_is_flagged(self, client, auth_headers, account, raw, shown):
        resp = preview(client, auth_headers, HEADER + f'2025-01-15,Grocer,Groceries,{raw},Test Checking,\n')
        row = resp.json['rows'][0]
        assert row['invalid_amount'] is True
        assert row['amount'] == shown            # the original text, so the user can see what was wrong
        assert (row['zero_amount'], row['duplicate']) == (False, False)
        assert resp.json['summary']['importable'] == 0

    def test_transfer_and_payment_categories_are_preflagged(self, client, auth_headers, account):
        resp = preview(client, auth_headers, HEADER
                       + '2025-01-15,Bank,Transfer,-100.00,Test Checking,\n'
                       + '2025-01-15,Card,  payment ,-50.00,Test Checking,\n'
                       + '2025-01-15,Grocer,Groceries,-5.00,Test Checking,\n')
        assert [r['is_transfer'] for r in resp.json['rows']] == [True, True, False]

    def test_summary_counts(self, client, auth_headers, account):
        account_svc.add_transaction(account.id, date(2025, 1, 15), 'Grocer', 'Groceries', -42.10)
        resp = preview(client, auth_headers, HEADER
                       + '2025-01-16,Cafe,Dining,-4.50,Test Checking,\n'         # importable
                       + '2025-01-15,Grocer,Groceries,-42.10,Test Checking,\n'   # duplicate
                       + '2025-01-16,Cafe,Dining,-4.50,Mystery Bank,\n'          # unmatched (skipped)
                       + '2025-01-16,Cafe,Dining,0,Test Checking,\n'             # zero amount
                       + '1/16/25,Cafe,Dining,-4.50,Test Checking,\n'            # invalid date
                       + '2025-01-16,Cafe,Dining,abc,Test Checking,\n',          # invalid amount
                       unmatched='skip')
        assert resp.json['summary'] == {'total': 6, 'importable': 1, 'duplicates': 1, 'unmatched': 1,
                                        'zero_amount': 1, 'invalid_date': 1, 'invalid_amount': 1,
                                        'recurring_matches': 0, 'new_accounts': []}

    def test_preview_writes_nothing(self, client, auth_headers, account):
        preview(client, auth_headers, HEADER + '2025-01-15,Grocer,Groceries,-5.00,Test Checking,\n')
        assert transactions_in(account.id) == []


# ── Preview: rows matching a recurring series ─────────────────────────────────

def series_row(rec, day, amount=None, vendor=None, notes=''):
    """A transaction in rec's series, as generation or a link leaves it."""
    return account_svc.add_transaction(rec.account_id, day, vendor or rec.vendor, rec.category,
                                       rec.amount if amount is None else amount, notes=notes,
                                       recurring_id=rec.id)


@pytest.fixture
def anthropic(account):
    """A monthly Anthropic template (-$20) on Test Checking, with no transactions yet."""
    return recurring_svc.add_recurring(account.id, date(2026, 10, 2), 'Anthropic', 'Subscriptions', -20.0,
                                       next_date=date(2026, 11, 2), frequency=1, frequency_unit='months')


def recurring_match(tx, similar_vendor=False, different_amount=False):
    """The recurring_match of a preview row that would replace the series transaction tx."""
    return {'transaction_id': tx.id, 'recurring_id': tx.recurring_id, 'vendor': 'Anthropic',
            'date': tx.date.isoformat(), 'amount': tx.amount,
            'similar_vendor': similar_vendor, 'different_amount': different_amount}


def matches(resp):
    return [r['recurring_match'] for r in resp.json['rows']]


class TestPreviewRecurringMatches:
    def test_a_row_near_a_series_transaction_matches_it(self, client, auth_headers, anthropic):
        expected = recurring_match(series_row(anthropic, date(2026, 10, 2)))
        resp = preview(client, auth_headers, HEADER + '2026-10-03, anthropic ,Software,-20.00,Test Checking,\n')
        row = resp.json['rows'][0]
        assert row['recurring_match'] == expected
        assert row['duplicate'] is False
        assert resp.json['summary']['recurring_matches'] == 1
        assert resp.json['summary']['importable'] == 1

    def test_a_similar_name_and_a_different_amount_are_reported(self, client, auth_headers, anthropic):
        expected = recurring_match(series_row(anthropic, date(2026, 10, 2)), similar_vendor=True, different_amount=True)
        resp = preview(client, auth_headers, HEADER + '2026-10-04,ANTHROPIC.COM CA,Software,-21.60,Test Checking,\n')
        assert matches(resp) == [expected]

    def test_the_series_transactions_own_vendor_counts_as_exact(self, client, auth_headers, anthropic):
        linked = series_row(anthropic, date(2026, 10, 2), vendor='Anthropic PBC')   # linked with its bank spelling
        resp = preview(client, auth_headers, HEADER + '2026-10-03,ANTHROPIC PBC,Software,-20.00,Test Checking,\n')
        assert matches(resp) == [recurring_match(linked)]

    @pytest.mark.parametrize('row', [
        '2026-10-06,Anthropic,Software,-20.00,Test Checking,',
        '2026-09-28,Anthropic,Software,-20.00,Test Checking,',
        '2026-10-03,Anthropic,Software,20.00,Test Checking,',
        '2026-10-03,Anthropic,Software,-30.01,Test Checking,',
        '2026-10-03,Target,Software,-20.00,Test Checking,',
        '2026-10-03,Anthropic,Software,-20.00,Test Savings,',
        '2026-10-03,Anthropic,Software,0,Test Checking,',
        '2026-10-03,Anthropic,Software,-20.00,Mystery Bank,',
    ], ids=['4-days-late', '4-days-early', 'refund', 'over-50-percent', 'other-vendor', 'other-account',
            'zero-amount', 'new-account'])
    def test_no_match(self, client, auth_headers, anthropic, savings, row):
        series_row(anthropic, date(2026, 10, 2))
        resp = preview(client, auth_headers, HEADER + row + '\n')
        assert matches(resp) == [None]
        assert resp.json['summary']['recurring_matches'] == 0

    def test_transactions_outside_a_series_are_not_matched(self, client, auth_headers, account):
        account_svc.add_transaction(account.id, date(2026, 10, 2), 'Anthropic', 'Subscriptions', -20.0)
        resp = preview(client, auth_headers, HEADER + '2026-10-03,Anthropic,Software,-20.00,Test Checking,\n')
        assert matches(resp) == [None]

    def test_an_exact_duplicate_keeps_its_series_transaction(self, client, auth_headers, anthropic):
        series_row(anthropic, date(2026, 10, 2))
        resp = preview(client, auth_headers, HEADER
                       + '2026-10-02,Anthropic,Software,-20.00,Test Checking,\n'    # the same charge
                       + '2026-10-04,Anthropic,Software,-20.00,Test Checking,\n')   # a second one
        assert [r['duplicate'] for r in resp.json['rows']] == [True, False]
        assert matches(resp) == [None, None]

    def test_only_the_nearest_row_replaces_a_series_transaction(self, client, auth_headers, anthropic):
        expected = recurring_match(series_row(anthropic, date(2026, 10, 2)))
        resp = preview(client, auth_headers, HEADER
                       + '2026-10-04,Anthropic,Software,-20.00,Test Checking,\n'
                       + '2026-10-03,Anthropic,Software,-20.00,Test Checking,\n')
        assert matches(resp) == [None, expected]

    def test_an_exact_name_and_amount_beat_a_nearer_similar_name(self, client, auth_headers, anthropic):
        expected = recurring_match(series_row(anthropic, date(2026, 10, 2)))
        resp = preview(client, auth_headers, HEADER
                       + '2026-10-03,SQ *ANTHROPIC,Software,-20.00,Test Checking,\n'
                       + '2026-10-05,Anthropic,Software,-20.00,Test Checking,\n')
        assert matches(resp) == [None, expected]

    @pytest.mark.parametrize('farther', ['-20.00', '-21.00'], ids=['exact-amount', 'closer-amount'])
    def test_a_closer_amount_beats_a_nearer_date(self, client, auth_headers, anthropic, farther):
        expected = recurring_match(series_row(anthropic, date(2026, 10, 2)), different_amount=farther != '-20.00')
        resp = preview(client, auth_headers, HEADER
                       + '2026-10-03,Anthropic,Software,-25.00,Test Checking,\n'
                       + f'2026-10-05,Anthropic,Software,{farther},Test Checking,\n')
        assert matches(resp) == [None, expected]

    def test_each_row_and_each_series_transaction_is_claimed_once(self, client, auth_headers, anthropic):
        first = recurring_match(series_row(anthropic, date(2026, 10, 1)))
        second = recurring_match(series_row(anthropic, date(2026, 10, 5)))
        resp = preview(client, auth_headers, HEADER
                       + '2026-10-03,Anthropic,Software,-20.00,Test Checking,\n'
                       + '2026-10-04,Anthropic,Software,-20.00,Test Checking,\n')
        assert matches(resp) == [first, second]


# ── Preview: rejected uploads ─────────────────────────────────────────────────

class TestPreviewErrors:
    def test_requires_login(self, client):
        resp = preview(client, {}, HEADER)
        assert resp.status_code == 401

    def test_no_file(self, client, auth_headers):
        resp = client.post('/api/import/preview', data={}, headers=auth_headers,
                           content_type='multipart/form-data')
        assert resp.status_code == 400
        assert resp.json['error'] == 'No file provided'

    def test_empty_filename(self, client, auth_headers):
        resp = preview(client, auth_headers, b'', filename='')
        assert resp.status_code == 400
        assert resp.json['error'] == 'No file selected'

    @pytest.mark.parametrize('content, message', [
        ('vendor,category,amount\nGrocer,Groceries,-5\n',
         "File is missing required column: 'date'"),
        ('date,vendor,category\n2025-01-15,Grocer,Groceries\n',
         "File must have 'expense'/'withdrawal' + 'income'/'deposit', or a single 'amount' column"),
        ('date,category,amount\n2025-01-15,Groceries,-5\n',
         "File is missing required columns: ['vendor']"),
        ('date,vendor,amount\n2025-01-15,Grocer,-5\n',
         "File is missing required columns: ['category']"),
        (b'date,vendor,category,amount\n' + b'x' * (10 * 1024 * 1024),
         'File exceeds the 10 MB size limit'),
        ('date,vendor,category,amount\n' + '2025-01-15,Grocer,Groceries,-1\n' * 10_001,
         'File has 10,001 rows; the limit is 10,000 per import'),
    ], ids=['no-date-column', 'no-amount-columns', 'no-vendor-column', 'no-category-column',
            'over-10-mb', 'over-10000-rows'])
    def test_invalid_files_are_rejected_with_a_reason(self, client, auth_headers, content, message):
        resp = preview(client, auth_headers, content)
        assert resp.status_code == 400
        assert resp.json == {'success': False, 'error': message}

    def test_unreadable_spreadsheet_is_rejected(self, client, auth_headers):
        resp = preview(client, auth_headers, b'not really a spreadsheet', filename='bank.xlsx',
                       content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        assert resp.status_code == 400
        assert resp.json['error'].startswith('Could not parse file: ')


# ── Confirm ───────────────────────────────────────────────────────────────────

class TestConfirm:
    def test_requires_login(self, client):
        resp = confirm(client, {}, [])
        assert resp.status_code == 401

    def test_imports_rows_and_reports_counts(self, client, auth_headers, account):
        resp = confirm(client, auth_headers, [
            confirm_row(account.id, notes='weekly shop'),
            confirm_row(account.id, date='2025-01-16', vendor='Employer', category='Income', amount=100.0),
        ])
        assert resp.status_code == 200
        assert resp.json == {'success': True, 'imported': 2, 'replaced': 0, 'skipped': 0, 'linked': 0,
                             'created_accounts': [],
                             'message': 'Imported 2 transactions, skipped 0 duplicates/invalid'}
        saved = transactions_in(account.id)
        assert [(t.date, t.vendor, t.category, t.amount_cents, t.notes) for t in saved] == [
            (date(2025, 1, 15), 'Grocer', 'Groceries', -4210, 'weekly shop'),
            (date(2025, 1, 16), 'Employer', 'Income', 10000, ''),
        ]

    def test_updates_the_account_balance(self, client, auth_headers, account):
        confirm(client, auth_headers, [confirm_row(account.id, amount=-42.10),
                                       confirm_row(account.id, vendor='Employer', amount=100.0)])
        assert _db.session.get(AccountModel, account.id).balance_cents == 5790

    def test_the_balance_keeps_the_starting_balance(self, client, auth_headers, account):
        account_svc.update_account(account.id, {'opening_balance': 1000})
        confirm(client, auth_headers, [confirm_row(account.id, amount=-42.10)])
        assert _db.session.get(AccountModel, account.id).balance_cents == 100000 - 4210

    def test_skips_rows_for_accounts_the_user_does_not_own(self, client, auth_headers, account,
                                                           other_users_account):
        resp = confirm(client, auth_headers, [confirm_row(other_users_account.id)])
        assert (resp.json['imported'], resp.json['skipped']) == (0, 1)
        assert transactions_in(other_users_account.id) == []

    def test_skips_rows_without_an_account(self, client, auth_headers, account):
        resp = confirm(client, auth_headers, [confirm_row(None)])
        assert (resp.json['imported'], resp.json['skipped']) == (0, 1)

    @pytest.mark.parametrize('overrides', [
        {'date': 'not-a-date'}, {'amount': 'abc'}, {'amount': 'NaN'}, {'amount': 'inf'}, {'vendor': None},
    ])
    def test_skips_malformed_rows(self, client, auth_headers, account, overrides):
        row = confirm_row(account.id, **overrides)
        if overrides.get('vendor', '') is None:
            del row['vendor']
        resp = confirm(client, auth_headers, [row])
        assert (resp.json['imported'], resp.json['skipped']) == (0, 1)
        assert transactions_in(account.id) == []

    def test_skips_zero_amounts(self, client, auth_headers, account):
        resp = confirm(client, auth_headers, [confirm_row(account.id, amount=0)])
        assert (resp.json['imported'], resp.json['skipped']) == (0, 1)

    def test_skips_rows_already_in_the_database(self, client, auth_headers, account):
        account_svc.add_transaction(account.id, date(2025, 1, 15), 'Grocer', 'Groceries', -42.10)
        resp = confirm(client, auth_headers, [confirm_row(account.id, vendor='GROCER')])
        assert (resp.json['imported'], resp.json['skipped']) == (0, 1)
        assert len(transactions_in(account.id)) == 1

    def test_identical_rows_in_one_batch_are_all_imported(self, client, auth_headers, account):
        # Two same-day $4.50 coffees at the same shop are two real purchases
        coffee = confirm_row(account.id, vendor='Cafe', category='Dining', amount=-4.50)
        resp = confirm(client, auth_headers, [coffee, dict(coffee)])
        assert (resp.json['imported'], resp.json['skipped']) == (2, 0)
        assert len(transactions_in(account.id)) == 2
        assert _db.session.get(AccountModel, account.id).balance_cents == -900

    def test_identical_batch_rows_are_skipped_when_already_in_the_database(self, client, auth_headers, account):
        account_svc.add_transaction(account.id, date(2025, 1, 15), 'Grocer', 'Groceries', -42.10)
        resp = confirm(client, auth_headers, [confirm_row(account.id), confirm_row(account.id)])
        assert (resp.json['imported'], resp.json['skipped']) == (0, 2)

    @pytest.mark.parametrize('body, message', [
        ({},                       "'transactions' array required"),
        ({'transactions': 'rows'}, "'transactions' array required"),
        ({'transactions': []},     'No transactions provided'),
    ])
    def test_rejects_a_missing_or_empty_transaction_list(self, client, auth_headers, body, message):
        resp = client.post('/api/import/confirm', json=body, headers=auth_headers)
        assert resp.status_code == 400
        assert resp.json == {'success': False, 'error': message}

    def test_rejects_a_non_json_body(self, client, auth_headers):
        resp = client.post('/api/import/confirm', data='rows', content_type='text/plain', headers=auth_headers)
        assert resp.status_code == 400
        assert resp.json == {'success': False, 'error': "'transactions' array required"}


# ── Confirm: creating accounts ────────────────────────────────────────────────

def new_account_row(name, **overrides):
    """A preview row whose account doesn't exist yet and will be created on confirm."""
    return confirm_row(None, account_name=name, new_account=True, **overrides)


class TestConfirmNewAccounts:
    def test_creates_the_account_flagged_and_imports_its_rows(self, client, auth_headers, user):
        resp = confirm(client, auth_headers, [
            new_account_row('Mystery Bank'),
            new_account_row(' mystery bank ', vendor='Cafe', amount=-4.50),
        ])
        assert resp.status_code == 200
        assert (resp.json['imported'], resp.json['skipped'], resp.json['created_accounts']) == (2, 0, ['Mystery Bank'])
        assert resp.json['message'] == 'Imported 2 transactions, skipped 0 duplicates/invalid, created 1 new account'

        [created] = AccountModel.query.filter_by(user_id=user.id).all()
        assert (created.acct_name, created.acct_id_str, created.needs_attention) == ('Mystery Bank', 'Mystery Bank', True)
        assert len(transactions_in(created.id)) == 2
        assert created.balance_cents == -4660

    def test_reuses_an_account_that_matches_by_now(self, client, auth_headers, account):
        # e.g. the user created the account by hand between preview and confirm
        resp = confirm(client, auth_headers, [new_account_row('test checking')])
        assert (resp.json['imported'], resp.json['created_accounts']) == (1, [])
        assert len(transactions_in(account.id)) == 1
        assert _db.session.get(AccountModel, account.id).needs_attention is False

    def test_no_account_is_created_when_none_of_its_rows_are_accepted(self, client, auth_headers, user):
        resp = confirm(client, auth_headers, [new_account_row('Mystery Bank', date='not-a-date')])
        assert (resp.json['imported'], resp.json['skipped'], resp.json['created_accounts']) == (0, 1, [])
        assert AccountModel.query.filter_by(user_id=user.id).count() == 0

    @pytest.mark.parametrize('name', ['', '   ', None, 123])
    def test_rows_without_a_usable_account_name_are_skipped(self, client, auth_headers, user, name):
        resp = confirm(client, auth_headers, [new_account_row(name)])
        assert (resp.json['imported'], resp.json['skipped']) == (0, 1)
        assert AccountModel.query.filter_by(user_id=user.id).count() == 0

    def test_more_than_25_new_accounts_is_rejected_and_nothing_is_written(self, client, auth_headers, user):
        resp = confirm(client, auth_headers, [new_account_row(f'Bank {i}') for i in range(26)])
        assert resp.status_code == 400
        assert resp.json == {'success': False, 'error': TOO_MANY_ACCOUNTS}
        assert AccountModel.query.filter_by(user_id=user.id).count() == 0
        assert TransactionModel.query.count() == 0

    def test_entries_that_are_not_objects_are_skipped(self, client, auth_headers, account):
        resp = confirm(client, auth_headers, ['not a row', confirm_row(account.id)])
        assert (resp.json['imported'], resp.json['skipped']) == (1, 1)


# ── Confirm: transfer linking ─────────────────────────────────────────────────

class TestConfirmTransfers:
    def test_links_a_transfer_pair_imported_together(self, client, auth_headers, account, savings):
        resp = confirm(client, auth_headers, [
            confirm_row(account.id, vendor='To savings', category='Transfer', amount=-100.0, is_transfer=True),
            confirm_row(savings.id, date='2025-01-16', vendor='From checking', category='Transfer',
                        amount=100.0, is_transfer=True),
        ])
        assert resp.json['linked'] == 1
        [out], [into] = transactions_in(account.id), transactions_in(savings.id)
        assert (out.transfer_peer_id, into.transfer_peer_id) == (into.id, out.id)

    def test_links_to_an_existing_unlinked_transfer(self, client, auth_headers, account, savings):
        existing = account_svc.add_transaction(savings.id, date(2025, 1, 15), 'From checking',
                                               'Transfer', 100.0, is_transfer=True)
        resp = confirm(client, auth_headers, [
            confirm_row(account.id, date='2025-01-18', vendor='To savings', category='Transfer',
                        amount=-100.0, is_transfer=True),
        ])
        assert resp.json['linked'] == 1
        assert transactions_in(account.id)[0].transfer_peer_id == existing.id

    def test_does_not_link_more_than_five_days_apart(self, client, auth_headers, account, savings):
        account_svc.add_transaction(savings.id, date(2025, 1, 1), 'From checking', 'Transfer', 100.0,
                                    is_transfer=True)
        resp = confirm(client, auth_headers, [
            confirm_row(account.id, date='2025-01-10', vendor='To savings', category='Transfer',
                        amount=-100.0, is_transfer=True),
        ])
        assert resp.json['linked'] == 0

    def test_does_not_link_rows_not_marked_as_transfers(self, client, auth_headers, account, savings):
        resp = confirm(client, auth_headers, [
            confirm_row(account.id, amount=-100.0),
            confirm_row(savings.id, vendor='Refund', amount=100.0),
        ])
        assert resp.json['linked'] == 0


# ── Confirm: replacing recurring series transactions ──────────────────────────

def replacement(tx, **overrides):
    """A confirm row replacing the series transaction tx, as the preview matched it (Oct 3, exact)."""
    row = confirm_row(tx.account_id, date='2026-10-03', vendor='Anthropic', category='Software',
                      amount=-20.0, replaces_transaction_id=tx.id)
    row.update(overrides)
    return row


def aliases(recurring_id):
    return sorted(a.alias for a in RecurringAliasModel.query.filter_by(recurring_id=recurring_id))


def counts(resp):
    return resp.json['imported'], resp.json['replaced'], resp.json['skipped']


class TestConfirmRecurringReplacements:
    def test_the_series_transaction_takes_the_banks_date_and_amount(self, client, auth_headers, anthropic):
        tx_id = series_row(anthropic, date(2026, 10, 2)).id
        resp = confirm(client, auth_headers, [replacement(_db.session.get(TransactionModel, tx_id),
                                                          amount=-21.60, notes='Pro plan')])
        assert resp.status_code == 200
        assert resp.json == {'success': True, 'imported': 0, 'replaced': 1, 'skipped': 0, 'linked': 0,
                             'created_accounts': [],
                             'message': 'Imported 0 transactions, replaced 1 recurring transaction, '
                                        'skipped 0 duplicates/invalid'}
        # Same row: the series keeps its vendor and category, the bank's date and amount win
        assert [(t.id, t.date, t.vendor, t.category, t.amount_cents, t.notes, t.recurring_id)
                for t in transactions_in(anthropic.account_id)] == [
            (tx_id, date(2026, 10, 3), 'Anthropic', 'Subscriptions', -2160, 'Pro plan', anthropic.id)]
        assert _db.session.get(AccountModel, anthropic.account_id).balance_cents == -2160
        assert _db.session.get(RecurringModel, anthropic.id).amount_cents == -2000   # only this occurrence

    def test_the_old_notes_stay_when_the_file_row_has_none(self, client, auth_headers, anthropic):
        tx = series_row(anthropic, date(2026, 10, 2), notes='Pro plan')
        resp = confirm(client, auth_headers, [replacement(tx, notes='')])
        assert counts(resp) == (0, 1, 0)
        assert _db.session.get(TransactionModel, tx.id).notes == 'Pro plan'

    def test_occurrences_renumber_by_date(self, client, auth_headers, anthropic):
        first, extra = series_row(anthropic, date(2026, 10, 2)), series_row(anthropic, date(2026, 10, 4))
        first_id, extra_id = first.id, extra.id
        confirm(client, auth_headers, [replacement(first, date='2026-10-05')])
        assert _db.session.get(TransactionModel, extra_id).recurring_index == 1
        assert _db.session.get(TransactionModel, first_id).recurring_index == 2

    def test_an_earlier_bank_date_moves_the_series_start_back(self, client, auth_headers, anthropic):
        tx = series_row(anthropic, date(2026, 10, 2))
        confirm(client, auth_headers, [replacement(tx, date='2026-09-30')])
        assert _db.session.get(RecurringModel, anthropic.id).start_date == date(2026, 9, 30)

    def test_a_transfer_peer_follows(self, client, auth_headers, account, savings):
        rec = recurring_svc.add_recurring(account.id, date(2026, 10, 1), 'Savings plan', 'Transfer', -100.0,
                                          next_date=date(2026, 11, 1), frequency=1, frequency_unit='months')
        out = account_svc.add_transaction(account.id, date(2026, 10, 1), 'Savings plan', 'Transfer', -100.0,
                                          recurring_id=rec.id, is_transfer=True)
        into = account_svc.add_transaction(savings.id, date(2026, 10, 1), 'From checking', 'Transfer', 100.0,
                                           is_transfer=True)
        account_svc.link_transfer(out.id, into.id)
        out_id, into_id = out.id, into.id
        resp = confirm(client, auth_headers, [confirm_row(
            account.id, date='2026-10-02', vendor='Savings plan', category='Transfer', amount=-120.0,
            notes='Raised', is_transfer=True, replaces_transaction_id=out_id)])
        assert counts(resp) == (0, 1, 0)
        peer = _db.session.get(TransactionModel, into_id)
        assert (peer.date, peer.amount_cents, peer.notes, peer.transfer_peer_id) == (date(2026, 10, 2), 12000,
                                                                                    'Raised', out_id)
        assert _db.session.get(AccountModel, account.id).balance_cents == -12000
        assert _db.session.get(AccountModel, savings.id).balance_cents == 12000

    def test_a_confirmed_similar_name_is_remembered_for_the_series(self, client, auth_headers, anthropic):
        tx = series_row(anthropic, date(2026, 10, 2))
        tx_id = tx.id
        confirm(client, auth_headers, [replacement(tx, vendor='ANTHROPIC.COM CA')])
        assert aliases(anthropic.id) == ['anthropic com ca']
        assert _db.session.get(TransactionModel, tx_id).vendor == 'Anthropic'   # the series keeps its name

        series_row(anthropic, date(2026, 11, 2))
        same = preview(client, auth_headers, HEADER + '2026-11-03,Anthropic.com  CA,Software,-20.00,Test Checking,\n')
        other = preview(client, auth_headers, HEADER + '2026-11-03,ANTHROPIC PBC,Software,-20.00,Test Checking,\n')
        assert same.json['rows'][0]['recurring_match']['similar_vendor'] is False   # now exact
        assert other.json['rows'][0]['recurring_match']['similar_vendor'] is True   # another spelling

    def test_an_exact_name_saves_no_alias(self, client, auth_headers, anthropic):
        resp = confirm(client, auth_headers, [replacement(series_row(anthropic, date(2026, 10, 2)))])
        assert counts(resp) == (0, 1, 0)
        assert aliases(anthropic.id) == []

    def test_an_alias_is_saved_once(self, client, auth_headers, anthropic):
        october, november = series_row(anthropic, date(2026, 10, 2)), series_row(anthropic, date(2026, 11, 2))
        resp = confirm(client, auth_headers, [replacement(october, vendor='ANTHROPIC.COM CA'),
                                              replacement(november, vendor='ANTHROPIC.COM CA', date='2026-11-03')])
        assert counts(resp) == (0, 2, 0)
        assert aliases(anthropic.id) == ['anthropic com ca']

    def test_deleting_the_template_deletes_its_aliases(self, client, auth_headers, anthropic):
        confirm(client, auth_headers, [replacement(series_row(anthropic, date(2026, 10, 2)), vendor='ANTHROPIC.COM CA')])
        assert aliases(anthropic.id) == ['anthropic com ca']
        recurring_svc.delete_recurring(anthropic.id)
        assert RecurringAliasModel.query.count() == 0

    @pytest.mark.parametrize('overrides', [
        {'replaces_transaction_id': 99999},
        {'replaces_transaction_id': 'abc'},
        {'replaces_transaction_id': True},
        {'date': '2026-10-06'},
        {'amount': -30.01},
        {'amount': 20.0},
        {'vendor': 'Target'},
        {'account_id': None, 'account_name': 'New Bank', 'new_account': True},
    ], ids=['unknown-id', 'text-id', 'boolean-id', '4-days-away', 'over-50-percent', 'refund', 'other-vendor',
            'new-account'])
    def test_a_replacement_that_does_not_check_out_is_skipped(self, client, auth_headers, anthropic, overrides):
        tx_id = series_row(anthropic, date(2026, 10, 2)).id
        resp = confirm(client, auth_headers, [replacement(_db.session.get(TransactionModel, tx_id), **overrides)])
        assert counts(resp) == (0, 0, 1)
        assert [(t.id, t.date, t.amount_cents) for t in TransactionModel.query.all()] == [
            (tx_id, date(2026, 10, 2), -2000)]
        assert AccountModel.query.count() == 1

    def test_a_transaction_outside_a_series_cannot_be_replaced(self, client, auth_headers, account):
        tx = account_svc.add_transaction(account.id, date(2026, 10, 2), 'Anthropic', 'Subscriptions', -20.0)
        resp = confirm(client, auth_headers, [replacement(tx)])
        assert counts(resp) == (0, 0, 1)
        assert len(transactions_in(account.id)) == 1

    def test_another_users_series_transaction_cannot_be_replaced(self, client, auth_headers, account,
                                                                  other_users_account):
        rec = recurring_svc.add_recurring(other_users_account.id, date(2026, 10, 2), 'Anthropic', 'Subscriptions',
                                          -20.0, next_date=date(2026, 11, 2), frequency=1, frequency_unit='months')
        theirs = series_row(rec, date(2026, 10, 2))
        theirs_id = theirs.id
        resp = confirm(client, auth_headers, [replacement(theirs, account_id=account.id)])
        assert counts(resp) == (0, 0, 1)
        assert _db.session.get(TransactionModel, theirs_id).date == date(2026, 10, 2)
        assert transactions_in(account.id) == []

    def test_a_series_transaction_is_replaced_once_per_import(self, client, auth_headers, anthropic):
        tx = series_row(anthropic, date(2026, 10, 2))
        resp = confirm(client, auth_headers, [replacement(tx), replacement(tx, date='2026-10-04')])
        assert counts(resp) == (0, 1, 1)
        assert len(transactions_in(anthropic.account_id)) == 1
