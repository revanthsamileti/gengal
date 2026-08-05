import os

import firebase_admin
from firebase_admin import credentials, firestore


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEY_PATH = os.path.join(ROOT, "backend", "serviceAccountKey.json")


if not firebase_admin._apps:
    firebase_admin.initialize_app(credentials.Certificate(KEY_PATH))


db = firestore.client()

profiles = {
    "fast2sms:+919441488911": {
        "phoneNumber": "+919441488911",
        "nickname": "Alpha",
        "username": "alpha_usb_call",
        "age": 25,
        "gender": "Feminine",
        "country": "India",
        "state": "Telangana",
        "city": "Hyderabad",
        "language": "Telugu",
        "bio": "USB call test profile",
        "coins": 500,
        "isActiveMode": True,
        "isOnline": True,
        "isSessionActive": True,
        "lastActive": firestore.SERVER_TIMESTAMP,
    },
    "fast2sms:+918641469225": {
        "phoneNumber": "+918641469225",
        "nickname": "Beta",
        "username": "beta_usb_call",
        "age": 26,
        "gender": "Masculine",
        "country": "India",
        "state": "Telangana",
        "city": "Hyderabad",
        "language": "Telugu",
        "bio": "USB call test profile",
        "coins": 500,
        "isActiveMode": True,
        "isOnline": True,
        "isSessionActive": True,
        "lastActive": firestore.SERVER_TIMESTAMP,
    },
}


for uid, profile in profiles.items():
    db.collection("users").document(uid).set({"uid": uid, **profile}, merge=True)
    print(f"seeded {uid} -> {profile['nickname']}")
