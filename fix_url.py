import sys

with open('src/screens/CallScreen.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

code = code.replace(
    "'https://batboy-glider-sanitary.ngrok-free.dev/api/v1/agora/generate-token'",
    "require('../services/authService').BACKEND_URL + '/api/v1/agora/generate-token'"
)

code = code.replace(
    "'https://batboy-glider-sanitary.ngrok-free.dev/api/v1/zego/generate-token'",
    "require('../services/authService').BACKEND_URL + '/api/v1/zego/generate-token'"
)

with open('src/screens/CallScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

print("URL fixed.")
