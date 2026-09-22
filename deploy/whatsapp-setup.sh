#!/usr/bin/env bash
#
# Configure reverse-OTP sign-in over WhatsApp (Meta WhatsApp Cloud API) and
# print what to enter in the Meta app dashboard.
#
# Run it yourself, in your own SSH session. Secrets are typed hidden and are
# never echoed back:
#     sudo bash /opt/gengal/deploy/whatsapp-setup.sh
#
# Re-running keeps every value you skip (press Enter). The webhook verify token
# is generated once; --rotate issues a new one, which must then be re-entered in
# the Meta dashboard.
# Design: docs/superpowers/specs/2026-09-22-reverse-otp-whatsapp-design.md

set -euo pipefail

ENV_FILE=/etc/gengal/gengal.env
HOST="${GENGAL_HOST:-gengalapp.duckdns.org}"
ROTATE=false
while [ $# -gt 0 ]; do
    case "$1" in
        --rotate) ROTATE=true ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
    shift
done

if [ "$(id -u)" -ne 0 ]; then
    echo "Run with sudo." >&2
    exit 1
fi

current() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true; }

set_var() {
    local name="$1" value="$2"
    sed -i "/^${name}=/d" "$ENV_FILE"
    printf '%s=%s\n' "$name" "$value" >> "$ENV_FILE"
}

# --- the number users send to ---------------------------------------------------
number="$(current WHATSAPP_NUMBER)"
default="${number:-$(current SMS_GATEWAY_NUMBER)}"
read -rp "WhatsApp business number users will message (10 digits) [${default:-none}]: " input
input="${input:-$default}"
digits="$(printf '%s' "$input" | tr -cd '0-9')"
digits="${digits: -10}"
if ! printf '%s' "$digits" | grep -Eq '^[6-9][0-9]{9}$'; then
    echo "Not an Indian mobile number: ${input:-<empty>}" >&2
    exit 1
fi
number="+91$digits"

# --- ids and secrets from the Meta dashboard -------------------------------------
phone_number_id="$(current WHATSAPP_PHONE_NUMBER_ID)"
read -rp "Phone number ID (WhatsApp > API Setup) [${phone_number_id:-none}]: " input
phone_number_id="${input:-$phone_number_id}"
if ! printf '%s' "$phone_number_id" | grep -Eq '^[0-9]{6,}$'; then
    echo "The phone number ID is the long number under the phone number in API Setup." >&2
    exit 1
fi

ask_secret() {  # ask_secret NAME "prompt" -> prints the kept or typed value
    local name="$1" prompt="$2" value typed state
    value="$(current "$name")"
    state="$([ -n "$value" ] && echo "set, Enter keeps it" || echo "not set")"
    read -rsp "$prompt [$state]: " typed
    echo >&2
    printf '%s' "${typed:-$value}"
}

app_secret="$(ask_secret WHATSAPP_APP_SECRET "App secret (App settings > Basic), typed hidden")"
access_token="$(ask_secret WHATSAPP_ACCESS_TOKEN "System user access token (never expires), typed hidden")"
if [ -z "$app_secret" ] || [ -z "$access_token" ]; then
    echo "Both the app secret and the access token are required." >&2
    exit 1
fi

verify_token="$(current WHATSAPP_VERIFY_TOKEN)"
if $ROTATE || [ -z "$verify_token" ]; then
    verify_token="$(openssl rand -hex 24)"
fi

set_var WHATSAPP_NUMBER "$number"
set_var WHATSAPP_PHONE_NUMBER_ID "$phone_number_id"
set_var WHATSAPP_APP_SECRET "$app_secret"
set_var WHATSAPP_ACCESS_TOKEN "$access_token"
set_var WHATSAPP_VERIFY_TOKEN "$verify_token"
chown root:gengal "$ENV_FILE"
chmod 0640 "$ENV_FILE"

systemctl restart gengal-backend
sleep 3
systemctl is-active --quiet gengal-backend || { echo "gengal-backend failed to start; see journalctl -u gengal-backend" >&2; exit 1; }

# The token check: a wrong or expired token fails here instead of on a user.
status="$(curl -s -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer $access_token" \
    "https://graph.facebook.com/v26.0/$phone_number_id?fields=display_phone_number" || true)"
if [ "$status" != "200" ]; then
    echo "WARNING: Meta rejected the access token for phone number ID $phone_number_id (HTTP $status)." >&2
    echo "         Replies will fail until the token and ID are right. Re-run this script to fix." >&2
fi

cat <<EOF

Saved to $ENV_FILE and restarted gengal-backend.

In the Meta app dashboard: WhatsApp > Configuration > Webhook > Edit
    Callback URL ...... https://$HOST/api/v1/auth/whatsapp/webhook
    Verify token ...... $verify_token
Then under Webhook fields, Subscribe to: messages

Do not paste the verify token into chats or tickets.

Then check:
    curl -s https://$HOST/api/v1/auth/sms/health     -> "whatsapp":"configured"
EOF
