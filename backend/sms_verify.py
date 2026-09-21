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


class StoreFull(Exception):
    """Too many live sessions; refuse new ones rather than grow without bound."""


class SessionStore:
    """Live reverse-OTP sessions, in memory, for a single process.

    The gateway webhook and the app's status poll must reach the same process
    for this to work, which the one-worker waitress setup guarantees. Moving to
    several workers means moving this to Redis first.
    """

    def __init__(self, ttl_seconds=SESSION_TTL_SECONDS, max_sessions=MAX_LIVE_SESSIONS,
                 min_poll_interval=MIN_POLL_INTERVAL_SECONDS, clock=time.time, code_source=None):
        self._ttl = ttl_seconds
        self._max = max_sessions
        self._min_poll = min_poll_interval
        self._clock = clock
        self._code_source = code_source or (lambda: secrets.randbelow(10 ** 6))
        self._lock = threading.Lock()
        self._sessions = {}    # session id -> session dict
        self._by_code = {}     # code -> session id
        self._by_phone = {}    # phone -> session id
        self._deliveries = {}  # gateway delivery id -> first seen

    def __len__(self):
        with self._lock:
            self._purge(self._clock())
            return len(self._sessions)

    def start(self, phone, verified=False):
        with self._lock:
            now = self._clock()
            self._purge(now)
            previous = self._by_phone.get(phone)
            if previous:
                self._drop(previous)
            if len(self._sessions) >= self._max:
                raise StoreFull()
            code = self._fresh_code()
            session = {
                "id": secrets.token_urlsafe(32),
                "phone": phone,
                "code": code,
                "created_at": now,
                "expires_at": now + self._ttl,
                "verified_at": now if verified else None,
                "last_poll": None,
            }
            self._sessions[session["id"]] = session
            self._by_code[code] = session["id"]
            self._by_phone[phone] = session["id"]
            return {k: v for k, v in session.items() if k != "last_poll"}

    def mark_verified(self, code, sender, received_at=None):
        with self._lock:
            now = self._clock()
            self._purge(now)
            session_id = self._by_code.get(code)
            if not session_id:
                return "no_session"
            session = self._sessions[session_id]
            # The gateway retries for about two days, so an old queued SMS can
            # arrive long after its session died. It must not verify a newer
            # session that happened to draw the same code.
            if received_at is not None and received_at < session["created_at"] - RECEIVED_AT_SKEW_SECONDS:
                return "stale"
            if sender != session["phone"]:
                return "sender_mismatch"
            if session["verified_at"] is None:
                session["verified_at"] = now
            return "verified"

    def seen_delivery(self, delivery_id):
        if not delivery_id:
            return False
        with self._lock:
            now = self._clock()
            self._purge(now)
            if delivery_id in self._deliveries:
                return True
            self._deliveries[delivery_id] = now
            return False

    def poll(self, session_id):
        with self._lock:
            now = self._clock()
            self._purge(now)
            session = self._sessions.get(session_id) if session_id else None
            if not session:
                return "expired", None
            last = session["last_poll"]
            if last is not None and now - last < self._min_poll:
                return "throttled", None
            session["last_poll"] = now
            if session["verified_at"] is None:
                return "pending", max(0, int(session["expires_at"] - now))
            return "verified", session["phone"]

    def consume(self, session_id):
        with self._lock:
            if session_id not in self._sessions:
                return False
            self._drop(session_id)
            return True

    def _fresh_code(self):
        while True:
            code = "%06d" % self._code_source()
            if code not in self._by_code:
                return code

    def _purge(self, now):
        for session_id in [s for s, v in self._sessions.items() if v["expires_at"] <= now]:
            self._drop(session_id)
        for delivery_id in [d for d, seen in self._deliveries.items() if now - seen > DELIVERY_ID_TTL_SECONDS]:
            del self._deliveries[delivery_id]

    def _drop(self, session_id):
        session = self._sessions.pop(session_id, None)
        if not session:
            return
        if self._by_code.get(session["code"]) == session_id:
            del self._by_code[session["code"]]
        if self._by_phone.get(session["phone"]) == session_id:
            del self._by_phone[session["phone"]]


class GatewayHealth:
    """Whether the gateway phone is alive, from the last signed request it sent.

    `starting` covers the minute after a server restart, before the first
    heartbeat arrives, so a deploy does not briefly lock everyone out.
    `misconfigured` sticks until restart: it means batching was turned on and
    every SMS is arriving in a shape this server does not read.
    """

    def __init__(self, clock=time.time, stale_seconds=GATEWAY_STALE_SECONDS):
        self._clock = clock
        self._stale = stale_seconds
        self._lock = threading.Lock()
        self._started_at = clock()
        self._last_seen = None
        self._misconfigured = False

    def seen(self):
        with self._lock:
            self._last_seen = self._clock()

    def flag_misconfigured(self):
        with self._lock:
            self._misconfigured = True

    def status(self):
        with self._lock:
            now = self._clock()
            age = None if self._last_seen is None else int(now - self._last_seen)
            if self._misconfigured:
                return "misconfigured", age
            if self._last_seen is None:
                return ("starting" if now - self._started_at <= self._stale else "offline"), None
            return ("online" if age <= self._stale else "offline"), age
