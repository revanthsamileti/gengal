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


# --- SMS to URL Forwarder (tech.bogomolov.incomingsmsgateway) -------------------

def forwarder_body(sender, text, sim="sim1", received_ms=None):
    received_ms = int(time.time() * 1000) if received_ms is None else received_ms
    # The app's default template, byte for byte (it sends newlines and indentation).
    return ('{\n  "from":"%s",\n  "text":"%s",\n  "sentStamp":%d,\n  "receivedStamp":%d,\n  "sim":"%s"\n}'
            % (sender, text, received_ms - 1000, received_ms, sim)).encode()


def forwarder(client, body, key=KEY, signature=None):
    sig = signature if signature is not None else hmac.new(key.encode(), body, hashlib.sha256).hexdigest()
    return client.post("/api/v1/auth/sms/forwarder", data=body, headers={
        "Content-Type": "application/json; charset=utf-8", "X-Signature": sig,
    })


@pytest.fixture
def sim1(monkeypatch):
    monkeypatch.setenv("SMS_GATEWAY_SIM", "sim1")


def test_forwarder_sms_verifies(client, sms, sim1):
    body = start(client).get_json()
    assert forwarder(client, forwarder_body(PHONE, body["message"])).status_code == 200
    assert status(client, body["sessionId"]).get_json()["status"] == "verified"


def test_forwarder_accepts_sender_without_country_code(client, sms, sim1):
    body = start(client).get_json()
    forwarder(client, forwarder_body("9876543210", body["message"]))
    assert status(client, body["sessionId"]).get_json()["status"] == "verified"


def test_forwarder_rejects_bad_signature(client, sms, sim1):
    body = start(client).get_json()
    assert forwarder(client, forwarder_body(PHONE, body["message"]), key="wrong").status_code == 401
    assert forwarder(client, forwarder_body(PHONE, body["message"]), signature="").status_code == 401
    assert status(client, body["sessionId"]).get_json()["status"] == "pending"


def test_forwarder_ignores_sms_on_the_other_sim(client, sms, sim1):
    body = start(client).get_json()
    assert forwarder(client, forwarder_body(PHONE, body["message"], sim="sim2")).status_code == 200
    assert status(client, body["sessionId"]).get_json()["status"] == "pending"


def test_forwarder_accepts_any_sim_when_no_sim_is_configured(client, sms, monkeypatch):
    monkeypatch.delenv("SMS_GATEWAY_SIM", raising=False)
    body = start(client).get_json()
    forwarder(client, forwarder_body(PHONE, body["message"], sim="sim2"))
    assert status(client, body["sessionId"]).get_json()["status"] == "verified"


def test_forwarder_retry_of_the_same_delivery_is_deduplicated(client, sms, sim1, capsys):
    body = start(client).get_json()
    payload = forwarder_body(PHONE, body["message"])
    forwarder(client, payload)
    forwarder(client, payload)
    assert "sms_verify outcome=duplicate" in capsys.readouterr().out


def test_forwarder_rejects_an_sms_older_than_its_session(client, sms, sim1):
    body = start(client).get_json()
    an_hour_ago = int((time.time() - 3600) * 1000)
    forwarder(client, forwarder_body(PHONE, body["message"], received_ms=an_hour_ago))
    assert status(client, body["sessionId"]).get_json()["status"] == "pending"


def test_forwarder_tells_the_waiting_app_the_sms_hit_the_other_sim(client, sms, sim1):
    """A dropped SMS must say so. It used to be logged and silently discarded,
    so someone who texted the wrong SIM watched the spinner for ten minutes."""
    body = start(client).get_json()
    forwarder(client, forwarder_body(PHONE, body["message"], sim="sim2"))
    pending = status(client, body["sessionId"]).get_json()
    assert pending["status"] == "pending"
    assert pending["hint"] == "wrong_sim"


def test_forwarder_tells_the_waiting_app_when_the_code_was_unreadable(client, sms, sim1):
    """An edited or mangled message reaches us with no code to match on, so the
    hint has to be attached by sender instead."""
    body = start(client).get_json()
    forwarder(client, forwarder_body(PHONE, "hey"))
    assert status(client, body["sessionId"]).get_json()["hint"] == "no_code"


def test_a_stranger_texting_nonsense_does_not_disturb_a_live_session(client, sms, sim1):
    """The no-code hint is keyed by sender, so it must not land on somebody
    else's session."""
    body = start(client).get_json()
    forwarder(client, forwarder_body("+919123456789", "hey"))
    assert "hint" not in status(client, body["sessionId"]).get_json()


def test_status_tells_the_waiting_app_which_channels_are_live(client, sms, sim1, monkeypatch):
    """The gateway can die while somebody is already waiting; the screen can
    only offer WhatsApp instead if each poll says what is still up."""
    body = start(client).get_json()
    assert "sms" in status(client, body["sessionId"]).get_json()["channels"]

    clock = [time.time()]
    health = sms_verify.GatewayHealth(clock=lambda: clock[0])
    health.seen()
    clock[0] += 301
    monkeypatch.setattr(app_module, "sms_gateway", health)
    assert "sms" not in status(client, body["sessionId"]).get_json()["channels"]


def test_status_separates_sms_being_down_from_sms_being_absent(client, sms, sim1, monkeypatch):
    """"Down for a few minutes" and "not offered here" need different words for
    somebody who has no WhatsApp, so the flag is reported apart from channels."""
    body = start(client).get_json()
    assert body["smsOffline"] is False

    clock = [time.time()]
    health = sms_verify.GatewayHealth(clock=lambda: clock[0])
    health.seen()
    clock[0] += 301
    monkeypatch.setattr(app_module, "sms_gateway", health)
    assert status(client, body["sessionId"]).get_json()["smsOffline"] is True

    monkeypatch.delenv("SMS_GATEWAY_NUMBER")
    assert status(client, body["sessionId"]).get_json()["smsOffline"] is False


def test_status_reports_a_message_arriving_apart_from_it_verifying(client, sms, sim1):
    """"Received" and "verified" are different facts and the screen shows them
    as different steps, so a message that arrived and was refused must not look
    the same as one that never came."""
    body = start(client).get_json()
    assert status(client, body["sessionId"]).get_json()["received"] is False
    forwarder(client, forwarder_body(PHONE, body["message"], sim="sim2"))
    pending = status(client, body["sessionId"]).get_json()
    assert pending["status"] == "pending"
    assert pending["received"] is True


def test_a_message_from_the_wrong_number_still_counts_as_received(client, sms, sim1):
    body = start(client).get_json()
    forwarder(client, forwarder_body("+919123456789", body["message"]))
    pending = status(client, body["sessionId"]).get_json()
    assert pending["received"] is True
    assert pending["hint"] == "sender_mismatch"


def test_forwarder_from_the_wrong_sender_does_not_verify(client, sms, sim1):
    body = start(client).get_json()
    forwarder(client, forwarder_body("+919123456789", body["message"]))
    assert status(client, body["sessionId"]).get_json()["status"] == "pending"


def test_forwarder_signed_traffic_marks_the_gateway_online(client, sms, sim1, monkeypatch):
    t = [1_000_000.0]
    health = sms_verify.GatewayHealth(clock=lambda: t[0])
    t[0] += 301
    monkeypatch.setattr(app_module, "sms_gateway", health)
    forwarder(client, forwarder_body(PHONE, "hello"))
    assert client.get("/api/v1/auth/sms/health").get_json()["gateway"] == "online"


# --- heartbeat with a URL token (the forwarder's heartbeat is unsigned) --------------

def test_heartbeat_with_the_right_token_marks_the_gateway_online(client, sms, monkeypatch):
    monkeypatch.setenv("SMS_GATEWAY_HEARTBEAT_TOKEN", "hb-token-123")
    t = [1_000_000.0]
    health = sms_verify.GatewayHealth(clock=lambda: t[0])
    t[0] += 301
    monkeypatch.setattr(app_module, "sms_gateway", health)
    assert client.post("/api/v1/auth/sms/heartbeat/hb-token-123", data=b"").status_code == 200
    assert client.get("/api/v1/auth/sms/health").get_json()["gateway"] == "online"


@pytest.mark.parametrize("configured", ["hb-token-123", ""])
def test_heartbeat_with_a_wrong_token_is_404_and_changes_nothing(client, sms, monkeypatch, configured):
    monkeypatch.setenv("SMS_GATEWAY_HEARTBEAT_TOKEN", configured)
    t = [1_000_000.0]
    health = sms_verify.GatewayHealth(clock=lambda: t[0])
    t[0] += 301
    monkeypatch.setattr(app_module, "sms_gateway", health)
    assert client.post("/api/v1/auth/sms/heartbeat/guess", data=b"").status_code == 404
    assert client.get("/api/v1/auth/sms/health").get_json()["gateway"] == "offline"


def test_health_does_not_touch_firestore(client, sms, monkeypatch):
    def explode(*_a, **_k):
        raise AssertionError("health must not touch Firestore")
    monkeypatch.setattr(app_module.firestore, "client", explode)
    assert client.get("/api/v1/auth/sms/health").status_code == 200
