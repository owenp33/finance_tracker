"""
scheduled_pace.py - A budget category the user paces by its recurring charges
"""
from extensions import db


class ScheduledPaceModel(db.Model):
    """
    "Scheduled pace" on a budget category: budget pace expects the category's spending on its
    recurring charges' dates instead of evenly through the month. The setting belongs to the
    category in every month, not to one month's budget; a category without a row has an even pace.
    """
    __tablename__ = 'scheduled_paces'

    user_id  = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
    category = db.Column(db.String(50), primary_key=True)   # as budgets.category names it

    # Deleting the user deletes their settings. The ORM cascade does it everywhere; Postgres would
    # also cascade on its own, but SQLite (the tests) ignores foreign keys.
    user = db.relationship('User', backref=db.backref('scheduled_paces', cascade='all, delete-orphan'))
