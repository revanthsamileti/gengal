"""Route tests for reverse-OTP sign-in.

The gateway webhook is signed exactly as SMS Gateway for Android signs it:
hex(HMAC-SHA256(key, raw_body + X-Timestamp)).
"""
import hashlib
import hmac
import itertools
import json
import time
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

import app as app_module
import sms_verify
from fake_firestore import FakeFirestoreModule

KEY = "test-signing-key"
GATEWAY = "+919000000001"
PHONE = "+919876543210"
UID = "fast2sms:" + PHONE


@pytest.fixture
def sms(monkeypatch):
    monkeypatch.setenv("SMS_GATEWAY_NUMBER", GATEWAY)
    monkeypatch.setenv("SMS_GATEWAY_SIGNING_KEY", KEY)
    monkeypatch.delenv("ALLOW_DEV_OTP_BYPASS", raising=False)
    # Deterministic, unique codes (482913, 482914, ...). None is a substring of
    # PHONE's digits, so "the code is never logged/stored" assertions cannot
    # pass or fail by coincidence.
    monkeypatch.setattr(app_module, "sms_sessions", sms_verify.SessionStore(
        min_poll_interval=0, code_source=itertools.count(482913).__next__))
    health = sms_verify.GatewayHealth()
    health.seen()
    monkeypatch.setattr(app_module, "sms_gateway", health)
    monkeypatch.setattr(app_module, "_rate_buckets", {})
    minted = []

    def fake_token(uid):
        minted.append(uid)
        return ("token-for-" + uid).encode()

    monkeypatch.setattr(app_module.auth, "create_custom_token", fake_token)
    store = {}
    monkeypatch.setattr(app_module, "firestore", FakeFirestoreModule(store))
    return SimpleNamespace(minted=minted, store=store, health=health)


def start(client, phone=PHONE, ip="10.0.0.1"):
    return client.post("/api/v1/auth/sms/start", json={"phone": phone},
                       environ_base={"REMOTE_ADDR": ip})


def status(client, session_id):
    return client.post("/api/v1/auth/sms/status", json={"sessionId": session_id})


def sms_event(sender, message, delivery_id=None, received_at=None, event="sms:received"):
    return {
        "event": event,
        "id": delivery_id or "d-" + uuid.uuid4().hex,
        "payload": {
            "messageId": "m1",
            "message": message,
            "sender": sender,
            "simNumber": 1,
            "receivedAt": received_at or datetime.now(timezone.utc).isoformat(),
        },
    }


def inbound(client, event, key=KEY, ts=None):
    body = json.dumps(event).encode()
    ts = str(int(time.time()) if ts is None else ts)
    sig = hmac.new(key.encode(), body + ts.encode(), hashlib.sha256).hexdigest()
    return client.post("/api/v1/auth/sms/inbound", data=body, headers={
        "Content-Type": "application/json", "X-Timestamp": ts, "X-Signature": sig,
    })


# --- the happy path --------------------------------------------------------------

def test_full_flow_signs_in_with_the_existing_uid_scheme(client, sms):
    r = start(client)
    assert r.status_code == 200
    body = r.get_json()
    assert body["gatewayNumber"] == GATEWAY
    assert body["message"] == "GENGAL " + body["code"]
    assert body["expiresIn"] == 600

    assert status(client, body["sessionId"]).get_json()["status"] == "pending"
    assert inbound(client, sms_event(PHONE, body["message"])).status_code == 200

    done = status(client, body["sessionId"]).get_json()
    assert done == {"status": "verified", "token": "token-for-" + UID, "isNewUser": True}
    assert sms.minted == [UID]


def test_token_is_issued_exactly_once(client, sms):
    body = start(client).get_json()
    inbound(client, sms_event(PHONE, body["message"]))
    assert status(client, body["sessionId"]).get_json()["status"] == "verified"
    assert status(client, body["sessionId"]).get_json() == {"status": "expired"}


def test_existing_user_is_not_new(client, sms):
    sms.store["users/" + UID] = {"uid": UID}
    body = start(client).get_json()
    inbound(client, sms_event(PHONE, body["message"]))
    assert status(client, body["sessionId"]).get_json()["isNewUser"] is False


def test_sender_in_local_format_still_matches(client, sms):
    body = start(client).get_json()
    inbound(client, sms_event("9876543210", body["message"]))
    assert status(client, body["sessionId"]).get_json()["status"] == "verified"


def test_older_gateway_payload_field_phoneNumber_is_accepted(client, sms):
    body = start(client).get_json()
    event = sms_event(PHONE, body["message"])
    event["payload"]["phoneNumber"] = event["payload"].pop("sender")
    inbound(client, event)
    assert status(client, body["sessionId"]).get_json()["status"] == "verified"


# --- security ----------------------------------------------------------------------

def test_sms_from_a_different_number_does_not_verify(client, sms):
    body = start(client).get_json()
    assert inbound(client, sms_event("+919123456789", body["message"])).status_code == 200
    assert status(client, body["sessionId"]).get_json()["status"] == "pending"


def test_unsigned_webhook_is_rejected(client, sms):
    body = start(client).get_json()
    r = client.post("/api/v1/auth/sms/inbound", json=sms_event(PHONE, body["message"]))
    assert r.status_code == 401
    assert status(client, body["sessionId"]).get_json()["status"] == "pending"


def test_webhook_signed_with_the_wrong_key_is_rejected(client, sms):
    body = start(client).get_json()
    assert inbound(client, sms_event(PHONE, body["message"]), key="wrong").status_code == 401


def test_webhook_with_a_stale_timestamp_is_rejected(client, sms):
    body = start(client).get_json()
    old = int(time.time()) - 400
    assert inbound(client, sms_event(PHONE, body["message"]), ts=old).status_code == 401


def test_replayed_delivery_id_is_ignored(client, sms):
    body = start(client).get_json()
    inbound(client, sms_event(PHONE, "GENGAL 000000", delivery_id="same"))
    inbound(client, sms_event(PHONE, body["message"], delivery_id="same"))
    assert status(client, body["sessionId"]).get_json()["status"] == "pending"


def test_stale_queued_sms_does_not_verify_a_new_session(client, sms):
    body = start(client).get_json()
    long_ago = datetime.fromtimestamp(time.time() - 3600, timezone.utc).isoformat()
    inbound(client, sms_event(PHONE, body["message"], received_at=long_ago))
    assert status(client, body["sessionId"]).get_json()["status"] == "pending"


def test_alphanumeric_sender_is_ignored(client, sms):
    body = start(client).get_json()
    inbound(client, sms_event("VK-GENGAL", body["message"]))
    assert status(client, body["sessionId"]).get_json()["status"] == "pending"


def test_invalid_phone_is_rejected(client, sms):
    r = start(client, phone="+15551234567")
    assert r.status_code == 400
    assert r.get_json()["code"] == "invalid_phone"


def test_per_phone_limit_is_three_per_ten_minutes(client, sms):
    for _ in range(3):
        assert start(client).status_code == 200
    r = start(client)
    assert r.status_code == 429
    assert r.get_json()["code"] == "rate_limited"


def test_per_ip_limit_is_twenty_per_hour(client, sms):
    for i in range(20):
        assert start(client, phone="+9198765%05d" % i, ip="10.9.9.9").status_code == 200
    assert start(client, phone="+919999999999", ip="10.9.9.9").status_code == 429
    assert start(client, phone="+919999999999", ip="10.9.9.8").status_code == 200


def test_polling_too_fast_is_throttled(client, sms, monkeypatch):
    monkeypatch.setattr(app_module, "sms_sessions", sms_verify.SessionStore(min_poll_interval=0.9))
    body = start(client).get_json()
    assert status(client, body["sessionId"]).status_code == 200
    r = status(client, body["sessionId"])
    assert r.status_code == 429
    assert r.get_json()["code"] == "throttled"


def test_unknown_session_is_expired(client, sms):
    assert status(client, "nope").get_json() == {"status": "expired"}
    assert client.post("/api/v1/auth/sms/status", json={}).get_json() == {"status": "expired"}


# --- production behaviour -------------------------------------------------------------

def test_start_is_503_when_not_configured(client, sms, monkeypatch):
    monkeypatch.delenv("SMS_GATEWAY_SIGNING_KEY")
    r = start(client)
    assert r.status_code == 503
    assert r.get_json()["code"] == "sms_not_configured"


def test_start_fails_fast_when_the_gateway_is_offline(client, sms, monkeypatch):
    t = [1_000_000.0]
    health = sms_verify.GatewayHealth(clock=lambda: t[0])
    health.seen()
    t[0] += 301
    monkeypatch.setattr(app_module, "sms_gateway", health)
    r = start(client)
    assert r.status_code == 503
    assert r.get_json()["code"] == "sms_gateway_offline"


def test_ping_brings_the_gateway_online(client, sms, monkeypatch):
    t = [1_000_000.0]
    health = sms_verify.GatewayHealth(clock=lambda: t[0])
    t[0] += 301
    monkeypatch.setattr(app_module, "sms_gateway", health)
    assert client.get("/api/v1/auth/sms/health").status_code == 503
    assert inbound(client, {"event": "system:ping", "id": "p1", "payload": {"health": "pass"}}).status_code == 200
    r = client.get("/api/v1/auth/sms/health")
    assert r.status_code == 200
    assert r.get_json()["gateway"] == "online"


def test_batch_events_flag_the_gateway_misconfigured(client, sms):
    assert inbound(client, {"event": "sms:batch:received", "id": "b1", "payload": []}).status_code == 200
    assert client.get("/api/v1/auth/sms/health").get_json()["gateway"] == "misconfigured"
    assert start(client).get_json()["code"] == "sms_gateway_offline"


def test_store_cap_returns_503_busy(client, sms, monkeypatch):
    monkeypatch.setattr(app_module, "sms_sessions", sms_verify.SessionStore(max_sessions=1, min_poll_interval=0))
    assert start(client).status_code == 200
    r = start(client, phone="+919123456789")
    assert r.status_code == 503
    assert r.get_json()["code"] == "sms_busy"


def test_users_lookup_failure_keeps_the_session_for_a_retry(client, sms, monkeypatch):
    class FlakyFirestore(FakeFirestoreModule):
        def __init__(self, store):
            super().__init__(store)
            self.fail_next = True

        def client(self):
            if self.fail_next:
                self.fail_next = False
                raise RuntimeError("firestore down")
            return super().client()

    monkeypatch.setattr(app_module, "firestore", FlakyFirestore(sms.store))
    body = start(client).get_json()
    inbound(client, sms_event(PHONE, body["message"]))
    r = status(client, body["sessionId"])
    assert r.status_code == 503
    assert r.get_json()["code"] == "lookup_failed"
    assert status(client, body["sessionId"]).get_json()["status"] == "verified"


def test_audit_event_is_written_masked_and_without_the_code(client, sms):
    body = start(client, ip="203.0.113.7").get_json()
    inbound(client, sms_event(PHONE, body["message"]))
    status(client, body["sessionId"])
    events = [v for k, v in sms.store.items() if k.startswith("auth_events/")]
    assert len(events) == 1
    event = events[0]
    assert event["uid"] == UID
    assert event["phoneMasked"] == "+91******3210"
    assert event["method"] == "reverse_sms"
    assert event["isNewUser"] is True
    assert body["code"] not in json.dumps(event)


def test_logs_never_contain_the_full_phone_or_the_code(client, sms, capsys):
    body = start(client).get_json()
    inbound(client, sms_event(PHONE, body["message"]))
    status(client, body["sessionId"])
    out = capsys.readouterr().out
    assert "sms_verify outcome=verified phone=+91******3210" in out
    assert PHONE not in out
    assert body["code"] not in out
    assert body["sessionId"] not in out


def test_dev_bypass_verifies_immediately_without_a_gateway(client, sms, monkeypatch):
    monkeypatch.setenv("ALLOW_DEV_OTP_BYPASS", "true")
    monkeypatch.delenv("SMS_GATEWAY_NUMBER")
    monkeypatch.delenv("SMS_GATEWAY_SIGNING_KEY")
    body = start(client).get_json()
    assert status(client, body["sessionId"]).get_json()["status"] == "verified"


def test_health_does_not_touch_firestore(client, sms, monkeypatch):
    def explode(*_a, **_k):
        raise AssertionError("health must not touch Firestore")
    monkeypatch.setattr(app_module.firestore, "client", explode)
    assert client.get("/api/v1/auth/sms/health").status_code == 200
