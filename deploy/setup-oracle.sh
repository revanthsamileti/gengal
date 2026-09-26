#!/usr/bin/env bash
#
# One-time provisioning for the GenGal backend on an Oracle Cloud Always Free
# ARM instance (Ubuntu 22.04/24.04, aarch64).
#
# Run as a sudo-capable user on a fresh box:
#     bash setup-oracle.sh
#
# Idempotent: safe to re-run. It does NOT write secrets or start the service --
# you fill /etc/gengal/gengal.env by hand, then enable it. See README.md.

set -euo pipefail

APP_USER=gengal
APP_ROOT=/opt/gengal
REPO_URL="${REPO_URL:-https://github.com/revanthsamileti/gengal.git}"
BRANCH="${BRANCH:-main}"

echo "==> System packages"
sudo apt-get update -y
sudo apt-get install -y \
    python3 python3-venv python3-dev \
    build-essential pkg-config \
    git nginx curl jq \
    certbot python3-certbot-nginx

echo "==> Service account: $APP_USER"
# --system: no login shell, no home clutter. The app never needs to be a person.
id -u "$APP_USER" >/dev/null 2>&1 || sudo useradd --system --shell /usr/sbin/nologin --home-dir "$APP_ROOT" "$APP_USER"

echo "==> Source at $APP_ROOT"
if [ -d "$APP_ROOT/.git" ]; then
    sudo git -C "$APP_ROOT" fetch --depth 1 origin "$BRANCH"
    sudo git -C "$APP_ROOT" reset --hard "origin/$BRANCH"
else
    sudo mkdir -p "$APP_ROOT"
    sudo git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$APP_ROOT"
fi

echo "==> Python virtualenv"
sudo python3 -m venv "$APP_ROOT/venv"
# grpcio (a firebase-admin dependency) has aarch64 wheels, but only for a
# current pip. An old pip falls back to building it from source, which takes
# 20+ minutes on these cores and usually dies on memory.
sudo "$APP_ROOT/venv/bin/pip" install --upgrade pip setuptools wheel
sudo "$APP_ROOT/venv/bin/pip" install -r "$APP_ROOT/backend/requirements.txt"

echo "==> Ownership"
sudo chown -R "$APP_USER:$APP_USER" "$APP_ROOT"

echo "==> Secrets directory (you still have to fill the file)"
sudo install -d -m 0750 -o root -g "$APP_USER" /etc/gengal
if [ ! -f /etc/gengal/gengal.env ]; then
    sudo install -m 0640 -o root -g "$APP_USER" \
        "$APP_ROOT/deploy/gengal.env.example" /etc/gengal/gengal.env
    echo "    created /etc/gengal/gengal.env from the template -- EDIT IT before starting"
fi

echo "==> systemd unit"
sudo install -m 0644 "$APP_ROOT/deploy/gengal-backend.service" \
    /etc/systemd/system/gengal-backend.service
sudo systemctl daemon-reload

echo "==> nginx site"
sudo install -m 0644 "$APP_ROOT/deploy/nginx-gengal.conf" \
    /etc/nginx/sites-available/gengal
sudo ln -sf /etc/nginx/sites-available/gengal /etc/nginx/sites-enabled/gengal
sudo rm -f /etc/nginx/sites-enabled/default

echo "==> Host firewall"
# THE Oracle gotcha. Opening 80/443 in the VCN security list is necessary but
# not sufficient: Oracle's Ubuntu images ship an iptables ruleset with a
# blanket REJECT near the end of the INPUT chain, so the ports stay shut and
# every connection times out with no log anywhere. Insert ACCEPT rules ABOVE
# that REJECT -- appending puts them after it, where they never match.
if sudo iptables -L INPUT -n --line-numbers | grep -q REJECT; then
    for port in 80 443; do
        if ! sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null; then
            sudo iptables -I INPUT 1 -p tcp --dport "$port" -j ACCEPT
        fi
    done
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent
    sudo netfilter-persistent save
    echo "    opened 80/443 in iptables and persisted"
else
    echo "    no REJECT rule found; skipping (check your VCN security list instead)"
fi

cat <<'DONE'

==> Provisioning finished. Remaining steps are yours:

  1. Edit secrets:      sudo nano /etc/gengal/gengal.env
  2. Set your hostname: sudo nano /etc/nginx/sites-available/gengal
  3. Open 80/443 in the VCN security list (Oracle console, not this box)
  4. TLS:               sudo certbot --nginx -d api.example.com
  5. Start:             sudo systemctl enable --now gengal-backend
  6. Check:             sudo systemctl status gengal-backend
                        sudo journalctl -u gengal-backend -f

DONE
