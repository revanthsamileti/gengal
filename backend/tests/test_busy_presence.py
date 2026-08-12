"""The server-stamped "on a call right now" marker.

The discovery feed has a full busy/waitlist treatment — a busy pill, a "join
the waitlist" flow, an "Available now" filter and a sort tier — that was dead
code in practice, because nothing ever marked a real user busy. Callers rang
people already mid-call and paid the full ring timeout to find out.

The marker is written here rather than by the client, on the billing tick that
already runs every 15 seconds for both participants, because:

  * a client cannot then spoof its own availability, and
  * it is a *timestamp*, not a boolean, so a call that ends by force-quit or a
    dead network is never left stranded as permanently busy — nothing refreshes
    the stamp and readers age it out.

Both of those properties are asserted below.
"""

import pytest
from datetime import datetime, timezone, timedelta

import app as app_module
from conftest import TEST_UID
from fake_firestore import FakeFirestoreModule


CALLER = TEST_UID
RECEIVER = "receiver_under_test"
ROOM = "room_1"


def make_store(last_billed=None):
    call = {
        "callerUid": CALLER,
        "receiverUid": RECEIVER,
        "mode": "call",
        "status": "active",
        "durationSeconds": 0,
        "coinsDeducted": 0,
    }
    if last_billed is not None:
        call["lastBilledAt"] = last_billed
    return {
        "settings/pricing": {"voiceCallRatePerMin": 15, "creatorSharePercentage": 70},
        "calls/%s" % ROOM: call,
        "users/%s" % CALLER: {"coins": 1000, "hearts": 0},
        "users/%s" % RECEIVER: {"coins": 0, "hearts": 0},
    }


@pytest.fixture
def billing(monkeypatch):
    data = make_store()
    monkeypatch.setattr(app_module, "firestore", FakeFirestoreModule(data))
    return data


def tick(client):
    return client.post("/api/v1/coins/call-billing", json={"roomId": ROOM})


class TestBusyMarker:
    def test_first_tick_marks_both_parties(self, client, as_user, billing):
        """The opening tick only starts the clock — but both are already talking.

        Without a stamp on this path the pair would read as free for the first
        billing interval, which is exactly when a second caller is most likely
        to try them.
        """
        response = tick(client)

        assert response.status_code == 200
        # No money moves on the first tick; that is the existing contract.
        assert response.get_json()["billedSeconds"] == 0
        assert billing["users/%s" % CALLER]["inCallSince"] is not None
        assert billing["users/%s" % RECEIVER]["inCallSince"] is not None

    def test_subsequent_tick_refreshes_both(self, client, as_user, monkeypatch):
        """A billing tick re-stamps, which is what keeps the marker alive."""
        earlier = datetime.now(timezone.utc) - timedelta(seconds=20)
        data = make_store(last_billed=earlier)
        monkeypatch.setattr(app_module, "firestore", FakeFirestoreModule(data))

        response = tick(client)

        assert response.status_code == 200
        assert response.get_json()["billedSeconds"] > 0  # real money path ran
        for uid in (CALLER, RECEIVER):
            stamped = data["users/%s" % uid]["inCallSince"]
            assert stamped is not None
            # Refreshed to now, not left at the older value.
            assert stamped > earlier

    def test_marker_is_a_timestamp_not_a_flag(self, client, as_user, billing):
        """The property that makes an abandoned call self-healing.

        A boolean would need clearing by a client that may never run again.
        A timestamp lets readers expire it, so nothing has to be cleaned up.
        """
        tick(client)

        stamped = billing["users/%s" % CALLER]["inCallSince"]
        assert isinstance(stamped, datetime), (
            "a non-timestamp marker cannot age out, and a client that dies "
            "mid-call would leave this user permanently unreachable"
        )

    def test_client_cannot_set_its_own_marker(self, client, as_user, billing):
        """Availability is the server's to state, not the caller's."""
        response = client.post(
            "/api/v1/coins/call-billing",
            json={"roomId": ROOM, "inCallSince": None, "isBusy": False},
        )

        assert response.status_code == 200
        # The body's opinion is ignored; the stamp lands anyway.
        assert billing["users/%s" % CALLER]["inCallSince"] is not None
