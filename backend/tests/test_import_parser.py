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


class TestNormalizeDataframe:
    def test_keeps_the_original_date_text_for_rows_it_cannot_read(self):
        raw = pd.DataFrame({'date': ['2025-01-15', ' 1/5/25 ', None], 'vendor': ['A', 'B', 'C'],
                            'category': ['X', 'X', 'X'], 'amount': ['-1', '-2', '-3']})
        df = import_parser.normalize_dataframe(raw)
        assert list(df['date']) == [date(2025, 1, 15), None, None]
        assert list(df['date_raw']) == ['2025-01-15', '1/5/25', '']
