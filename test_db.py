import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate("backend/serviceAccountKey.json")
firebase_admin.initialize_app(cred)
db = firestore.client()

doc = db.collection('users').document('fast2sms:+919441488911').get()
if doc.exists:
    print(f"User exists. Password: {doc.to_dict().get('password')}")
else:
    print("User does not exist")
