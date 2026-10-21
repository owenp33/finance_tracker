"""
auth_service.py - Authentication Business Logic

Owns how access tokens are issued for users.
"""
from flask_jwt_extended import create_access_token


class AuthService:

    # TOKENS ====================================================================

    def issue_token(self, user):
        """
        Create the access token for a user. The identity must be a string: PyJWT
        rejects tokens whose 'sub' claim is not. Expiry comes from JWT_ACCESS_TOKEN_EXPIRES.
        """
        return create_access_token(identity=str(user.id))
