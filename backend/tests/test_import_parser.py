"""
Import parser tests: the pure parsing functions in services/import_parser.py,
called directly (no HTTP, no database).
"""
from datetime import date, datetime

import pandas as pd
import pytest

from services import import_parser


class TestParseDate:
    @pytest.mark.parametrize('value', [
        '01/15/2025', '2025-01-15', '01-15-2025', '2025-01-15 08:30:00', ' 2025-01-15 ',
        '45672', 45672, pd.Timestamp('2025-01-15'), datetime(2025, 1, 15, 9, 30), date(2025, 1, 15),
    ])
    def test_recognized_values(self, value):
        assert import_parser.parse_date(value) == date(2025, 1, 15)

    @pytest.mark.parametrize('value', ['', '   ', None, float('nan'), pd.NaT, '1/5/25', 'Jan 5, 2025', '2025-13-45'])
    def test_blank_or_unrecognized_values_return_none(self, value):
        assert import_parser.parse_date(value) is None


class TestCleanCurrency:
    @pytest.mark.parametrize('value, expected', [
        ('12.34', 12.34), ('-12.34', -12.34), ('$1,234.50', 1234.5), ('-$1,234.50', -1234.5),
        ('(12.34)', -12.34), ('$(12.34)', -12.34), ('($12.34)', -12.34), ('(1,234.50)', -1234.5),
        (' € 5 ', 5.0), ('£3', 3.0), ('0', 0.0), (12.5, 12.5), (7, 7.0),
    ])
    def test_readable_values(self, value, expected):
        assert import_parser.clean_currency(value) == expected

    @pytest.mark.parametrize('value', ['', '   ', None, float('nan'), 'abc', '12.34.56', '()', 'nan', 'inf'])
    def test_blank_or_unreadable_values_return_none(self, value):
        assert import_parser.clean_currency(value) is None


def _amounts(series):
    """Amount column values with missing entries (None or NaN) as None, for comparison."""
    return [None if pd.isna(v) else v for v in series]


class TestNormalizeDataframe:
    def test_keeps_the_original_date_text_for_rows_it_cannot_read(self):
        raw = pd.DataFrame({'date': ['2025-01-15', ' 1/5/25 ', None], 'vendor': ['A', 'B', 'C'],
                            'category': ['X', 'X', 'X'], 'amount': ['-1', '-2', '-3']})
        df = import_parser.normalize_dataframe(raw)
        assert list(df['date']) == [date(2025, 1, 15), None, None]
        assert list(df['date_raw']) == ['2025-01-15', '1/5/25', '']

    def test_single_amount_column_keeps_the_original_text(self):
        raw = pd.DataFrame({'date': ['2025-01-15'] * 3, 'vendor': ['A'] * 3, 'category': ['X'] * 3,
                            'amount': ['(5.00)', ' abc ', None]})
        df = import_parser.normalize_dataframe(raw)
        assert _amounts(df['amount']) == [-5.0, None, None]
        assert list(df['amount_raw']) == ['(5.00)', 'abc', '']

    def test_expense_and_income_columns_combine_into_one_amount(self):
        raw = pd.DataFrame({'date': ['2025-01-15'] * 5, 'vendor': ['A'] * 5, 'category': ['X'] * 5,
                            'expense': ['51.71', None, '10', None, 'abc'],
                            'income':  [None, '3,987.63', '25', None, None]})
        df = import_parser.normalize_dataframe(raw)
        assert _amounts(df['amount']) == [-51.71, 3987.63, 15.0, None, None]
        assert list(df['amount_raw']) == ['51.71', '3,987.63', '10 / 25', '', 'abc']
