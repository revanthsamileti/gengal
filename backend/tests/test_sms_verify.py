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
