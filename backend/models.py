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
from datetime import datetime, date, timezone
from werkzeug.security import generate_password_hash, check_password_hash
from typing import Optional

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
            'id': self.id, 'username': self.username, 'email': self.email,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }

class AccountModel(db.Model):
    __tablename__ = 'accounts'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    acct_id_str = db.Column(db.String(50), nullable=False)  # Your "StarBank 0101" etc.
    balance = db.Column(db.Float, default=0.0)
    acct_name = db.Column(db.String(60), nullable=False)
    
    # Relationships: One account has many transactions
    transactions = db.relationship('TransactionModel', backref='account', cascade="all, delete-orphan")
    recurring = db.relationship('RecurringModel', backref='account', cascade="all, delete-orphan")

    def to_dict(self):
        return {
            'id': self.id, 'account_id': self.acct_id_str, 'balance': self.balance,
            'transaction_count': len(self.transactions)
        }
        
class TransactionModel(db.Model):
    __tablename__ = 'transactions'
    id = db.Column(db.Integer, primary_key=True)
    account_id = db.Column(db.Integer, db.ForeignKey('accounts.id'), nullable=False)
    date = db.Column(db.Date, nullable=False, default=date.today)
    vendor = db.Column(db.String(100), nullable=False)
    category = db.Column(db.String(50), nullable=False)
    amount = db.Column(db.Float, nullable=False)
    notes = db.Column(db.Text)

    def to_dict(self):
        return {
            'id': self.id, 'date': self.date.isoformat(), 'vendor': self.vendor,
            'category': self.category, 'amount': self.amount, 'notes': self.notes
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
    frequency = db.Column(db.Integer, default=30) # days
    number = db.Column(db.Integer, default=-1)    # -1 for infinite
    current_index = db.Column(db.Integer, default=0)

    def to_dict(self):
        return {
            'id': self.id, 'date':self.date.isoformat(), 'vendor': self.vendor,
            'category': self.category, 'amount': self.amount, 'notes': self.notes,
            'next_date': self.next_date.isoformat(), 'frequency': self.frequency,
            'number': self.number, 'idx': self.idx
        }
        
        
class DatabaseManager:
    """Data Access Layer using Flask-SQLAlchemy"""

    def create_tables(self):
        """Initializes the database schema"""
        db.create_all()

    # USER OPERATIONS 
    def create_user(self, username, email, password):
        user = User(username=username, email=email)
        user.set_password(password)
        db.session.add(user)
        db.session.commit()
        return user

    def authenticate_user(self, username, password):
        user = User.query.filter_by(username=username).first()
        if user and user.verify_password(password):
            return user
        return None

    def get_user_by_id(self, user_id):
        return User.query.get(user_id)

    # ACCOUNT OPERATIONS 
    def create_account(self, user_id, acct_id_str, account_name=""):
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
        return AccountModel.query.filter_by(user_id=user_id).all()

    def get_account(self, account_id):
        return AccountModel.query.get(account_id)

    # TRANSACTION OPERATIONS 
    def add_transaction(self, account_id, date_obj, vendor, category, amount, notes=""):
        transaction = TransactionModel(
            account_id=account_id, date=date_obj, vendor=vendor,
            category=category, amount=amount, notes=notes
        )
        
        account = self.get_account(account_id)
        if account:
            account.balance += amount
            
        db.session.add(transaction)
        db.session.commit()
        return transaction

    def delete_transaction(self, transaction_id):
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
        return TransactionModel.query.filter_by(account_id=account_id).order_by(TransactionModel.date.desc()).all()

    # RECURRING OPERATIONS 
    def get_account_recurring(self, account_id):
        return RecurringModel.query.filter_by(account_id=account_id).all()

    def add_recurring(self, account_id, start_date, vendor, category, amount, next_date, frequency, number=-1, notes=""):
        rec = RecurringModel(
            account_id=account_id, start_date=start_date, vendor=vendor,
            category=category, amount=amount, next_date=next_date,
            frequency=frequency, number=number, notes=notes
        )
        db.session.add(rec)
        db.session.commit()
        return rec

    def update_recurring_after_generation(self, recurring_id, next_date: Optional[date] = None, remaining_number: Optional[int] = None):
        rec = RecurringModel.query.get(recurring_id)
        if rec:
            if next_date is not None:
                rec.next_date = next_date
            if remaining_number is not None:
                rec.number = remaining_number
            db.session.commit()

    def recalculate_account_balance(self, account_id):
        """Audit function to ensure balance matches transaction history sum"""
        account = self.get_account(account_id)
        if account:
            total = sum(t.amount for t in account.transactions)
            account.balance = total
            db.session.commit()
            return total
        return 0