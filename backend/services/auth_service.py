"""
auth_service.py - Authentication Business Logic

Owns user registration, authentication, and how access tokens are issued.
Depends on db_service.py for raw data access.
"""
import re
from flask_jwt_extended import create_access_token
from sqlalchemy.exc import IntegrityError
from extensions import db
from models.user import User
from services.db_service import DbService

db_service = DbService()

MIN_PASSWORD_LENGTH = 8
_EMAIL_PATTERN = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')


class RegistrationConflict(ValueError):
    """The username or email is already registered."""


class AuthService:

    # REGISTRATION ==============================================================

    def register(self, username, email, password):
        """
        Validate the input and create a user. Usernames and emails are trimmed and
        emails are lowercased before checks and storage.
        Raises ValueError (with a message for the user) when input is invalid, and
        RegistrationConflict when the username or email is already taken.
        """
        username = username.strip() if isinstance(username, str) else ''
        email    = email.strip().lower() if isinstance(email, str) else ''
        password = password if isinstance(password, str) else ''

        self._validate_registration(username, email, password)

        if db_service.get_user_by_username(username):
            raise RegistrationConflict('That username is already taken.')
        if db_service.get_user_by_email(email):
            raise RegistrationConflict('An account with that email already exists.')

        try:
            return db_service.create_user(username, email, password)
        except IntegrityError:
            # A concurrent registration claimed the username or email after the checks above
            db.session.rollback()
            raise RegistrationConflict('That username or email is already taken.')

    def _validate_registration(self, username, email, password):
        """Raise ValueError describing the first problem found, if any."""
        fields  = {'username': username, 'email': email, 'password': password}
        missing = [name for name, value in fields.items() if not value]
        if missing:
            raise ValueError(f"Missing required fields: {', '.join(missing)}")

        max_username = User.username.type.length
        max_email    = User.email.type.length
        if len(username) > max_username:
            raise ValueError(f'Username must be at most {max_username} characters.')
        if len(email) > max_email:
            raise ValueError(f'Email must be at most {max_email} characters.')
        if not _EMAIL_PATTERN.match(email):
            raise ValueError('Enter a valid email address.')
        if len(password) < MIN_PASSWORD_LENGTH:
            raise ValueError(f'Password must be at least {MIN_PASSWORD_LENGTH} characters.')

    # AUTHENTICATION ============================================================

    def authenticate(self, username, password):
        """Return the user when the username exists and the password matches; otherwise None."""
        user = db_service.get_user_by_username(username)
        if user and user.verify_password(password):
            return user
        return None

    # TOKENS ====================================================================

    def issue_token(self, user):
        """
        Create the access token for a user. The identity must be a string: PyJWT
        rejects tokens whose 'sub' claim is not. Expiry comes from JWT_ACCESS_TOKEN_EXPIRES.
        """
        return create_access_token(identity=str(user.id))
