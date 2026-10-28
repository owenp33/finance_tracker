"""
recurring_alias.py - Another spelling of a recurring series' vendor, confirmed by the user
"""
from extensions import db


class RecurringAliasModel(db.Model):
    """
    A vendor spelling, as vendor_match.clean_vendor leaves it, that the import preview treats as
    the series' own name.
    """
    __tablename__ = 'recurring_aliases'

    recurring_id = db.Column(db.Integer, db.ForeignKey('recurring.id', ondelete='CASCADE'), primary_key=True)
    alias        = db.Column(db.String(100), primary_key=True)

    # Deleting the template deletes its aliases. The ORM cascade does it everywhere; Postgres would
    # also cascade on its own, but SQLite (the tests) ignores foreign keys.
    recurring = db.relationship('RecurringModel', backref=db.backref('aliases', cascade='all, delete-orphan'))
