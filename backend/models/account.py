"""
account.py - Bank Account Model
"""
from extensions import db
class AccountModel(db.Model):
    __tablename__ = 'accounts'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    acct_id_str = db.Column(db.String(100), nullable=False) #Discover 1234 (imports match on this or the name)
    acct_name = db.Column(db.String(100), nullable=False) #Owen's Credit Card
    balance_cents = db.Column(db.Integer, default=0)  # opening_balance_cents + the sum of the account's transactions
    opening_balance_cents = db.Column(db.Integer, nullable=False, default=0)  # held before its earliest transaction here
    needs_attention = db.Column(db.Boolean, nullable=False, default=False)  # created by an import, not yet reviewed

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

    @property
    def opening_balance(self):
        """Convert cents to dollars"""
        return self.opening_balance_cents / 100.0

    @opening_balance.setter
    def opening_balance(self, dollars):
        """Convert dollars to cents"""
        self.opening_balance_cents = int(round(dollars * 100))

    def to_dict(self):
        return {
            'id': self.id,
            'account_id': str(self.acct_id_str),
            'account_name': str(self.acct_name),
            'balance': self.balance,
            'opening_balance': self.opening_balance,
            'transaction_count': len(self.transactions),
            'recurring_count': len(self.recurring),
            'needs_attention': bool(self.needs_attention),
        }