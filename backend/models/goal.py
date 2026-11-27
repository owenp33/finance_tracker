"""
goal.py - A goal: a target balance on one of the user's accounts
"""
from extensions import db


class GoalModel(db.Model):
    """
    A target balance on one of the user's accounts (Phase F, F2): savings up to an amount, a loan
    down to $0 owed. Whether it's reached, and which goal is active, comes from the account's
    balance and the goals' order (GoalService); nothing about it is stored.
    """
    __tablename__ = 'goals'

    id            = db.Column(db.Integer, primary_key=True)
    user_id       = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    account_id    = db.Column(db.Integer, db.ForeignKey('accounts.id', ondelete='CASCADE'), nullable=False)
    target_cents  = db.Column(db.Integer, nullable=False)
    monthly_cents = db.Column(db.Integer)                    # the user's own monthly amount; None = the app's suggestion
    position      = db.Column(db.Integer, nullable=False)    # 1, 2, ...: goals run in this order

    # Deleting the user or the account deletes its goals. The ORM cascade does it everywhere;
    # Postgres would also cascade on its own, but SQLite (the tests) ignores foreign keys.
    user    = db.relationship('User', backref=db.backref('goals', cascade='all, delete-orphan'))
    account = db.relationship('AccountModel', backref=db.backref('goals', cascade='all, delete-orphan'))
