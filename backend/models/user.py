"""
user.py - User Authentication Model
"""
from extensions import db
from datetime import datetime, timezone
from werkzeug.security import generate_password_hash, check_password_hash

class User(db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)  # Werkzeug's scrypt hashes are 162 chars
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    # Relationship: One user can have many bank accounts
    accounts = db.relationship('AccountModel', backref='user', cascade="all, delete-orphan", lazy=True)

    def set_password(self, password):
        """Store a salted hash of the password, never the password itself."""
        self.password_hash = generate_password_hash(password)

    def verify_password(self, password):
        """True when the password matches the stored hash."""
        return check_password_hash(self.password_hash, password)

    def to_dict(self):
        return {
            'id': self.id,
            'username': str(self.username),
            'email': self.email,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }