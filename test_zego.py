import json
import time
import hmac
import hashlib
import base64

def make_zego_token(app_id, server_secret, user_id, expiry_seconds=7200):
    create_time = int(time.time())
    expire_time = create_time + expiry_seconds
    
    payload = {
        'app_id': app_id,
        'user_id': str(user_id),
        'provided_timestamp': create_time,
        'expire_time': expire_time,
        'nonce': int(time.time() * 1000)
    }
    
    json_payload = json.dumps(payload)
    signature = hmac.new(
        server_secret.encode('utf-8'), 
        json_payload.encode('utf-8'), 
        hashlib.sha256
    ).hexdigest()
    
    token_bytes = json.dumps({
        'ver': 1,
        'body': json_payload,
        'hash': signature
    })
    return base64.b64encode(token_bytes.encode('utf-8')).decode('utf-8')

try:
    print(make_zego_token(2010051429, '591334531bcc2f495748d3d17aa9fc70', 'test_uid'))
except Exception as e:
    print('ERROR:', str(e))
