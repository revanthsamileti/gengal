import firebase_admin
from firebase_admin import credentials, firestore
import os

try:
    cred = credentials.Certificate(os.path.join(os.path.dirname(__file__), 'backend', 'serviceAccountKey.json'))
    firebase_admin.initialize_app(cred)
except Exception as e:
    pass

db = firestore.client()
rooms = db.collection('public_rooms').get()
for doc in rooms:
    data = doc.to_dict()
    if data.get('status') == 'busy':
        print(f"Fixing room {doc.id}...")
        db.collection('public_rooms').document(doc.id).update({'status': 'available'})
print("Done")
