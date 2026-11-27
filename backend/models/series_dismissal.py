"""
series_dismissal.py - A found recurring series the user said isn't recurring
"""
from extensions import db


class SeriesDismissalModel(db.Model):
    """
    "Not recurring" on a series found by Find recurring: finding series skips payments on this
    account to this vendor (vendor_match.vendor_key) of a similar size from then on.
    """
    __tablename__ = 'series_dismissals'

    account_id   = db.Column(db.Integer, db.ForeignKey('accounts.id', ondelete='CASCADE'), primary_key=True)
    vendor_key   = db.Column(db.String(100), primary_key=True)
    amount_cents = db.Column(db.Integer, primary_key=True)   # the series' median payment; negative for spending

    # Deleting the account deletes its dismissals. The ORM cascade does it everywhere; Postgres
    # would also cascade on its own, but SQLite (the tests) ignores foreign keys.
    account = db.relationship('AccountModel', backref=db.backref('series_dismissals', cascade='all, delete-orphan'))
