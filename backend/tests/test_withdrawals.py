"""Payout-path regression tests.

Hearts convert to rupees via `heartToInrRate`, so every gap here was a way to
take real money out of the business. Before these endpoints existed the client
wrote straight into /withdrawalRequests and the security rules checked only
that `hearts` was a number greater than zero:

1. The amount was whatever the device claimed. A patched client could ask to be
   paid for hearts it had never earned.
2. Nothing stopped a second request being opened beside the first.
3. Approving a request never reduced the balance, so the same hearts could be
   cashed out again and again.

Each test below pins one of those shut. If one starts failing, the question to
ask is not "is the test wrong" but "can someone withdraw money they don't have".
"""

import pytest
import app as app_module
from conftest import TEST_UID
from fake_firestore import FakeFirestoreModule


ADMIN_UID = "admin_under_test"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def make_store(hearts=100, pending=None, rate=3, minimum=33):
    user = {
        "coins": 0,
        "hearts": hearts,
        "unrewardedCallSeconds": 0,
    }
    if pending is not None:
        user["pendingWithdrawalId"] = pending
    return {
        "settings/pricing": {"heartToInrRate": rate, "minWithdrawalHearts": minimum},
        "users/%s" % TEST_UID: user,
    }


@pytest.fixture
def store(monkeypatch):
    data = make_store()
    monkeypatch.setattr(app_module, "firestore", FakeFirestoreModule(data))
    return data


@pytest.fixture
def fake_fs(monkeypatch):
    """Exposes the fake module itself, for asserting on its recorded reads."""
    data = make_store()
    module = FakeFirestoreModule(data)
    monkeypatch.setattr(app_module, "firestore", module)
    return module, data


def become_admin(monkeypatch):
    """Switch the acting identity to an allowlisted admin.

    Deliberately a helper rather than a fixture: a request has to be opened *as
    the user* first, and a fixture would swap the identity before that happens
    — the admin has no user document, so the open would fail for the wrong
    reason and the test would prove nothing.
    """
    monkeypatch.setattr(app_module, "require_bearer_uid", lambda: (ADMIN_UID, None))
    monkeypatch.setattr(app_module, "admin_uids", lambda: {ADMIN_UID})
    return ADMIN_UID


def user_of(store):
    return store["users/%s" % TEST_UID]


def only_request(store):
    """The single withdrawalRequests document the test created."""
    matches = [v for k, v in store.items() if k.startswith("withdrawalRequests/")]
    assert len(matches) == 1, "expected exactly one request, found %d" % len(matches)
    return matches[0]


def request_id_of(store):
    keys = [k for k in store if k.startswith("withdrawalRequests/")]
    assert len(keys) == 1
    return keys[0].split("/", 1)[1]


# ===========================================================================
# 1. The payable amount is the server's, not the client's
# ===========================================================================

class TestAmountIsServerAuthoritative:
    def test_client_cannot_state_the_payout(self, client, as_user, store):
        """A body claiming a huge payout is ignored; the balance decides."""
        response = client.post(
            "/api/v1/withdrawals/request",
            json={"hearts": 999999, "amountInr": 999999},
        )

        assert response.status_code == 200
        # 100 hearts held * rate 3 = 300, not the 999999 that was asked for.
        assert response.get_json()["amountInr"] == 300
        assert only_request(store)["amountInr"] == 300
        assert only_request(store)["hearts"] == 100

    def test_below_minimum_is_refused(self, client, as_user, monkeypatch):
        """Under the configured floor there is no payout to open."""
        data = make_store(hearts=32, minimum=33)
        monkeypatch.setattr(app_module, "firestore", FakeFirestoreModule(data))

        response = client.post("/api/v1/withdrawals/request", json={})

        assert response.status_code == 400
        assert "33" in response.get_json()["error"]
        # Nothing taken, nothing recorded.
        assert data["users/%s" % TEST_UID]["hearts"] == 32
        assert not [k for k in data if k.startswith("withdrawalRequests/")]

    def test_minimum_comes_from_settings_not_a_constant(self, client, as_user, monkeypatch):
        """Raising the floor in admin settings takes effect immediately."""
        data = make_store(hearts=50, minimum=100)
        monkeypatch.setattr(app_module, "firestore", FakeFirestoreModule(data))

        response = client.post("/api/v1/withdrawals/request", json={})

        assert response.status_code == 400
        assert data["users/%s" % TEST_UID]["hearts"] == 50


# ===========================================================================
# 2. Hearts are spent when the claim is staked
# ===========================================================================

class TestHeartsDeductedOnRequest:
    def test_hearts_are_zeroed_and_claim_recorded(self, client, as_user, store):
        response = client.post("/api/v1/withdrawals/request", json={})

        assert response.status_code == 200
        assert user_of(store)["hearts"] == 0
        # The open-request marker is what makes "one at a time" enforceable.
        assert user_of(store)["pendingWithdrawalId"] == request_id_of(store)

    def test_second_request_is_refused_while_one_is_open(self, client, as_user, store):
        """The leak that let one balance be claimed twice over."""
        first = client.post("/api/v1/withdrawals/request", json={})
        assert first.status_code == 200

        # Hand the user a fresh balance; the open claim must still block them.
        user_of(store)["hearts"] = 100
        second = client.post("/api/v1/withdrawals/request", json={})

        assert second.status_code == 400
        assert "already awaiting review" in second.get_json()["error"]
        assert user_of(store)["hearts"] == 100  # untouched by the refused call
        assert len([k for k in store if k.startswith("withdrawalRequests/")]) == 1

    def test_balance_is_read_inside_the_transaction(self, client, as_user, fake_fs):
        """Guards the optimistic-concurrency wiring the fake cannot simulate.

        The fake applies writes immediately, so it can never actually produce a
        double spend — which means no test here can prove concurrency safety by
        observation. What it CAN prove is that the balance is read with
        `transaction=`, because a read issued without it is never entered into
        Firestore's read set, and that is exactly what would let two concurrent
        callers both see no pending request and both get paid.

        Delete the kwarg in request_withdrawal and this test fails.
        """
        module, data = fake_fs

        assert client.post("/api/v1/withdrawals/request", json={}).status_code == 200

        user_reads = [r for r in module.reads if r["path"] == "users/%s" % TEST_UID]
        assert user_reads, "the balance was never read at all"
        assert all(r["in_transaction"] for r in user_reads), (
            "the balance was read outside the transaction, so Firestore would not "
            "detect a concurrent withdrawal and both could be paid"
        )

    def test_fractional_hearts_remainder_is_not_confiscated(self, client, as_user, monkeypatch):
        """A part-earned heart survives a payout instead of being zeroed."""
        data = make_store(hearts=33.6, rate=3, minimum=33)
        monkeypatch.setattr(app_module, "firestore", FakeFirestoreModule(data))

        response = client.post("/api/v1/withdrawals/request", json={})

        assert response.status_code == 200
        # Paid for 33 whole hearts, not 33.6 — payouts are whole hearts.
        assert response.get_json()["amountInr"] == 99
        # …and the 0.6 is still there rather than silently taken.
        assert data["users/%s" % TEST_UID]["hearts"] == pytest.approx(0.6)

    def test_unauthenticated_request_is_rejected(self, client, store, monkeypatch):
        monkeypatch.setattr(
            app_module,
            "require_bearer_uid",
            lambda: (None, (app_module.jsonify({"error": "Authentication required"}), 401)),
        )

        response = client.post("/api/v1/withdrawals/request", json={})

        assert response.status_code == 401
        assert user_of(store)["hearts"] == 100


# ===========================================================================
# 3. Resolution: rejection refunds, approval does not re-deduct
# ===========================================================================

class TestResolve:
    def _open(self, client):
        assert client.post("/api/v1/withdrawals/request", json={}).status_code == 200

    def test_rejection_refunds_the_hearts(self, client, as_user, store, monkeypatch):
        self._open(client)
        assert user_of(store)["hearts"] == 0
        req_id = request_id_of(store)
        become_admin(monkeypatch)

        response = client.post(
            "/api/v1/withdrawals/resolve",
            json={"requestId": req_id, "status": "rejected"},
        )

        assert response.status_code == 200
        # Refunded, not silently confiscated — the mirror of the original bug.
        assert user_of(store)["hearts"] == 100
        assert "pendingWithdrawalId" not in user_of(store)
        assert only_request(store)["status"] == "rejected"

    def test_approval_does_not_deduct_again(self, client, as_user, store, monkeypatch):
        """Hearts were taken at request time; approving must not take them twice."""
        self._open(client)
        req_id = request_id_of(store)
        become_admin(monkeypatch)

        response = client.post(
            "/api/v1/withdrawals/resolve",
            json={"requestId": req_id, "status": "approved"},
        )

        assert response.status_code == 200
        assert user_of(store)["hearts"] == 0
        # Cleared, so earning towards the next payout can start straight away.
        assert "pendingWithdrawalId" not in user_of(store)

    def test_replayed_rejection_refunds_only_once(self, client, as_user, store, monkeypatch):
        """Without the status guard, each replay would mint another refund."""
        self._open(client)
        req_id = request_id_of(store)
        become_admin(monkeypatch)
        payload = {"requestId": req_id, "status": "rejected"}

        assert client.post("/api/v1/withdrawals/resolve", json=payload).status_code == 200
        second = client.post("/api/v1/withdrawals/resolve", json=payload)

        assert second.status_code == 400
        assert "already" in second.get_json()["error"]
        assert user_of(store)["hearts"] == 100  # refunded once, not twice

    def test_legacy_request_is_not_refunded(self, client, as_user, store, monkeypatch):
        """A claim written by the old client path never debited the balance.

        Refunding it would create hearts out of nothing, and hearts convert to
        rupees — so rejecting a legacy request must clear it without paying
        anything back.
        """
        store["withdrawalRequests/legacy_1"] = {
            "uid": TEST_UID,
            "hearts": 500,
            "amountInr": 1500,
            "status": "pending",
            # No heartsDeducted marker: the old path never took the hearts.
        }
        user_of(store)["pendingWithdrawalId"] = "legacy_1"
        become_admin(monkeypatch)

        response = client.post(
            "/api/v1/withdrawals/resolve",
            json={"requestId": "legacy_1", "status": "rejected"},
        )

        assert response.status_code == 200
        assert store["withdrawalRequests/legacy_1"]["status"] == "rejected"
        # Balance untouched — no 500 hearts conjured into existence.
        assert user_of(store)["hearts"] == 100
        assert "pendingWithdrawalId" not in user_of(store)

    def test_approved_can_then_be_marked_paid(self, client, as_user, store, monkeypatch):
        """The ordinary operator sequence: authorise, then confirm the transfer.

        Treating every non-pending status as final made this impossible and
        pushed operators into marking a payout `paid` before the money moved.
        """
        self._open(client)
        req_id = request_id_of(store)
        become_admin(monkeypatch)

        approve = client.post(
            "/api/v1/withdrawals/resolve",
            json={"requestId": req_id, "status": "approved"},
        )
        assert approve.status_code == 200

        paid = client.post(
            "/api/v1/withdrawals/resolve",
            json={"requestId": req_id, "status": "paid"},
        )

        assert paid.status_code == 200
        assert only_request(store)["status"] == "paid"
        # Still no refund anywhere along that path.
        assert user_of(store)["hearts"] == 0

    def test_paid_is_terminal(self, client, as_user, store, monkeypatch):
        """Once paid, a rejection must not claw hearts back into the balance."""
        self._open(client)
        req_id = request_id_of(store)
        become_admin(monkeypatch)
        # pending → approved → paid is the real operator sequence; jumping
        # straight to paid would not exercise the terminal-state guard the way
        # production traffic does.
        approve = client.post(
            "/api/v1/withdrawals/resolve",
            json={"requestId": req_id, "status": "approved"},
        )
        assert approve.status_code == 200
        paid = client.post(
            "/api/v1/withdrawals/resolve",
            json={"requestId": req_id, "status": "paid"},
        )
        assert paid.status_code == 200

        response = client.post(
            "/api/v1/withdrawals/resolve",
            json={"requestId": req_id, "status": "rejected"},
        )

        assert response.status_code == 400
        assert only_request(store)["status"] == "paid"
        assert user_of(store)["hearts"] == 0  # no phantom refund

    def test_non_admin_cannot_resolve(self, client, as_user, store):
        """as_user is authenticated but not in the admin allowlist."""
        self._open(client)
        req_id = request_id_of(store)

        response = client.post(
            "/api/v1/withdrawals/resolve",
            json={"requestId": req_id, "status": "approved"},
        )

        assert response.status_code == 403
        assert only_request(store)["status"] == "pending"

    def test_unknown_status_is_refused(self, client, as_user, store, monkeypatch):
        self._open(client)
        become_admin(monkeypatch)

        response = client.post(
            "/api/v1/withdrawals/resolve",
            json={"requestId": request_id_of(store), "status": "paid_out_lol"},
        )

        assert response.status_code == 400
        assert only_request(store)["status"] == "pending"
