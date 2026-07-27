import firebase_admin
from firebase_admin import credentials, firestore
import os

try:
    cred = credentials.Certificate(os.path.join(os.path.dirname(__file__), 'backend', 'serviceAccountKey.json'))
    firebase_admin.initialize_app(cred)
except Exception as e:
    pass

db = firestore.client()
calls = db.collection('incoming_calls').get()
print(f"Total calls: {len(calls)}")
for doc in calls:
    print(f'{doc.id}: {doc.to_dict()}')