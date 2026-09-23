"""Hardening regression tests: money-path correctness and security fixes.

Each test documents a specific vulnerability that was fixed.  Removing a test
here should prompt the question: "is the corresponding fix still in place?"

Fixes covered
-------------
1. call-rewards: threshold comes from server settings, not the client body.
2. call-rewards: hearts are awarded from the server-billed call duration.
3. (removed) send-otp no longer exists; reverse-OTP limits live in test_sms_auth_routes.py.
4. global error handler: unhandled exceptions return a generic JSON 500.
"""

import pytest
import app as app_module
from conftest import TEST_UID
from fake_firestore import FakeFirestoreModule


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

OTHER_UID = "other_participant"
CALL_ID = "call_rewards_1"


def rewards_post(client, seconds_to_add, threshold_minutes=3, is_receiver=False, room_id=CALL_ID):
    return client.post(
        "/api/v1/coins/call-rewards",
        json={
            "userId": TEST_UID,
            "secondsToAdd": seconds_to_add,
            "thresholdMinutes": threshold_minutes,
            "isReceiver": is_receiver,
            "roomId": room_id,
        },
    )


def seed_call(store, duration_seconds, caller_rewarded=0, receiver_rewarded=0):
    store["calls/%s" % CALL_ID] = {
        "callerUid": TEST_UID,
        "receiverUid": OTHER_UID,
        "durationSeconds": duration_seconds,
        "callerRewardedSeconds": caller_rewarded,
        "receiverRewardedSeconds": receiver_rewarded,
        "status": "active",
    }


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def rewards_store(monkeypatch):
    """User with empty stats; server has callDurationForHeart = 3 (minutes).

    Duration is seeded high enough that every legacy threshold/cap case can
    still exercise its secondsToAdd path — the new ceiling is remaining
    uncredited billed time, so a tiny duration would mask those checks.
    """
    data = {
        "settings/pricing": {"callDurationForHeart": 3},
        "users/%s" % TEST_UID: {
            "coins": 100,
            "unrewardedCallSeconds": 0,
            "hearts": 0,
            "totalReceivedCallSeconds": 0,
        },
        "calls/%s" % CALL_ID: {
            "callerUid": TEST_UID,
            "receiverUid": OTHER_UID,
            "durationSeconds": 100000,
            "callerRewardedSeconds": 0,
            "receiverRewardedSeconds": 0,
            "status": "active",
        },
    }
    monkeypatch.setattr(app_module, "firestore", FakeFirestoreModule(data))
    return data


@pytest.fixture
def clean_buckets(monkeypatch):
    """Reset the in-process rate-limit store so tests do not share state."""
    monkeypatch.setattr(app_module, "_rate_buckets", {})


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
# 2. call-rewards: seconds are bound to server-billed call duration
# ===========================================================================

class TestCallRewardsCap:
    """Rewards cannot exceed what the billing tick has already measured."""

    def test_huge_seconds_are_capped_to_uncredited_duration(
        self, client, as_user, rewards_store
    ):
        """secondsToAdd=10^9 cannot invent more time than the call has billed.

        The call is seeded with only 90 billed seconds, so even an absurd
        client hint credits at most 90 — not MAX_REWARDS_SECONDS.
        """
        seed_call(rewards_store, duration_seconds=90)

        response = rewards_post(client, seconds_to_add=10 ** 9, threshold_minutes=3)

        assert response.status_code == 200
        user = rewards_store["users/%s" % TEST_UID]
        assert user["hearts"] == 0
        assert user["unrewardedCallSeconds"] == pytest.approx(90)
        assert rewards_store["calls/%s" % CALL_ID]["callerRewardedSeconds"] == pytest.approx(90)

    def test_cannot_double_credit_the_same_billed_seconds(
        self, client, as_user, rewards_store
    ):
        """A second post after the duration is fully credited awards nothing."""
        seed_call(rewards_store, duration_seconds=90)

        first = rewards_post(client, seconds_to_add=90)
        second = rewards_post(client, seconds_to_add=90)

        assert first.status_code == 200
        assert second.status_code == 200
        user = rewards_store["users/%s" % TEST_UID]
        assert user["unrewardedCallSeconds"] == pytest.approx(90)
        assert rewards_store["calls/%s" % CALL_ID]["callerRewardedSeconds"] == pytest.approx(90)

    def test_seconds_below_remaining_pass_through(self, client, as_user, rewards_store):
        """Legitimate values below remaining uncredited time pass through unchanged."""
        response = rewards_post(client, seconds_to_add=90, threshold_minutes=3)

        assert response.status_code == 200
        user = rewards_store["users/%s" % TEST_UID]
        # 90 seconds < 180-second threshold → 0 hearts, 90 seconds banked
        assert user["hearts"] == 0
        assert user["unrewardedCallSeconds"] == pytest.approx(90)

    def test_missing_room_id_is_rejected(self, client, as_user, rewards_store):
        response = client.post(
            "/api/v1/coins/call-rewards",
            json={
                "userId": TEST_UID,
                "secondsToAdd": 30,
                "thresholdMinutes": 3,
            },
        )
        assert response.status_code == 400

    def test_non_participant_is_forbidden(self, client, as_user, rewards_store):
        rewards_store["calls/%s" % CALL_ID] = {
            "callerUid": "alice",
            "receiverUid": "bob",
            "durationSeconds": 500,
            "callerRewardedSeconds": 0,
            "receiverRewardedSeconds": 0,
            "status": "active",
        }
        response = rewards_post(client, seconds_to_add=30)
        assert response.status_code == 403


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
