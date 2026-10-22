"""
auth_service.py - Authentication Business Logic

Owns how users are authenticated and how access tokens are issued.
Depends on db_service.py for raw data access.
"""
from flask_jwt_extended import create_access_token
from services.db_service import DbService

db_service = DbService()


class AuthService:

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
