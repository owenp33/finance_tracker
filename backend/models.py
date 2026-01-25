"""
models.py - SQLAlchemy Database Schema

This module defines the database structure for the finance application using SQLAlchemy.
It maps Python classes to PostgreSQL tables and handles the relationships between 
users, their bank accounts, and their financial activity.

Contains:
- User (Authentication and profile data)
- AccountModel (Individual bank accounts linked to users)
- TransactionModel (One-time historical records of income or expenses)
- RecurringModel (Rules for transactions that repeat over time)
"""
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime, date, timezone, timedelta
from werkzeug.security import generate_password_hash, check_password_hash

db = SQLAlchemy()

class User(db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(128), nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    
    # Relationship: One user can have many bank accounts
    accounts = db.relationship('AccountModel', backref='user', cascade="all, delete-orphan", lazy=True)
    
    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def verify_password(self, password):
        return check_password_hash(self.password_hash, password)

    def to_dict(self):
        return {
            'id': self.id, 'username': str(self.username), 'email': self.email,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }
        

class AccountModel(db.Model):
    __tablename__ = 'accounts'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    acct_id_str = db.Column(db.String(50), nullable=False)  # "StarBank 0101" etc.
    balance = db.Column(db.Float, default=0.0)
    acct_name = db.Column(db.String(60), nullable=False)
    
    # Relationships: One account has many transactions
    transactions = db.relationship('TransactionModel', backref='account', cascade="all, delete-orphan")
    recurring = db.relationship('RecurringModel', backref='account', cascade="all, delete-orphan")

    def to_dict(self):
        return {
            'id': self.id, 'account_id': str(self.acct_id_str), 
            'account_name': str(self.acct_name), 'balance': float(self.balance),
            'transaction_count': len(self.transactions), 'recurring_count': len(self.recurring)
        }
        
        
class TransactionModel(db.Model):
    __tablename__ = 'transactions'
    id = db.Column(db.Integer, primary_key=True)
    account_id = db.Column(db.Integer, db.ForeignKey('accounts.id'), nullable=False)
    recurring_id = db.Column(db.Integer, db.ForeignKey('recurring.id'), nullable=True)
    date = db.Column(db.Date, nullable=False)
    vendor = db.Column(db.String(100), nullable=False)
    category = db.Column(db.String(50), nullable=False)
    amount = db.Column(db.Float, nullable=False)
    notes = db.Column(db.Text)

    def to_dict(self):
        return {
            'id': self.id, 
            'date': self.date.isoformat(), 
            'vendor': self.vendor,
            'category': self.category, 
            'amount': self.amount, 
            'notes': self.notes,
            'recurring_id': self.recurring_id
        }
        

class RecurringModel(db.Model):
    __tablename__ = 'recurring'
    id = db.Column(db.Integer, primary_key=True)
    account_id = db.Column(db.Integer, db.ForeignKey('accounts.id'), nullable=False)
    start_date = db.Column(db.Date, nullable=False)
    vendor = db.Column(db.String(100), nullable=False)
    category = db.Column(db.String(50), nullable=False)
    amount = db.Column(db.Float, nullable=False)
    notes = db.Column(db.Text)
    
    # Recurring attributes
    next_date = db.Column(db.Date, nullable=False)
    frequency = db.Column(db.Integer, default=30) # days between occureences
    number = db.Column(db.Integer, default=-1)    # total occurences; -1 for infinite
    idx = db.Column(db.Integer, default=0)        # current occurrence count
    
    generated_transactions = db.relationship('TransactionModel', 
                                            foreign_keys='TransactionModel.recurring_id',
                                            backref='recurring_source',
                                            cascade="all, delete-orphan")
    
    def to_dict(self):
        return {
            'id': self.id, 'date':self.start_date.isoformat(), 'vendor': str(self.vendor),
            'category': str(self.category), 'amount': float(self.amount), 'notes': str(self.notes or ''),
            'next_date': self.next_date.isoformat(), 'frequency': int(self.frequency),
            'number': int(self.number), 'idx': int(self.idx)
        }
        

class DatabaseManager:
    """Data Access Layer using Flask-SQLAlchemy"""

    def create_tables(self):
        """Initializes the database schema"""
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

    # ACCOUNT OPERATIONS 
    def create_account(self, user_id, acct_id_str, account_name=""):
        """Create a new bank account for a user"""
        display_name = account_name if account_name else acct_id_str
        acc = AccountModel(user_id=user_id, 
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
    
    def get_bank_account(self, account_id):
        """
        Convert AccountModel to BankAccount object for compatibility with legacy code.
        This bridges the database layer with the business logic layer.
        """
        from accounts import BankAccount
        
        account_model = self.get_account(account_id)
        if not account_model:
            return None
        
        # Create BankAccount from database data
        acct_dict = {
            'acctId': account_model.acct_id_str,
            'balance': account_model.balance,
            'transactions': {},
            'recurring': {}
        }
        
        # Load transactions
        for trans in account_model.transactions:
            key = f"single_{trans.vendor}_{trans.date.isoformat()}"
            acct_dict['transactions'][key] = {
                'date': trans.date.isoformat(),
                'vendor': trans.vendor,
                'category': trans.category,
                'amount': trans.amount,
                'notes': trans.notes
            }
        
        # Load recurring
        for rec in account_model.recurring:
            key = f"recurs_{rec.vendor}_{rec.start_date.isoformat()}"
            acct_dict['recurring'][key] = {
                'start': rec.start_date.isoformat(),
                'vendor': rec.vendor,
                'category': rec.category,
                'amount': rec.amount,
                'notes': rec.notes,
                'next': rec.next_date.isoformat(),
                'frequency': rec.frequency,
                'number': rec.number
            }
        
        return BankAccount(acctInfo=acct_dict, acctId=account_model.acct_id_str)

    # TRANSACTION OPERATIONS =========================================================== 
    def add_transaction(self, account_id, date_obj, vendor, category, amount, notes="", recurring_id=None):
        """Add a new transaction and update account balance"""
        transaction = TransactionModel(
            account_id=account_id, 
            date=date_obj, 
            vendor=vendor,
            category=category, 
            amount=amount, 
            notes=notes,
            recurring_id=recurring_id  # Link back to source recurring if auto-generated
        )
        
        account = self.get_account(account_id)
        if account:
            account.balance += amount
            
        db.session.add(transaction)
        db.session.commit()
        return transaction
    
    def update_transaction(self, transaction_id, **kwargs):
        """Update transaction fields and adjust balance if amount changed"""
        trans = TransactionModel.query.get(transaction_id)
        if not trans:
            return False
        
        old_amount = trans.amount
        
        # Update allowed fields
        for key, value in kwargs.items():
            if hasattr(trans, key) and key != 'id':
                setattr(trans, key, value)
        
        # Adjust balance if amount changed
        if 'amount' in kwargs and kwargs['amount'] != old_amount:
            account = self.get_account(trans.account_id)
            if account:
                account.balance += (kwargs['amount'] - old_amount)
        
        db.session.commit()
        return trans

    def delete_transaction(self, transaction_id):
        """Delete a transaction and adjust account balance"""
        t = TransactionModel.query.get(transaction_id)
        if t:
            # Adjust balance before deleting
            account = self.get_account(t.account_id)
            if account:
                account.balance -= t.amount

            db.session.delete(t)
            db.session.commit()
            return True
        return False

    def get_account_transactions(self, account_id):
        """Get all transactions for an account, ordered by date (newest first)"""
        return TransactionModel.query.filter_by(account_id=account_id).order_by(TransactionModel.date.desc()).all()

    # RECURRING OPERATIONS =========================================================== 
    def get_account_recurring(self, account_id):
        """Get all recurring transaction templates for an account"""
        return RecurringModel.query.filter_by(account_id=account_id).all()

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

    def update_recurring(self, recurring_id, **kwargs):
        """
        Update a recurring transaction and clean up excess generated transactions.
        If 'number' is reduced, deletes auto-generated transactions that exceed the new limit.
        """
        rec = RecurringModel.query.get(recurring_id)
        if not rec:
            return False
        
        old_number = rec.number
        
        # Update fields
        if 'start_date' in kwargs:
            rec.start_date = kwargs['start_date']
        if 'vendor' in kwargs:
            rec.vendor = kwargs['vendor']
        if 'category' in kwargs:
            rec.category = kwargs['category']
        if 'amount' in kwargs:
            rec.amount = kwargs['amount']
        if 'notes' in kwargs:
            rec.notes = kwargs['notes']
        if 'next_date' in kwargs:
            rec.next_date = kwargs['next_date']
        if 'frequency' in kwargs:
            rec.frequency = kwargs['frequency']
        if 'number' in kwargs:
            rec.number = kwargs['number']
        
        # Clean up excess transactions if number was reduced
        new_number = rec.number
        if new_number != -1 and (old_number == -1 or new_number < old_number):
            # Calculate the cutoff date
            # Transactions after (start_date + frequency * (number - 1) [# occurences]) should be deleted
            cutoff_date = rec.start_date + timedelta(days=rec.frequency * (new_number - 1))
            
            # Find and delete auto-generated transactions from this recurring item that are after the cutoff date
            transactions = TransactionModel.query.filter(
                TransactionModel.recurring_id == recurring_id,
                TransactionModel.date >= cutoff_date
            ).all()
            
            for t in transactions:
                # Adjust account balance
                account = self.get_account(t.account_id)
                if account:
                    account.balance -= t.amount
                db.session.delete(t)
                
            # Reset idx to match remaining transactions
            remaining_count = TransactionModel.query.filter(
                TransactionModel.recurring_id == recurring_id
            ).count()
            rec.idx = remaining_count + 1 # idx of next occurence; stored in case "number" increases later
        
        db.session.commit()
        return rec
    
    def delete_recurring(self, recurring_id, delete_generated=False):
        """
        Delete a recurring transaction template.
        If delete_generated=True, also deletes all auto-generated transactions from this recurring.
        """
        rec = RecurringModel.query.get(recurring_id)
        if not rec:
            return False
        
        if delete_generated: # if deleting all transactions associated with recurring trans
            # Delete all transactions linked to this recurring
            transactions = TransactionModel.query.filter_by(recurring_id=recurring_id).all()
            for t in transactions:
                account = self.get_account(t.account_id)
                if account:
                    account.balance -= t.amount
                db.session.delete(t)
        else: # if deleting the recurring template
            # Unlink transactions but keep them (set recurring_id to None)
            TransactionModel.query.filter_by(recurring_id=recurring_id).update({'recurring_id': None})
        
        db.session.delete(rec)
        db.session.commit()
        return True
    
    def process_due_recurring(self, account_id):
        """
        Generate transactions for all due recurring items; called on login
        - Returns the number of transactions created
        """
        recurring_list = self.get_account_recurring(account_id)
        transactions_created = 0
        today = date.today()
        
        for rec in recurring_list:
            while rec.next_date <= today and (rec.number == -1 or rec.idx <= rec.number):
                # Create transaction from recurring
                self.add_transaction(
                    account_id=account_id,
                    date_obj=rec.next_date,
                    vendor=rec.vendor,
                    category=rec.category,
                    amount=rec.amount,
                    notes=f"Auto-generated from recurring: {rec.notes}",
                    recurring_id=rec.id  # Link back to source
                )
                
                rec.next_date = rec.advance_to_next
                transactions_created += 1
                
                if rec.number != -1 and rec.idx >= rec.number:
                    break
        
        db.session.commit()
        return transactions_created

    # UTILITY OPERATIONS =========================================================== 
    def recalculate_account_balance(self, account_id):
        """Audit function to ensure balance matches transaction history sum"""
        account = self.get_account(account_id)
        if account:
            total = sum(t.amount for t in account.transactions)
            account.balance = total
            db.session.commit()
            return total
        return 0