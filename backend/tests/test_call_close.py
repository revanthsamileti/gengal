"""What happens to a call's money and its busy marker when it hangs up.

Two things go wrong at the moment a call ends, and both are invisible unless
you look at the closing tick specifically.

The first is billing. Ticks land every fifteen seconds, so at any moment up to
fifteen seconds of a call are billed but not yet charged. Both clients fire one
last tick as they tear the call screen down to settle that remainder — but the
hang-up also marks the record `ended`, and the endpoint used to refuse any tick
on an ended call. Which of the two writes won was a race, so the tail of every
call was free, more often than not. It cannot simply be billed to "now"
either, or a client that flushed late would keep charging for time after both
people had hung up. `endedAt` is the boundary, and it is a server-generated
value, so the payer cannot backdate it to owe less.

The second is availability. `inCallSince` marks someone as mid-call and is
refreshed on every tick; readers expire it after CALL_BUSY_TTL_MS so a call
that dies with the app never strands anyone. But on a *clean* hang-up nothing
cleared it, so both people stayed unreachable — the feed showed them busy, and
the /incoming_calls rule turned callers away — for the remainder of that TTL
after they had finished talking. The closing tick is the one moment the server
knows the call is over, so it is where the marker comes off.
"""

import pytest
from datetime import datetime, timezone, timedelta

import app as app_module
from conftest import TEST_UID
from fake_firestore import FakeFirestoreModule


CALLER = TEST_UID
RECEIVER = "receiver_under_test"
ROOM = "room_closing"
RATE_PER_MIN = 15


def make_store(last_billed=None, ended_at=None, status="active", busy_at="same"):
    """A call record mid-flight, or closed `ended_at` ago.

    `busy_at` is what both users' `inCallSince` reads; "same" means the stamp
    this call itself left behind.
    """
    call = {
        "callerUid": CALLER,
        "receiverUid": RECEIVER,
        "mode": "call",
        "status": status,
        "durationSeconds": 0,
        "coinsDeducted": 0,
    }
    if last_billed is not None:
        call["lastBilledAt"] = last_billed
    if ended_at is not None:
        call["endedAt"] = ended_at

    stamp = last_billed if busy_at == "same" else busy_at
    user = lambda coins: {"coins": coins, "inCallSince": stamp} if stamp else {"coins": coins}

    return {
        "settings/pricing": {
            "voiceCallRatePerMin": RATE_PER_MIN,
            "creatorSharePercentage": 70,
        },
        "calls/%s" % ROOM: call,
        "users/%s" % CALLER: user(1000),
        "users/%s" % RECEIVER: user(0),
    }


def tick(client):
    return client.post("/api/v1/coins/call-billing", json={"roomId": ROOM})


@pytest.fixture
def store(monkeypatch):
    def build(**kwargs):
        data = make_store(**kwargs)
        monkeypatch.setattr(app_module, "firestore", FakeFirestoreModule(data))
        return data
    return build


class TestFinalInterval:
    def test_closing_tick_bills_the_unsettled_tail(self, client, as_user, store):
        """The seconds since the last tick are charged, not written off."""
        now = datetime.now(timezone.utc)
        data = store(
            last_billed=now - timedelta(seconds=12),
            ended_at=now,
            status="ended",
        )

        response = tick(client)

        assert response.status_code == 200
        billed = response.get_json()
        assert billed["billedSeconds"] == pytest.approx(12, abs=1), (
            "an ended call still owes for the interval since its last tick; "
            "refusing it makes the tail of every call free"
        )
        assert billed["billedAmount"] > 0
        assert data["users/%s" % CALLER]["coins"] < 1000
        # The receiver's share of that tail reaches them too.
        assert data["users/%s" % RECEIVER]["coins"] > 0

    def test_does_not_bill_past_the_hang_up(self, client, as_user, store):
        """A late flush cannot charge for time after both people left.

        The client sends this tick as the screen unmounts, but it can arrive
        seconds later on a slow network — or much later if the request is
        retried. Only the run-up to `endedAt` is billable.
        """
        now = datetime.now(timezone.utc)
        data = store(
            last_billed=now - timedelta(seconds=40),
            ended_at=now - timedelta(seconds=30),
            status="ended",
        )

        response = tick(client)

        assert response.get_json()["billedSeconds"] == pytest.approx(10, abs=1), (
            "billing to 'now' rather than to endedAt would charge the payer "
            "for the thirty seconds since they hung up"
        )
        assert data["calls/%s" % ROOM]["durationSeconds"] == pytest.approx(10, abs=1)

    def test_second_flush_bills_nothing(self, client, as_user, store):
        """Both clients flush, so the endpoint must be idempotent after close."""
        now = datetime.now(timezone.utc)
        data = store(
            last_billed=now - timedelta(seconds=12),
            ended_at=now,
            status="ended",
        )

        first = tick(client).get_json()
        charged_once = data["users/%s" % CALLER]["coins"]
        second = tick(client).get_json()

        assert first["billedSeconds"] > 0
        assert second["billedSeconds"] == 0
        assert data["users/%s" % CALLER]["coins"] == charged_once, (
            "the caller's own flush and the receiver's must not both charge "
            "for the same final interval"
        )

    def test_live_call_is_unaffected(self, client, as_user, store):
        """The ordinary mid-call tick keeps billing to the present moment."""
        now = datetime.now(timezone.utc)
        data = store(last_billed=now - timedelta(seconds=15))

        response = tick(client)

        assert response.get_json()["billedSeconds"] == pytest.approx(15, abs=1)
        assert data["users/%s" % CALLER]["inCallSince"] is not None


class TestBusyMarkerRelease:
    def test_closing_frees_both_participants(self, client, as_user, store):
        """Hanging up makes both people callable again immediately."""
        now = datetime.now(timezone.utc)
        data = store(
            last_billed=now - timedelta(seconds=12),
            ended_at=now,
            status="ended",
        )

        tick(client)

        for uid in (CALLER, RECEIVER):
            assert "inCallSince" not in data["users/%s" % uid], (
                "leaving the marker set holds both people off the market for "
                "the rest of the TTL after a call they have already finished"
            )

    def test_flush_with_nothing_to_bill_still_frees_them(self, client, as_user, store):
        """The second client's flush has no money to move but must still free them.

        Whichever flush arrives first settles the tail; the other finds nothing
        owing. If only the billing path cleared the marker, the outcome would
        depend on which device's request happened to land first.
        """
        now = datetime.now(timezone.utc)
        data = store(
            last_billed=now,
            ended_at=now,
            status="ended",
        )

        response = tick(client)

        assert response.get_json()["billedSeconds"] == 0
        assert "inCallSince" not in data["users/%s" % CALLER]
        assert "inCallSince" not in data["users/%s" % RECEIVER]

    def test_keeps_the_marker_of_someone_already_on_a_newer_call(self, client, as_user, store):
        """A late flush must not advertise someone who has moved on as free.

        People do ring straight back, and a delayed closing tick for the
        previous call would otherwise clear the marker their *current* call had
        just set — putting them back in the feed as available while they are
        mid-sentence with somebody else.
        """
        now = datetime.now(timezone.utc)
        ended = now - timedelta(seconds=30)
        data = store(
            last_billed=ended,
            ended_at=ended,
            status="ended",
            busy_at=now,  # stamped again by a call that started after this one
        )

        tick(client)

        assert data["users/%s" % CALLER]["inCallSince"] == now
        assert data["users/%s" % RECEIVER]["inCallSince"] == now

    def test_first_tick_of_an_ended_call_charges_nothing(self, client, as_user, store):
        """A call closed before it was ever billed leaves no clock running."""
        now = datetime.now(timezone.utc)
        data = store(ended_at=now, status="ended", busy_at=now)

        response = tick(client)

        assert response.get_json()["billedSeconds"] == 0
        assert data["users/%s" % CALLER]["coins"] == 1000
        assert "lastBilledAt" not in data["calls/%s" % ROOM], (
            "starting the billing clock on a call that has already ended "
            "would bill its first interval to whoever ticks next"
        )

    def test_releases_the_marker_when_the_closing_tick_landed_after_the_hang_up(
        self, client, as_user, store
    ):
        """The call's own late stamp must not be mistaken for a newer call.

        Observed on two real handsets: the hang-up and the final flush race,
        and the tick that still saw the record 'active' refreshed
        `inCallSince` a moment *after* `endedAt`. Judging that stamp against
        `endedAt` read it as "they are already talking to somebody else", so
        the marker was never cleared and both people stayed unreachable for
        the rest of the TTL after every call they finished.
        """
        now = datetime.now(timezone.utc)
        ended = now - timedelta(seconds=10)
        late = ended + timedelta(seconds=4)  # the closing tick that raced the hang-up
        data = store(
            last_billed=late,
            ended_at=ended,
            status="ended",
            busy_at=late,
        )

        response = tick(client)

        assert response.get_json()["billedSeconds"] == 0, (
            "nothing is owed once lastBilledAt is already past endedAt"
        )
        assert "inCallSince" not in data["users/%s" % CALLER], (
            "the caller is off the call and must not stay advertised as busy"
        )
        assert "inCallSince" not in data["users/%s" % RECEIVER]


class TestBillingContention:
    """A tick that loses a race must not be reported as a failure.

    Both participants tick the same call, so at the opening tick and again at
    the final flush their transactions collide on the same documents. Firestore
    aborts one to keep them serialisable. That reached the client as a 500 when
    it arrived as `Aborted`, and as a 400 quoting "Failed to commit transaction
    in 5 attempts." once the SDK had spent its retries -- an internal message
    shown to a user for a condition that costs them nothing, since the seconds
    stay owed and the next tick bills them.
    """

    def test_aborted_tick_reports_nothing_billed_instead_of_failing(
        self, client, as_user, store, monkeypatch
    ):
        from google.api_core.exceptions import Aborted
        store(status="active")

        def explode(fn):
            def raise_aborted(_transaction):
                raise Aborted("409 Aborted due to cross-transaction contention.")
            return raise_aborted

        monkeypatch.setattr(app_module.firestore, "transactional", explode)

        response = tick(client)

        assert response.status_code == 200, "contention is not the caller's error"
        body = response.get_json()
        assert body["billedSeconds"] == 0
        assert body["contended"] is True

    def test_retry_exhaustion_is_treated_the_same(
        self, client, as_user, store, monkeypatch
    ):
        store(status="active")

        def explode(fn):
            def raise_retry_exhausted(_transaction):
                raise ValueError("Failed to commit transaction in 5 attempts.")
            return raise_retry_exhausted

        monkeypatch.setattr(app_module.firestore, "transactional", explode)

        response = tick(client)

        assert response.status_code == 200
        assert response.get_json()["billedSeconds"] == 0

    def test_an_unrelated_value_error_still_surfaces(
        self, client, as_user, store, monkeypatch
    ):
        """The contention branch must not become a catch-all for ValueError."""
        store(status="active")

        def explode(fn):
            def raise_real_bug(_transaction):
                raise ValueError("rate is not a number")
            return raise_real_bug

        monkeypatch.setattr(app_module.firestore, "transactional", explode)

        response = tick(client)

        assert response.status_code == 400, "a genuine ValueError must not report success"
        assert "rate is not a number" in response.get_json()["error"]
