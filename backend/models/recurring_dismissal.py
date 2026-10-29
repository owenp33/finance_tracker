"""
recurring_dismissal.py - A transaction the user said isn't part of a recurring series
"""
from extensions import db


class RecurringDismissalModel(db.Model):
    """Suggestions for the series skip the dismissed transaction."""
    __tablename__ = 'recurring_dismissals'

    recurring_id   = db.Column(db.Integer, db.ForeignKey('recurring.id', ondelete='CASCADE'), primary_key=True)
    transaction_id = db.Column(db.Integer, db.ForeignKey('transactions.id', ondelete='CASCADE'), primary_key=True)

    # Deleting the template or the transaction deletes the dismissal. The ORM cascades below do it
    # everywhere; Postgres would also cascade on its own, but SQLite (the tests) ignores foreign keys.
    recurring   = db.relationship('RecurringModel', backref=db.backref('dismissals', cascade='all, delete-orphan'))
    transaction = db.relationship('TransactionModel', backref=db.backref('dismissals', cascade='all, delete-orphan'))
