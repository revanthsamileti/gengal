# Deploying the GenGal backend to Oracle Cloud Always Free

Target: one Always Free **ARM (Ampere A1)** instance in the region nearest your
users — Mumbai for an India-facing app. Always-on, so no cold start on the RTC
token mint or the opening billing tick, both of which happen at call-connect
and are felt directly as dial latency.

Files here:

| File | Goes to |
|---|---|
| `setup-oracle.sh` | run once on the box |
| `gengal-backend.service` | `/etc/systemd/system/` |
| `nginx-gengal.conf` | `/etc/nginx/sites-available/gengal` |
| `gengal.env.example` | template for `/etc/gengal/gengal.env` |

## 1. Create the instance

Shape **VM.Standard.A1.Flex**, 2 OCPU / 12GB is plenty (the free allowance is
4 OCPU / 24GB across all A1 instances). Image: **Ubuntu 22.04 or 24.04, aarch64**.
Save the SSH key when it is offered — it is not recoverable afterwards.

If capacity is unavailable ("Out of host capacity"), retry later or pick a
different availability domain. This is common for A1 in busy regions and is not
something you have done wrong.

## 2. Open the ports — both of them

This trips up nearly everyone, because it is **two separate firewalls** and
fixing only one produces a connection that hangs with nothing in any log.

- **VCN security list** (Oracle web console): add ingress for TCP 80 and 443
  from `0.0.0.0/0`. Networking → Virtual Cloud Networks → your VCN → Security
  Lists → Default → Add Ingress Rules.
- **Host iptables** (on the box): Oracle's Ubuntu images ship a blanket
  `REJECT` near the end of the `INPUT` chain. `setup-oracle.sh` inserts ACCEPT
  rules *above* it and persists them. Appending instead of inserting puts them
  after the REJECT where they never match — which is the usual mistake.

## 3. Provision

```bash
ssh ubuntu@<your-ip>
git clone https://github.com/revanthsamileti/gengal.git /tmp/gengal
bash /tmp/gengal/deploy/setup-oracle.sh
```

Installs Python and nginx, creates the `gengal` system user, clones to
`/opt/gengal`, builds the venv, and installs the unit and nginx site. It writes
no secrets and starts nothing.

## 4. Secrets

```bash
sudo nano /etc/gengal/gengal.env
```

Every variable is documented in `gengal.env.example`. Two that reliably cause
grief:

- **`FIREBASE_CREDENTIALS_JSON`** must be the whole service account JSON on a
  single line — `jq -c . serviceAccountKey.json` on your laptop, then paste.
  A newline inside the value truncates it and the app dies at import.
- **`PUBLIC_BASE_URL`** must be your real HTTPS origin with no trailing slash.
  It is read with `require_env()`, so the payment route 500s without it.

The file is `root:gengal` `0640`, readable by the service and nobody else.

## 5. TLS

Point an A record at the instance's public IP first, then:

```bash
sudo nano /etc/nginx/sites-available/gengal   # set server_name
sudo certbot --nginx -d api.yourdomain.com
sudo nginx -t && sudo systemctl reload nginx
```

Certbot rewrites the site file to add the TLS listener and the 301 from port 80.
Renewal is automatic via its systemd timer.

## 6. Start

```bash
sudo systemctl enable --now gengal-backend
sudo systemctl status gengal-backend
sudo journalctl -u gengal-backend -f
```

Verify from your laptop — the 401 is the point, it proves the auth guard is
live rather than the route being absent:

```bash
curl -i -X POST https://api.yourdomain.com/api/v1/agora/generate-token
```

## 7. Point the app at it

In `.env`:

```
EXPO_PUBLIC_BACKEND_URL=https://api.yourdomain.com
```

`EXPO_PUBLIC_*` is inlined at bundle time, so rebuild — a running Metro keeps
serving the old value no matter how many times you reload the app.

## Updating

```bash
cd /opt/gengal && sudo git pull
sudo /opt/gengal/venv/bin/pip install -r backend/requirements.txt
sudo systemctl restart gengal-backend
```

## Things that will bite later

**`debug_events.log` grows unbounded.** Already 2.5MB locally. On a persistent
VM nothing truncates it, so cap `logDebugEvent` in production or add a
logrotate rule before it fills the boot volume.

**`temp_media/` is never swept.** Same disk, same outcome.

**Free tier reclamation.** Oracle may reclaim *idle* Always Free compute. A
backend serving real traffic is not idle, but a project that goes quiet for
weeks can be flagged — keep a monitor hitting it if you care about the box
surviving a quiet month.

**One instance is one point of failure.** No load balancer, no failover. Fine
for now; worth knowing it is not an HA setup.
