import requests

url = "http://127.0.0.1:5000/api/v1/auth/login-password"
payload = {
    "phone": "+919441488911",
    "password": "@Revanth7672"
}
response = requests.post(url, json=payload)
print(response.status_code)
print(response.json())
