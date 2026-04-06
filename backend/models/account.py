"""
account.py - Bank Account Model
"""
from extensions import db
class AccountModel(db.Model):
    __tablename__ = 'accounts'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    acct_id_str = db.Column(db.String(24), nullable=False) #Discover 1234
    acct_name = db.Column(db.String(40), nullable=False) #Owen's Credit Card
    balance_cents = db.Column(db.Integer, default=0)  # Was: balance (Float)
    
    # Relationships: One account has many transactions
    transactions = db.relationship('TransactionModel', backref='account', cascade="all, delete-orphan")
    recurring = db.relationship('RecurringModel', backref='account', cascade="all, delete-orphan")

    @property
    def balance(self):
        """Convert cents to dollars"""
        return self.balance_cents / 100.0
    
    @balance.setter
    def balance(self, dollars):
        """Convert dollars to cents"""
        self.balance_cents = int(round(dollars * 100))
    
    def to_dict(self):
        return {
            'id': self.id,
            'account_id': str(self.acct_id_str),
            'account_name': str(self.acct_name),
            'balance': self.balance,
            'transaction_count': len(self.transactions),
            'recurring_count': len(self.recurring)
        }