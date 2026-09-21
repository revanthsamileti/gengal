# Reverse-OTP SMS Sign-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Twilio/Fast2SMS OTP and password login with passwordless sign-in: the user texts a session code from their phone to a gateway Android phone, which forwards it to the backend over a signed webhook.

**Architecture:** A new pure-logic module `backend/sms_verify.py` holds normalisation, signature checks, an in-memory session store, and gateway health. Four thin Flask routes in `backend/app.py` expose start / inbound webhook / status poll / health. The app gets a service (`smsAuthService.ts`), a sign-up finisher (`signupService.ts`) and one new screen (`VerifyBySmsScreen.tsx`). Four old screens and five old endpoints are deleted.

**Tech Stack:** Python 3.12, Flask 3.0, firebase-admin 6.5, pytest; Expo SDK 56 / React Native 0.85 / TypeScript, `expo-sms`, `expo-clipboard`; waitress behind nginx on Ubuntu 24.04.

**Spec:** `docs/superpowers/specs/2026-09-21-reverse-otp-sms-design.md`

## Global Constraints

- Branch: `feature/reverse-otp-sms` in worktree `D:\GenGal\.claude\worktrees\oracle-free-server-compat-51c70a`. Run commands from the worktree root.
- Firebase UID for every sign-in is exactly `fast2sms:` + E.164 phone, e.g. `fast2sms:+919876543210`. It must match what the removed `verify-otp` minted.
- Only Indian mobiles are accepted: `+91` followed by 10 digits whose first digit is 6–9.
- SMS text shown to users: `GENGAL ` + 6 digits, e.g. `GENGAL 482913`.
- Session TTL 600 s. Signature clock window 300 s. `receivedAt` may precede session creation by at most 60 s. Gateway counts as offline after 300 s without a signed request. Store cap 10,000 live sessions. Delivery ids remembered 24 h.
- Rate limits: `start` 3 per 10 min and 10 per day per phone; 20 per hour per client IP. `status` at most one call per 0.9 s per session.
- Never log a full phone number, a code, a session id, a signature, or the signing key. Mask phones as `+91******3210`.
- Backend stays single-process (one waitress process, threads only).
- Expo packages are added only with `npx expo install` (per `AGENTS.md`: SDK 56 docs).
- Backend tests: `cd backend && python -m pytest -q`. App typecheck: `npx tsc --noEmit`.
- Every commit message ends with the line `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `backend/sms_verify.py` | create | Pure logic: phone normalisation, code parsing, webhook signature, masking, `SessionStore`, `GatewayHealth` |
| `backend/app.py` | modify | Four `/api/v1/auth/sms/*` routes; delete OTP and password auth |
| `backend/tests/test_sms_verify.py` | create | Unit tests for `sms_verify.py` |
| `backend/tests/test_sms_auth_routes.py` | create | Route tests: flow, security, production behaviour |
| `backend/tests/test_legacy_auth_removed.py` | create | Old routes return 404 |
| `backend/tests/test_deploy_config.py` | create | Lints the unit file, env template and Firestore rules |
| `backend/tests/test_hardening.py` | modify | Drop the send-otp section |
| `deploy/gengal-backend.service` | modify | Trusted proxy flags; move start limits to `[Unit]` |
| `deploy/gengal.env.example` | modify | Add SMS gateway vars; drop dead ones |
| `firestore.rules` | modify | Explicit deny for `auth_events` |
| `docs/ORACLE_SETUP_RUNBOOK.md` | modify | Gateway phone section, env block, new trap |
| `src/services/smsAuthService.ts` | create | start / poll / sign in against the new routes |
| `src/services/signupService.ts` | create | Account creation moved out of CreatePasswordScreen |
| `src/screens/VerifyBySmsScreen.tsx` | create | The verify-by-SMS UI |
| `src/screens/PhoneScreen.tsx` | modify | India-only, goes to VerifyBySms |
| `src/screens/FinalizeInviteScreen.tsx` | modify | Calls `completeSignup` instead of CreatePassword |
| `App.tsx` | modify | Registry: add VerifyBySms, remove four screens |
| `src/services/authService.ts` | modify | Delete dead OTP/password functions |
| `src/screens/{Otp,CreatePassword,LoginPassword,ForgotPassword}Screen.tsx` | delete | Replaced |

---

### Task 1: Pure helpers in `sms_verify.py`

**Files:**
- Create: `backend/sms_verify.py`
- Test: `backend/tests/test_sms_verify.py`

**Interfaces:**
- Produces:
  - `normalize_in_mobile(raw) -> str | None` — returns `"+91XXXXXXXXXX"` or `None`
  - `parse_code(message) -> str | None` — returns the single 6-digit run, or `None`
  - `verify_signature(raw_body: bytes, timestamp: str | None, signature: str | None, key: str, now: float | None = None) -> bool`
  - `mask_phone(phone) -> str` — `"+91******3210"`
  - `parse_received_at(value) -> float | None` — epoch seconds
  - Constants: `SESSION_TTL_SECONDS=600`, `MAX_LIVE_SESSIONS=10_000`, `SIGNATURE_WINDOW_SECONDS=300`, `DELIVERY_ID_TTL_SECONDS=86_400`, `RECEIVED_AT_SKEW_SECONDS=60`, `GATEWAY_STALE_SECONDS=300`, `MIN_POLL_INTERVAL_SECONDS=0.9`, `CODE_PREFIX="GENGAL"`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_sms_verify.py`:

```python
"""Unit tests for the reverse-OTP pure logic in sms_verify.py.

No Flask and no Firestore: these rules decide who can sign in as whom, so each
one is pinned in isolation before the routes are built on top of them.
"""
import hashlib
import hmac

import pytest

import sms_verify


# --- normalize_in_mobile -----------------------------------------------------

@pytest.mark.parametrize("raw", [
    "+919876543210",
    "919876543210",
    "09876543210",
    "9876543210",
    "+91 98765 43210",
    "+91-98765-43210",
    "00919876543210",
])
def test_normalize_accepts_every_indian_mobile_format(raw):
    assert sms_verify.normalize_in_mobile(raw) == "+919876543210"


@pytest.mark.parametrize("raw", [
    "+915876543210",   # starts with 5: not a mobile range
    "+1 650 555 1212", # foreign
    "98765432",        # too short
    "VK-GENGAL",       # alphanumeric sender id
    "AX-123456",       # alphanumeric with digits
    "",
    None,
    12345,
])
def test_normalize_rejects_non_mobiles(raw):
    assert sms_verify.normalize_in_mobile(raw) is None


# --- parse_code ---------------------------------------------------------------

@pytest.mark.parametrize("message", [
    "GENGAL 482913",
    "gengal482913",
    "  482913  ",
    "GENGAL: 482913.",
])
def test_parse_code_extracts_the_six_digits(message):
    assert sms_verify.parse_code(message) == "482913"


@pytest.mark.parametrize("message", [
    "GENGAL",
    "GENGAL 48291",       # five digits
    "GENGAL 4829134",     # seven digits
    "482913 and 111111",  # ambiguous
    None,
])
def test_parse_code_rejects_ambiguous_or_missing(message):
    assert sms_verify.parse_code(message) is None


# --- verify_signature ---------------------------------------------------------

KEY = "signing-key"
BODY = b'{"event":"sms:received"}'


def sign(body, ts, key=KEY):
    return hmac.new(key.encode(), body + ts.encode(), hashlib.sha256).hexdigest()


def test_signature_accepts_valid():
    assert sms_verify.verify_signature(BODY, "1000", sign(BODY, "1000"), KEY, now=1000)


def test_signature_accepts_uppercase_hex():
    assert sms_verify.verify_signature(BODY, "1000", sign(BODY, "1000").upper(), KEY, now=1000)


def test_signature_rejects_tampered_body():
    assert not sms_verify.verify_signature(BODY + b" ", "1000", sign(BODY, "1000"), KEY, now=1000)


def test_signature_rejects_wrong_key():
    assert not sms_verify.verify_signature(BODY, "1000", sign(BODY, "1000", "other"), KEY, now=1000)


def test_signature_rejects_stale_timestamp():
    assert not sms_verify.verify_signature(BODY, "1000", sign(BODY, "1000"), KEY, now=1000 + 301)


@pytest.mark.parametrize("ts,sig", [(None, "x"), ("1000", None), ("abc", "x"), ("", "")])
def test_signature_rejects_missing_or_malformed_headers(ts, sig):
    assert not sms_verify.verify_signature(BODY, ts, sig, KEY, now=1000)


def test_signature_rejects_when_no_key_configured():
    assert not sms_verify.verify_signature(BODY, "1000", sign(BODY, "1000"), "", now=1000)


# --- mask_phone / parse_received_at ------------------------------------------

def test_mask_phone_keeps_country_code_and_last_four():
    assert sms_verify.mask_phone("+919876543210") == "+91******3210"


def test_mask_phone_handles_junk():
    assert sms_verify.mask_phone(None) == "***"


def test_parse_received_at_reads_offset_timestamps():
    assert sms_verify.parse_received_at("1970-01-01T05:30:10.000+05:30") == 10.0
    assert sms_verify.parse_received_at("1970-01-01T00:00:10Z") == 10.0


def test_parse_received_at_returns_none_for_junk():
    assert sms_verify.parse_received_at("yesterday") is None
    assert sms_verify.parse_received_at(None) is None
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_sms_verify.py -q`
Expected: collection error — `ModuleNotFoundError: No module named 'sms_verify'`.

- [ ] **Step 3: Implement the helpers**

Create `backend/sms_verify.py`:

```python
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_sms_verify.py -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/sms_verify.py backend/tests/test_sms_verify.py
git commit -m "Add reverse-OTP phone, code and webhook-signature helpers

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `SessionStore` and `GatewayHealth`

**Files:**
- Modify: `backend/sms_verify.py` (append)
- Test: `backend/tests/test_sms_verify.py` (append)

**Interfaces:**
- Consumes: constants from Task 1.
- Produces:
  - `class StoreFull(Exception)`
  - `SessionStore(ttl_seconds=600, max_sessions=10_000, min_poll_interval=0.9, clock=time.time, code_source=None)`
    - `start(phone: str, verified: bool = False) -> dict` with keys `id, phone, code, created_at, expires_at, verified_at` (raises `StoreFull`)
    - `mark_verified(code: str, sender: str, received_at: float | None = None) -> str` returning one of `"verified" | "no_session" | "sender_mismatch" | "stale"`
    - `seen_delivery(delivery_id) -> bool` (True means duplicate)
    - `poll(session_id) -> tuple[str, object]`: `("expired", None)`, `("throttled", None)`, `("pending", seconds_left:int)`, `("verified", phone:str)`. Never deletes a verified session.
    - `consume(session_id) -> bool` — deletes; True for exactly one caller
    - `__len__()` — live session count
  - `GatewayHealth(clock=time.time, stale_seconds=300)` with `seen()`, `flag_misconfigured()`, `status() -> tuple[str, int | None]` where status is `"online" | "starting" | "offline" | "misconfigured"`

- [ ] **Step 1: Append the failing tests**

Append to `backend/tests/test_sms_verify.py`:

```python
# --- SessionStore -------------------------------------------------------------

PHONE = "+919876543210"
OTHER = "+919123456789"


class Clock:
    def __init__(self, t=1_000_000.0):
        self.t = t

    def __call__(self):
        return self.t


def make_store(**kw):
    clock = kw.pop("clock", Clock())
    kw.setdefault("min_poll_interval", 0)
    return sms_verify.SessionStore(clock=clock, **kw), clock


def test_start_returns_a_session_with_a_six_digit_code():
    store, _ = make_store()
    s = store.start(PHONE)
    assert s["phone"] == PHONE
    assert len(s["code"]) == 6 and s["code"].isdigit()
    assert len(s["id"]) >= 40
    assert s["verified_at"] is None


def test_verified_sms_from_the_right_number_verifies():
    store, _ = make_store()
    s = store.start(PHONE)
    assert store.mark_verified(s["code"], PHONE) == "verified"
    assert store.poll(s["id"]) == ("verified", PHONE)


def test_sms_from_another_number_does_not_verify():
    store, _ = make_store()
    s = store.start(PHONE)
    assert store.mark_verified(s["code"], OTHER) == "sender_mismatch"
    assert store.poll(s["id"])[0] == "pending"


def test_unknown_code_is_no_session():
    store, _ = make_store(code_source=lambda: 111111)
    store.start(PHONE)
    assert store.mark_verified("222222", PHONE) == "no_session"


def test_sms_received_before_the_session_is_stale():
    store, clock = make_store()
    s = store.start(PHONE)
    received = clock.t - 61
    assert store.mark_verified(s["code"], PHONE, received_at=received) == "stale"
    assert store.mark_verified(s["code"], PHONE, received_at=clock.t - 59) == "verified"


def test_session_expires_after_ttl():
    store, clock = make_store()
    s = store.start(PHONE)
    clock.t += 601
    assert store.poll(s["id"]) == ("expired", None)
    assert store.mark_verified(s["code"], PHONE) == "no_session"


def test_poll_reports_seconds_left():
    store, clock = make_store()
    s = store.start(PHONE)
    clock.t += 100
    assert store.poll(s["id"]) == ("pending", 500)


def test_poll_is_throttled_below_the_minimum_interval():
    clock = Clock()
    store = sms_verify.SessionStore(clock=clock, min_poll_interval=0.9)
    s = store.start(PHONE)
    assert store.poll(s["id"])[0] == "pending"
    assert store.poll(s["id"]) == ("throttled", None)
    clock.t += 1
    assert store.poll(s["id"])[0] == "pending"


def test_consume_succeeds_exactly_once():
    store, _ = make_store()
    s = store.start(PHONE)
    store.mark_verified(s["code"], PHONE)
    assert store.consume(s["id"]) is True
    assert store.consume(s["id"]) is False
    assert store.poll(s["id"]) == ("expired", None)


def test_starting_again_replaces_the_previous_session_for_that_phone():
    store, _ = make_store()
    first = store.start(PHONE)
    second = store.start(PHONE)
    assert store.poll(first["id"]) == ("expired", None)
    assert store.poll(second["id"])[0] == "pending"
    assert len(store) == 1


def test_codes_are_redrawn_until_unique():
    draws = iter([123456, 123456, 654321])
    store, _ = make_store(code_source=lambda: next(draws))
    a = store.start(PHONE)
    b = store.start(OTHER)
    assert a["code"] == "123456"
    assert b["code"] == "654321"


def test_store_cap_raises_store_full():
    store, _ = make_store(max_sessions=1)
    store.start(PHONE)
    with pytest.raises(sms_verify.StoreFull):
        store.start(OTHER)


def test_dev_bypass_session_starts_verified():
    store, _ = make_store()
    s = store.start(PHONE, verified=True)
    assert store.poll(s["id"]) == ("verified", PHONE)


def test_duplicate_delivery_ids_are_detected_for_24h():
    store, clock = make_store()
    assert store.seen_delivery("d1") is False
    assert store.seen_delivery("d1") is True
    clock.t += 86_401
    assert store.seen_delivery("d1") is False


def test_empty_delivery_id_is_never_a_duplicate():
    store, _ = make_store()
    assert store.seen_delivery("") is False
    assert store.seen_delivery(None) is False


# --- GatewayHealth --------------------------------------------------------------

def test_health_is_starting_until_first_signal_then_offline():
    clock = Clock()
    health = sms_verify.GatewayHealth(clock=clock)
    assert health.status() == ("starting", None)
    clock.t += 301
    assert health.status() == ("offline", None)


def test_health_is_online_after_a_signal_and_offline_when_it_goes_quiet():
    clock = Clock()
    health = sms_verify.GatewayHealth(clock=clock)
    health.seen()
    clock.t += 60
    assert health.status() == ("online", 60)
    clock.t += 241
    assert health.status() == ("offline", 301)


def test_misconfigured_wins_over_online():
    clock = Clock()
    health = sms_verify.GatewayHealth(clock=clock)
    health.seen()
    health.flag_misconfigured()
    assert health.status()[0] == "misconfigured"
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `cd backend && python -m pytest tests/test_sms_verify.py -q`
Expected: the new tests fail with `AttributeError: module 'sms_verify' has no attribute 'SessionStore'`.

- [ ] **Step 3: Implement the store and health tracker**

Append to `backend/sms_verify.py`:

```python
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_sms_verify.py -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/sms_verify.py backend/tests/test_sms_verify.py
git commit -m "Add the reverse-OTP session store and gateway health tracker

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The four `/api/v1/auth/sms/*` routes

**Files:**
- Modify: `backend/app.py` — insert directly **below** the `# AUTHENTICATION ROUTES` banner (the three-line `# ===` block around line 412)
- Test: `backend/tests/test_sms_auth_routes.py`

**Interfaces:**
- Consumes: everything from Tasks 1–2; existing `rate_limited(key, max_attempts, window_seconds)`, `env_value(name)`, `auth`, `firestore` in `app.py`.
- Produces (HTTP, used by Task 6):
  - `POST /api/v1/auth/sms/start` `{phone}` → 200 `{sessionId, code, message, gatewayNumber, expiresIn}`; 400 `{code:"invalid_phone"}`; 429 `{code:"rate_limited"}`; 503 `{code:"sms_not_configured"|"sms_gateway_offline"|"sms_busy"}`
  - `POST /api/v1/auth/sms/inbound` — gateway only; 401 on a bad signature, 200 otherwise
  - `POST /api/v1/auth/sms/status` `{sessionId}` → 200 `{status:"pending", expiresIn}` | `{status:"expired"}` | `{status:"verified", token, isNewUser}`; 429 `{code:"throttled"}`; 503 `{code:"lookup_failed"}`; 500 `{code:"token_error"}`
  - `GET /api/v1/auth/sms/health` → `{gateway, lastSeenSecondsAgo}`, 200 if online/starting else 503
  - Module globals `sms_sessions: SessionStore`, `sms_gateway: GatewayHealth` (tests replace them)

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_sms_auth_routes.py`:

```python
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_sms_auth_routes.py -q`
Expected: FAIL — routes return 404 / `AttributeError: module 'app' has no attribute 'sms_sessions'`.

- [ ] **Step 3: Add the import and the routes**

In `backend/app.py`, add to the imports block (after `from agora_token_builder import RtcTokenBuilder`):

```python
import sms_verify
```

Then insert this block directly below the `# AUTHENTICATION ROUTES` banner:

```python
# ------------------------------------------
# Reverse-OTP sign-in (user texts a code from their own phone)
# Design: docs/superpowers/specs/2026-09-21-reverse-otp-sms-design.md
# ------------------------------------------

# In memory and per-process, like the rate limiter: the gateway webhook and the
# app's poll must land on the same process. Single waitress process only.
sms_sessions = sms_verify.SessionStore()
sms_gateway = sms_verify.GatewayHealth()


def client_ip():
    return request.remote_addr or "unknown"


def log_sms(outcome, phone=None):
    """One grep-able line per outcome; never a full number or a code."""
    masked = sms_verify.mask_phone(phone) if phone else "-"
    print(f"[AUTH] sms_verify outcome={outcome} phone={masked}", flush=True)


@app.route('/api/v1/auth/sms/start', methods=['POST', 'OPTIONS'])
def sms_start():
    if request.method == 'OPTIONS':
        return '', 200
    data = request.get_json(silent=True) or {}
    phone = sms_verify.normalize_in_mobile(data.get("phone"))
    if not phone:
        return jsonify({"error": "Enter a valid Indian mobile number", "code": "invalid_phone"}), 400

    dev_bypass = os.environ.get("ALLOW_DEV_OTP_BYPASS") == "true"
    gateway_number = env_value("SMS_GATEWAY_NUMBER")
    if not dev_bypass:
        if not (gateway_number and env_value("SMS_GATEWAY_SIGNING_KEY")):
            return jsonify({"error": "SMS sign-in is not configured", "code": "sms_not_configured"}), 503
        health, _ = sms_gateway.status()
        if health in ("offline", "misconfigured"):
            log_sms("gateway_" + health, phone)
            return jsonify({"error": "SMS sign-in is temporarily unavailable", "code": "sms_gateway_offline"}), 503

    if rate_limited(f"sms-start:ip:{client_ip()}", 20, 3600):
        return jsonify({"error": "Too many attempts. Try again later.", "code": "rate_limited"}), 429
    if rate_limited(f"sms-start:10m:{phone}", 3, 600) or rate_limited(f"sms-start:day:{phone}", 10, 86400):
        return jsonify({"error": "Too many attempts for this number. Try again in a few minutes.",
                        "code": "rate_limited"}), 429

    try:
        session = sms_sessions.start(phone, verified=dev_bypass)
    except sms_verify.StoreFull:
        log_sms("store_full", phone)
        return jsonify({"error": "SMS sign-in is busy. Try again shortly.", "code": "sms_busy"}), 503

    log_sms("started", phone)
    return jsonify({
        "sessionId": session["id"],
        "code": session["code"],
        "message": f"{sms_verify.CODE_PREFIX} {session['code']}",
        "gatewayNumber": gateway_number,
        "expiresIn": sms_verify.SESSION_TTL_SECONDS,
    }), 200


@app.route('/api/v1/auth/sms/inbound', methods=['POST'])
def sms_inbound():
    """Webhook from the gateway phone. Only a bad signature earns a non-2xx:
    anything else would make the gateway retry the same useless SMS for days."""
    raw = request.get_data(cache=True)
    if not sms_verify.verify_signature(
        raw,
        request.headers.get("X-Timestamp"),
        request.headers.get("X-Signature"),
        env_value("SMS_GATEWAY_SIGNING_KEY"),
    ):
        log_sms("bad_signature")
        return jsonify({"error": "invalid signature"}), 401

    sms_gateway.seen()
    ok = (jsonify({"ok": True}), 200)
    try:
        event = json.loads(raw or b"{}")
    except ValueError:
        log_sms("bad_payload")
        return ok
    if not isinstance(event, dict):
        log_sms("bad_payload")
        return ok

    kind = str(event.get("event") or "")
    if kind.startswith("sms:batch:") or kind.startswith("mms:batch:"):
        sms_gateway.flag_misconfigured()
        print("[AUTH][ERROR] SMS gateway is sending batched webhooks. "
              "Turn batching off in the gateway app, then restart gengal-backend.", flush=True)
        return ok
    if kind != "sms:received":
        return ok
    if sms_sessions.seen_delivery(event.get("id")):
        log_sms("duplicate")
        return ok

    payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
    sender = sms_verify.normalize_in_mobile(payload.get("sender") or payload.get("phoneNumber"))
    code = sms_verify.parse_code(payload.get("message"))
    if not sender or not code:
        log_sms("unparseable", sender)
        return ok

    outcome = sms_sessions.mark_verified(code, sender, sms_verify.parse_received_at(payload.get("receivedAt")))
    log_sms(outcome, sender)
    return ok


@app.route('/api/v1/auth/sms/status', methods=['POST', 'OPTIONS'])
def sms_status():
    if request.method == 'OPTIONS':
        return '', 200
    data = request.get_json(silent=True) or {}
    session_id = data.get("sessionId")
    if not isinstance(session_id, str) or not session_id:
        return jsonify({"status": "expired"}), 200

    state, value = sms_sessions.poll(session_id)
    if state == "throttled":
        return jsonify({"error": "Polling too fast", "code": "throttled"}), 429
    if state == "expired":
        return jsonify({"status": "expired"}), 200
    if state == "pending":
        return jsonify({"status": "pending", "expiresIn": value}), 200

    phone = value
    uid = f"fast2sms:{phone}"
    # Look up and mint BEFORE consuming, so a Firestore or token failure leaves
    # the session verified and the app's next poll can simply retry.
    try:
        is_new_user = not firestore.client().collection('users').document(uid).get().exists
    except Exception as e:
        print(f"[AUTH] sms status users lookup failed: {e}", flush=True)
        log_sms("lookup_failed", phone)
        return jsonify({"error": "Temporarily unavailable", "code": "lookup_failed"}), 503
    try:
        token = auth.create_custom_token(uid)
        token = token.decode("utf-8") if isinstance(token, bytes) else token
    except Exception as e:
        print(f"[AUTH] sms status token minting failed: {e}", flush=True)
        log_sms("token_error", phone)
        return jsonify({"error": "Could not complete sign-in", "code": "token_error"}), 500

    if not sms_sessions.consume(session_id):
        # A concurrent poll already delivered the token for this session.
        return jsonify({"status": "expired"}), 200

    try:
        firestore.client().collection('auth_events').document().set({
            "uid": uid,
            "phoneMasked": sms_verify.mask_phone(phone),
            "method": "reverse_sms",
            "isNewUser": is_new_user,
            "ip": client_ip(),
            "at": firestore.SERVER_TIMESTAMP,
        })
    except Exception as e:
        # The audit trail must never block a sign-in that already succeeded.
        print(f"[AUTH] auth_events write failed: {e}", flush=True)

    log_sms("verified", phone)
    return jsonify({"status": "verified", "token": token, "isNewUser": is_new_user}), 200


@app.route('/api/v1/auth/sms/health', methods=['GET'])
def sms_health():
    """For an external uptime monitor: 503 when the gateway phone has gone quiet."""
    state, age = sms_gateway.status()
    return jsonify({"gateway": state, "lastSeenSecondsAgo": age}), (200 if state in ("online", "starting") else 503)
```

Both `/inbound` (when the SMS matches) and `/status` (when the token is delivered) log `outcome=verified`. `test_logs_never_contain_the_full_phone_or_the_code` asserts on the masked line, which either produces.

- [ ] **Step 4: Run the route tests**

Run: `cd backend && python -m pytest tests/test_sms_auth_routes.py -q`
Expected: all pass.

- [ ] **Step 5: Run the whole backend suite**

Run: `cd backend && python -m pytest -q`
Expected: all pass (the old send-otp tests still exist and still pass; they are removed in Task 4).

- [ ] **Step 6: Commit**

```bash
git add backend/app.py backend/tests/test_sms_auth_routes.py
git commit -m "Add reverse-OTP start, inbound webhook, status and health routes

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Remove OTP and password authentication from the backend

**Files:**
- Modify: `backend/app.py`
- Modify: `backend/tests/test_hardening.py`
- Test: `backend/tests/test_legacy_auth_removed.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `POST /api/v1/auth/{send-otp,verify-otp,login-password,set-password,check-user}` → 404. `/api/v1/auth/delete-account` and `/api/v1/auth/check-username` unchanged.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_legacy_auth_removed.py`:

```python
"""Passwordless sign-in removed the OTP and password routes entirely.

check-user goes too: it let anyone enumerate which numbers have accounts.
"""
import pytest

REMOVED = [
    "/api/v1/auth/send-otp",
    "/api/v1/auth/verify-otp",
    "/api/v1/auth/login-password",
    "/api/v1/auth/set-password",
    "/api/v1/auth/check-user",
]


@pytest.mark.parametrize("path", REMOVED)
def test_legacy_auth_route_is_gone(client, path):
    assert client.post(path, json={"phone": "+919876543210"}).status_code == 404


def test_account_deletion_is_still_served(client):
    # Unauthenticated, so 401 -- but the route must still exist.
    assert client.post("/api/v1/auth/delete-account").status_code == 401


def test_username_check_is_still_served(client):
    assert client.post("/api/v1/auth/check-username", json={}).status_code != 404
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && python -m pytest tests/test_legacy_auth_removed.py -q`
Expected: the five `test_legacy_auth_route_is_gone` cases FAIL (routes answer 400/401/500, not 404).

- [ ] **Step 3: Delete the legacy functions**

From the `backend` directory, run this one-off script. It removes each named top-level function together with its decorators, and preserves the file's line endings:

```bash
cd backend && python - <<'PY'
import ast
path = "app.py"
with open(path, encoding="utf-8", newline="") as f:
    src = f.read()
names = {
    "send_otp", "verify_otp", "read_stored_password", "write_stored_password",
    "login_password", "set_password", "check_user", "hash_password", "verify_password",
}
spans = []
for node in ast.parse(src).body:
    if isinstance(node, ast.FunctionDef) and node.name in names:
        start = min([d.lineno for d in node.decorator_list] + [node.lineno]) - 1
        spans.append((start, node.end_lineno))
found = len(spans)
lines = src.splitlines(keepends=True)
for start, end in sorted(spans, reverse=True):
    del lines[start:end]
with open(path, "w", encoding="utf-8", newline="") as f:
    f.write("".join(lines))
print(f"removed {found} functions")
PY
```

Expected output: `removed 9 functions`.

- [ ] **Step 4: Remove the dead module-level state and imports**

In `backend/app.py`:

1. Delete the import line `from werkzeug.security import check_password_hash`.
2. Delete the import line `import random`.
3. Delete these three lines:
   ```python
   # Fast2SMS Global config
   FAST2SMS_API_KEY = env_value("FAST2SMS_API_KEY")
   otp_store = {} # simple dictionary mapping { phone: { "otp": "123456", "expires": datetime } }
   ```
4. Delete this block below the `# AUTHENTICATION ROUTES` banner:
   ```python
   # In-process abuse tracking. NOTE: like otp_store above, this is per-worker and
   # lost on restart — both must move to Redis before scaling past one worker.
   abuse_store = {}
   ```
5. In `assert_safe_production_config`, change the warning loop to one flag:
   ```python
   for _flag in ("ALLOW_DEV_OTP_BYPASS",):
   ```
   and the `unsafe` tuple to:
   ```python
           for name in (
               "ALLOW_DEV_OTP_BYPASS",
               "FLASK_DEBUG",
           )
   ```
   and update its docstring: replace the two bullet lines about `ALLOW_DEV_OTP_BYPASS` and `ALLOW_LEGACY_PLAINTEXT_LOGIN` with:
   ```
         * ALLOW_DEV_OTP_BYPASS marks every SMS sign-in verified without an SMS,
           so anyone could sign in as any phone number.
   ```

Then confirm nothing still references the removed names:

Run: `cd backend && grep -nE "otp_store|abuse_store|FAST2SMS|check_password_hash|random\.|verify_password|hash_password|stored_password|ALLOW_LEGACY|TWILIO" app.py`
Expected: no output. If a line remains that is an orphaned comment left above a deleted function, delete that comment too.

- [ ] **Step 5: Drop the send-otp section from `test_hardening.py`**

In `backend/tests/test_hardening.py`:
1. In the module docstring, replace the line `3. send-otp: per-IP rate limit prevents bulk SMS enumeration.` with `3. (removed) send-otp no longer exists; reverse-OTP limits live in test_sms_auth_routes.py.`
2. Delete the `clean_abuse` fixture (the `@pytest.fixture` line through `monkeypatch.setattr(app_module, "abuse_store", {})`).
3. Delete everything from the banner line `# 3. send-otp: per-IP rate limit` (including the `# ===` line above it) down to, but not including, the `# ===` line above `# 4. global error handler returns generic JSON`.

- [ ] **Step 6: Run the whole backend suite**

Run: `cd backend && python -m pytest -q`
Expected: all pass, including `test_legacy_auth_removed.py`.

- [ ] **Step 7: Commit**

```bash
git add backend/app.py backend/tests/test_hardening.py backend/tests/test_legacy_auth_removed.py
git commit -m "Remove OTP, password and check-user auth routes

Sign-in is now passwordless via reverse OTP. check-user is removed rather
than kept because it let anyone test which numbers have accounts.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Deployment config, Firestore rules and runbook

**Files:**
- Modify: `deploy/gengal-backend.service`
- Modify: `deploy/gengal.env.example`
- Modify: `firestore.rules`
- Modify: `docs/ORACLE_SETUP_RUNBOOK.md`
- Test: `backend/tests/test_deploy_config.py`

**Interfaces:**
- Produces: waitress honours `X-Forwarded-For` from nginx, so `request.remote_addr` is the real client IP — Task 3's per-IP limit and the audit `ip` depend on it in production.

- [ ] **Step 1: Write the failing config lint**

Create `backend/tests/test_deploy_config.py`:

```python
"""Lints deploy files whose mistakes only show up in production.

Without the trusted-proxy flags waitress sees nginx (127.0.0.1) as every
client, and every per-IP rate limit silently becomes one bucket for all users.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
UNIT = ROOT / "deploy" / "gengal-backend.service"


def sections(text):
    out, current = {}, None
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            current = stripped
            out[current] = []
        elif current:
            out[current].append(stripped)
    return {k: "\n".join(v) for k, v in out.items()}


def test_waitress_trusts_nginx_forwarded_for():
    text = UNIT.read_text(encoding="utf-8")
    assert "--trusted-proxy=127.0.0.1" in text
    assert "--trusted-proxy-headers=x-forwarded-for" in text
    assert "--clear-untrusted-proxy-headers" in text


def test_start_limits_live_in_the_unit_section():
    s = sections(UNIT.read_text(encoding="utf-8"))
    for key in ("StartLimitIntervalSec=", "StartLimitBurst="):
        assert key in s["[Unit]"]
        assert key not in s["[Service]"]


def test_env_template_lists_the_gateway_settings_and_nothing_dead():
    env = (ROOT / "deploy" / "gengal.env.example").read_text(encoding="utf-8")
    assert "SMS_GATEWAY_NUMBER=" in env
    assert "SMS_GATEWAY_SIGNING_KEY=" in env
    for dead in ("ALLOW_LEGACY_PLAINTEXT_LOGIN", "TWILIO_", "FAST2SMS"):
        assert dead not in env


def test_rules_deny_clients_the_auth_audit_trail():
    rules = (ROOT / "firestore.rules").read_text(encoding="utf-8")
    block = rules.split("match /auth_events/{eventId}", 1)[1].split("}", 1)[0]
    assert "allow read, write: if false;" in block
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && python -m pytest tests/test_deploy_config.py -q`
Expected: 4 failures.

- [ ] **Step 3: Update the systemd unit**

In `deploy/gengal-backend.service`:

1. Replace the `ExecStart` block with:
   ```ini
   ExecStart=/opt/gengal/venv/bin/waitress-serve \
       --host 127.0.0.1 \
       --port 5055 \
       --threads 8 \
       --trusted-proxy=127.0.0.1 \
       --trusted-proxy-headers=x-forwarded-for \
       --clear-untrusted-proxy-headers \
       app:app
   ```
2. Cut the two lines `StartLimitIntervalSec=120` and `StartLimitBurst=6` from `[Service]` and paste them at the end of the `[Unit]` section (just before the blank line above `[Service]`). systemd ignores them in `[Service]` and logs `Unknown key name 'StartLimitIntervalSec' in section 'Service'`, which is what the live server shows today.

- [ ] **Step 4: Update the env template**

In `deploy/gengal.env.example`:
1. Delete the line `ALLOW_LEGACY_PLAINTEXT_LOGIN=false` and any comment line directly above it that describes it.
2. Append:
   ```bash

   # Reverse-OTP sign-in. Users text "GENGAL <code>" to this number from their
   # own phone. It is the SIM in the gateway Android phone, in +91 format.
   SMS_GATEWAY_NUMBER=
   # The gateway app's webhook signing key (Settings -> Webhooks -> Signing Key).
   # Sign-in returns 503 until both of these are set.
   SMS_GATEWAY_SIGNING_KEY=
   ```

- [ ] **Step 5: Add the Firestore rule**

In `firestore.rules`, directly after the `coin_orders` block (`match /coin_orders/{orderId} { allow read, write: if false; }`), add:

```
    // Sign-in audit trail, written only by the backend's Admin SDK.
    match /auth_events/{eventId} {
      allow read, write: if false;
    }
```

- [ ] **Step 6: Update the runbook**

In `docs/ORACLE_SETUP_RUNBOOK.md`:

1. In §8's env block, delete the three `TWILIO_*` lines and add, after `RAZORPAY_KEY_SECRET=`:
   ```
   SMS_GATEWAY_NUMBER=
   SMS_GATEWAY_SIGNING_KEY=
   ```
2. Replace Trap 7 with:
   ```markdown
   7. **Never re-run `setup-oracle.sh` after certbot.** It reinstalls
      `deploy/nginx-gengal.conf` over `/etc/nginx/sites-available/gengal`, which
      wipes certbot's TLS server block and the real `server_name`. Redeploy code with
      `git fetch` + `reset` in `/opt/gengal` instead (see §12).
   ```
3. Append a new section:
   ````markdown
   ## 12. Reverse-OTP gateway phone

   Sign-in works by users texting `GENGAL <code>` from their own phone to a spare
   Android phone, which forwards the SMS to the backend.

   1. Spare Android phone, Indian SIM, charger always connected, Wi-Fi on.
   2. Install **SMS Gateway for Android** (capcom6, open source). Grant SMS permission.
   3. Use **Local server** mode (messages do not pass through a third-party cloud).
      Note the local address, username and password it shows.
   4. From a computer on the same Wi-Fi, register both webhooks:
      ```bash
      curl -X POST -u USER:PASS -H "Content-Type: application/json" \
        -d '{"id":"gengal-sms","url":"https://<host>/api/v1/auth/sms/inbound","event":"sms:received"}' \
        http://<phone-ip>:8080/webhooks
      curl -X POST -u USER:PASS -H "Content-Type: application/json" \
        -d '{"id":"gengal-ping","url":"https://<host>/api/v1/auth/sms/inbound","event":"system:ping"}' \
        http://<phone-ip>:8080/webhooks
      ```
   5. In the app: **Settings → Ping** = 60 s. Leave webhook **batching off**.
   6. Copy **Settings → Webhooks → Signing Key** into `SMS_GATEWAY_SIGNING_KEY`, and the
      SIM's number into `SMS_GATEWAY_NUMBER`, in `/etc/gengal/gengal.env`.
   7. Exempt the app from battery optimisation and enable start-on-boot. Keep the SIM
      recharged — an expired prepaid SIM stops receiving SMS.
   8. `sudo systemctl restart gengal-backend`, wait a minute, then
      `curl -s https://<host>/api/v1/auth/sms/health` must show `"gateway":"online"`.
   9. Add a free uptime monitor (UptimeRobot / Better Stack) on that URL every
      5 minutes with email alerts. It fires when the phone dies.

   **Redeploying code** (never re-run `setup-oracle.sh`, see Trap 7):
   ```bash
   sudo git -C /opt/gengal fetch --depth 1 origin <branch>
   sudo git -C /opt/gengal reset --hard FETCH_HEAD
   sudo /opt/gengal/venv/bin/pip install -r /opt/gengal/backend/requirements.txt
   sudo chown -R gengal:gengal /opt/gengal
   sudo install -m 0644 /opt/gengal/deploy/gengal-backend.service /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl restart gengal-backend
   ```
   ````

- [ ] **Step 7: Run the lint and the whole suite**

Run: `cd backend && python -m pytest -q`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add deploy/gengal-backend.service deploy/gengal.env.example firestore.rules docs/ORACLE_SETUP_RUNBOOK.md backend/tests/test_deploy_config.py
git commit -m "Trust nginx's X-Forwarded-For and document the SMS gateway

Without the trusted-proxy flags every per-IP rate limit was one shared
bucket for all users. Also moves StartLimit* to [Unit] where systemd
reads them, denies clients the auth_events audit trail, and adds the
gateway phone setup and a safe redeploy procedure to the runbook.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: App services for SMS sign-in and sign-up completion

**Files:**
- Create: `src/services/smsAuthService.ts`
- Create: `src/services/signupService.ts`

**Interfaces:**
- Consumes: HTTP contract from Task 3; `getBackendUrl` from `src/services/authService.ts`; `logDebugEvent`, `setDebugContext` from `src/services/debugLogger.ts`; `savePrivateUserData(uid, data)` from `src/services/userService.ts`; `auth`, `db` from `src/config/firebase.ts`.
- Produces:
  - `type SmsSession = { sessionId: string; code: string; message: string; gatewayNumber: string; expiresIn: number }`
  - `type SmsPollResult = { status: 'pending'; expiresIn: number } | { status: 'expired' } | { status: 'verified'; token: string; isNewUser: boolean } | { status: 'retry' }`
  - `class SmsAuthError extends Error { code: string }`
  - `startSmsVerification(phone: string): Promise<SmsSession>`
  - `pollSmsVerification(sessionId: string): Promise<SmsPollResult>`
  - `signInWithSmsToken(token: string): Promise<User>`
  - `type SignupParams`, `class SignupExpiredError`, `completeSignup(params: SignupParams): Promise<void>`

- [ ] **Step 1: Make sure dependencies are installed**

Run: `npm ci`
Expected: completes without errors (the worktree has no `node_modules` yet).

- [ ] **Step 2: Create `src/services/smsAuthService.ts`**

```ts
import { signInWithCustomToken, User } from 'firebase/auth';
import { auth } from '../config/firebase';
import { getBackendUrl } from './authService';
import { logDebugEvent, setDebugContext } from './debugLogger';

/**
 * Reverse-OTP sign-in: the user proves a number by texting a code FROM it.
 * The backend matches the SMS the gateway phone forwards; this module only
 * starts a session, polls it, and exchanges the resulting custom token.
 */

export type SmsSession = {
  sessionId: string;
  code: string;
  /** Exactly what the user must text, e.g. "GENGAL 482913". */
  message: string;
  /** Where to text it. Empty only in local dev bypass. */
  gatewayNumber: string;
  expiresIn: number;
};

export type SmsPollResult =
  | { status: 'pending'; expiresIn: number }
  | { status: 'expired' }
  | { status: 'verified'; token: string; isNewUser: boolean }
  /** Transient (network, throttle, 5xx): keep polling until the deadline. */
  | { status: 'retry' };

export class SmsAuthError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'SmsAuthError';
    this.code = code;
  }
}

const postJson = (path: string, body: Record<string, unknown>) =>
  fetch(`${getBackendUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const startErrorMessage = (status: number, code: string): string => {
  if (code === 'invalid_phone') return 'Enter a valid Indian mobile number.';
  if (code === 'rate_limited' || status === 429) return 'Too many attempts. Please try again in a few minutes.';
  if (code === 'sms_gateway_offline') return 'SMS sign-in is down for a few minutes. Please try again shortly.';
  return 'Sign-in is temporarily unavailable. Please try again.';
};

export const startSmsVerification = async (phone: string): Promise<SmsSession> => {
  let response: Response;
  try {
    response = await postJson('/api/v1/auth/sms/start', { phone });
  } catch {
    throw new SmsAuthError('Sign-in is temporarily unavailable. Check your connection.', 'network');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code: string = data?.code || `http_${response.status}`;
    logDebugEvent('auth.sms.start.failed', { status: response.status, code }, 'warn');
    throw new SmsAuthError(startErrorMessage(response.status, code), code);
  }
  logDebugEvent('auth.sms.start.ok', {});
  return data as SmsSession;
};

export const pollSmsVerification = async (sessionId: string): Promise<SmsPollResult> => {
  try {
    const response = await postJson('/api/v1/auth/sms/status', { sessionId });
    if (!response.ok) return { status: 'retry' };
    const data = await response.json();
    if (data?.status === 'verified' && typeof data.token === 'string') {
      return { status: 'verified', token: data.token, isNewUser: Boolean(data.isNewUser) };
    }
    if (data?.status === 'pending') return { status: 'pending', expiresIn: Number(data.expiresIn) || 0 };
    if (data?.status === 'expired') return { status: 'expired' };
    return { status: 'retry' };
  } catch {
    return { status: 'retry' };
  }
};

export const signInWithSmsToken = async (token: string): Promise<User> => {
  const credential = await signInWithCustomToken(auth, token);
  setDebugContext({ userId: credential.user.uid });
  logDebugEvent('auth.sms.signedIn', { uid: credential.user.uid });
  return credential.user;
};
```

- [ ] **Step 3: Create `src/services/signupService.ts`**

This is the account-creation block from `CreatePasswordScreen.handleSignUp`, minus the password steps.

```ts
import { PermissionsAndroid, Platform } from 'react-native';
import { signInWithCustomToken } from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { logDebugEvent, setDebugContext } from './debugLogger';
import { savePrivateUserData } from './userService';

/** Carried from VerifyBySms -> ProfileDetails -> FinalizeInvite. */
export type SignupParams = {
  phone: string;
  token: string;
  name: string;
  nickname?: string;
  dob: number | string;
  gender: string;
  country?: string;
  state?: string;
  city?: string;
  language?: string;
  avatar: unknown;
};

/** Firebase custom tokens live one hour; a slow sign-up can outlast it. */
export class SignupExpiredError extends Error {
  constructor() {
    super('Your verification has expired. Please verify your number again.');
    this.name = 'SignupExpiredError';
  }
}

const EXPIRED_TOKEN_CODES = new Set(['auth/invalid-custom-token', 'auth/custom-token-mismatch']);

/**
 * Signs in with the token minted at verification time and creates the
 * account documents. Sign-in is deferred to here, as before, so an abandoned
 * sign-up never leaves a half-made account behind.
 */
export const completeSignup = async (params: SignupParams): Promise<void> => {
  let uid: string;
  try {
    const credential = await signInWithCustomToken(auth, params.token);
    uid = credential.user.uid;
  } catch (error: any) {
    if (EXPIRED_TOKEN_CODES.has(error?.code)) throw new SignupExpiredError();
    throw error;
  }
  setDebugContext({ userId: uid });

  // The phone number is private, so it goes to /user_private rather than the
  // world-readable profile document.
  await savePrivateUserData(uid, { phoneNumber: params.phone });

  await setDoc(doc(db, 'users', uid), {
    // Security rules require uid to match the document id.
    uid,
    username: params.name,
    nickname: params.nickname || params.name,
    age: params.dob,
    gender: params.gender,
    country: params.country || '',
    state: params.state || '',
    city: params.city || '',
    language: params.language || '',
    avatar3dUrl: 'CUSTOM_BUILDER_AVATAR',
    avatarData: params.avatar,
    coins: 500,
    hearts: 0,
    respectBadges: 0,
    unrewardedCallSeconds: 0,
    totalReceivedCallSeconds: 0,
    isActiveMode: true,
    isOnline: true,
    isSessionActive: true,
    lastActive: serverTimestamp(),
    createdAt: serverTimestamp(),
  });
  logDebugEvent('auth.signup.completed', { uid });

  // Prime mic/camera permissions now, before the first call needs them.
  // Best-effort: CallScreen still gates on the mic permission itself.
  if (Platform.OS === 'android') {
    PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      PermissionsAndroid.PERMISSIONS.CAMERA,
    ]).catch(() => {});
  }
};
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/services/smsAuthService.ts src/services/signupService.ts
git commit -m "Add app services for SMS sign-in and sign-up completion

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: `VerifyBySmsScreen`

**Files:**
- Create: `src/screens/VerifyBySmsScreen.tsx`
- Modify: `package.json`, `package-lock.json` (via `npx expo install`)

**Interfaces:**
- Consumes: Task 6 `startSmsVerification`, `pollSmsVerification`, `signInWithSmsToken`, `SmsAuthError`, `SmsSession`; `useActionLock` from `src/hooks/useActionLock.ts`; `ScreenShell` from `src/components/ScreenShell`.
- Produces: default export `VerifyBySmsScreen({ navigate, goBack, route })` with `route.params.phone` in E.164. On success it navigates to `ProfileDetails` with `{ phone, token }` (new users) or signs in (existing users; `App.tsx`'s `onAuthStateChanged` then resets to Home).

- [ ] **Step 1: Install the native modules**

Run: `npx expo install expo-sms expo-clipboard`
Expected: both added to `package.json` at SDK-56-compatible versions.

Both are native modules: they need a new development/production build (`npm run build:dev` or `npm run build:preview`). An OTA `eas update` cannot deliver them.

- [ ] **Step 2: Create the screen**

Create `src/screens/VerifyBySmsScreen.tsx`:

```tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as SMS from 'expo-sms';
import ScreenShell from '../components/ScreenShell';
import { useActionLock } from '../hooks/useActionLock';
import {
  pollSmsVerification,
  signInWithSmsToken,
  SmsAuthError,
  SmsSession,
  startSmsVerification,
} from '../services/smsAuthService';

const POLL_INTERVAL_MS = 2000;
const PLUM = '#5A155A';

type Phase = 'starting' | 'waiting' | 'expired' | 'error' | 'signingIn' | 'verified';

type Props = {
  navigate: (screen: string, params?: any) => void;
  goBack: () => void;
  route?: { params?: { phone?: string } };
};

const formatPhone = (p: string) => (p.length === 13 ? `${p.slice(0, 3)} ${p.slice(3, 8)} ${p.slice(8)}` : p);
const formatClock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export default function VerifyBySmsScreen({ navigate, goBack, route }: Props) {
  const phone = route?.params?.phone ?? '';
  const [phase, setPhase] = useState<Phase>('starting');
  const [session, setSession] = useState<SmsSession | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [notice, setNotice] = useState('');
  const [smsAvailable, setSmsAvailable] = useState(false);
  const [copied, setCopied] = useState(false);
  const { locked, run } = useActionLock();

  const sessionRef = useRef<SmsSession | null>(null);
  const deadlineRef = useRef(0);
  const pollInFlight = useRef(false);
  const finished = useRef(false);
  const newUserToken = useRef<string | null>(null);

  useEffect(() => {
    SMS.isAvailableAsync().then(setSmsAvailable).catch(() => setSmsAvailable(false));
  }, []);

  const begin = useCallback(
    () =>
      run(async () => {
        finished.current = false;
        newUserToken.current = null;
        setErrorMsg('');
        setNotice('');
        setPhase('starting');
        try {
          const s = await startSmsVerification(phone);
          sessionRef.current = s;
          deadlineRef.current = Date.now() + s.expiresIn * 1000;
          setSession(s);
          setSecondsLeft(s.expiresIn);
          setPhase('waiting');
        } catch (e) {
          sessionRef.current = null;
          setSession(null);
          setErrorMsg(e instanceof SmsAuthError ? e.message : 'Sign-in is temporarily unavailable.');
          setPhase('error');
        }
      }),
    [phone, run]
  );

  useEffect(() => {
    begin();
    // Start exactly once on mount; Try again calls begin() itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pollOnce = useCallback(async () => {
    const s = sessionRef.current;
    if (!s || pollInFlight.current || finished.current) return;
    if (Date.now() >= deadlineRef.current) {
      sessionRef.current = null;
      setPhase('expired');
      return;
    }
    pollInFlight.current = true;
    try {
      const result = await pollSmsVerification(s.sessionId);
      if (sessionRef.current !== s || finished.current) return;
      if (result.status === 'expired') {
        sessionRef.current = null;
        setPhase('expired');
      } else if (result.status === 'verified') {
        finished.current = true;
        sessionRef.current = null;
        if (result.isNewUser) {
          newUserToken.current = result.token;
          setPhase('verified');
          navigate('ProfileDetails', { phone, token: result.token });
        } else {
          setPhase('signingIn');
          try {
            // App.tsx's onAuthStateChanged resets the stack to Home.
            await signInWithSmsToken(result.token);
          } catch {
            finished.current = false;
            setErrorMsg('Could not finish signing in. Please try again.');
            setPhase('error');
          }
        }
      }
    } finally {
      pollInFlight.current = false;
    }
  }, [navigate, phone]);

  useEffect(() => {
    if (phase !== 'waiting') return;
    const poll = setInterval(pollOnce, POLL_INTERVAL_MS);
    const tick = setInterval(() => {
      setSecondsLeft(Math.max(0, Math.round((deadlineRef.current - Date.now()) / 1000)));
    }, 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [phase, pollOnce]);

  // The user leaves for the SMS app mid-flow, and JS timers can be suspended
  // in the background. Check the moment they come back instead of waiting.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') pollOnce();
    });
    return () => sub.remove();
  }, [pollOnce]);

  const openComposer = async () => {
    const s = sessionRef.current;
    if (!s) return;
    try {
      const { result } = await SMS.sendSMSAsync([s.gatewayNumber], s.message);
      setNotice(result === 'cancelled' ? 'SMS not sent. Tap Send SMS to try again.' : '');
      pollOnce();
    } catch {
      setNotice('Could not open your SMS app. Send the text below yourself.');
    }
  };

  const copyMessage = async () => {
    if (!session) return;
    await Clipboard.setStringAsync(session.message);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <ScreenShell tone="light">
      <View style={styles.container}>
        <Pressable onPress={goBack} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Go back">
          <MaterialIcons name="arrow-back" size={24} color={PLUM} />
        </Pressable>

        <Text style={styles.title}>Verify your number</Text>
        <Text style={styles.subtitle}>
          Send one SMS from {formatPhone(phone)} to confirm it's yours.
        </Text>

        {phase === 'starting' && <ActivityIndicator color={PLUM} style={styles.spinner} />}

        {phase === 'waiting' && session && (
          <View>
            <View style={styles.card}>
              <Text style={styles.label}>Text this</Text>
              <View style={styles.codeRow}>
                <Text style={styles.code} selectable accessibilityLabel={`Message ${session.message}`}>
                  {session.message}
                </Text>
                <Pressable onPress={copyMessage} accessibilityRole="button" accessibilityLabel="Copy message">
                  <MaterialIcons name={copied ? 'check' : 'content-copy'} size={22} color={PLUM} />
                </Pressable>
              </View>
              {session.gatewayNumber ? (
                <>
                  <Text style={styles.label}>To</Text>
                  <Text style={styles.to} selectable>{formatPhone(session.gatewayNumber)}</Text>
                </>
              ) : null}
            </View>

            {smsAvailable && session.gatewayNumber ? (
              <Pressable onPress={openComposer} style={styles.primaryBtn} accessibilityRole="button">
                <MaterialIcons name="sms" size={20} color="#fff" />
                <Text style={styles.primaryText}>Send SMS</Text>
              </Pressable>
            ) : (
              <Text style={styles.hint}>
                From the phone with this SIM, text the message above to the number shown.
              </Text>
            )}

            {notice ? <Text style={styles.notice}>{notice}</Text> : null}

            <View style={styles.waitRow}>
              <ActivityIndicator color={PLUM} />
              <Text style={styles.waitText}>Waiting for your SMS… {formatClock(secondsLeft)}</Text>
            </View>
            <Text style={styles.fine}>Your operator's standard SMS charge may apply.</Text>
          </View>
        )}

        {phase === 'signingIn' && (
          <View style={styles.waitRow}>
            <ActivityIndicator color={PLUM} />
            <Text style={styles.waitText}>Signing you in…</Text>
          </View>
        )}

        {phase === 'verified' && (
          <Pressable
            onPress={() => navigate('ProfileDetails', { phone, token: newUserToken.current })}
            style={styles.primaryBtn}
            accessibilityRole="button"
          >
            <MaterialIcons name="check-circle" size={20} color="#fff" />
            <Text style={styles.primaryText}>Number verified — Continue</Text>
          </Pressable>
        )}

        {(phase === 'expired' || phase === 'error') && (
          <View>
            <Text style={styles.error}>
              {phase === 'expired' ? 'That code expired before your SMS arrived.' : errorMsg}
            </Text>
            <Pressable onPress={begin} disabled={locked} style={[styles.primaryBtn, locked && styles.disabled]} accessibilityRole="button">
              <Text style={styles.primaryText}>Try again</Text>
            </Pressable>
          </View>
        )}

        <Pressable onPress={goBack} accessibilityRole="button">
          <Text style={styles.link}>Wrong number? Change it</Text>
        </Pressable>
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24, paddingTop: 16 },
  backBtn: { width: 44, height: 44, justifyContent: 'center' },
  title: { fontSize: 26, fontWeight: '800', color: PLUM, marginTop: 8 },
  subtitle: { fontSize: 15, color: '#4B3B4B', marginTop: 6, marginBottom: 20 },
  spinner: { marginTop: 32 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 18, marginBottom: 16, borderWidth: 1, borderColor: '#EADCEA' },
  label: { fontSize: 12, fontWeight: '700', color: '#8A6F8A', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 6 },
  codeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 6 },
  code: { fontSize: 28, fontWeight: '800', color: PLUM, letterSpacing: 2 },
  to: { fontSize: 18, fontWeight: '600', color: '#2B1B2B', marginTop: 4 },
  primaryBtn: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: PLUM, borderRadius: 14, paddingVertical: 14, marginTop: 8 },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  disabled: { opacity: 0.6 },
  hint: { fontSize: 14, color: '#4B3B4B', marginTop: 4 },
  notice: { fontSize: 13, color: '#B45309', marginTop: 10, textAlign: 'center' },
  waitRow: { flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center', marginTop: 22 },
  waitText: { fontSize: 15, color: '#4B3B4B' },
  fine: { fontSize: 12, color: '#8A6F8A', textAlign: 'center', marginTop: 10 },
  error: { fontSize: 15, color: '#DC2626', marginBottom: 8, textAlign: 'center' },
  link: { fontSize: 14, color: PLUM, textAlign: 'center', marginTop: 24, textDecorationLine: 'underline' },
});
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (The screen is not wired into navigation until Task 8.)

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/screens/VerifyBySmsScreen.tsx
git commit -m "Add the verify-by-SMS screen

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Wire the new flow and delete the old screens

**Files:**
- Modify: `src/screens/PhoneScreen.tsx`
- Modify: `src/screens/FinalizeInviteScreen.tsx`
- Modify: `App.tsx`
- Modify: `src/services/authService.ts`
- Delete: `src/screens/OtpScreen.tsx`, `src/screens/CreatePasswordScreen.tsx`, `src/screens/LoginPasswordScreen.tsx`, `src/screens/ForgotPasswordScreen.tsx`

**Interfaces:**
- Consumes: `VerifyBySmsScreen` (Task 7); `completeSignup`, `SignupExpiredError` (Task 6).
- Produces: Phone → VerifyBySms → (new) ProfileDetails → FinalizeInvite → Home, or (existing) Home.

- [ ] **Step 1: PhoneScreen — India only, straight to VerifyBySms**

In `src/screens/PhoneScreen.tsx`:

1. Replace the import `import { sendOTP, checkUserExists } from '../services/authService';` — delete it (nothing from authService is needed).
2. Replace the whole `COUNTRY_CODES` array with:
   ```ts
   // Reverse-OTP sign-in only accepts Indian mobiles: the gateway SIM is Indian
   // and the backend rejects every other sender. Add a country back only with a
   // gateway that can receive from it.
   const COUNTRY_CODES = [
     { country: 'India', code: '+91', iso: 'IN', min: 10, max: 10 },
   ];
   ```
3. Delete `export let globalAuthMode: 'signup' | 'login' = 'signup';`, the `authMode` state line, and the `useEffect` that assigns `globalAuthMode = authMode;`.
4. Replace `const isPhoneComplete = ...` with:
   ```ts
   const isPhoneComplete = phone.length >= selectedCountry.min && phone.length <= selectedCountry.max;
   const isValidMobile = /^[6-9]\d{9}$/.test(phone);
   ```
5. Replace the whole `handleContinue` function with:
   ```ts
   const handleContinue = () => {
     if (!isPhoneComplete) return;
     if (!isValidMobile) {
       setErrorMsg('Enter a valid Indian mobile number starting with 6, 7, 8 or 9.');
       return;
     }
     setErrorMsg('');
     navigate('VerifyBySms', { phone: countryCode + phone });
   };
   ```
6. In the keyboard `useEffect`'s dependency array, remove `authMode` so it reads `[phone, isLoading, countryCode, countryIso]`.

`isLoading` and `setIsLoading` remain declared and used by the existing button spinner; leave them.

- [ ] **Step 2: FinalizeInvite — finish sign-up in place**

In `src/screens/FinalizeInviteScreen.tsx`:

1. Add imports below `import { getUserProfile, saveUserProfile } from '../services/userService';`:
   ```ts
   import { completeSignup, SignupExpiredError } from '../services/signupService';
   import { useActionLock } from '../hooks/useActionLock';
   ```
2. Directly after the line `const { params } = route || {};`, add:
   ```ts
   const { run: runSignupOnce } = useActionLock();
   ```
3. Replace
   ```ts
            } else {
              navigate('CreatePassword', { ...params, avatar: avatarData });
            }
   ```
   with
   ```ts
            } else {
              await runSignupOnce(async () => {
                try {
                  await completeSignup({ ...params, avatar: avatarData });
                  navigate('Home');
                } catch (error: any) {
                  if (error instanceof SignupExpiredError) {
                    Alert.alert('Verification expired', error.message);
                    navigate('Phone', { phone: params?.phone });
                  } else {
                    Alert.alert('Sign-up failed', error?.message || 'Could not create your account. Please try again.');
                  }
                }
              });
            }
   ```

- [ ] **Step 3: App.tsx registry**

In `App.tsx`:
1. Delete the four imports:
   ```ts
   import OtpScreen from './src/screens/OtpScreen';
   import CreatePasswordScreen from './src/screens/CreatePasswordScreen';
   import ForgotPasswordScreen from './src/screens/ForgotPasswordScreen';
   import LoginPasswordScreen from './src/screens/LoginPasswordScreen';
   ```
2. Add, next to the `PhoneScreen` import:
   ```ts
   import VerifyBySmsScreen from './src/screens/VerifyBySmsScreen';
   ```
3. Replace the `Otp:` registry line with:
   ```ts
     VerifyBySms: ({ navigate, goBack, params }: ScreenContext) => <VerifyBySmsScreen navigate={navigate} goBack={goBack} route={{ params }} />,
   ```
4. Delete the three registry lines `CreatePassword:`, `ForgotPassword:` and `LoginPassword:`.

- [ ] **Step 4: Delete the old screens**

```bash
git rm src/screens/OtpScreen.tsx src/screens/CreatePasswordScreen.tsx src/screens/LoginPasswordScreen.tsx src/screens/ForgotPasswordScreen.tsx
```

- [ ] **Step 5: Trim authService**

In `src/services/authService.ts`, delete these exported functions, each from its `export const …` line through its closing `};`:
- `saveAuthSession`
- `restoreAuthSession`
- `sendOTP`
- `checkUserExists`
- `verifyOTP`
- `loginWithPassword`
- `setAccountPassword`

Keep `clearAuthSession` (Settings and `logout` call it to clear the legacy stored phone), `getBackendUrl`, `authedPost`, `authedGet`, `checkUsernameAvailable`, `purgeAccountData` and `logout`.

Then remove helpers and imports that are now unused:

Run: `grep -nE "secureSet|secureGet|secureDelete|signInWithCustomToken|\bUser\b|safeParseJson" src/services/authService.ts`

Delete any helper or import in that output that has only its own definition/import line left (e.g. `secureSet`, `secureGet`; `signInWithCustomToken`, `User` in the `firebase/auth` import). Keep `secureDelete` (used by `clearAuthSession`) and `safeParseJson` if `checkUsernameAvailable` still uses it.

- [ ] **Step 6: Nothing else may reference the removed pieces**

Run: `grep -rnE "OtpScreen|CreatePassword|LoginPassword|ForgotPassword|sendOTP|verifyOTP|checkUserExists|loginWithPassword|setAccountPassword|saveAuthSession|restoreAuthSession|globalAuthMode|'Otp'" src App.tsx`
Expected: no output.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add -A src App.tsx
git commit -m "Switch sign-up and login to reverse OTP; remove password screens

Phone -> VerifyBySms -> Home for existing accounts, or -> ProfileDetails ->
FinalizeInvite for new ones, which now creates the account itself.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Staging deploy and end-to-end verification (owner-assisted)

This task needs the owner's hands: pushing the branch, the gateway phone, a device build, and a real SIM. Do each step with them; do not push or build without their go-ahead.

**Files:** none changed; operational.

- [ ] **Step 1: Final automated checks**

Run: `cd backend && python -m pytest -q` → all pass.
Run: `npx tsc --noEmit` → no errors.

- [ ] **Step 2: Push the branch (owner approval required)**

```bash
git push -u origin feature/reverse-otp-sms
```

- [ ] **Step 3: Redeploy the backend on the server**

Over SSH to `ubuntu@129.225.117.93` (key `~/.ssh/oracle_gengal.key`). Do **not** run `setup-oracle.sh` (it overwrites certbot's nginx config).

```bash
/opt/gengal/venv/bin/waitress-serve --help | grep -E "trusted-proxy|clear-untrusted"
```
Expected: lines for `--trusted-proxy`, `--trusted-proxy-headers`, `--clear-untrusted-proxy-headers`. If any is missing, stop.

```bash
sudo git -C /opt/gengal fetch --depth 1 origin feature/reverse-otp-sms
sudo git -C /opt/gengal reset --hard FETCH_HEAD
sudo /opt/gengal/venv/bin/pip install -q -r /opt/gengal/backend/requirements.txt
sudo chown -R gengal:gengal /opt/gengal
sudo install -m 0644 /opt/gengal/deploy/gengal-backend.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl restart gengal-backend
sudo journalctl -u gengal-backend -n 20 --no-pager
```
Expected: `Serving on http://127.0.0.1:5055`, and no `Unknown key name 'StartLimitIntervalSec'` warning.

- [ ] **Step 4: Set up the gateway phone and env**

Follow runbook §12 steps 1–7. Then set the two values:

```bash
sudo sed -i '/^SMS_GATEWAY_NUMBER=/d;/^SMS_GATEWAY_SIGNING_KEY=/d' /etc/gengal/gengal.env
echo 'SMS_GATEWAY_NUMBER=+91XXXXXXXXXX' | sudo tee -a /etc/gengal/gengal.env >/dev/null
echo 'SMS_GATEWAY_SIGNING_KEY=<key from the app>' | sudo tee -a /etc/gengal/gengal.env >/dev/null
sudo systemctl restart gengal-backend
```
(The owner types the real values; they must not be pasted into chat.)

- [ ] **Step 5: Gateway health**

Wait 70 seconds, then: `curl -s https://gengalapp.duckdns.org/api/v1/auth/sms/health`
Expected: `{"gateway":"online","lastSeenSecondsAgo":<60}` with HTTP 200.

- [ ] **Step 6: Legacy routes are gone in production**

Run: `curl -s -o /dev/null -w "%{http_code}\n" -X POST https://gengalapp.duckdns.org/api/v1/auth/login-password`
Expected: `404`.

- [ ] **Step 7: Build and sign up end to end**

Build a dev client (native modules were added): `npm run build:dev`, install it on a phone whose SIM is **not** the gateway SIM, with `EXPO_PUBLIC_BACKEND_URL=https://gengalapp.duckdns.org`.

1. Enter the phone's number → VerifyBySms shows `GENGAL nnnnnn` and the gateway number.
2. Tap **Send SMS**, send, return to the app → within ~5 s it moves to ProfileDetails.
3. Finish ProfileDetails and the avatar → lands on Home with 500 coins.
4. In Firestore, `auth_events` has one new document with `phoneMasked`, `isNewUser: true`, and an `ip` that is **not** `127.0.0.1` (proves the trusted-proxy fix).
5. `sudo journalctl -u gengal-backend | grep sms_verify` shows `outcome=started`, `outcome=verified` lines with masked numbers only.

- [ ] **Step 8: Log out and back in**

Settings → Log out → Phone → same number → Send SMS → lands on Home directly (existing user, no profile screens). A second `auth_events` document has `isNewUser: false`.

- [ ] **Step 9: Failure paths**

1. Turn the gateway phone's Wi-Fi off for 6 minutes → `/api/v1/auth/sms/health` returns 503 `offline`, and the app shows "SMS sign-in is down for a few minutes" at Continue. Turn Wi-Fi back on → `online` within a minute.
2. Start a sign-in and send the SMS from a *different* phone → the app keeps waiting and the log shows `outcome=sender_mismatch`.

- [ ] **Step 10: Uptime monitor**

Create a free UptimeRobot (or Better Stack) HTTP monitor on `https://gengalapp.duckdns.org/api/v1/auth/sms/health`, 5-minute interval, email alerts. Owner's account; owner creates it.
