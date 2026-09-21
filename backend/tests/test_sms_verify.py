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
