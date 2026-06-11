"""
analytics_service.py - CSV Processing and Analytics

Handles financial data parsing and report generation.
No database writes — pure data transformation and analysis.
"""
import io
import pandas as pd
import re
from datetime import datetime, date, timedelta


class AnalyticsService:

    # PARSING UTILITIES =========================================================

    @staticmethod
    def clean_currency(value: str) -> float:
        """Convert currency string to float (handles $, €, £, commas, etc.)"""
        if pd.isna(value) or value == '':
            return 0.0

        cleaned = re.sub(r'[£$€,\s]', '', str(value))

        try:
            return float(cleaned)
        except ValueError:
            return 0.0

    @staticmethod
    def parse_date(date_str: str) -> date:
        """Parse date string across multiple common formats, including Excel serials"""
        if pd.isna(date_str) or date_str == '':
            return date.today()

        date_str = str(date_str).strip()

        try:
            if '.' in date_str or date_str.isdigit():
                excel_date = float(date_str)
                return datetime(1899, 12, 30) + timedelta(days=excel_date)
        except (ValueError, OverflowError):
            pass

        formats = ['%m/%d/%Y', '%Y-%m-%d', '%m-%d-%Y']
        for fmt in formats:
            try:
                return datetime.strptime(date_str, fmt).date()
            except ValueError:
                continue

        print(f"Warning: Could not parse date '{date_str}', using today's date")
        return date.today()

    # FILE PARSING ===============================================================

    @staticmethod
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

    @staticmethod
    def parse_excel(stream: io.BytesIO, ext: str = 'xlsx') -> pd.DataFrame:
        """Read XLSX/XLS data from a BytesIO stream into a raw DataFrame. No normalization."""
        engine = 'xlrd' if ext == 'xls' else 'openpyxl'
        return pd.read_excel(stream, engine=engine)

    # NORMALIZATION ==============================================================

    @staticmethod
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

        df['date'] = df['date'].apply(AnalyticsService.parse_date)

        has_expense_withdrawal = 'expense'    in df.columns or 'withdrawal' in df.columns
        has_income_deposit = 'income'     in df.columns or 'deposit'    in df.columns

        if has_expense_withdrawal and has_income_deposit:
            expense_col = 'expense' if 'expense' in df.columns else 'withdrawal'
            income_col  = 'income'  if 'income'  in df.columns else 'deposit'
            df[expense_col] = df[expense_col].apply(AnalyticsService.clean_currency)
            df[income_col]  = df[income_col].apply(AnalyticsService.clean_currency)
            df['amount'] = df[income_col] - df[expense_col]
        elif 'amount' in df.columns:
            df['amount'] = df['amount'].apply(AnalyticsService.clean_currency)
        else:
            raise ValueError(
                "File must have 'expense'/'withdrawal' + 'income'/'deposit', "
                "or a single 'amount' column"
            )

        if 'vendor' in df.columns:
            df['vendor'] = df['vendor'].fillna('Unknown')
        elif 'store' in df.columns:
            df['vendor'] = df['store'].fillna('Unknown')

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

        # Truncate to DB column limits
        df['vendor']   = df['vendor'].str[:100]
        df['category'] = df['category'].str[:50]

        return df

    # LOADING ====================================================================

    @staticmethod
    def load_file(file) -> pd.DataFrame:
        """
        Detect format, parse, and normalize.
        Reads the upload into BytesIO once, then delegates to parse_csv or parse_excel.
        Format is detected from both the filename extension and the MIME type so that
        binary Excel files are never accidentally passed to the CSV parser.
        """
        filename = getattr(file, 'filename', '') or ''
        ext      = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
        mime     = getattr(file, 'content_type', '') or ''

        is_excel = ext in ('xlsx', 'xls') or 'spreadsheet' in mime or 'excel' in mime

        raw = file.read()
        if len(raw) > 10 * 1024 * 1024:
            raise ValueError("File exceeds the 10 MB size limit")

        stream = io.BytesIO(raw)

        if is_excel:
            df = AnalyticsService.parse_excel(stream, ext or 'xlsx')
        else:
            df = AnalyticsService.parse_csv(stream)

        if len(df) > 10_000:
            raise ValueError(f"File has {len(df):,} rows; the limit is 10,000 per import")

        return AnalyticsService.normalize_dataframe(df)

    # REPORTING =================================================================

    @staticmethod
    def generate_report(transactions: list) -> dict:
        """
        Generate a comprehensive analytics report from a list of TransactionModel objects.
        Returns a dictionary ready for use in an API response.
        """
        if not transactions:
            return {
                'summary': {
                    'total_income': 0.0,
                    'total_expenses': 0.0,
                    'net_amount': 0.0,
                    'transaction_count': 0,
                    'avg_transaction': 0.0
                },
                'spending_by_category': [],
                'income_by_category': [],
                'monthly_summary': [],
                'top_vendors': [],
                'recent_transactions': [],
                'trends': {
                    'weekly_avg_expenses': 0.0,
                    'weekly_avg_income': 0.0
                }
            }

        data = [{
            'id': trans.id,
            'date': trans.date,
            'vendor': trans.vendor,
            'category': trans.category,
            'amount': trans.amount,
            'notes': trans.notes
        } for trans in transactions if not trans.is_transfer]

        df = pd.DataFrame(data)
        df['date'] = pd.to_datetime(df['date'])

        # SUMMARY
        total_income = df[df['amount'] > 0]['amount'].sum()
        total_expenses = abs(df[df['amount'] < 0]['amount'].sum())
        net_amount = total_income - total_expenses

        summary = {
            'total_income': round(float(total_income), 2),
            'total_expenses': round(float(total_expenses), 2),
            'net_amount': round(float(net_amount), 2),
            'transaction_count': len(df),
            'avg_transaction': round(float(df['amount'].abs().mean()), 2)
        }

        # SPENDING BY CATEGORY
        expenses = df[df['amount'] < 0].copy()
        spending_by_category = []

        if not expenses.empty:
            expenses['amount_abs'] = expenses['amount'].abs()
            spending_grouped = expenses.groupby('category')['amount_abs'].agg([
                ('total', 'sum'),
                ('average', 'mean'),
                ('count', 'count')
            ]).round(2)

            spending_by_category = [
                {
                    'category': str(cat),
                    'total': float(row['total']),
                    'average': float(row['average']),
                    'count': int(row['count']),
                    'percentage': round(float(row['total'] / total_expenses * 100), 1) if total_expenses > 0 else 0
                }
                for cat, row in spending_grouped.iterrows()
            ]
            spending_by_category.sort(key=lambda x: x['total'], reverse=True)

        # INCOME BY CATEGORY
        income_df = df[df['amount'] > 0].copy()
        income_by_category = []

        if not income_df.empty:
            income_grouped = income_df.groupby('category')['amount'].agg([
                ('total', 'sum'),
                ('average', 'mean'),
                ('count', 'count')
            ]).round(2)

            income_by_category = [
                {
                    'category': str(cat),
                    'total': float(row['total']),
                    'average': float(row['average']),
                    'count': int(row['count']),
                    'percentage': round(float(row['total'] / total_income * 100), 1) if total_income > 0 else 0
                }
                for cat, row in income_grouped.iterrows()
            ]
            income_by_category.sort(key=lambda x: x['total'], reverse=True)

        # MONTHLY SUMMARY
        df['year_month'] = df['date'].dt.to_period('M').astype(str)
        monthly_data = []

        for month, group in df.groupby('year_month'):
            month_income = group[group['amount'] > 0]['amount'].sum()
            month_expenses = abs(group[group['amount'] < 0]['amount'].sum())

            monthly_data.append({
                'month': month,
                'income': round(float(month_income), 2),
                'expenses': round(float(month_expenses), 2),
                'net': round(float(month_income - month_expenses), 2),
                'transaction_count': len(group)
            })

        monthly_data.sort(key=lambda x: x['month'], reverse=True)

        # TOP VENDORS
        top_vendors = []
        if not expenses.empty:
            top_expense_vendors = (
                expenses.groupby('vendor')['amount_abs']
                .sum()
                .sort_values(ascending=False)
                .head(10)
            )
            top_vendors = [
                {'vendor': str(vendor), 'amount': round(float(amount), 2)}
                for vendor, amount in top_expense_vendors.items()
            ]

        # RECENT TRANSACTIONS
        recent = df.sort_values('date', ascending=False).head(10)
        recent_transactions = [
            {
                'id': int(row['id']),
                'date': row['date'].strftime('%Y-%m-%d'),
                'vendor': row['vendor'],
                'category': row['category'],
                'amount': round(float(row['amount']), 2),
                'notes': row['notes']
            }
            for _, row in recent.iterrows()
        ]

        # TRENDS
        trends = {'weekly_avg_expenses': 0.0, 'weekly_avg_income': 0.0}

        if len(df) >= 7:
            df_sorted = df.sort_values('date')
            date_range = (df_sorted['date'].max() - df_sorted['date'].min()).days

            if date_range > 0:
                weeks = max(date_range / 7, 1)
                trends['weekly_avg_expenses'] = round(float(total_expenses / weeks), 2)
                trends['weekly_avg_income'] = round(float(total_income / weeks), 2)

        return {
            'summary': summary,
            'spending_by_category': spending_by_category,
            'income_by_category': income_by_category,
            'monthly_summary': monthly_data,
            'top_vendors': top_vendors,
            'recent_transactions': recent_transactions,
            'trends': trends
        }