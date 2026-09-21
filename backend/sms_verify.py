"""Reverse-OTP sign-in: a user proves a phone number by texting a code from it.

Pure logic only -- no Flask, no Firestore -- so each rule that decides who can
sign in as whom is testable on its own. The routes in app.py are thin wrappers.
Design: docs/superpowers/specs/2026-09-21-reverse-otp-sms-design.md
"""
import hashlib
import hmac
import re
import secrets
import threading
import time
from datetime import datetime

SESSION_TTL_SECONDS = 600
MAX_LIVE_SESSIONS = 10_000
SIGNATURE_WINDOW_SECONDS = 300
DELIVERY_ID_TTL_SECONDS = 86_400
RECEIVED_AT_SKEW_SECONDS = 60
GATEWAY_STALE_SECONDS = 300
MIN_POLL_INTERVAL_SECONDS = 0.9
CODE_PREFIX = "GENGAL"

_IN_MOBILE = re.compile(r"^[6-9]\d{9}$")
_SIX_DIGIT_RUN = re.compile(r"(?<!\d)\d{6}(?!\d)")


def normalize_in_mobile(raw):
    """Any common spelling of an Indian mobile -> '+91XXXXXXXXXX', else None.

    Alphanumeric sender ids (bank and operator short codes) are rejected
    outright: only a real mobile can prove ownership of a mobile.
    """
    if not isinstance(raw, str) or re.search(r"[A-Za-z]", raw):
        return None
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 14 and digits.startswith("0091"):
        digits = digits[4:]
    elif len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    if not _IN_MOBILE.match(digits):
        return None
    return "+91" + digits


def parse_code(message):
    """The one 6-digit run in an SMS body, or None if there are zero or several."""
    if not isinstance(message, str):
        return None
    runs = _SIX_DIGIT_RUN.findall(message)
    return runs[0] if len(runs) == 1 else None


def verify_signature(raw_body, timestamp, signature, key, now=None):
    """SMS Gateway for Android signs hex(HMAC-SHA256(key, raw_body + X-Timestamp)).

    The timestamp is concatenated exactly as received, so it is used as the
    header string rather than re-formatted from the parsed integer.
    """
    if raw_body is None or not timestamp or not signature or not key:
        return False
    try:
        sent_at = int(timestamp)
    except (TypeError, ValueError):
        return False
    current = time.time() if now is None else now
    if abs(current - sent_at) > SIGNATURE_WINDOW_SECONDS:
        return False
    body = raw_body if isinstance(raw_body, bytes) else str(raw_body).encode("utf-8")
    expected = hmac.new(
        key.encode("utf-8"), body + timestamp.encode("utf-8"), hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature.strip().lower())


def mask_phone(phone):
    """'+919876543210' -> '+91******3210'. Logs must never hold a full number."""
    if not isinstance(phone, str) or len(phone) < 8:
        return "***"
    return phone[:3] + "*" * (len(phone) - 7) + phone[-4:]


def parse_received_at(value):
    """ISO-8601 with offset (as the gateway sends it) -> epoch seconds, else None."""
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None
