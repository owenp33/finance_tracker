print("Starting imports...")

from flask import Flask, jsonify, render_template, request
from flask_cors import CORS
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import csv
import os
import sys
import importlib.util

print("Starting server...")

app = Flask(__name__)
CORS(app, origins=['http://localhost:3000', 'http://127.0.0.1:3000', 'null'])  # Enable CORS for frontend communication

class FinanceProcessor:
    def __init__(self, csv_file="FinanceSheet25.csv"):
        self.csv_file = csv_file # ADD MORE TYPES FOR FUTURE COMPATABILITY
        self.df = None
        
    # def read_data(self):
    #     ### more cases for non csv files but just 1 for now
    #     self.df = pd.read_csv(self.csv_file)
    
    def create_dataset(self):
        data = {
                'Date': [],
                'Store': [],
                'Category': [],
                'Expense': [],
                'Income': [],
                'Account': []
                }
        
        filename = input("Please enter your name: ")
        csv_file = filename + ".csv"
        self.csv_file = csv_file
            
        new_df = pd.DataFrame(data)
        new_df.to_csv(f"{filename}", index=False)
        print(f"{csv_file} created successfully.")
        
    def append_df(self, str_date, store, category, amount, account): # ["08/21/2025", "Target", "Grocery", "-$1,160.78", "StarBank 9023"]
        date = pd.to_datetime(str_date)
        cat = category.str.title()
        expense = ""
        income = ""
        
        amount = float(amount.str.replace('$', '', regex=False).str.replace(',', '', regex=False).str.replace('(', '', regex=False).str.replace(')', '', regex=False))
        
        if (amount < 0):
            expense = abs(float(amount))
        else:
            income = abs(float(amount))
        new_entry = [date, store, cat, expense, income, account]
        
        csvfile = self.csv_file
        try:
            with open(self.csv_file, 'a', newline='', encoding='utf-8') as file:
                temp_df = pd.read_csv(self.csv_file, nrows=0)
                fieldnames = temp_df.columns.tolist()
                
                writer = csv.DictWriter(file, fieldnames=fieldnames)
                writer.writerow(new_entry)
                
            print(f'New entry added successfully to {csvfile}')
        
        except IOError as e:
            print(f"Error writing to CSV file: {e}")
            
    def load_and_clean_data(self):
        """Load and clean the financial data"""
        try:
            # Import financial data
            self.df = pd.read_csv(self.csv_file) ## READ DATA HERE
            
            print("Original data shape:", self.df.shape)
            print("Original columns:", self.df.columns.tolist())
            
            # Convert to datetime
            self.df['Date'] = pd.to_datetime(self.df['Date'], format='%m/%d/%Y', errors='coerce') ## TYPE-FIXING
            
            # Handle string cleaning first > numeric
            for col in ['Expense', 'Income']:## TYPE-FIXING
                if self.df[col].dtype == 'object':
                    self.df[col] = self.df[col].str.replace('$', '', regex=False)
                    self.df[col] = self.df[col].str.replace(',', '', regex=False)
                    self.df[col] = pd.to_numeric(self.df[col], errors='coerce')
            
            # Fill NaN values with 0 for calculations
            self.df['Expense'] = self.df['Expense'].fillna(0)
            self.df['Income'] = self.df['Income'].fillna(0)
            
            # Create new column 'Amount' representing change in account
            self.df['Amount'] = self.df['Income'] - self.df['Expense']
            
            print(f"Before data filtering: {len(self.df)} rows")
            
            # Filter valid data
            self.df = self.df[(self.df['Category'] != '') & (self.df['Category'].notna())]
            
            # Remove rows where withdrawals, deposits and amounts are 0 or missing
            self.df = self.df[(self.df['Expense'] > 0) | (self.df['Income'] > 0)]
            self.df = self.df.dropna(subset=['Amount'])
                        
            # Clean text columns
            self.df['Category'] = self.df['Category'].str.title()
            if 'Account' in self.df.columns:
                self.df['Account'] = self.df['Account'].str.title()
                
            # Drop notes column if it exists - don't need it
            if 'Notes' in self.df.columns:
                self.df = self.df.drop('Notes', axis=1)
            
            print(f"Data processing complete: {len(self.df)} rows loaded")
            
            print(f'\nDataset Summary:')
            print(f'Total transactions: {len(self.df)}')
            if len(self.df) > 0:
                print(f'Date range: {self.df["Date"].min().strftime("%m-%d-%Y")} to {self.df["Date"].max().strftime("%m-%d-%Y")}')
            print(f'Total withdrawals: ${self.df["Expense"].sum():.2f}')
            print(f'Total deposits: ${self.df["Income"].sum():.2f}')
            print(f'Net amount: ${self.df["Amount"].sum():.2f}')
            print(f'\nTransaction counts by category:')
            if len(self.df) > 0:
                print(self.df['Category'].value_counts())
            
        except Exception as e:
            print(f"Error loading data: {e}")
            self.df = pd.DataFrame()  # Empty DataFrame as fallback
            
    def add_transaction_to_csv(self, title, category, amount, date):
        """Add a new transaction to the CSV file"""        
        try:
            print(f"Adding transaction: {title}, {category}, {amount}, {date}")
            
            # Parse the amount to determine if it's income or expense
            amount_float = float(amount)
            
            # Prepare the new row data
            if amount_float >= 0:
                expense_val = ""
                income_val = amount_float
            else:
                expense_val = abs(amount_float)
                income_val = ""
            
            # Format date to match existing format (MM/DD/YYYY)
            formatted_date = datetime.strptime(date, '%Y-%m-%d').strftime('%m/%d/%Y')
            
            # Create new row - adjust these column names to match your CSV exactly
            new_row = {
                'Date': formatted_date,
                'Description': title,  # or 'Store' if that's what your CSV uses
                'Category': category.title(),
                'Withdrawal (-)': expense_val,
                'Deposit (+)': income_val
            }
            
            # Append to CSV file
            with open(self.csv_file, 'a', newline='', encoding='utf-8') as file:
                temp_df = pd.read_csv(self.csv_file, nrows=0)
                fieldnames = temp_df.columns.tolist()
                
                writer = csv.DictWriter(file, fieldnames=fieldnames)
                writer.writerow(new_row)
            
            # Reload and reprocess the data
            self.load_and_clean_data()
            
            return True, "Transaction added successfully"
            
        except Exception as e:
            print(f"Error adding transaction: {str(e)}")
            return False, f"Error adding transaction: {str(e)}"

# Initialize the processor
finance_processor = FinanceProcessor()

@app.route('/')
@app.route('/index')
def serve_index():
    """Serve the main HTML file"""
    return render_template('index.html')

@app.route('/favicon.ico')
def favicon():
    return '', 204  # empty response

@app.route('/api/summary')
def get_summary():
    """Get overall financial summary"""
    print("API: Summary endpoint called")
    
    if finance_processor.df.empty:
        print("API: No data available in DataFrame")
        return jsonify({"error": "No data available"})
    
    df = finance_processor.df
    print(f"API: Processing {len(df)} transactions")
    
    try:
        summary = {
            "totalTransactions": len(df),
            "totalWithdrawals": float(df['Expense'].sum()),
            "totalDeposits": float(df['Income'].sum()),
            "netAmount": float(df['Amount'].sum()),
            "dateRange": {
                "start": df['Date'].min().strftime('%Y-%m-%d'),
                "end": df['Date'].max().strftime('%Y-%m-%d')
            }
        }
        print("API: Summary data prepared successfully")
        return jsonify(summary)
    except Exception as e:
        print(f"API: Error preparing summary: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/spending-by-category')
def get_spending_by_category():
    """Get spending breakdown by category for pie chart"""
    if finance_processor.df.empty:
        return jsonify({"labels": [], "data": []})
    
    df = finance_processor.df
    # Get only expenses (Expense > 0)
    expenses = df[df['Expense'] > 0]
    
    category_spending = expenses.groupby('Category')['Expense'].sum().sort_values(ascending=False)
    
    return jsonify({
        "labels": category_spending.index.tolist(),
        "data": category_spending.values.tolist()
    })


@app.route('/api/monthly-trends')
def get_monthly_trends():
    """Get monthly income vs expenses for line chart"""
    if finance_processor.df.empty:
        return jsonify({"labels": [], "income": [], "expenses": []})
    
    df = finance_processor.df
    df['YearMonth'] = df['Date'].dt.to_period('M')
    
    monthly_data = df.groupby('YearMonth').agg({
        'Income': 'sum',
        'Expense': 'sum'
    }).reset_index()
    
    return jsonify({
        "labels": [str(period) for period in monthly_data['YearMonth']],
        "income": monthly_data['Income'].tolist(),
        "expenses": monthly_data['Expense'].tolist()
    })

@app.route('/api/recent-transactions')
def get_recent_transactions():
    """Get recent transactions for the dashboard"""
    if finance_processor.df.empty:
        return jsonify([])
    
    df = finance_processor.df.sort_values('Date', ascending=False).head(10)
    
    transactions = []
    for _, row in df.iterrows():
        transactions.append({
            "date": row['Date'].strftime('%Y-%m-%d'),
            "store": str(row.get('Store', 'N/A')),
            "category": str(row['Category']),
            "amount": float(row['Amount']),
            "account": str(row.get('Account', 'N/A'))
        })
    
    return jsonify(transactions)

@app.route('/api/calendar-data')
def get_calendar_data():
    """Get future transactions for calendar (mock data for demo)"""
    # In a real app, you'd have a separate table for scheduled transactions
    # For now, we'll create some mock future data based on patterns
    
    today = datetime.now()
    calendar_events = []
    
    # Mock some recurring bills and income
    events = [
        {"title": "Salary Income", "amount": 3500, "day": 1},
        {"title": "Rent Payment", "amount": -1200, "day": 1},
        {"title": "Utilities", "amount": -150, "day": 5},
        {"title": "Insurance", "amount": -200, "day": 15},
        {"title": "Phone Bill", "amount": -80, "day": 20}
    ]
    
    # Generate for next 3 months
    for month_offset in range(3):
        for event in events:
            event_date = (today + timedelta(days=30*month_offset)).replace(day=event["day"])
            calendar_events.append({
                "date": event_date.strftime('%Y-%m-%d'),
                "title": event["title"],
                "amount": event["amount"]
            })
    
    return jsonify(calendar_events)

@app.route('/api/categories', methods=['GET'])
def get_categories():
    """Get list of existing categories for dropdown"""
    try:
        if finance_processor.df is not None and not finance_processor.df.empty:
            categories = sorted(finance_processor.df['Category'].unique().tolist())
            return jsonify({
                'success': True, 
                'categories': categories
            }), 200
        else:
            return jsonify({
                'success': True, 
                'categories': []
            }), 200
    except Exception as e:
        return jsonify({
            'success': False, 
            'message': f'Error fetching categories: {str(e)}'
        }), 500

@app.route('/api/reload-data')
def reload_data():
    """Reload the financial data from files"""
    global finance_processor
    try:
        finance_processor = FinanceProcessor()
        return jsonify({
            "success": True,
            "message": f"Data reloaded successfully. {len(finance_processor.df)} transactions loaded.",
            "transactions": len(finance_processor.df)
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "message": f"Error reloading data: {str(e)}"
        }), 500

@app.route('/api/data-info')
def get_data_info():
    """Get information about the loaded data"""
    if finance_processor.df.empty:
        return jsonify({
            "loaded": False,
            "message": "No data loaded"
        })
    
    df = finance_processor.df
    return jsonify({
        "loaded": True,
        "transactions": len(df),
        "columns": df.columns.tolist(),
        "dateRange": {
            "start": df['Date'].min().strftime('%Y-%m-%d') if 'Date' in df.columns else None,
            "end": df['Date'].max().strftime('%Y-%m-%d') if 'Date' in df.columns else None
        },
        "categories": df['Category'].unique().tolist() if 'Category' in df.columns else []
    })
    
@app.route('/api/test')
def test_api():
    """Test endpoint to verify API is working"""
    return jsonify({
        "status": "API is working",
        "dataLoaded": not finance_processor.df.empty,
        "transactionCount": len(finance_processor.df) if not finance_processor.df.empty else 0,
        "timestamp": datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    })

@app.route('/api/append', methods=['POST'])
def add_transaction():
    try:
        # Get JSON data from request
        data = request.get_json()
        
        # Validate required fields
        required_fields = ['title', 'category', 'amount', 'date']
        for field in required_fields:
            if field not in data or not data[field]:
                return jsonify({
                    'success': False, 
                    'message': f'Missing required field: {field}'
                }), 400
        
        # Extract data
        title = data['title'].strip()
        category = data['category'].strip()
        amount = data['amount']
        date = data['date']
        
        # Validate amount is a number
        try:
            float(amount)
        except ValueError:
            return jsonify({
                'success': False, 
                'message': 'Amount must be a valid number'
            }), 400
        
        # Validate date format (expects YYYY-MM-DD)
        try:
            datetime.strptime(date, '%Y-%m-%d')
        except ValueError:
            return jsonify({
                'success': False, 
                'message': 'Date must be in YYYY-MM-DD format'
            }), 400
        
        # Add transaction to CSV
        success, message = finance_processor.add_transaction_to_csv(title, category, amount, date)
        
        if success:
            return jsonify({
                'success': True, 
                'message': message
            }), 200
        else:
            return jsonify({
                'success': False, 
                'message': message
            }), 500
            
    except Exception as e:
        return jsonify({
            'success': False, 
            'message': f'Server error: {str(e)}'
        }), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)