"""
recurring.py - Recurring Transaction Model
"""
from extensions import db
from datetime import timedelta

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
    frequency = db.Column(db.Integer, default=30)
    number = db.Column(db.Integer, default=-1)
    idx = db.Column(db.Integer, default=0)
    
    generated_transactions = db.relationship('TransactionModel',
                                            foreign_keys='TransactionModel.recurring_id',
                                            backref='recurring_source',
                                            cascade="all, delete-orphan")
    
    @property
    def advance_to_next(self):
        """Calculate next occurrence date"""
        return self.next_date + timedelta(days=self.frequency)
    
    def to_dict(self):
        return {
            'id': self.id,
            'date': self.start_date.isoformat(),
            'vendor': str(self.vendor),
            'category': str(self.category),
            'amount': float(self.amount),
            'notes': str(self.notes or ''),
            'next_date': self.next_date.isoformat(),
            'frequency': int(self.frequency),
            'number': int(self.number),
            'idx': int(self.idx)
        }