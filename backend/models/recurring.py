"""
recurring.py - Recurring Transaction Model
"""
import calendar
from extensions import db
from datetime import date, timedelta

FREQUENCY_UNITS = ('days', 'months')


def _add_months(day, months, day_of_month):
    """The date `months` months after `day` (negative goes back), on day_of_month, or the last day of a shorter month."""
    year_offset, month_index = divmod(day.month - 1 + months, 12)
    year, month = day.year + year_offset, month_index + 1
    return date(year, month, min(day_of_month, calendar.monthrange(year, month)[1]))


class RecurringModel(db.Model):
    __tablename__ = 'recurring'
    id = db.Column(db.Integer, primary_key=True)
    account_id = db.Column(db.Integer, db.ForeignKey('accounts.id'), nullable=False)
    start_date = db.Column(db.Date, nullable=False)
    vendor = db.Column(db.String(100), nullable=False)
    category = db.Column(db.String(50), nullable=False)
    amount_cents = db.Column(db.Integer, nullable=False)
    notes = db.Column(db.Text)
    
    # Recurring attributes
    next_date = db.Column(db.Date, nullable=False)
    frequency = db.Column(db.Integer, default=30)  # repeats every `frequency` days or months
    frequency_unit = db.Column(db.String(10), nullable=False, default='days')  # one of FREQUENCY_UNITS
    day_of_month = db.Column(db.Integer)  # monthly templates: the day they fall on (the last day in shorter months)
    number = db.Column(db.Integer, default=-1)
    idx = db.Column(db.Integer, default=0)
    
    generated_transactions = db.relationship('TransactionModel',
                                            foreign_keys='TransactionModel.recurring_id',
                                            backref='recurring_source',
                                            cascade="all, delete-orphan")
    
    @property
    def amount(self):
        return self.amount_cents / 100.0
    
    @amount.setter
    def amount(self, dollars):
        self.amount_cents = int(round(dollars * 100))
    
    def shift(self, from_date, steps=1):
        """The occurrence `steps` repeats after from_date (negative steps go back)."""
        if self.frequency_unit == 'months':
            return _add_months(from_date, steps * self.frequency, self.day_of_month)
        return from_date + timedelta(days=steps * self.frequency)

    @property
    def advance_to_next(self):
        """Calculate next occurrence date"""
        return self.shift(self.next_date)

    def to_dict(self):
        return {
            'id': self.id,
            'date': self.start_date.isoformat(),
            'vendor': str(self.vendor),
            'category': str(self.category),
            'amount': float(self.amount),
            'notes': str(self.notes or ''),
            'next_date': self.next_date.isoformat(),
            # The latest occurrence generated so far (None before the first)
            'last_date': self.shift(self.next_date, -1).isoformat() if self.idx > 1 else None,
            'frequency': int(self.frequency),
            'frequency_unit': self.frequency_unit,
            'number': int(self.number),
            'idx': int(self.idx)
        }