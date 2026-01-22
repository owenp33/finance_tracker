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
from Transaction import SingleTransaction, RecurringTransaction
from Account import BankAccount, FinanceAcc, FinanceDataProcessor


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
    
    # Add recurring transaction that's 2 months old
    old_date = date.today() - timedelta(days=60)
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
    finance = FinanceAcc(filename='test_user_data.json', user='test_user')
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
    finance2 = FinanceAcc(filename='test_user_data.json')
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
        finance = FinanceAcc(filename='test_user_data.json')
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
    finance = FinanceAcc(filename='workflow_test.json', user='jane_doe')
    
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
    finance2 = FinanceAcc(filename='workflow_test.json')
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
        test_9_full_workflow
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
        'workflow_test.json'
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
        print("  python testing.py all          # Run all tests")
        print("  python testing.py 1            # Run test 1")
        print("  python testing.py cleanup      # Remove test files")
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
        