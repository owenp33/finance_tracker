"""
analytics_service.py - CSV Processing and Analytics

Handles financial data parsing and report generation.
No database writes — pure data transformation and analysis.
"""
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

    # CSV LOADING ===============================================================

    @staticmethod
    def load_csv(filepath) -> pd.DataFrame:
        """
        Load and normalize a financial CSV file into a standard DataFrame.

        Supported formats:
          1) date, vendor, category, expense, income, account, (notes)
          2) date, vendor, category, amount, account, (notes)
        """
        df = pd.read_csv(filepath)
        df.columns = df.columns.str.lower().str.strip()

        df['date'] = df['date'].apply(AnalyticsService.parse_date)

        if 'expense' in df.columns and 'income' in df.columns:
            df['expense'] = df['expense'].apply(AnalyticsService.clean_currency)
            df['income'] = df['income'].apply(AnalyticsService.clean_currency)
            df['amount'] = df['income'] - df['expense']
        elif 'amount' in df.columns:
            df['amount'] = df['amount'].apply(AnalyticsService.clean_currency)
        else:
            raise ValueError(
                "CSV must have either 'expense' and 'income' columns, "
                "or a single 'amount' column"
            )

        if 'vendor' in df.columns:
            df['vendor'] = df['vendor'].fillna('Unknown')
        elif 'store' in df.columns:
            df['vendor'] = df['store'].fillna('Unknown')

        df['category'] = df['category'].fillna('Uncategorized')
        df['notes'] = df['notes'].fillna('') if 'notes' in df.columns else ''

        required_columns = ['date', 'vendor', 'category', 'amount']
        missing_columns = [col for col in required_columns if col not in df.columns]
        if missing_columns:
            raise ValueError(f"CSV is missing required columns: {missing_columns}")

        return df

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
        } for trans in transactions]

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