"""
Account.py - Bank account and financial account management

Contains:
- BankAccount (Manages transactions for a single bank account)
- FinanceAcc (Manages multiple bank accounts for a user)
- FinanceDataProcessor (CSV import and data analysis utilities)
"""

import pandas as pd
import json
import re
from typing import Dict, List, Optional
from datetime import datetime, date

# Import transaction classes
from Transaction import Transaction, SingleTransaction, RecurringTransaction

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
        for rec in self.recurring.values():
            total_gen += rec.update(self)
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