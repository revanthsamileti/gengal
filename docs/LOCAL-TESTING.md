# Testing against your own laptop

Runs the real backend on your machine, reachable from a real phone over the
internet, so an installed APK behaves the way it will in production.

This is the right setup while you are the only tester. The moment someone else
holds the APK, it stops working — your laptop is closed most of the day, and
their app points at a machine that isn't there. See `deploy/README.md` for that.

## Why not Expo Go

Expo Go cannot run this app in any meaningful way:

* `react-native-agora` is a native module Expo Go does not bundle, so **calls do
  not work at all**.
* `expo-notifications` is unavailable in Expo Go (`src/services/notificationService.ts:6`),
  and the FCM push is the only thing that wakes a backgrounded or killed phone
  for an incoming call (`src/hooks/useIncomingCallWatcher.ts:38`). Without it
  **nobody can receive a call** unless the app is already open on screen.

So real testing means a real build:

```bash
eas build --profile preview --platform android
```

## The URL has to be stable

`EXPO_PUBLIC_BACKEND_URL` is compiled into the APK at build time. A
`trycloudflare.com` quick tunnel gets a new hostname every restart, which
permanently breaks every APK built against the old one.

Claim ngrok's free static domain (one per account, no card) and the problem
goes away:

```bash
ngrok http 5000 --domain=your-name.ngrok-free.app
```

Then set it once, in both places:

* `.env` at the repo root: `EXPO_PUBLIC_BACKEND_URL=https://your-name.ngrok-free.app`
* `backend/.env`: `PUBLIC_BASE_URL=https://your-name.ngrok-free.app`

Rebuild the APK after changing the first one.

## Stop the laptop sleeping

A closed lid kills the server mid-test.

```bash
powercfg /change standby-timeout-ac 0
```

Also set lid-close to "Do nothing" while plugged in, under Power Options.

## Run the production server, not the dev one

Production runs waitress, so test on waitress — it is genuinely threaded, which
surfaces concurrency bugs the single-threaded Flask dev server hides.

```bash
cd backend && venv/Scripts/waitress-serve --port=5000 app:app
```

Check it before pointing a phone at it:

```bash
curl http://127.0.0.1:5000/healthz
```

## What you cannot test this way

Not laptop limitations — these are unconfigured services, and they would be
missing on a rented server too.

**Real SMS.** `TWILIO_*` is empty in `backend/.env`, so no SMS is sent. Login
works through the development bypass: the code is printed in your terminal, and
`000000` is also accepted (`backend/app.py:466`).

**Real payments.** `PAYMENT_PROVIDER` is empty, so `/api/v1/coins/order` returns
501 and top-ups are disabled. Coin *spending* and call billing are fully live —
only buying coins is off.

**Production mode.** `APP_ENV=production` makes the app refuse to boot while
`ALLOW_DEV_OTP_BYPASS` is on (`backend/app.py:2156`), and turning the bypass off
leaves you unable to log in at all without Twilio. So local runs stay in
development mode. That is correct — just know the production config guards are
not being exercised here.

Everything else is real: calls, incoming-call notifications, coin deduction,
per-15-second billing, gifting, and withdrawals.

## Daily loop

1. `cd backend && venv/Scripts/waitress-serve --port=5000 app:app`
2. `ngrok http 5000 --domain=your-name.ngrok-free.app`
3. Open the APK on your phone

Backend code changes need a restart of step 1. JS changes need a new build, or
`eas update --channel preview` to push a bundle without rebuilding.
