"""
tests.py - Comprehensive test suite for finance app data processing
Location: data-processing/testing.py

Run tests with:
    python testing.py all          # Run all tests
    python testing.py 1            # Run specific test
    python testing.py cleanup      # Remove test files
"""

from datetime import date, timedelta
import json
import os
import sys

# Import your classes
from transactions import SingleTransaction, RecurringTransaction
from accounts import BankAccount, FinanceAccount, FinanceDataProcessor


# ==================== TEST DATA ====================

def create_sample_csv_files():
    """Create sample CSV files for testing"""
    
    # Format 1: expense/income columns
    csv_format1 = """date,store,category,expense,income,account,notes
01/01/2025,Shelby Jackson LLC,Rent,985.41,,StarBank 0101,Monthly rent payment
01/17/2025,University of MN,Loan,,"3,987.63",StarBank 0101,Student loan disbursement
01/23/2025,Fresh Thyme,Grocery,51.71,,StarBank 0101,Weekly groceries
01/24/2025,Employer,Income,,"3,292.37",StarBank 0101,Bi-weekly paycheck
01/25/2025,Target,Shopping,87.43,,StarBank 0101,Household items
01/26/2025,Shell Gas Station,Transportation,45.00,,StarBank 0101,Gas fill-up
01/27/2025,Netflix,Entertainment,15.99,,StarBank 0101,Monthly subscription
01/28/2025,Whole Foods,Grocery,63.21,,StarBank 0101,Organic produce
02/01/2025,Rent Payment,Housing,1500.00,,StarBank 0101,Monthly rent
02/05/2025,Amazon,Shopping,124.56,,StarBank 0101,Various items"""

    # Format 2: single amount column
    csv_format2 = """date,store,category,amount,account,notes
01/01/2025,Shelby Jackson LLC,Rent,-985.41,StarBank 0101,Monthly rent payment
01/17/2025,University of MN,Loan,3987.63,StarBank 0101,Student loan disbursement
01/23/2025,Fresh Thyme,Grocery,-51.71,StarBank 0101,Weekly groceries
01/24/2025,Employer,Income,3292.37,StarBank 0101,Bi-weekly paycheck"""

    with open('test_format1.csv', 'w') as f:
        f.write(csv_format1)
    
    with open('test_format2.csv', 'w') as f:
        f.write(csv_format2)
    
    print("Created sample CSV files: test_format1.csv, test_format2.csv")


# ==================== TESTS ====================

def test_1_transaction_classes():
    """Test 1: Transaction class creation and methods"""
    print("\n" + "="*60)
    print("TEST 1: Transaction Classes")
    print("="*60)
    
    # Test SingleTransaction
    print("\nTesting SingleTransaction")
    trans = SingleTransaction(
        day=date(2025, 1, 15),
        vend="Grocery Store",
        cat="Food",
        amnt=-50.00,
        desc="Weekly shopping"
    )
    
    print(f"Created SingleTransaction:")
    print(f"Vendor: {trans.get_vendor()}")
    print(f"Amount: ${trans.get_amount():.2f}")
    print(f"Category: {trans.get_category()}")
    print(f"Date: {trans.get_date()}")
    
    # Test editing
    trans.edit(amnt=-75.00, desc="Updated shopping trip")
    print(f"After edit:")
    print(f"Amount: ${trans.get_amount():.2f}")
    print(f"Notes: {trans.get_notes()}")
    
    # Test return_dict
    trans_dict = trans.return_dict()
    print(f"Dictionary representation:")
    print(f"{trans_dict}")
    
    # Test RecurringTransaction
    print("\nTesting RecurringTransaction")
    rent = RecurringTransaction(
        day=date(2025, 1, 1),
        vend="Landlord",
        cat="Housing",
        amnt=-1500.00,
        desc="Monthly rent",
        nxt=date(2025, 2, 1),
        freq=30,
        num=-1
    )
    
    print(f"Created RecurringTransaction:")
    print(f"Vendor: {rent.get_vendor()}")
    print(f"Amount: ${rent.get_amount():.2f}")
    print(f"Next date: {rent.next}")
    print(f"Frequency: {rent.frequency} days")
    
    # Test get_remaining_dates
    upcoming = rent.get_remaining_dates(3)
    print(f"Next 3 occurrences: {[d.isoformat() for d in upcoming]}")
    
    # Test advance_to_next
    old_next = rent.next
    rent.advance_to_next()
    print(f"Advanced from {old_next} to {rent.next}")
    
    print("\n✅ TEST 1: PASSED")


def test_2_bank_account():
    """Test 2: BankAccount class"""
    print("\n" + "="*60)
    print("TEST 2: BankAccount Class")
    print("="*60)
    
    # Create new account
    account = BankAccount(acctId='Checking_1234')
    print(f"\nCreated BankAccount: {account.acctId}")
    
    # Add transactions
    account.add_transaction(SingleTransaction(
        day=date(2025, 1, 15),
        vend="Salary",
        cat="Income",
        amnt=3000.00,
        desc="Monthly salary"
    ))
    
    account.add_transaction(SingleTransaction(
        day=date(2025, 1, 16),
        vend="Grocery Store",
        cat="Food",
        amnt=-150.00,
        desc="Shopping"
    ))
    
    account.add_transaction(SingleTransaction(
        day=date(2025, 1, 17),
        vend="Gas Station",
        cat="Transportation",
        amnt=-45.00,
        desc="Fill up"
    ))
    
    print(f"Added 3 transactions")
    print(f"Balance: ${account.get_balance():.2f}")
    print(f"Transaction count: {len(account.transactions)}")
    
    # Test recalculate_balance
    old_balance = account.balance
    account.balance = 0  # Mess it up
    recalculated = account.recalculate_balance()
    print(f"Recalculated balance: ${old_balance:.2f} → ${recalculated:.2f}")
    
    # Test get_transactions_df
    df = account.get_transactions_df()
    print(f"\nTransactions DataFrame:")
    if not df.empty:
        print(df[['date', 'vendor', 'category', 'amount']].to_string(index=False))
    
    # Test return_dict
    account_dict = account.return_dict()
    print(f"\nAccount has {len(account_dict['transactions'])} transactions in dict")
    
    print("\n✅ TEST 2: PASSED")


def test_3_recurring_update():
    """Test 3: Recurring transaction update mechanism"""
    print("\n" + "="*60)
    print("TEST 3: Recurring Transaction Update")
    print("="*60)
    
    # Create account
    account = BankAccount(acctId='Test_Account')
    
    # Add recurring transaction that's less than 2 months old
    old_date = date.today() - timedelta(days=57)
    rent = RecurringTransaction(
        day=old_date,
        vend="Landlord",
        cat="Housing",
        amnt=-1500.00,
        desc="Monthly rent",
        nxt=old_date,
        freq=30,
        num=-1  # Infinite
    )
    account.add_recurring(rent)
    
    print(f"\nAdded recurring rent (started {old_date})")
    print(f"Current balance: ${account.get_balance():.2f}")
    print(f"Transactions: {len(account.transactions)}")
    
    # Update recurring transactions
    count = account.update_recurring()
    
    print(f"\nUpdate generated {count} transactions")
    print(f"New balance: ${account.get_balance():.2f}")
    print(f"Total transactions: {len(account.transactions)}")
    print(f"Next rent payment: {rent.next}")
    
    # Verify the count is correct (should be 2 for 60 days / 30 days)
    assert count == 2, f"Expected 2 transactions, got {count}"
    
    print("\n✅ TEST 3: PASSED")


def test_4_csv_loading():
    """Test 4: CSV data loading"""
    print("\n" + "="*60)
    print("TEST 4: CSV Loading")
    print("="*60)
    
    # Create sample CSVs if they don't exist
    if not os.path.exists('test_format1.csv'):
        create_sample_csv_files()
    
    # Test Format 1: expense/income columns
    print("\nTesting Format 1 (expense/income columns)")
    df1 = FinanceDataProcessor.load_csv('test_format1.csv')
    print(f"Loaded {len(df1)} transactions")
    print(f"Columns: {list(df1.columns)}")
    print(f"\nFirst 3 transactions:")
    print(df1[['date', 'store', 'category', 'amount']].head(3).to_string(index=False))
    
    # Verify amount calculation
    first_row = df1.iloc[0]
    print(f"\nAmount calculation check:")
    print(f"Store: {first_row['store']}")
    print(f"Expense: {first_row.get('expense', 0)}")
    print(f"Income: {first_row.get('income', 0)}")
    print(f"Calculated amount: {first_row['amount']:.2f}")
    
    # Test Format 2: amount column
    print("\nTesting Format 2 (amount column)")
    df2 = FinanceDataProcessor.load_csv('test_format2.csv')
    print(f"Loaded {len(df2)} transactions")
    print(f"\nFirst 3 transactions:")
    print(df2[['date', 'store', 'category', 'amount']].head(3).to_string(index=False))
    
    print("\n✅ TEST 4: PASSED")


def test_5_csv_to_account():
    """Test 5: Create BankAccount from CSV"""
    print("\n" + "="*60)
    print("TEST 5: CSV to BankAccount")
    print("="*60)
    
    # Ensure CSV exists
    if not os.path.exists('test_format1.csv'):
        create_sample_csv_files()
    
    # Create account from CSV
    account = FinanceDataProcessor.csv_to_account('test_format1.csv', 'StarBank_0101')
    
    print(f"\nCreated account from CSV:")
    print(f"Account ID: {account.acctId}")
    print(f"Balance: ${account.get_balance():.2f}")
    print(f"Transactions: {len(account.transactions)}")
    
    # Show summary
    df = account.get_transactions_df()
    if not df.empty:
        total_income = df[df['amount'] > 0]['amount'].sum()
        total_expenses = abs(df[df['amount'] < 0]['amount'].sum())
        print(f"\nTotal Income: ${total_income:.2f}")
        print(f"Total Expenses: ${total_expenses:.2f}")
        print(f"Net: ${total_income - total_expenses:.2f}")
    
    print("\n✅ TEST 5: PASSED")


def test_6_finance_acc():
    """Test 6: FinanceAcc multi-account management"""
    print("\n" + "="*60)
    print("TEST 6: FinanceAcc Class")
    print("="*60)
    
    # Create FinanceAcc
    finance = FinanceAccount(filename='test_user_data.json', user='test_user')
    print(f"\nCreated FinanceAcc for user: {finance.user}")
    
    # Add accounts
    checking = BankAccount(acctId='Checking')
    savings = BankAccount(acctId='Savings')
    
    # Add some transactions
    checking.add_transaction(SingleTransaction(
        day=date(2025, 1, 15),
        vend="Employer",
        cat="Salary",
        amnt=5000.00,
        desc="Monthly salary"
    ))
    
    checking.add_transaction(SingleTransaction(
        day=date(2025, 1, 16),
        vend="Transfer to Savings",
        cat="Transfer",
        amnt=-1000.00,
        desc="Savings transfer"
    ))
    
    savings.add_transaction(SingleTransaction(
        day=date(2025, 1, 16),
        vend="Transfer from Checking",
        cat="Transfer",
        amnt=1000.00,
        desc="Savings deposit"
    ))
    
    finance.add_account('Checking', checking)
    finance.add_account('Savings', savings)
    
    print(f"\nAdded 2 accounts:")
    for acct_id in finance.list_accounts():
        acct = finance.get_account(acct_id)
        print(f"{acct_id}: ${acct.get_balance():.2f} ({len(acct.transactions)} transactions)")
    
    print(f"\nTotal Balance: ${finance.get_total_balance():.2f}")
    
    # Save to file
    finance.save_to_file()
    print(f"Saved to {finance.filename}")
    
    # Load from file
    finance2 = FinanceAccount(filename='test_user_data.json')
    print(f"Loaded from file: {finance2.user}")
    print(f"Accounts: {finance2.list_accounts()}")
    print(f"Total Balance: ${finance2.get_total_balance():.2f}")
    
    print("\n✅ TEST 6: PASSED")


def test_7_data_analytics():
    """Test 7: Data analytics functions"""
    print("\n" + "="*60)
    print("TEST 7: Data Analytics")
    print("="*60)
    
    # Create account with test data
    if not os.path.exists('test_format1.csv'):
        create_sample_csv_files()
    
    account = FinanceDataProcessor.csv_to_account('test_format1.csv', 'StarBank_0101')
    
    # Spending by category
    print("\n[Spending by Category]")
    spending = FinanceDataProcessor.get_spending_by_category(account)
    if not spending.empty:
        print(spending.to_string())
    else:
        print("No spending data")
    
    # Income by category
    print("\n[Income by Category]")
    income = FinanceDataProcessor.get_income_by_category(account)
    if not income.empty:
        print(income.to_string())
    else:
        print("No income data")
    
    # Monthly summary
    print("\n[Monthly Summary]")
    monthly = FinanceDataProcessor.get_monthly_summary(account)
    if not monthly.empty:
        print(monthly.to_string())
    else:
        print("No monthly data")
    
    # Daily balance
    print("\n[Daily Balance (last 5 days)]")
    daily = FinanceDataProcessor.get_daily_balance(account)
    if not daily.empty:
        print(daily.tail().to_string(index=False))
    
    print("\n✅ TEST 7: PASSED")


def test_8_export_for_frontend():
    """Test 8: Export data for frontend"""
    print("\n" + "="*60)
    print("TEST 8: Export for Frontend")
    print("="*60)
    
    # Load test data
    if os.path.exists('test_user_data.json'):
        finance = FinanceAccount(filename='test_user_data.json')
    else:
        print("  Skipping - run test 6 first")
        return
    
    # Export
    export_data = finance.export_for_frontend()
    
    # Save to file
    with open('frontend_export.json', 'w') as f:
        json.dump(export_data, f, indent=2, default=str)
    
    print(f"\nExported data to frontend_export.json")
    print(f"User: {export_data['user']}")
    print(f"Total Balance: ${export_data['total_balance']:.2f}")
    print(f"Accounts: {list(export_data['accounts'].keys())}")
    
    for acct_id, acct_data in export_data['accounts'].items():
        print(f"\n  {acct_id}:")
        print(f"    Balance: ${acct_data['balance']:.2f}")
        print(f"    Transactions: {acct_data['transaction_count']}")
        print(f"    Recurring: {acct_data['recurring_count']}")
    
    print("\n✅ TEST 8: PASSED")


def test_9_full_workflow():
    """Test 9: Complete workflow simulation"""
    print("\n" + "="*60)
    print("TEST 9: Full Workflow Simulation")
    print("="*60)
    
    # 1. Create new user
    print("\n1. Creating new user account...")
    finance = FinanceAccount(filename='workflow_test.json', user='jane_doe')
    
    # 2. Import CSV
    print("2. Importing CSV transactions...")
    if not os.path.exists('test_format1.csv'):
        create_sample_csv_files()
    finance.import_csv('test_format1.csv', acct_id='Primary_Checking')
    
    # 3. Add recurring transactions
    print("3. Adding recurring transactions...")
    account = finance.get_account('Primary_Checking')
    
    rent = RecurringTransaction(
        day=date(2025, 1, 1),
        vend="Apartment Complex",
        cat="Housing",
        amnt=-1500.00,
        nxt=date(2025, 3, 1),
        freq=30,
        num=-1
    )
    account.add_recurring(rent)
    
    netflix = RecurringTransaction(
        day=date(2025, 1, 15),
        vend="Netflix",
        cat="Entertainment",
        amnt=-15.99,
        nxt=date(2025, 3, 15),
        freq=30,
        num=-1
    )
    account.add_recurring(netflix)
    
    print(f"   Added {len(account.recurring)} recurring transactions")
    
    # 4. Save
    print("4. Saving to file...")
    finance.save_to_file()
    
    # 5. Simulate login (reload and update)
    print("5. Simulating user login...")
    finance2 = FinanceAccount(filename='workflow_test.json')
    results = finance2.login_update()
    print(f"   Generated {sum(results.values())} recurring transactions")
    
    # 6. Get summary
    print("\n6. Account Summary:")
    print(finance2.get_summary())
    
    # 7. Export for frontend
    print("7. Exporting for frontend...")
    export_data = finance2.export_for_frontend()
    print(f"   Total balance: ${export_data['total_balance']:.2f}")
    
    finance2.save_to_file()
    
    print("\n✅ TEST 9: PASSED - Full workflow completed!")


def test_10_generate_api_report():
    """Test 10: Generate API analytics report"""
    print("\n" + "="*60)
    print("TEST 10: Generate API Report")
    print("="*60)
    
    from datetime import date, timedelta
    
    # Create mock TransactionModel objects
    class MockTransaction:
        def __init__(self, id, date, vendor, category, amount, notes=''):
            self.id = id
            self.date = date
            self.vendor = vendor
            self.category = category
            self.amount = amount
            self.notes = notes
    
    # Create test transactions
    today = date.today()
    mock_transactions = [
        MockTransaction(1, today - timedelta(days=30), "Salary", "Income", 3000.00),
        MockTransaction(2, today - timedelta(days=25), "Grocery Store", "Food", -150.00),
        MockTransaction(3, today - timedelta(days=20), "Gas Station", "Transportation", -45.00),
        MockTransaction(4, today - timedelta(days=15), "Netflix", "Entertainment", -15.99),
        MockTransaction(5, today - timedelta(days=10), "Target", "Shopping", -87.50),
        MockTransaction(6, today - timedelta(days=5), "Rent", "Housing", -1500.00),
        MockTransaction(7, today - timedelta(days=3), "Amazon", "Shopping", -124.99),
        MockTransaction(8, today - timedelta(days=1), "Restaurant", "Food", -65.00),
    ]
    
    # Generate report
    report = FinanceDataProcessor.generate_api_report(mock_transactions)
    
    print("\nReport generated successfully!")
    
    # Display summary
    print("\nSummary")
    for key, value in report['summary'].items():
        print(f"  {key}: {value}")
    
    # Display spending by category
    print("\n Spending by Category")
    for category, data in report['spending_by_category'].items():
        print(f"  {category}: ${data['total']} ({data['count']} transactions)")
    
    # Display monthly summary
    print("\n Monthly Summary")
    for month, data in report['monthly_summary'].items():
        print(f"  {month}:")
        print(f"    Income: ${data['income']}")
        print(f"    Expenses: ${data['expenses']}")
        print(f"    Net: ${data['net']}")
    
    # Display trends
    print("\n Trends")
    print(f"  Weekly avg expenses: ${report['trends']['weekly_avg_expenses']}")
    print(f"  Weekly avg income: ${report['trends']['weekly_avg_income']}")
    
    # Verify structure
    assert 'summary' in report
    assert 'spending_by_category' in report
    assert 'income_by_category' in report
    assert 'monthly_summary' in report
    assert 'recent_transactions' in report
    assert 'top_vendors' in report
    assert 'trends' in report
    
    print("\n✅ TEST 10: PASSED - Analytics report working!")
    
def test_11_delete_transaction():
    """Test 11: Delete transaction and verify balance update"""
    print("\n" + "="*60)
    print("TEST 11: Delete Transaction")
    print("="*60)
    
    # Create account with some transactions
    account = BankAccount(acctId='Test_Delete')
    
    # Add multiple transactions and track them
    trans1 = SingleTransaction(
        day=date(2025, 1, 15),
        vend="Salary",
        cat="Income",
        amnt=3000.00,
        desc="Monthly salary"
    )
    
    trans2 = SingleTransaction(
        day=date(2025, 1, 16),
        vend="Grocery Store",
        cat="Food",
        amnt=-150.00,
        desc="Weekly shopping"
    )
    
    trans3 = SingleTransaction(
        day=date(2025, 1, 17),
        vend="Gas Station",
        cat="Transportation",
        amnt=-45.00,
        desc="Fill up"
    )
    
    account.add_transaction(trans1)
    account.add_transaction(trans2)
    account.add_transaction(trans3)
    
    print(f"\nInitial state:")
    print(f"  Transactions: {len(account.transactions)}")
    print(f"  Balance: ${account.get_balance():.2f}")
    
    # Get the key for trans2 to delete it
    trans2_key = f"single_{trans2.get_vendor()}_{trans2.get_date().isoformat()}"
    
    # Verify transaction exists
    assert trans2_key in account.transactions, f"Transaction key '{trans2_key}' not found"
    print(f"\n  Found transaction to delete: {trans2.get_vendor()}")
    
    # Store balance before deletion
    balance_before = account.get_balance()
    trans2_amount = trans2.get_amount()
    
    # Delete the transaction
    print(f"\nDeleting transaction: {trans2.get_vendor()} (${trans2_amount:.2f})")
    del account.transactions[trans2_key]
    
    # Recalculate balance after deletion
    account.recalculate_balance()
    balance_after = account.get_balance()
    
    print(f"\nAfter deletion:")
    print(f"  Transactions: {len(account.transactions)}")
    print(f"  Balance before: ${balance_before:.2f}")
    print(f"  Balance after: ${balance_after:.2f}")
    print(f"  Expected balance: ${balance_before - trans2_amount:.2f}")
    
    # Verify transaction was deleted
    assert trans2_key not in account.transactions, "Transaction still exists after deletion"
    assert len(account.transactions) == 2, f"Expected 2 transactions, got {len(account.transactions)}"
    
    # Verify balance updated correctly
    expected_balance = balance_before - trans2_amount
    assert abs(balance_after - expected_balance) < 0.01, \
        f"Balance incorrect: expected ${expected_balance:.2f}, got ${balance_after:.2f}"
    
    # Verify remaining transactions are correct
    print(f"\nRemaining transactions:")
    for key, trans in account.transactions.items():
        print(f"  {trans.get_vendor()}: ${trans.get_amount():.2f}")
    
    # Test deleting from FinanceAccount with save/load
    print(f"\n[Testing with FinanceAccount persistence]")
    finance = FinanceAccount(filename='test_delete.json', user='delete_test')
    finance.add_account('TestAcct', account)
    
    # Save with 2 transactions
    finance.save_to_file()
    print(f"  Saved account with {len(account.transactions)} transactions")
    
    # Load and verify
    finance2 = FinanceAccount(filename='test_delete.json')
    loaded_account = finance2.get_account('TestAcct')
    
    assert len(loaded_account.transactions) == 2, \
        f"Loaded account should have 2 transactions, got {len(loaded_account.transactions)}"
    assert abs(loaded_account.get_balance() - balance_after) < 0.01, \
        "Loaded account balance doesn't match"
    
    print(f"  Loaded account verified: {len(loaded_account.transactions)} transactions, ${loaded_account.get_balance():.2f}")
    
    # Cleanup
    if os.path.exists('test_delete.json'):
        os.remove('test_delete.json')
    
    print("\n✅ TEST 11: PASSED")
    
    
def test_12_recurring_deletion():
    """Test 12: Recurring transaction update mechanism"""
    print("\n" + "="*60)
    print("TEST 12: Recurring Transaction Deletion")
    print("="*60)
    
    # Create account
    account = BankAccount(acctId='Test_Account')
    
    # Add recurring transaction that's less than 2 months old
    old_date = date.today() - timedelta(days=755)
    rent = RecurringTransaction(
        day=old_date,
        vend="Landlord",
        cat="Housing",
        amnt=-900.00,
        desc="Monthly rent",
        nxt=old_date,
        freq=30,
        num=-1  # Infinite
    )
    account.add_recurring(rent)
    
    print(f"\nAdded recurring rent (started {old_date})")
    print(f"Current balance: ${account.get_balance():.2f}")
    print(f"Transactions: {len(account.transactions)}")
    
    # Update recurring transactions
    count = account.update_recurring()
    
    print(f"\nFirst update generated {count} transactions")
    print(f"Balance after generation: ${account.get_balance():.2f}")
    print(f"Total transactions: {len(account.transactions)}")
    print(f"Next rent payment: {rent.next}")
    print(f"Recurring idx: {rent.idx}")
    
    # Verify the count is correct (should be 26)
    expected_first = (755 // 30) + 1
    assert count == expected_first, f"Expected ~{expected_first} transactions, got {count}"
    
    # Store the count before editing
    transactions_before_edit = len(account.transactions)
    balance_before_edit = account.get_balance()
    
    print("EDITING: Changing number from -1 (infinite) to 12")
    
    # Edit to limit to only 12 occurrences
    # This should DELETE transactions #13 onwards
    rent.edit(num=12)
    
    # Call update again - this should:
    # 1. Not generate new transactions (none are due)
    # 2. Remove transactions beyond the 12th occurrence
    count_after = account.update_recurring()
    
    print(f"\nSecond update generated {count_after} new transactions")
    print(f"Balance after edit: ${account.get_balance():.2f}")
    print(f"Total transactions: {len(account.transactions)}")
    print(f"Next rent payment: {rent.next}")
    print(f"Recurring idx: {rent.idx}")
    
    # Verify:
    # - No new transactions were generated (count_after should be 0)
    # - Total transactions should now be 12
    # - Balance should reflect only 12 payments of -900
    assert count_after == 0, f"Expected 0 new transactions, got {count_after}"
    assert len(account.transactions) == 12, f"Expected 12 total transactions, got {len(account.transactions)}"
    
    expected_balance = 12 * -900.00
    assert abs(account.get_balance() - expected_balance) < 0.01, \
        f"Expected balance ${expected_balance:.2f}, got ${account.get_balance():.2f}"
    
    # Verify the 12th transaction date
    twelfth_occurrence_date = old_date + timedelta(days=30 * 11)  # 0-indexed: 11 = 12th occurrence
    print(f"\n12th occurrence should be around: {twelfth_occurrence_date}")
    
    # Verify next is set correctly (should be after the 12th occurrence)
    print(f"Recurring 'next' date: {rent.next}")
    print(f"Recurring idx (should be 12 or more): {rent.idx}")
    
    print(f"\nTransactions deleted: {transactions_before_edit - len(account.transactions)}")
    print(f"Balance change: ${balance_before_edit:.2f} -> ${account.get_balance():.2f}")
    print(f"Amount recovered: ${balance_before_edit - account.get_balance():.2f}")
    
    print("\n✅ TEST 12: PASSED")


# ==================== TEST RUNNER ====================

def run_all_tests():
    """Run all tests in sequence"""
    print("\n" + "="*60)
    print("FINANCE APP - COMPLETE TEST SUITE")
    print("="*60)
    
    tests = [
        test_1_transaction_classes,
        test_2_bank_account,
        test_3_recurring_update,
        test_4_csv_loading,
        test_5_csv_to_account,
        test_6_finance_acc,
        test_7_data_analytics,
        test_8_export_for_frontend,
        test_9_full_workflow,
        test_10_generate_api_report,
        test_11_delete_transaction,
        test_12_recurring_deletion
    ]
    
    passed = 0
    failed = 0
    
    for test_func in tests:
        try:
            test_func()
            passed += 1
        except Exception as e:
            failed += 1
            print(f"\n❌ TEST FAILED: {test_func.__name__}")
            print(f"   Error: {e}")
            import traceback
            traceback.print_exc()
    
    print("\n" + "="*60)
    print(f"TEST SUMMARY: {passed} passed, {failed} failed")
    print("="*60)


def cleanup_test_files():
    """Remove test files"""
    files = [
        'test_format1.csv',
        'test_format2.csv',
        'test_user_data.json',
        'frontend_export.json',
        'workflow_test.json',
        'test_delete.json'
    ]
    
    print("\nCleaning up test files...")
    for file in files:
        try:
            os.remove(file)
            print(f"  Removed {file}")
        except FileNotFoundError:
            print(f"  {file} not found")
    
    print("\nCleanup complete")


# ==================== MAIN ====================

if __name__ == '__main__':
    if len(sys.argv) > 1:
        command = sys.argv[1]
        
        if command == 'all':
            create_sample_csv_files()
            run_all_tests()
        elif command == 'cleanup':
            cleanup_test_files()
        elif command.isdigit():
            # Run specific test
            test_num = int(command)
            test_func = globals().get(f'test_{test_num}')
            if test_func:
                if test_num >= 4:  # Tests that need CSV files
                    create_sample_csv_files()
                test_func()
            else:
                print(f"Test {test_num} not found")
        else:
            print(f"Unknown command: {command}")
    else:
        print("Finance App Testing Suite")
        print("=" * 60)
        print("\nUsage:")
        print("  python tests.py all          # Run all tests")
        print("  python tests.py 1            # Run test 1")
        print("  python tests.py cleanup      # Remove test files")
        print("\nAvailable tests:")
        print("  1: Transaction classes")
        print("  2: BankAccount class")
        print("  3: Recurring transaction update")
        print("  4: CSV loading")
        print("  5: CSV to BankAccount")
        print("  6: FinanceAcc multi-account")
        print("  7: Data analytics")
        print("  8: Export for frontend")
        print("  9: Full workflow simulation")
        print("  10: Full API analytics report")
        print("  11: Delete transaction")
        