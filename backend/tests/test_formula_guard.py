"""
Formula guard tests: CSV text a spreadsheet would run as a formula gets a leading apostrophe on
export, and the importer takes it off again (pure functions, no HTTP or database).
"""
import pytest

from services import formula_guard

FORMULA_LIKE = ['=SUM(A1:A2)', '+1', '-5 fee', '@cmd', '\tx', '\rx', "'=already quoted"]
PLAIN = ['', 'Grocer', "'Til Midnight", ' =x', 'a=b', "'"]


class TestGuard:
    @pytest.mark.parametrize('text', FORMULA_LIKE)
    def test_formula_like_text_gets_an_apostrophe(self, text):
        assert formula_guard.guard(text) == "'" + text

    @pytest.mark.parametrize('text', PLAIN)
    def test_other_text_is_unchanged(self, text):
        assert formula_guard.guard(text) == text


class TestUnguard:
    @pytest.mark.parametrize('text', FORMULA_LIKE + PLAIN)
    def test_undoes_guard_exactly(self, text):
        assert formula_guard.unguard(formula_guard.guard(text)) == text

    def test_only_an_apostrophe_in_front_of_a_formula_is_removed(self):
        assert formula_guard.unguard("'=x") == '=x'
        assert formula_guard.unguard("'Til Midnight") == "'Til Midnight"
        assert formula_guard.unguard('=x') == '=x'
