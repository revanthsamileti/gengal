import sys
import os
from google.cloud import firestore_admin_v1
from google.oauth2 import service_account

def main():
    # Path to key
    key_path = "serviceAccountKey.json"
    if not os.path.exists(key_path):
        print(f"Error: {key_path} not found.")
        return

    # Load credentials
    creds = service_account.Credentials.from_service_account_file(key_path)

    # Create admin client
    client = firestore_admin_v1.FirestoreAdminClient(credentials=creds)

    def create_index(collection_group_id, fields_config):
        index = firestore_admin_v1.Index()
        index.query_scope = firestore_admin_v1.Index.QueryScope.COLLECTION
        
        fields = []
        for path, order in fields_config:
            field = firestore_admin_v1.Index.IndexField()
            field.field_path = path
            if order == 'ASCENDING':
                field.order = firestore_admin_v1.Index.IndexField.Order.ASCENDING
            else:
                field.order = firestore_admin_v1.Index.IndexField.Order.DESCENDING
            fields.append(field)
        
        index.fields = fields
        parent = f"projects/gengal-38003/databases/(default)/collectionGroups/{collection_group_id}"
        
        try:
            print(f"Creating composite index for '{collection_group_id}' (status ASC, activeMemberCount DESC)...")
            operation = client.create_index(parent=parent, index=index)
            print(f"Operation started for {collection_group_id}. Creation is running in the background.")
        except Exception as e:
            if "already exists" in str(e).lower():
                print(f"Index for '{collection_group_id}' already exists or is building.")
            else:
                print(f"Failed to create index for '{collection_group_id}': {e}")

    create_index("chill_rooms", [("status", "ASCENDING"), ("activeMemberCount", "DESCENDING")])
    create_index("ludo_rooms", [("status", "ASCENDING"), ("activeMemberCount", "DESCENDING")])

if __name__ == "__main__":
    main()
