"""
extensions.py - Flask extension instances

All extensions are initialized here and imported everywhere else.
- To prevent circular imports and duplicate instances.
"""
from flask_sqlalchemy import SQLAlchemy
from flask_jwt_extended import JWTManager

db = SQLAlchemy()
jwt = JWTManager()