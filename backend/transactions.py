"""
transactions.py - Transaction class definitions

Contains:
- Transaction (Abstract Base Class)
- SingleTransaction (One-time transactions)
- RecurringTransaction (Recurring transactions with auto-generation)
"""

from abc import ABC, abstractmethod
from datetime import date, timedelta
from typing import Optional, List

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
        """Get the date of transaction"""
        return self.date

    def get_vendor(self) -> str:
        """Get vendor of transaction"""
        return self.vendor

    def get_category(self) -> str:
        """Get category of transaction"""
        return self.category

    def get_amount(self) -> float:
        """Get how much the transaction was worth"""
        return self.amount

    def get_notes(self) -> str:
        """Get notes of transaction"""
        return self.notes
        
    def edit(self, day: Optional[date] = None, vend: Optional[str] = None, 
             cat: Optional[str] = None, amnt: Optional[float] = None,
             desc: Optional[str] = None) -> None:
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
    #Set additional fields to null in database


class SingleTransaction(Transaction): #takes a transaction dict, and turns it into an object - has methods to get info, set info, generate a new transaction from info instead of dict, 
    """A one-time transaction"""
    
    def __init__(self, day: date, vend: str, cat: str, amnt: float, desc: str = "", type: ):
        super().__init__(day, vend, cat, amnt, desc)
        type
    
    def return_dict(self) -> dict:
        return {
            'date': self.date.isoformat(),
            'vendor': self.vendor,
            'category': self.category,
            'amount': self.amount,
            'notes': self.notes,
            'type': 'single'
        }
    
        
class RecurringTransaction(Transaction): #takes a recurringTransaction dict, and turns it into an object, similar to above 
    """A recurring transaction with automatic generation"""
    
    def __init__(self, day: date, vend: str, cat: str, amnt: float, 
                 desc: str = "", nxt: Optional[date] = None, 
                 freq: int = 30, num: int = -1) -> None:
        super().__init__(day, vend, cat, amnt, desc)
        self.next = nxt if nxt else (day + timedelta(days=freq))
        self.frequency = freq
        self.number = num
        self.idx = 0

    def get_remaining_dates(self, limit: int = 5) -> List[date]:
        """Get upcoming transaction dates (max limit = 5)"""
        if self.number == -1:
            return [self.next + timedelta(days=i*self.frequency) for i in range(limit)]
        else:
            return [self.next + timedelta(days=i*self.frequency)
                    for i in range(min(self.number-self.idx, limit))]

    def advance_to_next(self) -> None:
        """Move to the next occurrence date"""
        self.next = self.next + timedelta(days=self.frequency)
        self.idx += 1
                
    def edit(self, day: Optional[date] = None, vend: Optional[str] = None, 
             cat: Optional[str] = None, amnt: Optional[float] = None,
             desc: Optional[str] = "", nxt: Optional[date] = None, 
             freq: Optional[int] = None, num: Optional[int] = None) -> None:
        """Edit transaction"""
        super().edit(day, vend, cat, amnt, desc)
        if nxt is not None:
            self.next = nxt
        if freq is not None:
            self.frequency = freq
        if num is not None:
            self.number = num
            # 
            
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
            'type': 'recurring' 
        }
