"""Rooms / voice lockdown: Agora membership+role, host billing presence, seats."""

from datetime import datetime, timedelta, timezone

import pytest

import app as app_module
from conftest import TEST_UID
from fake_firestore import FakeFirestoreModule


HOST_UID = "host_under_test"
GUEST_UID = "guest_under_test"
ROOM_ID = "expert_room_1"
LUDO_ID = "ludo_room_voice"


def auth_as(monkeypatch, uid):
    monkeypatch.setattr(app_module, "require_bearer_uid", lambda: (uid, None))


@pytest.fixture
def rooms_store(monkeypatch):
    now = datetime.now(timezone.utc)
    data = {
        "users/%s" % TEST_UID: {"coins": 500, "hearts": 0},
        "users/%s" % HOST_UID: {"coins": 100, "hearts": 0},
        "users/%s" % GUEST_UID: {"coins": 500, "hearts": 0},
        "expert_rooms/%s" % ROOM_ID: {
            "hostUid": HOST_UID,
            "ratePerMin": 60,
            "status": "live",
            "speakers": [{"uid": HOST_UID, "nickname": "Host"}],
        },
        "expert_rooms/%s/members/%s" % (ROOM_ID, GUEST_UID): {
            "uid": GUEST_UID,
            "lastSeen": now,
        },
        "expert_rooms/%s/members/%s" % (ROOM_ID, HOST_UID): {
            "uid": HOST_UID,
            "lastSeen": now,
        },
        "ludo_rooms/%s" % LUDO_ID: {
            "hostUid": HOST_UID,
            "status": "live",
            "players": [{"uid": HOST_UID, "color": "red"}],
            "playerUids": [HOST_UID],
            "ticketPrice": 50,
            "activeMemberCount": 1,
        },
    }
    monkeypatch.setattr(app_module, "firestore", FakeFirestoreModule(data))
    monkeypatch.setattr(app_module, "AGORA_APP_ID", "test_app_id")
    monkeypatch.setattr(app_module, "AGORA_APP_CERTIFICATE", "test_cert")
    monkeypatch.setattr(
        app_module.RtcTokenBuilder,
        "buildTokenWithUid",
        staticmethod(lambda *a, **k: "fake-token"),
    )
    return data


class TestAgoraTokenMembership:
    def test_stranger_cannot_mint(self, client, as_user, rooms_store):
        response = client.post(
            "/api/v1/agora/generate-token",
            json={"roomId": ROOM_ID, "role": "audience"},
        )
        assert response.status_code == 403

    def test_member_gets_audience_token(self, client, rooms_store, monkeypatch):
        auth_as(monkeypatch, GUEST_UID)
        response = client.post(
            "/api/v1/agora/generate-token",
            json={"roomId": ROOM_ID, "role": "broadcaster"},
        )
        assert response.status_code == 200, response.get_json()
        body = response.get_json()
        # Guest is not on speakers — publisher request is ignored.
        assert body["role"] == "audience"
        assert body["token"] == "fake-token"

    def test_host_gets_publisher_token(self, client, rooms_store, monkeypatch):
        auth_as(monkeypatch, HOST_UID)
        response = client.post(
            "/api/v1/agora/generate-token",
            json={"roomId": ROOM_ID},
        )
        assert response.status_code == 200
        assert response.get_json()["role"] == "broadcaster"

    def test_closed_room_rejected(self, client, rooms_store, monkeypatch):
        rooms_store["expert_rooms/%s" % ROOM_ID]["status"] = "closed"
        auth_as(monkeypatch, HOST_UID)
        response = client.post(
            "/api/v1/agora/generate-token",
            json={"roomId": ROOM_ID},
        )
        assert response.status_code == 403


class TestRoomBillingPresence:
    def test_host_tick_skips_stale_guest(self, client, rooms_store, monkeypatch):
        stale = datetime.now(timezone.utc) - timedelta(seconds=120)
        rooms_store["expert_rooms/%s/members/%s" % (ROOM_ID, GUEST_UID)]["lastSeen"] = stale
        auth_as(monkeypatch, HOST_UID)
        response = client.post(
            "/api/v1/rooms/billing",
            json={
                "roomId": ROOM_ID,
                "collection": "expert_rooms",
                "memberUid": GUEST_UID,
            },
        )
        assert response.status_code == 200
        body = response.get_json()
        assert body.get("skipped") == "not_present"
        assert body.get("billedAmount") == 0
        assert rooms_store["users/%s" % GUEST_UID]["coins"] == 500


class TestLeaveSeatAndStage:
    def test_leave_seat_removes_player(self, client, as_user, rooms_store):
        rooms_store["ludo_rooms/%s" % LUDO_ID]["players"].append(
            {"uid": TEST_UID, "color": "blue"}
        )
        rooms_store["ludo_rooms/%s" % LUDO_ID]["playerUids"] = [HOST_UID, TEST_UID]
        response = client.post(
            "/api/v1/ludo/leave-seat",
            json={"roomId": LUDO_ID},
        )
        assert response.status_code == 200, response.get_json()
        room = rooms_store["ludo_rooms/%s" % LUDO_ID]
        assert TEST_UID not in room["playerUids"]
        assert all(p.get("uid") != TEST_UID for p in room["players"])

    def test_leave_stage_removes_speaker(self, client, rooms_store, monkeypatch):
        rooms_store["expert_rooms/%s" % ROOM_ID]["speakers"].append(
            {"uid": GUEST_UID, "nickname": "Guest"}
        )
        rooms_store["expert_rooms/%s" % ROOM_ID]["handQueue"] = [GUEST_UID]
        auth_as(monkeypatch, GUEST_UID)
        response = client.post(
            "/api/v1/rooms/expert/leave-stage",
            json={"roomId": ROOM_ID},
        )
        assert response.status_code == 200
        room = rooms_store["expert_rooms/%s" % ROOM_ID]
        assert all(s.get("uid") != GUEST_UID for s in room["speakers"])
        assert GUEST_UID not in room["handQueue"]

    def test_host_cannot_leave_own_stage_slot(self, client, rooms_store, monkeypatch):
        auth_as(monkeypatch, HOST_UID)
        response = client.post(
            "/api/v1/rooms/expert/leave-stage",
            json={"roomId": ROOM_ID},
        )
        assert response.status_code == 200
        speakers = rooms_store["expert_rooms/%s" % ROOM_ID]["speakers"]
        assert any(s.get("uid") == HOST_UID for s in speakers)
