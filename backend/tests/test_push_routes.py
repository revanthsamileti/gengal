"""Call and message notifications.

Delivery is stubbed at the transport (`send_fcm` / `send_expo`), so these assert
the decisions the server makes -- who is notified, with what, and what happens
to a token the phone no longer answers to -- without any network.
"""

import json
from datetime import datetime, timedelta, timezone

import pytest

import app as app_module
import push
from fake_firestore import FakeFirestoreModule


# Real Firebase uids never contain "_", which is what lets a chat id split
# back into its two participants; the shared TEST_UID does, so not used here.
ME = "uidMe01"
PEER = "uidPeer02"
CHAT = "%s_%s" % tuple(sorted([ME, PEER]))


def now():
    return datetime.now(timezone.utc)


@pytest.fixture
def store(monkeypatch):
    monkeypatch.setattr(app_module, "require_bearer_uid", lambda: (ME, None))
    data = {
        "users/%s" % ME: {"nickname": "Sai", "isActiveMode": True},
        "users/%s" % PEER: {"nickname": "Asha", "isActiveMode": True, "isOnline": True, "pushReachable": True},
        "user_private/%s" % PEER: {"fcmToken": "fcm-peer"},
        "incoming_calls/%s" % PEER: {"callerUid": ME, "roomId": "room_1"},
        "chats/%s" % CHAT: {"participants": [ME, PEER]},
        "chats/%s/messages/m1" % CHAT: {"senderId": ME, "text": "hello Asha", "timestamp": now()},
    }
    monkeypatch.setattr(app_module, "firestore", FakeFirestoreModule(data))
    monkeypatch.setattr(app_module, "_rate_buckets", {})
    return data


@pytest.fixture
def sent(monkeypatch):
    """Every push handed to a transport, as (transport, token, data, ttl)."""
    out = []

    def fcm(token, data, ttl_seconds):
        out.append(("fcm", token, data, ttl_seconds))

    def expo(token, data, ttl_seconds):
        out.append(("expo", token, data, ttl_seconds))
        return True

    monkeypatch.setattr(app_module, "send_fcm", fcm)
    monkeypatch.setattr(app_module, "send_expo", expo)
    return out


def call(client, mode="call"):
    return client.post("/api/v1/calls/notify", json={"receiverUid": PEER, "mode": mode})


def message(client, message_id="m1", chat_id=CHAT):
    return client.post("/api/v1/chats/notify", json={"chatId": chat_id, "messageId": message_id})


# --- calls ------------------------------------------------------------------

def test_call_goes_out_over_fcm_on_the_call_channel(client, store, sent):
    r = call(client, "video")

    assert r.status_code == 200 and r.get_json()["delivered"] is True
    (transport, token, data, ttl), = sent
    assert (transport, token) == ("fcm", "fcm-peer")
    assert data["channelId"] == push.CALL_CHANNEL
    assert data["title"] == "Incoming Video Call"
    body = json.loads(data["body"])
    assert body["roomId"] == "room_1" and body["callerUid"] == ME and body["mode"] == "video"
    assert body["callerName"] == "Sai"
    # A call notification delivered after the offer expired rings a dead call.
    assert ttl <= 60


def test_a_ringing_phone_gets_its_own_call_channel(client, store, sent):
    store["user_private/%s" % PEER]["callChannelId"] = "calls_v3"

    call(client)

    assert sent[0][2]["channelId"] == "calls_v3"


def test_call_carries_the_answer_and_decline_buttons(client, store, sent):
    call(client)

    # Android only shows the buttons when the notification names the category
    # the app registered.
    assert sent[0][2]["categoryId"] == push.CALL_CATEGORY


def test_a_message_has_no_call_buttons(client, store, sent):
    message(client)

    assert "categoryId" not in sent[0][2]


def test_switch_off_means_no_call_notification(client, store, sent):
    store["users/%s" % PEER]["isActiveMode"] = False

    r = call(client)

    assert r.status_code == 200 and r.get_json()["delivered"] is False
    assert sent == []


def test_blocked_caller_is_not_notified_and_not_told(client, store, sent):
    store["user_private/%s" % PEER]["blockedUids"] = [ME]

    r = call(client)

    assert r.status_code == 200 and r.get_json()["delivered"] is False
    assert sent == []


def test_call_without_an_offer_is_refused(client, store, sent):
    del store["incoming_calls/%s" % PEER]

    assert call(client).status_code == 403
    assert sent == []


def test_a_token_the_phone_dropped_is_forgotten(client, store, monkeypatch):
    def gone(token, data, ttl_seconds):
        raise push.TokenGone(token)

    monkeypatch.setattr(app_module, "send_fcm", gone)
    monkeypatch.setattr(app_module, "send_expo", lambda *a: pytest.fail("no expo token to fall back to"))

    r = call(client)

    assert r.get_json()["delivered"] is False
    assert "fcmToken" not in store["user_private/%s" % PEER]
    # No longer listed as reachable in the background. Being signed in and
    # switched on is left alone: opening the app registers a fresh token.
    assert store["users/%s" % PEER]["pushReachable"] is False
    assert store["users/%s" % PEER]["isActiveMode"] is True


def test_falls_back_to_the_expo_token(client, store, sent):
    store["user_private/%s" % PEER] = {"expoPushToken": "ExponentPushToken[x]"}

    r = call(client)

    assert r.get_json()["delivered"] is True
    assert [s[0] for s in sent] == ["expo"]


def test_no_token_at_all(client, store, sent):
    store["user_private/%s" % PEER] = {}

    assert call(client).get_json()["delivered"] is False
    assert sent == []


# --- messages ---------------------------------------------------------------

def test_message_notifies_the_other_participant(client, store, sent):
    r = message(client)

    assert r.status_code == 200 and r.get_json()["delivered"] is True
    (transport, token, data, ttl), = sent
    assert (transport, token) == ("fcm", "fcm-peer")
    assert data["channelId"] == push.MESSAGE_CHANNEL
    assert data["title"] == "Sai"
    assert data["message"] == "hello Asha"
    assert data["tag"] == "chat_%s" % CHAT
    body = json.loads(data["body"])
    assert body == {"type": "message", "chatId": CHAT, "senderUid": ME, "senderName": "Sai"}


def test_message_notifies_even_with_the_switch_off(client, store, sent):
    # The online switch is about calls; messages are always delivered.
    store["users/%s" % PEER]["isActiveMode"] = False

    assert message(client).get_json()["delivered"] is True


def test_only_a_participant_can_notify(client, store, sent):
    r = message(client, chat_id="someone_else")

    assert r.status_code == 403
    assert sent == []


def test_only_the_sender_of_the_message_can_notify(client, store, sent):
    store["chats/%s/messages/m1" % CHAT]["senderId"] = PEER

    assert message(client).status_code == 403
    assert sent == []


def test_missing_message(client, store, sent):
    assert message(client, message_id="nope").status_code == 404
    assert sent == []


def test_each_message_notifies_once(client, store, sent):
    message(client)
    r = message(client)

    assert r.status_code == 200 and r.get_json()["delivered"] is False
    assert len(sent) == 1


def test_old_message_is_not_renotified(client, store, sent):
    store["chats/%s/messages/m1" % CHAT]["timestamp"] = now() - timedelta(hours=1)

    assert message(client).get_json()["delivered"] is False
    assert sent == []


def test_blocked_sender_is_not_notified(client, store, sent):
    store["user_private/%s" % PEER]["blockedUids"] = [ME]

    assert message(client).get_json()["delivered"] is False
    assert sent == []


def test_long_message_is_trimmed(client, store, sent):
    store["chats/%s/messages/m1" % CHAT]["text"] = "y" * 1000

    message(client)

    assert len(sent[0][2]["message"]) <= push.PREVIEW_CHARS


# --- who counts as online ---------------------------------------------------

def test_online_list_keeps_people_who_left_the_app_but_can_get_push(client, store):
    stale = now() - timedelta(hours=3)
    store["users/%s" % PEER]["lastActive"] = stale
    store["users/ghost"] = {"nickname": "Ghost", "isOnline": True, "lastActive": stale}

    r = client.post("/api/v1/users/online", json={"currentUid": ME})

    uids = [u["uid"] for u in r.get_json()["users"]]
    assert PEER in uids
    # Left the app with no way to reach them: not listed.
    assert "ghost" not in uids
