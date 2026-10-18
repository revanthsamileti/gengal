from flask import Flask, request, jsonify
from flask_cors import CORS
import copy
import html
import json
import os
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass
import hashlib
import hmac
import math
import re
import secrets
import urllib.parse
import threading
import time
import sys
import traceback
import requests
from datetime import datetime, timedelta, timezone
from google.api_core.exceptions import Aborted as FirestoreAborted
import firebase_admin
from firebase_admin import credentials, auth, firestore, messaging
from agora_token_builder import RtcTokenBuilder
import push
import sms_verify
import whatsapp_verify

app = Flask(__name__)

def env_value(name):
    value = os.environ.get(name)
    return value.strip() if value else ""

def require_env(name):
    value = env_value(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def agora_numeric_uid(user_uid):
    """Stable 31-bit uid for Agora.

    Python randomises str hashing per process, so the previous hash() call
    produced a different channel uid after every server restart or on a second
    worker, which broke reconnects mid-call.
    """
    if str(user_uid).isdigit():
        return int(user_uid)
    digest = hashlib.sha256(str(user_uid).encode("utf-8")).hexdigest()
    return int(digest[:8], 16) & 0x7FFFFFFF


# agora_token_builder / RtcTokenBuilder role ints.
AGORA_ROLE_PUBLISHER = 1
AGORA_ROLE_SUBSCRIBER = 2
# Matches client PRESENCE_TTL_MS — host billing must not charge aged-out guests.
PRESENCE_STALE_SECONDS = 55
ROOM_DOC_COLLECTIONS = ('expert_rooms', 'chill_rooms', 'ludo_rooms')


def find_room_document(db_client, room_id):
    """Return (collection_name, room_dict) or (None, None) if unknown."""
    for name in ROOM_DOC_COLLECTIONS:
        snap = db_client.collection(name).document(room_id).get()
        if snap.exists:
            return name, snap.to_dict() or {}
    return None, None


def room_uid_is_speaker(room_collection, room, user_uid):
    """True when the uid may publish (on stage / seated / host-actor-guesser)."""
    if room_collection == 'expert_rooms':
        return any(
            (s or {}).get('uid') == user_uid for s in (room.get('speakers') or [])
        )
    if room_collection == 'ludo_rooms':
        uids = room.get('playerUids') or [
            (p or {}).get('uid') for p in (room.get('players') or [])
        ]
        # Watchers the host has handed a mic (/api/v1/ludo/speak).
        return user_uid in uids or user_uid in (room.get('micGuests') or {})
    if room_collection == 'chill_rooms':
        return user_uid in (
            room.get('hostUid'), room.get('actorUid'), room.get('guesserUid')
        )
    return False


def bearer_uid():
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None
    token = header.split(" ", 1)[1].strip()
    if not token:
        return None
    try:
        # Allow a minute of clock skew. Verification happens against this
        # machine's clock, so a server running slightly behind Google rejects
        # freshly minted tokens as "used too early".
        try:
            decoded = auth.verify_id_token(token, clock_skew_seconds=60)
        except TypeError:
            # Older firebase-admin without the parameter.
            decoded = auth.verify_id_token(token)
        return decoded.get("uid")
    except Exception as e:
        print(f"[AUTH] Invalid bearer token: {e}", flush=True)
        return None

def require_bearer_uid():
    uid = bearer_uid()
    if not uid:
        return None, (jsonify({"error": "Authentication required"}), 401)
    # An ID token stays valid for up to an hour after a ban disables the
    # account; this refuses it at once (see MODERATION).
    if uid in banned_uids():
        return None, (jsonify({"error": "This account has been suspended.", "code": "banned"}), 403)
    return uid, None

def admin_uids():
    raw = env_value("ADMIN_UIDS")
    return {part.strip() for part in raw.split(",") if part.strip()}

def require_admin_uid():
    """Admin access is granted by an explicit ADMIN_UIDS allowlist on the server.

    The client cannot self-assert this, which is what the previous
    client-side-only admin panel effectively allowed.
    """
    uid, error_response = require_bearer_uid()
    if error_response:
        return None, error_response
    if uid not in admin_uids():
        return None, (jsonify({"error": "Administrator privileges required"}), 403)
    return uid, None

# Simple in-process rate limiter. Adequate for a single worker; move to Redis
# before running more than one.
_rate_buckets = {}

def rate_limited(key, max_attempts, window_seconds):
    now = time.time()
    hits = [t for t in _rate_buckets.get(key, []) if now - t < window_seconds]
    if len(hits) >= max_attempts:
        _rate_buckets[key] = hits
        return True
    hits.append(now)
    _rate_buckets[key] = hits
    return False

def parse_positive_number(value, field_name):
    try:
        amount = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{field_name} must be a number")
    if amount <= 0:
        raise ValueError(f"{field_name} must be positive")
    return amount

# Initialize Firebase Admin
try:
    firebase_creds_file = env_value("FIREBASE_CREDENTIALS_FILE")
    firebase_creds_json = env_value("FIREBASE_CREDENTIALS_JSON")
    if firebase_creds_file:
        # Preferred on the server: systemd's EnvironmentFile strips the
        # backslashes out of an inline JSON value, corrupting the private key.
        cred = credentials.Certificate(firebase_creds_file)
    elif firebase_creds_json:
        # Load from environment variable (preferred; never stores credentials in git)
        cred = credentials.Certificate(json.loads(firebase_creds_json))
    else:
        # Fallback to serviceAccountKey.json for backwards compatibility
        cred = credentials.Certificate("serviceAccountKey.json")
    firebase_admin.initialize_app(cred)
    print("Firebase Admin initialized successfully.")
except Exception as e:
    print(f"Warning: Could not initialize Firebase Admin: {e}")


# Securely extract your credentials from the environment variables
AGORA_APP_ID = env_value("AGORA_APP_ID")
AGORA_APP_CERTIFICATE = env_value("AGORA_APP_CERTIFICATE")
# Secure server-side isolation of Zego credentials
ZEGO_APP_ID = int(os.environ.get("ZEGO_APP_ID", "0") or "0")
ZEGO_SERVER_SECRET = env_value("ZEGO_SERVER_SECRET")

# Scope CORS to explicitly configured origins in production.  For a native
# mobile app the risk of a wide-open policy is lower than for a web app —
# browsers never call these routes — but admin and debug endpoints still
# warrant the extra boundary.  Set CORS_ALLOWED_ORIGINS (comma-separated)
# to lock down; defaults to * (all origins) if unset.
_cors_origins = [o.strip() for o in env_value("CORS_ALLOWED_ORIGINS").split(",") if o.strip()]
CORS(app, origins=_cors_origins if _cors_origins else "*")


@app.errorhandler(Exception)
def unhandled_exception(e):
    """Catch-all: log the full traceback server-side, return a generic message.

    Without this, Flask in production mode returns a text/html 500 that may
    include internal file paths or partial exception messages.  A JSON body is
    also easier for the client to handle uniformly.
    """
    from werkzeug.exceptions import HTTPException
    if isinstance(e, HTTPException):
        # Standard HTTP errors (404, 405, etc.) go through Flask's normal path.
        return e
    import traceback
    print(f"[SERVER] Unhandled exception: {type(e).__name__}: {e}", flush=True)
    traceback.print_exc()
    return jsonify({"error": "An internal server error occurred"}), 500


DEBUG_LOG_FILE = os.path.join(os.path.dirname(__file__), "debug_events.log")
@app.route('/healthz', methods=['GET'])
def healthz():
    """Liveness probe. Deliberately does nothing.

    No auth, no Firestore, no environment reads -- it answers from the process
    itself, so a 200 means exactly one thing: this worker is up and serving.
    Anything heavier turns a monitor into a source of load, and on hosts that
    bill or rate-limit reads, into a source of cost.

    It exists because free hosts that idle a service out (Render and similar)
    only stay awake if something requests them, and an uptime monitor needs a
    URL that returns 200 -- every other route here either requires a bearer
    token or 404s, both of which a monitor reports as an outage.
    """
    return jsonify({"status": "ok"}), 200


# Privacy policy and terms, linked from Settings and the Play Store listing.
# Static files read once at import; SUPPORT_EMAIL is filled in at serve time.
_LEGAL_DIR = os.path.join(os.path.dirname(__file__), "legal")


def _legal_page(name):
    with open(os.path.join(_LEGAL_DIR, name), encoding="utf-8") as f:
        page = f.read()
    with open(os.path.join(_LEGAL_DIR, "_style.css"), encoding="utf-8") as f:
        page = page.replace("{{STYLE}}", f.read())
    return page


_LEGAL_PAGES = {
    "": _legal_page("home.html"),
    "privacy": _legal_page("privacy.html"),
    "terms": _legal_page("terms.html"),
}


# The homepage exists for Meta's WhatsApp business review and anyone following
# the app's links; the API itself lives under /api/v1.
@app.route('/', methods=['GET'])
@app.route('/privacy', methods=['GET'])
@app.route('/terms', methods=['GET'])
def legal_page():
    email = env_value("SUPPORT_EMAIL") or "gengal.app@gmail.com"
    page = _LEGAL_PAGES[request.path.strip('/')].replace("{{EMAIL}}", email)
    return page, 200, {"Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=3600"}



# Selfie classification pipeline removed

# Proxy endpoint for frontend console logs
def debug_logging_enabled():
    """Remote debug logging is a development tool and stays off by default.

    It accepts unauthenticated writes (auth failures have to stay diagnosable,
    which is the whole point) and appends them to a flat file that nothing
    rotates. In production that is an unbounded disk write reachable by anyone
    who can find the URL, so it has to be opted into explicitly.
    """
    return os.environ.get("ENABLE_REMOTE_DEBUG_LOG") == "true"


@app.route('/api/v1/debug/log', methods=['POST', 'OPTIONS'])
def debug_log():
    if request.method == 'OPTIONS':
        return '', 200

    if not debug_logging_enabled():
        return jsonify({"ok": False, "error": "Remote debug logging is disabled"}), 404

    # Unauthenticated writes are accepted only before sign-in so that auth
    # failures remain diagnosable, but they are rate limited per address.
    if rate_limited(f"debuglog:{request.remote_addr}", 60, 60):
        return jsonify({"ok": False, "error": "Too many log events"}), 429

    payload = request.get_json(silent=True) or {}
    event = {
        "serverReceivedAt": datetime.utcnow().isoformat() + "Z",
        "level": str(payload.get("level", "info"))[:20],
        "event": str(payload.get("event", "unknown"))[:120],
        "sessionId": payload.get("sessionId"),
        "userId": payload.get("userId"),
        # Deliberately not the phone number. The client sends one, but writing a
        # subscriber's number into an unrotated plaintext file is not something
        # a debug aid should be doing.
        "screen": payload.get("screen"),
        "platform": payload.get("platform"),
        "details": payload.get("details", {}),
    }

    try:
        with open(DEBUG_LOG_FILE, "a", encoding="utf-8") as log_file:
            log_file.write(json.dumps(event, ensure_ascii=False, default=str) + "\n")
        print(f"[RemoteDebug] {event['level']} {event['event']} user={event.get('userId')} session={event.get('sessionId')}", flush=True)
        return jsonify({"ok": True}), 200
    except Exception as e:
        print(f"[RemoteDebug] failed to write debug log: {e}", flush=True)
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route('/api/v1/debug/recent', methods=['GET'])
def debug_recent():
    # The debug log contains user ids and session ids, so it is admin-only.
    _, error_response = require_admin_uid()
    if error_response:
        return error_response

    try:
        limit = min(max(int(request.args.get("limit", 100)), 1), 500)
    except (TypeError, ValueError):
        return jsonify({"error": "limit must be an integer"}), 400

    if not os.path.exists(DEBUG_LOG_FILE):
        return jsonify({"events": []}), 200

    with open(DEBUG_LOG_FILE, "r", encoding="utf-8") as log_file:
        lines = log_file.readlines()[-limit:]

    events = []
    for line in lines:
        try:
            events.append(json.loads(line))
        except Exception:
            pass
    return jsonify({"events": events}), 200

@app.route('/api/v1/agora/generate-token', methods=['POST', 'OPTIONS'])
def generate_agora_token():
    if request.method == 'OPTIONS':
        return '', 200
        
    # A token grants channel access, so the caller must prove who they are and
    # can only mint for their own uid — and only for a room/call they belong to.
    authed_uid, error_response = require_bearer_uid()
    if error_response:
        return error_response

    try:
        data = request.json or {}
        room_id = data.get('roomId')
        user_uid = authed_uid
        # Client may still send `role`; privilege is derived server-side only.

        if not room_id:
            return jsonify({"error": "Missing mandatory roomId parameter"}), 400
        if not AGORA_APP_ID or not AGORA_APP_CERTIFICATE:
            return jsonify({"error": "Agora credentials are not configured"}), 503

        db_client = firestore.client()
        role = AGORA_ROLE_SUBSCRIBER

        call_snap = db_client.collection('calls').document(room_id).get()
        if call_snap.exists:
            call = call_snap.to_dict() or {}
            if user_uid not in (call.get('callerUid'), call.get('receiverUid')):
                return jsonify({"error": "Not a participant in this call"}), 403
            if call.get('status') == 'ended':
                # Carries a code because the app has to tell this apart from a
                # real connection failure. The receiver of a call the caller
                # hung up mid-ring lands here, and showing them "connection
                # failed" blames the network for an ordinary cancelled call.
                return jsonify({"error": "Call has ended", "code": "call_ended"}), 403
            role = AGORA_ROLE_PUBLISHER
        else:
            room_collection, room = find_room_document(db_client, room_id)
            if room is None:
                return jsonify({"error": "Unknown room"}), 404
            if room.get('status') == 'closed':
                return jsonify({"error": "Room is closed"}), 403

            is_host = user_uid == room.get('hostUid')
            is_speaker = room_uid_is_speaker(room_collection, room, user_uid)

            # Presence membership gates tokens. Hosts and seated speakers may
            # mint before their heartbeat doc lands; listeners need members/{uid}.
            member_exists = (
                db_client.collection(room_collection)
                .document(room_id)
                .collection('members')
                .document(user_uid)
                .get()
                .exists
            )
            if not (is_host or is_speaker or member_exists):
                return jsonify({"error": "Not a member of this room"}), 403

            role = (
                AGORA_ROLE_PUBLISHER
                if (is_host or is_speaker)
                else AGORA_ROLE_SUBSCRIBER
            )

        expiration_time_in_seconds = 7200
        privilege_expired_ts = int(time.time()) + expiration_time_in_seconds
        numeric_uid = agora_numeric_uid(user_uid)

        token = RtcTokenBuilder.buildTokenWithUid(
            AGORA_APP_ID,
            AGORA_APP_CERTIFICATE,
            room_id,
            numeric_uid,
            role,
            privilege_expired_ts,
        )

        return jsonify({
            "token": token,
            "uid": numeric_uid,
            "role": "broadcaster" if role == AGORA_ROLE_PUBLISHER else "audience",
            "expiresIn": expiration_time_in_seconds,
        }), 200

    except Exception as e:
        print(f"[Agora Token Generation Error]: {str(e)}")
        return jsonify({"error": "Internal Token Server Exception"}), 500

def make_zego_token(app_id, server_secret, user_id, expiry_seconds=7200):
    """Generates an explicit, low-latency client access token for Zego Express rooms."""
    create_time = int(time.time())
    expire_time = create_time + expiry_seconds
    
    # Structure payload elements matching Zego's signature token requirements
    payload = {
        'app_id': app_id,
        'user_id': str(user_id),
        'provided_timestamp': create_time,
        'expire_time': expire_time,
        'nonce': int(time.time() * 1000)
    }
    
    # Pack data structure using hmac-sha256 signing algorithms
    json_payload = json.dumps(payload)
    import hmac
    import hashlib
    signature = hmac.new(
        server_secret.encode('utf-8'), 
        json_payload.encode('utf-8'), 
        hashlib.sha256
    ).hexdigest()
    
    # Final format serialization
    token_bytes = json.dumps({
        'ver': 1,
        'body': json_payload,
        'hash': signature
    })
    import base64
    return base64.b64encode(token_bytes.encode('utf-8')).decode('utf-8')

@app.route('/api/v1/zego/generate-token', methods=['POST', 'OPTIONS'])
def generate_zego_token():
    if request.method == 'OPTIONS':
        return '', 200

    authed_uid, error_response = require_bearer_uid()
    if error_response:
        return error_response

    try:
        data = request.json or {}
        room_id = data.get('roomId')
        user_uid = authed_uid

        if not room_id:
            return jsonify({"error": "Missing mandatory roomId field"}), 400
        if not ZEGO_APP_ID or not ZEGO_SERVER_SECRET:
            return jsonify({"error": "Zego credentials are not configured"}), 503

        # Calculate a valid dynamic token string locked strictly to this user session
        generated_token = make_zego_token(ZEGO_APP_ID, ZEGO_SERVER_SECRET, user_uid)

        return jsonify({
            "token": generated_token,
            "appId": ZEGO_APP_ID,
            "userId": str(user_uid)
        }), 200

    except Exception as e:
        print(f"[Zego Token Authority Fault]: {str(e)}")
        return jsonify({"error": "Internal Token Server Exception"}), 500


# ==========================================
# AUTHENTICATION ROUTES
# ==========================================

# ------------------------------------------
# Reverse-OTP sign-in (user texts a code from their own phone)
# Design: docs/superpowers/specs/2026-09-21-reverse-otp-sms-design.md
# ------------------------------------------

# In memory and per-process, like the rate limiter: the gateway webhook and the
# app's poll must land on the same process. Single waitress process only.
sms_sessions = sms_verify.SessionStore()
sms_gateway = sms_verify.GatewayHealth()
whatsapp_shares = whatsapp_verify.PendingShares()

WHATSAPP_SETTINGS = ("WHATSAPP_NUMBER", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_APP_SECRET",
                     "WHATSAPP_VERIFY_TOKEN", "WHATSAPP_ACCESS_TOKEN")


def whatsapp_configured():
    """WhatsApp is offered only when every setting is present; half a setup
    would accept messages it can never answer."""
    return all(env_value(name) for name in WHATSAPP_SETTINGS)


def client_ip():
    return request.remote_addr or "unknown"


def log_sms(outcome, phone=None):
    """One grep-able line per outcome; never a full number or a code."""
    masked = sms_verify.mask_phone(phone) if phone else "-"
    print(f"[AUTH] sms_verify outcome={outcome} phone={masked}", flush=True)


def channel_status():
    """(channels, sms_configured, gateway_health): what can take a code right now.

    Shared by start and status so the two cannot disagree: the gateway phone
    can die while somebody is already waiting, and the screen can only move
    them to WhatsApp if every poll reports what is still up.
    """
    sms_configured = bool(env_value("SMS_GATEWAY_NUMBER") and env_value("SMS_GATEWAY_SIGNING_KEY"))
    health, _ = sms_gateway.status()
    sms_up = sms_configured and health not in ("offline", "misconfigured")
    # WhatsApp lands on Meta's servers, not on the gateway phone, so it keeps
    # sign-in working while that phone is down.
    channels = (["whatsapp"] if whatsapp_configured() else []) + (["sms"] if sms_up else [])
    return channels, sms_configured, health


def note_sms_hint(raw_sender, text, hint, received_at=None):
    """Tell the waiting app why an SMS that did reach us did not sign it in.

    Matching on the code is exact; falling back to the sender covers the case
    where the code is what was unreadable. Without this a dropped SMS was only
    ever a log line, and the app spun until the session expired.
    """
    code = sms_verify.parse_code(text)
    if code and sms_sessions.note_hint(code, hint, received_at) == "ok":
        return
    sender = sms_verify.normalize_in_mobile(raw_sender)
    if sender:
        sms_sessions.note_hint_for_phone(sender, hint)


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
    channels, sms_configured, health = channel_status()
    sms_up = "sms" in channels
    if sms_configured and not sms_up:
        log_sms("gateway_" + health, phone)
    if not dev_bypass and not channels:
        if not sms_configured:
            return jsonify({"error": "SMS sign-in is not configured", "code": "sms_not_configured"}), 503
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
        # Empty when SMS is not on offer, so no build tells a user to text a dead phone.
        "gatewayNumber": gateway_number if (sms_up or dev_bypass) else "",
        "whatsappNumber": env_value("WHATSAPP_NUMBER") if "whatsapp" in channels else "",
        "channels": channels,
        # Configured but unreachable, so the screen can say "down for a few
        # minutes" rather than implying SMS was never on offer here.
        "smsOffline": sms_configured and not sms_up,
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
    accept_sms(
        payload.get("sender") or payload.get("phoneNumber"),
        payload.get("message"),
        sms_verify.parse_received_at(payload.get("receivedAt")),
    )
    return ok


def accept_sms(raw_sender, text, received_at):
    """Shared by every gateway adapter: match an inbound SMS to a live session."""
    sender = sms_verify.normalize_in_mobile(raw_sender)
    code = sms_verify.parse_code(text)
    if not sender or not code:
        log_sms("unparseable", sender)
        # An alphanumeric sender id is a bank or operator texting the gateway,
        # not a user: there is nobody waiting to tell.
        if sender:
            sms_sessions.note_hint_for_phone(sender, "no_code")
        return
    log_sms(sms_sessions.mark_verified(code, sender, received_at), sender)


@app.route('/api/v1/auth/sms/forwarder', methods=['POST'])
def sms_forwarder_inbound():
    """Webhook from "SMS to URL Forwarder" (tech.bogomolov.incomingsmsgateway).

    The app signs lowercase hex(HMAC-SHA256(key, body)) in X-Signature and sends
    its default template: from, text, sentStamp, receivedStamp (epoch ms), sim.
    """
    raw = request.get_data(cache=True)
    if not sms_verify.verify_body_signature(
        raw, request.headers.get("X-Signature"), env_value("SMS_GATEWAY_SIGNING_KEY")
    ):
        log_sms("bad_signature")
        return jsonify({"error": "invalid signature"}), 401

    sms_gateway.seen()
    ok = (jsonify({"ok": True}), 200)
    try:
        payload = json.loads(raw or b"{}")
    except ValueError:
        log_sms("bad_payload")
        return ok
    if not isinstance(payload, dict):
        log_sms("bad_payload")
        return ok

    received_at = (sms_verify.epoch_millis_to_seconds(payload.get("receivedStamp"))
                   or sms_verify.epoch_millis_to_seconds(payload.get("sentStamp")))

    # A retry resends the identical body, so its hash identifies the delivery.
    # Checked before the SIM gate so a retry cannot re-hint a session either.
    if sms_sessions.seen_delivery("fwd:" + hashlib.sha256(raw).hexdigest()):
        log_sms("duplicate")
        return ok

    # Users are told to text one SIM's number; an SMS landing on the phone's
    # other SIM must not count, or the advertised number would not be the only
    # way in. It does get a hint: the message reached us, and leaving the app
    # to time out on a text we deliberately dropped is the worst of both.
    wanted_sim = env_value("SMS_GATEWAY_SIM").lower()
    sim = str(payload.get("sim") or "").lower()
    if wanted_sim and sim != wanted_sim:
        log_sms(f"wrong_sim:{sim or '-'}")
        note_sms_hint(payload.get("from"), payload.get("text"), "wrong_sim", received_at)
        return ok

    accept_sms(payload.get("from"), payload.get("text"), received_at)
    return ok


@app.route('/api/v1/auth/sms/heartbeat/<token>', methods=['POST', 'GET'])
def sms_heartbeat(token):
    """The forwarder's heartbeat is an unsigned, empty POST, so it authenticates
    with a URL token. The token is separate from the signing key on purpose: a
    leaked heartbeat URL can at worst fake 'online', never an SMS."""
    expected = env_value("SMS_GATEWAY_HEARTBEAT_TOKEN")
    if not expected or not hmac.compare_digest(token.encode("utf-8"), expected.encode("utf-8")):
        return jsonify({"error": "not found"}), 404
    sms_gateway.seen()
    return jsonify({"ok": True}), 200


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
        channels, sms_configured, _ = channel_status()
        info = sms_sessions.info(session_id) or {}
        pending = {"status": "pending", "expiresIn": value, "channels": channels,
                   "smsOffline": sms_configured and "sms" not in channels,
                   # A message reached us and did not sign them in: the screen
                   # shows that as its own step rather than going on waiting.
                   "received": bool(info.get("received"))}
        if info.get("hint"):
            pending["hint"] = info["hint"]
        return jsonify(pending), 200

    phone = value
    uid = f"fast2sms:{phone}"
    channel = (sms_sessions.info(session_id) or {}).get("channel")
    # Look up and mint BEFORE consuming, so a Firestore or token failure leaves
    # the session verified and the app's next poll can simply retry.
    try:
        user_snap = firestore.client().collection('users').document(uid).get()
        is_new_user = not user_snap.exists
    except Exception as e:
        print(f"[AUTH] sms status users lookup failed: {e}", flush=True)
        log_sms("lookup_failed", phone)
        return jsonify({"error": "Temporarily unavailable", "code": "lookup_failed"}), 503
    if user_snap.exists and (user_snap.to_dict() or {}).get('banned'):
        log_sms("banned", phone)
        return jsonify({"error": "This account has been suspended.", "code": "banned"}), 403
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
            "method": "reverse_whatsapp" if channel == "whatsapp" else "reverse_sms",
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
    # The status code tracks the SMS gateway alone: WhatsApp covering for a dead
    # gateway phone must not hide that the phone needs attention.
    return jsonify({
        "gateway": state,
        "lastSeenSecondsAgo": age,
        "whatsapp": "configured" if whatsapp_configured() else "off",
    }), (200 if state in ("online", "starting") else 503)


# ------------------------------------------
# Reverse-OTP over WhatsApp (Meta Cloud API webhook)
# Design: docs/superpowers/specs/2026-09-22-reverse-otp-whatsapp-design.md
# ------------------------------------------

def log_wa(outcome, phone=None):
    """Like log_sms: never a full number, a code, a user id or message text."""
    masked = sms_verify.mask_phone(phone) if phone else "-"
    print(f"[AUTH] wa_verify outcome={outcome} phone={masked}", flush=True)


def post_whatsapp_message(message):
    """One Graph API send. Failures are logged, never raised: a reply is a
    courtesy, and the sign-in it confirms has already happened."""
    url = (f"https://graph.facebook.com/{whatsapp_verify.GRAPH_API_VERSION}/"
           f"{env_value('WHATSAPP_PHONE_NUMBER_ID')}/messages")
    try:
        response = requests.post(url, json=message, timeout=5, headers={
            "Authorization": f"Bearer {env_value('WHATSAPP_ACCESS_TOKEN')}"})
        if not response.ok:
            print(f"[AUTH] WhatsApp reply rejected: HTTP {response.status_code} {response.text[:300]}", flush=True)
            log_wa("reply_failed")
    except requests.RequestException as e:
        print(f"[AUTH] WhatsApp reply failed: {type(e).__name__}", flush=True)
        log_wa("reply_failed")


def send_whatsapp_message(message):
    """Off the request thread: Meta retries a webhook that answers slowly, and a
    slow Graph API must not turn one message into several."""
    threading.Thread(target=post_whatsapp_message, args=(message,), daemon=True).start()


def reply_on_whatsapp(inbound, outcome):
    reply_to = inbound["reply_to"]
    if not reply_to or outcome not in whatsapp_verify.REPLIES:
        return
    # A sender who keeps messaging gets at most five answers per 10 minutes.
    sender_key = reply_to.get("to") or reply_to.get("recipient")
    if rate_limited("wa-reply:" + hashlib.sha256(sender_key.encode("utf-8")).hexdigest(), 5, 600):
        return
    body = whatsapp_verify.REPLIES[outcome]
    if outcome == "share_number":
        send_whatsapp_message(whatsapp_verify.share_number_request(reply_to, body))
    else:
        send_whatsapp_message(whatsapp_verify.text_reply(reply_to, body))


def accept_whatsapp(inbound):
    """Match one inbound WhatsApp message to a session; returns the outcome."""
    if inbound["kind"] == "contact_share":
        held = whatsapp_shares.take(inbound["user_id"])
        if not held:
            return "unrequested_share"
        return sms_sessions.mark_verified(held["code"], inbound["phone"], held["received_at"], channel="whatsapp")
    if inbound["kind"] != "text":
        return "ignored"
    code = sms_verify.parse_code(inbound["text"])
    if not code:
        return "no_code"
    if inbound["phone"]:
        return sms_sessions.mark_verified(code, inbound["phone"], inbound["sent_at"], channel="whatsapp")
    if not inbound["number_hidden"]:
        return "unsupported_number"
    if not inbound["user_id"]:
        return "ignored"
    # The sender hid their number behind a WhatsApp username: hold the code and
    # ask them to share the number with Meta's button.
    outcome = sms_sessions.note_hint(code, "share_number", inbound["sent_at"])
    if outcome != "ok":
        return outcome
    whatsapp_shares.hold(inbound["user_id"], code, inbound["sent_at"])
    return "share_number"


@app.route('/api/v1/auth/whatsapp/webhook', methods=['GET', 'POST'])
def whatsapp_webhook():
    if request.method == 'GET':
        # Meta's one-time subscription handshake.
        expected = env_value("WHATSAPP_VERIFY_TOKEN")
        given = request.args.get("hub.verify_token") or ""
        if (request.args.get("hub.mode") == "subscribe" and expected
                and hmac.compare_digest(given.encode("utf-8"), expected.encode("utf-8"))):
            return request.args.get("hub.challenge") or "", 200, {"Content-Type": "text/plain"}
        return jsonify({"error": "forbidden"}), 403

    raw = request.get_data(cache=True)
    if not whatsapp_verify.verify_meta_signature(
        raw, request.headers.get("X-Hub-Signature-256"), env_value("WHATSAPP_APP_SECRET")
    ):
        log_wa("bad_signature")
        return jsonify({"error": "invalid signature"}), 401

    # From here on always 200: Meta retries anything else for 36 hours.
    ok = (jsonify({"ok": True}), 200)
    try:
        payload = json.loads(raw or b"{}")
    except ValueError:
        log_wa("bad_payload")
        return ok

    for inbound in whatsapp_verify.parse_webhook(payload, env_value("WHATSAPP_PHONE_NUMBER_ID")):
        if not inbound["id"] or sms_sessions.seen_delivery("wa:" + inbound["id"]):
            log_wa("duplicate")
            continue
        outcome = accept_whatsapp(inbound)
        log_wa(outcome, inbound["phone"])
        reply_on_whatsapp(inbound, outcome)
    return ok


@app.route('/api/v1/auth/delete-account', methods=['POST', 'OPTIONS'])
def delete_account():
    """Removes every trace of an account, server-side.

    /user_credentials is closed to all client access, so without this the
    password hash outlived the account.

    The public profile is deleted here too, not left to the client. The client's
    delete was the last write before `deleteUser()` invalidated its credential,
    and if it failed the profile survived in the directory with no owner left to
    remove it — the rules only permit the owner. Doing it through the Admin SDK
    makes that unreachable.

    Partial failures are reported rather than swallowed: the caller deletes the
    auth record next, and it must not do that while data is still lying around.
    """
    if request.method == 'OPTIONS':
        return '', 200
    uid, error_response = require_bearer_uid()
    if error_response:
        return error_response
    try:
        db_client = firestore.client()
        failed = []
        for collection_name in ('user_credentials', 'user_private', 'incoming_calls', 'users'):
            try:
                db_client.collection(collection_name).document(uid).delete()
            except Exception as e:
                print(f"[AUTH] Failed to delete {collection_name}/{uid}: {e}")
                failed.append(collection_name)
        if failed:
            return jsonify({
                "error": "Some account data could not be deleted",
                "code": "partial_delete",
                "collections": failed,
            }), 500
        return jsonify({"ok": True}), 200
    except Exception as e:
        print(f"[AUTH] Delete account error: {e}")
        return jsonify({"error": "Failed to delete account data"}), 500


@app.route('/api/v1/auth/check-username', methods=['POST', 'OPTIONS'])
def check_username():
    if request.method == 'OPTIONS':
        return '', 200

    data = request.json or {}
    username = (data.get('username') or '').strip().lower()
    exclude_uid = data.get('excludeUid')

    if not username:
        return jsonify({"error": "Username is required"}), 400

    # Signup calls this before signInWithCustomToken has run, so the client has
    # no Firebase Auth session yet and the users/{uid} security rule (read: if
    # signedIn()) rejects a client-side uniqueness query outright. The Admin SDK
    # bypasses that rule, matching how check-user already works pre-auth.
    if rate_limited(f"checkusername:{request.remote_addr}", 20, 900):
        return jsonify({"error": "Too many requests. Please try again later."}), 429

    try:
        db_client = firestore.client()
        matches = db_client.collection('users').where('username', '==', username).limit(2).stream()
        taken = any(doc.id != exclude_uid for doc in matches)
        return jsonify({"available": not taken}), 200
    except Exception as e:
        print(f"[AUTH] Check username error: {e}")
        return jsonify({"error": "Failed to check username"}), 500

def serialize_doc(doc_dict):
    if not doc_dict or not isinstance(doc_dict, dict):
        return {}
    out = {}
    for k, v in doc_dict.items():
        if hasattr(v, 'timestamp'):
            try:
                out[k] = int(v.timestamp() * 1000)
            except Exception:
                out[k] = str(v)
        elif hasattr(v, 'isoformat'):
            out[k] = v.isoformat()
        else:
            out[k] = v
    return out

# Upper bound on what a single billing tick may charge, so a stalled or
# reconnecting client cannot trigger a large retroactive deduction.
MAX_BILLABLE_TICK_SECONDS = 60

# Upper bound on the call-second increment a client may submit for heart rewards.
# Without this a patched client can claim an arbitrarily long call duration (e.g.
# 10^9 seconds) to farm hearts, each redeemable for real money via heartToInrRate.
# 7 200 s = 2 hours — a generous but non-exploitable ceiling for any single call.
MAX_REWARDS_SECONDS = 7200

# Host cut on Ludo ticket / bet / roll spends. Clients used to send this as a
# free-form `commissionAmount`; a patched app could set it equal to the full
# debit and turn the endpoint into an arbitrary P2P transfer.
HOST_COMMISSION_RATE = 0.10

# Hard caps so a patched client cannot drain an entire balance in one call via
# the generic spend APIs. Gift catalogs top out at 1000; Ludo seats/bets stay
# well under 5000.
MAX_COIN_TRANSFER = 1000
MAX_SINGLE_DEDUCT = 5000

# Expert-room per-minute rate bounds (matches ClubScreen UI). Billing clamps to
# these even if an old room document somehow holds an out-of-range value.
MAX_ROOM_RATE_PER_MIN = 500


def get_coin_balance(snapshot):
    if not snapshot.exists:
        raise ValueError("User does not exist")
    data = snapshot.to_dict() or {}
    return float(data.get("coins") or 0)


def parse_capped_amount(raw_value, field_name, max_amount):
    amount = parse_positive_number(raw_value, field_name)
    if amount > max_amount:
        raise ValueError(f"{field_name} exceeds maximum of {max_amount}")
    return amount


def server_host_commission(amount):
    """Host cut is always derived server-side; client-sent commission is ignored."""
    return math.floor(amount * HOST_COMMISSION_RATE)


def ensure_utc(value):
    if not isinstance(value, datetime):
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


@app.route('/api/v1/coins/deduct', methods=['POST', 'OPTIONS'])
def deduct_coins():
    if request.method == 'OPTIONS':
        return '', 200
    uid, error_response = require_bearer_uid()
    if error_response:
        return error_response
    data = request.json or {}
    if data.get("userId") != uid:
        return jsonify({"error": "Cannot deduct coins for another user"}), 403
    try:
        amount = parse_capped_amount(data.get("amount"), "amount", MAX_SINGLE_DEDUCT)
        db_client = firestore.client()
        user_ref = db_client.collection('users').document(uid)
        transaction = db_client.transaction()

        @firestore.transactional
        def apply(transaction):
            balance = get_coin_balance(user_ref.get(transaction=transaction))
            if balance < amount:
                raise ValueError("Insufficient Gengal balance")
            new_balance = balance - amount
            transaction.update(user_ref, {"coins": new_balance})
            return new_balance

        return jsonify({"ok": True, "newBalance": apply(transaction)}), 200
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        print(f"[COINS] Deduct error: {e}")
        return jsonify({"error": "Failed to deduct coins"}), 500

@app.route('/api/v1/coins/deduct-with-commission', methods=['POST', 'OPTIONS'])
def deduct_with_commission():
    if request.method == 'OPTIONS':
        return '', 200
    uid, error_response = require_bearer_uid()
    if error_response:
        return error_response
    data = request.json or {}
    host_uid = data.get("hostUid")
    if data.get("userId") != uid:
        return jsonify({"error": "Cannot deduct coins for another user"}), 403
    if not host_uid:
        return jsonify({"error": "Missing hostUid"}), 400
    try:
        amount = parse_capped_amount(data.get("amount"), "amount", MAX_SINGLE_DEDUCT)
        # Client may still send commissionAmount for backward compatibility; ignored.
        commission = server_host_commission(amount)

        db_client = firestore.client()
        user_ref = db_client.collection('users').document(uid)
        host_ref = db_client.collection('users').document(host_uid)
        pay_host = commission > 0 and host_uid != uid
        transaction = db_client.transaction()

        @firestore.transactional
        def apply(transaction):
            # All reads before writes (Firestore transaction rule).
            user_balance = get_coin_balance(user_ref.get(transaction=transaction))
            host_balance = (
                get_coin_balance(host_ref.get(transaction=transaction))
                if pay_host else None
            )
            if user_balance < amount:
                raise ValueError("Insufficient Gengal balance")

            user_new = user_balance - amount
            transaction.update(user_ref, {"coins": user_new})

            host_new = None
            if pay_host:
                host_new = host_balance + commission
                transaction.update(host_ref, {"coins": host_new})
            return user_new, host_new

        new_balance, host_new_balance = apply(transaction)
        return jsonify({"ok": True, "newBalance": new_balance, "hostNewBalance": host_new_balance}), 200
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        print(f"[COINS] Deduct commission error: {e}")
        return jsonify({"error": "Failed to deduct coins"}), 500

@app.route('/api/v1/coins/transfer', methods=['POST', 'OPTIONS'])
def transfer_coins_endpoint():
    if request.method == 'OPTIONS':
        return '', 200
    uid, error_response = require_bearer_uid()
    if error_response:
        return error_response
    data = request.json or {}
    sender_id = data.get("senderId")
    receiver_id = data.get("receiverId")
    if sender_id != uid:
        return jsonify({"error": "Cannot transfer coins from another user"}), 403
    if not receiver_id or sender_id == receiver_id:
        return jsonify({"error": "Invalid receiver"}), 400
    # A gift sent at a Ludo table: what each watcher has given there orders
    # the host's list of mic requests.
    ludo_room_id = str(data.get("ludoRoomId") or "").strip()
    try:
        amount = parse_capped_amount(data.get("amount"), "amount", MAX_COIN_TRANSFER)
        db_client = firestore.client()
        sender_ref = db_client.collection('users').document(sender_id)
        receiver_ref = db_client.collection('users').document(receiver_id)
        ludo_ref = db_client.collection('ludo_rooms').document(ludo_room_id) if ludo_room_id else None
        transaction = db_client.transaction()

        @firestore.transactional
        def apply(transaction):
            sender_balance = get_coin_balance(sender_ref.get(transaction=transaction))
            receiver_balance = get_coin_balance(receiver_ref.get(transaction=transaction))
            ludo = ludo_ref.get(transaction=transaction) if ludo_ref else None
            if sender_balance < amount:
                raise ValueError("Insufficient Gengal balance")
            sender_new = sender_balance - amount
            receiver_new = receiver_balance + amount
            transaction.update(sender_ref, {"coins": sender_new})
            transaction.update(receiver_ref, {"coins": receiver_new})
            if ludo is not None and ludo.exists:
                table = ludo.to_dict() or {}
                at_table = receiver_id == table.get('hostUid') or receiver_id in (table.get('playerUids') or [])
                if at_table and table.get('status') == 'live':
                    totals = dict(table.get('giftTotals') or {})
                    totals[sender_id] = round(float(totals.get(sender_id) or 0) + amount, 2)
                    transaction.update(ludo_ref, {"giftTotals": totals})
            return sender_new, receiver_new

        sender_new, receiver_new = apply(transaction)
        return jsonify({
            "success": True,
            "senderNewBalance": sender_new,
            "receiverNewBalance": receiver_new,
        }), 200
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        print(f"[COINS] Transfer error: {e}")
        return jsonify({"error": "Failed to transfer coins"}), 500

@app.route('/api/v1/coins/call-billing', methods=['POST', 'OPTIONS'])
def call_billing_endpoint():
    """Bills an in-progress call from the server's own clock.

    The client used to supply both the amount and the rate, so a patched app
    could bill itself nothing (or bill an arbitrary figure). Now the caller only
    identifies the call: the server derives elapsed time from the timestamp it
    last billed at, and the rate from /settings.

    Either participant may drive a tick, and the effect is identical, so the
    payer cannot avoid being billed by not calling this — the receiver's client
    has every incentive to.
    """
    if request.method == 'OPTIONS':
        return '', 200
    uid, error_response = require_bearer_uid()
    if error_response:
        return error_response

    data = request.json or {}
    room_id = data.get("roomId")
    if not room_id:
        return jsonify({"error": "Missing roomId"}), 400

    try:
        db_client = firestore.client()
        call_ref = db_client.collection('calls').document(room_id)
        call_snap = call_ref.get()
        if not call_snap.exists:
            return jsonify({"error": "Unknown call"}), 404

        call_data = call_snap.to_dict() or {}
        payer_id = call_data.get('callerUid')
        receiver_id = call_data.get('receiverUid')

        # Only the two participants may tick this call.
        if uid not in (payer_id, receiver_id):
            return jsonify({"error": "Not a participant in this call"}), 403
        if not payer_id or not receiver_id or payer_id == receiver_id:
            return jsonify({"success": True, "hasInsufficientFunds": False, "billedSeconds": 0}), 200
        # A call that has already ended is deliberately NOT rejected here. Both
        # clients fire one last tick as they tear the screen down, and that tick
        # is the only thing that charges for the seconds since the previous one
        # -- up to fifteen of them. Refusing it meant the tail of every single
        # call was free, and worse, it was a race: the hang-up marks the record
        # 'ended' at the same moment the final tick is sent, so whether the last
        # quarter-minute was billed came down to which network round-trip won.
        # The transaction below bills an ended call only up to its `endedAt`, so
        # nothing accrues after the parties actually hung up.

        settings = pricing_settings()

        is_video = call_data.get('mode') == 'video'
        rate_per_min = float(
            settings['videoCallRatePerMin'] if is_video else settings['voiceCallRatePerMin']
        )
        share_percentage = float(settings['creatorSharePercentage'])
        share_percentage = min(max(share_percentage, 0), 100)

        payer_ref = db_client.collection('users').document(payer_id)
        receiver_ref = db_client.collection('users').document(receiver_id)
        transaction = db_client.transaction()

        def as_utc(value):
            """A Firestore timestamp as an aware datetime, or None."""
            if not isinstance(value, datetime):
                return None
            return value if value.tzinfo else value.replace(tzinfo=timezone.utc)

        @firestore.transactional
        def apply(transaction):
            # Every read happens here, before any write: Firestore forbids
            # reading after writing inside a transaction, and the paths below
            # need the participants' documents whether they bill or not.
            snap = call_ref.get(transaction=transaction)
            payer_snap = payer_ref.get(transaction=transaction)
            receiver_snap = receiver_ref.get(transaction=transaction)
            day = ist_day(datetime.now(timezone.utc))
            payer_day_ref = user_day_ref(db_client, payer_id, day)
            receiver_day_ref = user_day_ref(db_client, receiver_id, day)
            payer_day = payer_day_ref.get(transaction=transaction)
            receiver_day = receiver_day_ref.get(transaction=transaction)
            current = snap.to_dict() or {}

            # Elapsed time is measured between server-side timestamps, so a
            # client clock cannot influence the amount.
            now = datetime.now(timezone.utc)

            # An ended call still gets one last tick from each client, and it
            # must charge for the run-up to the hang-up and not one second more.
            # Cap on `endedAt` whenever it is set — even if a client flipped
            # `status` back to active — so hang-up time is the hard stop.
            ended_at = as_utc(current.get('endedAt'))
            ended = current.get('status') == 'ended' or ended_at is not None
            bill_until = min(now, ended_at) if ended_at else now

            # Stamped on both participants every tick so the discovery feed --
            # and the rule guarding /incoming_calls -- can tell who is mid-call.
            # Deliberately a timestamp rather than a boolean "isBusy": a flag has
            # to be cleared by the client, and a client that is force-quit,
            # crashes or loses the network never gets to clear it — leaving
            # someone marked busy forever and effectively invisible to callers.
            # Readers age it out instead (see CALL_BUSY_TTL_MS), so a call that
            # ends without ceremony simply stops being refreshed. Written
            # server-side from the server clock, so it cannot be spoofed to make
            # someone look unavailable.
            def mark_busy():
                transaction.update(payer_ref, {"inCallSince": now})
                transaction.update(receiver_ref, {"inCallSince": now})

            # ...and cleared as soon as the call closes properly, so hanging up
            # does not leave both people unreachable for the rest of the TTL.
            # Skipped for anyone whose stamp is newer than this call's ending:
            # they are already on the next call, and clearing it would advertise
            # them as free while they are talking to somebody else.
            def release_busy():
                # The cutoff is the last moment *this* call is known to have
                # touched the marker, which is not always when it ended. The
                # hang-up and the closing tick race: whichever tick still sees
                # the record 'active' refreshes the marker one final time, and
                # that stamp then sits *after* `endedAt`. Judged against
                # `endedAt` alone it looked like a newer call's stamp, so the
                # release was skipped and both people stayed advertised as busy
                # for the rest of the TTL after every call they finished.
                # `lastBilledAt` moves in lockstep with the marker -- the same
                # transaction writes both -- so the later of the two is this
                # call's true high-water mark. Anything past it really does
                # belong to a call that started afterwards.
                boundary = ended_at or now
                if last_dt is not None and last_dt > boundary:
                    boundary = last_dt
                for ref, user_snap in ((payer_ref, payer_snap), (receiver_ref, receiver_snap)):
                    stamp = as_utc((user_snap.to_dict() or {}).get('inCallSince'))
                    if stamp is None or stamp > boundary:
                        continue
                    transaction.update(ref, {"inCallSince": firestore.DELETE_FIELD})

            last_dt = as_utc(current.get('lastBilledAt'))
            if last_dt is None:
                # First tick only starts the clock — anchoring to createdAt
                # instead would bill the payer for the time the call spent
                # ringing. Both parties are already on the call, so without
                # stamping here they would read as free for the opening seconds
                # and keep receiving calls.
                if ended:
                    release_busy()
                    return 0.0, None, None, False, 0.0
                transaction.update(call_ref, {"lastBilledAt": now})
                mark_busy()
                # Nothing is charged for this interval, so a payer with an empty
                # balance has to be turned away here or not at all: they would
                # otherwise talk free until the next tick, hang up, and do it
                # again — an unlimited supply of free calls a quarter-minute at
                # a time. A payer with *some* balance is left alone; the tick
                # below already lets them spend down to zero and stops there.
                payer_balance = get_coin_balance(payer_snap)
                return 0.0, payer_balance, None, payer_balance <= 0, 0.0

            elapsed_seconds = (bill_until - last_dt).total_seconds()
            if elapsed_seconds <= 0:
                # Nothing left to charge. On an ended call this is the second and
                # subsequent final flushes (both clients send one), which is
                # exactly when the busy marker should come off.
                if ended:
                    release_busy()
                return 0.0, None, None, False, 0.0

            # Cap a single tick so a long client stall (or a resumed session)
            # cannot produce a surprise bulk charge.
            elapsed_seconds = min(elapsed_seconds, MAX_BILLABLE_TICK_SECONDS)

            amount = (rate_per_min / 60.0) * elapsed_seconds
            payer_balance = get_coin_balance(payer_snap)
            receiver_balance = get_coin_balance(receiver_snap)

            actual_deduction = min(payer_balance, amount)
            has_insufficient = payer_balance < amount
            receiver_share = actual_deduction * (share_percentage / 100.0)

            payer_new = payer_balance - actual_deduction
            receiver_new = receiver_balance + receiver_share

            transaction.update(payer_ref, {"coins": payer_new})
            transaction.update(receiver_ref, {"coins": receiver_new})
            paid_seconds = actual_deduction / (rate_per_min / 60.0) if rate_per_min > 0 else 0.0
            add_to_day(transaction, payer_day_ref, payer_day, payer_id, day,
                       spentCoins=actual_deduction, paidVoiceSecs=0.0 if is_video else paid_seconds)
            add_to_day(transaction, receiver_day_ref, receiver_day, receiver_id, day, hostSecs=paid_seconds)
            transaction.update(call_ref, {
                # Anchored to what was actually billed, not to "now": on the
                # closing tick of an ended call those differ, and using `now`
                # would silently swallow any tail a second flush still owed.
                "lastBilledAt": bill_until,
                "durationSeconds": float(current.get('durationSeconds') or 0) + elapsed_seconds,
                "coinsDeducted": float(current.get('coinsDeducted') or 0) + actual_deduction,
            })
            # Refreshing the busy marker on a call that has already hung up is
            # what would keep both people unreachable after they had finished.
            if ended:
                release_busy()
            else:
                mark_busy()
            return actual_deduction, payer_new, receiver_new, has_insufficient, elapsed_seconds

        try:
            billed, payer_new, receiver_new, has_insufficient, elapsed = apply(transaction)
        except (FirestoreAborted, ValueError) as e:
            # Cross-transaction contention, which is not a failure to bill.
            #
            # Both participants tick the same call, and at the two moments they
            # are naturally in step -- the opening tick and the final flush at
            # hang-up -- their transactions collide on the same three documents.
            # Firestore aborts one of them to keep the two serialisable. That
            # arrives either as `Aborted` straight from gRPC, which fell through
            # to the catch-all below and reached the client as a 500, or, once
            # the SDK has spent its five retries, as a bare ValueError from the
            # commit helper -- indistinguishable from a bad-input ValueError, so
            # it was answered with a 400 quoting "Failed to commit transaction
            # in 5 attempts." at the user.
            #
            # Nothing is lost when a tick is aborted. Billing is anchored on
            # `lastBilledAt`, so the seconds this tick would have charged are
            # still owed, and the next tick -- or the final flush, or the other
            # participant's tick moments later -- charges them. A transaction
            # that loses the race commits nothing, so there is no partial state
            # to unpick either. Reporting zero billed seconds is the truthful
            # answer rather than a swallowed error.
            #
            # A ValueError that is not the commit helper's is re-raised: `apply`
            # raises nothing itself today, and if that changes this must not
            # quietly report success for it.
            if isinstance(e, ValueError) and 'Failed to commit transaction' not in str(e):
                raise
            print(f"[COINS] Billing tick contended, deferring to the next tick: {type(e).__name__}")
            return jsonify({
                "success": True,
                "hasInsufficientFunds": False,
                "billedAmount": 0,
                "billedSeconds": 0,
                "contended": True,
            }), 200

        return jsonify({
            "success": True,
            "hasInsufficientFunds": has_insufficient,
            "billedAmount": billed,
            "billedSeconds": elapsed,
            "payerNewBalance": payer_new,
            "receiverNewBalance": receiver_new,
        }), 200
    except (TypeError, ValueError) as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        # Full traceback, not just str(e): the bare message told us a billing
        # tick had failed but never where, so a 500 seen in the wild could not
        # be diagnosed without reproducing it first.
        print(f"[COINS] Billing error: {type(e).__name__}: {e}")
        traceback.print_exc()
        return jsonify({"error": "Failed to process billing"}), 500

ROOM_COLLECTIONS = {'expert_rooms', 'chill_rooms', 'ludo_rooms'}
# Share of an audience member's spend that reaches the host; the rest is platform.
ROOM_HOST_SHARE = 0.70

@app.route('/api/v1/rooms/billing', methods=['POST', 'OPTIONS'])
def room_billing_endpoint():
    """Bills a member for time spent in a paid room.

    Same contract as call billing: the client identifies the room, the server
    measures elapsed time against its own clock and applies the rate stored on
    the room. Hosts are never charged — they are being paid.

    Rooms previously charged nothing at all: ratePerMin was set by the host,
    displayed in the UI, and never collected by any code path.
    """
    if request.method == 'OPTIONS':
        return '', 200

    uid, error_response = require_bearer_uid()
    if error_response:
        return error_response

    data = request.json or {}
    room_id = data.get("roomId")
    collection_name = data.get("collection", "expert_rooms")
    if not room_id:
        return jsonify({"error": "Missing roomId"}), 400
    if collection_name not in ROOM_COLLECTIONS:
        return jsonify({"error": "Unknown room collection"}), 400

    try:
        db_client = firestore.client()
        room_ref = db_client.collection(collection_name).document(room_id)
        room_snap = room_ref.get()
        if not room_snap.exists:
            return jsonify({"error": "Unknown room"}), 404

        room = room_snap.to_dict() or {}
        host_uid = room.get('hostUid')
        # Clamp so a forged create (or legacy doc) cannot charge unbounded rates.
        rate_per_min = min(
            max(float(room.get('ratePerMin') or 0), 0.0),
            float(MAX_ROOM_RATE_PER_MIN),
        )

        member_uid = str(data.get("memberUid") or uid).strip() or uid
        # Only the member themselves, or the host collecting for them, may tick.
        # Host-driven ticks close the "patched guest never bills" free-ride.
        if member_uid != uid and uid != host_uid:
            return jsonify({"error": "Cannot bill another member"}), 403

        # Free room, closed room, or billing the host (who is paid, not charged).
        if rate_per_min <= 0 or member_uid == host_uid or room.get('status') == 'closed':
            return jsonify({"success": True, "billedAmount": 0, "billedSeconds": 0}), 200

        member_ref = room_ref.collection('members').document(member_uid)
        member_snap = member_ref.get()
        if not member_snap.exists:
            return jsonify({"error": "Not a member of this room"}), 403

        # Host-driven ticks must not charge guests who aged out of presence
        # (force-quit / left without leaveRoom). Self-ticks assert presence.
        if member_uid != uid:
            last_seen = ensure_utc((member_snap.to_dict() or {}).get('lastSeen'))
            if last_seen is None:
                return jsonify({"error": "Member is not present"}), 409
            age = (datetime.now(timezone.utc) - last_seen).total_seconds()
            if age > PRESENCE_STALE_SECONDS:
                return jsonify({
                    "success": True,
                    "billedAmount": 0,
                    "billedSeconds": 0,
                    "hasInsufficientFunds": False,
                    "memberUid": member_uid,
                    "skipped": "not_present",
                }), 200

        payer_ref = db_client.collection('users').document(member_uid)
        host_ref = db_client.collection('users').document(host_uid)
        transaction = db_client.transaction()

        @firestore.transactional
        def apply(transaction):
            member = (member_ref.get(transaction=transaction).to_dict()) or {}
            now = datetime.now(timezone.utc)
            last = ensure_utc(member.get('lastBilledAt'))
            joined = ensure_utc(member.get('joinedAt'))

            # First tick only starts the clock. After a crash/rejoin, joinedAt is
            # newer than lastBilledAt — that gap was spent outside and must not
            # be charged.
            if last is None or (joined is not None and joined > last):
                transaction.update(member_ref, {"lastBilledAt": now})
                return 0.0, None, False, 0.0

            elapsed = (now - last).total_seconds()
            if elapsed <= 0:
                return 0.0, None, False, 0.0
            elapsed = min(elapsed, MAX_BILLABLE_TICK_SECONDS)

            # Firestore requires every read before any write.
            payer_balance = get_coin_balance(payer_ref.get(transaction=transaction))
            host_balance = get_coin_balance(host_ref.get(transaction=transaction))

            amount = (rate_per_min / 60.0) * elapsed
            actual = min(payer_balance, amount)
            has_insufficient = payer_balance < amount
            host_cut = actual * ROOM_HOST_SHARE

            transaction.update(payer_ref, {"coins": payer_balance - actual})
            if host_cut > 0:
                transaction.update(host_ref, {"coins": host_balance + host_cut})
            transaction.update(member_ref, {
                "lastBilledAt": now,
                "secondsInRoom": float(member.get('secondsInRoom') or 0) + elapsed,
                "coinsSpent": float(member.get('coinsSpent') or 0) + actual,
            })
            return actual, payer_balance - actual, has_insufficient, elapsed

        billed, new_balance, has_insufficient, elapsed = apply(transaction)
        return jsonify({
            "success": True,
            "billedAmount": billed,
            "billedSeconds": elapsed,
            "newBalance": new_balance,
            "hasInsufficientFunds": has_insufficient,
            "memberUid": member_uid,
        }), 200
    except (TypeError, ValueError) as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        print(f"[ROOMS] Billing error: {e}")
        return jsonify({"error": "Failed to process room billing"}), 500


LUDO_SEAT_COLORS = frozenset({'red', 'blue', 'green', 'yellow'})
LUDO_TABLE_COST = 10
LUDO_ROLL_COST = 15
LUDO_BET_AMOUNT = 50
LUDO_DEFAULT_TICKET_PRICE = 50


def build_initial_ludo_tokens():
    tokens = []
    for color in ('red', 'blue', 'green', 'yellow'):
        for i in range(4):
            tokens.append({
                'id': '%s-%d' % (color, i),
                'color': color,
                'index': i,
                'position': -1,
            })
    return tokens


def next_ludo_color(current, players):
    colors = [p.get('color') for p in players if p.get('color')]
    if not colors:
        return current
    if current not in colors:
        return colors[0]
    return colors[(colors.index(current) + 1) % len(colors)]


@app.route('/api/v1/ludo/create-table', methods=['POST', 'OPTIONS'])
def create_ludo_table_endpoint():
    """Charge the table fee and create the room in one step.

    Client create + separate deduct let a patched app skip payment, and an
    honest app lose coins when create failed after the debit.
    """
    if request.method == 'OPTIONS':
        return '', 200
    uid, error_response = require_bearer_uid()
    if error_response:
        return error_response

    data = request.json or {}
    game_mode = str(data.get('gameMode') or '').strip()
    nickname = str(data.get('nickname') or '').strip()[:40] or 'Host'
    avatar_data = data.get('avatarData')
    # A private table stays out of the lobby; friends come in by code or link.
    private = data.get('private') is True
    if game_mode not in ('per_game', 'per_token', LUDO_PER_MINUTE):
        return jsonify({"error": "gameMode must be per_minute, per_game or per_token"}), 400

    try:
        db_client = firestore.client()
        user_ref = db_client.collection('users').document(uid)
        room_ref = db_client.collection('ludo_rooms').document()
        code = ludo_new_code(db_client)
        # Older apps still open the original two table types; only the
        # per-minute table takes a deposit and plays by the newer rules.
        terms = ludo_terms(pricing_settings()) if game_mode == LUDO_PER_MINUTE else None
        cost = terms['deposit'] if terms else LUDO_TABLE_COST
        transaction = db_client.transaction()

        @firestore.transactional
        def apply(transaction):
            now = time.time()
            user_snap = user_ref.get(transaction=transaction)
            if not user_snap.exists:
                raise ValueError("User does not exist")
            ledger = LudoLedger(transaction, db_client)
            lock_writes = ludo_check_lock(
                transaction, db_client, uid, user_snap.to_dict(), room_ref.id, now, ledger,
            )
            if ledger.balance(uid) < cost:
                raise ValueError("Insufficient Gengal balance")
            ledger.add(uid, -cost)
            ledger.write(extra={uid: {"activeLudoRoomId": room_ref.id}})
            for ref, fields in lock_writes:
                transaction.update(ref, fields)
            host_player = {
                "uid": uid,
                "nickname": nickname,
                "avatarData": avatar_data if isinstance(avatar_data, dict) else None,
                "color": "red",
                "isHost": True,
                "isOnline": True,
                "score": 0,
            }
            per_minute_fields = {
                "terms": terms,
                "billedUntil": None,
                "emptySince": None,
                "hostAway": False,
                "hostLeaves": 0,
                "hostMissed": 0,
                "hostBenched": False,
                "departedUids": [],
                "paidBy": {},
                "hostEarned": 0,
                "lastActive": {},
                "settled": False,
                "settlement": None,
            } if terms else {}
            transaction.set(room_ref, dict(per_minute_fields, **{
                "hostUid": uid,
                "phase": "waiting",
                "status": "live",
                "gameMode": game_mode,
                "ticketPrice": 0 if terms else LUDO_DEFAULT_TICKET_PRICE,
                "audienceBets": {},
                "players": [host_player],
                "playerUids": [uid],
                "activeMemberCount": 1,
                "presentCount": 1,
                "hostLastSeen": datetime.now(timezone.utc),
                "tokens": build_initial_ludo_tokens(),
                "currentTurn": "red",
                "diceValue": None,
                "diceRolled": False,
                "consecutiveSixes": 0,
                "turnStartedAt": None,
                "turnTimeoutSecs": 15,
                "finishRank": 1,
                "winnersOrder": [],
                "spectatorCount": 0,
                "code": code,
                "private": private,
                "createdAt": firestore.SERVER_TIMESTAMP,
            }))
            return ledger.balance(uid)

        new_balance = apply(transaction)
        return jsonify({
            "ok": True,
            "roomId": room_ref.id,
            "code": code,
            "newBalance": new_balance,
            "tableCost": cost,
        }), 200
    except LudoBusy as e:
        return ludo_busy_response(e)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        print(f"[LUDO] Create table error: {e}")
        return jsonify({"error": "Failed to create table"}), 500


@app.route('/api/v1/ludo/buy-ticket', methods=['POST', 'OPTIONS'])
def buy_ludo_ticket_endpoint():
    """Atomically seats a player: read ticketPrice from the room, take payment,
    then claim the colour. The old client path deducted first and claimed
    second, so two buyers racing the same seat both paid and one lost the coins.
    """
    if request.method == 'OPTIONS':
        return '', 200
    uid, error_response = require_bearer_uid()
    if error_response:
        return error_response

    data = request.json or {}
    room_id = str(data.get("roomId") or "").strip()
    color = str(data.get("color") or "").strip().lower()
    nickname = str(data.get("nickname") or "").strip()[:40] or "Player"
    avatar_data = data.get("avatarData")
    if not room_id:
        return jsonify({"error": "Missing roomId"}), 400
    if color not in LUDO_SEAT_COLORS:
        return jsonify({"error": "Invalid seat colour"}), 400

    try:
        db_client = firestore.client()
        room_ref = db_client.collection('ludo_rooms').document(room_id)
        user_ref = db_client.collection('users').document(uid)
        transaction = db_client.transaction()

        @firestore.transactional
        def apply(transaction):
            room_snap = room_ref.get(transaction=transaction)
            if not room_snap.exists:
                raise ValueError("Unknown room")
            room = room_snap.to_dict() or {}
            host_uid = room.get('hostUid')
            if not host_uid:
                raise ValueError("Room has no host")
            if room.get('status') == 'closed':
                raise ValueError("This table has closed.")
            if ludo_is_per_minute(room):
                return ludo_take_free_seat(
                    transaction, db_client, room_ref, room, uid, color, nickname, avatar_data,
                )
            if room.get('phase', 'waiting') != 'waiting':
                raise ValueError("This game has already started.")

            ticket_price = float(room.get('ticketPrice') or 0)
            if ticket_price <= 0:
                raise ValueError("This table has no seat price")
            if ticket_price > MAX_SINGLE_DEDUCT:
                raise ValueError("Seat price exceeds maximum")

            players = list(room.get('players') or [])
            if any((p or {}).get('uid') == uid for p in players):
                raise ValueError("Already seated")
            if len(players) >= len(LUDO_SEAT_COLORS):
                raise ValueError("The table is full.")
            if any((p or {}).get('color') == color for p in players):
                raise ValueError("Color already taken")

            commission = server_host_commission(ticket_price)
            host_ref = db_client.collection('users').document(host_uid)
            pay_host = commission > 0 and host_uid != uid

            # All reads before writes.
            user_snap = user_ref.get(transaction=transaction)
            ludo_check_lock(transaction, db_client, uid, user_snap.to_dict(), room_id, time.time())
            user_balance = get_coin_balance(user_snap)
            host_balance = (
                get_coin_balance(host_ref.get(transaction=transaction))
                if pay_host else None
            )
            if user_balance < ticket_price:
                raise ValueError("Insufficient Gengal balance")

            user_new = user_balance - ticket_price
            host_new = None
            transaction.update(user_ref, {"coins": user_new, "activeLudoRoomId": room_id})
            if pay_host:
                host_new = host_balance + commission
                transaction.update(host_ref, {"coins": host_new})

            players.append({
                "uid": uid,
                "nickname": nickname,
                "avatarData": avatar_data if isinstance(avatar_data, dict) else None,
                "color": color,
                "isHost": False,
                "isOnline": True,
                "score": 0,
            })
            transaction.update(room_ref, {
                "players": players,
                "playerUids": [p.get('uid') for p in players if p.get('uid')],
                "activeMemberCount": int(room.get('activeMemberCount') or len(players)) + 1,
            })
            return user_new, host_new, ticket_price, commission

        new_balance, host_new_balance, price, commission = apply(transaction)
        return jsonify({
            "ok": True,
            "newBalance": new_balance,
            "hostNewBalance": host_new_balance,
            "ticketPrice": price,
            "commission": commission,
            "color": color,
        }), 200
    except LudoBusy as e:
        return ludo_busy_response(e)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        print(f"[LUDO] Buy ticket error: {e}")
        return jsonify({"error": "Failed to buy seat"}), 500


@app.route('/api/v1/ludo/leave-seat', methods=['POST', 'OPTIONS'])
def ludo_leave_seat_endpoint():
    """Remove the caller from players / playerUids (server-owned seat list)."""
    if request.method == 'OPTIONS':
        return '', 200
    uid, error_response = require_bearer_uid()
    if error_response:
        return error_response
    room_id = str((request.json or {}).get('roomId') or '').strip()
    if not room_id:
        return jsonify({"error": "Missing roomId"}), 400
    try:
        db_client = firestore.client()
        room_ref = db_client.collection('ludo_rooms').document(room_id)
        transaction = db_client.transaction()

        @firestore.transactional
        def apply(transaction):
            snap = room_ref.get(transaction=transaction)
            if not snap.exists:
                raise ValueError("Unknown room")
            room = snap.to_dict() or {}
            if ludo_is_per_minute(room):
                return ludo_leave_per_minute(transaction, db_client, room_ref, room, uid)
            players = [p for p in (room.get('players') or []) if (p or {}).get('uid') != uid]
            if len(players) == len(room.get('players') or []):
                return False
            transaction.update(room_ref, {
                "players": players,
                "playerUids": [p.get('uid') for p in players if p.get('uid')],
                "activeMemberCount": max(0, int(room.get('activeMemberCount') or 1) - 1),
            })
            return True

        left = apply(transaction)
        return jsonify({"ok": True, "left": left}), 200
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        print(f"[LUDO] Leave seat error: {e}")
        return jsonify({"error": "Failed to leave seat"}), 500


@app.route('/api/v1/rooms/expert/leave-stage', methods=['POST', 'OPTIONS'])
def expert_leave_stage_endpoint():
    """Remove the caller from the speakers list (host still manages others)."""
    if request.method == 'OPTIONS':
        return '', 200
    uid, error_response = require_bearer_uid()
    if error_response:
        return error_response
    room_id = str((request.json or {}).get('roomId') or '').strip()
    if not room_id:
        return jsonify({"error": "Missing roomId"}), 400
    try:
        db_client = firestore.client()
        room_ref = db_client.collection('expert_rooms').document(room_id)
        snap = room_ref.get()
        if not snap.exists:
            return jsonify({"error": "Unknown room"}), 404
        room = snap.to_dict() or {}
        # Host stays on stage until the room closes — demoting them leaves no publisher.
        if room.get('hostUid') == uid:
            return jsonify({"ok": True, "left": False, "reason": "host"}), 200

        def without_uid(values):
            return [u for u in (values or []) if u != uid]

        room_ref.update({
            "speakers": [
                s for s in (room.get('speakers') or []) if (s or {}).get('uid') != uid
            ],
            "handQueue": without_uid(room.get('handQueue')),
            "handQueueBoy": without_uid(room.get('handQueueBoy')),
            "handQueueGirl": without_uid(room.get('handQueueGirl')),
        })
        return jsonify({"ok": True, "left": True}), 200
    except Exception as e:
        print(f"[ROOMS] Leave stage error: {e}")
        return jsonify({"error": "Failed to leave stage"}), 500


@app.route('/api/v1/ludo/place-bet', methods=['POST', 'OPTIONS'])
def place_ludo_bet_endpoint():
    """Charge a fixed backing amount and record it on the room atomically."""
    if request.method == 'OPTIONS':
        return '', 200
    uid, error_response = require_bearer_uid()
    if error_response:
        return error_response

    data = request.json or {}
    room_id = str(data.get("roomId") or "").strip()
    color = str(data.get("color") or "").strip().lower()
    if not room_id:
        return jsonify({"error": "Missing roomId"}), 400
    if color not in LUDO_SEAT_COLORS:
        return jsonify({"error": "Invalid colour"}), 400

    amount = float(LUDO_BET_AMOUNT)
    try:
        db_client = firestore.client()
        room_ref = db_client.collection('ludo_rooms').document(room_id)
        user_ref = db_client.collection('users').document(uid)
        transaction = db_client.transaction()

        @firestore.transactional
        def apply(transaction):
            room_snap = room_ref.get(transaction=transaction)
            if not room_snap.exists:
                raise ValueError("Unknown room")
            room = room_snap.to_dict() or {}
            host_uid = room.get('hostUid')
            if not host_uid:
                raise ValueError("Room has no host")

            commission = server_host_commission(amount)
            host_ref = db_client.collection('users').document(host_uid)
            pay_host = commission > 0 and host_uid != uid

            user_balance = get_coin_balance(user_ref.get(transaction=transaction))
            host_balance = (
                get_coin_balance(host_ref.get(transaction=transaction))
                if pay_host else None
            )
            if user_balance < amount:
                raise ValueError("Insufficient Gengal balance")

            user_new = user_balance - amount
            host_new = None
            transaction.update(user_ref, {"coins": user_new})
            if pay_host:
                host_new = host_balance + commission
                transaction.update(host_ref, {"coins": host_new})

            bets = dict(room.get('audienceBets') or {})
            existing = bets.get(uid) or {}
            prior = float(existing.get('amount') or 0) if isinstance(existing, dict) else 0
            bets[uid] = {"color": color, "amount": prior + amount}
            transaction.update(room_ref, {"audienceBets": bets})
            return user_new, host_new

        new_balance, host_new = apply(transaction)
        return jsonify({
            "ok": True,
            "newBalance": new_balance,
            "hostNewBalance": host_new,
            "amount": amount,
            "color": color,
        }), 200
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        print(f"[LUDO] Place bet error: {e}")
        return jsonify({"error": "Failed to place bet"}), 500


LUDO_FINISHED_POSITION = 58
# Slack on top of the room's own turn clock. Phone clocks drift and a snapshot
# takes a moment to arrive, so without it a player could lose a turn they were
# still legitimately taking. Kept short: for as long as it runs the table shows
# a clock at zero and nobody playing, and at three seconds that read as stuck.
LUDO_SKIP_GRACE_SECONDS = 1


def ludo_next_turn(current_turn, players, tokens):
    """Port of nextTurn in src/services/ludoService.ts -- next colour still in play."""
    active = []
    for player in players:
        colour = (player or {}).get('color')
        mine = [t for t in (tokens or []) if (t or {}).get('color') == colour]
        if mine and all(t.get('position') == LUDO_FINISHED_POSITION for t in mine):
            continue
        active.append(colour)
    if not active:
        return current_turn
    try:
        index = active.index(current_turn)
    except ValueError:
        return active[0]
    return active[(index + 1) % len(active)]


# Board geometry. Ports of the constants in src/services/ludoService.ts, which
# still draws the board and highlights legal moves; the server is what decides.
LUDO_BASE_POSITION = -1
LUDO_HOME_COLUMN_START = 52
LUDO_HOME_COLUMN_END = 57
LUDO_COLOR_ENTRY = {'red': 0, 'blue': 13, 'green': 26, 'yellow': 39}


def ludo_new_position(token, steps):
    """Port of computeNewPosition: where `token` lands after `steps`, or None."""
    pos = token.get('position')
    entry = LUDO_COLOR_ENTRY.get(token.get('color'))
    if entry is None or not isinstance(pos, int) or pos == LUDO_FINISHED_POSITION:
        return None
    if pos == LUDO_BASE_POSITION:
        return entry if steps == 6 else None
    if pos >= LUDO_HOME_COLUMN_START:
        new_pos = pos + steps
        if new_pos > LUDO_HOME_COLUMN_END:
            return None
        return LUDO_FINISHED_POSITION if new_pos == LUDO_HOME_COLUMN_END else new_pos
    travelled = (pos - entry + 52) % 52
    remaining = 51 - travelled
    if steps <= remaining:
        return (pos + steps) % 52
    home_pos = LUDO_HOME_COLUMN_START + (steps - remaining - 1)
    if home_pos > LUDO_HOME_COLUMN_END:
        return None
    return LUDO_FINISHED_POSITION if home_pos == LUDO_HOME_COLUMN_END else home_pos


def ludo_legal_moves(tokens, color, dice):
    """Port of getLegalMoves: ids of `color`'s tokens that can move `dice`."""
    return [
        t.get('id') for t in (tokens or [])
        if (t or {}).get('color') == color and ludo_new_position(t, dice) is not None
    ]


# ==========================================
# LUDO: PER-MINUTE TABLES
# ==========================================
#
# The table type the app now opens. Its rules, as the product owner set them:
#
# - Opening a table takes a deposit from the host (50). If the host sees the
#   game through, the deposit is the app's. If the host breaks a limit -- comes
#   back to the table more than 3 times, or lets more than 3 of their turns run
#   out -- their turns are passed over for the rest of the game and the deposit
#   is split among the players still seated at the end (3 left: 10 each, 2 left:
#   15 each, 1 left: 25), the remainder to the app.
# - Seats are free. Each player pays per minute at the start of the minute
#   (3 players: 15, 2: 12, 1: 10). The host plays free and keeps 30% of it.
#   A player who cannot pay for the next minute loses the seat.
# - The winner gets a fixed bonus from the app.
# - Watchers pay 10 a minute while a game is being played (not while it waits,
#   is paused or is over; a watcher with no mic pays all the same), measured to
#   the second and taken in steps: the app takes 1 coin per started 5 seconds up
#   to 6 a minute, the host 1 per started 15 seconds up to 4. So 20 seconds
#   costs 4 + 2, and a full minute exactly 6 + 4. A benched host's part goes to
#   the app, as with the players' minutes.
# - With no players left the board pauses; the host may go and fetch friends
#   without it counting against them. Five minutes empty and the table ends.
# - A host, or a player, cannot open or sit at another Ludo table until their
#   game is over (for a player: or all their pawns are home).
#
# Every amount is an admin setting, copied onto the room as `terms` when the
# table opens, so editing a setting never changes a game already being played.

LUDO_PER_MINUTE = 'per_minute'
# Squares where a pawn cannot be captured. Port of SAFE_CELLS in ludoService.ts.
LUDO_SAFE_CELLS = frozenset({0, 8, 13, 21, 26, 34, 39, 47})
LUDO_BILL_SECONDS = 60
# A player counts as at the table if their heartbeat, or their last roll or
# move, is this recent. Nobody pays for minutes their phone was closed.
LUDO_PRESENT_SECONDS = 60
# A watcher's phone reports every 15 seconds; a longer silence (asleep, killed)
# is not billed beyond this much of it.
LUDO_WATCH_GAP_SECONDS = 30
# The host's heartbeat going quiet this long counts as leaving the table.
LUDO_HOST_AWAY_SECONDS = 60
# A table nobody has taken a turn on for this long holds nobody to it.
LUDO_DEAD_TABLE_SECONDS = 10 * 60
# Matches ROOM_STALE_MS on the client: a lobby hides a table whose host has not
# heartbeated for this long, so it cannot hold anybody either.
LUDO_ROOM_STALE_SECONDS = 90

LUDO_SETTING_DEFAULTS = {
    "ludoHostDeposit": 50,
    "ludoRateOnePlayer": 10,
    "ludoRateTwoPlayers": 12,
    "ludoRateThreePlayers": 15,
    "ludoHostSharePercent": 30,
    "ludoForfeitOnePlayer": 25,
    "ludoForfeitTwoPlayers": 15,
    "ludoForfeitThreePlayers": 10,
    "ludoWinnerPrize": 20,
    "ludoHostMaxLeaves": 3,
    "ludoHostMaxMissedTurns": 3,
    "ludoEmptyCloseMinutes": 5,
    "ludoWatchAppPerMinute": 6,
    "ludoWatchHostPerMinute": 4,
    "ludoWatchAppStepSeconds": 5,
    "ludoWatchHostStepSeconds": 15,
}

LUDO_SETTING_BOUNDS = {
    "ludoHostDeposit": (0, 10000),
    "ludoRateOnePlayer": (0, 10000),
    "ludoRateTwoPlayers": (0, 10000),
    "ludoRateThreePlayers": (0, 10000),
    "ludoHostSharePercent": (0, 100),
    "ludoForfeitOnePlayer": (0, 10000),
    "ludoForfeitTwoPlayers": (0, 10000),
    "ludoForfeitThreePlayers": (0, 10000),
    "ludoWinnerPrize": (0, 10000),
    "ludoHostMaxLeaves": (0, 100),
    "ludoHostMaxMissedTurns": (0, 100),
    "ludoEmptyCloseMinutes": (1, 120),
    "ludoWatchAppPerMinute": (0, 10000),
    "ludoWatchHostPerMinute": (0, 10000),
    "ludoWatchAppStepSeconds": (1, 60),
    "ludoWatchHostStepSeconds": (1, 60),
}

# Fields the per-minute logic may change; written back in one update.
LUDO_STATE_FIELDS = (
    'players', 'playerUids', 'activeMemberCount', 'tokens', 'currentTurn',
    'diceValue', 'diceRolled', 'consecutiveSixes', 'turnStartedAt', 'phase',
    'status', 'finishRank', 'winnersOrder', 'billedUntil', 'emptySince',
    'hostAway', 'hostLeaves', 'hostMissed', 'hostBenched', 'departedUids',
    'paidBy', 'hostEarned', 'lastActive', 'settled', 'settlement',
    'speakRequests', 'micGuests',
)


class LudoBusy(Exception):
    """The caller is already committed to another Ludo table."""

    def __init__(self, room_id):
        super().__init__("You're already in a Ludo game. Finish it before joining or opening another.")
        self.room_id = room_id


def ludo_terms(settings):
    """The rules a new per-minute table is played under."""
    def num(key):
        return float(settings.get(key, LUDO_SETTING_DEFAULTS[key]))
    return {
        "deposit": num("ludoHostDeposit"),
        "rates": {
            "1": num("ludoRateOnePlayer"),
            "2": num("ludoRateTwoPlayers"),
            "3": num("ludoRateThreePlayers"),
        },
        "hostSharePercent": num("ludoHostSharePercent"),
        "forfeitEach": {
            "1": num("ludoForfeitOnePlayer"),
            "2": num("ludoForfeitTwoPlayers"),
            "3": num("ludoForfeitThreePlayers"),
        },
        "winnerPrize": num("ludoWinnerPrize"),
        "hostMaxLeaves": int(num("ludoHostMaxLeaves")),
        "hostMaxMissed": int(num("ludoHostMaxMissedTurns")),
        "emptyCloseSecs": int(num("ludoEmptyCloseMinutes") * 60),
        # Watchers: 1 coin per started step to each side, capped per minute.
        "watch": {
            "appPerMinute": int(num("ludoWatchAppPerMinute")),
            "hostPerMinute": int(num("ludoWatchHostPerMinute")),
            "appStepSecs": int(num("ludoWatchAppStepSeconds")),
            "hostStepSecs": int(num("ludoWatchHostStepSeconds")),
        },
    }


def ludo_secs(value):
    """Epoch seconds for a stored time, or None for anything else."""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    if hasattr(value, 'timestamp'):
        try:
            return value.timestamp()
        except (TypeError, ValueError, OverflowError):
            return None
    return None


def ludo_is_per_minute(room):
    return (room or {}).get('gameMode') == LUDO_PER_MINUTE


def ludo_paying(room):
    """Seated players other than the host -- the ones who pay per minute."""
    host = room.get('hostUid')
    return [p for p in (room.get('players') or []) if (p or {}).get('uid') != host]


def ludo_rate(terms, count):
    if count <= 0:
        return 0.0
    return float((terms.get('rates') or {}).get(str(min(count, 3))) or 0)


def ludo_color_done(tokens, color):
    mine = [t for t in (tokens or []) if (t or {}).get('color') == color]
    return bool(mine) and all(t.get('position') == LUDO_FINISHED_POSITION for t in mine)


def ludo_room_holds(room, uid, now):
    """True while `room` still commits `uid`: they may not open or sit elsewhere.

    Judged from the room as it is now, rather than a flag that has to be
    cleared, so a table that died without anyone closing it -- every phone
    switched off -- lets its players go instead of locking them out for good.
    """
    if not room or room.get('status') != 'live' or room.get('settled'):
        return False
    phase = room.get('phase', 'waiting')
    if phase == 'finished':
        return False
    is_host = room.get('hostUid') == uid
    seated = uid in (room.get('playerUids') or [])
    departed = uid in (room.get('departedUids') or [])
    if not (is_host or seated or departed):
        return False
    if phase == 'waiting':
        beat = ludo_secs(room.get('hostLastSeen'))
        return beat is not None and now - beat <= LUDO_ROOM_STALE_SECONDS
    turn = ludo_secs(room.get('turnStartedAt'))
    if turn is not None and now - turn > LUDO_DEAD_TABLE_SECONDS:
        return False
    empty = ludo_secs(room.get('emptySince'))
    close_after = int((room.get('terms') or {}).get('emptyCloseSecs') or 300)
    if empty is not None and now - empty > close_after:
        return False
    if seated and not is_host:
        me = next((p for p in room.get('players') or [] if (p or {}).get('uid') == uid), None)
        if me and ludo_color_done(room.get('tokens'), me.get('color')):
            return False
    return True


class LudoLedger:
    """Coin changes for one transaction: every balance is read before any write."""

    def __init__(self, transaction, db_client):
        self._transaction = transaction
        self._db = db_client
        self._balances = {}
        self._deltas = {}

    def _ref(self, uid):
        return self._db.collection('users').document(uid)

    def balance(self, uid):
        if uid not in self._balances:
            self._balances[uid] = get_coin_balance(self._ref(uid).get(transaction=self._transaction))
        return self._balances[uid] + self._deltas.get(uid, 0.0)

    def add(self, uid, amount):
        if not uid or not amount:
            return
        self.balance(uid)
        self._deltas[uid] = round(self._deltas.get(uid, 0.0) + amount, 2)

    def write(self, extra=None):
        for uid, delta in self._deltas.items():
            if delta:
                fields = {"coins": round(self._balances[uid] + delta, 2)}
                fields.update((extra or {}).get(uid) or {})
                self._transaction.update(self._ref(uid), fields)
        for uid, fields in (extra or {}).items():
            if not self._deltas.get(uid):
                self._transaction.update(self._ref(uid), fields)


def ludo_check_lock(transaction, db_client, uid, user_data, this_room_id, now, ledger=None):
    """Raise LudoBusy if `uid` is still committed to a different table.

    A waiting per-minute table its own host abandoned is closed on the way
    past, and the deposit refunded -- otherwise that host would have paid 50
    for a table nobody could ever play at. Returns the writes that takes, for
    the caller to make after its own reads.
    """
    other_id = (user_data or {}).get('activeLudoRoomId')
    if not other_id or other_id == this_room_id:
        return []
    other_ref = db_client.collection('ludo_rooms').document(other_id)
    other_snap = other_ref.get(transaction=transaction)
    if not other_snap.exists:
        return []
    other = other_snap.to_dict() or {}
    if ludo_room_holds(other, uid, now):
        raise LudoBusy(other_id)
    abandoned_deposit = (
        ledger is not None and ludo_is_per_minute(other) and other.get('hostUid') == uid
        and other.get('phase', 'waiting') == 'waiting' and other.get('status') == 'live'
        and not other.get('settled')
    )
    if not abandoned_deposit:
        return []
    deposit = float((other.get('terms') or {}).get('deposit') or 0)
    ledger.add(uid, deposit)
    return [(other_ref, {
        "status": "closed",
        "phase": "finished",
        "settled": True,
        "settlement": {"refund": {uid: deposit}, "reason": "closed_before_start"},
    })]


def ludo_next_color(room, current, players, tokens, gone=()):
    """Next colour to play, passing over finished colours, a benched host and `gone`."""
    host = room.get('hostUid')
    benched = room.get('hostBenched')
    order = [(p or {}).get('color') for p in players]
    live = [
        (p or {}).get('color') for p in players
        if not ludo_color_done(tokens, (p or {}).get('color'))
        and not (benched and (p or {}).get('uid') == host)
        and (p or {}).get('color') not in gone
    ]
    if not live:
        return current
    if current in order:
        start = order.index(current)
        for step in range(1, len(order) + 1):
            colour = order[(start + step) % len(order)]
            if colour in live:
                return colour
    return live[0]


def ludo_new_turn(room, colour, now_dt):
    room.update({
        "currentTurn": colour,
        "diceValue": None,
        "diceRolled": False,
        "consecutiveSixes": 0,
        "turnStartedAt": now_dt,
    })


def ludo_settle(room, ledger, reason):
    """Pay out a per-minute game once: forfeited deposit, then the winner's bonus."""
    if room.get('settled'):
        return
    terms = room.get('terms') or {}
    deposit = float(terms.get('deposit') or 0)
    paying = [p.get('uid') for p in ludo_paying(room) if p.get('uid')]
    to_players = {}
    if room.get('hostBenched') and paying:
        count = len(paying)
        each = float((terms.get('forfeitEach') or {}).get(str(min(count, 3))) or 0)
        # A setting edited past the deposit must not mint coins.
        # Rounded down: rounding up paid out 50.01 from a deposit of 50.
        each = math.floor(min(each, deposit / count) * 100) / 100
        for uid in paying:
            to_players[uid] = each
            ledger.add(uid, each)
    prize = None
    winners = list(room.get('winnersOrder') or [])
    amount = float(terms.get('winnerPrize') or 0)
    if winners and amount > 0:
        prize = {"uid": winners[0], "amount": amount}
        ledger.add(winners[0], amount)
    room['settled'] = True
    room['settlement'] = {
        "reason": reason,
        "deposit": deposit,
        "depositToPlayers": to_players,
        "depositToApp": round(deposit - sum(to_players.values()), 2),
        "prize": prize,
    }


def ludo_finish(room, ledger, reason, now_dt):
    room['phase'] = 'finished'
    room['diceRolled'] = False
    room['diceValue'] = None
    ludo_settle(room, ledger, reason)


def ludo_update_empty(room, now_dt):
    """Pause the board when the last player goes; resume when one sits down."""
    if room.get('phase') != 'playing':
        return
    if not ludo_paying(room):
        if not room.get('emptySince'):
            room['emptySince'] = now_dt
    elif room.get('emptySince'):
        room['emptySince'] = None
        room['billedUntil'] = None
        room['turnStartedAt'] = now_dt


def ludo_maybe_finish(room, ledger, now_dt):
    """End the game once at most one colour is still racing."""
    if room.get('phase') != 'playing' or not ludo_paying(room):
        return
    players = room.get('players') or []
    racing = [p for p in players if not ludo_color_done(room.get('tokens'), (p or {}).get('color'))]
    if len(racing) <= 1 and room.get('winnersOrder'):
        ludo_finish(room, ledger, 'game_over', now_dt)


def ludo_remove_player(room, uid, now_dt):
    """Take a player out of a game in progress. They stay committed to it."""
    players = list(room.get('players') or [])
    me = next((p for p in players if (p or {}).get('uid') == uid), None)
    if not me:
        return
    colour = me.get('color')
    remaining = [p for p in players if p is not me]
    room['players'] = remaining
    room['playerUids'] = [p.get('uid') for p in remaining if p.get('uid')]
    room['activeMemberCount'] = len(remaining)
    if room.get('phase') == 'playing':
        departed = list(room.get('departedUids') or [])
        if uid not in departed:
            departed.append(uid)
        room['departedUids'] = departed
        # Their pawns leave the board rather than sit in everybody's way.
        room['tokens'] = [
            dict(t, position=LUDO_BASE_POSITION) if (t or {}).get('color') == colour else t
            for t in room.get('tokens') or []
        ]
        if room.get('currentTurn') == colour:
            nxt = ludo_next_color(room, colour, players, room['tokens'], gone=(colour,))
            ludo_new_turn(room, nxt, now_dt)


def ludo_host_left(room, now_dt):
    """Count one departure of the host from a game in progress."""
    if room.get('hostAway'):
        return
    room['hostAway'] = True
    # Leaving an empty, paused table to fetch friends is free.
    if room.get('phase') != 'playing' or room.get('emptySince') or room.get('settled'):
        return
    room['hostLeaves'] = int(room.get('hostLeaves') or 0) + 1
    limit = int((room.get('terms') or {}).get('hostMaxLeaves') or 0)
    if room['hostLeaves'] > limit:
        ludo_bench_host(room, now_dt)


def ludo_bench_host(room, now_dt):
    if room.get('hostBenched'):
        return
    room['hostBenched'] = True
    host = room.get('hostUid')
    me = next((p for p in room.get('players') or [] if (p or {}).get('uid') == host), None)
    if me and room.get('currentTurn') == me.get('color'):
        nxt = ludo_next_color(room, me.get('color'), room.get('players') or [], room.get('tokens'))
        ludo_new_turn(room, nxt, now_dt)


def ludo_mark_active(room, uid, now):
    active = dict(room.get('lastActive') or {})
    active[uid] = now
    room['lastActive'] = active


def ludo_bill(transaction, db_client, room_ref, room, ledger, now, now_dt):
    """Charge the minute that has come due, if one has. Mutates `room`."""
    if (room.get('phase') != 'playing' or room.get('settled') or room.get('emptySince')
            or not ludo_is_per_minute(room)):
        return
    due = ludo_secs(room.get('billedUntil'))
    if due is not None and now < due:
        return
    terms = room.get('terms') or {}
    paying = ludo_paying(room)
    rate = ludo_rate(terms, len(paying))
    share_pct = 0.0 if room.get('hostBenched') else float(terms.get('hostSharePercent') or 0)
    host = room.get('hostUid')
    last_active = room.get('lastActive') or {}
    paid_by = dict(room.get('paidBy') or {})
    host_earned = float(room.get('hostEarned') or 0)
    broke = []
    for player in paying:
        uid = player.get('uid')
        seen = ludo_secs(last_active.get(uid))
        member = room_ref.collection('members').document(uid).get(transaction=transaction)
        if member.exists:
            beat = ludo_secs((member.to_dict() or {}).get('lastSeen'))
            if beat is not None and (seen is None or beat > seen):
                seen = beat
        if seen is None or now - seen > LUDO_PRESENT_SECONDS:
            continue
        if ledger.balance(uid) < rate:
            broke.append(uid)
            continue
        ledger.add(uid, -rate)
        paid_by[uid] = round(float(paid_by.get(uid) or 0) + rate, 2)
        cut = round(rate * share_pct / 100.0, 2)
        if cut and host:
            ledger.add(host, cut)
            host_earned = round(host_earned + cut, 2)
    room['paidBy'] = paid_by
    room['hostEarned'] = host_earned
    # A gap with nobody asking (every phone asleep) is not billed in arrears.
    start = due if due is not None and now - due < LUDO_BILL_SECONDS else now
    room['billedUntil'] = datetime.fromtimestamp(start + LUDO_BILL_SECONDS, timezone.utc)
    for uid in broke:
        ludo_remove_player(room, uid, now_dt)
    ludo_update_empty(room, now_dt)
    ludo_maybe_finish(room, ledger, now_dt)


def ludo_housekeeping(transaction, db_client, room_ref, room, ledger, now, now_dt):
    """Everything time alone moves on: host gone quiet, empty table closing, the minute bill."""
    if not ludo_is_per_minute(room) or room.get('settled'):
        return
    if room.get('phase') == 'playing':
        beat = ludo_secs(room.get('hostLastSeen'))
        if beat is not None and now - beat > LUDO_HOST_AWAY_SECONDS:
            ludo_host_left(room, now_dt)
        empty = ludo_secs(room.get('emptySince'))
        close_after = int((room.get('terms') or {}).get('emptyCloseSecs') or 300)
        if empty is not None and now - empty > close_after:
            ludo_finish(room, ledger, 'empty_table', now_dt)
            room['status'] = 'closed'
            return
    ludo_bill(transaction, db_client, room_ref, room, ledger, now, now_dt)


def ludo_write_state(transaction, room_ref, before, room):
    changed = {k: room[k] for k in LUDO_STATE_FIELDS if k in room and room.get(k) != before.get(k)}
    if changed:
        transaction.update(room_ref, changed)


def ludo_busy_response(e):
    return jsonify({"error": str(e), "code": "ludo_busy", "roomId": e.room_id}), 409


@app.route('/api/v1/ludo/tick', methods=['POST', 'OPTIONS'])
def ludo_tick_endpoint():
    """Keep a per-minute table's clock honest.

    Every phone at the table calls this about every quarter of a minute (and
    the host once more, with `here: false`, on stepping away). Whichever call
    lands first does the work; the rest find nothing due. Nothing here trusts
    the caller beyond whether *they* are at the table.
    """
    if request.method == 'OPTIONS':
        return '', 200
    uid, error_response = require_bearer_uid()
    if error_response:
        return error_response
    data = request.json or {}
    room_id = str(data.get('roomId') or '').strip()
    here = data.get('here', True) is not False
    if not room_id:
        return jsonify({"error": "Missing roomId"}), 400
    try:
        db_client = firestore.client()
        room_ref = db_client.collection('ludo_rooms').document(room_id)
        transaction = db_client.transaction()

        @firestore.transactional
        def apply(transaction):
            snap = room_ref.get(transaction=transaction)
            if not snap.exists:
                raise ValueError("Unknown room")
            before = snap.to_dict() or {}
            if not ludo_is_per_minute(before):
                return before
            room = copy.deepcopy(before)
            now = time.time()
            now_dt = datetime.fromtimestamp(now, timezone.utc)
            ledger = LudoLedger(transaction, db_client)
            if room.get('hostUid') == uid and room.get('phase') == 'playing':
                if here:
                    room['hostAway'] = False
                else:
                    ludo_host_left(room, now_dt)
            elif here and uid in (room.get('playerUids') or []):
                ludo_mark_active(room, uid, now_dt)
            ludo_housekeeping(transaction, db_client, room_ref, room, ledger, now, now_dt)
            ledger.write()
            ludo_write_state(transaction, room_ref, before, room)
            return room

        room = apply(transaction)
        return jsonify({
            "ok": True,
            "phase": room.get('phase'),
            "billedUntil": ludo_secs(room.get('billedUntil')),
            "hostBenched": bool(room.get('hostBenched')),
        }), 200
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        print(f"[LUDO] Tick error: {e}")
        return jsonify({"error": "Could not update the table"}), 500


class LudoWatchBroke(Exception):
    """A watcher cannot pay for what they are watching."""


def ludo_watch_due(secs, watch):
    """What `secs` (0-60) of one minute's watching costs, as (app, host).

    Each side takes 1 coin per started step, up to its cap for the minute:
    20 seconds is 4 to the app (5-second steps) and 2 to the host (15-second
    steps); a full minute is exactly the two caps, 6 + 4.
    """
    secs = int(secs)

    def part(per_minute, step):
        if secs <= 0 or per_minute <= 0:
            return 0
        return min(int(per_minute), math.ceil(secs / max(1, int(step))))

    return (part(watch.get('appPerMinute', 0), watch.get('appStepSecs', 5)),
            part(watch.get('hostPerMinute', 0), watch.get('hostStepSecs', 15)))


def ludo_watch_billable(room):
    """Watchers pay only while a game is being played at a table with players."""
    return (room.get('phase') == 'playing' and not room.get('emptySince')
            and not room.get('settled') and room.get('status', 'live') == 'live')


def ludo_watch_settle(room, state, ledger, uid, now):
    """Bring one watcher's bill up to `now`. Mutates `room` and `state`.

    `state` is the watcher's own record: when they last reported, how many
    seconds of the current minute they have watched, and what that minute has
    taken so far. Raises LudoWatchBroke, charging nothing, if they cannot pay.
    """
    watch = (room.get('terms') or {}).get('watch') or {}
    last = ludo_secs(state.get('last'))
    state['last'] = now
    if last is None or not watch or not ludo_watch_billable(room):
        return 0
    elapsed = now - last
    # A phone that went quiet (asleep, killed, out of signal) is not billed for
    # the silence at all, so a watcher coming back later never pays for it.
    if elapsed <= 0 or elapsed > LUDO_WATCH_GAP_SECONDS:
        return 0
    window = float(state.get('windowSecs') or 0) + elapsed
    app_paid = int(state.get('appPaid') or 0)
    host_paid = int(state.get('hostPaid') or 0)
    app_due = host_due = 0
    while window >= LUDO_BILL_SECONDS:
        full_app, full_host = ludo_watch_due(LUDO_BILL_SECONDS, watch)
        app_due += max(0, full_app - app_paid)
        host_due += max(0, full_host - host_paid)
        app_paid = host_paid = 0
        window -= LUDO_BILL_SECONDS
    now_app, now_host = ludo_watch_due(window, watch)
    app_due += max(0, now_app - app_paid)
    host_due += max(0, now_host - host_paid)
    total = app_due + host_due
    if total and ledger.balance(uid) < total:
        raise LudoWatchBroke()
    ledger.add(uid, -total)
    host = room.get('hostUid')
    if host_due and host and not room.get('hostBenched'):
        ledger.add(host, host_due)
        room['hostEarned'] = round(float(room.get('hostEarned') or 0) + host_due, 2)
    state.update(windowSecs=round(window, 3), appPaid=max(app_paid, now_app),
                 hostPaid=max(host_paid, now_host),
                 paid=round(float(state.get('paid') or 0) + total, 2))
    return total


@app.route('/api/v1/ludo/watch', methods=['POST', 'OPTIONS'])
def ludo_watch_endpoint():
    """A watcher's phone reporting in, every 15 seconds and once on leaving.

    Each call bills the seconds watched since the last one. Coming in to a game
    being played needs a minute's coins; `here: false` settles and lets go.
    Seated players and the host are not watchers and are never charged here.
    """
    if request.method == 'OPTIONS':
        return '', 200
    uid, error_response = require_bearer_uid()
    if error_response:
        return error_response
    data = request.json or {}
    room_id = str(data.get('roomId') or '').strip()
    here = data.get('here', True) is not False
    if not room_id:
        return jsonify({"error": "Missing roomId"}), 400
    try:
        db_client = firestore.client()
        room_ref = db_client.collection('ludo_rooms').document(room_id)
        watcher_ref = room_ref.collection('watchers').document(uid)
        transaction = db_client.transaction()

        @firestore.transactional
        def apply(transaction):
            snap = room_ref.get(transaction=transaction)
            if not snap.exists:
                raise ValueError("Unknown room")
            before = snap.to_dict() or {}
            if (not ludo_is_per_minute(before) or uid == before.get('hostUid')
                    or uid in (before.get('playerUids') or [])):
                return {"watching": False}
            watcher = watcher_ref.get(transaction=transaction)
            state = (watcher.to_dict() or {}) if watcher.exists else {}
            room = copy.deepcopy(before)
            now = time.time()
            ledger = LudoLedger(transaction, db_client)
            watch = (room.get('terms') or {}).get('watch') or {}
            minute = sum(ludo_watch_due(LUDO_BILL_SECONDS, watch))
            if here and not watcher.exists and ludo_watch_billable(room) and ledger.balance(uid) < minute:
                raise LudoWatchBroke()
            charged = ludo_watch_settle(room, state, ledger, uid, now)
            if not here:
                ludo_drop_speaker(room, uid)
            ledger.write()
            ludo_write_state(transaction, room_ref, before, room)
            if here:
                transaction.set(watcher_ref, state)
            else:
                transaction.delete(watcher_ref)
            return {"watching": here, "charged": charged,
                    "paid": float(state.get('paid') or 0), "perMinute": minute}

        result = apply(transaction)
        return jsonify({"ok": True, **result}), 200
    except LudoWatchBroke:
        return jsonify({
            "error": "Not enough coins to keep watching. Watching costs coins each minute.",
            "code": "watch_coins",
        }), 402
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        print(f"[LUDO] Watch error: {e}")
        return jsonify({"error": "Could not update the table"}), 500


LUDO_SPEAK_ACTIONS = ('request', 'cancel', 'accept', 'decline', 'remove')


def ludo_drop_speaker(room, uid):
    """Forget a watcher's mic request and mic. Mutates `room`."""
    for field in ('speakRequests', 'micGuests'):
        entries = dict(room.get(field) or {})
        if uid in entries:
            entries.pop(uid)
            room[field] = entries


@app.route('/api/v1/ludo/speak', methods=['POST', 'OPTIONS'])
def ludo_speak_endpoint():
    """Watchers have no mic. They ask the host for one; the host decides.

    `request` / `cancel` are the watcher's (cancel also hands a mic back);
    `accept` / `decline` / `remove` are the host's, naming `targetUid`. The host's
    list is ordered by what each watcher has given at this table (see
    giftTotals, kept by /coins/transfer), so a bigger gifter is asked first.
    """
    if request.method == 'OPTIONS':
        return '', 200
    uid, error_response = require_bearer_uid()
    if error_response:
        return error_response
    data = request.json or {}
    room_id = str(data.get('roomId') or '').strip()
    action = str(data.get('action') or '').strip()
    target = str(data.get('targetUid') or '').strip()
    if not room_id or action not in LUDO_SPEAK_ACTIONS:
        return jsonify({"error": "Missing roomId or action"}), 400
    try:
        db_client = firestore.client()
        room_ref = db_client.collection('ludo_rooms').document(room_id)
        transaction = db_client.transaction()

        @firestore.transactional
        def apply(transaction):
            snap = room_ref.get(transaction=transaction)
            if not snap.exists:
                raise ValueError("Unknown room")
            before = snap.to_dict() or {}
            if not ludo_is_per_minute(before) or before.get('status') != 'live' or before.get('settled'):
                raise ValueError("This table is not taking requests")
            host = before.get('hostUid')
            seated = set(before.get('playerUids') or [])
            requests = dict(before.get('speakRequests') or {})
            guests = dict(before.get('micGuests') or {})
            if action in ('request', 'cancel'):
                if uid == host or uid in seated:
                    raise ValueError("Players already have a mic")
                if action == 'request':
                    if uid not in guests:
                        requests[uid] = {
                            "nickname": str(data.get('nickname') or 'Guest')[:40],
                            "avatarData": data.get('avatarData'),
                            "at": datetime.now(timezone.utc),
                        }
                else:
                    requests.pop(uid, None)
                    guests.pop(uid, None)
            else:
                if uid != host:
                    raise PermissionError("Only the host decides who gets a mic")
                if not target:
                    raise ValueError("Missing targetUid")
                if action == 'accept':
                    asked = requests.pop(target, None)
                    if asked is None:
                        raise ValueError("That request has gone")
                    guests[target] = {"nickname": asked.get('nickname'), "avatarData": asked.get('avatarData')}
                elif action == 'decline':
                    requests.pop(target, None)
                else:
                    guests.pop(target, None)
            changed = {}
            if requests != (before.get('speakRequests') or {}):
                changed['speakRequests'] = requests
            if guests != (before.get('micGuests') or {}):
                changed['micGuests'] = guests
            if changed:
                transaction.update(room_ref, changed)
            return {"requested": uid in requests, "onMic": uid in guests}

        return jsonify({"ok": True, **apply(transaction)}), 200
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        print(f"[LUDO] Speak error: {e}")
        return jsonify({"error": "Could not update the request"}), 500


# ==========================================
# LUDO: TABLE CODES, PRIVATE TABLES AND SHARE LINKS
# ==========================================
#
# Every table gets a short code. A private table is left out of the lobby, so
# the code -- typed in, or inside a link -- is how friends reach it. The link
# is an ordinary https address (WhatsApp will not make an app scheme
# clickable) whose page hands the phone to the app through Android's intent
# URL, or to the store when the app is not installed. The installed app
# already accepts the exp+gengal:// scheme, so this needs no new build.

LUDO_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"   # no 0/O, 1/I/L
LUDO_CODE_LENGTH = 6
APP_LINK_SCHEME = "exp+gengal"
APP_PACKAGE = "com.revanth_fk.x.GenGal"
PLAY_STORE_URL = f"https://play.google.com/store/apps/details?id={APP_PACKAGE}"


def ludo_normalize_code(raw):
    code = re.sub(r'[^A-Za-z0-9]', '', str(raw or '')).upper()
    return code if len(code) == LUDO_CODE_LENGTH and all(c in LUDO_CODE_ALPHABET for c in code) else None


def ludo_live_by_code(db_client, code):
    """The live table with this code, as (id, room), or (None, None)."""
    for snap in db_client.collection('ludo_rooms').where('code', '==', code).stream():
        room = snap.to_dict() or {}
        if room.get('status') == 'live':
            return snap.id, room
    return None, None


def ludo_new_code(db_client):
    """A code no live table is using."""
    for _ in range(10):
        code = ''.join(secrets.choice(LUDO_CODE_ALPHABET) for _ in range(LUDO_CODE_LENGTH))
        if ludo_live_by_code(db_client, code)[0] is None:
            return code
    raise ValueError("Could not make a table code. Try again.")


@app.route('/api/v1/ludo/find', methods=['POST', 'OPTIONS'])
def ludo_find_endpoint():
    """A table by its code, for "Join with code" and opened links."""
    if request.method == 'OPTIONS':
        return '', 200
    _, error_response = require_bearer_uid()
    if error_response:
        return error_response
    code = ludo_normalize_code((request.json or {}).get('code'))
    if not code:
        return jsonify({"error": f"A table code is {LUDO_CODE_LENGTH} letters and numbers."}), 400
    room_id, room = ludo_live_by_code(firestore.client(), code)
    if not room_id:
        return jsonify({"error": "No open table has that code. It may have ended.", "code": "no_table"}), 404
    host = next((p for p in room.get('players') or [] if (p or {}).get('uid') == room.get('hostUid')), {}) or {}
    return jsonify({
        "ok": True, "roomId": room_id, "private": bool(room.get('private')),
        "hostName": host.get('nickname') or 'Host', "phase": room.get('phase'),
    }), 200


LUDO_LINK_PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta property="og:title" content="{title}">
<meta property="og:description" content="Tap to open the table in GenGal. Seats are free.">
<style>
  body {{ margin:0; font-family: system-ui, -apple-system, Roboto, sans-serif; background:#FBF6EC; color:#2B1B2E;
         min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; box-sizing:border-box; }}
  .card {{ background:#fff; border-radius:24px; padding:28px 22px; max-width:380px; width:100%; text-align:center;
          box-shadow:0 10px 30px rgba(75,0,84,.12); }}
  h1 {{ font-size:22px; margin:6px 0 8px; }} p {{ color:#6E5F52; line-height:1.45; margin:0 0 18px; }}
  .code {{ font-size:30px; letter-spacing:6px; font-weight:800; margin:4px 0 20px; color:#4B0054; }}
  a.btn {{ display:block; text-decoration:none; padding:15px; border-radius:16px; font-weight:800; margin-top:10px; }}
  .open {{ background:#1B6B35; color:#fff; }} .get {{ border:1.5px solid #4B0054; color:#4B0054; }}
  small {{ display:block; color:#9A8772; margin-top:16px; }}
</style></head>
<body><div class="card">
  <div style="font-size:44px">&#127922;</div>
  <h1>{title}</h1>
  <p>{status}</p>
  <div class="code">{code}</div>
  <a class="btn open" href="{intent}">Open in GenGal</a>
  <a class="btn get" href="{store}">Get GenGal</a>
  <small>Already have the app? Open GenGal, go to Chill &rarr; Ludo &rarr; Join with code, and type the code.</small>
</div>
<script>
  // Try the app straight away; the buttons stay for when the browser blocks it.
  if (/Android/i.test(navigator.userAgent)) {{ setTimeout(function () {{ location.href = {intent_js}; }}, 300); }}
</script>
</body></html>"""


@app.route('/ludo/<raw_code>', methods=['GET'])
def ludo_link_page(raw_code):
    """The page a shared table link opens. Public: it shows only the host's
    first name, whether the table is still open, and the code."""
    code = ludo_normalize_code(raw_code)
    if not code:
        return "That is not a GenGal table link.", 404
    room_id, room = ludo_live_by_code(firestore.client(), code)
    if room_id:
        host = next((p for p in room.get('players') or [] if (p or {}).get('uid') == room.get('hostUid')), {}) or {}
        name = html.escape(str(host.get('nickname') or 'A friend')[:40])
        title = f"{name}'s Ludo table"
        status = ("Join the game: seats are free, players pay per minute once it starts."
                  if room.get('phase') == 'waiting' else "A game is on. Open it to watch, or wait for a free seat.")
    else:
        title = "This Ludo table has ended"
        status = "Ask your friend for a new link, or open GenGal to find another table."
    intent = (f"intent://ludo?code={code}#Intent;scheme={APP_LINK_SCHEME};package={APP_PACKAGE};"
              f"S.browser_fallback_url={urllib.parse.quote(PLAY_STORE_URL, safe='')};end")
    page = LUDO_LINK_PAGE.format(
        title=title, status=status, code=code, intent=html.escape(intent),
        intent_js=json.dumps(intent) if room_id else '""', store=PLAY_STORE_URL,
    )
    if not room_id:
        page = page.replace('setTimeout(function () { location.href = ""; }, 300);', '')
    return page, 200, {"Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store"}


def ludo_live_colours(room):
    host = room.get('hostUid')
    return [
        (p or {}).get('color') for p in room.get('players') or []
        if not ludo_color_done(room.get('tokens'), (p or {}).get('color'))
        and not (room.get('hostBenched') and (p or {}).get('uid') == host)
    ]


def ludo_take_free_seat(transaction, db_client, room_ref, room, uid, color, nickname, avatar_data):
    """Seat somebody at a per-minute table. Returns the buy-ticket result tuple.

    Free to sit; the first minute is what it costs, so the player must be able
    to cover it. Before the game anyone may sit. Once it is under way a seat
    can only be taken while the table is paused for want of players -- the
    host's friends arriving -- so nobody's rate changes in the middle of play.
    """
    phase = room.get('phase', 'waiting')
    paused = phase == 'playing' and bool(room.get('emptySince')) and not room.get('settled')
    if phase != 'waiting' and not paused:
        raise ValueError("This game has already started.")
    players = list(room.get('players') or [])
    if uid == room.get('hostUid') or any((p or {}).get('uid') == uid for p in players):
        raise ValueError("Already seated")
    if len(players) >= len(LUDO_SEAT_COLORS):
        raise ValueError("The table is full.")
    if any((p or {}).get('color') == color for p in players):
        raise ValueError("Color already taken")

    now = time.time()
    now_dt = datetime.fromtimestamp(now, timezone.utc)
    user_ref = db_client.collection('users').document(uid)
    user_snap = user_ref.get(transaction=transaction)
    if not user_snap.exists:
        raise ValueError("User does not exist")
    ledger = LudoLedger(transaction, db_client)
    lock_writes = ludo_check_lock(
        transaction, db_client, uid, user_snap.to_dict(), room_ref.id, now, ledger,
    )
    terms = room.get('terms') or {}
    rate = ludo_rate(terms, len(ludo_paying(room)) + 1)
    if ledger.balance(uid) < rate:
        raise ValueError("You need at least %g coins to play a minute." % rate)

    seated = copy.deepcopy(room)
    seated['players'] = players + [{
        "uid": uid,
        "nickname": nickname,
        "avatarData": avatar_data if isinstance(avatar_data, dict) else None,
        "color": color,
        "isHost": False,
        "isOnline": True,
        "score": 0,
    }]
    seated['playerUids'] = [p.get('uid') for p in seated['players'] if p.get('uid')]
    seated['activeMemberCount'] = len(seated['players'])
    if paused:
        # A colour taken mid-game starts from its yard, whoever had it before.
        seated['tokens'] = [
            dict(t, position=LUDO_BASE_POSITION) if (t or {}).get('color') == color else t
            for t in seated.get('tokens') or []
        ]
        ludo_mark_active(seated, uid, now_dt)
        ludo_update_empty(seated, now_dt)
        if seated.get('currentTurn') not in ludo_live_colours(seated):
            ludo_new_turn(seated, ludo_next_color(
                seated, seated.get('currentTurn'), seated['players'], seated.get('tokens'),
            ), now_dt)
        ludo_bill(transaction, db_client, room_ref, seated, ledger, now, now_dt)

    ledger.write(extra={uid: {"activeLudoRoomId": room_ref.id}})
    for ref, fields in lock_writes:
        transaction.update(ref, fields)
    ludo_write_state(transaction, room_ref, room, seated)
    return ledger.balance(uid), None, 0, 0


def ludo_leave_per_minute(transaction, db_client, room_ref, room, uid):
    """Somebody leaving a per-minute table. Returns whether a seat changed.

    The host walking away from a game in progress is not leaving: the game
    goes on and the departure is counted against their three. Before the game
    starts the host leaving closes the table and returns the deposit.
    """
    now = time.time()
    now_dt = datetime.fromtimestamp(now, timezone.utc)
    ledger = LudoLedger(transaction, db_client)
    after = copy.deepcopy(room)
    phase = room.get('phase', 'waiting')
    changed = False
    if uid == room.get('hostUid'):
        if phase == 'waiting' and not room.get('settled') and room.get('status') == 'live':
            deposit = float((room.get('terms') or {}).get('deposit') or 0)
            ledger.add(uid, deposit)
            after.update({
                "status": "closed",
                "phase": "finished",
                "settled": True,
                "settlement": {"refund": {uid: deposit}, "reason": "closed_before_start"},
            })
            changed = True
        elif phase == 'playing':
            ludo_host_left(after, now_dt)
        elif phase == 'finished' and room.get('status') == 'live':
            # The game is over and paid out; the host leaving clears the
            # table from the lobby.
            after['status'] = 'closed'
            changed = True
    elif uid in (room.get('playerUids') or []):
        ludo_remove_player(after, uid, now_dt)
        ludo_update_empty(after, now_dt)
        ludo_maybe_finish(after, ledger, now_dt)
        changed = True
    ledger.write()
    ludo_write_state(transaction, room_ref, room, after)
    return changed


def ludo_skip_per_minute(transaction, db_client, room_ref, room, dead_roll):
    """Retire the current turn of a per-minute game. Returns the next colour.

    A benched host's turn passes at once. A host's turn that simply ran out
    counts against their three missed turns.
    """
    if room.get('emptySince'):
        raise LookupError("The table is paused until a player sits down")
    now = time.time()
    now_dt = datetime.fromtimestamp(now, timezone.utc)
    host = room.get('hostUid')
    host_colour = next(
        ((p or {}).get('color') for p in room.get('players') or [] if (p or {}).get('uid') == host),
        None,
    )
    current = room.get('currentTurn')
    benched_turn = bool(room.get('hostBenched')) and current == host_colour
    timed_out = not dead_roll and not benched_turn
    if timed_out:
        started = ludo_secs(room.get('turnStartedAt'))
        if started is None:
            raise ValueError("Turn has no start time")
        timeout_secs = int(room.get('turnTimeoutSecs') or 15)
        if now < started + timeout_secs + LUDO_SKIP_GRACE_SECONDS:
            raise LookupError("Turn is still live")

    after = copy.deepcopy(room)
    if timed_out and host_colour and current == host_colour:
        after['hostMissed'] = int(room.get('hostMissed') or 0) + 1
        limit = int((room.get('terms') or {}).get('hostMaxMissed') or 0)
        if after['hostMissed'] > limit:
            # Benching passes the turn on by itself.
            ludo_bench_host(after, now_dt)
    if after.get('currentTurn') == current:
        nxt = ludo_next_color(after, current, after.get('players') or [], after.get('tokens'))
        ludo_new_turn(after, nxt, now_dt)
    ledger = LudoLedger(transaction, db_client)
    ludo_housekeeping(transaction, db_client, room_ref, after, ledger, now, now_dt)
    ledger.write()
    ludo_write_state(transaction, room_ref, room, after)
    return after.get('currentTurn')


def ludo_apply_move(tokens, token_id, dice):
    """Port of applyMove. Returns (tokens, captured_id, finished, from, to) or None."""
    tokens = [dict(t or {}) for t in (tokens or [])]
    index = next((i for i, t in enumerate(tokens) if t.get('id') == token_id), None)
    if index is None:
        return None
    token = tokens[index]
    from_pos = token.get('position')
    new_pos = ludo_new_position(token, dice)
    if new_pos is None:
        return None
    token['position'] = new_pos

    captured = None
    on_main_track = 0 <= new_pos < LUDO_HOME_COLUMN_START
    if on_main_track and new_pos not in LUDO_SAFE_CELLS:
        for other in tokens:
            if (other.get('id') != token_id and other.get('color') != token.get('color')
                    and other.get('position') == new_pos):
                captured = other.get('id')
                other['position'] = LUDO_BASE_POSITION
                break
    return tokens, captured, new_pos == LUDO_FINISHED_POSITION, from_pos, new_pos


def ludo_opening_color(players):
    """Red opens, as it always has -- or the first seat if red has left."""
    colors = [(p or {}).get('color') for p in players]
    return 'red' if 'red' in colors else (colors[0] if colors else 'red')


@app.route('/api/v1/ludo/start', methods=['POST', 'OPTIONS'])
def ludo_start_endpoint():
    """Deal a fresh board and open play. Host only.

    A direct write before, which let the host start a game with the pieces
    anywhere it liked. On a per-minute table the first minute is charged here,
    in the same write that opens play.
    """
    if request.method == 'OPTIONS':
        return '', 200
    uid, error_response = require_bearer_uid()
    if error_response:
        return error_response

    room_id = str((request.json or {}).get('roomId') or '').strip()
    if not room_id:
        return jsonify({"error": "Missing roomId"}), 400

    try:
        db_client = firestore.client()
        room_ref = db_client.collection('ludo_rooms').document(room_id)
        transaction = db_client.transaction()

        @firestore.transactional
        def apply(transaction):
            snap = room_ref.get(transaction=transaction)
            if not snap.exists:
                raise ValueError("Unknown room")
            room = snap.to_dict() or {}
            if room.get('hostUid') != uid:
                raise PermissionError("Only the host can start the game")
            if room.get('status') == 'closed':
                raise ValueError("This table has closed.")
            if room.get('phase', 'waiting') != 'waiting':
                raise ValueError("This game has already started.")
            players = list(room.get('players') or [])
            if len(players) < 2:
                raise ValueError("At least one more player needs to take a seat.")
            now = time.time()
            now_dt = datetime.fromtimestamp(now, timezone.utc)
            after = copy.deepcopy(room)
            after.update({
                "phase": "playing",
                "currentTurn": ludo_opening_color(players),
                "diceValue": None,
                "diceRolled": False,
                "consecutiveSixes": 0,
                "turnStartedAt": now_dt,
                "tokens": build_initial_ludo_tokens(),
                "players": [dict(p or {}, score=0) for p in players],
                "finishRank": 1,
                "winnersOrder": [],
            })
            ledger = LudoLedger(transaction, db_client)
            if ludo_is_per_minute(room):
                after['billedUntil'] = None
                ludo_bill(transaction, db_client, room_ref, after, ledger, now, now_dt)
            ledger.write()
            ludo_write_state(transaction, room_ref, room, after)
            return after.get('currentTurn'), after.get('phase')

        first, phase = apply(transaction)
        return jsonify({"ok": True, "currentTurn": first, "phase": phase}), 200
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        print(f"[LUDO] Start error: {e}")
        return jsonify({"error": "Could not start the game"}), 500


@app.route('/api/v1/ludo/move', methods=['POST', 'OPTIONS'])
def ludo_move_endpoint():
    """Move one of the caller's pieces by the die the server rolled.

    Moves used to be computed on the phone and written straight to the room.
    Now the server checks it is the caller's turn, the die is rolled, the piece
    is theirs and the move is legal, then applies it with captures, scoring,
    finishing order and the next turn in one transaction -- and on a
    per-minute table, settles the game the moment it ends.
    """
    if request.method == 'OPTIONS':
        return '', 200
    uid, error_response = require_bearer_uid()
    if error_response:
        return error_response

    data = request.json or {}
    room_id = str(data.get('roomId') or '').strip()
    token_id = str(data.get('tokenId') or '').strip()
    if not room_id or not token_id:
        return jsonify({"error": "Missing roomId or tokenId"}), 400

    try:
        db_client = firestore.client()
        room_ref = db_client.collection('ludo_rooms').document(room_id)
        transaction = db_client.transaction()

        @firestore.transactional
        def apply(transaction):
            snap = room_ref.get(transaction=transaction)
            if not snap.exists:
                raise ValueError("Unknown room")
            room = snap.to_dict() or {}
            if room.get('phase') != 'playing':
                raise ValueError("Game is not in play")
            per_minute = ludo_is_per_minute(room)
            if per_minute and room.get('emptySince'):
                raise ValueError("The table is paused until a player sits down.")

            players = list(room.get('players') or [])
            me = next((p for p in players if (p or {}).get('uid') == uid), None)
            if not me:
                raise PermissionError("Not a seated player")
            color = me.get('color')
            if color != room.get('currentTurn'):
                raise ValueError("Not your turn")
            dice = room.get('diceValue')
            if not room.get('diceRolled') or not isinstance(dice, int):
                raise ValueError("Roll the dice first")

            tokens = list(room.get('tokens') or [])
            token = next((t for t in tokens if (t or {}).get('id') == token_id), None)
            if not token or token.get('color') != color:
                raise ValueError("That is not your piece")
            moved = ludo_apply_move(tokens, token_id, dice)
            if moved is None:
                raise ValueError("That piece cannot move that far")
            new_tokens, captured, finished, from_pos, to_pos = moved

            home = sum(
                1 for t in new_tokens
                if t.get('color') == color and t.get('position') == LUDO_FINISHED_POSITION
            )
            new_players = [
                dict(p, score=home) if (p or {}).get('color') == color else p
                for p in players
            ]
            color_done = home == len([t for t in new_tokens if t.get('color') == color])

            winners = list(room.get('winnersOrder') or [])
            finish_rank = int(room.get('finishRank') or 1)
            phase = 'playing'
            if color_done and uid not in winners:
                winners.append(uid)
                finish_rank += 1
                if not per_minute and len(winners) >= len(players) - 1:
                    phase = 'finished'

            now = time.time()
            now_dt = datetime.fromtimestamp(now, timezone.utc)
            after = copy.deepcopy(room)
            after.update({
                "tokens": new_tokens,
                "players": new_players,
                "phase": phase,
                "finishRank": finish_rank,
                "winnersOrder": winners,
            })
            # A six, a capture or a piece reaching home earns another roll.
            reroll = dice == 6 or captured is not None or finished
            if reroll and not color_done:
                next_color = color
            elif per_minute:
                next_color = ludo_next_color(after, color, new_players, new_tokens)
            else:
                next_color = ludo_next_turn(color, new_players, new_tokens)
            ludo_new_turn(after, next_color, now_dt if per_minute else firestore.SERVER_TIMESTAMP)
            after['consecutiveSixes'] = int(room.get('consecutiveSixes') or 0) if reroll else 0

            ledger = LudoLedger(transaction, db_client)
            if per_minute:
                ludo_mark_active(after, uid, now_dt)
                ludo_maybe_finish(after, ledger, now_dt)
                ludo_housekeeping(transaction, db_client, room_ref, after, ledger, now, now_dt)
            ledger.write()
            ludo_write_state(transaction, room_ref, room, after)
            return {
                "fromPos": from_pos,
                "toPos": to_pos,
                "diceValue": dice,
                "captured": captured,
                "finished": finished,
                "colorDone": color_done,
                "currentTurn": after.get('currentTurn'),
                "phase": after.get('phase'),
                "settlement": after.get('settlement'),
            }

        result = apply(transaction)
        return jsonify(dict(result, ok=True)), 200
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        print(f"[LUDO] Move error: {e}")
        return jsonify({"error": "That move did not go through"}), 500


@app.route('/api/v1/ludo/skip', methods=['POST', 'OPTIONS'])
def ludo_skip_endpoint():
    """Advance a turn whose clock has run out.

    This was a client-side write, permitted by the room rules only to the host.
    When the host was the player who went away mid-turn -- phone locked, app
    closed -- nobody left at the table was allowed to move the game on, and it
    sat at "0s left" until somebody abandoned it. Found by playing a table over
    two phones and watching the clock stick at zero.

    Any seated player may ask, and the server decides: the turn is advanced
    only once it has genuinely expired, so this cannot be used to rob somebody
    of a roll they are still taking.
    """
    if request.method == 'OPTIONS':
        return '', 200
    uid, error_response = require_bearer_uid()
    if error_response:
        return error_response

    data = request.json or {}
    room_id = str(data.get("roomId") or "").strip()
    if not room_id:
        return jsonify({"error": "Missing roomId"}), 400

    try:
        db_client = firestore.client()
        room_ref = db_client.collection('ludo_rooms').document(room_id)
        transaction = db_client.transaction()

        @firestore.transactional
        def apply(transaction):
            room_snap = room_ref.get(transaction=transaction)
            if not room_snap.exists:
                raise ValueError("Unknown room")
            room = room_snap.to_dict() or {}
            if room.get('phase') != 'playing':
                raise ValueError("Game is not in play")

            players = list(room.get('players') or [])
            if not any((p or {}).get('uid') == uid for p in players):
                raise PermissionError("Not a seated player")

            # A roll that nothing can move with passes at once. The board says
            # "No legal moves -- passing" and asks straight away, but this used
            # to wait out the whole turn clock regardless, so every dead roll
            # froze the table for the best part of twenty seconds.
            dice = room.get('diceValue')
            dead_roll = (
                bool(room.get('diceRolled')) and isinstance(dice, int)
                and not ludo_legal_moves(room.get('tokens') or [], room.get('currentTurn'), dice)
            )

            if ludo_is_per_minute(room):
                return ludo_skip_per_minute(
                    transaction, db_client, room_ref, room, dead_roll,
                )

            started_at = room.get('turnStartedAt')
            if not dead_roll:
                if not hasattr(started_at, 'timestamp'):
                    raise ValueError("Turn has no start time")
                timeout_secs = int(room.get('turnTimeoutSecs') or 15)
                deadline = started_at.timestamp() + timeout_secs + LUDO_SKIP_GRACE_SECONDS
                if time.time() < deadline:
                    raise LookupError("Turn is still live")

            nxt = ludo_next_turn(room.get('currentTurn'), players, room.get('tokens') or [])
            transaction.update(room_ref, {
                "currentTurn": nxt,
                "diceValue": None,
                "diceRolled": False,
                "consecutiveSixes": 0,
                "turnStartedAt": firestore.SERVER_TIMESTAMP,
            })
            return nxt

        nxt = apply(transaction)
        return jsonify({"ok": True, "currentTurn": nxt}), 200
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except LookupError as e:
        # 409: nothing is wrong, the turn simply has not run out yet.
        return jsonify({"error": str(e)}), 409
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        print(f"[LUDO] Skip error: {e}")
        return jsonify({"error": "Could not skip the turn"}), 500


@app.route('/api/v1/ludo/roll', methods=['POST', 'OPTIONS'])
def ludo_roll_endpoint():
    """Charge per-token roll fee (when applicable) and set the dice server-side."""
    if request.method == 'OPTIONS':
        return '', 200
    uid, error_response = require_bearer_uid()
    if error_response:
        return error_response

    data = request.json or {}
    room_id = str(data.get("roomId") or "").strip()
    if not room_id:
        return jsonify({"error": "Missing roomId"}), 400

    try:
        db_client = firestore.client()
        room_ref = db_client.collection('ludo_rooms').document(room_id)
        user_ref = db_client.collection('users').document(uid)
        transaction = db_client.transaction()

        @firestore.transactional
        def apply(transaction):
            room_snap = room_ref.get(transaction=transaction)
            if not room_snap.exists:
                raise ValueError("Unknown room")
            room = room_snap.to_dict() or {}
            if room.get('phase') != 'playing':
                raise ValueError("Game is not in play")
            if room.get('diceRolled'):
                raise ValueError("Dice already rolled")

            players = list(room.get('players') or [])
            me = next((p for p in players if (p or {}).get('uid') == uid), None)
            if not me:
                raise ValueError("Not a seated player")
            if me.get('color') != room.get('currentTurn'):
                raise ValueError("Not your turn")
            per_minute = ludo_is_per_minute(room)
            if per_minute and room.get('emptySince'):
                raise ValueError("The table is paused until a player sits down.")
            if per_minute and room.get('hostBenched') and uid == room.get('hostUid'):
                raise ValueError("Your turns are being skipped for the rest of this game.")

            host_uid = room.get('hostUid')
            game_mode = room.get('gameMode')
            user_new = None
            host_new = None

            if game_mode == 'per_token':
                commission = server_host_commission(LUDO_ROLL_COST) if host_uid and host_uid != uid else 0
                host_ref = db_client.collection('users').document(host_uid) if host_uid else None
                pay_host = bool(host_ref and commission > 0)

                user_balance = get_coin_balance(user_ref.get(transaction=transaction))
                host_balance = (
                    get_coin_balance(host_ref.get(transaction=transaction))
                    if pay_host else None
                )
                if user_balance < LUDO_ROLL_COST:
                    raise ValueError("Insufficient Gengal balance")
                user_new = user_balance - LUDO_ROLL_COST
                transaction.update(user_ref, {"coins": user_new})
                if pay_host:
                    host_new = host_balance + commission
                    transaction.update(host_ref, {"coins": host_new})

            value = secrets.randbelow(6) + 1
            consec = int(room.get('consecutiveSixes') or 0)
            new_consec = consec + 1 if value == 6 else 0
            # Every phone animates the die from lastRoll, which nothing clears:
            # diceValue goes back to None as soon as the pawn moves or the turn
            # passes, so a phone whose update arrived after that never saw the
            # roll at all -- the die simply did not move there. seq tells two
            # rolls of the same number apart.
            prev_roll = room.get('lastRoll') or {}
            updates = {
                "diceValue": value,
                "diceRolled": True,
                "consecutiveSixes": new_consec,
                "lastRoll": {
                    "value": value,
                    "color": room.get('currentTurn'),
                    "seq": int(prev_roll.get('seq') or 0) + 1,
                },
            }
            if per_minute:
                active = dict(room.get('lastActive') or {})
                active[uid] = datetime.now(timezone.utc)
                updates["lastActive"] = active
            forfeited = False
            if new_consec >= 3:
                updates.update({
                    "currentTurn": (
                        ludo_next_color(room, room.get('currentTurn'), players, room.get('tokens'))
                        if per_minute else next_ludo_color(room.get('currentTurn'), players)
                    ),
                    "diceValue": None,
                    "diceRolled": False,
                    "consecutiveSixes": 0,
                    "turnStartedAt": firestore.SERVER_TIMESTAMP,
                })
                forfeited = True
            transaction.update(room_ref, updates)
            return value, user_new, host_new, forfeited

        value, user_new, host_new, forfeited = apply(transaction)
        return jsonify({
            "ok": True,
            "diceValue": value,
            "newBalance": user_new,
            "hostNewBalance": host_new,
            "forfeited": forfeited,
            "rollCost": LUDO_ROLL_COST,
        }), 200
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        print(f"[LUDO] Roll error: {e}")
        return jsonify({"error": "Failed to roll"}), 500


@app.route('/api/v1/coins/call-rewards', methods=['POST', 'OPTIONS'])
def call_rewards_endpoint():
    if request.method == 'OPTIONS':
        return '', 200
    uid, error_response = require_bearer_uid()
    if error_response:
        return error_response
    data = request.json or {}
    user_id = data.get("userId")
    if user_id != uid:
        return jsonify({"error": "Cannot update rewards for another user"}), 403
    room_id = data.get("roomId")
    if not isinstance(room_id, str) or not room_id.strip():
        return jsonify({"error": "Missing roomId"}), 400
    room_id = room_id.strip()
    try:
        # Client secondsToAdd is a hint only. Hard ceiling is server-billed
        # duration minus seconds already credited for this participant.
        requested = None
        if data.get("secondsToAdd") is not None:
            requested = parse_positive_number(data.get("secondsToAdd"), "secondsToAdd")
        # Threshold comes from server pricing settings, NOT the client body.
        settings = pricing_settings()
        threshold_minutes = float(settings.get(
            'callDurationForHeart', DEFAULT_SETTINGS['callDurationForHeart']
        ))
        db_client = firestore.client()
        user_ref = db_client.collection('users').document(uid)
        call_ref = db_client.collection('calls').document(room_id)
        transaction = db_client.transaction()

        @firestore.transactional
        def apply(transaction):
            call_snap = call_ref.get(transaction=transaction)
            user_snap = user_ref.get(transaction=transaction)
            if not call_snap.exists:
                raise ValueError("Call does not exist")
            if not user_snap.exists:
                raise ValueError("User does not exist")
            call = call_snap.to_dict() or {}
            caller_id = call.get('callerUid')
            receiver_id = call.get('receiverUid')
            if not caller_id or not receiver_id or caller_id == receiver_id:
                raise ValueError("Invalid call participants")
            if uid not in (caller_id, receiver_id):
                raise PermissionError("Not a participant in this call")
            is_receiver = uid == receiver_id
            reward_key = (
                'receiverRewardedSeconds' if is_receiver else 'callerRewardedSeconds'
            )
            already = float(call.get(reward_key) or 0)
            remaining = max(0.0, float(call.get('durationSeconds') or 0) - already)
            seconds_to_add = min(remaining, float(MAX_REWARDS_SECONDS))
            if requested is not None:
                seconds_to_add = min(seconds_to_add, requested)
            if seconds_to_add <= 0:
                return 0.0

            user_data = user_snap.to_dict() or {}
            current_seconds = float(user_data.get("unrewardedCallSeconds") or 0) + seconds_to_add
            hearts = int(user_data.get("hearts") or 0)
            total_received = float(user_data.get("totalReceivedCallSeconds") or 0)
            if is_receiver:
                total_received += seconds_to_add
            threshold_seconds = threshold_minutes * 60
            if threshold_seconds > 0 and current_seconds >= threshold_seconds:
                hearts_to_award = int(current_seconds // threshold_seconds)
                hearts += hearts_to_award
                current_seconds = current_seconds % threshold_seconds
            update_data = {
                "unrewardedCallSeconds": current_seconds,
                "hearts": hearts,
            }
            if is_receiver:
                update_data["totalReceivedCallSeconds"] = total_received
            transaction.update(user_ref, update_data)
            transaction.update(call_ref, {reward_key: already + seconds_to_add})
            return seconds_to_add

        try:
            credited = apply(transaction)
        except PermissionError as e:
            return jsonify({"error": str(e)}), 403
        return jsonify({"ok": True, "creditedSeconds": credited}), 200
    except (TypeError, ValueError) as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        print(f"[COINS] Rewards error: {e}")
        return jsonify({"error": "Failed to update rewards"}), 500

@app.route('/api/v1/users/profile/get', methods=['POST', 'OPTIONS'])
def get_user_profile_admin():
    if request.method == 'OPTIONS':
        return '', 200
    authed_uid, error_response = require_bearer_uid()
    if error_response:
        return error_response
    try:
        data = request.json or {}
        uid = data.get('uid')
        if not uid:
            return jsonify({"error": "Missing uid"}), 400
        if uid != authed_uid:
            return jsonify({"error": "Cannot read another user's private profile through this endpoint"}), 403
        db_client = firestore.client()
        doc_snap = db_client.collection('users').document(uid).get()
        if doc_snap.exists:
            return jsonify({"ok": True, "profile": serialize_doc(doc_snap.to_dict())}), 200
        return jsonify({"ok": True, "profile": None}), 200
    except Exception as e:
        print(f"[USER-API] Get profile error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/v1/users/profile/save', methods=['POST', 'OPTIONS'])
def save_user_profile_admin():
    if request.method == 'OPTIONS':
        return '', 200
    authed_uid, error_response = require_bearer_uid()
    if error_response:
        return error_response
    try:
        data = request.json or {}
        uid = data.get('uid')
        profile_data = data.get('profileData', {})
        if not uid:
            return jsonify({"error": "Missing uid"}), 400
        if uid != authed_uid:
            return jsonify({"error": "Cannot save another user's profile"}), 403
        for protected_key in ["coins", "hearts", "respectBadges", "password", "passwordHash"]:
            profile_data.pop(protected_key, None)
        db_client = firestore.client()
        # Private contact details are redirected to the owner-only document
        # rather than the profile, which every signed-in user can read.
        private_data = {
            key: profile_data.pop(key)
            for key in ["phoneNumber", "expoPushToken"]
            if key in profile_data
        }
        if private_data:
            db_client.collection('user_private').document(uid).set(private_data, merge=True)
        user_ref = db_client.collection('users').document(uid)
        doc_snap = user_ref.get()
        if doc_snap.exists:
            user_ref.update(profile_data)
        else:
            profile_data.update({"uid": uid, "coins": 500, "hearts": 0, "respectBadges": 0, "isOnline": True, "isActiveMode": True, "isSessionActive": True})
            user_ref.set(profile_data)
        return jsonify({"ok": True}), 200
    except Exception as e:
        print(f"[USER-API] Save profile error: {e}")
        return jsonify({"error": str(e)}), 500

# How long a lastActive stamp keeps someone listed as online.
#
# Must match ONLINE_FRESHNESS_MS in src/services/userService.ts -- the app
# and this server both filter the same people, and a mismatch shows up as a
# user who is listed by one and not the other. It is the fallback only: the
# app writes isOnline: false as it leaves the foreground, so a phone that is
# swiped out of recents drops out at once. This covers the ones that cannot
# say goodbye -- powered off, force-stopped, out of signal.
FRESHNESS_MS = 45 * 1000

# Longest caller avatar URL worth putting in a call notification. FCM refuses a
# data message larger than 4 KB, and a refused message is a call that never
# rings -- so an unusually long URL is dropped and the receiver falls back to
# the caller's generated avatar.
AVATAR_URL_MAX_CHARS = 512
@app.route('/api/v1/users/online', methods=['POST', 'OPTIONS'])
def get_online_users_admin():
    if request.method == 'OPTIONS':
        return '', 200
    _, error_response = require_bearer_uid()
    if error_response:
        return error_response
    try:
        data = request.json or {}
        current_uid = data.get('currentUid')
        vip_only = data.get('vipOnly', False)
        db_client = firestore.client()
        query_snap = db_client.collection('users').where('isOnline', '==', True).limit(50).stream()
        users_list = []
        now_ms = int(time.time() * 1000)
        freshness_ms = FRESHNESS_MS
        for d in query_snap:
            if current_uid and d.id == current_uid:
                continue
            raw_dict = d.to_dict() or {}
            if raw_dict.get('isDeleted') == True or raw_dict.get('deletedAt') or raw_dict.get('banned'):
                continue
            if raw_dict.get('isActiveMode') == False or raw_dict.get('isOnline') == False or raw_dict.get('isSessionActive') == False:
                continue
            u_data = serialize_doc(raw_dict)
            if not u_data.get('nickname') and not u_data.get('username'):
                continue
            # Out of the app for a while: not listed. Being reachable by a
            # push is not the same as being there -- keeping those people
            # listed left anyone who had swiped the app away sitting in
            # Online Now for hours (see isListedOnline in userService.ts).
            last_act = u_data.get('lastActive', 0)
            if isinstance(last_act, (int, float)) and last_act > 0 and (now_ms - last_act > freshness_ms):
                continue
            if vip_only and not u_data.get('avatarUrl'):
                continue
            u_data['uid'] = d.id
            u_data['tier'] = 'VIP' if u_data.get('avatarUrl') else 'Advance'
            users_list.append(u_data)
        return jsonify({"ok": True, "users": users_list}), 200
    except Exception as e:
        print(f"[USER-API] Online users error: {e}")
        return jsonify({"ok": True, "users": []}), 200

@app.route('/api/v1/users/recent', methods=['POST', 'OPTIONS'])
def get_recent_users_admin():
    if request.method == 'OPTIONS':
        return '', 200
    _, error_response = require_bearer_uid()
    if error_response:
        return error_response
    try:
        data = request.json or {}
        current_uid = data.get('currentUid')
        db_client = firestore.client()
        query_snap = db_client.collection('users').limit(50).stream()
        users_list = []
        now_ms = int(time.time() * 1000)
        freshness_ms = FRESHNESS_MS
        for d in query_snap:
            if current_uid and d.id == current_uid:
                continue
            raw_dict = d.to_dict() or {}
            if raw_dict.get('isDeleted') == True or raw_dict.get('deletedAt') or raw_dict.get('banned'):
                continue
            if raw_dict.get('isActiveMode') == False or raw_dict.get('isOnline') == False or raw_dict.get('isSessionActive') == False:
                continue
            u_data = serialize_doc(raw_dict)
            if not u_data.get('nickname') and not u_data.get('username'):
                continue
            # Out of the app for a while: not listed. Being reachable by a
            # push is not the same as being there -- keeping those people
            # listed left anyone who had swiped the app away sitting in
            # Online Now for hours (see isListedOnline in userService.ts).
            last_act = u_data.get('lastActive', 0)
            if isinstance(last_act, (int, float)) and last_act > 0 and (now_ms - last_act > freshness_ms):
                continue
            u_data['uid'] = d.id
            u_data['tier'] = 'VIP' if u_data.get('avatarUrl') else 'Advance'
            users_list.append(u_data)
        return jsonify({"ok": True, "users": users_list}), 200
    except Exception as e:
        print(f"[USER-API] Recent users error: {e}")
        return jsonify({"ok": True, "users": []}), 200

# ==========================================
# CALL SIGNALLING
# ==========================================

def send_fcm(token, data, ttl_seconds):
    """Sends one FCM data message (see push.py). Raises push.TokenGone when
    the phone no longer answers to the token."""
    message = messaging.Message(
        token=token,
        data=data,
        android=messaging.AndroidConfig(priority='high', ttl=ttl_seconds),
    )
    try:
        messaging.send(message)
    except (messaging.UnregisteredError, messaging.SenderIdMismatchError) as e:
        raise push.TokenGone(token) from e


def send_expo(token, data, ttl_seconds):
    """Expo's push service, for an install that only ever stored an Expo token.

    Expo answers 200 even when it could not deliver; the verdict is in the
    ticket, so read that rather than the status code.
    """
    response = requests.post(
        'https://exp.host/--/api/v2/push/send',
        json={
            "to": token,
            "title": data["title"],
            "body": data["message"],
            "data": json.loads(data["body"]),
            "priority": "high",
            "channelId": data["channelId"],
            "ttl": ttl_seconds,
        },
        timeout=10,
    )
    ticket = (response.json() or {}).get("data") or {}
    if (ticket.get("details") or {}).get("error") == "DeviceNotRegistered":
        raise push.TokenGone(token)
    return response.status_code == 200 and ticket.get("status") == "ok"


def forget_push_token(uid, field, token):
    """Drops a token the phone no longer answers to.

    Compared before deleting, so a token the app re-registered in the meantime
    is not the one thrown away. Without an FCM token the person cannot be
    reached outside the app, so they stop being listed as online while away.
    """
    db_client = firestore.client()
    try:
        private_ref = db_client.collection('user_private').document(uid)
        snap = private_ref.get()
        if not snap.exists or (snap.to_dict() or {}).get(field) != token:
            return
        private_ref.update({field: firestore.DELETE_FIELD})
        if field == 'fcmToken':
            db_client.collection('users').document(uid).update({'pushReachable': False})
    except Exception as e:
        print(f"[PUSH] Could not forget a dead {field}: {e}")


def deliver_push(receiver_uid, private_data, data, ttl_seconds):
    """Pushes to the receiver's phone. True when a transport accepted it."""
    fcm_token = private_data.get('fcmToken')
    if fcm_token:
        try:
            send_fcm(fcm_token, data, ttl_seconds)
            return True
        except push.TokenGone:
            forget_push_token(receiver_uid, 'fcmToken', fcm_token)
        except Exception as e:
            print(f"[PUSH] FCM send failed: {e}")
    expo_token = private_data.get('expoPushToken')
    if expo_token:
        try:
            return bool(send_expo(expo_token, data, ttl_seconds))
        except push.TokenGone:
            forget_push_token(receiver_uid, 'expoPushToken', expo_token)
        except Exception as e:
            print(f"[PUSH] Expo send failed: {e}")
    return False


def blocked_by(private_data, uid):
    blocked_uids = private_data.get('blockedUids')
    return isinstance(blocked_uids, list) and uid in blocked_uids


def display_name(db_client, uid):
    snap = db_client.collection('users').document(uid).get()
    data = (snap.to_dict() or {}) if snap.exists else {}
    return data.get('nickname') or data.get('username') or 'Someone'


@app.route('/api/v1/calls/notify', methods=['POST', 'OPTIONS'])
def notify_incoming_call():
    """Delivers the incoming-call push.

    Runs server-side because the receiver's push token is private: the caller
    must not be able to read other users' push tokens (which also made push
    spam trivial).
    """
    if request.method == 'OPTIONS':
        return '', 200

    uid, error_response = require_bearer_uid()
    if error_response:
        return error_response

    data = request.json or {}
    receiver_uid = data.get('receiverUid')
    mode = data.get('mode') if data.get('mode') in ('call', 'video') else 'call'
    if not receiver_uid:
        return jsonify({"error": "Missing receiverUid"}), 400
    if receiver_uid == uid:
        return jsonify({"ok": True, "delivered": False}), 200

    if rate_limited(f"notify:{uid}", 30, 300):
        return jsonify({"error": "Too many call notifications"}), 429

    try:
        db_client = firestore.client()

        # Only notify if there is a live offer this caller actually created.
        offer_snap = db_client.collection('incoming_calls').document(receiver_uid).get()
        if not offer_snap.exists or (offer_snap.to_dict() or {}).get('callerUid') != uid:
            return jsonify({"error": "No active call offer for this receiver"}), 403

        # The receiver's "Show me as online" switch is what decides whether
        # calls reach them outside the app.
        receiver_snap = db_client.collection('users').document(receiver_uid).get()
        receiver = (receiver_snap.to_dict() or {}) if receiver_snap.exists else {}
        if receiver.get('isActiveMode') is False:
            return jsonify({"ok": True, "delivered": False}), 200

        private_snap = db_client.collection('user_private').document(receiver_uid).get()
        private_data = (private_snap.to_dict() or {}) if private_snap.exists else {}
        # A blocked caller gets the same answer as an unreachable receiver, so
        # the block is not revealed; the receiver's app declines the offer.
        if blocked_by(private_data, uid):
            return jsonify({"ok": True, "delivered": False}), 200

        caller_name = display_name(db_client, uid)
        offer = offer_snap.to_dict() or {}
        room_id = offer.get('roomId')

        # The receiver's app builds the ringing screen from this payload alone
        # when GenGal was not running, and it cannot fall back to the offer
        # document afterwards: the call is already deduplicated by then, so the
        # snapshot carrying the avatar is discarded as a repeat. Without these
        # the caller rang as a faceless placeholder.
        call_body = {
            "type": "call",
            "roomId": room_id,
            "mode": mode,
            "callerUid": uid,
            "callerName": caller_name,
            "isIncomingPending": True,
        }
        avatar_data = offer.get('callerAvatarData')
        if isinstance(avatar_data, dict):
            call_body["callerAvatarData"] = avatar_data
        avatar_url = offer.get('callerAvatarUrl')
        # Length-checked because FCM rejects a data message over 4 KB outright,
        # and losing the whole call notification to an over-long avatar URL is
        # far worse than showing the generated avatar instead.
        if isinstance(avatar_url, str) and 0 < len(avatar_url) <= AVATAR_URL_MAX_CHARS:
            call_body["callerAvatarUrl"] = avatar_url
        # The caller's name is the headline, the way a phone call shows who is
        # ringing rather than the word "call". The chat notification already
        # leads with the sender's name; this now matches it.
        payload = push.expo_data(
            caller_name,
            f"Incoming {'video' if mode == 'video' else 'voice'} call",
            call_body,
            push.call_channel_for(private_data),
            tag=f"call_{room_id}",
            category_id=push.CALL_CATEGORY,
            sticky=True,
        )
        delivered = deliver_push(receiver_uid, private_data, payload, push.CALL_TTL_SECONDS)
        return jsonify({"ok": True, "delivered": delivered}), 200
    except Exception as e:
        print(f"[CALLS] Notify error: {e}")
        return jsonify({"error": "Failed to deliver notification"}), 500


@app.route('/api/v1/calls/cancel-notify', methods=['POST', 'OPTIONS'])
def notify_missed_call():
    """Replaces a ringing call notification with a swipeable "Missed call".

    The ringing notification is posted sticky, so it cannot be swiped away.
    That is the point while a call is live, and a trap once it is not: a call
    that dies while the receiver's app is closed would leave a notification
    nothing on the phone can remove. Android replaces a notification carrying
    the same tag, so this posts the same tag without sticky.

    The live offer is the caller's proof of standing, which is why the app
    calls this *before* it deletes the offer.
    """
    if request.method == 'OPTIONS':
        return '', 200

    uid, error_response = require_bearer_uid()
    if error_response:
        return error_response

    data = request.json or {}
    receiver_uid = data.get('receiverUid')
    if not receiver_uid:
        return jsonify({"error": "Missing receiverUid"}), 400
    if receiver_uid == uid:
        return jsonify({"ok": True, "delivered": False}), 200

    if rate_limited(f"notify:{uid}", 30, 300):
        return jsonify({"error": "Too many call notifications"}), 429

    try:
        db_client = firestore.client()

        offer_snap = db_client.collection('incoming_calls').document(receiver_uid).get()
        offer = (offer_snap.to_dict() or {}) if offer_snap.exists else {}
        if not offer or offer.get('callerUid') != uid:
            return jsonify({"error": "No active call offer for this receiver"}), 403

        # Picked up, or already declined: the receiver's own app has dealt with
        # the notification, and "Missed call" would simply be untrue.
        if offer.get('status', 'calling') != 'calling':
            return jsonify({"ok": True, "delivered": False}), 200

        private_snap = db_client.collection('user_private').document(receiver_uid).get()
        private_data = (private_snap.to_dict() or {}) if private_snap.exists else {}
        # A blocked caller never rang, so there is nothing of theirs to replace
        # -- and without this the endpoint would hand them a way to put a
        # notification on a phone that blocked them.
        if blocked_by(private_data, uid):
            return jsonify({"ok": True, "delivered": False}), 200

        # Deliberately not gated on isActiveMode. Clearing a notification that
        # is already on the phone has to work even if presence was switched off
        # after it arrived, or the sticky one would be stranded there.
        caller_name = display_name(db_client, uid)
        room_id = offer.get('roomId')
        payload = push.expo_data(
            caller_name,
            "Missed call",
            {
                "type": "call_missed",
                "roomId": room_id,
                "callerUid": uid,
                "callerName": caller_name,
            },
            push.MESSAGE_CHANNEL,
            tag=f"call_{room_id}",
        )
        delivered = deliver_push(receiver_uid, private_data, payload, push.MESSAGE_TTL_SECONDS)
        return jsonify({"ok": True, "delivered": delivered}), 200
    except Exception as e:
        print(f"[CALLS] Missed-call notify error: {e}")
        return jsonify({"error": "Failed to deliver notification"}), 500


# A message is only announced while it is fresh. The app asks right after
# sending, so this only turns away a replay of an old message.
MESSAGE_NOTIFY_WINDOW_SECONDS = 5 * 60


@app.route('/api/v1/chats/notify', methods=['POST', 'OPTIONS'])
def notify_new_message():
    """Tells the other person in a chat about a message just sent.

    The sender's app calls this after the message is written. Everything in
    the notification is read back from Firestore rather than taken from the
    request, so a client can only announce a message it really sent, into a
    conversation it is really part of, once.
    """
    if request.method == 'OPTIONS':
        return '', 200

    uid, error_response = require_bearer_uid()
    if error_response:
        return error_response

    data = request.json or {}
    chat_id = str(data.get('chatId') or '')
    message_id = str(data.get('messageId') or '')
    if not message_id or '/' in message_id:
        return jsonify({"error": "Missing messageId"}), 400
    peer_uid = push.chat_peer(chat_id, uid)
    if not peer_uid:
        return jsonify({"error": "Not a participant in this chat"}), 403

    if rate_limited(f"chat-notify:{uid}", 60, 300):
        return jsonify({"error": "Too many message notifications"}), 429

    try:
        db_client = firestore.client()
        message_snap = (
            db_client.collection('chats').document(chat_id)
            .collection('messages').document(message_id).get()
        )
        if not message_snap.exists:
            return jsonify({"error": "No such message"}), 404
        message = message_snap.to_dict() or {}
        if message.get('senderId') != uid:
            return jsonify({"error": "Not your message"}), 403

        sent_at = message.get('timestamp')
        if not hasattr(sent_at, 'timestamp') or time.time() - sent_at.timestamp() > MESSAGE_NOTIFY_WINDOW_SECONDS:
            return jsonify({"ok": True, "delivered": False}), 200
        # Once per message, however many times the app asks.
        if rate_limited(f"chat-notify-msg:{chat_id}/{message_id}", 1, 2 * MESSAGE_NOTIFY_WINDOW_SECONDS):
            return jsonify({"ok": True, "delivered": False}), 200

        private_snap = db_client.collection('user_private').document(peer_uid).get()
        private_data = (private_snap.to_dict() or {}) if private_snap.exists else {}
        if blocked_by(private_data, uid):
            return jsonify({"ok": True, "delivered": False}), 200

        sender_name = display_name(db_client, uid)
        payload = push.expo_data(
            sender_name,
            push.preview(message.get('text')),
            {"type": "message", "chatId": chat_id, "senderUid": uid, "senderName": sender_name},
            push.MESSAGE_CHANNEL,
            # One tray entry per conversation, showing its latest message.
            tag=f"chat_{chat_id}",
        )
        delivered = deliver_push(peer_uid, private_data, payload, push.MESSAGE_TTL_SECONDS)
        return jsonify({"ok": True, "delivered": delivered}), 200
    except Exception as e:
        print(f"[CHAT] Notify error: {e}")
        return jsonify({"error": "Failed to deliver notification"}), 500

# ==========================================
# CLIENT CONFIG
# ==========================================

@app.route('/api/v1/rtc/config', methods=['GET'])
def rtc_config():
    """Serves the Agora App ID so it is not hardcoded in the client.

    A client-side constant can drift from the AGORA_APP_ID the server signs
    tokens with, which rejects every token with no useful error.
    """
    _, error_response = require_bearer_uid()
    if error_response:
        return error_response
    if not AGORA_APP_ID:
        return jsonify({"error": "Agora is not configured"}), 503
    return jsonify({"agoraAppId": AGORA_APP_ID}), 200

# ==========================================
# ADMIN
# ==========================================

DEFAULT_SETTINGS = {
    "voiceCallRatePerMin": 10,
    "videoCallRatePerMin": 50,
    "creatorSharePercentage": 70,
    "femaleExpertHeartsThreshold": 50,
    "maleExpertRespectThreshold": 30,
    "callDurationForHeart": 3,
    "heartToInrRate": 3,
    "minRechargeAmount": 49,
    # ₹8 = 10 coins.
    "inrToCoinRechargeRate": 1.25,
    # Floor for a payout request. Lived as a bare `33` in EarningsScreen, so the
    # only way to change it was to ship a new build — and the server had no
    # opinion at all, which is what let a patched client request any amount.
    "minWithdrawalHearts": 33,
    # Offers. Each is an admin setting; 0 switches an offer off.
    # A lower price for the same coins, on every pack and custom amount.
    "coinDiscountPercent": 0,
    # One pack per account, at a price below the minimum recharge.
    "firstBuyPriceInr": 6,
    "firstBuyCoins": 60,
    # Free coins, claimable once a day after this many paid voice minutes.
    "dailyBonusCoins": 30,
    "dailyBonusMinVoiceMinutes": 5,
    # Daily host bonus: the hosts who talked the most (at least the minimum)
    # share a pool, paid as hearts, of this share of the day's call revenue --
    # or of an amount the admin types in when paying it.
    "hostBonusMinMinutes": 30,
    "hostBonusTopCount": 10,
    "hostBonusPoolPercent": 8,
}

SETTINGS_BOUNDS = {
    "voiceCallRatePerMin": (0, 10000),
    "videoCallRatePerMin": (0, 10000),
    "creatorSharePercentage": (0, 100),
    "femaleExpertHeartsThreshold": (0, 100000),
    "maleExpertRespectThreshold": (0, 100000),
    "callDurationForHeart": (0.1, 1440),
    "heartToInrRate": (0, 10000),
    "minRechargeAmount": (1, 100000),
    "inrToCoinRechargeRate": (0.01, 1000),
    # Lower bound of 1, never 0: a floor of zero would let anyone open a payout
    # request worth nothing and clear it through the manual review queue.
    "minWithdrawalHearts": (1, 100000),
    # Up to half price, or exactly 100 (see FREE_PACK_PERCENT). Past half price
    # a minute can cost more to serve than it brings in once GST, the store's
    # fee, the call provider and the host are paid, so 51-99 is refused below.
    "coinDiscountPercent": (0, 100),
    "firstBuyPriceInr": (0, 100000),
    "firstBuyCoins": (0, 100000),
    "dailyBonusCoins": (0, 100000),
    "dailyBonusMinVoiceMinutes": (0, 1440),
    "hostBonusMinMinutes": (0, 1440),
    "hostBonusTopCount": (1, 100),
    # About 55% of what users pay for a call is left after GST, the store's
    # fee, the call provider and the host; a pool above that loses money.
    "hostBonusPoolPercent": (0, 50),
}

DEFAULT_SETTINGS.update(LUDO_SETTING_DEFAULTS)
SETTINGS_BOUNDS.update(LUDO_SETTING_BOUNDS)

@app.route('/api/v1/admin/is-admin', methods=['GET'])
def is_admin_check():
    uid, error_response = require_bearer_uid()
    if error_response:
        return error_response
    return jsonify({"isAdmin": uid in admin_uids()}), 200

@app.route('/api/v1/admin/settings', methods=['GET', 'POST', 'OPTIONS'])
def admin_settings():
    """Global pricing. Firestore rules deny all client writes to /settings, so
    changes come through here where the admin allowlist is enforced."""
    if request.method == 'OPTIONS':
        return '', 200

    _, error_response = require_admin_uid()
    if error_response:
        return error_response

    db_client = firestore.client()
    settings_ref = db_client.collection('settings').document('pricing')

    if request.method == 'GET':
        snap = settings_ref.get()
        if not snap.exists:
            settings_ref.set(DEFAULT_SETTINGS)
            return jsonify({"ok": True, "settings": DEFAULT_SETTINGS}), 200
        return jsonify({"ok": True, "settings": serialize_doc(dict(DEFAULT_SETTINGS, **(snap.to_dict() or {})))}), 200

    data = request.json or {}
    updates = {}
    for key, value in (data.get('settings') or {}).items():
        if key not in SETTINGS_BOUNDS:
            return jsonify({"error": f"Unknown setting: {key}"}), 400
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            return jsonify({"error": f"{key} must be a number"}), 400
        low, high = SETTINGS_BOUNDS[key]
        if numeric < low or numeric > high:
            return jsonify({"error": f"{key} must be between {low} and {high}"}), 400
        if key == 'coinDiscountPercent' and 50 < numeric < FREE_PACK_PERCENT:
            return jsonify({"error": "The store discount is up to 50%, or 100% for one free pack a day."}), 400
        updates[key] = numeric

    if not updates:
        return jsonify({"error": "No settings provided"}), 400

    settings_ref.set(updates, merge=True)
    return jsonify({"ok": True, "settings": updates}), 200

# ==========================================
# COIN PURCHASES
# ==========================================

PAYMENT_PROVIDER = env_value("PAYMENT_PROVIDER")

RAZORPAY_API = "https://api.razorpay.com/v1"
COIN_ORDERS = 'coin_orders'

# A single top-up is capped so a typo (or a tampered client) cannot open an
# order for an amount nobody intends to pay. The floor comes from the
# admin-editable minRechargeAmount.
MAX_RECHARGE_INR = 100000


def payments_ready():
    """True when a provider is configured and its secrets are present."""
    # bool(), not the bare `and` chain — that returns the secret itself, which
    # is one careless log line away from being written down somewhere.
    return bool(
        PAYMENT_PROVIDER == 'razorpay'
        and env_value("RAZORPAY_KEY_ID")
        and env_value("RAZORPAY_KEY_SECRET")
    )


def payments_unavailable_response():
    if not PAYMENT_PROVIDER:
        return jsonify({
            "error": "Coin purchases are not available yet.",
            "code": "payments_not_configured",
        }), 501
    if PAYMENT_PROVIDER != 'razorpay':
        return jsonify({
            "error": f"Payment verification for '{PAYMENT_PROVIDER}' is not implemented.",
            "code": "payments_not_implemented",
        }), 501
    return jsonify({
        "error": "Payments are misconfigured on the server.",
        "code": "payments_not_configured",
    }), 501


def razorpay_auth():
    return (require_env("RAZORPAY_KEY_ID"), require_env("RAZORPAY_KEY_SECRET"))


def pricing_settings():
    """Global pricing with the built-in defaults as a floor."""
    snap = firestore.client().collection('settings').document('pricing').get()
    settings = DEFAULT_SETTINGS.copy()
    if snap.exists:
        settings.update(snap.to_dict() or {})
    return settings


def coin_discount(settings):
    """The store-wide discount on paid packs as a fraction, within 0-50%."""
    return min(max(float(settings.get('coinDiscountPercent') or 0), 0.0), 50.0) / 100.0


# A 100% discount does not make packs cost nothing to buy -- that would be
# unlimited coins for everyone. It switches the store to one free pack per
# person per India day instead, and paid top-ups are off while it lasts.
FREE_PACK_PERCENT = 100
FREE_PACK_CLAIMS = 'free_pack_claims'
# The store's packs by id and full price, as CoinsScreen lists them. Only
# needed here for free packs: a paid order states its own amount.
STORE_PACKS_INR = {'1': 89, '2': 449, '3': 899, '4': 1799}


def free_packs_on(settings):
    return float(settings.get('coinDiscountPercent') or 0) >= FREE_PACK_PERCENT


def coins_for_inr(amount_inr, settings):
    """Coin yield for a rupee amount.

    Floors, matching `coinsFor` on the client, so the quoted figure on the
    store screen is the figure actually credited. A discount is a lower price
    for the same coins: what is paid buys what the full price would have.
    """
    rate = float(settings['inrToCoinRechargeRate'])
    return int(math.floor(float(amount_inr) * rate / (1 - coin_discount(settings))))


FIRST_BUY_PACKAGE = 'first_buy'


def first_buy_offer(settings):
    """(price, coins) of the first-purchase pack, or None when it is off."""
    price = float(settings.get('firstBuyPriceInr') or 0)
    coins = int(float(settings.get('firstBuyCoins') or 0))
    return (price, coins) if price > 0 and coins > 0 else None


def first_buy_eligible(db_client, uid):
    """Nobody who has ever completed a recharge gets the first-purchase pack."""
    user = db_client.collection('users').document(uid).get()
    if user.exists and (user.to_dict() or {}).get('firstBuyUsed'):
        return False
    paid = (db_client.collection(COIN_ORDERS)
            .where('uid', '==', uid).where('status', '==', 'paid').limit(1).stream())
    return not list(paid)


# ── Per-day totals, kept by call billing ─────────────────────────────────────
#
# One document per person per day (India time): the paid voice seconds a payer
# talked (the daily bonus), the coins they spent on calls (the day's revenue)
# and the paid seconds a host talked (the host bonus). Only paid seconds count,
# so a caller with no coins cannot farm either. Server-only: the rules have no
# match for this collection, so clients can neither read nor write it.

USER_DAYS = 'user_days'
IST = timezone(timedelta(hours=5, minutes=30))
USER_DAY_TOTALS = ('paidVoiceSecs', 'spentCoins', 'hostSecs')


def ist_day(moment):
    return moment.astimezone(IST).strftime('%Y-%m-%d')


def user_day_ref(db_client, uid, day):
    return db_client.collection(USER_DAYS).document(f"{day}_{uid}")


def add_to_day(transaction, ref, snap, uid, day, **amounts):
    data = (snap.to_dict() or {}) if snap.exists else {}
    out = {"uid": uid, "day": day, "bonusClaimed": bool(data.get('bonusClaimed'))}
    for key in USER_DAY_TOTALS:
        out[key] = round(float(data.get(key) or 0) + float(amounts.get(key) or 0), 3)
    transaction.set(ref, out)


@app.route('/api/v1/withdrawals/request', methods=['POST', 'OPTIONS'])
def request_withdrawal():
    """Opens a payout request, deducting the hearts it is worth.

    Previously the client wrote straight into /withdrawalRequests and the rules
    checked only `hearts > 0`. Nothing compared that number against what the
    user had actually earned, so a patched client could request any payout it
    liked; nothing stopped a second request being opened alongside the first;
    and approving one never reduced the balance, so the same hearts could be
    cashed out repeatedly. Hearts are real money via `heartToInrRate`, so all
    three were live revenue leaks.

    Deducting at request time rather than at approval closes all three at once:
    the balance is spent the moment the claim is staked, so it cannot be
    claimed twice, and the payable amount is fixed to hearts that provably
    existed. A rejection refunds them.

    `pendingWithdrawalId` on the user document is what makes "one open request"
    enforceable inside a single-document transaction — a query would need a
    composite index and could not be read transactionally without one.
    """
    if request.method == 'OPTIONS':
        return ('', 204)

    uid, error_response = require_bearer_uid()
    if error_response:
        return error_response

    try:
        settings = pricing_settings()
        min_hearts = float(settings.get('minWithdrawalHearts', DEFAULT_SETTINGS['minWithdrawalHearts']))
        heart_rate = float(settings.get('heartToInrRate', DEFAULT_SETTINGS['heartToInrRate']))

        db_client = firestore.client()
        user_ref = db_client.collection('users').document(uid)
        request_ref = db_client.collection('withdrawalRequests').document()
        transaction = db_client.transaction()

        @firestore.transactional
        def apply(transaction):
            snap = user_ref.get(transaction=transaction)
            if not snap.exists:
                raise ValueError("User does not exist")
            user_data = snap.to_dict() or {}

            if user_data.get('pendingWithdrawalId'):
                raise ValueError("A withdrawal request is already awaiting review.")

            # Payouts are whole hearts, but the balance is not guaranteed to be
            # one: the call-reward path derives hearts from a duration divided
            # by a configurable threshold, which can land on a fraction. The
            # remainder is carried rather than discarded — zeroing the field
            # outright silently confiscated it, and hearts are worth real money.
            hearts_available = float(user_data.get('hearts') or 0)
            hearts = int(hearts_available)
            remainder = hearts_available - hearts

            if hearts < min_hearts:
                raise ValueError(
                    f"You need at least {int(min_hearts)} hearts to withdraw."
                )

            # Computed here, never taken from the request body: the client's
            # figure is a display convenience, not an instruction to pay.
            amount_inr = round(hearts * heart_rate, 2)

            transaction.set(request_ref, {
                'uid': uid,
                'hearts': hearts,
                'amountInr': amount_inr,
                'heartToInrRate': heart_rate,
                'status': 'pending',
                # Marks this claim as one whose hearts were actually taken up
                # front. Requests written by the old client path were not, and
                # refunding one of those on rejection would create hearts that
                # never existed — see the refund guard in resolve_withdrawal.
                'heartsDeducted': True,
                'createdAt': firestore.SERVER_TIMESTAMP,
            })
            # Same transaction as the request write, so a crash between the two
            # cannot leave a claim open against hearts that were never spent.
            transaction.update(user_ref, {
                'hearts': remainder,
                'pendingWithdrawalId': request_ref.id,
            })
            return hearts, amount_inr

        hearts, amount_inr = apply(transaction)
        return jsonify({
            "success": True,
            "requestId": request_ref.id,
            "hearts": hearts,
            "amountInr": amount_inr,
        }), 200

    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        print(f"[WITHDRAWAL] request failed for {uid}: {e}", flush=True)
        return jsonify({"error": "Could not open a withdrawal request"}), 500


@app.route('/api/v1/withdrawals/resolve', methods=['POST', 'OPTIONS'])
def resolve_withdrawal():
    """Admin decision on a payout request.

    Rejecting refunds the hearts, because they were already taken when the
    request was opened — without this the user would simply lose them, which is
    the mirror image of the bug this endpoint exists to fix.

    Approving does not deduct anything: that already happened. It only clears
    the open-request marker, so a user whose payout is approved can start
    earning towards the next one immediately rather than being locked out until
    an operator remembers to reset a flag by hand.
    """
    if request.method == 'OPTIONS':
        return ('', 204)

    admin_id, error_response = require_admin_uid()
    if error_response:
        return error_response

    data = request.get_json(silent=True) or {}
    request_id = str(data.get('requestId') or '').strip()
    new_status = str(data.get('status') or '').strip()

    if not request_id:
        return jsonify({"error": "requestId is required"}), 400
    if new_status not in ('approved', 'rejected', 'paid'):
        return jsonify({"error": "status must be approved, rejected or paid"}), 400

    try:
        db_client = firestore.client()
        request_ref = db_client.collection('withdrawalRequests').document(request_id)
        transaction = db_client.transaction()

        @firestore.transactional
        def apply(transaction):
            req_snap = request_ref.get(transaction=transaction)
            if not req_snap.exists:
                raise ValueError("Unknown withdrawal request")
            req = req_snap.to_dict() or {}

            # Legal transitions. `pending` and `approved` are both live states,
            # so an operator can authorise a payout and then mark it paid once
            # the transfer clears — treating every non-pending state as final
            # made that ordinary two-step workflow impossible, and forced
            # operators to jump straight to `paid` before the money had moved.
            #
            # `paid` and `rejected` are terminal, which is what stops a replayed
            # rejection refunding the same hearts twice.
            allowed_next = {
                'pending': {'approved', 'rejected', 'paid'},
                # Once approved, only `paid` is allowed. Rejecting after approve
                # used to refund hearts even when the INR transfer may already
                # have left the building — a double payout.
                'approved': {'paid'},
            }
            current_status = req.get('status')
            if new_status not in allowed_next.get(current_status, set()):
                raise ValueError(
                    f"Request is already {current_status}"
                    if current_status in ('paid', 'rejected')
                    else f"Cannot move a {current_status} request to {new_status}"
                )

            target_uid = req.get('uid')
            if not target_uid:
                raise ValueError("Request has no owner")
            user_ref = db_client.collection('users').document(target_uid)
            user_snap = user_ref.get(transaction=transaction)
            if not user_snap.exists:
                raise ValueError("User does not exist")
            user_data = user_snap.to_dict() or {}

            user_update = {}
            # Only clear when the marker still points at this request — a newer
            # pending claim must keep its lock.
            if user_data.get('pendingWithdrawalId') == request_id:
                user_update['pendingWithdrawalId'] = firestore.DELETE_FIELD
            # Refund only when hearts were actually debited (pre-endpoint
            # client writes never deducted, so refunding those would mint).
            if new_status == 'rejected' and req.get('heartsDeducted'):
                refund = int(req.get('hearts') or 0)
                user_update['hearts'] = int(user_data.get('hearts') or 0) + refund

            transaction.update(request_ref, {
                'status': new_status,
                'resolvedAt': firestore.SERVER_TIMESTAMP,
                'resolvedBy': admin_id,
            })
            if user_update:
                transaction.update(user_ref, user_update)
            return target_uid

        target_uid = apply(transaction)
        return jsonify({"success": True, "requestId": request_id, "status": new_status, "uid": target_uid}), 200

    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        print(f"[WITHDRAWAL] resolve failed for {request_id}: {e}", flush=True)
        return jsonify({"error": "Could not resolve the withdrawal request"}), 500


@app.route('/api/v1/coins/order', methods=['POST', 'OPTIONS'])
def create_coin_order():
    """Opens a Razorpay order for a top-up.

    The coin yield is computed here and frozen onto the order document. The
    client never states how many coins it is buying, and a later change to
    `inrToCoinRechargeRate` cannot re-price an order that is already open —
    the buyer gets the rate they were quoted.
    """
    if request.method == 'OPTIONS':
        return '', 200

    uid, error_response = require_bearer_uid()
    if error_response:
        return error_response

    if not payments_ready():
        return payments_unavailable_response()

    data = request.json or {}
    settings = pricing_settings()
    if free_packs_on(settings):
        return jsonify({"error": "Packs are free today. Tap one to claim it.", "code": "free_packs"}), 400

    try:
        amount_inr = parse_positive_number(data.get("amountInr"), "amountInr")
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    package_id = str(data.get("packageId") or 'custom')[:40]
    if package_id == FIRST_BUY_PACKAGE:
        offer = first_buy_offer(settings)
        if not offer:
            return jsonify({"error": "This offer is not available."}), 400
        price, coins = offer
        if abs(amount_inr - price) > 0.005:
            return jsonify({"error": "The offer price has changed. Reopen the Store."}), 400
        if not first_buy_eligible(firestore.client(), uid):
            return jsonify({"error": "The first-purchase offer is only for your first recharge."}), 400
    else:
        # The minimum is on the full price, so a discount never pushes a pack
        # under it.
        minimum = float(settings['minRechargeAmount'])
        if amount_inr / (1 - coin_discount(settings)) < minimum - 0.005:
            return jsonify({"error": f"The minimum recharge amount is {minimum:g} rupees."}), 400
        if amount_inr > MAX_RECHARGE_INR:
            return jsonify({"error": f"The maximum recharge amount is {MAX_RECHARGE_INR} rupees."}), 400

        coins = coins_for_inr(amount_inr, settings)
        if coins <= 0:
            return jsonify({"error": "That amount does not buy any coins."}), 400

    amount_paise = int(round(amount_inr * 100))

    try:
        response = requests.post(
            f"{RAZORPAY_API}/orders",
            auth=razorpay_auth(),
            json={
                "amount": amount_paise,
                "currency": "INR",
                "notes": {"uid": uid, "coins": str(coins), "packageId": package_id},
            },
            timeout=15,
        )
    except requests.RequestException as e:
        print(f"[COINS] Razorpay order request failed: {e}")
        return jsonify({"error": "Could not reach the payment provider."}), 502

    if response.status_code >= 300:
        print(f"[COINS] Razorpay order rejected ({response.status_code}): {response.text}")
        return jsonify({"error": "The payment provider rejected this order."}), 502

    order_id = (response.json() or {}).get("id")
    if not order_id:
        return jsonify({"error": "The payment provider returned no order id."}), 502

    firestore.client().collection(COIN_ORDERS).document(order_id).set({
        "uid": uid,
        "amountInr": amount_inr,
        "amountPaise": amount_paise,
        "coins": coins,
        "packageId": package_id,
        "status": "created",
        "createdAt": firestore.SERVER_TIMESTAMP,
    })

    base_url = env_value("PUBLIC_BASE_URL").rstrip('/')
    return jsonify({
        "ok": True,
        "orderId": order_id,
        "amountInr": amount_inr,
        "coins": coins,
        "checkoutUrl": f"{base_url}/pay/razorpay/{order_id}",
    }), 200


@app.route('/api/v1/coins/purchase', methods=['POST', 'OPTIONS'])
def purchase_coins():
    """Credits coins for a payment that Razorpay confirms it captured.

    Three independent checks stand between a request and a coin balance, and
    all three are needed:

      * the HMAC signature proves the ids came from Razorpay's checkout and
        were not typed by hand;
      * fetching the payment proves money actually moved — a signature only
        covers the fields, not the capture;
      * the order document, flipped to `paid` inside the same transaction that
        credits the balance, means a replayed receipt credits nothing.

    The client sends no amount and no coin count; both come from the order
    opened earlier by `create_coin_order`.
    """
    if request.method == 'OPTIONS':
        return '', 200

    uid, error_response = require_bearer_uid()
    if error_response:
        return error_response

    if not payments_ready():
        return payments_unavailable_response()

    data = request.json or {}
    order_id = data.get("razorpay_order_id")
    payment_id = data.get("razorpay_payment_id")
    signature = data.get("razorpay_signature")
    if not order_id or not payment_id or not signature:
        return jsonify({"error": "Missing payment confirmation fields"}), 400

    secret = require_env("RAZORPAY_KEY_SECRET")
    expected = hmac.new(
        secret.encode("utf-8"),
        f"{order_id}|{payment_id}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, str(signature)):
        print(f"[COINS] Rejected purchase with a bad signature for order {order_id}")
        return jsonify({"error": "This payment could not be verified."}), 400

    try:
        response = requests.get(
            f"{RAZORPAY_API}/payments/{payment_id}",
            auth=razorpay_auth(),
            timeout=15,
        )
    except requests.RequestException as e:
        print(f"[COINS] Razorpay payment lookup failed: {e}")
        return jsonify({"error": "Could not reach the payment provider."}), 502

    if response.status_code >= 300:
        print(f"[COINS] Razorpay payment lookup rejected ({response.status_code}): {response.text}")
        return jsonify({"error": "The payment provider could not confirm this payment."}), 502

    payment = response.json() or {}
    if payment.get("order_id") != order_id:
        return jsonify({"error": "This payment belongs to a different order."}), 400
    if payment.get("status") != "captured":
        # Authorized-but-uncaptured money has not settled; crediting here would
        # hand out coins for a charge that can still fall through.
        return jsonify({"error": "This payment has not completed yet."}), 400

    try:
        db_client = firestore.client()
        order_ref = db_client.collection(COIN_ORDERS).document(order_id)
        user_ref = db_client.collection('users').document(uid)
        transaction = db_client.transaction()

        @firestore.transactional
        def credit(transaction):
            order_snap = order_ref.get(transaction=transaction)
            if not order_snap.exists:
                raise ValueError("Unknown order")
            order = order_snap.to_dict() or {}
            if order.get("uid") != uid:
                raise ValueError("This order belongs to another account")

            user_snap = user_ref.get(transaction=transaction)
            balance = get_coin_balance(user_snap)

            if order.get("status") == "paid":
                # A retried confirmation, most likely the app resending after a
                # dropped response. Report the balance without crediting twice.
                if order.get("paymentId") == payment_id:
                    return balance, 0
                raise ValueError("This order has already been paid")
            if order.get("status") != "created":
                raise ValueError("This order is no longer open")

            if int(payment.get("amount") or 0) != int(order.get("amountPaise") or 0):
                raise ValueError("The payment amount does not match the order")

            coins = int(order.get("coins") or 0)
            if order.get("packageId") == FIRST_BUY_PACKAGE and (user_snap.to_dict() or {}).get("firstBuyUsed"):
                # A second first-purchase order opened before the first was
                # paid. The money is in, so it buys coins -- at the ordinary
                # rate, not the offer's.
                coins = int(math.floor(
                    float(order.get("amountInr") or 0) * float(pricing_settings()['inrToCoinRechargeRate'])
                ))
            new_balance = balance + coins
            # Any completed recharge ends first-purchase eligibility.
            transaction.update(user_ref, {"coins": new_balance, "firstBuyUsed": True})
            transaction.update(order_ref, {
                "status": "paid",
                "paymentId": payment_id,
                "paidAt": firestore.SERVER_TIMESTAMP,
            })
            return new_balance, coins

        new_balance, credited = credit(transaction)
        return jsonify({"ok": True, "newBalance": new_balance, "coinsCredited": credited}), 200
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        print(f"[COINS] Purchase credit error for order {order_id}: {e}")
        return jsonify({"error": "Could not add the coins to your balance."}), 500


@app.route('/api/v1/coins/offers', methods=['GET'])
def coin_offers():
    """What the store shows: the discount, and the first-purchase pack if this
    account can still have it."""
    uid, error_response = require_bearer_uid()
    if error_response:
        return error_response
    settings = pricing_settings()
    offer = first_buy_offer(settings)
    first_buy = None
    if offer and first_buy_eligible(firestore.client(), uid):
        first_buy = {"priceInr": offer[0], "coins": offer[1]}
    free = free_packs_on(settings)
    claimed = False
    if free:
        day = ist_day(datetime.now(timezone.utc))
        claimed = firestore.client().collection(FREE_PACK_CLAIMS).document(f"{day}_{uid}").get().exists
    return jsonify({
        "ok": True,
        # Old apps clamp this to 50 and try to pay, which create_coin_order
        # refuses with a message saying packs are free.
        "discountPercent": FREE_PACK_PERCENT if free else round(coin_discount(settings) * 100, 2),
        "firstBuy": None if free else first_buy,
        "freePacks": free,
        "freePackClaimedToday": claimed,
    }), 200


@app.route('/api/v1/coins/free-pack', methods=['POST', 'OPTIONS'])
def claim_free_pack():
    """One store pack free, once per person per India day, while the admin
    has the store discount at 100%. The coins are what the pack's full price
    buys at the current rate."""
    if request.method == 'OPTIONS':
        return '', 200
    uid, error_response = require_bearer_uid()
    if error_response:
        return error_response
    settings = pricing_settings()
    if not free_packs_on(settings):
        return jsonify({"error": "Packs are not free right now."}), 400
    package_id = str((request.json or {}).get('packageId') or '')
    price = STORE_PACKS_INR.get(package_id)
    if price is None:
        return jsonify({"error": "No such pack."}), 400
    coins = int(math.floor(price * float(settings['inrToCoinRechargeRate'])))

    db_client = firestore.client()
    day = ist_day(datetime.now(timezone.utc))
    claim_ref = db_client.collection(FREE_PACK_CLAIMS).document(f"{day}_{uid}")
    user_ref = db_client.collection('users').document(uid)
    try:
        transaction = db_client.transaction()

        @firestore.transactional
        def claim(transaction):
            claim_snap = claim_ref.get(transaction=transaction)
            user_snap = user_ref.get(transaction=transaction)
            if claim_snap.exists:
                raise ValueError("You have had today's free pack. Come back tomorrow.")
            if not user_snap.exists:
                raise ValueError("Your account is not set up yet.")
            balance = get_coin_balance(user_snap)
            transaction.update(user_ref, {"coins": balance + coins})
            transaction.set(claim_ref, {
                "uid": uid, "day": day, "packageId": package_id,
                "coins": coins, "at": datetime.now(timezone.utc),
            })
            return balance + coins

        new_balance = claim(transaction)
        return jsonify({"ok": True, "coins": coins, "newBalance": new_balance}), 200
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        print(f"[COINS] Free pack error: {e}")
        return jsonify({"error": "Could not add the free pack."}), 500


@app.route('/api/v1/bonus/daily', methods=['GET', 'POST', 'OPTIONS'])
def daily_bonus():
    """Free coins once a day, claimable after enough paid voice minutes.

    GET says where today stands; POST claims. Both amounts are admin settings
    (dailyBonusCoins, dailyBonusMinVoiceMinutes); 0 coins switches it off. The
    talk time is what call billing recorded as paid, so it cannot be claimed.
    """
    if request.method == 'OPTIONS':
        return '', 200
    uid, error_response = require_bearer_uid()
    if error_response:
        return error_response
    settings = pricing_settings()
    bonus = int(float(settings.get('dailyBonusCoins') or 0))
    need_secs = float(settings.get('dailyBonusMinVoiceMinutes') or 0) * 60
    db_client = firestore.client()
    day = ist_day(datetime.now(timezone.utc))
    day_ref = user_day_ref(db_client, uid, day)

    def status(data):
        talked = float(data.get('paidVoiceSecs') or 0)
        claimed = bool(data.get('bonusClaimed'))
        return {
            "coins": bonus,
            "minMinutes": need_secs / 60,
            "talkedSeconds": round(talked, 1),
            "claimed": claimed,
            "canClaim": bonus > 0 and not claimed and talked >= need_secs,
        }

    if request.method == 'GET':
        snap = day_ref.get()
        return jsonify({"ok": True, **status((snap.to_dict() or {}) if snap.exists else {})}), 200

    user_ref = db_client.collection('users').document(uid)
    try:
        transaction = db_client.transaction()

        @firestore.transactional
        def claim(transaction):
            day_snap = day_ref.get(transaction=transaction)
            user_snap = user_ref.get(transaction=transaction)
            data = (day_snap.to_dict() or {}) if day_snap.exists else {}
            now_status = status(data)
            if bonus <= 0:
                raise ValueError("There is no daily bonus right now.")
            if now_status["claimed"]:
                raise ValueError("You have already had today's bonus.")
            if not now_status["canClaim"]:
                left = max(0.0, need_secs - now_status["talkedSeconds"]) / 60
                raise ValueError(f"Talk {math.ceil(left)} more minute(s) on a voice call to unlock today's bonus.")
            balance = get_coin_balance(user_snap)
            transaction.update(user_ref, {"coins": balance + bonus})
            out = {"uid": uid, "day": day, "bonusClaimed": True}
            for key in USER_DAY_TOTALS:
                out[key] = float(data.get(key) or 0)
            transaction.set(day_ref, out)
            return balance + bonus

        new_balance = claim(transaction)
        return jsonify({"ok": True, "coins": bonus, "newBalance": new_balance}), 200
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        print(f"[BONUS] Daily claim error: {e}")
        return jsonify({"error": "Could not add today's bonus."}), 500


# Shares of the host bonus pool, first place first. Past tenth, each further
# winner weighs the same as tenth. Normalised over however many qualify.
HOST_BONUS_SPLIT = (25, 18, 13, 10, 8, 7, 6, 5, 4, 4)
HOST_BONUS_PAYOUTS = 'host_bonus_payouts'
DAY_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')


def host_bonus_plan(db_client, day, settings, amount_inr=None):
    """Who wins the host bonus for `day`, and how much each gets.

    The hosts who talked the most paid minutes that day, at least
    hostBonusMinMinutes, up to hostBonusTopCount of them, share a pool of
    hostBonusPoolPercent of the day's call revenue -- or `amount_inr` when the
    admin names an amount. Paid as hearts at heartToInrRate.
    """
    rows = [d.to_dict() or {} for d in db_client.collection(USER_DAYS).where('day', '==', day).stream()]
    rate = float(settings['inrToCoinRechargeRate']) or 1.0
    revenue_inr = round(sum(float(r.get('spentCoins') or 0) for r in rows) / rate, 2)
    min_secs = float(settings.get('hostBonusMinMinutes') or 0) * 60
    top = int(float(settings.get('hostBonusTopCount') or 10))
    hosts = sorted(
        (r for r in rows if float(r.get('hostSecs') or 0) > 0 and float(r.get('hostSecs') or 0) >= min_secs),
        key=lambda r: -float(r.get('hostSecs') or 0),
    )[:top]
    percent = float(settings.get('hostBonusPoolPercent') or 0)
    pool = round(float(amount_inr) if amount_inr is not None else revenue_inr * percent / 100, 2)
    weights = [HOST_BONUS_SPLIT[min(i, len(HOST_BONUS_SPLIT) - 1)] for i in range(len(hosts))]
    total = sum(weights) or 1
    heart_rate = float(settings.get('heartToInrRate') or 0)
    winners = []
    for rank, (row, weight) in enumerate(zip(hosts, weights), 1):
        inr = round(pool * weight / total, 2)
        winners.append({
            "rank": rank,
            "uid": row.get('uid'),
            "minutes": round(float(row.get('hostSecs') or 0) / 60, 1),
            "inr": inr,
            "hearts": round(inr / heart_rate, 2) if heart_rate > 0 else 0,
        })
    return {
        "day": day,
        "revenueInr": revenue_inr,
        "poolInr": pool,
        "poolPercent": percent,
        "fixedAmount": amount_inr is not None,
        "winners": winners,
    }


@app.route('/api/v1/admin/host-bonus', methods=['POST', 'OPTIONS'])
def admin_host_bonus():
    """Preview or pay one day's host bonus. Admin only, once per day.

    Body: day (YYYY-MM-DD, India time; defaults to yesterday), action
    ('preview' | 'pay'), amountInr (optional: the pool instead of the
    percentage). A day can only be paid once it is over.
    """
    if request.method == 'OPTIONS':
        return '', 200
    admin_uid, error_response = require_admin_uid()
    if error_response:
        return error_response
    data = request.json or {}
    today = ist_day(datetime.now(timezone.utc))
    day = str(data.get('day') or ist_day(datetime.now(timezone.utc) - timedelta(days=1))).strip()
    action = str(data.get('action') or 'preview')
    if not DAY_RE.match(day):
        return jsonify({"error": "day must be YYYY-MM-DD"}), 400
    if action not in ('preview', 'pay'):
        return jsonify({"error": "action must be preview or pay"}), 400
    amount_inr = None
    if data.get('amountInr') not in (None, ''):
        try:
            amount_inr = float(data.get('amountInr'))
        except (TypeError, ValueError):
            return jsonify({"error": "amountInr must be a number"}), 400
        if amount_inr < 0 or amount_inr > 1000000:
            return jsonify({"error": "amountInr must be between 0 and 1000000"}), 400

    db_client = firestore.client()
    settings = pricing_settings()
    payout_ref = db_client.collection(HOST_BONUS_PAYOUTS).document(day)

    def with_names(plan):
        for w in plan["winners"]:
            snap = db_client.collection('users').document(w["uid"]).get()
            info = (snap.to_dict() or {}) if snap.exists else {}
            w["nickname"] = info.get('nickname') or info.get('username') or 'Host'
        return plan

    if action == 'preview':
        paid = payout_ref.get()
        if paid.exists:
            return jsonify({"ok": True, "paid": True, **serialize_doc(paid.to_dict() or {})}), 200
        return jsonify({"ok": True, "paid": False, **with_names(host_bonus_plan(db_client, day, settings, amount_inr))}), 200

    if day >= today:
        return jsonify({"error": "A day can be paid once it is over."}), 400
    plan = with_names(host_bonus_plan(db_client, day, settings, amount_inr))
    if not plan["winners"]:
        return jsonify({"error": "No host qualified that day."}), 400
    try:
        transaction = db_client.transaction()

        @firestore.transactional
        def pay(transaction):
            if payout_ref.get(transaction=transaction).exists:
                raise ValueError("That day's host bonus has already been paid.")
            refs = [db_client.collection('users').document(w["uid"]) for w in plan["winners"]]
            snaps = [ref.get(transaction=transaction) for ref in refs]
            for ref, snap, w in zip(refs, snaps, plan["winners"]):
                hearts = float((snap.to_dict() or {}).get('hearts') or 0) if snap.exists else 0.0
                transaction.update(ref, {"hearts": round(hearts + w["hearts"], 2)})
            transaction.set(payout_ref, {**plan, "paidBy": admin_uid, "paidAt": datetime.now(timezone.utc)})

        pay(transaction)
        return jsonify({"ok": True, "paid": True, **plan}), 200
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        print(f"[BONUS] Host bonus payout error for {day}: {e}")
        return jsonify({"error": "Could not pay the host bonus."}), 500


# ==========================================
# MODERATION: REPORTS AND BANS
# ==========================================
#
# Reports are written by clients (profile / chat / call) and were readable only
# in the Firebase console. The admin panel now lists them grouped by the person
# reported, and can dismiss them or ban that person. A ban:
#   * sets users.banned (server-only: not in the rules' userMutableKeys),
#   * disables the Firebase account and revokes its sessions, so the app signs
#     out and cannot sign back in,
#   * is refused by every authenticated endpoint at once (require_bearer_uid),
#     without waiting the up-to-an-hour an existing ID token stays valid,
#   * hides them from every user list, and closes their open reports.
# Unbanning reverses all of it except the closed reports.

BANNED_CACHE = {"at": 0.0, "uids": frozenset()}
BANNED_CACHE_SECONDS = 60


def banned_uids():
    """Banned accounts, re-read at most once a minute (a ban clears this at once)."""
    now = time.time()
    if now - BANNED_CACHE["at"] > BANNED_CACHE_SECONDS:
        try:
            snaps = firestore.client().collection('users').where('banned', '==', True).stream()
            BANNED_CACHE["uids"] = frozenset(s.id for s in snaps)
            BANNED_CACHE["at"] = now
        except Exception as e:
            # Keep the last good list rather than unbanning everybody.
            print(f"[MOD] Could not refresh the banned list: {e}")
    return BANNED_CACHE["uids"]


def report_time(report):
    return ludo_secs(report.get('createdAt')) or 0.0


@app.route('/api/v1/admin/reports', methods=['POST', 'OPTIONS'])
def admin_reports():
    """List reports grouped by who was reported, or dismiss them. Admin only.

    action 'list' (status 'open' by default, or 'resolved'): groups ordered by
    how many reports each person has, with reasons, reporters and dates, plus
    the banned accounts. action 'dismiss' with targetUid closes that person's
    open reports without banning them.
    """
    if request.method == 'OPTIONS':
        return '', 200
    admin_uid, error_response = require_admin_uid()
    if error_response:
        return error_response
    data = request.json or {}
    action = str(data.get('action') or 'list')
    db_client = firestore.client()

    if action == 'dismiss':
        target = str(data.get('targetUid') or '').strip()
        if not target:
            return jsonify({"error": "Missing targetUid"}), 400
        closed = close_reports(db_client, target, admin_uid, 'dismissed')
        return jsonify({"ok": True, "closed": closed}), 200
    if action != 'list':
        return jsonify({"error": "action must be list or dismiss"}), 400

    status = 'resolved' if data.get('status') == 'resolved' else 'open'
    reports = [(s.id, s.to_dict() or {}) for s in db_client.collection('reports').where('status', '==', status).stream()]
    reports.sort(key=lambda r: -report_time(r[1]))
    reports = reports[:300]

    names = {}

    def name(uid):
        if uid not in names:
            snap = db_client.collection('users').document(uid).get() if uid else None
            info = (snap.to_dict() or {}) if snap is not None and snap.exists else {}
            names[uid] = {
                "nickname": info.get('nickname') or info.get('username') or 'Unknown',
                "banned": bool(info.get('banned')),
            }
        return names[uid]

    groups = {}
    for report_id, r in reports:
        target = r.get('targetUid') or ''
        group = groups.setdefault(target, {
            "targetUid": target, "nickname": name(target)["nickname"], "banned": name(target)["banned"],
            "count": 0, "reasons": {}, "latestAt": None, "reports": [],
        })
        group["count"] += 1
        reason = r.get('reason') or 'Something else'
        group["reasons"][reason] = group["reasons"].get(reason, 0) + 1
        if group["latestAt"] is None:
            group["latestAt"] = serialize_doc({"at": r.get('createdAt')}).get('at')
        if len(group["reports"]) < 10:
            group["reports"].append({
                "id": report_id,
                "reason": reason,
                "source": r.get('source'),
                "reporter": name(r.get('reporterUid') or '')["nickname"],
                "createdAt": serialize_doc({"at": r.get('createdAt')}).get('at'),
            })
    ordered = sorted(groups.values(), key=lambda g: -g["count"])

    banned = []
    for snap in db_client.collection('users').where('banned', '==', True).stream():
        info = snap.to_dict() or {}
        banned.append({
            "uid": snap.id,
            "nickname": info.get('nickname') or info.get('username') or 'Unknown',
            "reason": info.get('banReason') or '',
            "bannedAt": serialize_doc({"at": info.get('bannedAt')}).get('at'),
        })
    return jsonify({"ok": True, "status": status, "groups": ordered, "banned": banned}), 200


def close_reports(db_client, target_uid, admin_uid, resolution):
    """Mark every open report about `target_uid` resolved. Returns how many."""
    closed = 0
    open_reports = db_client.collection('reports').where('targetUid', '==', target_uid).where('status', '==', 'open').stream()
    for snap in open_reports:
        db_client.collection('reports').document(snap.id).update({
            "status": "resolved",
            "resolution": resolution,
            "resolvedBy": admin_uid,
            "resolvedAt": datetime.now(timezone.utc),
        })
        closed += 1
    return closed


@app.route('/api/v1/admin/ban', methods=['POST', 'OPTIONS'])
def admin_ban():
    """Ban (banned: true, with a reason) or unban (banned: false) an account."""
    if request.method == 'OPTIONS':
        return '', 200
    admin_uid, error_response = require_admin_uid()
    if error_response:
        return error_response
    data = request.json or {}
    target = str(data.get('uid') or '').strip()
    banned = data.get('banned', True) is not False
    reason = str(data.get('reason') or '').strip()[:200]
    if not target:
        return jsonify({"error": "Missing uid"}), 400
    if banned and target in admin_uids():
        return jsonify({"error": "An admin account cannot be banned."}), 400

    db_client = firestore.client()
    user_ref = db_client.collection('users').document(target)
    if not user_ref.get().exists:
        return jsonify({"error": "No such account"}), 404
    now = datetime.now(timezone.utc)
    if banned:
        user_ref.update({
            "banned": True, "banReason": reason or 'Reported', "bannedAt": now, "bannedBy": admin_uid,
            # Off the lists straight away rather than when the presence times out.
            "isOnline": False,
        })
    else:
        user_ref.update({"banned": False, "banReason": None, "bannedAt": None, "bannedBy": None})

    sign_in = True
    try:
        auth.update_user(target, disabled=banned)
        if banned:
            auth.revoke_refresh_tokens(target)
    except Exception as e:
        # The ban still stands: every endpoint refuses the account regardless.
        sign_in = False
        print(f"[MOD] Could not {'disable' if banned else 'enable'} sign-in for {target}: {e}")

    closed = close_reports(db_client, target, admin_uid, 'banned') if banned else 0
    BANNED_CACHE["at"] = 0.0
    return jsonify({"ok": True, "banned": banned, "signInUpdated": sign_in, "reportsClosed": closed}), 200


# ==========================================
# COUPON CODES
# ==========================================
#
# The admin makes codes worth some coins (100 by default); a user types one in
# the Store and gets the coins. Each person can use a code once, a code can be
# capped in uses and given an end date, and the admin can switch it off.
# Server-only: the rules have no match for coupons or coupon_redemptions.

COUPONS = 'coupons'
COUPON_REDEMPTIONS = 'coupon_redemptions'
COUPON_DEFAULT_COINS = 100
COUPON_MAX_COINS = 100000
COUPON_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def coupon_normalize(raw):
    code = re.sub(r'[^A-Za-z0-9]', '', str(raw or '')).upper()
    return code if 4 <= len(code) <= 20 else None


@app.route('/api/v1/coupons/redeem', methods=['POST', 'OPTIONS'])
def coupon_redeem_endpoint():
    """Redeem a coupon code for coins, once per person."""
    if request.method == 'OPTIONS':
        return '', 200
    uid, error_response = require_bearer_uid()
    if error_response:
        return error_response
    # Guessing codes: a handful of tries, then wait.
    if rate_limited(f"coupon:{uid}", 8, 600):
        return jsonify({"error": "Too many tries. Wait a few minutes and try again.", "code": "rate_limited"}), 429
    code = coupon_normalize((request.json or {}).get('code'))
    if not code:
        return jsonify({"error": "That is not a coupon code."}), 400

    db_client = firestore.client()
    coupon_ref = db_client.collection(COUPONS).document(code)
    used_ref = db_client.collection(COUPON_REDEMPTIONS).document(f"{code}_{uid}")
    user_ref = db_client.collection('users').document(uid)
    try:
        transaction = db_client.transaction()

        @firestore.transactional
        def redeem(transaction):
            coupon = coupon_ref.get(transaction=transaction)
            used = used_ref.get(transaction=transaction)
            user = user_ref.get(transaction=transaction)
            if not coupon.exists:
                raise ValueError("That coupon code does not exist.")
            c = coupon.to_dict() or {}
            if not c.get('active', True):
                raise ValueError("That coupon has been switched off.")
            ends = c.get('expiresAt')
            if ends is not None and ludo_secs(ends) is not None and ludo_secs(ends) < time.time():
                raise ValueError("That coupon has expired.")
            max_uses = int(c.get('maxUses') or 0)
            uses = int(c.get('uses') or 0)
            if max_uses and uses >= max_uses:
                raise ValueError("That coupon has been used up.")
            if used.exists:
                raise ValueError("You have already used this coupon.")
            if not user.exists:
                raise ValueError("Your account is not set up yet.")
            coins = int(c.get('coins') or 0)
            balance = get_coin_balance(user)
            transaction.update(user_ref, {"coins": balance + coins})
            transaction.update(coupon_ref, {"uses": uses + 1})
            transaction.set(used_ref, {"code": code, "uid": uid, "coins": coins, "at": datetime.now(timezone.utc)})
            return coins, balance + coins

        coins, new_balance = redeem(transaction)
        return jsonify({"ok": True, "coins": coins, "newBalance": new_balance}), 200
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        print(f"[COUPON] Redeem error: {e}")
        return jsonify({"error": "Could not use that coupon."}), 500


@app.route('/api/v1/admin/coupons', methods=['POST', 'OPTIONS'])
def admin_coupons():
    """Admin: list, create or switch off coupon codes.

    create: code (optional; made up when blank), coins (100), maxUses (0 =
    unlimited), days (0 = no end date). disable/enable: code.
    """
    if request.method == 'OPTIONS':
        return '', 200
    admin_uid, error_response = require_admin_uid()
    if error_response:
        return error_response
    data = request.json or {}
    action = str(data.get('action') or 'list')
    db_client = firestore.client()

    if action == 'create':
        code = coupon_normalize(data.get('code')) if data.get('code') else None
        if data.get('code') and not code:
            return jsonify({"error": "A code is 4 to 20 letters and numbers."}), 400
        if not code:
            code = ''.join(secrets.choice(COUPON_ALPHABET) for _ in range(8))
        try:
            coins = int(float(data.get('coins') if data.get('coins') not in (None, '') else COUPON_DEFAULT_COINS))
            max_uses = int(float(data.get('maxUses') or 0))
            days = float(data.get('days') or 0)
        except (TypeError, ValueError):
            return jsonify({"error": "Coins, uses and days must be numbers."}), 400
        if coins < 1 or coins > COUPON_MAX_COINS:
            return jsonify({"error": f"Coins must be between 1 and {COUPON_MAX_COINS}."}), 400
        if max_uses < 0 or days < 0:
            return jsonify({"error": "Uses and days cannot be negative."}), 400
        ref = db_client.collection(COUPONS).document(code)
        if ref.get().exists:
            return jsonify({"error": "That code already exists."}), 400
        now = datetime.now(timezone.utc)
        ref.set({
            "code": code, "coins": coins, "maxUses": max_uses, "uses": 0, "active": True,
            "expiresAt": now + timedelta(days=days) if days else None,
            "createdBy": admin_uid, "createdAt": now,
        })
        return jsonify({"ok": True, "code": code}), 200

    if action in ('disable', 'enable'):
        code = coupon_normalize(data.get('code'))
        ref = db_client.collection(COUPONS).document(code or '-')
        if not code or not ref.get().exists:
            return jsonify({"error": "No such coupon."}), 404
        ref.update({"active": action == 'enable'})
        return jsonify({"ok": True}), 200

    if action != 'list':
        return jsonify({"error": "action must be list, create, disable or enable"}), 400
    coupons = []
    for snap in db_client.collection(COUPONS).stream():
        c = snap.to_dict() or {}
        coupons.append({
            "code": snap.id, "coins": c.get('coins'), "maxUses": c.get('maxUses') or 0,
            "uses": c.get('uses') or 0, "active": c.get('active', True),
            "expiresAt": serialize_doc({"t": c.get('expiresAt')}).get('t'),
            "createdAt": serialize_doc({"t": c.get('createdAt')}).get('t'),
            "_sort": ludo_secs(c.get('createdAt')) or 0,
        })
    coupons.sort(key=lambda c: -c.pop('_sort'))
    return jsonify({"ok": True, "coupons": coupons[:100]}), 200


# The app opens this in a WebView rather than bundling a payments SDK, so the
# checkout runs on Razorpay's own script and no card details pass through our
# code. The result is handed back to the app over postMessage, and is only
# ever a set of ids — the balance changes when /coins/purchase verifies them.
RAZORPAY_CHECKOUT_PAGE = """<!doctype html>
<html>
<head><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin:0;background:#2E0138">
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<script>
  var post = function (payload) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    }
  };
  var rzp = new Razorpay({
    key: __KEY_ID__,
    order_id: __ORDER_ID__,
    amount: __AMOUNT_PAISE__,
    currency: 'INR',
    name: 'GenGal',
    description: __DESCRIPTION__,
    theme: { color: '#2E0138' },
    handler: function (res) {
      post({
        type: 'success',
        razorpay_order_id: res.razorpay_order_id,
        razorpay_payment_id: res.razorpay_payment_id,
        razorpay_signature: res.razorpay_signature
      });
    },
    modal: { ondismiss: function () { post({ type: 'dismissed' }); } }
  });
  rzp.on('payment.failed', function (res) {
    post({ type: 'failed', message: (res.error && res.error.description) || 'Payment failed' });
  });
  rzp.open();
</script>
</body>
</html>"""


@app.route('/pay/razorpay/<order_id>', methods=['GET'])
def razorpay_checkout_page(order_id):
    """Serves the checkout for one open order.

    Nothing about the buyer is rendered here — the page carries only the order
    id, the amount and the public key, so loading it without having opened the
    order reveals nothing and still requires paying.
    """
    if not payments_ready():
        return "Payments are not available.", 501

    snap = firestore.client().collection(COIN_ORDERS).document(order_id).get()
    if not snap.exists:
        return "Unknown order.", 404
    order = snap.to_dict() or {}
    if order.get("status") != "created":
        return "This order is no longer open.", 409

    coins = int(order.get("coins") or 0)
    page = (
        RAZORPAY_CHECKOUT_PAGE
        .replace("__KEY_ID__", json.dumps(env_value("RAZORPAY_KEY_ID")))
        .replace("__ORDER_ID__", json.dumps(order_id))
        .replace("__AMOUNT_PAISE__", json.dumps(int(order.get("amountPaise") or 0)))
        .replace("__DESCRIPTION__", json.dumps(f"{coins} coins"))
    )
    return page, 200, {"Content-Type": "text/html; charset=utf-8"}

def assert_safe_production_config():
    """Refuse to serve production traffic with a development escape hatch on.

    Each of these is fine locally and catastrophic in production:
      * ALLOW_DEV_OTP_BYPASS marks every SMS sign-in verified without an SMS,
        so anyone could sign in as any phone number.
      * FLASK_DEBUG serves the Werkzeug console, which is remote code execution.

    Leaving one of these set is a config mistake, not a code mistake, so it has
    to fail loudly at boot rather than quietly weaken auth.
    """
    # Warn at every startup (even in development) so an operator who accidentally
    # left a bypass on sees it immediately in the boot log, before any requests arrive.
    for _flag in ("ALLOW_DEV_OTP_BYPASS",):
        if os.environ.get(_flag) == "true":
            print(
                f"[AUTH][WARNING] {_flag} is ENABLED. "
                "This is a development-only escape hatch — NEVER set it in production.",
                flush=True,
            )

    if os.environ.get("APP_ENV", "").lower() not in ("production", "prod"):
        return

    unsafe = [
        name for name in (
            "ALLOW_DEV_OTP_BYPASS",
            "FLASK_DEBUG",
        )
        if os.environ.get(name) == "true"
    ]
    if unsafe:
        raise RuntimeError(
            "Refusing to start in production with development flags enabled: "
            + ", ".join(unsafe)
            + ". Set them to false."
        )


# Runs on import too, so a WSGI server (gunicorn/waitress) gets the same check
# as the dev entrypoint below.
assert_safe_production_config()

if __name__ == '__main__':
    # Debug mode exposes the Werkzeug interactive debugger, so it must be opted
    # into explicitly and never left on for a publicly reachable server.
    debug_enabled = os.environ.get("FLASK_DEBUG") == "true"
    host = os.environ.get("BIND_HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "5000"))
    if os.environ.get("APP_ENV", "").lower() in ("production", "prod"):
        raise RuntimeError(
            "app.run() is the Werkzeug development server and must not serve "
            "production traffic. Run under a WSGI server, e.g. "
            "`waitress-serve --port=%s app:app`." % port
        )
    app.run(host=host, port=port, debug=debug_enabled)
