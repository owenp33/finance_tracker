"""
request_body.py - Request body parsing shared by routes
"""
from flask import request


def json_body():
    """The request's JSON body as a dict; {} when it is missing, malformed, or not a JSON object."""
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}
