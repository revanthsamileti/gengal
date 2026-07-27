import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate('serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

u1 = db.collection('users').document('fast2sms:+919441488911').get()
u2 = db.collection('users').document('fast2sms:+918641469225').get()
print('9441488911 pass:', u1.to_dict().get('password'))
print('8641469225 pass:', u2.to_dict().get('password'))
