"""
auth_errors.py - Responses for a missing, expired, or invalid access token

Flask-JWT-Extended answers these with {'msg': ...} by default (an invalid token even as a 422).
The app's clients read {'success': False, 'error': ...}, and a 401 tells the frontend to send the
user back to the login screen with the message.
"""
from flask import jsonify

NOT_LOGGED_IN   = 'Please log in to continue.'
SESSION_EXPIRED = 'Your session has expired. Please log in again.'
INVALID_SESSION = 'Your session is no longer valid. Please log in again.'


def _unauthorized(message):
    return jsonify({'success': False, 'error': message}), 401


def register_auth_error_handlers(jwt):

    @jwt.unauthorized_loader
    def missing_token(reason):
        return _unauthorized(NOT_LOGGED_IN)

    @jwt.expired_token_loader
    def expired_token(jwt_header, jwt_payload):
        return _unauthorized(SESSION_EXPIRED)

    @jwt.invalid_token_loader
    def invalid_token(reason):
        return _unauthorized(INVALID_SESSION)
