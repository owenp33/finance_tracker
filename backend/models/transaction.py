"""
transaction.py - Transaction Model
"""
from extensions import db

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