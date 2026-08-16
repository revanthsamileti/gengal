"""The opening tick of a call, and the free minute it used to hand out.

Billing works from `lastBilledAt`: the first tick only writes that stamp, and
every tick after it charges for the interval since. That means the opening
interval is, by construction, free — which is correct for someone who is paying
for the rest of the call, and an open door for someone who is not paying at
all. A caller with an empty balance could talk until the next tick, hang up
before it landed, and start again, indefinitely, for nothing.

The opening tick is the only place that can turn them away: by the time the
first chargeable tick runs they have already had the call. It is also the tick
that stamps `inCallSince`, which is why the client now fires it the instant a
call connects rather than waiting for the regular cadence — see
test_busy_presence.py for that half.

A caller with *some* balance is deliberately left alone. The billing path
already lets them spend down to nothing and cuts the call there, so refusing
them up front would take away time they have paid for.
"""

import pytest
from datetime import datetime, timezone, timedelta

import app as app_module
from conftest import TEST_UID
from fake_firestore import FakeFirestoreModule


CALLER = TEST_UID
RECEIVER = "receiver_under_test"
ROOM = "room_opening"


def make_store(caller_coins, last_billed=None):
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
        "users/%s" % CALLER: {"coins": caller_coins},
        "users/%s" % RECEIVER: {"coins": 0},
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


class TestOpeningTick:
    def test_caller_with_no_coins_is_refused(self, client, as_user, store):
        """Otherwise every call's opening interval is free, on repeat."""
        store(caller_coins=0)

        body = tick(client).get_json()

        assert body["hasInsufficientFunds"] is True, (
            "a payer with nothing cannot be caught by any later tick — they "
            "will have hung up and redialled before one arrives"
        )

    def test_caller_with_a_balance_is_let_through(self, client, as_user, store):
        """Even a small balance buys time that has already been paid for."""
        store(caller_coins=1)

        body = tick(client).get_json()

        assert body["hasInsufficientFunds"] is False
        assert body["billedSeconds"] == 0  # the opening tick still charges nothing

    def test_refusal_does_not_charge_or_start_the_clock_twice(self, client, as_user, store):
        """The refusal is a report, not a side effect."""
        data = store(caller_coins=0)

        tick(client)

        assert data["users/%s" % CALLER]["coins"] == 0
        assert data["calls/%s" % ROOM]["durationSeconds"] == 0

    def test_running_out_mid_call_still_reports_on_a_later_tick(self, client, as_user, store):
        """The existing cut-off is unchanged: spend to zero, then the call ends."""
        data = store(caller_coins=1, last_billed=datetime.now(timezone.utc) - timedelta(seconds=30))

        body = tick(client).get_json()

        # 30s at 15/min is 7.5 coins against a balance of 1.
        assert body["hasInsufficientFunds"] is True
        assert data["users/%s" % CALLER]["coins"] == 0, "they pay what they have, no further"
