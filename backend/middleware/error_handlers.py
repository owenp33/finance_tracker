"""
error_handlers.py - Global error handling middleware

Registered in app.py so all routes get consistent JSON error responses
without needing individual try/except blocks.
"""
from flask import jsonify, request
from werkzeug.exceptions import HTTPException


def register_error_handlers(app):

    @app.errorhandler(HTTPException)
    def http_error(e):
        """HTTP errors (404, 405, 415, ...) keep their status code."""
        # A specific reason (abort(400, '...'), a JSON parse failure) is more useful than the
        # generic name ("Not Found", "Method Not Allowed"), which is used otherwise
        has_specific_reason = e.description != type(e).description
        message = e.description if has_specific_reason else e.name
        return jsonify({'success': False, 'error': message}), e.code

    @app.errorhandler(Exception)
    def unhandled_exception(e):
        """Anything else is a bug: log the full traceback, and never send its details to the client."""
        app.logger.error('Unhandled error on %s %s', request.method, request.path, exc_info=e)
        return jsonify({'success': False, 'error': 'Internal server error'}), 500
