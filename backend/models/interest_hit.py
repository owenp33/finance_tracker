"""
interest_hit.py - One interest hit on an account: a record of its own, not a transaction
"""
from extensions import db

INTEREST = 'Interest'   # how a hit reads where transactions are listed with it (the PDF's account pages)


class InterestHitModel(db.Model):
    """
    The interest an account was charged or paid on the 1st of a period (InterestService): the rate's
    share for the period of the balance at the end of the day before. It waits for the user's
    approval: until then it moves nothing (the next period's interest counts it all the same), and its
    amount can be changed to the bank's figure, or it can be deleted. Approved, it moves the account's
    balance and its balance history, and stays as it is. It isn't a transaction: it's in no
    transaction list and counts in no income or spending total.
    """
    __tablename__ = 'interest_hits'
    __table_args__ = (db.UniqueConstraint('account_id', 'date'),)

    id           = db.Column(db.Integer, primary_key=True)
    account_id   = db.Column(db.Integer, db.ForeignKey('accounts.id', ondelete='CASCADE'), nullable=False)
    date         = db.Column(db.Date, nullable=False)        # the period's first day
    amount_cents = db.Column(db.Integer, nullable=False)     # as it moves the balance: charged negative, paid positive
    apr_bps      = db.Column(db.Integer, nullable=False)     # the yearly rate it was worked out at
    frequency    = db.Column(db.String(10), nullable=False)  # how often it hits: monthly, quarterly or yearly
    base_cents   = db.Column(db.Integer, nullable=False)     # the balance it was on: what was owed, or held
    approved     = db.Column(db.Boolean, nullable=False, default=False, server_default=db.false())   # applied to the balance

    # Deleting the account deletes its hits. The ORM cascade does it everywhere; Postgres would also
    # cascade on its own, but SQLite (the tests) ignores foreign keys.
    account = db.relationship('AccountModel', backref=db.backref('interest_hits', cascade='all, delete-orphan'))

    # Read alongside transactions in an account's ledger (BalanceService, the PDF's account pages)
    vendor = INTEREST
    category = INTEREST

    def to_dict(self):
        return {
            'id': self.id,
            'account_id': self.account_id,
            'date': self.date.isoformat(),
            'amount': self.amount_cents / 100,
            'amount_cents': self.amount_cents,
            'apr': self.apr_bps / 100,
            'frequency': self.frequency,
            'base_cents': self.base_cents,
            'approved': self.approved,
        }
