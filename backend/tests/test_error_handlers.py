"""
Global error handling tests: every error reaches the client as JSON with the right
status code, and unexpected errors never leak internal details.
"""
import routes.accounts as accounts_routes


class TestHttpErrors:
    def test_unknown_url_is_404(self, client):
        resp = client.get('/api/does-not-exist')
        assert resp.status_code == 404
        assert resp.json == {'success': False, 'error': 'Not Found'}

    def test_wrong_method_is_405_not_500(self, client):
        resp = client.get('/api/auth/login')
        assert resp.status_code == 405
        assert resp.json == {'success': False, 'error': 'Method Not Allowed'}

    def test_non_json_body_is_415_not_500(self, client, auth_headers):
        resp = client.post('/api/budgets', data='not json', content_type='text/plain',
                           headers=auth_headers)
        assert resp.status_code == 415
        assert 'application/json' in resp.json['error']


class TestUnexpectedErrors:
    def test_generic_500_hides_details_and_logs_them(self, client, auth_headers, monkeypatch, caplog):
        def explode(user_id):
            raise RuntimeError('secret internal detail')
        monkeypatch.setattr(accounts_routes.db_service, 'get_user_accounts', explode)

        resp = client.get('/api/accounts', headers=auth_headers)

        assert resp.status_code == 500
        assert resp.json == {'success': False, 'error': 'Internal server error'}
        assert 'secret internal detail' not in resp.get_data(as_text=True)
        assert 'secret internal detail' in caplog.text


class TestAuthErrors:
    """Login problems answer 401 in the app's error shape, so the frontend can send the user to log in."""

    def test_no_token(self, client):
        resp = client.get('/api/accounts')
        assert (resp.status_code, resp.json) == (401, {'success': False, 'error': 'Please log in to continue.'})

    def test_expired_token(self, app, client, user):
        from datetime import timedelta
        from flask_jwt_extended import create_access_token
        with app.app_context():
            token = create_access_token(identity=str(user.id), expires_delta=timedelta(seconds=-1))
        resp = client.get('/api/accounts', headers={'Authorization': f'Bearer {token}'})
        assert (resp.status_code, resp.json) == (
            401, {'success': False, 'error': 'Your session has expired. Please log in again.'})

    def test_invalid_token(self, client):
        resp = client.get('/api/accounts', headers={'Authorization': 'Bearer not-a-real-token'})
        assert (resp.status_code, resp.json) == (
            401, {'success': False, 'error': 'Your session is no longer valid. Please log in again.'})
