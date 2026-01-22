"""
accounts.py - Bank account and financial account management

Contains:
- BankAccount (Manages transactions for a single bank account)
- FinanceAccount (Manages multiple bank accounts for a user)
- FinanceDataProcessor (CSV import and data analysis utilities)
"""

import pandas as pd
import json
import re
from typing import Dict, List, Optional
from datetime import datetime, date
from transactions import SingleTransaction, RecurringTransaction

class BankAccount: #Takes dict of details, transactions, and recurring transactions, generates transaction objects
    """Manages transactions and recurring transactions for a banking account"""
    
    def __init__ (self, acctInfo: Optional[dict] = None, acctId: Optional[str] = None):
        self.transactions: Dict[str, SingleTransaction] = {} #dictionary of name?:transaction pairs
        self.recurring: Dict[str, RecurringTransaction] = {} #dictionary of name?:recurringTransaction object pairs
        self.balance = 0.0
        
        if acctInfo is None:
            # For new account
            self.acctId = acctId or "default"
            
        else:
            # Load existing account from acctInfo dict
            self.acctId = acctInfo.get('acctId', 'default')
            self.balance = acctInfo.get('balance', 0.0)
            
            # Load single transactions
            for key, trans_dict in acctInfo.get('transactions', {}).items():
                trans = SingleTransaction(
                    day=datetime.fromisoformat(trans_dict['date']).date(),
                    vend=trans_dict['vendor'],
                    cat=trans_dict['category'],
                    amnt=trans_dict['amount'],
                    desc=trans_dict.get('notes', '')
                )
                self.transactions[key] = trans
                
            # Load recurring transactions
            for key, rec_dict in acctInfo.get('recurring', {}).items():
                rec = RecurringTransaction(
                    day=datetime.fromisoformat(rec_dict['start']).date(),
                    vend=rec_dict['vendor'],
                    cat=rec_dict['category'],
                    amnt=rec_dict['amount'],
                    desc=rec_dict.get('notes', ''),
                    nxt=datetime.fromisoformat(rec_dict['next']).date(),
                    freq=rec_dict['frequency'],
                    num=rec_dict['number']
                )
                self.recurring[key] = rec

    def add_transactions(self, trans: SingleTransaction) -> None:
        """Add a transaction and update balance"""
        key = f"single_{trans.get_vendor()}_{trans.get_date().isoformat()}"
        self.transactions[key] = trans
        self.balance += trans.get_amount()
        
    def add_recurring(self, rec: RecurringTransaction) -> None:
        """Add a recurring transaction"""
        key = f"recurs_{rec.get_vendor()}_{rec.get_date().isoformat()}"
        self.recurring[key] = rec
        
    def update_recurring(self) -> int:
        """Updates all recurring transactions (called on login)"""
        total_gen = 0
        now = date.today()
        
        for rec in self.recurring.values():
            # Generate transactions for all passed dates
            while rec.next <= now and (rec.idx < self.num or self.num == -1):
                # Create new single transaction
                new_transaction = SingleTransaction(
                    day=rec.next,
                    vend=rec.vendor,
                    cat=rec.category,
                    amnt=rec.amount,
                    desc=f"Auto-generated from recurring ({rec.frequency} days)"
                )
                
                self.add_transaction(new_transaction)
                rec.advance_to_next()
                total_gen += 1
        
        return total_gen
    
    def get_balance(self) -> float:
        """Get current account balance"""
        return self.balance
    
    def recalculate_balance(self) -> float:
        """Recalculate balance from all transactions"""
        self.balance = sum(t.get_amount() for t in self.transactions.values())
        return self.balance
    
    def get_transactions_df(self) -> pd.DataFrame:
        """Get all transactions as a pandas DataFrame"""
        data = [trans.return_dict() for trans in self.transactions.values()]
        
        if not data:
            return pd.DataFrame()
        
        df = pd.DataFrame(data)
        df['date'] = pd.to_datetime(df['date'])
        return df.sort_values('date')
    
    def return_dict(self) -> dict:
        """Export account data as dictionary for JSON storage"""
        return {
            'acctId': self.acctId,
            'balance': self.balance,
            'transactions': {k: v.return_dict() for k, v in self.transactions.items()},
            'recurring': {k: v.return_dict() for k, v in self.recurring.items()}
        }
    

class FinanceAccount:
    """Main account manager, handling multiple bank accounts"""
    
    def __init__(self, filename: str, user: Optional[str] = None):
        """
        Initialize finance account manager
        - filename: JSON file path for data persistence
        - user: Username (for new accounts). If None, loads from file.
        """
        self.filename = filename
        self.user = user
        self.accounts: Dict[str, 'BankAccount'] = {}
        
        if user is None:
            # Load existing account from file
            self.load_from_file()
        else:
            # New user
            self.user = user
    
    def load_from_file(self) -> None:
        """
        Load account data from JSON file such as
        - Account as dictionary
        - BankAccount objects with their transactions
        """
        # from Account import BankAccount #if moved to another file
        
        try:
            with open(self.filename, 'r') as f:
                data = json.load(f)
                self.user = data.get('user', 'default')
                
                # Reconstruct each account
                for acct_id, acct_data in data.get('accounts', {}).items():
                    self.accounts[acct_id] = BankAccount(acctInfo=acct_data, acctId=acct_id)
                    
            # print(f"Loaded data for user '{self.user}' from {self.filename}")
            
        except FileNotFoundError:
            print(f"No existing file found at {self.filename}. Creating new account.")
            self.user = self.user or 'default'
            
        except json.JSONDecodeError:
            print(f"Error reading {self.filename}. File may be corrupted.")
            self.user = self.user or 'default'
    
    def save_to_file(self) -> None:
        """Save account data to JSON file"""
        data = {
            'user': self.user,
            'accounts': {acct_id: acct.return_dict() 
                        for acct_id, acct in self.accounts.items()}
        }
        
        with open(self.filename, 'w') as f:
            json.dump(data, f, indent=2)
        
        # print(f"Saved data for user '{self.user}' to {self.filename}")
    
    def add_account(self, acct_id: str, account: 'BankAccount') -> None:
        """Add a bank account"""
        self.accounts[acct_id] = account
        # print(f"Added account '{acct_id}'")
    
    def create_account(self, acct_id: str) -> 'BankAccount':
        """Create a new empty bank account"""
        # from Account import BankAccount #if moved to another file
        
        account = BankAccount(acctId=acct_id)
        self.accounts[acct_id] = account
        # print(f"Created account '{acct_id}'")
        return account
    
    def import_csv(self, filepath: str, acct_id: str) -> None:
        """Import transactions from CSV into specified account"""
        account = FinanceDataProcessor.csv_to_account(filepath, acct_id)
        self.accounts[acct_id] = account
        # print(f"Imported CSV into account '{acct_id}'")
        # print(f"Transactions: {len(account.transactions)}")
        # print(f"Balance: ${account.get_balance():.2f}")
    
    def login_update(self) -> Dict[str, int]:
        """Update all recurring transactions on login"""
        results = {}
        total = 0
        
        for acct_id, account in self.accounts.items():
            count = account.update_recurring()
            results[acct_id] = count
            total += count
        
        return results
    
    def get_total_balance(self) -> float:
        """Get total balance across all accounts"""
        return sum(acct.get_balance() for acct in self.accounts.values())
    
    def get_account(self, acct_id: str) -> Optional['BankAccount']:
        """Get account by ID"""
        return self.accounts.get(acct_id)
    
    def list_accounts(self) -> List[str]:
        """Get list of all account IDs"""
        return list(self.accounts.keys())
    
    def export_for_frontend(self) -> dict:
        """Export all data for frontend"""
        export_data = {
            'user': self.user,
            'total_balance': self.get_total_balance(),
            'accounts': {}
        }
        
        for acct_id, account in self.accounts.items():
            df = account.get_transactions_df()
            
            export_data['accounts'][acct_id] = {
                'balance': account.get_balance(),
                'transaction_count': len(account.transactions),
                'recurring_count': len(account.recurring),
                'transactions': df.to_dict('records') if not df.empty else [],
                'spending_by_category': FinanceDataProcessor.get_spending_by_category(account).to_dict('index'),
                'income_by_category': FinanceDataProcessor.get_income_by_category(account).to_dict('index'),
                'monthly_summary': FinanceDataProcessor.get_monthly_summary(account).to_dict('index')
            }
        
        return export_data
    
    def get_summary(self) -> str:
        """Get a text summary of all accounts"""
        summary = f"Finance Account Summary for {self.user}\n"
        summary += "=" * 50 + "\n"
        summary += f"Total Accounts: {len(self.accounts)}\n"
        summary += f"Total Balance: ${self.get_total_balance():.2f}\n\n"
        
        for acct_id, account in self.accounts.items():
            summary += f"{acct_id}:\n"
            summary += f"  Balance: ${account.get_balance():.2f}\n"
            summary += f"  Transactions: {len(account.transactions)}\n"
            summary += f"  Recurring: {len(account.recurring)}\n"
        
        return summary

        
class FinanceDataProcessor:
    """Utility class for CSV processing and data analysis"""
    
    @staticmethod
    def clean_currency(value: str) -> float:
        """Convert currency string to float (handles $, €, £, commas, etc.)"""
        if pd.isna(value) or value == '':
            return 0.0
        
        # Remove currency symbols, commas, whitespace
        cleaned = re.sub(r'[£$€,\s]', '', str(value))
        
        try:
            return float(cleaned)
        except ValueError:
            return 0.0
    
    @staticmethod
    def parse_date(date_str: str) -> date:
        """Parse date string of multiple formats"""
        # Try MM/DD/YYYY format first
        try:
            return datetime.strptime(date_str, '%m/%d/%Y').date()
        except ValueError:
            pass
        
        # Try YYYY-MM-DD format
        try:
            return datetime.strptime(date_str, '%Y-%m-%d').date()
        except ValueError:
            pass
        
        # Try MM-DD-YYYY format
        try:
            return datetime.strptime(date_str, '%m-%d-%Y').date()
        except ValueError:
            pass
        
        # Default to today if parsing fails
        # print(f"Warning: Could not parse date '{date_str}', using today's date")
        return date.today()
    
    @staticmethod
    def load_csv(filepath: str) -> pd.DataFrame:
        """
        Load and clean financial CSV data
        
        Expected CSV format
        1)  date,vendor,category,expense,income,account,(notes)
            01/23/2025,Fresh Thyme,Grocery,51.71,,StarBank 0101,ramen night!
            01/24/2025,Salary,Income,,"3,292.37",StarBank 0101,Paycheck
            
        2)  date,vendor,category,amount,account,(notes)
            01/23/2025,Fresh Thyme,Grocery,-51.71,StarBank 0101,ramen night!
            01/24/2025,Salary,Income,"3,292.37",StarBank 0101,Paycheck
        """
        df = pd.read_csv(filepath)
        
        # Clean column names (lowercase and strip whitespace)
        df.columns = df.columns.str.lower().str.strip()
        
        # Parse dates
        df['date'] = df['date'].apply(FinanceDataProcessor.parse_date)
        
        # Clean currency columns
        if 'expense' and 'income' in df.columns:
            df['expense'] = df['expense'].apply(FinanceDataProcessor.clean_currency)
            df['income'] = df['income'].apply(FinanceDataProcessor.clean_currency)
                
            df['amount'] = df['income'] - df['expense']

        elif 'amount' in df.columns:
            df['amount'] = df['amount'].apply(FinanceDataProcessor.clean_currency)
        else:
            raise ValueError(
            "CSV must have either 'expense' and 'income' columns, "
            "or a single 'amount' column"
        )
        
        # Fill NA values
        df['vendor'] = df['vendor'].fillna('Unknown')
        df['category'] = df['category'].fillna('Uncategorized')
        df['account'] = df['account'].fillna('Default')
        df['notes'] = df['notes'].fillna('') if 'notes' in df.columns else ''
        
        # Ensure all required columns exist
        required_columns = ['date', 'vendor', 'category', 'amount', 'account']
        missing_columns = [col for col in required_columns if col not in df.columns]
        
        if missing_columns:
            raise ValueError(f"CSV is missing required columns: {missing_columns}")
    
        return df
    
    @staticmethod
    def csv_to_account(filepath: str, acct_id: str) -> 'BankAccount':
        """Create a BankAccount from CSV file"""
        # from Account import BankAccount #if moved to another file
        
        df = FinanceDataProcessor.load_csv(filepath)
        account = BankAccount(acctId=acct_id)
        
        # Add each row as a transaction
        for _, row in df.iterrows():
            trans = SingleTransaction(
                day=row['date'],
                vend=row['store'],
                cat=row['category'],
                amnt=row['amount'],
                desc=row['notes']
            )
            account.add_transactions(trans)
        
        return account
    
    @staticmethod
    def get_spending_by_category(account: 'BankAccount') -> pd.DataFrame:
        """Get spending summary by category for expenses"""
        df = account.get_transactions_df()
        
        if df.empty:
            return pd.DataFrame()
        
        # Filter expenses (negative amounts)
        expenses = df[df['amount'] < 0].copy()
        expenses['amount'] = expenses['amount'].abs()
        
        expenses = expenses.dropna(subset=['category'])

        # Group by category
        summary = expenses.groupby('category')['amount'].agg(['sum', 'mean', 'count'])
        summary.columns = ['total', 'average', 'count']
        
        return summary.sort_values('total', ascending=False)
    
    @staticmethod
    def get_income_by_category(account: 'BankAccount') -> pd.DataFrame:
        """Get income summary by category for income"""
        df = account.get_transactions_df()
        
        if df.empty:
            return pd.DataFrame()
        
        # Filter income (positive amounts)
        income = df[df['amount'] > 0].copy()

        income = income.dropna(subset=['category'])

        # Group by category
        summary = income.groupby('category')['amount'].agg(['sum', 'mean', 'count'])
        summary.columns = ['total', 'average', 'count']
        
        return summary.sort_values('total', ascending=False)
    
    @staticmethod
    def get_monthly_summary(account: 'BankAccount') -> pd.DataFrame:
        """Get monthly income/expense summary"""
        df = account.get_transactions_df()
        
        if df.empty:
            return pd.DataFrame()
        
        # Create year-month column
        df['year_month'] = df['date'].dt.to_period('M')
        
        # Aggregate by month
        monthly = df.groupby('year_month').agg({
            'amount': [
                lambda x: x[x > 0].sum(),      # income
                lambda x: abs(x[x < 0].sum()), # expenses
                'sum'                           # net
            ]
        })
        
        monthly.columns = ['income', 'expenses', 'net']
        
        return monthly
    
    @staticmethod
    def get_daily_balance(account: 'BankAccount') -> pd.DataFrame:
        """Get daily running balance"""
        df = account.get_transactions_df()
        
        if df.empty:
            return pd.DataFrame()
        
        df = df.copy()
        df['date'] = pd.to_datetime(df['date'])
        
        daily = (
        df.sort_values('date')
          .groupby(df['date'].dt.date)['amount']
          .sum()
          .cumsum()
          .reset_index(name='balance')
        )

        # Convert date back to datetime
        daily['date'] = pd.to_datetime(daily['date'])

        return daily
    
    @staticmethod
    def get_spending_trends(account: 'BankAccount', period: str = 'M') -> pd.DataFrame:
        """
        Get spending trends over a given period:
        - period: Time period ('D' for daily, 'W' for weekly, 'M' for monthly)
        """
        df = account.get_transactions_df()
        
        if df.empty:
            return pd.DataFrame()
        
        # Filter expenses only
        expenses = df[df['amount'] < 0].copy()
        expenses['amount'] = expenses['amount'].abs()
        
        # Resample by period
        expenses.set_index('date', inplace=True)
        trends = expenses['amount'].resample(period).agg(['sum', 'mean', 'count'])
        trends.columns = ['total_spent', 'avg_transaction', 'num_transactions']
        
        return trends