import pytest
from datetime import date
from app import create_app
from extensions import db as _db
from models.user import User
from models.account import AccountModel
from models.transaction import TransactionModel
from models.recurring import RecurringModel

TEST_CONFIG = {
    'TESTING': True,
    'SQLALCHEMY_DATABASE_URI': 'sqlite:///:memory:',
    'JWT_SECRET_KEY': 'test-secret',
    'JWT_ACCESS_TOKEN_EXPIRES': False,
}


@pytest.fixture(scope='session')
def app():
    a = create_app(test_config=TEST_CONFIG)
    ctx = a.app_context()
    ctx.push()
    _db.create_all()
    yield a
    _db.drop_all()
    ctx.pop()


@pytest.fixture(scope='session')
def client(app):
    return app.test_client()


@pytest.fixture(autouse=True)
def clean_tables():
    yield
    _db.session.rollback()
    for table in reversed(_db.metadata.sorted_tables):
        _db.session.execute(table.delete())
    _db.session.commit()


@pytest.fixture
def user():
    u = User(username='testuser', email='test@example.com')
    u.set_password('testpass')
    _db.session.add(u)
    _db.session.commit()
    return u


@pytest.fixture
def account(user):
    a = AccountModel(user_id=user.id, acct_id_str='checking-1234', acct_name='Test Checking')
    _db.session.add(a)
    _db.session.commit()
    return a


@pytest.fixture
def auth_headers(client, user):
    resp = client.post('/api/auth/login', json={'username': 'testuser', 'password': 'testpass'})
    assert resp.status_code == 200, f"Login failed: {resp.json}"
    return {'Authorization': f"Bearer {resp.json['access_token']}"}
