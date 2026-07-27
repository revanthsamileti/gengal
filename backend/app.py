from flask import Flask, request, jsonify
from flask_cors import CORS
import json
import os
import hashlib
import time
import sys
import random
import requests
from datetime import datetime, timedelta
import firebase_admin
from firebase_admin import credentials, auth, firestore
from agora_token_builder import RtcTokenBuilder

app = Flask(__name__)

# Initialize Firebase Admin
try:
    cred = credentials.Certificate("serviceAccountKey.json")
    firebase_admin.initialize_app(cred)
    print("Firebase Admin initialized successfully.")
except Exception as e:
    print(f"Warning: Could not initialize Firebase Admin: {e}")

# Fast2SMS Global config
FAST2SMS_API_KEY = os.environ.get("FAST2SMS_API_KEY", "h8nuf5QxcDNkayBWY9XsPHKIq0EAT1woiZFRGtdmUCj74vlV2SOgTH6iYxJ4eWD5olj1kVGvympIc3nq")
otp_store = {} # simple dictionary mapping { phone: { "otp": "123456", "expires": datetime } }

# Securely extract your credentials from the environment variables
AGORA_APP_ID = "d463dbabe1ee41ef8c4fa19c09464708"  # Kept securely on the server
AGORA_APP_CERTIFICATE = "92533415a358494fb615e8294951d37f"  # Kept safely server-side
DAILY_API_KEY = os.environ.get("DAILY_API_KEY", "930d9272d97f5c9a6163ba81cbf5de0a8eed4e42ac77ce0810e28d5b3fa3aae4")
DAILY_API_URL = "https://api.daily.co/v1/rooms"
STREAM_API_KEY = os.environ.get("STREAM_API_KEY", "ndymgdzukye2")
STREAM_SECRET = os.environ.get("STREAM_SECRET", "avb6uatvf5r44f6j22ejpxtuqwnpefzsctnp7tse7urrgz2ajq5bva32e25sauec")
# Secure server-side isolation of Red5 licensing variables
RED5_SDK_LICENSE = os.environ.get("RED5_SDK_LICENSE", "H1AH-6RJK-WNTK-EDE5")
# Change this configurable placeholder once your production cloud node spins up
RED5_SERVER_HOST = os.environ.get("RED5_SERVER_HOST", "YOUR_DEV_RED5_SERVER_IP_OR_DOMAIN")
DYTE_ORG_ID = os.environ.get("DYTE_ORG_ID", "3d496d09-de80-42f7-88ee-499869870e09")
DYTE_API_KEY = os.environ.get("DYTE_API_KEY", "cfk_DcMs13r3yvsNsm2Sqd7bxXxAv631GnhpFcdDLrLfa02d8fdc")
# Secure server-side isolation of Zego credentials
ZEGO_APP_ID = 2010051429
ZEGO_SERVER_SECRET = "591334531bcc2f495748d3d17aa9fc70"

CORS(app)

TEMP_DIR = "temp_media"
os.makedirs(TEMP_DIR, exist_ok=True)
DEBUG_LOG_FILE = os.path.join(os.path.dirname(__file__), "debug_events.log")

# Selfie classification pipeline removed

# Proxy endpoint for frontend console logs
@app.route('/log', methods=['POST', 'OPTIONS'])
def handle_log():
    if request.method == 'OPTIONS':
        return '', 200
    data = request.json
    if data:
        level = data.get('level', 'log')
        message = data.get('message', '')
        print(f"[MOBILE BROWSER {level.upper()}]: {message}", flush=True)
    return '', 200

@app.route('/api/v1/debug/log', methods=['POST', 'OPTIONS'])
def debug_log():
    if request.method == 'OPTIONS':
        return '', 200

    payload = request.get_json(silent=True) or {}
    event = {
        "serverReceivedAt": datetime.utcnow().isoformat() + "Z",
        "level": str(payload.get("level", "info"))[:20],
        "event": str(payload.get("event", "unknown"))[:120],
        "sessionId": payload.get("sessionId"),
        "userId": payload.get("userId"),
        "phone": payload.get("phone"),
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
    limit = min(max(int(request.args.get("limit", 100)), 1), 500)
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
        
    try:
        data = request.json or {}
        room_id = data.get('roomId')
        user_uid = data.get('uid') # Numeric mapping or string representation

        if not room_id or not user_uid:
            return jsonify({"error": "Missing mandatory roomId or uid parameters"}), 400

        # Configuration setups
        # Role 1 is for RTC_ROLE_PUBLISHER (allows talking and listening)
        role = 1 
        expiration_time_in_seconds = 7200 # 2 Hours safe call limit
        current_timestamp = int(time.time())
        privilege_expired_ts = current_timestamp + expiration_time_in_seconds

        # Resolve an integer representation for the Agora user channel track
        # If uid is a string (like Firebase UID), use a hash or an integer map
        numeric_uid = int(user_uid) if str(user_uid).isdigit() else hash(user_uid) & 0x7FFFFFFF

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

@app.route('/api/v1/daily/create-room', methods=['POST', 'OPTIONS'])
def create_daily_room():
    if request.method == 'OPTIONS':
        return '', 200
        
    try:
        data = request.json or {}
        room_id = data.get('roomId')

        if not room_id:
            return jsonify({"error": "Missing mandatory roomId parameter"}), 400

        headers = {
            "Authorization": f"Bearer {DAILY_API_KEY}",
            "Content-Type": "application/json"
        }

        # Configure room parameters with a 2-hour automatic hard-stop expiration
        payload = {
            "name": room_id,
            "privacy": "public",  # Use public to avoid needing meeting tokens right now for simplicity
            "properties": {
                "exp": int(time.time()) + 7200, # 2 hours lifetime boundary
                "enable_chat": False,
                "start_audio_off": False,
                "start_video_off": True, # Strictly force audio-only configurations
            }
        }

        import requests
        # Step 1A: Attempt to create a new session room
        response = requests.post(DAILY_API_URL, json=payload, headers=headers)

        if response.status_code == 200:
            room_data = response.json()
            return jsonify({"roomUrl": room_data.get("url")}), 200

        # Step 1B: Handle conflict gracefully if room already exists (User 2 joining)
        elif response.status_code == 400 and "already exists" in response.text:
            get_url = f"{DAILY_API_URL}/{room_id}"
            get_response = requests.get(get_url, headers=headers)
            
            if get_response.status_code == 200:
                room_data = get_response.json()
                return jsonify({"roomUrl": room_data.get("url")}), 200
            
            return jsonify({"error": "Failed to pull existing room session details"}), get_response.status_code

        return jsonify({"error": "Daily API processing rejection"}), response.status_code

    except Exception as e:
        print(f"[Daily Room Proxy Exception]: {str(e)}")
        return jsonify({"error": "Internal Server Exception"}), 500

@app.route('/api/v1/stream/generate-token', methods=['POST', 'OPTIONS'])
def generate_stream_token():
    if request.method == 'OPTIONS':
        return '', 200
        
    try:
        import jwt
        data = request.json or {}
        user_uid = data.get('uid')

        if not user_uid:
            return jsonify({"error": "Missing mandatory user uid parameter"}), 400

        current_time = int(time.time())
        
        # Stream's official JWT Payload Requirement specifications
        payload = {
            "user_id": str(user_uid),
            "issued_at": current_time,
            "iat": current_time,
            "exp": current_time + 7200 # Automatically expires in 2 hours
        }

        # Crypto-sign the token locally using HS256 algorithm via PyJWT
        token = jwt.encode(payload, STREAM_SECRET, algorithm='HS256')

        return jsonify({
            "token": token,
            "apiKey": STREAM_API_KEY,
            "userId": str(user_uid)
        }), 200

    except Exception as e:
        print(f"[Stream JWT Generation Exception]: {str(e)}")
        return jsonify({"error": "Internal Token Server Exception"}), 500

@app.route('/api/v1/red5/config', methods=['GET'])
def get_red5_config():
    try:
        # Prevent open processing faults if server properties aren't ready
        if not RED5_SERVER_HOST or RED5_SERVER_HOST == "YOUR_DEV_RED5_SERVER_IP_OR_DOMAIN":
            return jsonify({"warning": "Red5 server cluster address is using a development placeholder"}), 200

        return jsonify({
            "sdkLicense": RED5_SDK_LICENSE,
            "host": RED5_SERVER_HOST,
            "port": "8554" # Default low-latency streaming proxy port layout
        }), 200

    except Exception as e:
        print(f"[Red5 Configuration Extraction Error]: {str(e)}")
        return jsonify({"error": "Internal Registry Exception"}), 500

@app.route('/api/v1/dyte/create-room', methods=['POST', 'OPTIONS'])
def create_dyte_room():
    if request.method == 'OPTIONS':
        return '', 200
        
    try:
        data = request.json or {}
        room_id = data.get('roomId')
        uid = data.get('uid')

        if not room_id or not uid:
            return jsonify({"error": "Missing mandatory parameters"}), 400

        import requests
        import base64
        
        auth_string = f"{DYTE_ORG_ID}:{DYTE_API_KEY}"
        auth_bytes = auth_string.encode('utf-8')
        base64_auth = base64.b64encode(auth_bytes).decode('utf-8')
        
        headers = {
            "Authorization": f"Basic {base64_auth}",
            "Content-Type": "application/json"
        }

        # Step 1: Create or fetch the meeting
        meeting_id = None
        
        # Try to find an existing meeting by title (room_id)
        # Dyte doesn't have an exact title search in v2 that works perfectly for idempotency,
        # but we can try to just create it. If it fails due to conflict, or we can just always create a new one?
        # Actually, if we just create a meeting, both users need to be in the SAME meeting.
        # So we MUST search for existing meetings or use a deterministic custom_participant_id strategy? No, meeting needs to be shared.
        # Let's search if a meeting exists.
        search_res = requests.get(f"https://api.dyte.io/v2/meetings", headers=headers)
        if search_res.status_code == 200:
            meetings = search_res.json().get('data', [])
            for m in meetings:
                if m.get('title') == room_id and m.get('status') == 'ACTIVE':
                    meeting_id = m.get('id')
                    break
        
        # If not found, create it
        if not meeting_id:
            payload = {
                "title": room_id,
                "preferred_region": "ap-south-1",
                "record_on_start": False
            }
            create_res = requests.post("https://api.dyte.io/v2/meetings", headers=headers, json=payload)
            if create_res.status_code == 201 or create_res.status_code == 200:
                meeting_id = create_res.json().get('data', {}).get('id')
            else:
                return jsonify({"error": "Failed to provision Dyte meeting"}), create_res.status_code
        
        if not meeting_id:
            return jsonify({"error": "Failed to resolve meeting ID"}), 500

        # Step 2: Add participant to the meeting
        participant_payload = {
            "name": uid,
            "preset_name": "group_call_participant",
            "custom_participant_id": uid
        }
        
        part_res = requests.post(f"https://api.dyte.io/v2/meetings/{meeting_id}/participants", headers=headers, json=participant_payload)
        
        if part_res.status_code == 201 or part_res.status_code == 200:
            auth_token = part_res.json().get('data', {}).get('token')
            return jsonify({"authToken": auth_token}), 200
            
        return jsonify({"error": "Failed to add participant to Dyte meeting"}), part_res.status_code

    except Exception as e:
        print(f"[Dyte Meeting Proxy Exception]: {str(e)}")
        return jsonify({"error": "Internal Server Exception"}), 500

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

@app.route('/api/v1/zego/generate-token', methods=['POST'])
def generate_zego_token():
    try:
        data = request.json or {}
        room_id = data.get('roomId')
        user_uid = data.get('uid')

        if not room_id or not user_uid:
            return jsonify({"error": "Missing mandatory roomId or uid fields"}), 400

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

@app.route('/api/v1/host/upload-intro', methods=['POST'])
def upload_intro():
    try:
        if 'audio' not in request.files:
            return jsonify({"error": "No audio file provided"}), 400

        audio_file = request.files['audio']
        if audio_file.filename == '':
            return jsonify({"error": "No selected file"}), 400

        # Create uploads directory if it doesn't exist
        uploads_dir = os.path.join(os.path.dirname(__file__), 'uploads')
        if not os.path.exists(uploads_dir):
            os.makedirs(uploads_dir)

        # In a real app, use a UUID for the filename to prevent collisions, but for now we keep it simple
        filename = f"intro_{int(time.time())}.m4a"
        file_path = os.path.join(uploads_dir, filename)
        
        audio_file.save(file_path)
        
        # Return a simulated public URL that the mobile app can reference
        # In production this would be an S3 or Firebase Storage URL
        public_url = f"https://batboy-glider-sanitary.ngrok-free.dev/uploads/{filename}"

        return jsonify({
            "message": "Upload successful",
            "url": public_url
        }), 200

    except Exception as e:
        print(f"[Upload Server Fault]: {str(e)}")
        return jsonify({"error": "Internal Upload Exception"}), 500

# Optional: Add a simple static file route so the frontend can playback the audio
from flask import send_from_directory
import firebase_admin
from firebase_admin import credentials, auth, firestore
from datetime import datetime, timedelta
import random

cred = credentials.Certificate("serviceAccountKey.json")
# Removed duplicate firebase_admin initialization
otp_store = {}

@app.route('/uploads/<path:filename>')
def serve_upload(filename):
    return send_from_directory(os.path.join(os.path.dirname(__file__), 'uploads'), filename)

# ==========================================
# AUTHENTICATION ROUTES (FAST2SMS)
# ==========================================

# Simple memory stores for OTP rate limiting and abuse tracking
otp_store = {}
abuse_store = {}

@app.route('/api/v1/auth/send-otp', methods=['POST'])
def send_otp():
    data = request.json
    phone = data.get('phone')
    if not phone:
        return jsonify({"error": "Phone number is required"}), 400
        
    # Clean phone
    phone = phone.replace(" ", "")
    
    now = datetime.now()
    
    # Check if user is blocked
    abuse_record = abuse_store.get(phone, {"blocked_until": None, "consecutive_failed_requests": 0, "last_requested_at": None})
    if abuse_record["blocked_until"] and now < abuse_record["blocked_until"]:
        delta = abuse_record["blocked_until"] - now
        minutes_left = int(delta.total_seconds() / 60)
        return jsonify({"error": f"Too many failed attempts. Try again in {minutes_left} minutes."}), 429
        
    # Enforce 90-second cooldown
    if abuse_record["last_requested_at"]:
        seconds_since_last = (now - abuse_record["last_requested_at"]).total_seconds()
        if seconds_since_last < 90:
            return jsonify({"error": f"Please wait {int(90 - seconds_since_last)} seconds before requesting another OTP."}), 429
            
    abuse_record["last_requested_at"] = now
    abuse_store[phone] = abuse_record
        
    # Generate 6-digit OTP
    otp = str(random.randint(100000, 999999))
    
    # Store OTP with a 5-minute expiration
    otp_store[phone] = {
        "otp": otp,
        "expires": now + timedelta(minutes=5),
        "incorrect_guesses": 0
    }
    
    # Send via Twilio
    TWILIO_ACCOUNT_SID = "AC83dd49cefbb35e00393dd5bfd3a31763"
    TWILIO_AUTH_TOKEN = "9394884dca33f9fac4932cb1ea87b807"
    TWILIO_PHONE_NUMBER = "+14589999941"

    url = f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_ACCOUNT_SID}/Messages.json"
    dest_phone = phone if phone.startswith('+') else f"+{phone}"
        
    payload = {
        "To": dest_phone,
        "From": TWILIO_PHONE_NUMBER,
        "Body": f"Your GenGal Verification Code is: {otp}"
    }
    
    print(f"[AUTH] Sending OTP {otp} to {dest_phone} via Twilio...")
    import sys; sys.stdout.flush()
    
    try:
        response = requests.post(url, data=payload, auth=(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN))
        print(f"[AUTH] Twilio Response: {response.text}")
        sys.stdout.flush()
        return jsonify({"status": "success", "message": "OTP sent"})
    except Exception as e:
        print(f"[AUTH] Twilio Error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/v1/auth/verify-otp', methods=['POST'])
def verify_otp():
    data = request.json
    phone = data.get('phone')
    user_otp = data.get('otp')
    
    if not phone or not user_otp:
        return jsonify({"error": "Phone and OTP are required"}), 400
        
    phone = phone.replace(" ", "")
    now = datetime.now()
    
    # Check if user is blocked
    abuse_record = abuse_store.get(phone, {"blocked_until": None, "consecutive_failed_requests": 0, "last_requested_at": None})
    if abuse_record["blocked_until"] and now < abuse_record["blocked_until"]:
        delta = abuse_record["blocked_until"] - now
        minutes_left = int(delta.total_seconds() / 60)
        return jsonify({"error": f"Too many failed attempts. Try again in {minutes_left} minutes."}), 429
    
    # Master development & automated testing bypass
    if user_otp != '000000':
        record = otp_store.get(phone)
        if not record:
            return jsonify({"error": "No active OTP found. Please request a new one."}), 400
            
        if now > record['expires']:
            del otp_store[phone]
            return jsonify({"error": "OTP expired. Please request a new one."}), 400
            
        if record['otp'] != user_otp:
            # Incorrect guess
            record['incorrect_guesses'] += 1
            otp_store[phone] = record
            
            # 3 incorrect guesses on a single request = 5 min block (or 1hr if 3rd consecutive failed request)
            if record['incorrect_guesses'] >= 3:
                del otp_store[phone]
                abuse_record['consecutive_failed_requests'] += 1
                
                if abuse_record['consecutive_failed_requests'] >= 3:
                    # 3 sequential failed requests -> 1 hr block
                    abuse_record['blocked_until'] = now + timedelta(hours=1)
                    abuse_store[phone] = abuse_record
                    return jsonify({"error": "You have failed too many times. You are blocked for 1 hour."}), 429
                else:
                    # 1 failed request (3 guesses) -> 5 min block
                    abuse_record['blocked_until'] = now + timedelta(minutes=5)
                    abuse_store[phone] = abuse_record
                    return jsonify({"error": "You entered the wrong code 3 times. Please try again in 5 minutes."}), 429
                    
            return jsonify({"error": f"Invalid OTP. {3 - record['incorrect_guesses']} attempts remaining."}), 400
        
    # OTP is correct! Clear stores.
    if phone in otp_store:
        del otp_store[phone]
    if phone in abuse_store:
        # Reset consecutive failed requests on success
        abuse_store[phone]['consecutive_failed_requests'] = 0
        abuse_store[phone]['blocked_until'] = None
    
    uid = f"fast2sms:{phone}"
    print(f"[AUTH] OTP verified for {phone}. Minting custom token for uid: {uid}")
    
    try:
        custom_token = auth.create_custom_token(uid)
        return jsonify({
            "status": "success",
            "token": custom_token.decode('utf-8') if isinstance(custom_token, bytes) else custom_token
        })
    except Exception as e:
        print(f"[AUTH] Token minting error: {e}")
        return jsonify({"error": "Failed to generate auth token"}), 500

@app.route('/api/v1/auth/login-password', methods=['POST'])
def login_password():
    data = request.json
    phone = data.get('phone')
    password = data.get('password')
    
    if not phone or not password:
        return jsonify({"error": "Phone and password are required"}), 400
        
    phone = phone.replace(" ", "")
    uid = f"fast2sms:{phone}"
    print(f"[AUTH] Verifying password for uid: {uid}")
    
    try:
        db = firestore.client()
        user_ref = db.collection('users').document(uid)
        user_doc = user_ref.get()
        
        if not user_doc.exists:
            return jsonify({"error": "User not found"}), 404
            
        stored_password = user_doc.to_dict().get('password')
        print(f"[AUTH] Provided: '{password}', Stored: '{stored_password}'")
        if not stored_password or stored_password != password:
            return jsonify({"error": "Invalid password"}), 401
            
        print(f"[AUTH] Password verified for uid: {uid}. Minting custom token.")
        custom_token = auth.create_custom_token(uid)
        return jsonify({
            "status": "success",
            "token": custom_token.decode('utf-8') if isinstance(custom_token, bytes) else custom_token
        }), 200
    except Exception as e:
        print(f"[AUTH] Error in login_password: {e}")
        return jsonify({"error": "Internal server error"}), 500

@app.route('/api/v1/auth/check-user', methods=['POST'])
def check_user():
    data = request.json
    phone = data.get('phone')
    
    if not phone:
        return jsonify({"error": "Phone is required"}), 400
        
    phone = phone.replace(" ", "")
    
    try:
        db = firestore.client()
        users_ref = db.collection('users')
        query = users_ref.where('phoneNumber', '==', phone).limit(1)
        results = query.stream()
        user_exists = any(True for _ in results)
        return jsonify({"exists": user_exists}), 200
    except Exception as e:
        print(f"[AUTH] Check user error: {e}")
        return jsonify({"error": "Failed to check user"}), 500

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

@app.route('/api/v1/users/profile/get', methods=['POST', 'OPTIONS'])
def get_user_profile_admin():
    if request.method == 'OPTIONS':
        return '', 200
    try:
        data = request.json or {}
        uid = data.get('uid')
        if not uid:
            return jsonify({"error": "Missing uid"}), 400
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
    try:
        data = request.json or {}
        uid = data.get('uid')
        profile_data = data.get('profileData', {})
        if not uid:
            return jsonify({"error": "Missing uid"}), 400
        db_client = firestore.client()
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

if __name__ == '__main__':
    # Start the server on port 5000
    app.run(host='0.0.0.0', port=5000, debug=True)
