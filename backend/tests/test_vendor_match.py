"""
vendor_match tests: the pure vendor and amount comparisons behind the import preview's recurring
matches.
"""
import pytest

from services.vendor_match import amount_close, clean_vendor, vendor_key, vendor_match


def test_vendor_key_ignores_case_and_surrounding_spaces():
    assert vendor_key('  Allina Health ') == 'allina health'


@pytest.mark.parametrize('name, cleaned', [
    ('SQ *BLUE BOTTLE 123', 'blue bottle'),
    ("TST* Joe's Diner", 'joes diner'),
    ('PAYPAL *SPOTIFY', 'spotify'),
    ('ANTHROPIC.COM', 'anthropic com'),
    ('  Allina   Health #4521 ', 'allina health'),
    ('SQUARE ONE*', 'square one'),        # a prefix only counts as a whole word before the *
    ('1234', ''),
])
def test_clean_vendor(name, cleaned):
    assert clean_vendor(name) == cleaned


class TestVendorMatch:
    def test_exact_ignores_case_and_surrounding_spaces(self):
        assert vendor_match('  aspire ', ['ASPIRE']) == 'exact'

    def test_exact_against_any_of_the_names(self):
        assert vendor_match('Anthropic PBC', ['Anthropic', 'anthropic pbc']) == 'exact'

    @pytest.mark.parametrize('vendor, name', [
        ('ANTHROPIC.COM SAN FRANCISCO CA', 'Anthropic'),   # the file's name contains the series'
        ('Allina', 'Allina Health'),                      # the series' name contains the file's
        ('SQ *ANTHROPIC', 'Anthropic'),
        ('Allina Health #4521', 'Allina Health'),
    ])
    def test_similar_when_one_cleaned_name_contains_the_other(self, vendor, name):
        assert vendor_match(vendor, [name]) == 'similar'

    @pytest.mark.parametrize('vendor, name', [
        ('Target', 'Anthropic'),
        ('Cabin Store', 'Cab'),       # whole words only
        ('123', '456'),               # nothing left after cleaning
    ])
    def test_no_match(self, vendor, name):
        assert vendor_match(vendor, [name]) is None


@pytest.mark.parametrize('amount_cents, series_cents, close', [
    (-2000, -2000, True),
    (-2160, -2000, True),
    (-3000, -2000, True),     # exactly 50% more
    (-3001, -2000, False),
    (-1000, -2000, True),     # exactly 50% less
    (-999, -2000, False),
    (2000, -2000, False),     # a refund never matches a payment
    (8738, 8738, True),
])
def test_amount_close(amount_cents, series_cents, close):
    assert amount_close(amount_cents, series_cents) is close
