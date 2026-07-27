import firebase_admin
from firebase_admin import credentials, firestore
import os
cred = credentials.Certificate(os.path.join('backend', 'serviceAccountKey.json'))
firebase_admin.initialize_app(cred)
db = firestore.client()
for doc in db.collection('incoming_calls').get():
    print(f'{doc.id}: {doc.to_dict()}')
