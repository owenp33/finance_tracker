"""
budget.py - Budget Allocation Model

User-scoped (not account-scoped) — a budget covers all spending across
all accounts for a given category and calendar month.

Amounts stored as integer cents, consistent with TransactionModel and
AccountModel. Use the .amount and .carried_over properties for dollar values.
"""
from extensions import db


class BudgetModel(db.Model):
    __tablename__ = 'budgets'

    id                 = db.Column(db.Integer, primary_key=True)
    user_id            = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    category           = db.Column(db.String(50), nullable=False)
    period             = db.Column(db.String(7), nullable=False)   # "YYYY-MM"
    amount_cents       = db.Column(db.Integer, nullable=False)
    rollover           = db.Column(db.Boolean, default=False)
    carried_over_cents = db.Column(db.Integer, default=0)

    # One user cannot have two allocations for the same category in the same period
    __table_args__ = (
        db.UniqueConstraint('user_id', 'category', 'period',
                            name='uq_budget_user_category_period'),
    )

    # ------------------------------------------------------------------
    # Dollar-value properties (mirrors the pattern in TransactionModel)
    # ------------------------------------------------------------------

    @property
    def amount(self):
        return self.amount_cents / 100.0

    @amount.setter
    def amount(self, dollars):
        self.amount_cents = int(round(dollars * 100))

    @property
    def carried_over(self):
        return self.carried_over_cents / 100.0

    @carried_over.setter
    def carried_over(self, dollars):
        self.carried_over_cents = int(round(dollars * 100))

    def to_dict(self):
        return {
            'id': self.id,
            'category': self.category,
            'period': self.period,
            'amount': self.amount,
            'amount_cents': self.amount_cents,
            'rollover': self.rollover,
            'carried_over': self.carried_over,
            'carried_over_cents': self.carried_over_cents,
        }
