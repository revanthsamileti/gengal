import firebase_admin
from firebase_admin import credentials, firestore

print("Initializing Firebase Admin SDK...")
cred = credentials.Certificate('serviceAccountKey.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

fake_uids = [
    "fast2sms:+19441488911", 
    "fast2sms:+918641469225", 
    "7iRdx08nnCVqxM1lTBhH5o9abU32"
]

print("Wiping fake users...")
deleted_users = 0
for uid in fake_uids:
    doc_ref = db.collection('users').document(uid)
    if doc_ref.get().exists:
        doc_ref.delete()
        deleted_users += 1
print(f"Deleted {deleted_users} mock users.")

def clean_collection(coll_name):
    docs = list(db.collection(coll_name).stream())
    for d in docs:
        db.collection(coll_name).document(d.id).delete()
    print(f"Cleared {len(docs)} records from collection '{coll_name}'.")

clean_collection("expert_rooms")
clean_collection("chill_rooms")
clean_collection("ludo_rooms")
clean_collection("live_rooms")

print("Cleanup complete!")
