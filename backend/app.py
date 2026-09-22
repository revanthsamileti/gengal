from flask import Flask, request, jsonify
from flask_cors import CORS
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
import threading
import time
import sys
import traceback
import requests
from datetime import datetime, timedelta, timezone
from google.api_core.exceptions import Aborted as FirestoreAborted
import firebase_admin
from firebase_admin import credentials, auth, firestore
from agora_token_builder import RtcTokenBuilder
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


_LEGAL_PAGES = {"privacy": _legal_page("privacy.html"), "terms": _legal_page("terms.html")}


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
        
    # A token grants publish access to a channel, so the caller must prove who
    # they are and can only ever mint a token for their own uid.
    authed_uid, error_response = require_bearer_uid()
    if error_response:
        return error_response

    try:
        data = request.json or {}
        room_id = data.get('roomId')
        user_uid = authed_uid

        if not room_id:
            return jsonify({"error": "Missing mandatory roomId parameter"}), 400
        if not AGORA_APP_ID or not AGORA_APP_CERTIFICATE:
            return jsonify({"error": "Agora credentials are not configured"}), 503

        # Configuration setups
        # Role 1 is for RTC_ROLE_PUBLISHER (allows talking and listening)
        role = 1 
        expiration_time_in_seconds = 7200 # 2 Hours safe call limit
        current_timestamp = int(time.time())
        privilege_expired_ts = current_timestamp + expiration_time_in_seconds

        # Deterministic integer representation for the Agora channel track.
        numeric_uid = agora_numeric_uid(user_uid)

        # Generate the cryptographic token
        token = RtcTokenBuilder.buildTokenWithUid(
            AGORA_APP_ID, 
            AGORA_APP_CERTIFICATE, 
            room_id, 
            numeric_uid, 
            role, 
            privilege_expired_ts
        )

        return jsonify({
            "token": token,
            "uid": numeric_uid,
            "expiresIn": expiration_time_in_seconds
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
    sms_configured = bool(gateway_number and env_value("SMS_GATEWAY_SIGNING_KEY"))
    health, _ = sms_gateway.status()
    sms_up = sms_configured and health not in ("offline", "misconfigured")
    if sms_configured and not sms_up:
        log_sms("gateway_" + health, phone)
    # WhatsApp lands on Meta's servers, not on the gateway phone, so it keeps
    # sign-in working while that phone is down.
    channels = (["whatsapp"] if whatsapp_configured() else []) + (["sms"] if sms_up else [])
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

    # Users are told to text one SIM's number; an SMS landing on the phone's
    # other SIM must not count, or the advertised number would not be the only
    # way in.
    wanted_sim = env_value("SMS_GATEWAY_SIM").lower()
    sim = str(payload.get("sim") or "").lower()
    if wanted_sim and sim != wanted_sim:
        log_sms(f"wrong_sim:{sim or '-'}")
        return ok

    # A retry resends the identical body, so its hash identifies the delivery.
    if sms_sessions.seen_delivery("fwd:" + hashlib.sha256(raw).hexdigest()):
        log_sms("duplicate")
        return ok

    received_at = (sms_verify.epoch_millis_to_seconds(payload.get("receivedStamp"))
                   or sms_verify.epoch_millis_to_seconds(payload.get("sentStamp")))
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
        pending = {"status": "pending", "expiresIn": value}
        hint = (sms_sessions.info(session_id) or {}).get("hint")
        if hint:
            pending["hint"] = hint
        return jsonify(pending), 200

    phone = value
    uid = f"fast2sms:{phone}"
    channel = (sms_sessions.info(session_id) or {}).get("channel")
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

def get_coin_balance(snapshot):
    if not snapshot.exists:
        raise ValueError("User does not exist")
    data = snapshot.to_dict() or {}
    return float(data.get("coins") or 0)

@app.route('/api/v1/coins/deduct', methods=['POST', 'OPTIONS'])
def deduct_coins():
    if request.method == 'OPTIONS':
        return '', 200
    uid, error_response = require_bearer_uid()
    if error_response:
        return error_response
    data = request.json or {}
    user_id = data.get("userId")
    if user_id != uid:
        return jsonify({"error": "Cannot deduct coins for another user"}), 403
    try:
        amount = parse_positive_number(data.get("amount"), "amount")
        db_client = firestore.client()
        user_ref = db_client.collection('users').document(uid)
        transaction = db_client.transaction()

        @firestore.transactional
        def apply(transaction):
            snap = user_ref.get(transaction=transaction)
            balance = get_coin_balance(snap)
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
    user_id = data.get("userId")
    host_uid = data.get("hostUid")
    if user_id != uid:
        return jsonify({"error": "Cannot deduct coins for another user"}), 403
    if not host_uid:
        return jsonify({"error": "Missing hostUid"}), 400
    try:
        amount = parse_positive_number(data.get("amount"), "amount")
        commission = float(data.get("commissionAmount") or 0)
        if commission < 0 or commission > amount:
            raise ValueError("Invalid commission amount")

        db_client = firestore.client()
        user_ref = db_client.collection('users').document(uid)
        host_ref = db_client.collection('users').document(host_uid)
        transaction = db_client.transaction()

        @firestore.transactional
        def apply(transaction):
            user_snap = user_ref.get(transaction=transaction)
            user_balance = get_coin_balance(user_snap)
            if user_balance < amount:
                raise ValueError("Insufficient Gengal balance")
            user_new = user_balance - amount
            transaction.update(user_ref, {"coins": user_new})

            host_new = None
            if commission > 0 and host_uid != uid:
                host_snap = host_ref.get(transaction=transaction)
                host_balance = get_coin_balance(host_snap)
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
    try:
        amount = parse_positive_number(data.get("amount"), "amount")
        db_client = firestore.client()
        sender_ref = db_client.collection('users').document(sender_id)
        receiver_ref = db_client.collection('users').document(receiver_id)
        transaction = db_client.transaction()

        @firestore.transactional
        def apply(transaction):
            sender_snap = sender_ref.get(transaction=transaction)
            receiver_snap = receiver_ref.get(transaction=transaction)
            sender_balance = get_coin_balance(sender_snap)
            receiver_balance = get_coin_balance(receiver_snap)
            if sender_balance < amount:
                raise ValueError("Insufficient Gengal balance")
            sender_new = sender_balance - amount
            receiver_new = receiver_balance + amount
            transaction.update(sender_ref, {"coins": sender_new})
            transaction.update(receiver_ref, {"coins": receiver_new})
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
            current = snap.to_dict() or {}

            # Elapsed time is measured between server-side timestamps, so a
            # client clock cannot influence the amount.
            now = datetime.now(timezone.utc)

            # An ended call still gets one last tick from each client, and it
            # must charge for the run-up to the hang-up and not one second more.
            # `endedAt` is a serverTimestamp() written by the client SDK, which
            # means the value itself comes from the server -- a client cannot
            # backdate it to shorten what it owes.
            ended = current.get('status') == 'ended'
            ended_at = as_utc(current.get('endedAt'))
            bill_until = min(now, ended_at) if (ended and ended_at) else now

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
        rate_per_min = float(room.get('ratePerMin') or 0)

        # Free room, or the caller is the host being paid rather than charged.
        if rate_per_min <= 0 or uid == host_uid:
            return jsonify({"success": True, "billedAmount": 0, "billedSeconds": 0}), 200
        if room.get('status') == 'closed':
            return jsonify({"success": True, "billedAmount": 0, "billedSeconds": 0}), 200

        member_ref = room_ref.collection('members').document(uid)
        if not member_ref.get().exists:
            return jsonify({"error": "Not a member of this room"}), 403

        payer_ref = db_client.collection('users').document(uid)
        host_ref = db_client.collection('users').document(host_uid)
        transaction = db_client.transaction()

        @firestore.transactional
        def apply(transaction):
            member_snap = member_ref.get(transaction=transaction)
            member = member_snap.to_dict() or {}

            now = datetime.now(timezone.utc)
            last = member.get('lastBilledAt')
            joined = member.get('joinedAt')

            # First tick only starts the clock, so nobody is charged for the
            # time between opening the room list and actually joining.
            if not isinstance(last, datetime):
                transaction.update(member_ref, {"lastBilledAt": now})
                return 0.0, None, False, 0.0

            if last.tzinfo is None:
                last = last.replace(tzinfo=timezone.utc)

            # A crash skips the leave path, so the member document survives with
            # a stale clock. Rejoining refreshes joinedAt — if that is newer than
            # the last billing point, the gap is time spent outside the room and
            # must not be charged.
            if isinstance(joined, datetime):
                joined_at = joined if joined.tzinfo else joined.replace(tzinfo=timezone.utc)
                if joined_at > last:
                    transaction.update(member_ref, {"lastBilledAt": now})
                    return 0.0, None, False, 0.0

            elapsed = (now - last).total_seconds()
            if elapsed <= 0:
                return 0.0, None, False, 0.0
            elapsed = min(elapsed, MAX_BILLABLE_TICK_SECONDS)

            # Firestore requires every read in a transaction to happen before
            # any write, so both balances are fetched up front. Reading the host
            # after debiting the payer threw on exactly the path that matters —
            # the first tick that bills a non-zero amount.
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
        }), 200
    except (TypeError, ValueError) as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        print(f"[ROOMS] Billing error: {e}")
        return jsonify({"error": "Failed to process room billing"}), 500

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
    try:
        seconds_to_add = parse_positive_number(data.get("secondsToAdd"), "secondsToAdd")
        # Cap: one reward increment cannot represent more than a full 2-hour call.
        # A patched client could otherwise submit secondsToAdd=10^9 to farm hearts
        # even after the threshold fix below.
        seconds_to_add = min(seconds_to_add, MAX_REWARDS_SECONDS)
        # Threshold comes from server pricing settings, NOT the client body.
        # A patched client that sends thresholdMinutes=0.001 would otherwise
        # turn a single second of call time into tens of thousands of hearts,
        # each redeemable for real money via heartToInrRate.  The client-supplied
        # field (thresholdMinutes) is intentionally ignored here.
        settings = pricing_settings()
        threshold_minutes = float(settings.get(
            'callDurationForHeart', DEFAULT_SETTINGS['callDurationForHeart']
        ))
        is_receiver = bool(data.get("isReceiver"))
        db_client = firestore.client()
        user_ref = db_client.collection('users').document(uid)
        transaction = db_client.transaction()

        @firestore.transactional
        def apply(transaction):
            snap = user_ref.get(transaction=transaction)
            if not snap.exists:
                raise ValueError("User does not exist")
            user_data = snap.to_dict() or {}
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

        apply(transaction)
        return jsonify({"ok": True}), 200
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
        freshness_ms = 5 * 60 * 1000  # 5 minutes threshold
        for d in query_snap:
            if current_uid and d.id == current_uid:
                continue
            raw_dict = d.to_dict() or {}
            if raw_dict.get('isDeleted') == True or raw_dict.get('deletedAt'):
                continue
            if raw_dict.get('isActiveMode') == False or raw_dict.get('isOnline') == False or raw_dict.get('isSessionActive') == False:
                continue
            u_data = serialize_doc(raw_dict)
            if not u_data.get('nickname') and not u_data.get('username'):
                continue
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
        freshness_ms = 5 * 60 * 1000
        for d in query_snap:
            if current_uid and d.id == current_uid:
                continue
            raw_dict = d.to_dict() or {}
            if raw_dict.get('isDeleted') == True or raw_dict.get('deletedAt'):
                continue
            if raw_dict.get('isActiveMode') == False or raw_dict.get('isOnline') == False or raw_dict.get('isSessionActive') == False:
                continue
            u_data = serialize_doc(raw_dict)
            if not u_data.get('nickname') and not u_data.get('username'):
                continue
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

@app.route('/api/v1/calls/notify', methods=['POST', 'OPTIONS'])
def notify_incoming_call():
    """Delivers the incoming-call push.

    Runs server-side because the receiver's Expo token is private: the caller
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

        private_snap = db_client.collection('user_private').document(receiver_uid).get()
        private_data = (private_snap.to_dict() or {}) if private_snap.exists else {}
        # A blocked caller gets the same answer as an unreachable receiver, so
        # the block is not revealed; the receiver's app declines the offer.
        blocked_uids = private_data.get('blockedUids')
        if isinstance(blocked_uids, list) and uid in blocked_uids:
            return jsonify({"ok": True, "delivered": False}), 200
        token = private_data.get('expoPushToken')
        if not token:
            return jsonify({"ok": True, "delivered": False}), 200

        caller_snap = db_client.collection('users').document(uid).get()
        caller_data = caller_snap.to_dict() or {}
        caller_name = caller_data.get('nickname') or caller_data.get('username') or 'Someone'
        offer = offer_snap.to_dict() or {}

        response = requests.post(
            'https://exp.host/--/api/v2/push/send',
            json={
                "to": token,
                "title": f"Incoming {'Video' if mode == 'video' else 'Voice'} Call",
                "body": f"{caller_name} is calling you...",
                "sound": "default",
                "priority": "high",
                # Must match CALL_CHANNEL_ID in src/services/notificationService.ts.
                # The old 'calls' channel was created with a custom sound name
                # that did not exist in the app, so Android gave it no sound and
                # every call notification arrived silently; channels are
                # immutable, hence the new id rather than a fix in place.
                "channelId": "calls_v2",
                "data": {
                    "roomId": offer.get('roomId'),
                    "mode": mode,
                    "callerUid": uid,
                    "callerName": caller_name,
                    "isIncomingPending": True,
                },
            },
            timeout=10,
        )
        return jsonify({"ok": True, "delivered": response.status_code == 200}), 200
    except Exception as e:
        print(f"[CALLS] Notify error: {e}")
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
    "voiceCallRatePerMin": 15,
    "videoCallRatePerMin": 30,
    "creatorSharePercentage": 70,
    "femaleExpertHeartsThreshold": 50,
    "maleExpertRespectThreshold": 30,
    "callDurationForHeart": 3,
    "heartToInrRate": 3,
    "minRechargeAmount": 49,
    "inrToCoinRechargeRate": 1.12,
    # Floor for a payout request. Lived as a bare `33` in EarningsScreen, so the
    # only way to change it was to ship a new build — and the server had no
    # opinion at all, which is what let a patched client request any amount.
    "minWithdrawalHearts": 33,
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
}

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
        return jsonify({"ok": True, "settings": serialize_doc(snap.to_dict())}), 200

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


def coins_for_inr(amount_inr, settings):
    """Coin yield for a rupee amount.

    Floors, matching `coinsFor` on the client, so the quoted figure on the
    store screen is the figure actually credited.
    """
    return int(math.floor(float(amount_inr) * float(settings['inrToCoinRechargeRate'])))


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
                'approved': {'paid', 'rejected'},
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

            user_update = {'pendingWithdrawalId': firestore.DELETE_FIELD}
            # Refund only what was actually taken. Requests predating this
            # endpoint were written straight from the client and never debited
            # the balance, so paying them back would mint hearts — and hearts
            # are convertible to rupees, so that is minting money.
            if new_status == 'rejected' and req.get('heartsDeducted'):
                refund = int(req.get('hearts') or 0)
                user_update['hearts'] = int(user_data.get('hearts') or 0) + refund

            transaction.update(request_ref, {
                'status': new_status,
                'resolvedAt': firestore.SERVER_TIMESTAMP,
                'resolvedBy': admin_id,
            })
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

    try:
        amount_inr = parse_positive_number(data.get("amountInr"), "amountInr")
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    minimum = float(settings['minRechargeAmount'])
    if amount_inr < minimum:
        return jsonify({"error": f"The minimum recharge amount is {minimum:g} rupees."}), 400
    if amount_inr > MAX_RECHARGE_INR:
        return jsonify({"error": f"The maximum recharge amount is {MAX_RECHARGE_INR} rupees."}), 400

    coins = coins_for_inr(amount_inr, settings)
    if coins <= 0:
        return jsonify({"error": "That amount does not buy any coins."}), 400

    amount_paise = int(round(amount_inr * 100))
    package_id = str(data.get("packageId") or 'custom')[:40]

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
            new_balance = balance + coins
            transaction.update(user_ref, {"coins": new_balance})
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
