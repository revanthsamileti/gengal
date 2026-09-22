# Reverse-OTP sign-in by user-sent WhatsApp message — design

**Date:** 2026-09-22
**Branch:** `feature/reverse-otp-sms`
**Builds on:** [2026-09-21-reverse-otp-sms-design.md](2026-09-21-reverse-otp-sms-design.md) (§3.4 "Swapping the SMS source later")

## 1. Goal

Let a user prove their number by sending the sign-in code **on WhatsApp**, as an
alternative to sending it by SMS. Same code, same screen, same session: whichever
message arrives first signs them in.

Why:
- **Resilience.** SMS depends on one gateway phone. On 2026-09-21 it dropped off at
  17:41 UTC and sign-in was down for everyone. WhatsApp messages land on Meta's servers,
  not on that phone, so sign-in keeps working while the gateway is offline.
- **Stronger proof.** The sender number arrives from Meta in a signed webhook. It cannot
  be spoofed the way an SMS sender ID can (SMS design §5.3).
- **₹0.** Per Meta's pricing page, messages a user sends to a business are not charged,
  and non-template replies inside the 24-hour customer service window are free.

### Non-goals
- Outbound WhatsApp OTP (authentication templates). They are paid per message.
- Unofficial WhatsApp Web automation (breaks WhatsApp's terms; numbers get banned).
- Reading WhatsApp notifications on the gateway phone. A notification shows a display
  name, which anyone can set to look like a phone number, so it proves nothing.

## 2. User flow

1. Phone screen → Verify screen, unchanged entry.
2. The verify screen shows the code (`GENGAL 482913`) and, depending on what the server
   offers, **Send on WhatsApp** (primary) and/or **Send SMS**.
3. Send on WhatsApp opens `https://wa.me/<number>?text=GENGAL%20482913`: WhatsApp
   opens with the message typed. The user taps send and returns to GenGal.
4. The server gets the webhook, matches code + sender, and replies in WhatsApp
   "✅ Verified — go back to GenGal". The app's poll flips to verified.

### 2.1 WhatsApp usernames (rolling out worldwide, Sept 2026)
If a user has turned on a WhatsApp username **and** has not chatted with our number in
the last 30 days **and** is not in our Meta contact book, Meta omits their phone number
(`messages[].from` and `contacts[].wa_id`). Only a business-scoped user id (BSUID,
`from_user_id`) arrives.

For that case the server holds the code against the BSUID and replies with Meta's
`request_contact_info` interactive message ("Share phone number" button). When the user
taps it, a `contacts` message arrives with `origin: "contact_request"` and
`phones[].phone`. That phone is matched to the held code exactly as a direct message
would be. Only `origin == "contact_request"` is trusted: a manually shared contact card
(`origin: "other"`) can carry anybody's number.

The app shows "Almost done — tap Share phone number in WhatsApp" while this is pending.

## 3. Architecture

```
 App ──POST /auth/sms/start──► {sessionId, code, message, channels:["whatsapp","sms"],
                                 whatsappNumber, gatewayNumber, expiresIn}

 User ──WhatsApp "GENGAL 482913"──► Meta Cloud API
                                      │ POST /api/v1/auth/whatsapp/webhook
                                      │ X-Hub-Signature-256: sha256=HMAC(app secret, body)
                                      ▼
                                   Backend ── same SessionStore.mark_verified(code, phone)
                                      │
                                      └─► Graph API reply (background thread)

 App ──POST /auth/sms/status (every 2 s)──► pending {hint?} | verified {token}
```

The existing `/auth/sms/start` and `/auth/sms/status` routes keep their paths so
installed builds keep working; they gain fields, never lose them.

### 3.1 `backend/whatsapp_verify.py` (new, pure logic)

| Unit | Responsibility |
|---|---|
| `verify_meta_signature(raw_body, header, app_secret)` | `header == "sha256=" + hex(HMAC-SHA256(app_secret, raw_body))`, constant-time. |
| `parse_webhook(payload, phone_number_id)` | Walks `entry[].changes[]` with `field == "messages"` and `metadata.phone_number_id` equal to ours. Yields one dict per message: `{id, kind, phone, user_id, number_hidden, reply_to, text, sent_at}`. `kind` is `text`, `contact_share` (only for `origin == "contact_request"`), or `other`. `statuses` (receipts for our replies) are ignored. |
| `PendingShares` | Thread-safe BSUID → `{code, received_at}` for the username case. 10-minute TTL, 10,000 cap, `hold()` and one-shot `take()`. |
| `REPLIES` | The reply texts, one per outcome. |

`phone` is `sms_verify.normalize_in_mobile(from)`, so only `+91` mobiles can sign in,
identical to SMS.

### 3.2 `SessionStore` changes (`sms_verify.py`)
- `mark_verified(code, sender, received_at, channel="sms")` records the channel on the
  session, and on `sender_mismatch` records `hint = "sender_mismatch"`.
- `note_hint(code, hint, received_at)` → `no_session | stale | ok`. Used for
  `share_number`; applies the same stale rule as `mark_verified`.
- `info(session_id)` → `{hint, channel}` for the status route.

### 3.3 Routes

**`GET /api/v1/auth/whatsapp/webhook`** — Meta's subscription handshake. If
`hub.mode == "subscribe"` and `hub.verify_token` matches `WHATSAPP_VERIFY_TOKEN`
(constant-time), return `hub.challenge` as `text/plain` 200; otherwise 403.

**`POST /api/v1/auth/whatsapp/webhook`**
- Raw body signature check → 401 on failure (Meta retries for up to 36 h, which is right
  for a transient misconfiguration).
- Every other signed request → 200, including junk, so Meta does not retry it.
- Per message, de-duplicated on `"wa:" + message id` (Meta may deliver twice):

| Message | Action | Reply |
|---|---|---|
| text, no 6-digit code | log `no_code` | "This number only verifies GenGal sign-ins…" |
| text, code, phone present | `mark_verified(..., channel="whatsapp")` | per outcome |
| text, code, number hidden (BSUID only) | `note_hint(code, "share_number")`; on `ok` `PendingShares.hold` | Share phone number button (or expired text) |
| text, code, non-Indian number | log `unsupported_number` | "+91 mobile numbers only" |
| contact_share with a held BSUID | `mark_verified(held code, shared phone, held time, "whatsapp")` | per outcome |
| anything else | ignore | none |

Outcomes → replies: `verified` ✅; `sender_mismatch` "requested for a different number";
`no_session`/`stale` "code expired, tap Try again".

Replies are sent to `from` when present, else to `recipient: <BSUID>`. They run on a
daemon thread with a 5 s timeout so a slow Graph API can never delay the webhook
response. At most 5 replies per sender per 10 minutes, so a spammer cannot make us
flood their chat or burn throughput.

**`POST /auth/sms/start`**
- `channels` = `whatsapp` if WhatsApp is configured, plus `sms` if the SMS gateway is
  configured **and** healthy.
- 503 only when `channels` is empty: `sms_not_configured` if neither channel is
  configured, else `sms_gateway_offline` (existing codes, so old builds show the right
  message).
- `gatewayNumber` is `""` when SMS is not offered, so no build ever tells a user to text
  a dead phone.
- New fields: `channels`, `whatsappNumber`.

**`POST /auth/sms/status`**
- `pending` gains an optional `hint`: `sender_mismatch` or `share_number`.
- On `verified`, the audit event's `method` is `reverse_whatsapp` or `reverse_sms`.

**`GET /auth/sms/health`** gains `whatsapp: "configured" | "off"`. Its HTTP status still
tracks only the SMS gateway, so the uptime monitor still alerts when that phone dies.

### 3.4 App
- `smsAuthService.ts`: `SmsSession.channels?`, `whatsappNumber?`; poll `pending.hint?`.
- `VerifyBySmsScreen.tsx`:
  - **Send on WhatsApp** (WhatsApp green) opens the `wa.me` link with React Native
    `Linking.openURL`. `https` needs no Android `<queries>` entry, and without WhatsApp
    installed it falls back to the browser.
  - **Send SMS** stays. It is primary when it is the only channel, outlined otherwise.
  - "To" shows one number when both channels share it, otherwise one line per channel.
  - Hints: `sender_mismatch` → "That message came from a different number. Send it
    from the WhatsApp or SIM of +91 …"; `share_number` → "Almost done — tap Share phone
    number in WhatsApp."
  - Copy: "Waiting for your message…"; fine print "WhatsApp is free on data. SMS may
    cost your operator's standard rate."
  - A build without `channels` from an older server falls back to SMS-only behaviour.

## 4. Security

- **What proves what:** the sender number (from Meta, signed) proves the WhatsApp account
  is registered to that number; the code ties the message to this attempt; the
  `sessionId` ties the poller to the device that started it. All three are required, as
  for SMS.
- **Webhook authenticity:** `X-Hub-Signature-256` with the app secret, constant-time.
  Meta's signature has no timestamp, so replay protection comes from message-id
  de-duplication plus the existing rule that a message may not predate its session by
  more than 60 s (Meta's `timestamp` field).
- **Contact share:** only `origin == "contact_request"`, only for a BSUID we asked, one
  shot (`take()`), and it expires with the session.
- **Accepted risk:** a WhatsApp account can outlive the SIM (for example a recycled
  number whose old owner never re-registered). This is the industry-standard trust of
  WhatsApp OTP and is accepted.
- **Secrets:** `WHATSAPP_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`
  live only in `/etc/gengal/gengal.env`. Never logged.
- **Logging:** one line per outcome, `wa_verify outcome=… phone=+91******3210`. Codes,
  BSUIDs, tokens and message text are never logged.

## 5. Configuration

| Variable | Meaning |
|---|---|
| `WHATSAPP_NUMBER` | Business number shown to users, `+91…` |
| `WHATSAPP_PHONE_NUMBER_ID` | Cloud API phone number id (filters webhooks, addresses replies) |
| `WHATSAPP_APP_SECRET` | Meta app secret (webhook signatures) |
| `WHATSAPP_VERIFY_TOKEN` | Random string we choose, for the GET handshake |
| `WHATSAPP_ACCESS_TOKEN` | System-user token with `whatsapp_business_messaging` (replies) |

WhatsApp is offered only when all five are set. Until then the feature is invisible and
SMS behaves exactly as today.

## 6. Meta setup (operator, once)

Documented step by step in `docs/ORACLE_SETUP_RUNBOOK.md`: Meta developer app
(Business) + WhatsApp product; add and register a number (it cannot be on the WhatsApp
app at the same time); System User permanent token; webhook URL + verify token,
subscribed to `messages`; app switched to Live with the privacy URL
`https://gengalapp.duckdns.org/privacy`.

The SMS gateway SIM's number can also be the WhatsApp number, so users see a single
number. That is the operator's choice and needs no code.

## 7. Testing

- **Unit (`test_whatsapp_verify.py`):** signature valid / tampered / wrong secret /
  missing prefix / no secret; parse text, number hidden, contact share with
  `contact_request` vs `other`, statuses ignored, wrong `phone_number_id` ignored,
  malformed payloads; `PendingShares` TTL, cap, one-shot take.
- **Store:** channel recorded; mismatch hint; `note_hint` stale / no_session.
- **Routes (`test_whatsapp_auth_routes.py`):** handshake ok / bad token; unsigned → 401;
  full flow start → webhook → verified with `method: reverse_whatsapp` and a ✅ reply;
  wrong sender → pending + `sender_mismatch` hint + reply; duplicate message id ignored;
  stale message ignored; number hidden → share button → contact share → verified;
  `origin: other` ignored; no code → help reply; reply rate limit; start offers
  WhatsApp when the SMS gateway is offline, with `gatewayNumber == ""`; start is 503 when
  neither channel is available; health reports `whatsapp`.
- **Existing SMS tests stay green unchanged.**
- **App:** `tsc --noEmit`; on-device check once Meta setup is done.
