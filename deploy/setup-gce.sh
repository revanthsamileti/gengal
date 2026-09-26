#!/usr/bin/env bash
#
# One-time provisioning for the GenGal backend on a Google Compute Engine
# "Always Free" e2-micro instance (Ubuntu 22.04/24.04, x86_64).
#
# Run as a sudo-capable user on a fresh box:
#     bash setup-gce.sh
#
# Idempotent: safe to re-run. It does NOT write secrets and does NOT start the
# service -- you fill /etc/gengal/gengal.env by hand, then enable it.
# See README-gce.md.
#
# Differences from setup-oracle.sh, and why:
#   * e2-micro has 1 GB of RAM (Oracle's A1 had 12+). This adds swap and runs
#     waitress with fewer threads.
#   * GCE's Ubuntu images have no host firewall at all -- the filtering lives
#     in the VPC, off the box -- so there is no iptables REJECT to work around.
#     Instead this reports whether the instance carries the right network tags.

set -euo pipefail

APP_USER=gengal
APP_ROOT=/opt/gengal
REPO_URL="${REPO_URL:-https://github.com/revanthsamileti/gengal.git}"
BRANCH="${BRANCH:-main}"
SWAPFILE=/swapfile
SWAPSIZE_MB=2048

echo "==> System packages"
sudo apt-get update -y
sudo apt-get install -y \
    python3 python3-venv python3-dev \
    build-essential pkg-config \
    git nginx curl jq \
    certbot python3-certbot-nginx

echo "==> Swap (${SWAPSIZE_MB}MB)"
# e2-micro is 1 GB. firebase-admin plus grpcio idles around 150-250 MB, which
# fits, but pip resolving the dependency tree peaks far higher and gets
# OOM-killed on a swapless 1 GB box -- the install dies with no error message,
# just "Killed". Swap turns that hard failure into a slow success.
if ! grep -q "$SWAPFILE" /proc/swaps 2>/dev/null; then
    if [ ! -f "$SWAPFILE" ]; then
        sudo fallocate -l "${SWAPSIZE_MB}M" "$SWAPFILE" \
            || sudo dd if=/dev/zero of="$SWAPFILE" bs=1M count="$SWAPSIZE_MB" status=none
        sudo chmod 600 "$SWAPFILE"
        sudo mkswap "$SWAPFILE" >/dev/null
    fi
    sudo swapon "$SWAPFILE"
    grep -q "^$SWAPFILE" /etc/fstab || echo "$SWAPFILE none swap sw 0 0" | sudo tee -a /etc/fstab >/dev/null
    echo "    enabled and persisted in /etc/fstab"
else
    echo "    already active"
fi
# Swap is the safety net for allocation spikes, not a place to run from. Low
# swappiness keeps the request path in real memory so billing ticks and token
# mints do not stall on disk.
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-gengal-swap.conf >/dev/null
sudo sysctl -q -w vm.swappiness=10

echo "==> Service account: $APP_USER"
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
# grpcio ships x86_64 manylinux wheels, but only a current pip recognises them.
# An old pip falls back to compiling from source, which on two shared-core vCPUs
# takes 20+ minutes and usually ends in the OOM killer even with the swap above.
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

# Drop-in rather than a forked unit file, so the shared unit stays the single
# source of truth and only the machine-specific part diverges here.
# Each waitress thread holds its own buffers and a Firestore/gRPC channel;
# eight of them on 1 GB leaves too little headroom. Four still absorbs far more
# than this workload generates -- a call produces two billing requests per 15s.
sudo install -d -m 0755 /etc/systemd/system/gengal-backend.service.d
sudo tee /etc/systemd/system/gengal-backend.service.d/gce.conf >/dev/null <<'DROPIN'
[Service]
# ExecStart must be cleared before being reset; systemd appends otherwise.
ExecStart=
ExecStart=/opt/gengal/venv/bin/waitress-serve \
    --host 127.0.0.1 \
    --port 5055 \
    --threads 4 \
    app:app
DROPIN
sudo systemctl daemon-reload

echo "==> nginx site"
sudo install -m 0644 "$APP_ROOT/deploy/nginx-gengal.conf" \
    /etc/nginx/sites-available/gengal
sudo ln -sf /etc/nginx/sites-available/gengal /etc/nginx/sites-enabled/gengal
sudo rm -f /etc/nginx/sites-enabled/default

echo "==> Firewall check"
# Nothing to change on the box: GCE Ubuntu images ship an empty iptables ACCEPT
# policy, and all filtering happens in the VPC. But the default VPC does not
# allow 80/443 -- those rules only exist if you ticked "Allow HTTP/HTTPS
# traffic" at VM creation, which works by putting http-server/https-server
# network tags on the instance. Read the tags back from the metadata server so
# you find out now rather than after a silent connection timeout.
TAGS="$(curl -s -f -H 'Metadata-Flavor: Google' \
    http://metadata.google.internal/computeMetadata/v1/instance/tags 2>/dev/null || echo '')"
if [ -z "$TAGS" ]; then
    echo "    metadata server unreachable -- not a GCE instance? Verify VPC rules by hand."
else
    for tag in http-server https-server; do
        if echo "$TAGS" | grep -q "\"$tag\""; then
            echo "    tag '$tag' present"
        else
            echo "    MISSING tag '$tag' -- port will be unreachable. Fix with:"
            echo "        gcloud compute instances add-tags \$(hostname) --tags=$tag --zone=<your-zone>"
        fi
    done
fi

cat <<'DONE'

==> Provisioning finished. Remaining steps are yours:

  1. Edit secrets:      sudo nano /etc/gengal/gengal.env
  2. Set your hostname: sudo nano /etc/nginx/sites-available/gengal
  3. Reserve a static IP, or the address changes on every stop/start and
     your DNS silently goes stale:
         gcloud compute addresses create gengal-ip --region=<region>
  4. Point an A record at that IP, then:
         sudo certbot --nginx -d api.example.com
  5. Start:             sudo systemctl enable --now gengal-backend
  6. Check:             sudo systemctl status gengal-backend
                        sudo journalctl -u gengal-backend -f

DONE
