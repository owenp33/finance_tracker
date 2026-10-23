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
from models.transaction import TransactionModel
from models.user import User
from services.account_service import AccountService

account_svc = AccountService()

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
        assert resp.json['rows'][0]['date'] == '2025-01-15'

    def test_unparseable_date_falls_back_to_today(self, client, auth_headers, account):
        resp = preview(client, auth_headers, HEADER + '1/5/25,Grocer,Groceries,-5.00,Test Checking,\n')
        assert resp.json['rows'][0]['date'] == date.today().isoformat()

    def test_parenthesized_amount_reads_as_zero(self, client, auth_headers, account):
        resp = preview(client, auth_headers, HEADER + '2025-01-15,Grocer,Groceries,(12.34),Test Checking,\n')
        row = resp.json['rows'][0]
        assert row['amount'] == 0.0
        assert row['zero_amount'] is True

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

    def test_unmatched_account_names_are_listed(self, client, auth_headers, account):
        resp = preview(client, auth_headers, HEADER + '2025-01-15,Grocer,Groceries,-5.00,Mystery Bank,\n')
        row = resp.json['rows'][0]
        assert (row['account_id'], row['account_name']) == (None, 'Mystery Bank')
        assert resp.json['unmatched_account_names'] == ['Mystery Bank']

    def test_other_users_accounts_are_not_matched(self, client, auth_headers, account, other_users_account):
        resp = preview(client, auth_headers, HEADER + '2025-01-15,Grocer,Groceries,-5.00,Other Checking,\n')
        assert resp.json['rows'][0]['account_id'] is None

    def test_fallback_account_is_used_without_an_account_column(self, client, auth_headers, account):
        resp = preview(client, auth_headers, 'date,vendor,category,amount\n2025-01-15,Grocer,Groceries,-5.00\n',
                       account_id=str(account.id))
        row = resp.json['rows'][0]
        assert (row['account_id'], row['account_name']) == (account.id, 'Test Checking')

    def test_without_account_column_or_fallback_rows_are_unmatched(self, client, auth_headers, account):
        resp = preview(client, auth_headers, 'date,vendor,category,amount\n2025-01-15,Grocer,Groceries,-5.00\n')
        row = resp.json['rows'][0]
        assert (row['account_id'], row['account_name']) == (None, None)
        assert resp.json['unmatched_account_names'] == []


# ── Preview: row flags and summary ────────────────────────────────────────────

class TestPreviewFlags:
    def test_duplicate_matches_an_existing_transaction_ignoring_vendor_case(self, client, auth_headers, account):
        account_svc.add_transaction(account.id, date(2025, 1, 15), 'Grocer', 'Groceries', -42.10)
        resp = preview(client, auth_headers, HEADER
                       + '2025-01-15,  GROCER ,Groceries,-42.10,Test Checking,\n'
                       + '2025-01-15,Grocer,Groceries,-42.11,Test Checking,\n')
        assert [r['duplicate'] for r in resp.json['rows']] == [True, False]

    def test_zero_and_blank_amounts_are_flagged(self, client, auth_headers, account):
        resp = preview(client, auth_headers, HEADER
                       + '2025-01-15,Grocer,Groceries,0,Test Checking,\n'
                       + '2025-01-15,Grocer,Groceries,,Test Checking,\n')
        for row in resp.json['rows']:
            assert (row['zero_amount'], row['duplicate']) == (True, False)

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
                       + '2025-01-16,Cafe,Dining,-4.50,Mystery Bank,\n'          # unmatched
                       + '2025-01-16,Cafe,Dining,0,Test Checking,\n')            # zero amount
        assert resp.json['summary'] == {'total': 4, 'importable': 1, 'duplicates': 1,
                                        'unmatched': 1, 'zero_amount': 1}

    def test_preview_writes_nothing(self, client, auth_headers, account):
        preview(client, auth_headers, HEADER + '2025-01-15,Grocer,Groceries,-5.00,Test Checking,\n')
        assert transactions_in(account.id) == []


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
        assert resp.json == {'success': True, 'imported': 2, 'skipped': 0, 'linked': 0,
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

    def test_skips_rows_for_accounts_the_user_does_not_own(self, client, auth_headers, account,
                                                           other_users_account):
        resp = confirm(client, auth_headers, [confirm_row(other_users_account.id)])
        assert (resp.json['imported'], resp.json['skipped']) == (0, 1)
        assert transactions_in(other_users_account.id) == []

    def test_skips_rows_without_an_account(self, client, auth_headers, account):
        resp = confirm(client, auth_headers, [confirm_row(None)])
        assert (resp.json['imported'], resp.json['skipped']) == (0, 1)

    @pytest.mark.parametrize('overrides', [{'date': 'not-a-date'}, {'amount': 'abc'}, {'vendor': None}])
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

    def test_second_identical_row_in_one_batch_is_skipped(self, client, auth_headers, account):
        resp = confirm(client, auth_headers, [confirm_row(account.id), confirm_row(account.id)])
        assert (resp.json['imported'], resp.json['skipped']) == (1, 1)
        assert len(transactions_in(account.id)) == 1

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
