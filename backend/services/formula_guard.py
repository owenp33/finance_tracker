"""
formula_guard.py - Keeps exported CSV text from running as a spreadsheet formula

Excel, Google Sheets and LibreOffice run a cell that starts with = + - @ (or a tab or carriage
return) as a formula, so a vendor like =HYPERLINK(...) in an exported file could run when it's
opened. guard() puts an apostrophe in front of such text, which spreadsheets show as plain text;
unguard() takes it off again, so the app's own exports import back exactly. Pure functions.
"""
FORMULA_STARTS = ('=', '+', '-', '@', '\t', '\r')


def _looks_like_formula(text):
    """True when the text, after any leading apostrophes, starts like a formula."""
    return text.lstrip("'").startswith(FORMULA_STARTS)


def guard(text):
    """The text with an apostrophe in front when a spreadsheet would read it as a formula."""
    return f"'{text}" if _looks_like_formula(text) else text


def unguard(text):
    """Undo guard(): drop one leading apostrophe that sits in front of formula-like text."""
    return text[1:] if text.startswith("'") and _looks_like_formula(text) else text
