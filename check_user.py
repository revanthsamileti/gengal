import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate('backend/serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

user_ref = db.collection('users').document('fast2sms:+918341469225')
user = user_ref.get()
if user.exists:
    print(user.to_dict())
else:
    print('User not found')
