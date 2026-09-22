"""Route tests for reverse-OTP sign-in over WhatsApp.

Webhooks are signed exactly as Meta signs them:
X-Hub-Signature-256: sha256=hex(HMAC-SHA256(app secret, raw body)).
"""
import hashlib
import hmac
import itertools
import json
import time
import uuid
from types import SimpleNamespace

import pytest

import app as app_module
import sms_verify
import whatsapp_verify
from fake_firestore import FakeFirestoreModule

SECRET = "wa-app-secret"
VERIFY_TOKEN = "wa-verify-token"
PNID = "1234567890"
WA_NUMBER = "+919000000001"
PHONE = "+919876543210"
WA_FROM = "919876543210"
UID = "fast2sms:" + PHONE
BSUID = "IN.1234567890123"


@pytest.fixture
def wa(monkeypatch):
    monkeypatch.setenv("SMS_GATEWAY_NUMBER", "+919000000002")
    monkeypatch.setenv("SMS_GATEWAY_SIGNING_KEY", "sms-key")
    monkeypatch.setenv("WHATSAPP_NUMBER", WA_NUMBER)
    monkeypatch.setenv("WHATSAPP_PHONE_NUMBER_ID", PNID)
    monkeypatch.setenv("WHATSAPP_APP_SECRET", SECRET)
    monkeypatch.setenv("WHATSAPP_VERIFY_TOKEN", VERIFY_TOKEN)
    monkeypatch.setenv("WHATSAPP_ACCESS_TOKEN", "wa-access-token")
    monkeypatch.delenv("ALLOW_DEV_OTP_BYPASS", raising=False)
    monkeypatch.setattr(app_module, "sms_sessions", sms_verify.SessionStore(
        min_poll_interval=0, code_source=itertools.count(482913).__next__))
    monkeypatch.setattr(app_module, "whatsapp_shares", whatsapp_verify.PendingShares())
    health = sms_verify.GatewayHealth()
    health.seen()
    monkeypatch.setattr(app_module, "sms_gateway", health)
    monkeypatch.setattr(app_module, "_rate_buckets", {})
    monkeypatch.setattr(app_module.auth, "create_custom_token", lambda uid: ("token-for-" + uid).encode())
    store = {}
    monkeypatch.setattr(app_module, "firestore", FakeFirestoreModule(store))
    sent = []
    monkeypatch.setattr(app_module, "send_whatsapp_message", sent.append)
    return SimpleNamespace(store=store, sent=sent, health=health)


def start(client, phone=PHONE):
    return client.post("/api/v1/auth/sms/start", json={"phone": phone},
                       environ_base={"REMOTE_ADDR": "10.0.0.1"})


def status(client, session_id):
    return client.post("/api/v1/auth/sms/status", json={"sessionId": session_id}).get_json()


def message(body, sender=WA_FROM, user_id=BSUID, mid=None, ts=None):
    m = {"id": mid or "wamid." + uuid.uuid4().hex, "timestamp": str(int(ts or time.time())),
         "type": "text", "text": {"body": body}, "from_user_id": user_id}
    if sender is not None:
        m["from"] = sender
    return m


def contact_share(phone=PHONE, origin="contact_request", user_id=BSUID):
    return {"id": "wamid." + uuid.uuid4().hex, "timestamp": str(int(time.time())), "type": "contacts",
            "from_user_id": user_id,
            "contacts": [{"origin": origin, "phones": [{"phone": phone, "type": "CELL"}]}]}


def delivery(*messages, pnid=PNID):
    return {"object": "whatsapp_business_account", "entry": [{"id": "waba", "changes": [{
        "field": "messages",
        "value": {"messaging_product": "whatsapp",
                  "metadata": {"display_phone_number": WA_NUMBER[1:], "phone_number_id": pnid},
                  "messages": list(messages)}}]}]}


def webhook(client, payload, secret=SECRET):
    body = json.dumps(payload).encode()
    sig = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return client.post("/api/v1/auth/whatsapp/webhook", data=body,
                       headers={"Content-Type": "application/json", "X-Hub-Signature-256": sig})


def replies(wa):
    return [(m.get("to") or m.get("recipient"), m.get("type"),
             (m.get("text") or {}).get("body") or m["interactive"]["type"]) for m in wa.sent]


# --- Meta's subscription handshake ---------------------------------------------------

def test_handshake_echoes_the_challenge(client, wa):
    r = client.get("/api/v1/auth/whatsapp/webhook", query_string={
        "hub.mode": "subscribe", "hub.verify_token": VERIFY_TOKEN, "hub.challenge": "1158201444"})
    assert r.status_code == 200
    assert r.get_data(as_text=True) == "1158201444"
    assert r.content_type.startswith("text/plain")


@pytest.mark.parametrize("mode,token", [("subscribe", "wrong"), ("unsubscribe", VERIFY_TOKEN), (None, None)])
def test_handshake_refuses_a_wrong_token_or_mode(client, wa, mode, token):
    query = {"hub.challenge": "1"}
    if mode:
        query["hub.mode"] = mode
    if token:
        query["hub.verify_token"] = token
    assert client.get("/api/v1/auth/whatsapp/webhook", query_string=query).status_code == 403


def test_handshake_refuses_when_whatsapp_is_not_configured(client, wa, monkeypatch):
    monkeypatch.delenv("WHATSAPP_VERIFY_TOKEN")
    r = client.get("/api/v1/auth/whatsapp/webhook", query_string={
        "hub.mode": "subscribe", "hub.verify_token": "", "hub.challenge": "1"})
    assert r.status_code == 403


# --- start ---------------------------------------------------------------------------

def test_start_offers_whatsapp_first_then_sms(client, wa):
    body = start(client).get_json()
    assert body["channels"] == ["whatsapp", "sms"]
    assert body["whatsappNumber"] == WA_NUMBER
    assert body["gatewayNumber"] == "+919000000002"


def test_whatsapp_keeps_sign_in_up_while_the_sms_gateway_is_offline(client, wa, monkeypatch):
    offline = sms_verify.GatewayHealth(clock=lambda: 0.0)
    offline._started_at = -10_000  # up for hours, never heard from the phone
    monkeypatch.setattr(app_module, "sms_gateway", offline)
    r = start(client)
    assert r.status_code == 200
    body = r.get_json()
    assert body["channels"] == ["whatsapp"]
    assert body["gatewayNumber"] == ""  # never tell a user to text a dead phone


@pytest.mark.parametrize("missing", ["WHATSAPP_NUMBER", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_APP_SECRET",
                                     "WHATSAPP_VERIFY_TOKEN", "WHATSAPP_ACCESS_TOKEN"])
def test_whatsapp_is_offered_only_when_fully_configured(client, wa, monkeypatch, missing):
    monkeypatch.delenv(missing)
    body = start(client).get_json()
    assert body["channels"] == ["sms"]
    assert body["whatsappNumber"] == ""


def test_start_is_unavailable_when_no_channel_is_configured(client, wa, monkeypatch):
    for name in ("SMS_GATEWAY_NUMBER", "WHATSAPP_NUMBER"):
        monkeypatch.delenv(name)
    r = start(client)
    assert r.status_code == 503
    assert r.get_json()["code"] == "sms_not_configured"


# --- the happy path ------------------------------------------------------------------

def test_full_flow_signs_in_and_confirms_in_whatsapp(client, wa):
    body = start(client).get_json()
    assert status(client, body["sessionId"])["status"] == "pending"
    assert webhook(client, delivery(message(body["message"]))).status_code == 200

    assert status(client, body["sessionId"]) == {
        "status": "verified", "token": "token-for-" + UID, "isNewUser": True}
    [event] = [v for k, v in wa.store.items() if k.startswith("auth_events/")]
    assert event["method"] == "reverse_whatsapp"
    assert event["phoneMasked"] == "+91******3210"
    assert replies(wa) == [(WA_FROM, "text", whatsapp_verify.REPLIES["verified"])]


def test_sms_sign_in_is_still_audited_as_sms(client, wa):
    body = start(client).get_json()
    app_module.sms_sessions.mark_verified(body["code"], PHONE)
    status(client, body["sessionId"])
    [event] = [v for k, v in wa.store.items() if k.startswith("auth_events/")]
    assert event["method"] == "reverse_sms"


def test_the_code_alone_without_the_prefix_works(client, wa):
    body = start(client).get_json()
    webhook(client, delivery(message(body["code"])))
    assert status(client, body["sessionId"])["status"] == "verified"


# --- security ------------------------------------------------------------------------

def test_unsigned_webhook_is_rejected(client, wa):
    body = start(client).get_json()
    r = client.post("/api/v1/auth/whatsapp/webhook", json=delivery(message(body["message"])))
    assert r.status_code == 401
    assert status(client, body["sessionId"])["status"] == "pending"


def test_webhook_signed_with_another_secret_is_rejected(client, wa):
    body = start(client).get_json()
    assert webhook(client, delivery(message(body["message"])), secret="other").status_code == 401


def test_webhook_is_rejected_when_whatsapp_is_not_configured(client, wa, monkeypatch):
    monkeypatch.delenv("WHATSAPP_APP_SECRET")
    assert webhook(client, delivery(message("GENGAL 482913")), secret="").status_code == 401


def test_message_from_another_number_does_not_verify_and_says_why(client, wa):
    body = start(client).get_json()
    webhook(client, delivery(message(body["message"], sender="919123456789")))
    pending = status(client, body["sessionId"])
    assert (pending["status"], pending["hint"]) == ("pending", "sender_mismatch")
    assert replies(wa) == [("919123456789", "text", whatsapp_verify.REPLIES["sender_mismatch"])]


def test_redelivered_message_id_is_ignored(client, wa):
    body = start(client).get_json()
    webhook(client, delivery(message("GENGAL 000000", mid="wamid.same")))
    webhook(client, delivery(message(body["message"], mid="wamid.same")))
    assert status(client, body["sessionId"])["status"] == "pending"


def test_message_older_than_the_session_does_not_verify_it(client, wa):
    body = start(client).get_json()
    webhook(client, delivery(message(body["message"], ts=time.time() - 3600)))
    assert status(client, body["sessionId"])["status"] == "pending"
    assert replies(wa)[0][2] == whatsapp_verify.REPLIES["stale"]


def test_messages_to_another_business_number_are_ignored(client, wa):
    body = start(client).get_json()
    webhook(client, delivery(message(body["message"]), pnid="999"))
    assert status(client, body["sessionId"])["status"] == "pending"
    assert wa.sent == []


def test_foreign_number_is_told_only_indian_numbers_work(client, wa):
    body = start(client).get_json()
    webhook(client, delivery(message(body["message"], sender="15551234567")))
    assert status(client, body["sessionId"])["status"] == "pending"
    assert replies(wa) == [("15551234567", "text", whatsapp_verify.REPLIES["unsupported_number"])]


def test_a_message_without_a_code_gets_directions(client, wa):
    webhook(client, delivery(message("hi")))
    assert replies(wa) == [(WA_FROM, "text", whatsapp_verify.REPLIES["no_code"])]


def test_replies_to_one_sender_are_rate_limited(client, wa):
    for _ in range(8):
        webhook(client, delivery(message("hi")))
    assert len(wa.sent) == 5


def test_nothing_secret_reaches_the_log(client, wa, capsys):
    body = start(client).get_json()
    webhook(client, delivery(message(body["message"], sender=None)))
    webhook(client, delivery(contact_share()))
    status(client, body["sessionId"])
    out = capsys.readouterr().out
    assert "wa_verify outcome=verified" in out
    for secret in (body["code"], BSUID, PHONE, WA_FROM, SECRET, "wa-access-token"):
        assert secret not in out


# --- numbers hidden behind a WhatsApp username ----------------------------------------

def test_hidden_number_is_asked_for_then_verifies_on_share(client, wa):
    body = start(client).get_json()
    webhook(client, delivery(message(body["message"], sender=None)))

    [ask] = wa.sent
    assert ask["recipient"] == BSUID and "to" not in ask
    assert ask["interactive"]["type"] == "request_contact_info"
    pending = status(client, body["sessionId"])
    assert (pending["status"], pending["hint"]) == ("pending", "share_number")

    webhook(client, delivery(contact_share()))
    assert status(client, body["sessionId"])["status"] == "verified"
    assert replies(wa)[-1] == (BSUID, "text", whatsapp_verify.REPLIES["verified"])


def test_a_forwarded_contact_card_does_not_verify(client, wa):
    body = start(client).get_json()
    webhook(client, delivery(message(body["message"], sender=None)))
    webhook(client, delivery(contact_share(origin="other")))
    assert status(client, body["sessionId"])["status"] == "pending"


def test_sharing_a_different_number_is_a_mismatch(client, wa):
    body = start(client).get_json()
    webhook(client, delivery(message(body["message"], sender=None)))
    webhook(client, delivery(contact_share(phone="+919123456789")))
    assert status(client, body["sessionId"])["hint"] == "sender_mismatch"


def test_a_share_nobody_asked_for_is_ignored(client, wa):
    body = start(client).get_json()
    webhook(client, delivery(contact_share()))
    assert status(client, body["sessionId"])["status"] == "pending"
    assert wa.sent == []


def test_a_share_is_used_once(client, wa):
    body = start(client).get_json()
    webhook(client, delivery(message(body["message"], sender=None)))
    webhook(client, delivery(contact_share()))
    assert status(client, body["sessionId"])["status"] == "verified"
    second = start(client).get_json()
    webhook(client, delivery(contact_share()))
    assert status(client, second["sessionId"])["status"] == "pending"


def test_hidden_number_with_an_expired_code_is_told_so(client, wa):
    webhook(client, delivery(message("GENGAL 111111", sender=None)))
    assert replies(wa) == [(BSUID, "text", whatsapp_verify.REPLIES["no_session"])]


# --- health and the Graph API call -------------------------------------------------

def test_health_reports_whether_whatsapp_is_configured(client, wa, monkeypatch):
    assert client.get("/api/v1/auth/sms/health").get_json()["whatsapp"] == "configured"
    monkeypatch.delenv("WHATSAPP_ACCESS_TOKEN")
    assert client.get("/api/v1/auth/sms/health").get_json()["whatsapp"] == "off"


def test_graph_api_call_is_addressed_and_authorised(monkeypatch):
    monkeypatch.setenv("WHATSAPP_PHONE_NUMBER_ID", PNID)
    monkeypatch.setenv("WHATSAPP_ACCESS_TOKEN", "wa-access-token")
    calls = []

    def fake_post(url, json=None, headers=None, timeout=None):
        calls.append((url, json, headers, timeout))
        return SimpleNamespace(ok=True, status_code=200, text="")

    monkeypatch.setattr(app_module.requests, "post", fake_post)
    app_module.post_whatsapp_message({"to": WA_FROM, "type": "text"})
    [(url, payload, headers, timeout)] = calls
    assert url == f"https://graph.facebook.com/{whatsapp_verify.GRAPH_API_VERSION}/{PNID}/messages"
    assert headers["Authorization"] == "Bearer wa-access-token"
    assert payload == {"to": WA_FROM, "type": "text"}
    assert timeout <= 10


def test_graph_api_failure_is_logged_not_raised(monkeypatch, capsys):
    monkeypatch.setenv("WHATSAPP_PHONE_NUMBER_ID", PNID)
    monkeypatch.setenv("WHATSAPP_ACCESS_TOKEN", "wa-access-token")

    def boom(*args, **kwargs):
        raise app_module.requests.ConnectionError("down")

    monkeypatch.setattr(app_module.requests, "post", boom)
    app_module.post_whatsapp_message({"to": WA_FROM})
    assert "wa_verify outcome=reply_failed" in capsys.readouterr().out
