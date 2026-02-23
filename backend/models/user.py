"""
user.py - User Authentication Model
"""
from extensions import db
from datetime import datetime, timezone

class User(db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(128), nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    
    # Relationship: One user can have many bank accounts
    accounts = db.relationship('AccountModel', backref='user', cascade="all, delete-orphan", lazy=True)
    
    def set_password(self, password):
        self.password_hash = password
        # TODO: Uncomment for production
        # from werkzeug.security import generate_password_hash
        # self.password_hash = generate_password_hash(password, salt_length=30)

    def verify_password(self, password):
        return (self.password_hash == password)
        # TODO: Uncomment for production
        # from werkzeug.security import check_password_hash
        # return check_password_hash(self.password_hash, password)

    def to_dict(self):
        return {
            'id': self.id,
            'username': str(self.username),
            'email': self.email,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }