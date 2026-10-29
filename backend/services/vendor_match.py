"""
vendor_match.py - Comparing vendor names and amounts across bank spellings

Pure helpers for the import preview's recurring matches: banks spell one vendor many ways
("ANTHROPIC.COM CA", "SQ *ANTHROPIC"), and bills rise or dip. No database access.
"""
import re

# Card processors put these before the merchant's name, followed by a '*' ("SQ *BLUE BOTTLE")
PROCESSOR_PREFIXES = ('sq', 'tst', 'paypal')

# An amount can be the same bill when it's within this percentage of the series' amount
AMOUNT_TOLERANCE_PERCENT = 50

_PREFIX = re.compile(r'^(?:' + '|'.join(PROCESSOR_PREFIXES) + r')\s*\*')
_APOSTROPHES = re.compile(r"['’]")
_NOT_LETTERS = re.compile(r'[\W\d_]+')


def vendor_key(name):
    """How vendors compare exactly: ignoring case and surrounding spaces, as the database queries do."""
    return name.strip().lower()


def clean_vendor(name):
    """
    A vendor name reduced to its words, for loose comparison: lowercase, without a card
    processor's prefix, apostrophes, digits or other punctuation ("TST* Joe's #12" -> "joes").
    """
    text = _APOSTROPHES.sub('', _PREFIX.sub('', vendor_key(name)))
    return ' '.join(_NOT_LETTERS.sub(' ', text).split())


def _contains_words(longer, shorter):
    """True when shorter's words appear together, in order, in longer's."""
    return f' {shorter} ' in f' {longer} '


def vendor_match(vendor, names, aliases=()):
    """
    How a file's vendor compares with a series' names: 'exact' when it equals one of them
    (vendor_key) or its cleaned spelling is one of the series' remembered aliases, 'similar'
    when one cleaned name contains the other as whole words ("ANTHROPIC.COM CA" and
    "Anthropic"), else None.
    """
    cleaned = clean_vendor(vendor)
    if vendor_key(vendor) in {vendor_key(name) for name in names} or cleaned in aliases:
        return 'exact'
    for name in names:
        other = clean_vendor(name)
        if cleaned and other and (_contains_words(cleaned, other) or _contains_words(other, cleaned)):
            return 'similar'
    return None


def amount_close(amount_cents, series_cents):
    """True when an amount moves money the same way as the series' and is within AMOUNT_TOLERANCE_PERCENT of it."""
    if (amount_cents < 0) != (series_cents < 0):
        return False
    return abs(amount_cents - series_cents) * 100 <= abs(series_cents) * AMOUNT_TOLERANCE_PERCENT
