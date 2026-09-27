"""Money-path hardening: client-trusted amounts, seat races, billing caps."""

import pytest
from datetime import datetime, timedelta, timezone

import app as app_module
from conftest import TEST_UID
from fake_firestore import FakeFirestoreModule


HOST_UID = "host_under_test"
OTHER_UID = "other_player"
ROOM_ID = "ludo_room_1"
CALL_ID = "call_ended_reactivate"


@pytest.fixture
def money_store(monkeypatch):
    data = {
        "users/%s" % TEST_UID: {"coins": 500, "hearts": 0},
        "users/%s" % HOST_UID: {"coins": 100, "hearts": 0},
        "users/%s" % OTHER_UID: {"coins": 500, "hearts": 0},
        "ludo_rooms/%s" % ROOM_ID: {
            "hostUid": HOST_UID,
            "ticketPrice": 50,
            "players": [{"uid": HOST_UID, "color": "red", "nickname": "Host"}],
            "activeMemberCount": 1,
        },
    }
    monkeypatch.setattr(app_module, "firestore", FakeFirestoreModule(data))
    return data


class TestCommissionIsServerAuthoritative:
    def test_client_commission_amount_is_ignored(self, client, as_user, money_store):
        """A patched client used to set commissionAmount == amount for a full P2P."""
        response = client.post(
            "/api/v1/coins/deduct-with-commission",
            json={
                "userId": TEST_UID,
                "hostUid": HOST_UID,
                "amount": 100,
                "commissionAmount": 100,  # ignored; server uses 10%
            },
        )
        assert response.status_code == 200
        assert money_store["users/%s" % TEST_UID]["coins"] == 400
        # floor(100 * 0.1) = 10, not 100
        assert money_store["users/%s" % HOST_UID]["coins"] == 110


class TestTransferCaps:
    def test_transfer_above_gift_cap_is_rejected(self, client, as_user, money_store):
        response = client.post(
            "/api/v1/coins/transfer",
            json={
                "senderId": TEST_UID,
                "receiverId": HOST_UID,
                "amount": 1001,
            },
        )
        assert response.status_code == 400
        assert money_store["users/%s" % TEST_UID]["coins"] == 500


class TestLudoBuyTicket:
    def test_seats_atomically_using_room_price(self, client, as_user, money_store):
        response = client.post(
            "/api/v1/ludo/buy-ticket",
            json={
                "roomId": ROOM_ID,
                "color": "blue",
                "nickname": "Buyer",
                "avatarData": None,
            },
        )
        assert response.status_code == 200, response.get_json()
        assert money_store["users/%s" % TEST_UID]["coins"] == 450
        assert money_store["users/%s" % HOST_UID]["coins"] == 105  # +5 commission
        players = money_store["ludo_rooms/%s" % ROOM_ID]["players"]
        assert any(p.get("uid") == TEST_UID and p.get("color") == "blue" for p in players)

    def test_second_buyer_of_same_colour_is_rejected(self, client, as_user, money_store, monkeypatch):
        first = client.post(
            "/api/v1/ludo/buy-ticket",
            json={"roomId": ROOM_ID, "color": "green", "nickname": "One"},
        )
        assert first.status_code == 200

        # Switch identity to another user for the race loser.
        monkeypatch.setattr(app_module, "require_bearer_uid", lambda: (OTHER_UID, None))
        second = client.post(
            "/api/v1/ludo/buy-ticket",
            json={"roomId": ROOM_ID, "color": "green", "nickname": "Two"},
        )
        assert second.status_code == 400
        assert money_store["users/%s" % OTHER_UID]["coins"] == 500  # no debit


class TestCallBillingEndedAt:
    def test_ended_at_caps_billing_even_if_status_active(self, client, as_user, monkeypatch):
        """Reactivating status after hang-up must not reopen the billable window."""
        ended_at = datetime.now(timezone.utc) - timedelta(seconds=30)
        last_billed = ended_at - timedelta(seconds=20)
        data = {
            "settings/pricing": {
                "voiceCallRatePerMin": 60,
                "videoCallRatePerMin": 60,
                "creatorSharePercentage": 50,
            },
            "users/%s" % TEST_UID: {"coins": 1000, "hearts": 0},
            "users/%s" % HOST_UID: {"coins": 0, "hearts": 0},
            "calls/%s" % CALL_ID: {
                "callerUid": TEST_UID,
                "receiverUid": HOST_UID,
                "mode": "voice",
                # Attacker flipped status back to active after hang-up.
                "status": "active",
                "endedAt": ended_at,
                "lastBilledAt": last_billed,
                "durationSeconds": 0,
                "coinsDeducted": 0,
            },
        }
        monkeypatch.setattr(app_module, "firestore", FakeFirestoreModule(data))

        response = client.post("/api/v1/coins/call-billing", json={"roomId": CALL_ID})
        assert response.status_code == 200, response.get_json()
        body = response.get_json()
        # bill_until = ended_at, so ~20s at 60/min = 20 coins, not 50s of now.
        assert body["billedSeconds"] <= 21
        assert body["billedAmount"] <= 21


class TestLudoCreateTable:
    def test_create_deducts_fee_and_returns_room(self, client, as_user, money_store):
        response = client.post(
            "/api/v1/ludo/create-table",
            json={"gameMode": "per_game", "nickname": "Host"},
        )
        assert response.status_code == 200, response.get_json()
        body = response.get_json()
        assert body["tableCost"] == 10
        assert money_store["users/%s" % TEST_UID]["coins"] == 490
        room = money_store["ludo_rooms/%s" % body["roomId"]]
        assert room["hostUid"] == TEST_UID
        assert room["ticketPrice"] == 50

    def test_create_rejects_broke_user(self, client, as_user, money_store):
        money_store["users/%s" % TEST_UID]["coins"] = 5
        response = client.post(
            "/api/v1/ludo/create-table",
            json={"gameMode": "per_token", "nickname": "Host"},
        )
        assert response.status_code == 400


class TestLudoPlaceBet:
    def test_bet_is_fixed_amount_and_recorded(self, client, as_user, money_store):
        response = client.post(
            "/api/v1/ludo/place-bet",
            json={"roomId": ROOM_ID, "color": "blue"},
        )
        assert response.status_code == 200, response.get_json()
        assert money_store["users/%s" % TEST_UID]["coins"] == 450
        # floor(50 * 0.1) = 5 to host
        assert money_store["users/%s" % HOST_UID]["coins"] == 105
        bets = money_store["ludo_rooms/%s" % ROOM_ID]["audienceBets"]
        assert bets[TEST_UID]["amount"] == 50
        assert bets[TEST_UID]["color"] == "blue"


class TestLudoRoll:
    def test_per_token_roll_charges_and_sets_dice(self, client, as_user, money_store):
        money_store["ludo_rooms/%s" % ROOM_ID].update({
            "phase": "playing",
            "gameMode": "per_token",
            "currentTurn": "red",
            "diceRolled": False,
            "consecutiveSixes": 0,
            "players": [{"uid": TEST_UID, "color": "red", "nickname": "Me"}],
            "hostUid": HOST_UID,
        })
        # Act as the seated player who is also TEST_UID
        response = client.post("/api/v1/ludo/roll", json={"roomId": ROOM_ID})
        assert response.status_code == 200, response.get_json()
        body = response.get_json()
        assert 1 <= body["diceValue"] <= 6
        assert money_store["users/%s" % TEST_UID]["coins"] == 485  # -15
        room = money_store["ludo_rooms/%s" % ROOM_ID]
        if body.get("forfeited"):
            assert room["diceRolled"] is False
        else:
            assert room["diceRolled"] is True
            assert room["diceValue"] == body["diceValue"]
