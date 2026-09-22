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
    for name in ("WHATSAPP_NUMBER", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_APP_SECRET",
                 "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_VERIFY_TOKEN"):
        assert name + "=" in env
    for dead in ("ALLOW_LEGACY_PLAINTEXT_LOGIN", "TWILIO_", "FAST2SMS"):
        assert dead not in env


def test_rules_deny_clients_the_auth_audit_trail():
    rules = (ROOT / "firestore.rules").read_text(encoding="utf-8")
    block = rules.split("match /auth_events/{eventId}", 1)[1].split("}", 1)[0]
    assert "allow read, write: if false;" in block
