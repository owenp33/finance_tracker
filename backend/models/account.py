"""
account.py - Bank Account Model
"""
from app import db

class AccountModel(db.Model):
    __tablename__ = 'accounts'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    acct_id_str = db.Column(db.String(50), nullable=False)
    balance = db.Column(db.Float, default=0.0)
    acct_name = db.Column(db.String(60), nullable=False)
    
    # Relationships: One account has many transactions
    transactions = db.relationship('TransactionModel', backref='account', cascade="all, delete-orphan")
    recurring = db.relationship('RecurringModel', backref='account', cascade="all, delete-orphan")

    def to_dict(self):
        return {
            'id': self.id,
            'account_id': str(self.acct_id_str),
            'account_name': str(self.acct_name),
            'balance': float(self.balance),
            'transaction_count': len(self.transactions),
            'recurring_count': len(self.recurring)
        }