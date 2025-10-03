import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from typing import Dict, List, Optional
from datetime import datetime, timedelta, date
from abc import ABC, abstractmethod

class FinanceAcct:
    def __init__(self, user: str, file: str):
        self.user = user
    class Account: # Bank acct
        def __init__(self, name: str):
            self.balance = 0
            self.name = name
            self.transactions = {}
            class Transactions:
                def __init__(self, date: date, store: str, category: str, amount: float):
                    self.date = date
                    self.store = store
                    self.category = category
                    self.amount = amount
                    
            def add(self, date: date, store: str, category: str, amount: float):
                new_trans = [('date', date), ('store', store), ('category', category), ('amount', amount)]
                self.transactions.update(new_trans)
                

class Transaction(ABC):
    """Abstract base class for all types of transactions"""
    @abstractmethod
    def __init__(self, day: date, vend: str, cat: str, amnt: float):
        self.date = day # Date when the transaction occured or will occur
        self.vendor = vend
        self.category = cat
        self.amount = amnt

    @abstractmethod
    def return_dict(self) -> dict:
        pass

    def get_date(self) -> date:
        return self.date

    def get_vendor(self):
        return self.vendor

    def get_category(self):
        return self.category

    def get_amount(self):
        return self.amount
    
    def edit(self, date: Optional[date] = None, vendor: Optional[str] = None, category: Optional[str] = None, amount: Optional[float] = None):
        """Edit transaction"""
        if date is not None:
            self.date = date
        if vendor is not None:
            self.vendor = vendor
        if category is not None:
            self.category = category
        if amount is not None:
            self.amount = amount

class SingleTransaction(Transaction): #takes a transaction dict, and turns it into an object - has methods to get info, set info, generate a new transaction from info instead of dict, 
    def __init__(self, day: date, vend: str, cat: str, amnt: float):
        super().__init__(day, vend, cat, amnt)
    
    def return_dict(self) -> dict:
        return {
            'type': 'single',
            'date': self.date.isoformat(),
            'vendor': self.vendor,
            'category': self.category,
            'amount': self.amount
        }

class RecurringTransaction(Transaction): #takes a recurringTransaction dict, and turns it into an object, similar to above 
    def __init__(self, next:date, freq:int, num:int):
        self.frequency = freq
        self.number = num
        pass
    def get_date(self):
        return self.date
    
    def get_remaining_dates(self):
        return [self.date + timedelta(days=i*self.frequency) for i in range(self.number)] # if number is -1 (goes on forever)
    
    def get_vendor(self):
        return self.vendor

    def get_cat(self):
        return self.category

    def get_amnt(self):
        return self.amount


class bankAccount: #Takes dict of details, transactions, and recurring transactions, generates transaction objects
    def __init__ (self, acctInfo: dict, acctId: None):
        self.transactions = {} #dictionary of name?:transaction pairs
        self.recurring = {} #dictionary of name?:recurringTransaction object pairs
        if acctInfo is None:
            acctInfo = {
                'acctId': acctId,
                'transactions': {},
                'recurring': {}
                }
        for trans in acctInfo['transactions']: #Convert each into object and store in self.transactions
            pass
        for rec in acctInfo['recurring']:
            pass
        self.acctId = acctInfo['acctId']

    def add_transaction(self, trans: transaction):
        self.transactions[(trans.get_vendor() + trans.get_date().isoformat())] = trans
        #also add to acctInfo and change balance, and update finance Acct

    def add_recurring(self, rec: recurringTransaction):
        self.recurring[(rec.get_vendor()+ rec.get_date().isoformat())] = rec
        #also add to acctInfo and update finance acct

class FinanceAcc: #Reads json into dict, calls account contructor, uses account to respond to api calls
    def __init__(self, filename: str, user=None):
        if user is None:
            #process account from file
            pass
        else:
            #new user, create file 
            pass