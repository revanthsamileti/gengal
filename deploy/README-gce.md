# Deploying GenGal on Google Compute Engine (Always Free)

The `e2-micro` Always Free instance is the target here: a real VM with a real
disk that never sleeps and has no expiry date. That combination is what this
backend actually needs, for three reasons that live in the code:

* `otp_store`, `abuse_store` and `_rate_buckets` (`backend/app.py:161`, `:417`,
  `:124`) are in-process dicts, so **exactly one instance may run**. Anything
  that autoscales will verify an OTP on a worker that never issued it.
* The only thing it writes to disk is `debug_events.log`
  (`backend/app.py:260`), which is a log and safe to lose, so **no persistent
  volume is required**.
* The app blocks on `/api/v1/agora/generate-token` when a call starts
  (`src/screens/CallScreen.tsx:377`), so a **cold start means the call never
  connects**.

Backend latency, by contrast, barely matters: Agora and Zego carry the audio
peer-to-peer, and the billing tick only reaches the server every 15 seconds
(`src/screens/CallScreen.tsx:969`). A US region is fine.

## 1. Create the instance

Compute Engine → Create instance.

| Setting | Value | Why |
|---|---|---|
| Region | `us-west1`, `us-central1`, or `us-east1` | The **only** three where e2-micro is free. Any other region bills normally. |
| Machine type | `e2-micro` | `e2-small` and up are not free. |
| Boot disk | Ubuntu 22.04 or 24.04 LTS, **Standard persistent disk**, ≤30 GB | Balanced and SSD disks are **not** covered by the free tier. This is the most common accidental charge. |
| Firewall | tick **Allow HTTP traffic** and **Allow HTTPS traffic** | Adds the `http-server` / `https-server` network tags. Without them the VPC drops 80/443 and connections hang with nothing in any log. |

Unlike Oracle, there is no host firewall to fight — GCE's Ubuntu images ship an
empty ACCEPT iptables policy and all filtering happens in the VPC.

## 2. Reserve a static IP

Ephemeral addresses change whenever the VM stops and starts, which silently
breaks your DNS and your TLS renewal.

```bash
gcloud compute addresses create gengal-ip --region=us-central1
```

Then attach it to the instance under Network interfaces → External IP. One
static IP in use on a running instance is included in the free tier; a reserved
IP sitting *unattached* is billed, so do not leave one idle.

## 3. Provision

```bash
gcloud compute ssh gengal --zone=us-central1-a
```

```bash
git clone https://github.com/revanthsamileti/gengal.git /tmp/gengal && bash /tmp/gengal/deploy/setup-gce.sh
```

Add `BRANCH=hardening/payments-and-audit` in front of that command if you are
deploying this branch rather than `main`.

The script installs packages, adds 2 GB of swap, builds the venv, installs the
systemd unit with a 4-thread drop-in override, configures nginx, and reports
whether the network tags are present. It writes no secrets and starts nothing.

## 4. Secrets

```bash
sudo nano /etc/gengal/gengal.env
```

Every field is documented in `gengal.env.example`. The three that most often go
wrong: `FIREBASE_CREDENTIALS_JSON` must be the whole service-account JSON on one
line (`jq -c . serviceAccountKey.json`), `APP_ENV` must be exactly `production`,
and `PUBLIC_BASE_URL` must be your real HTTPS origin with no trailing slash.

## 5. TLS

Point an A record at the static IP, set `server_name` in
`/etc/nginx/sites-available/gengal`, then:

```bash
sudo certbot --nginx -d api.yourdomain.com
```

## 6. Start and verify

```bash
sudo systemctl enable --now gengal-backend && sudo systemctl status gengal-backend
```

```bash
curl -i -X POST https://api.yourdomain.com/api/v1/agora/generate-token
```

A `401` is the correct answer — it proves the route is live and the auth guard
is running. A timeout means the network tags from step 1 are missing.

## Updating

```bash
sudo git -C /opt/gengal pull && sudo /opt/gengal/venv/bin/pip install -r /opt/gengal/backend/requirements.txt && sudo systemctl restart gengal-backend
```

## Known limits, honestly

**Egress is capped at 1 GB/month** from North America, but this backend sends
only JSON — a billing tick is a couple hundred bytes, so even heavy call volume
costs single-digit MB per month. You would need years of traffic to reach the
limit. If you ever add media (voice intros, images), serve it from object
storage rather than this VM, or that changes overnight.

**1 GB of RAM.** The swap and the 4-thread limit make this comfortable, but do
not raise `--threads` without watching `free -m` first; each waitress thread
carries its own gRPC channel to Firestore.

**`debug_events.log` grows without bound** (`backend/app.py:260`). On a VM that
never resets, nothing truncates it. Add logrotate or disable the writer in
production before it fills a 30 GB disk.

**One instance is one point of failure.** No load balancer, no failover — and
per the in-process state above, you cannot simply add a second instance to fix
that. Moving `otp_store` to Redis is the prerequisite for ever scaling out.
