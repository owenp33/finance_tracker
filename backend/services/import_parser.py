"""
import_parser.py - Import File Parsing

Turns an uploaded CSV/XLSX/XLS file into a normalized DataFrame with the standard
columns date, vendor, category, amount, notes (plus account when the file has one).
Pure data transformation: no database access.
"""
import io
import re
from datetime import datetime, date, timedelta

import pandas as pd

MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_ROWS = 10_000


# PARSING UTILITIES =============================================================

def clean_currency(value: str) -> float:
    """Convert currency string to float (handles $, €, £, commas, etc.)"""
    if pd.isna(value) or value == '':
        return 0.0

    cleaned = re.sub(r'[£$€,\s]', '', str(value))

    try:
        return float(cleaned)
    except ValueError:
        return 0.0


def parse_date(value) -> date:
    """
    Parse a date value into a Python date object.
    Handles pandas Timestamps (returned by read_excel), Python datetime/date
    objects, Excel serial numbers, and common date strings.
    """
    # pandas reads Excel date cells as Timestamps — extract the date directly
    if isinstance(value, pd.Timestamp):
        return value.date()
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value

    if pd.isna(value) or value == '':
        return date.today()

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

    print(f"Warning: Could not parse date '{date_str}', using today's date")
    return date.today()


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
    - Parses the date column
    - Resolves amount from: amount | expense+income | withdrawal+deposit
    - Resolves vendor from: vendor | store
    - Resolves notes from: notes | description
    - Validates required columns are present
    """
    df = df.copy()
    df.columns = df.columns.str.lower().str.strip()

    if 'date' not in df.columns:
        raise ValueError("File is missing required column: 'date'")

    df['date'] = df['date'].apply(parse_date)

    has_expense_withdrawal = 'expense' in df.columns or 'withdrawal' in df.columns
    has_income_deposit     = 'income'  in df.columns or 'deposit'    in df.columns

    if has_expense_withdrawal and has_income_deposit:
        expense_col = 'expense' if 'expense' in df.columns else 'withdrawal'
        income_col  = 'income'  if 'income'  in df.columns else 'deposit'
        df[expense_col] = df[expense_col].apply(clean_currency)
        df[income_col]  = df[income_col].apply(clean_currency)
        df['amount'] = df[income_col] - df[expense_col]
    elif 'amount' in df.columns:
        df['amount'] = df['amount'].apply(clean_currency)
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

    if 'notes' in df.columns:
        df['notes'] = df['notes'].fillna('')
    elif 'description' in df.columns:
        df['notes'] = df['description'].fillna('')
    else:
        df['notes'] = ''

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
