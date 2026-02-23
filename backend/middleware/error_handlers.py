"""
error_handlers.py - Global error handling middleware

Registered in app.py so all routes get consistent error responses
without needing individual try/except blocks.
"""
from flask import jsonify
import traceback


def register_error_handlers(app):

    @app.errorhandler(400)
    def bad_request(e):
        return jsonify({'success': False, 'error': 'Bad request'}), 400

    @app.errorhandler(403)
    def forbidden(e):
        return jsonify({'success': False, 'error': 'Forbidden'}), 403

    @app.errorhandler(404)
    def not_found(e):
        return jsonify({'success': False, 'error': 'Resource not found'}), 404

    @app.errorhandler(500)
    def server_error(e):
        return jsonify({'success': False, 'error': 'Internal server error'}), 500

    @app.errorhandler(Exception)
    def unhandled_exception(e):
        traceback.print_exc()  # prints full traceback to your terminal
        return jsonify({'success': False, 'error': str(e)}), 500