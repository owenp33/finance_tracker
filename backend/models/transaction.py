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
    amount_cents = db.Column(db.Integer, nullable=False)
    notes = db.Column(db.Text)
    over_budget = db.Column(db.Boolean, default=False, nullable=False)
    is_transfer = db.Column(db.Boolean, default=False, nullable=False)
    transfer_peer_id = db.Column(
        db.Integer,
        db.ForeignKey('transactions.id', ondelete='SET NULL'),
        nullable=True,
    )

    transfer_peer = db.relationship(
        'TransactionModel',
        primaryjoin='TransactionModel.transfer_peer_id == TransactionModel.id',
        foreign_keys='[TransactionModel.transfer_peer_id]',
        uselist=False,
        post_update=True,
    )

    def to_dict(self):
        peer_account = None
        if self.transfer_peer_id and self.transfer_peer and self.transfer_peer.account:
            peer_account = self.transfer_peer.account.acct_name
        return {
            'id': self.id,
            'account_id': self.account_id,
            'account_name': self.account.acct_name if self.account else None,
            'date': self.date.isoformat(),
            'vendor': self.vendor,
            'category': self.category,
            'amount': self.amount,
            'amount_cents': self.amount_cents,
            'notes': self.notes,
            'recurring_id': self.recurring_id,
            'over_budget': self.over_budget,
            'is_transfer': self.is_transfer,
            'transfer_peer_id': self.transfer_peer_id,
            'transfer_peer_account': peer_account,
        }
    
    @property
    def amount(self):
        """Convert cents to dollars for display"""
        return self.amount_cents / 100.0
    
    @amount.setter
    def amount(self, dollars):
        """Convert dollars to cents for storage"""
        self.amount_cents = int(round(dollars * 100))
