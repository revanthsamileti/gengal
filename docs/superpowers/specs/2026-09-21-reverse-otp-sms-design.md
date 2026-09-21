# Reverse-OTP sign-in by user-sent SMS — design

**Date:** 2026-09-21
**Branch:** `feature/reverse-otp-sms` (from `hardening/payments-and-audit` at 6d62098)
**Status:** design, awaiting review

## 1. Goal

Replace outbound SMS OTP (Twilio / Fast2SMS) with **reverse OTP**: the user proves they
own a phone number by *sending* an SMS from it. The app becomes **passwordless** — every
sign-up and every login uses this flow.

Constraints: ₹0 running cost; Indian mobile numbers only; must keep every existing
account reachable under its current Firebase UID.

### Non-goals

- WhatsApp, missed-call, or Truecaller verification.
- A paid inbound-SMS provider (the design keeps the door open; see §3.4).
- Deleting existing password hashes from `user_credentials` (left in place, unused).
- Multi-worker scaling (the backend stays single-process; see §5.6).

## 2. User flow

1. **Phone screen** — user enters a 10-digit Indian mobile number and taps Continue.
2. **Verify-by-SMS screen** — shows:
   - the code, e.g. `GENGAL 482913`
   - the gateway number, e.g. `+91 98xxxxxxxx`
   - a **Send SMS** button that opens the phone's SMS app pre-filled with that text to
     that number (on web: plain instructions, since the SMS can be sent from any phone
     holding the SIM)
   - a live status: "Waiting for your SMS…", with a 10-minute countdown
3. User taps Send in their SMS app and returns to GenGal.
4. Within a few seconds the screen flips to verified and signs in.
   - **New user** (no `users/{uid}` doc) → ProfileDetails → FinalizeInvite → Home.
   - **Existing user** → Home.
5. Timeout or failure → "Didn't work? Try again", which starts a fresh session.

Staying signed in is handled by Firebase Auth's existing AsyncStorage persistence
(`src/config/firebase.ts`). Users only repeat the SMS after logging out or reinstalling.

## 3. Architecture

```
 App ──POST /auth/sms/start {phone}──────────────► Backend ── creates session
     ◄──{sessionId, code, gatewayNumber, expiresIn}──       (in memory, 10 min)

 User's phone ──SMS "GENGAL 482913"──► Gateway phone (spare Android + SIM)
                                          │  SMS Gateway for Android app
                                          ▼
                      POST /auth/sms/inbound  (X-Signature, X-Timestamp)
                                          ▼
                                       Backend ── code → session;
                                                  sender == session.phone ⇒ verified

 App ──POST /auth/sms/status {sessionId} (every 2 s)──► Backend
     ◄──{status: "verified", token, isNewUser}──  (token minted once, session deleted)
 App ── signInWithCustomToken(token) ── Firebase Auth
```

### 3.1 Backend: new module `backend/sms_verify.py`

Pure logic, no Flask, no Firestore — unit-testable in isolation.

| Unit | Responsibility |
|---|---|
| `normalize_in_mobile(raw) -> str \| None` | Any of `+919876543210`, `919876543210`, `09876543210`, `9876543210`, with spaces or dashes → `+919876543210`. Returns `None` unless the result is `+91` followed by 10 digits starting 6–9. Alphanumeric sender IDs return `None`. |
| `parse_code(message) -> str \| None` | Extracts the 6-digit code from the SMS body. Accepts `GENGAL 482913`, `gengal482913`, `482913`, surrounding whitespace. Rejects bodies with zero or several 6-digit runs. |
| `verify_signature(raw_body, timestamp, signature, key, now) -> bool` | `hmac.compare_digest(hex(HMAC-SHA256(key, raw_body + timestamp)), signature)` and `abs(now - int(timestamp)) <= 300`. |
| `SessionStore` | Thread-safe (`threading.Lock`) dict of sessions plus a `code → sessionId` index and a delivery-id dedupe set (ids kept 24 h). Methods: `start(phone)`, `mark_verified(code, sender, received_at)`, `consume(session_id)`, `purge_expired()`. Expired entries are purged on every call. Holds at most **10,000 live sessions**; beyond that `start` raises `StoreFull`, so start-spam from many IPs cannot exhaust memory. |
| `GatewayHealth` | Records the time of the last signed request from the gateway (any event, including `system:ping`) and the process start time. `status(now)` → `online` (seen within 5 min), `starting` (never seen, process up under 5 min), `offline`, or `misconfigured` (a batch event arrived, see §3.2). |

A session is `{id, phone, code, created_at, expires_at, verified_at}`.

- `id`: `secrets.token_urlsafe(32)`. Only the starting client knows it, so it doubles as
  the poll credential.
- `code`: `secrets.randbelow(10**6)`, zero-padded, re-drawn until unique among live
  sessions.

### 3.2 Backend: routes in `backend/app.py`

**`POST /api/v1/auth/sms/start`** `{phone}`
- 400 if `normalize_in_mobile` fails. 503 if the gateway env vars are unset.
- 503 `{error: "sms_gateway_offline"}` if `GatewayHealth` is `offline` or
  `misconfigured`, so users fail fast instead of texting a dead phone and waiting
  10 minutes.
- 503 if the store is full.
- Rate limits (see §5.4); 429 when exceeded.
- Starting again for the same phone replaces that phone's previous live session.
- 200 → `{sessionId, code, gatewayNumber, expiresIn: 600}`.

**`POST /api/v1/auth/sms/inbound`** — called only by the gateway phone
- Reads the **raw** body before JSON parsing, then checks the signature.
- 401 on a bad or stale signature (the gateway will retry, which is correct for a
  transient clock problem).
- Every signed request updates `GatewayHealth`.
- `system:ping` and `app:started` → 200, health only.
- `sms:batch:*` → logged as an **error** and `GatewayHealth` set to `misconfigured`
  (batching must stay off; see §7). Returns 200.
- Any other event than `sms:received`, or a duplicate delivery `id` → 200, ignored.
- Takes the sender from `payload.sender`, falling back to `payload.phoneNumber` (older
  app versions).
- Rejects an SMS whose `payload.receivedAt` is more than 60 s before the session was
  created. The gateway retries for up to two days, so a stale queued SMS must not verify
  a newer session that happened to draw the same code.
- On a code match with the matching sender → marks the session verified.
- **Every other signed request returns 200** — no match, wrong sender, expired, junk
  text. A non-2xx would make the gateway retry the same useless SMS for ~2 days.
  Mismatches are logged with the phone numbers masked.

**`POST /api/v1/auth/sms/status`** `{sessionId}`
- Unknown or expired session → `{status: "expired"}`.
- Not yet verified → `{status: "pending", expiresIn}`.
- Verified → mints `auth.create_custom_token("fast2sms:" + phone)`, **deletes the session**
  (so the token is issued exactly once), and returns
  `{status: "verified", token, isNewUser}`. `isNewUser` is `not users/{uid}.exists`.

- On `verified` it also writes one audit document (see §11.1).

**`GET /api/v1/auth/sms/health`** — public, no secrets
- `{gateway: "online"|"starting"|"offline"|"misconfigured", lastSeenSecondsAgo}`.
- HTTP 200 when `online` or `starting`, 503 otherwise, so a plain uptime monitor can
  alert on it (see §11.3).

The UID stays `fast2sms:{+91XXXXXXXXXX}` — byte-identical to what `verify-otp` mints
today — so every existing account keeps working.

### 3.3 App

- **`src/services/smsAuthService.ts`**: `startSmsVerification(phone)`,
  `pollSmsVerification(sessionId, {signal})`, and `completeSignIn(token)`, which wraps
  `signInWithCustomToken`.
- **`src/screens/VerifyBySmsScreen.tsx`** replaces `OtpScreen`. It uses `expo-sms`
  (`SMS.sendSMSAsync([gatewayNumber], body)`) to open the composer on Android and iOS;
  on web, or when `SMS.isAvailableAsync()` is false, it shows the text instructions. It
  polls every 2 s while focused, stops on unmount or expiry, and shows a countdown.
  - It listens to `AppState`. The user leaves for the SMS app mid-flow, and JS timers
    can be suspended in the background, so on return to `active` it polls
    **immediately** instead of waiting for the next tick.
  - The code has a **Copy** button, for users who send the SMS from a different app.
  - Start and Try again go through the existing `useActionLock` hook, so a double tap
    cannot start two sessions and burn the per-phone limit.
- **`PhoneScreen`**: drops the `checkUserExists` branch and always goes to
  VerifyBySms.
- **`App.tsx` registry**: add `VerifyBySms`; remove `Otp`, `CreatePassword`,
  `LoginPassword`, `ForgotPassword`.

### 3.4 Swapping the SMS source later

Only `/auth/sms/inbound`'s payload adapter and signature check know about the Android
app. A paid provider means a second adapter behind the same `SessionStore.mark_verified`
call. The app does not change.

## 4. Removals

| Remove | Why |
|---|---|
| `/api/v1/auth/send-otp`, `/verify-otp`, `otp_store`, Twilio and Fast2SMS code | Replaced |
| `/api/v1/auth/login-password`, `/set-password` | Passwordless |
| `/api/v1/auth/check-user` | No longer needed, and it let anyone enumerate registered numbers |
| Screens `Otp`, `CreatePassword`, `LoginPassword`, `ForgotPassword` | Replaced |
| `authService`: `sendOTP`, `verifyOTP`, `loginWithPassword`, `setAccountPassword`, `checkUserExists`, `saveAuthSession`, `restoreAuthSession` | Dead after the above |
| `TWILIO_*`, `FAST2SMS_API_KEY`, `ALLOW_LEGACY_PLAINTEXT_LOGIN` | Dead config |

Kept: `/auth/delete-account`, `/auth/check-username`, all non-auth routes.

## 5. Security

### 5.1 What proves what
- **Sender number** proves the user holds the SIM.
- **Code** proves the SMS belongs to *this* sign-in attempt.
- **sessionId** proves the poller is the device that started it.

All three are required.

### 5.2 Webhook authenticity
HMAC-SHA256 over raw body + `X-Timestamp`, constant-time compare, 5-minute clock window,
and dedupe on the delivery `id`. The signing key lives only in the gateway app and in
`/etc/gengal/gengal.env`.

### 5.3 Accepted risk: sender-ID spoofing
Reverse SMS trusts the carrier-reported sender, the same trust model as missed-call
verification. An attacker who can spoof a victim's sender number *and* send the code
shown on their own screen could take over that account. Mitigations:
- Only `+91` mobile senders are accepted (alphanumeric and international sender IDs are
  rejected).
- A 10-minute window.
- Per-phone start limits.
- Every verification is logged with a masked phone.

This is recorded as a known limitation, to be revisited if abuse appears.

### 5.4 Rate limits

| Limit | Value |
|---|---|
| `start`, per phone | 3 per 10 min, 10 per day |
| `start`, per client IP | 20 per hour |
| `status`, per session | 1 request per second (the app polls every 2 s) |

### 5.5 Client-IP fix — required for 5.4
Behind nginx, `request.remote_addr` is `127.0.0.1` for everyone, so every per-IP limit
in the app is currently shared by all users. Fix: add
`--trusted-proxy 127.0.0.1 --trusted-proxy-headers x-forwarded-for --clear-untrusted-proxy-headers`
to `waitress-serve` in `deploy/gengal-backend.service`. nginx already sends
`X-Forwarded-For`. This also repairs the existing limits on other routes.

### 5.6 Single process
`SessionStore` is in memory. The webhook and the poll must reach the same process, which
the one-worker waitress setup guarantees. A restart drops live sessions, and users simply
tap Try again. Moving to several workers means moving the store to Redis first, the same
constraint `otp_store` has today.

### 5.7 Development
`ALLOW_DEV_OTP_BYPASS=true` makes `start` return a session that is already verified.
The existing production guard still refuses to boot with it set, so it cannot reach
production.

## 6. Configuration

| Variable | Meaning |
|---|---|
| `SMS_GATEWAY_NUMBER` | The spare phone's number, shown to users (`+91…`) |
| `SMS_GATEWAY_SIGNING_KEY` | The gateway app's webhook signing key |

Both are added to `deploy/gengal.env.example`. `start` returns 503 until both are set.

## 7. Gateway phone (operations)

1. Spare Android phone with an Indian SIM, charger always connected, Wi-Fi or data on.
2. Install **SMS Gateway for Android** (capcom6, open source) and grant SMS permission.
3. **Local server mode**, so messages do not pass through a third-party cloud.
4. Register the webhook `https://<backend-host>/api/v1/auth/sms/inbound` for
   `sms:received` (via the app's local API from a computer on the same Wi-Fi).
5. Also register `system:ping` to the same URL, and set **Settings → Ping** to 60 s.
   This heartbeat is what `GatewayHealth` and the uptime monitor rely on.
6. Leave webhook **batching off**. Batch events have a different payload shape and are
   rejected (§3.2).
7. Copy **Settings → Webhooks → Signing Key** into `SMS_GATEWAY_SIGNING_KEY`.
8. Exempt the app from battery optimisation, and set it to start on boot.
9. Keep the SIM's validity recharged. An expired prepaid SIM stops receiving SMS.

These steps go into `docs/ORACLE_SETUP_RUNBOOK.md`.

## 8. Error handling in the app

| Case | App behaviour |
|---|---|
| `start` 400 | "Enter a valid Indian mobile number" |
| `start` 429 | "Too many attempts — try again in a few minutes" |
| `start` 503 `sms_gateway_offline` | "SMS sign-in is down for a few minutes — please try again shortly" (no code shown, nothing to send) |
| `start` other 503 or network error | "Sign-in is temporarily unavailable" |
| Poll network blip | Keep polling silently until expiry |
| The `verified` response is lost in transit | The session is already consumed, so the next poll says `expired` → Try again (costs the user one more SMS; accepted so the token can never be issued twice) |
| `expired` | "Code expired" + Try again |
| No SMS app (web, tablet) | Show number + text to send manually from the SIM phone |

## 9. Testing

**Backend** (pytest, existing `fake_firestore.py`):
- Unit: `normalize_in_mobile` (every format; rejects landline, alphanumeric, foreign),
  `parse_code`, `verify_signature` (valid, tampered body, stale timestamp, wrong key).
- Route flow: start → signed inbound → status verified → token minted once → second
  status is `expired`.
- Security: wrong sender, no signature, replayed delivery `id`, expired session, code
  collision re-draw, per-phone rate limit, `isNewUser` true/false via the fake Firestore,
  UID equals `fast2sms:+91…`.
- Production behaviour: stale `receivedAt` rejected; `system:ping` makes the gateway
  `online`; no signal for 5 min makes `start` return 503 `sms_gateway_offline`; a batch
  event flips health to `misconfigured`; the store cap returns 503; the audit document
  is written with a masked phone and no code; the log line never contains the full
  phone number or the code.
- Removed routes return 404.

**App:** `tsc --noEmit` clean; manual run on a real Android device against staging with
the gateway phone.

## 10. Rollout

1. Merge to `hardening/payments-and-audit`; deploy (`git pull` + restart) on staging.
2. Set up the gateway phone; add both env vars.
3. Update the systemd unit for the trusted proxy; `daemon-reload` and restart.
4. Build the app, sign up a test number end to end, then log out and log back in.

No data migration: UIDs are unchanged and no users can log in on staging today.

**Rollback:** redeploy the previous commit. Because UIDs are unchanged, accounts created
through reverse OTP remain valid under any later sign-in method.

## 11. Production hardening

### 11.1 Audit trail
On each successful verification the backend writes `auth_events/{autoId}`:
`{uid, phoneMasked: "+91******3210", method: "reverse_sms", isNewUser, ip, at}`.
The code is never stored. Written with the Admin SDK only. `firestore.rules` has no
catch-all match, so clients are already denied, but it gets an explicit
`match /auth_events/{id} { allow read, write: if false; }` block, following the file's
convention for server-only collections (`user_credentials`, `coin_orders`). That gives support and abuse
investigations a record to consult without keeping codes or raw numbers in logs. Cost:
one Firestore write per sign-in.

### 11.2 Logging
- Phone numbers are masked in every log line (`+91******3210`).
- Codes, session ids, signatures and the signing key are never logged.
- One structured line per outcome: `sms_verify outcome=verified|sender_mismatch|no_session|stale|bad_signature|duplicate`,
  so `journalctl -u gengal-backend | grep sms_verify` answers "why did sign-in fail".

### 11.3 Alerting (free)
Point a free uptime monitor (UptimeRobot or Better Stack free tier) at
`https://<backend-host>/api/v1/auth/sms/health` every 5 minutes, alerting by email.
It fires when the gateway phone is off, offline, out of battery, or misconfigured —
the single most likely production outage for this design. A second monitor on `/_up`
covers the server itself.

### 11.4 Capacity
- One gateway SIM comfortably handles hundreds of sign-ins a day.
- Indian prepaid plans commonly allow ~100 *outgoing* SMS a day; *incoming* is not
  capped. The gateway only receives, so that limit does not apply.
- The session store cap (10,000) and per-phone/per-IP limits bound memory and abuse.
- **The user pays for their SMS** at their operator's standard rate (free on most
  unlimited plans, roughly ₹1–1.5 without an SMS pack). The verify screen says so in one
  line, so nobody is surprised by the charge.

### 11.5 Out of scope (revisit on growth)
- A second gateway phone for redundancy. The health endpoint makes an outage visible
  within 5 minutes, which is enough for launch.
- Moving `SessionStore` to Redis, required before running more than one worker.
- A paid inbound number (§3.4).
