#!/usr/bin/env bash
#
# Configure reverse-OTP sign-in for the "SMS to URL Forwarder" gateway app
# (tech.bogomolov.incomingsmsgateway) and print what to enter on the phone.
#
# Run it yourself, in your own SSH session -- it prints secrets once:
#     sudo bash /opt/gengal/deploy/sms-gateway-setup.sh
#
# Re-running keeps existing secrets (the phone keeps working) unless you pass
# --rotate, which issues new ones that must then be re-entered on the phone.

set -euo pipefail

ENV_FILE=/etc/gengal/gengal.env
HOST="${GENGAL_HOST:-gengalapp.duckdns.org}"
ROTATE=false
[ "${1:-}" = "--rotate" ] && ROTATE=true

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

# --- gateway SIM number --------------------------------------------------------
number="$(current SMS_GATEWAY_NUMBER)"
read -rp "Gateway SIM number (10 digits, the SIM users will text) [${number:-none}]: " input
if [ -n "$input" ]; then
    digits="$(printf '%s' "$input" | tr -cd '0-9')"
    digits="${digits: -10}"
    if ! printf '%s' "$digits" | grep -Eq '^[6-9][0-9]{9}$'; then
        echo "Not an Indian mobile number: $input" >&2
        exit 1
    fi
    number="+91$digits"
fi
if [ -z "$number" ]; then
    echo "A gateway number is required." >&2
    exit 1
fi

# --- SIM slot ------------------------------------------------------------------
sim="$(current SMS_GATEWAY_SIM)"
read -rp "SIM slot of that number on the gateway phone (sim1/sim2) [${sim:-sim1}]: " input
sim="${input:-${sim:-sim1}}"
case "$sim" in sim1|sim2) ;; *) echo "Use sim1 or sim2." >&2; exit 1 ;; esac

# --- secrets -------------------------------------------------------------------
signing_key="$(current SMS_GATEWAY_SIGNING_KEY)"
heartbeat_token="$(current SMS_GATEWAY_HEARTBEAT_TOKEN)"
if $ROTATE || [ -z "$signing_key" ]; then
    signing_key="$(openssl rand -hex 24)"
fi
if $ROTATE || [ -z "$heartbeat_token" ]; then
    heartbeat_token="$(openssl rand -hex 16)"
fi

set_var SMS_GATEWAY_NUMBER "$number"
set_var SMS_GATEWAY_SIM "$sim"
set_var SMS_GATEWAY_SIGNING_KEY "$signing_key"
set_var SMS_GATEWAY_HEARTBEAT_TOKEN "$heartbeat_token"
chown root:gengal "$ENV_FILE"
chmod 0640 "$ENV_FILE"

systemctl restart gengal-backend
sleep 3
systemctl is-active --quiet gengal-backend || { echo "gengal-backend failed to start; see journalctl -u gengal-backend" >&2; exit 1; }

cat <<EOF

Saved to $ENV_FILE and restarted gengal-backend.

Enter these in "SMS to URL Forwarder" on the gateway phone.
Do not paste them into chats or tickets.

  Forwarding rule (+)
    Sender ............ *
    Webhook URL ....... https://$HOST/api/v1/auth/sms/forwarder
    Template .......... leave the default
    HMAC secret ....... $signing_key

  Heartbeat
    URL ............... https://$HOST/api/v1/auth/sms/heartbeat/$heartbeat_token
    Interval .......... 1 minute

Typing tip: with the phone on USB and the field focused, run on your PC:
    adb shell input text <value>

Then check (within a minute or two):
    curl -s https://$HOST/api/v1/auth/sms/health     -> "gateway":"online"
EOF
