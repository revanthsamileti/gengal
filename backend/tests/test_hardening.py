"""Hardening regression tests: money-path correctness and security fixes.

Each test documents a specific vulnerability that was fixed.  Removing a test
here should prompt the question: "is the corresponding fix still in place?"

Fixes covered
-------------
1. call-rewards: threshold comes from server settings, not the client body.
2. call-rewards: secondsToAdd is capped at MAX_REWARDS_SECONDS.
3. send-otp: per-IP rate limit prevents bulk SMS enumeration.
4. global error handler: unhandled exceptions return a generic JSON 500.
"""

import os
import pytest
import app as app_module
from conftest import TEST_UID
from fake_firestore import FakeFirestoreModule


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def rewards_post(client, seconds_to_add, threshold_minutes=3, is_receiver=False):
    return client.post(
        "/api/v1/coins/call-rewards",
        json={
            "userId": TEST_UID,
            "secondsToAdd": seconds_to_add,
            "thresholdMinutes": threshold_minutes,
            "isReceiver": is_receiver,
        },
    )


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def rewards_store(monkeypatch):
    """User with empty stats; server has callDurationForHeart = 3 (minutes)."""
    data = {
        "settings/pricing": {"callDurationForHeart": 3},
        "users/%s" % TEST_UID: {
            "coins": 100,
            "unrewardedCallSeconds": 0,
            "hearts": 0,
            "totalReceivedCallSeconds": 0,
        },
    }
    monkeypatch.setattr(app_module, "firestore", FakeFirestoreModule(data))
    return data


@pytest.fixture
def clean_buckets(monkeypatch):
    """Reset the in-process rate-limit store so tests do not share state."""
    monkeypatch.setattr(app_module, "_rate_buckets", {})


@pytest.fixture
def clean_abuse(monkeypatch):
    """Reset the per-phone abuse tracker."""
    monkeypatch.setattr(app_module, "abuse_store", {})


# ===========================================================================
# 1. call-rewards: threshold is server-authoritative
# ===========================================================================

class TestCallRewardsThresholdServerSide:
    """A patched client cannot mint hearts by sending a tiny thresholdMinutes."""

    def test_client_threshold_is_ignored_when_too_small(
        self, client, as_user, rewards_store
    ):
        """thresholdMinutes=0.001 in the request body is ignored.

        Server uses callDurationForHeart=3 (180 seconds).  59 seconds of call
        time earns 0 hearts regardless of what the client claims the threshold is.
        """
        response = rewards_post(client, seconds_to_add=59, threshold_minutes=0.001)

        assert response.status_code == 200
        user = rewards_store["users/%s" % TEST_UID]
        # 59 s < 180 s server threshold → no hearts minted
        assert user["hearts"] == 0
        assert user["unrewardedCallSeconds"] == pytest.approx(59)

    def test_client_threshold_zero_does_not_crash_or_mint_hearts(
        self, client, as_user, rewards_store
    ):
        """thresholdMinutes=0 (would be divide-by-zero with the old code) is safely ignored.

        Old code: threshold_seconds = 0 * 60 = 0, then
        `if threshold_seconds > 0 and current_seconds >= threshold_seconds` is False,
        so no hearts — but *only* because of the `> 0` guard.  The real fix is that
        threshold comes from the server (3 min), making the client value irrelevant.
        """
        response = rewards_post(client, seconds_to_add=1, threshold_minutes=0)

        assert response.status_code == 200
        user = rewards_store["users/%s" % TEST_UID]
        assert user["hearts"] == 0  # 1 s << 180 s server threshold

    def test_client_threshold_larger_than_server_is_also_ignored(
        self, client, as_user, rewards_store
    ):
        """A client sending thresholdMinutes=999 cannot prevent heart awards forever.

        Old code would have used 999 and never awarded hearts for realistic calls.
        Now the server uses 3 minutes: 600 seconds gives 3 hearts.
        """
        # 600 seconds at 3-min threshold = 3 hearts, 60 remaining
        response = rewards_post(client, seconds_to_add=600, threshold_minutes=999)

        assert response.status_code == 200
        user = rewards_store["users/%s" % TEST_UID]
        assert user["hearts"] == 3
        assert user["unrewardedCallSeconds"] == pytest.approx(600 - 3 * 180)

    def test_normal_rewards_still_work_after_fix(self, client, as_user, rewards_store):
        """Regression: legitimate heart awards still land correctly post-fix.

        500 seconds at 3-minute threshold → 2 hearts (2×180=360 s), 140 s left.
        """
        response = rewards_post(client, seconds_to_add=500, threshold_minutes=3)

        assert response.status_code == 200
        user = rewards_store["users/%s" % TEST_UID]
        assert user["hearts"] == 2
        assert user["unrewardedCallSeconds"] == pytest.approx(140)


# ===========================================================================
# 2. call-rewards: secondsToAdd is capped at MAX_REWARDS_SECONDS
# ===========================================================================

class TestCallRewardsCap:
    """An absurd secondsToAdd cannot bypass the threshold fix or inflate balances."""

    def test_huge_seconds_are_capped(self, client, as_user, rewards_store):
        """secondsToAdd=10^9 is silently capped to MAX_REWARDS_SECONDS (7200).

        Even after the threshold fix, an uncapped secondsToAdd would still let a
        patched client farm 7200/180 = 40 hearts per API call (≈120 INR at default
        heartToInrRate).  The cap prevents that inflation.
        """
        MAX = app_module.MAX_REWARDS_SECONDS  # 7200

        response = rewards_post(client, seconds_to_add=10 ** 9, threshold_minutes=3)

        assert response.status_code == 200
        user = rewards_store["users/%s" % TEST_UID]
        # Hearts = floor(MAX / 180) = 40; remainder = MAX % 180 = 0
        expected_hearts = int(MAX // (3 * 60))
        assert user["hearts"] == expected_hearts
        stored_unawarded = user["unrewardedCallSeconds"]
        assert stored_unawarded <= MAX, (
            "unrewardedCallSeconds must not exceed the per-increment cap"
        )

    def test_seconds_at_cap_boundary_are_accepted(self, client, as_user, rewards_store):
        """MAX_REWARDS_SECONDS itself is not capped further (boundary is inclusive)."""
        MAX = app_module.MAX_REWARDS_SECONDS

        response = rewards_post(client, seconds_to_add=MAX, threshold_minutes=3)

        assert response.status_code == 200
        # Should behave identically to the cap-exceeded case above
        user = rewards_store["users/%s" % TEST_UID]
        assert user["hearts"] == int(MAX // (3 * 60))

    def test_seconds_below_cap_are_unchanged(self, client, as_user, rewards_store):
        """Legitimate values below MAX_REWARDS_SECONDS pass through unchanged."""
        response = rewards_post(client, seconds_to_add=90, threshold_minutes=3)

        assert response.status_code == 200
        user = rewards_store["users/%s" % TEST_UID]
        # 90 seconds < 180-second threshold → 0 hearts, 90 seconds banked
        assert user["hearts"] == 0
        assert user["unrewardedCallSeconds"] == pytest.approx(90)


# ===========================================================================
# 3. send-otp: per-IP rate limit
# ===========================================================================

class TestSendOtpIpRateLimit:
    """Bulk OTP requests from a single IP are throttled regardless of destination phone."""

    UNIQUE_IP = "10.99.88.77"

    def test_ip_rate_limit_fires_after_ten_requests(
        self, client, clean_buckets, clean_abuse, monkeypatch
    ):
        """The 11th OTP request from the same IP in one hour is rejected.

        Using different phone numbers each time so the per-phone 90-second cooldown
        does not interfere — we are testing the IP gate only.
        """
        monkeypatch.setenv("ALLOW_DEV_OTP_BYPASS", "true")

        def send(phone_suffix):
            return client.post(
                "/api/v1/auth/send-otp",
                json={"phone": "+919900%05d" % phone_suffix},
                environ_base={"REMOTE_ADDR": self.UNIQUE_IP},
            )

        # Requests 1–10: all should pass the IP gate (phone cooldown may 429 some,
        # but IP gate itself is not triggered yet)
        for i in range(10):
            r = send(i)
            assert r.status_code != 429 or b"Too many OTP requests from this address" not in r.data, (
                "IP rate limit fired too early (request %d)" % (i + 1)
            )

        # Request 11: IP gate must now block it
        r = send(99999)
        assert r.status_code == 429
        assert b"Too many OTP requests from this address" in r.data

    def test_different_ip_is_not_blocked(self, client, clean_buckets, clean_abuse, monkeypatch):
        """The IP rate limit is per-address; a second IP is unaffected."""
        monkeypatch.setenv("ALLOW_DEV_OTP_BYPASS", "true")

        # Exhaust the limit for IP A
        for i in range(11):
            client.post(
                "/api/v1/auth/send-otp",
                json={"phone": "+919900%05d" % i},
                environ_base={"REMOTE_ADDR": "10.0.0.1"},
            )

        # IP B should still be able to send
        r = client.post(
            "/api/v1/auth/send-otp",
            json={"phone": "+919988776655"},
            environ_base={"REMOTE_ADDR": "10.0.0.2"},
        )
        # Should NOT be blocked by IP rate limit (may still 200 or per-phone 429)
        assert b"Too many OTP requests from this address" not in r.data


# ===========================================================================
# 4. global error handler returns generic JSON
# ===========================================================================

class TestGlobalErrorHandler:
    """Unhandled exceptions must not expose stack traces to the client."""

    def test_error_handler_is_registered(self):
        """The Flask app has an error handler for the base Exception type.

        Flask stores app-level exception handlers at
        error_handler_spec[None][None][ExcClass].  The presence of Exception
        confirms the catch-all is wired so Flask does not fall back to its
        HTML 500 page for unhandled exceptions.
        """
        # error_handler_spec: {blueprint_or_None: {http_code_or_None: {ExcClass: fn}}}
        # App-level, non-HTTP-code handlers live at key None → None.
        non_http_handlers = (
            app_module.app.error_handler_spec
            .get(None, {})       # app-level (not a blueprint)
            .get(None, {})       # not an HTTP status code
        )
        assert Exception in non_http_handlers, (
            "No catch-all Exception error handler registered on the app. "
            "Unhandled exceptions will return Werkzeug's HTML 500 page instead of JSON."
        )

    def test_error_handler_function_returns_json(self):
        """The registered handler itself returns JSON with a generic message.

        We call the handler function directly so we can verify its output
        without needing to trigger a live exception via HTTP routing.
        """
        import json as _json

        # Retrieve the handler registered in app.py via @app.errorhandler(Exception)
        handler_fn = (
            app_module.app.error_handler_spec
            .get(None, {})
            .get(None, {})
            .get(Exception)
        )
        assert handler_fn is not None, "Handler must be registered before this test runs"

        # Call the handler with a RuntimeError inside an app+request context so
        # Flask's `jsonify` and `request` proxies are available.
        with app_module.app.test_request_context():
            response = handler_fn(RuntimeError("secret internal detail"))

        # The handler returns (response_obj, 500) as a tuple.
        if isinstance(response, tuple):
            resp_obj, status_code = response[0], response[1]
            data = _json.loads(resp_obj.get_data())
        else:
            data = response.get_json()
            status_code = response.status_code

        assert status_code == 500
        assert "error" in data
        # The raw exception message must never reach the client.
        assert "secret internal detail" not in str(data)
