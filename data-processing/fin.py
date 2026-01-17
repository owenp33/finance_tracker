import pandas as pd
import numpy as np
import json
import re
from typing import Dict, List, Optional
from datetime import datetime, timedelta, date
from abc import ABC, abstractmethod

class Transaction(ABC):
    """Abstract base class for all types of transactions"""
    
    @abstractmethod
    def __init__(self, day: date, vend: str, cat: str, amnt: float, desc: str = ""):
        self.date = day # Date when the transaction occured or will occur
        self.vendor = vend
        self.category = cat
        self.amount = amnt
        self.notes = desc

    @abstractmethod
    def return_dict(self) -> dict:
        pass

    def get_date(self) -> date:
        return self.date

    def get_vendor(self) -> str:
        return self.vendor

    def get_category(self) -> str:
        return self.category

    def get_amount(self) -> float:
        return self.amount

    def get_notes(self) -> str:
        return self.notes
        
    def edit(self, day: Optional[date] = None, vend: Optional[str] = None, cat: Optional[str] = None, amnt: Optional[float] = None,
             desc: Optional[str] = None):
        """Edit transaction"""
        if day is not None:
            self.date = day
        if vend is not None:
            self.vendor = vend
        if cat is not None:
            self.category = cat
        if amnt is not None:
            self.amount = amnt
        if desc is not None:
            self.notes = desc

class SingleTransaction(Transaction): #takes a transaction dict, and turns it into an object - has methods to get info, set info, generate a new transaction from info instead of dict, 
    """A one-time transaction"""
    
    def __init__(self, day: date, vend: str, cat: str, amnt: float, desc: str = ""):
        super().__init__(day, vend, cat, amnt, desc)
    
    def return_dict(self) -> dict:
        return {
            'date': self.date.isoformat(),
            'vendor': self.vendor,
            'category': self.category,
            'amount': self.amount,
            'notes': self.notes,
            'type': 'single' # possibly remove later ?
        }

class RecurringTransaction(Transaction): #takes a recurringTransaction dict, and turns it into an object, similar to above 
    """A recurring transaction with automatic generation"""
    
    def __init__(self, day: date, vend: str, cat: str, amnt: float, 
                 desc: str = "", nxt: date = None, freq: int = 30, num:int = -1):
        super().__init__(day, vend, cat, amnt, desc)
        self.next = nxt if nxt else (day + timedelta(days=self.frequency))
        self.frequency = freq
        self.number = num

    def get_remaining_dates(self):
        """Get upcoming transaction dates (max 5)"""
        if self.number == -1:
            return [self.next + timedelta(days=i*self.frequency) for i in range(5)]
        else:
            return [self.next + timedelta(days=i*self.frequency) for i in range(min(self.number, 5))]

    def update(self, account: 'BankAccount') -> int:
        """Generate SingleTransactions for all passed dates"""
        now = date.today()
        num_trans = 0
        
        # Generate transactions for all recurring transaction dates that have passed
        while (self.next <= now and self.number != 0):
            # Create new single transaction for this occurrence
            new_transaction = SingleTransaction(
                day=self.next,
                vend=self.vendor,
                cat=self.category,
                amnt=self.amount,
                desc=f"Auto-generated from recurring transaction ({self.frequency} days)"
            )
            
            account.add_transactions(new_transaction)
            
            self.next = self.next + timedelta(days=self.frequency)
            
            if self.number > 0:
                self.number -= 1
                
            num_trans += 1
            
        return num_trans
    
    def edit(self, day: Optional[date] = None, vend: Optional[str] = None, cat: Optional[str] = None, amnt: Optional[float] = None,
             desc: Optional[str] = "", nxt: Optional[date] = None, freq: Optional[int] = None, num: Optional[int] = None):
        """Edit transaction"""
        super().edit(day, vend, cat, amnt, desc)
        if nxt is not None:
            self.next = nxt
        if freq is not None:
            self.frequency = freq
        if num is not None:
            self.number = num
            
    def return_dict(self) -> dict: 
        return {
            'start': self.date.isoformat(),
            'vendor': self.vendor,
            'category': self.category,
            'amount': self.amount,
            'notes': self.notes,
            'next': self.next.isoformat(),
            'frequency': self.frequency,
            'number': self.number,
            'type': 'recurring' # possibly remove later ?
        }

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
                self.transaction[key] = trans
                
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

class FinanceAcc: #Reads json into dict, calls account contructor, uses account to respond to api calls
    def __init__(self, filename: str, user=None):
        if user is None:
            #process account from file
            pass
        else:
            #new user, create file 
            pass