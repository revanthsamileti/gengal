"""Test fixtures for the money paths.

`app.py` initialises Firebase Admin and reads provider config at import time,
so the environment has to be set before the import happens — hence the
`os.environ` writes above the import rather than inside a fixture.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault("PAYMENT_PROVIDER", "razorpay")
os.environ.setdefault("RAZORPAY_KEY_ID", "rzp_test_fake")
os.environ.setdefault("RAZORPAY_KEY_SECRET", "test_secret")
os.environ.setdefault("PUBLIC_BASE_URL", "http://testserver")

import pytest  # noqa: E402

import app as app_module  # noqa: E402


TEST_SECRET = os.environ["RAZORPAY_KEY_SECRET"]
TEST_UID = "user_under_test"


@pytest.fixture
def flask_app():
    return app_module.app


@pytest.fixture
def client(flask_app):
    return flask_app.test_client()


@pytest.fixture
def as_user(monkeypatch):
    """Authenticate every request as TEST_UID without a real Firebase token."""
    monkeypatch.setattr(app_module, "require_bearer_uid", lambda: (TEST_UID, None))
    return TEST_UID
