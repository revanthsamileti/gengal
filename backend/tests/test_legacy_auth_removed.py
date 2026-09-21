"""Passwordless sign-in removed the OTP and password routes entirely.

check-user goes too: it let anyone enumerate which numbers have accounts.
"""
import pytest

REMOVED = [
    "/api/v1/auth/send-otp",
    "/api/v1/auth/verify-otp",
    "/api/v1/auth/login-password",
    "/api/v1/auth/set-password",
    "/api/v1/auth/check-user",
]


@pytest.mark.parametrize("path", REMOVED)
def test_legacy_auth_route_is_gone(client, path):
    assert client.post(path, json={"phone": "+919876543210"}).status_code == 404


def test_account_deletion_is_still_served(client):
    # Unauthenticated, so 401 -- but the route must still exist.
    assert client.post("/api/v1/auth/delete-account").status_code == 401


def test_username_check_is_still_served(client):
    assert client.post("/api/v1/auth/check-username", json={}).status_code != 404
