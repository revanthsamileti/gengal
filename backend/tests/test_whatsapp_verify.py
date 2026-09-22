"""Pure-logic tests for WhatsApp reverse-OTP (design: 2026-09-22-reverse-otp-whatsapp)."""
import hashlib
import hmac
import json

import pytest

import whatsapp_verify as wv

SECRET = "app-secret"
PNID = "1234567890"
PHONE = "+919876543210"


def sign(body, secret=SECRET):
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


# --- signature ---------------------------------------------------------------------

def test_signature_accepts_valid():
    body = b'{"object":"whatsapp_business_account"}'
    assert wv.verify_meta_signature(body, sign(body), SECRET)


def test_signature_accepts_uppercase_hex():
    body = b"{}"
    header = sign(body)
    assert wv.verify_meta_signature(body, "sha256=" + header[7:].upper(), SECRET)


def test_signature_rejects_tampered_body():
    assert not wv.verify_meta_signature(b'{"a":2}', sign(b'{"a":1}'), SECRET)


def test_signature_rejects_wrong_secret():
    body = b"{}"
    assert not wv.verify_meta_signature(body, sign(body, "other"), SECRET)


@pytest.mark.parametrize("header", [None, "", "abc", "sha1=00", "sha256="])
def test_signature_rejects_missing_or_malformed_header(header):
    assert not wv.verify_meta_signature(b"{}", header, SECRET)


def test_signature_rejects_when_no_secret_configured():
    body = b"{}"
    assert not wv.verify_meta_signature(body, sign(body, ""), "")


# --- webhook parsing ---------------------------------------------------------------

def webhook(messages, pnid=PNID, contacts=None, statuses=None, field="messages"):
    value = {
        "messaging_product": "whatsapp",
        "metadata": {"display_phone_number": "919000000001", "phone_number_id": pnid},
    }
    if contacts is not None:
        value["contacts"] = contacts
    if messages is not None:
        value["messages"] = messages
    if statuses is not None:
        value["statuses"] = statuses
    return {"object": "whatsapp_business_account",
            "entry": [{"id": "waba", "changes": [{"value": value, "field": field}]}]}


def text(body="GENGAL 482913", sender="919876543210", user_id="IN.111", mid="wamid.1", ts="1790000000"):
    m = {"id": mid, "timestamp": ts, "type": "text", "text": {"body": body}, "from_user_id": user_id}
    if sender is not None:
        m["from"] = sender
    return m


def test_parses_a_text_message():
    [m] = wv.parse_webhook(webhook([text()]), PNID)
    assert m == {
        "id": "wamid.1", "kind": "text", "phone": PHONE, "user_id": "IN.111",
        "number_hidden": False, "reply_to": {"to": "919876543210"},
        "text": "GENGAL 482913", "sent_at": 1790000000.0,
    }


def test_number_hidden_behind_a_username_is_flagged_and_replied_to_by_bsuid():
    [m] = wv.parse_webhook(webhook([text(sender=None)]), PNID)
    assert m["phone"] is None
    assert m["number_hidden"] is True
    assert m["reply_to"] == {"recipient": "IN.111"}


def test_non_indian_sender_has_no_phone_but_is_not_hidden():
    [m] = wv.parse_webhook(webhook([text(sender="15551234567")]), PNID)
    assert m["phone"] is None
    assert m["number_hidden"] is False
    assert m["reply_to"] == {"to": "15551234567"}


def contact_share(origin="contact_request", phone="+91 98765 43210", user_id="IN.111"):
    return {"id": "wamid.2", "timestamp": "1790000100", "type": "contacts", "from_user_id": user_id,
            "contacts": [{"origin": origin, "phones": [{"phone": phone, "type": "CELL"}]}]}


def test_contact_request_share_yields_the_shared_phone():
    [m] = wv.parse_webhook(webhook([contact_share()]), PNID)
    assert m["kind"] == "contact_share"
    assert m["phone"] == PHONE
    assert m["user_id"] == "IN.111"


def test_a_manually_shared_contact_card_is_not_trusted():
    # origin "other" is any contact card the user forwarded: anybody's number.
    [m] = wv.parse_webhook(webhook([contact_share(origin="other")]), PNID)
    assert m["kind"] == "other"
    assert m["phone"] is None


def test_other_message_types_are_kind_other():
    [m] = wv.parse_webhook(webhook([{"id": "wamid.3", "type": "image", "from": "919876543210"}]), PNID)
    assert m["kind"] == "other"


def test_status_receipts_are_ignored():
    assert wv.parse_webhook(webhook(None, statuses=[{"id": "wamid.9", "status": "read"}]), PNID) == []


def test_messages_for_another_business_number_are_ignored():
    assert wv.parse_webhook(webhook([text()], pnid="999"), PNID) == []


def test_non_message_fields_are_ignored():
    assert wv.parse_webhook(webhook([text()], field="account_update"), PNID) == []


@pytest.mark.parametrize("payload", [None, [], "x", {}, {"entry": "x"}, {"entry": [{"changes": [None]}]},
                                     webhook([None, "x", {"type": "text"}])])
def test_malformed_payloads_yield_nothing_usable(payload):
    for m in wv.parse_webhook(payload, PNID):
        assert m["phone"] is None and m["id"] is None


def test_several_messages_in_one_delivery_are_all_returned():
    ms = wv.parse_webhook(webhook([text(mid="a"), text(mid="b")]), PNID)
    assert [m["id"] for m in ms] == ["a", "b"]


def test_payload_round_trips_through_json():
    # What Meta sends is bytes; the route json.loads it before parsing.
    assert wv.parse_webhook(json.loads(json.dumps(webhook([text()]))), PNID)[0]["phone"] == PHONE


# --- PendingShares -----------------------------------------------------------------

class Clock:
    def __init__(self, t=1_000_000.0):
        self.t = t

    def __call__(self):
        return self.t


def test_pending_share_is_taken_exactly_once():
    shares = wv.PendingShares(clock=Clock())
    shares.hold("IN.111", "482913", 999_990.0)
    assert shares.take("IN.111") == {"code": "482913", "received_at": 999_990.0}
    assert shares.take("IN.111") is None


def test_pending_share_expires():
    clock = Clock()
    shares = wv.PendingShares(clock=clock)
    shares.hold("IN.111", "482913", clock.t)
    clock.t += wv.PENDING_SHARE_TTL_SECONDS + 1
    assert shares.take("IN.111") is None


def test_pending_shares_are_capped_and_drop_the_oldest():
    shares = wv.PendingShares(clock=Clock(), max_entries=2)
    shares.hold("a", "111111", 1.0)
    shares.hold("b", "222222", 1.0)
    shares.hold("c", "333333", 1.0)
    assert shares.take("a") is None
    assert shares.take("c")["code"] == "333333"


def test_reply_texts_cover_every_outcome():
    for outcome in ("verified", "sender_mismatch", "no_session", "stale", "no_code",
                    "unsupported_number", "share_number"):
        assert wv.REPLIES[outcome].strip()
