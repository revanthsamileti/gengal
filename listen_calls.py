import firebase_admin
from firebase_admin import credentials, firestore
import os
import time

try:
    cred = credentials.Certificate(os.path.join(os.path.dirname(__file__), 'backend', 'serviceAccountKey.json'))
    firebase_admin.initialize_app(cred)
except Exception as e:
    pass

db = firestore.client()

def on_snapshot(col_snapshot, changes, read_time):
    print(f'Snapshot received at {read_time}', flush=True)
    for change in changes:
        if change.type.name == 'ADDED':
            print(f'New call: {change.document.id} - {change.document.to_dict()}', flush=True)
        elif change.type.name == 'MODIFIED':
            print(f'Modified call: {change.document.id} - {change.document.to_dict()}', flush=True)
        elif change.type.name == 'REMOVED':
            print(f'Removed call: {change.document.id}', flush=True)

col_query = db.collection('incoming_calls')
query_watch = col_query.on_snapshot(on_snapshot)

while True:
    time.sleep(1)
