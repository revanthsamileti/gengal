"""Reverse-OTP sign-in over WhatsApp: the user sends the code FROM their WhatsApp.

Meta's WhatsApp Cloud API delivers the message to our webhook with the sender's
number, signed with the app secret. Matching the code to a session is shared with
SMS (sms_verify.SessionStore); this module only reads Meta's payloads.

Pure logic only -- no Flask, no network -- so every rule is testable on its own.
Design: docs/superpowers/specs/2026-09-22-reverse-otp-whatsapp-design.md
"""
import hashlib
import hmac
import threading
import time

import sms_verify

GRAPH_API_VERSION = "v26.0"
PENDING_SHARE_TTL_SECONDS = sms_verify.SESSION_TTL_SECONDS
MAX_PENDING_SHARES = 10_000

REPLIES = {
    "verified": "✅ Verified! Go back to GenGal, you're being signed in.",
    "sender_mismatch": ("This code was requested for a different mobile number. In GenGal, "
                        "enter the number this WhatsApp uses, or send the code by SMS from that SIM."),
    "no_session": "That code has expired. Open GenGal and tap Try again to get a new one.",
    "stale": "That code has expired. Open GenGal and tap Try again to get a new one.",
    "no_code": ("Hi! This number only verifies GenGal sign-ins. Open the GenGal app, tap "
                "Send on WhatsApp, and send the message it fills in."),
    "unsupported_number": "GenGal sign-in works with Indian (+91) mobile numbers only.",
    "share_number": ("Your WhatsApp hides your phone number. Tap the button below to share it "
                     "with GenGal and finish signing in."),
}


def verify_meta_signature(raw_body, header, app_secret):
    """Meta signs every webhook: X-Hub-Signature-256: sha256=hex(HMAC-SHA256(app secret, body))."""
    if raw_body is None or not app_secret or not isinstance(header, str):
        return False
    prefix, _, signature = header.partition("=")
    if prefix != "sha256" or not signature:
        return False
    body = raw_body if isinstance(raw_body, bytes) else str(raw_body).encode("utf-8")
    expected = hmac.new(app_secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature.strip().lower())


def _as_list(value):
    return value if isinstance(value, list) else []


def _as_dict(value):
    return value if isinstance(value, dict) else {}


def _epoch_seconds(value):
    try:
        seconds = float(value)
    except (TypeError, ValueError):
        return None
    return seconds if seconds > 0 else None


def _shared_phone(message):
    """The number from a tap on our "Share phone number" button, else None.

    Only origin "contact_request" is the user's own number. A contact card they
    forward ("other") can hold anybody's number and proves nothing.
    """
    for contact in _as_list(message.get("contacts")):
        contact = _as_dict(contact)
        if contact.get("origin") != "contact_request":
            continue
        for phone in _as_list(contact.get("phones")):
            number = sms_verify.normalize_in_mobile(_as_dict(phone).get("phone"))
            if number:
                return number
    return None


def parse_webhook(payload, phone_number_id):
    """Every inbound message addressed to our business number, one dict each.

    `phone` is the sender's +91 mobile when Meta disclosed it (None for a
    foreign number or one hidden behind a WhatsApp username). `number_hidden`
    tells those two apart. `reply_to` addresses a reply to whichever identity
    Meta gave us.
    """
    found = []
    for entry in _as_list(_as_dict(payload).get("entry")):
        for change in _as_list(_as_dict(entry).get("changes")):
            change = _as_dict(change)
            if change.get("field") != "messages":
                continue
            value = _as_dict(change.get("value"))
            if str(_as_dict(value.get("metadata")).get("phone_number_id") or "") != str(phone_number_id):
                continue
            contacts = _as_list(value.get("contacts"))
            fallback_user_id = _as_dict(contacts[0]).get("user_id") if contacts else None
            for message in _as_list(value.get("messages")):
                if isinstance(message, dict):
                    found.append(_read_message(message, fallback_user_id))
    return found


def _read_message(message, fallback_user_id):
    sender = message.get("from") if isinstance(message.get("from"), str) else ""
    user_id = message.get("from_user_id") or fallback_user_id
    kind = message.get("type")
    if kind == "text":
        phone = sms_verify.normalize_in_mobile(sender)
    elif kind == "contacts" and _shared_phone(message):
        kind, phone = "contact_share", _shared_phone(message)
    else:
        kind, phone = "other", sms_verify.normalize_in_mobile(sender)
    if sender:
        reply_to = {"to": sender}
    elif user_id:
        reply_to = {"recipient": user_id}
    else:
        reply_to = None
    return {
        "id": message.get("id") if isinstance(message.get("id"), str) else None,
        "kind": kind,
        "phone": phone,
        "user_id": user_id if isinstance(user_id, str) else None,
        "number_hidden": not sender,
        "reply_to": reply_to,
        "text": _as_dict(message.get("text")).get("body") if kind == "text" else None,
        "sent_at": _epoch_seconds(message.get("timestamp")),
    }


def text_reply(reply_to, body):
    """Graph API body for a free-form reply inside the 24 h service window."""
    return {"messaging_product": "whatsapp", "recipient_type": "individual", **reply_to,
            "type": "text", "text": {"body": body, "preview_url": False}}


def share_number_request(reply_to, body):
    """Graph API body for Meta's "Share phone number" button (request_contact_info)."""
    return {"messaging_product": "whatsapp", "recipient_type": "individual", **reply_to,
            "type": "interactive",
            "interactive": {"type": "request_contact_info", "body": {"text": body},
                            "action": {"name": "request_contact_info"}}}


class PendingShares:
    """Codes waiting for a user to share the number their username hides.

    Keyed by business-scoped user id. One shot: a share is consumed on first
    use, so a second tap cannot replay it against another session.
    """

    def __init__(self, clock=time.time, ttl_seconds=PENDING_SHARE_TTL_SECONDS,
                 max_entries=MAX_PENDING_SHARES):
        self._clock = clock
        self._ttl = ttl_seconds
        self._max = max_entries
        self._lock = threading.Lock()
        self._held = {}  # user id -> {code, received_at, expires_at}; insertion-ordered

    def hold(self, user_id, code, received_at):
        with self._lock:
            now = self._clock()
            self._purge(now)
            self._held.pop(user_id, None)
            while len(self._held) >= self._max:
                self._held.pop(next(iter(self._held)))
            self._held[user_id] = {"code": code, "received_at": received_at, "expires_at": now + self._ttl}

    def take(self, user_id):
        with self._lock:
            self._purge(self._clock())
            held = self._held.pop(user_id, None) if user_id else None
            if not held:
                return None
            return {"code": held["code"], "received_at": held["received_at"]}

    def _purge(self, now):
        for user_id in [u for u, v in self._held.items() if v["expires_at"] <= now]:
            del self._held[user_id]
