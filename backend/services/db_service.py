"""
db_service.py - Data Access Layer

Thin CRUD operations for interacting with the database.
Business logic and orchestration belong in account_service.py.
"""
from app import db
from models.user import User
from models.account import AccountModel
from models.transaction import TransactionModel
from models.recurring import RecurringModel


class DbService:

    def create_tables(self):
        """Initialize the database schema"""
        db.create_all()

    # USER OPERATIONS ===========================================================

    def create_user(self, username, email, password):
        """Create a new user with hashed password"""
        user = User(username=username, email=email)
        user.set_password(password)
        db.session.add(user)
        db.session.commit()
        return user

    def authenticate_user(self, username, password):
        """Verify user credentials and return User object if valid"""
        user = User.query.filter_by(username=username).first()
        if user and user.verify_password(password):
            return user
        return None

    def get_user_by_id(self, user_id):
        """Retrieve user by ID"""
        return User.query.get(user_id)

    # ACCOUNT OPERATIONS ========================================================

    def create_account(self, user_id, acct_id_str, account_name=""):
        """Create a new bank account for a user"""
        display_name = account_name if account_name else acct_id_str
        acc = AccountModel(
            user_id=user_id,
            acct_id_str=acct_id_str,
            acct_name=display_name,
            balance=0.0
        )
        db.session.add(acc)
        db.session.commit()
        return acc

    def get_user_accounts(self, user_id):
        """Get all accounts belonging to a user"""
        return AccountModel.query.filter_by(user_id=user_id).all()

    def get_account(self, account_id):
        """Get account by ID"""
        return AccountModel.query.get(account_id)

    # TRANSACTION OPERATIONS ====================================================

    def add_transaction(self, account_id, date_obj, vendor, category, amount, notes="", recurring_id=None):
        """Add a new transaction and update account balance"""
        transaction = TransactionModel(
            account_id=account_id,
            date=date_obj,
            vendor=vendor,
            category=category,
            amount=amount,
            notes=notes,
            recurring_id=recurring_id
        )

        account = self.get_account(account_id)
        if account:
            account.balance += amount

        db.session.add(transaction)
        db.session.commit()
        return transaction

    def get_transaction(self, transaction_id):
        """Get a transaction by ID"""
        return TransactionModel.query.get(transaction_id)

    def get_account_transactions(self, account_id):
        """Get all transactions for an account, ordered by date (newest first)"""
        return TransactionModel.query.filter_by(account_id=account_id).order_by(TransactionModel.date.desc()).all()

    # RECURRING OPERATIONS ======================================================

    def add_recurring(self, account_id, start_date, vendor, category, amount, next_date, frequency, number=-1, notes=""):
        """Create a new recurring transaction template"""
        rec = RecurringModel(
            account_id=account_id,
            start_date=start_date,
            vendor=vendor,
            category=category,
            amount=amount,
            next_date=next_date,
            frequency=frequency,
            number=number,
            notes=notes,
            idx=1
        )
        db.session.add(rec)
        db.session.commit()
        return rec

    def get_recurring(self, recurring_id):
        """Get a recurring template by ID"""
        return RecurringModel.query.get(recurring_id)

    def get_account_recurring(self, account_id):
        """Get all recurring transaction templates for an account"""
        return RecurringModel.query.filter_by(account_id=account_id).all()