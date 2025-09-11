import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from datetime import datetime, timedelta, date

class FinanceAcct:
    def __init__(self, user: str):
        self.user = user
    class Account:
        def __init__(self, name: str):
            self.balance = 0
            self.name = name

class Transactions:
    def __init__(self, date: date, store: str, category: str, amount: float):
        self.date = date
        self.store = store
        self.category = category
        self.amount = amount
                
                
        
            
                
