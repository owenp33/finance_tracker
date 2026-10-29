"""
import_parser.py - Import File Parsing

Turns an uploaded CSV/XLSX/XLS file into a normalized DataFrame with the standard
columns date, vendor, category, amount, notes (plus account when the file has one).
Pure data transformation: no database access.
"""
import io
import math
import re
from datetime import datetime, date, timedelta

import pandas as pd

from services import formula_guard

MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_ROWS = 10_000


# PARSING UTILITIES =============================================================

def _is_blank(value) -> bool:
    """True for an empty cell: None, NaN/NaT, or a string of only whitespace."""
    return pd.isna(value) or (isinstance(value, str) and not value.strip())


def _raw_text(value) -> str:
    """A cell's original text, trimmed ('' when blank), shown in the preview when it can't be read."""
    return '' if _is_blank(value) else str(value).strip()


def _unguard(value):
    """A text cell without the apostrophe the app's CSV export puts in front of formula-like text."""
    return formula_guard.unguard(value) if isinstance(value, str) else value


def clean_currency(value) -> float | None:
    """
    Convert a currency value to float, or None when it is blank or unreadable (the
    import preview flags those rows). Handles $, €, £, thousands separators, and
    accounting-style negatives: (12.34), $(12.34) and ($12.34) all read as -12.34.
    """
    if _is_blank(value):
        return None

    cleaned  = re.sub(r'[£$€,\s]', '', str(value))
    negative = cleaned.startswith('(') and cleaned.endswith(')')
    if negative:
        cleaned = cleaned[1:-1]

    try:
        number = float(cleaned)
    except ValueError:
        return None
    if not math.isfinite(number):
        return None
    return -number if negative else number


def _income_minus_expense(expense, income) -> float | None:
    """
    Combine an expense/withdrawal cell and an income/deposit cell into one signed amount.
    A blank cell counts as 0 when the other has a value (each row normally fills only one).
    None when both are blank or a filled cell can't be read.
    """
    if _is_blank(expense) and _is_blank(income):
        return None

    total = 0.0
    for cell, sign in ((income, 1), (expense, -1)):
        if _is_blank(cell):
            continue
        number = clean_currency(cell)
        if number is None:
            return None
        total += sign * number
    return total


def parse_date(value) -> date | None:
    """
    Parse a date value into a Python date object, or None when it is blank or not in
    a recognized format (the import preview flags those rows instead of guessing).
    Handles pandas Timestamps (returned by read_excel), Python datetime/date
    objects, Excel serial numbers, and common date strings.
    """
    # Checked first: an empty Excel date cell arrives as NaT, which also passes isinstance(datetime)
    if _is_blank(value):
        return None

    # pandas reads Excel date cells as Timestamps — extract the date directly
    if isinstance(value, pd.Timestamp):
        return value.date()
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value

    date_str = str(value).strip()

    try:
        if '.' in date_str or date_str.isdigit():
            excel_date = float(date_str)
            return (datetime(1899, 12, 30) + timedelta(days=excel_date)).date()
    except (ValueError, OverflowError):
        pass

    formats = ['%m/%d/%Y', '%Y-%m-%d', '%m-%d-%Y', '%Y-%m-%d %H:%M:%S']
    for fmt in formats:
        try:
            return datetime.strptime(date_str, fmt).date()
        except ValueError:
            continue

    return None


# FILE PARSING ==================================================================

def parse_csv(stream: io.BytesIO) -> pd.DataFrame:
    """
    Read CSV data from a BytesIO stream into a raw DataFrame. No normalization.
    Tries UTF-8 (with BOM), plain UTF-8, then Latin-1 to handle Windows/bank exports.
    """
    raw = stream.read()
    for encoding in ('utf-8-sig', 'utf-8', 'latin-1'):
        try:
            return pd.read_csv(io.BytesIO(raw), encoding=encoding)
        except UnicodeDecodeError:
            continue
    raise ValueError("Could not decode the file — try saving it as UTF-8")


def parse_excel(stream: io.BytesIO, ext: str = 'xlsx') -> pd.DataFrame:
    """Read XLSX/XLS data from a BytesIO stream into a raw DataFrame. No normalization."""
    engine = 'xlrd' if ext == 'xls' else 'openpyxl'
    return pd.read_excel(stream, engine=engine)


# NORMALIZATION =================================================================

def normalize_dataframe(df) -> pd.DataFrame:
    """
    Normalize a raw financial DataFrame to standard columns.

    - Lowercases and strips all column headers
    - Parses the date column (None where unreadable) and keeps the original text as date_raw
    - Resolves amount from: amount | expense+income | withdrawal+deposit (None/NaN where
      unreadable) and keeps the original text as amount_raw
    - Resolves vendor from: vendor | store
    - Resolves account from: account | bank account (the app's own CSV export), if present,
      trimmed ('' for blank cells)
    - Resolves notes from: notes | description
    - Removes the export's formula guard (an apostrophe before = + - @) from text columns
    - Validates required columns are present
    """
    df = df.copy()
    df.columns = df.columns.str.lower().str.strip()

    if 'date' not in df.columns:
        raise ValueError("File is missing required column: 'date'")

    df['date_raw'] = df['date'].apply(_raw_text)
    df['date']     = df['date'].apply(parse_date)

    has_expense_withdrawal = 'expense' in df.columns or 'withdrawal' in df.columns
    has_income_deposit     = 'income'  in df.columns or 'deposit'    in df.columns

    if has_expense_withdrawal and has_income_deposit:
        expense_col = 'expense' if 'expense' in df.columns else 'withdrawal'
        income_col  = 'income'  if 'income'  in df.columns else 'deposit'
        pairs = list(zip(df[expense_col], df[income_col]))
        df['amount_raw'] = [' / '.join(t for t in map(_raw_text, pair) if t) for pair in pairs]
        df['amount']     = [_income_minus_expense(expense, income) for expense, income in pairs]
    elif 'amount' in df.columns:
        df['amount_raw'] = df['amount'].apply(_raw_text)
        df['amount']     = df['amount'].apply(clean_currency)
    else:
        raise ValueError(
            "File must have 'expense'/'withdrawal' + 'income'/'deposit', "
            "or a single 'amount' column"
        )

    if 'vendor' in df.columns:
        df['vendor'] = df['vendor'].fillna('Unknown')
    elif 'store' in df.columns:
        df['vendor'] = df['store'].fillna('Unknown')

    if 'category' in df.columns:
        df['category'] = df['category'].fillna('Uncategorized')

    if 'account' not in df.columns and 'bank account' in df.columns:
        df['account'] = df['bank account']
    if 'account' in df.columns:
        df['account'] = df['account'].apply(_raw_text)   # trimmed; '' for a blank cell

    if 'notes' in df.columns:
        df['notes'] = df['notes'].fillna('')
    elif 'description' in df.columns:
        df['notes'] = df['description'].fillna('')
    else:
        df['notes'] = ''

    for column in ('vendor', 'category', 'notes', 'account'):
        if column in df.columns:
            df[column] = df[column].map(_unguard)

    missing = [c for c in ['date', 'vendor', 'category', 'amount'] if c not in df.columns]
    if missing:
        raise ValueError(f"File is missing required columns: {missing}")

    # Strip whitespace then truncate to DB column limits.
    # Stripping prevents duplicate-detection misses caused by leading/trailing
    # spaces in bank exports (common in generic transfer/payment descriptions).
    df['vendor']   = df['vendor'].str.strip().str[:100]
    df['category'] = df['category'].str.strip().str[:50]

    return df


# LOADING =======================================================================

def load_file(file) -> pd.DataFrame:
    """
    Detect format, parse, and normalize an uploaded file.
    Reads the upload into BytesIO once, then delegates to parse_csv or parse_excel.
    Raises ValueError with a message for the user when the file can't be used.
    """
    filename = getattr(file, 'filename', '') or ''
    ext      = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
    mime     = getattr(file, 'content_type', '') or ''

    # Extension takes precedence — Windows browsers often report .csv files
    # with MIME type application/vnd.ms-excel, which would otherwise trigger
    # the Excel parser and cause a "not a zip file" error.
    is_csv   = ext == 'csv'
    is_excel = not is_csv and (ext in ('xlsx', 'xls') or 'spreadsheet' in mime or 'excel' in mime)

    raw = file.read()
    if len(raw) > MAX_FILE_BYTES:
        raise ValueError("File exceeds the 10 MB size limit")

    stream = io.BytesIO(raw)

    try:
        df = parse_excel(stream, ext or 'xlsx') if is_excel else parse_csv(stream)

        if len(df) > MAX_ROWS:
            raise ValueError(f"File has {len(df):,} rows; the limit is 10,000 per import")

        return normalize_dataframe(df)
    except ValueError:
        raise
    except Exception as e:
        # pandas/openpyxl/xlrd raise many exception types for unreadable files;
        # report them as a bad upload rather than a server error
        raise ValueError(f'Could not parse file: {e}') from e
