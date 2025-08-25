import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from datetime import datetime, timedelta, date

class Transaction:
    def __init__(self, date: date, store: str, category: str, amount: float, type_: str):
        self.date = date
        self.store = store
        self.category = category
        self.amount = amount
        self.type = type_ # "income" or "expense"

# Set display options for better pandas output
pd.set_option('display.max_columns', None)
pd.set_option('display.width', 1000)

# Basic test to ensure everything works
if __name__ == "__main__":
    # Import financial data
    df=pd.read_csv("FinanceSheet25.csv")
    
    # ------------------------------------------------
    print("Original data shape:", df.shape)
    print("Original columns:", df.columns.tolist())
    print("\nFirst few rows:")
    print(df.head())
    
    # Rename columns of withdrawals and deposits
    df=df.rename(columns={'Withdrawal (-)':'Withdrawals', 'Deposit (+)':'Deposits'})
    
    # Convert to datetime
    df['Date'] = pd.to_datetime(df['Date'], format='%m/%d/%Y', errors='coerce')
    # Extract parts into new columns
    df['Month'] = df['Date'].dt.month
    df['Day'] = df['Date'].dt.day
    df['Year'] = df['Date'].dt.year
    
    # Handle string cleaning first > numeric
    if df['Withdrawals'].dtype=='object':
        df['Withdrawals']=df['Withdrawals'].str.replace('$', '', regex=False)
        df['Withdrawals']=df['Withdrawals'].str.replace(',', '', regex=False)
        df['Withdrawals']=pd.to_numeric(df['Withdrawals'], errors='coerce')

    if df['Deposits'].dtype=='object':
        df['Deposits']=df['Deposits'].str.replace('$', '', regex=False)
        df['Deposits']=df['Deposits'].str.replace(',', '', regex=False)
        df['Deposits']=pd.to_numeric(df['Deposits'], errors='coerce')
       
    # Fill NaN values with 0 for calculations
    df['Withdrawals'] = df['Withdrawals'].fillna(0)
    df['Deposits'] = df['Deposits'].fillna(0)
    
    # Create new column 'Amount' representing change in account
    df['Amount'] = df['Deposits'] - df['Withdrawals']
    
    # Remove rows with no category
    print(f"\nBefore category filter: {len(df)} rows")
    df = df[(df['Category'] != '') & (df['Category'].notna())] 
    print(f"After category filter: {len(df)} rows")
    
    # Remove rows where both withdrawals and deposits are 0 or missing
    print(f"Before amount filter: {len(df)} rows")
    valid_transactions = (df['Withdrawals'] > 0) | (df['Deposits'] > 0)
    df = df[valid_transactions]
    print(f"After amount filter: {len(df)} rows")
    
    # Drop rows with missing amounts
    df=df.dropna(subset=['Amount'])

    # Extract parts into new columns
    # Convert string columns to proper string dtype
    string_columns = ['Store', 'Category', 'Account', 'Notes']
    for col in string_columns:
        if col in df.columns:
            df[col] = df[col].astype(pd.StringDtype())

    # Drop notes column - don't need it
    df = df.drop('Notes', axis=1)

    df['Category']=df['Category'].str.title()
    df['Account']=df['Account'].str.title()

    # Calculate statistics (only for non-zero values)
    withdrawals_only = df[df['Withdrawals'] > 0]['Withdrawals']
    deposits_only = df[df['Deposits'] > 0]['Deposits']
    
    if len(withdrawals_only) > 0:
        average_withdrawal = withdrawals_only.mean()
        print(f'Average withdrawal amount: ${average_withdrawal:.2f}')
    else:
        print('No withdrawal transactions found')
    
    if len(deposits_only) > 0:
        average_deposit = deposits_only.mean()
        print(f'Average deposit amount: ${average_deposit:.2f}')
    else:
        print('No deposit transactions found')
    
    # Additional summary statistics
    print(f'\nDataset Summary:')
    print(f'Total transactions: {len(df)}')
    print(f'Date range: {df["Date"].min().strftime("%m-%d-%Y")} to {df["Date"].max().strftime("%m-%d-%Y")}')
    print(f'Total withdrawals: ${df["Withdrawals"].sum():.2f}')
    print(f'Total deposits: ${df["Deposits"].sum():.2f}')
    print(f'Net amount: ${df["Amount"].sum():.2f}')
    
    print(f'\nTransaction counts by category:')
    print(df['Category'].value_counts())
    
    # Display cleaned data sample
    print(f'\nCleaned data sample:')
    print(df.head(10))
    