# GenGal backend on Oracle Cloud Always Free — full runbook

Rebuild the production backend from nothing on a **fresh Oracle Cloud account**, at ₹0.
Written to be handed to an agent or followed by hand. Every step below was actually
executed on 2026-09-16; the "Traps" section lists failures that happened, not theory.

Target account for GenGal: a **dedicated Oracle account** registered to the project's
own email (ask the owner). The Oracle account used on 2026-09-16 belongs to another
project and should not host this app long-term.

---

## 0. What you end up with

| Piece | Value |
|---|---|
| VM | Always Free, Ubuntu 24.04 |
| Web server | nginx reverse proxy → waitress on 127.0.0.1:5055 |
| TLS | Let's Encrypt via certbot, auto-renewing |
| App | `/opt/gengal` (branch `hardening/payments-and-audit`), systemd unit `gengal-backend` |
| Secrets | `/etc/gengal/gengal.env`, `root:gengal 0640` |
| Cost | ₹0 — every resource is Always Free |

## 1. Account

Sign up at cloud.oracle.com. A card is required for identity checks; a **Free Trial /
Free Tier account with no payment method cannot be billed**. Never click *Upgrade*.

- **Home region is permanent.** Choose the closest one (Hyderabad or Mumbai for India).
- The Always Free allowance is **per account, not per VM**: 4 ARM (A1) OCPUs + 24 GB RAM,
  2× E2.1.Micro, 200 GB total block storage.

Before creating anything, audit what is already used: Compute → Instances (all
compartments), Storage → Boot/Block Volumes, and Governance → Limits, Quotas and Usage
(`standard-a1-core-count`, `standard-a1-memory`, block storage GB). Subtract from the
allowance above; that is what you may create.

## 2. SSH key — do this FIRST

Generate it locally and paste the **public** key into the create form. Never let Oracle
generate the pair: it downloads a private key you can lose, and the form silently
reverts to that option.

```bash
ssh-keygen -t rsa -b 4096 -f ~/.ssh/oracle_gengal -C gengal-oracle
cat ~/.ssh/oracle_gengal.pub          # this single line goes in the form
```

Windows cmd, for later:

```
icacls "%USERPROFILE%\.ssh\oracle_gengal.key" /inheritance:r /grant:r "%USERNAME%:R"
ssh -o ServerAliveInterval=60 -i "%USERPROFILE%\.ssh\oracle_gengal.key" ubuntu@<IP>
```

The SSH key **cannot be changed after creation**. A wrong key means rebuilding the VM.

## 3. Network (free, about 2 minutes)

Networking → Virtual Cloud Networks → **Start VCN Wizard** → "VCN with Internet
Connectivity": name `gengal-vcn`, VCN CIDR `10.1.0.0/16`, public subnet `10.1.0.0/24`,
private subnet `10.1.1.0/24`.

Then verify, because the wizard can fail silently (see Traps):

1. Public subnet → route table must contain `0.0.0.0/0 → Internet gateway`. Add it if missing.
2. Public subnet → security list → Add Ingress Rules: TCP **80** and TCP **443** from
   `0.0.0.0/0`. Keep the existing rule for 22.

## 4. Create the instance

Compute → Instances → Create instance:

- Name `gengal-backend`, AD-1
- Image **Canonical Ubuntu 24.04** (standard, not Minimal)
- Shape **VM.Standard.A1.Flex, 2 OCPU / 12 GB** (ARM, preferred).
  On "Out of capacity": try 1 OCPU / 6 GB, retry off-peak, and fall back to
  **VM.Standard.E2.1.Micro** (1 GB RAM) only if you must ship today.
- Networking: existing `gengal-vcn` and its **public** subnet, public IPv4 **ON**
- SSH: **Paste public keys**
- Boot volume 50 GB, Balanced, 10 VPU
- Advanced → Management → Initialization script → paste:

```bash
#!/bin/bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
netfilter-persistent save
timedatectl set-ntp true
```

The swap lines matter only on the 1 GB Micro, and are harmless on ARM.

**Immediately before clicking Create**, re-read the Review page: name, shape, image and
SSH key. See Traps — the form resets.

## 5. DNS

Own domain: A record `api.yourdomain.com → <public IP>`.
Free alternative: duckdns.org → add a subdomain → set **current ip** to the VM's public
IP (it prefills your home IP, which is wrong). In use on 2026-09-16: `gengalapp.duckdns.org`.

Verify before certbot: `nslookup <host> 8.8.8.8` and `curl -I http://<host>/`.

## 6. Provision

```bash
git clone --depth 1 --branch hardening/payments-and-audit \
  https://github.com/revanthsamileti/gengal.git /tmp/gengal
sudo BRANCH=hardening/payments-and-audit bash /tmp/gengal/deploy/setup-oracle.sh
```

Idempotent, writes no secrets, starts nothing. About 5 minutes.

## 7. TLS

```bash
sudo sed -i 's/api\.example\.com/<your-host>/' /etc/nginx/sites-available/gengal
sudo nginx -t && sudo systemctl reload nginx
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d <your-host>
```

## 8. Secrets

`sudo nano /etc/gengal/gengal.env`:

```
APP_ENV=production
PORT=5055
BIND_HOST=127.0.0.1
PUBLIC_BASE_URL=https://<your-host>

AGORA_APP_ID=
AGORA_APP_CERTIFICATE=
ZEGO_APP_ID=
ZEGO_SERVER_SECRET=

PAYMENT_PROVIDER=razorpay
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=

SMS_GATEWAY_NUMBER=
SMS_GATEWAY_SIGNING_KEY=

ADMIN_UIDS=
CORS_ALLOWED_ORIGINS=

ALLOW_DEV_OTP_BYPASS=false
FLASK_DEBUG=false
ENABLE_REMOTE_DEBUG_LOG=false
```

Firebase service account (Firebase console → Project settings → Service accounts →
Generate new private key), copied up with `scp` to `/home/ubuntu/sa.json`, then:

```bash
sudo bash -c 'printf "FIREBASE_CREDENTIALS_JSON=%s\n" "$(jq -c . /home/ubuntu/sa.json)" >> /etc/gengal/gengal.env'
rm /home/ubuntu/sa.json
```

It must be **one line**: systemd's EnvironmentFile truncates at the first newline.

## 9. Start and verify

```bash
sudo systemctl enable --now gengal-backend
sudo systemctl status gengal-backend
curl -s https://<your-host>/_up          # proxies to the app's /healthz, expect 200
```

Then set `EXPO_PUBLIC_BACKEND_URL=https://<your-host>` in the app and rebuild.

## 10. Traps (each one cost real time)

1. **The create-instance form silently resets** when left idle: back to E2.1.Micro,
   Oracle Linux, 47 GB disk and a *generated* SSH key. It produced one VM nobody could
   log into. Re-verify the Review page immediately before every Create.
2. **Two firewalls.** The VCN security list *and* the VM's iptables, which carries a
   blanket REJECT — ACCEPT rules must be inserted **above** it, never appended.
3. **The VCN wizard can half-fail**: gateways created, route table left empty. The VM
   then has a public IP and is unreachable, with nothing in any log. Check the route.
4. **A1 (ARM) capacity is scarce** in small regions. Hyderabad has only AD-1, and a free
   account cannot use another region. Smaller shapes succeed more often; retry off-peak.
5. **"Virtual cloud network: -" on the Review page is cosmetic.** The launch API places
   an instance by *subnet*; there is no VCN field.
6. **The cost estimator always shows list price** (for example $8.50/month for 200 GB)
   and never subtracts the free allowance. Judge cost from the step 1 audit instead.
7. **Never re-run `setup-oracle.sh` after certbot.** It reinstalls
   `deploy/nginx-gengal.conf` over `/etc/nginx/sites-available/gengal`, which
   wipes certbot's TLS server block and the real `server_name`. Redeploy code with
   `git fetch` + `reset` in `/opt/gengal` instead (see §12).
8. **One process only.** The reverse-OTP session store and the rate limiters are
   in-memory; the gateway's webhook and the app's poll must reach the same process. Scale
   with threads (`--threads`), not workers, until they move to Redis.
9. **Idle reclamation.** Oracle can reclaim an Always Free VM left idle for 7 days. Keep
   this runbook so a rebuild is cheap; the server holds no data — everything is in Firestore.

## 11. Capacity notes for scale

At about 1,000 concurrent callers the server sees only billing ticks: two per call every
15 seconds, roughly 67 req/s, about 0.3 of a core. Raise waitress to `--threads 32` in
`/etc/systemd/system/gengal-backend.service` at that point. The real costs at that scale
are Agora/Zego per-minute charges and Firestore reads and writes, not the VM.

## 12. Reverse-OTP gateway phone

Sign-in works by users texting `GENGAL <code>` from their own phone to a spare Android
phone, which forwards the SMS to the backend.

1. Spare Android phone, Indian SIM, charger always connected, Wi-Fi on.
2. Install **SMS Gateway for Android** (capcom6, open source). Grant SMS permission.
3. Use **Local server** mode (messages do not pass through a third-party cloud). Note the
   local address, username and password it shows.
4. From a computer on the same Wi-Fi, register both webhooks:
   ```bash
   curl -X POST -u USER:PASS -H "Content-Type: application/json" \
     -d '{"id":"gengal-sms","url":"https://<host>/api/v1/auth/sms/inbound","event":"sms:received"}' \
     http://<phone-ip>:8080/webhooks
   curl -X POST -u USER:PASS -H "Content-Type: application/json" \
     -d '{"id":"gengal-ping","url":"https://<host>/api/v1/auth/sms/inbound","event":"system:ping"}' \
     http://<phone-ip>:8080/webhooks
   ```
5. In the app: **Settings → Ping** = 60 s. Leave webhook **batching off**.
6. Copy **Settings → Webhooks → Signing Key** into `SMS_GATEWAY_SIGNING_KEY`, and the SIM's
   number into `SMS_GATEWAY_NUMBER`, in `/etc/gengal/gengal.env`.
7. Exempt the app from battery optimisation and enable start-on-boot. Keep the SIM
   recharged — an expired prepaid SIM stops receiving SMS.
8. `sudo systemctl restart gengal-backend`, wait a minute, then
   `curl -s https://<host>/api/v1/auth/sms/health` must show `"gateway":"online"`.
9. Add a free uptime monitor (UptimeRobot / Better Stack) on that URL every 5 minutes with
   email alerts. It fires when the phone dies.

### Alternative gateway app: SMS to URL Forwarder

`tech.bogomolov.incomingsmsgateway` (GitHub releases / F-Droid) works too, through
`/api/v1/auth/sms/forwarder`. It signs `hex(HMAC-SHA256(secret, body))` and its heartbeat
is an unsigned empty POST, so the heartbeat authenticates with a URL token instead.

1. Same phone preparation as steps 1 and 7 above.
2. On the server, in your own SSH session: `sudo bash /opt/gengal/deploy/sms-gateway-setup.sh`.
   It asks for the SIM number and slot, generates the HMAC secret and heartbeat token,
   restarts the service, and prints exactly what to enter in the app. Re-running keeps the
   secrets; `--rotate` replaces them.
3. In the app: add a forwarding rule (sender `*`, the printed webhook URL, default
   template, the printed HMAC secret) and set the heartbeat URL with a 1-minute interval.
4. Check `/api/v1/auth/sms/health` shows `"gateway":"online"`.

**Redeploying code** (never re-run `setup-oracle.sh`, see Trap 7):

```bash
sudo git -c safe.directory=/opt/gengal -C /opt/gengal fetch --depth 1 origin <branch>
sudo git -c safe.directory=/opt/gengal -C /opt/gengal reset --hard FETCH_HEAD
sudo /opt/gengal/venv/bin/pip install -r /opt/gengal/backend/requirements.txt
sudo chown -R gengal:gengal /opt/gengal
sudo install -m 0644 /opt/gengal/deploy/gengal-backend.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl restart gengal-backend
```
