# A call notification that rings and stays put — design

**Date:** 2026-09-23
**Branch:** `feature/reverse-otp-sms`
**Builds on:** commit `ac25435` (Answer / Decline on the incoming-call notification)

## 1. Goal

Make an incoming call announce itself like a phone call rather than like a chat
message: it **rings for as long as the offer is live**, it **stays in the tray until
it is answered or declined**, Decline ends the call from the tray, and Answer opens
the app already answering.

### Non-goals (decided with the owner, 2026-09-23)

- **Full-screen call UI** over the lock screen (`setFullScreenIntent`), **CallStyle**
  notifications, and **Telecom / ConnectionService**. All three need a native
  dependency (notifee or react-native-callkeep). The owner chose to stay inside
  `expo-notifications` and add no library.
- iOS. The app's calling is Android-only in practice; iOS would need CallKit.
- A ring that loops forever. Android has no loop flag reachable from
  `expo-notifications`; ring length is the length of the audio file.

### What this design cannot deliver, stated plainly

On **Android 14+** an ongoing notification is dismissable by the user while the phone
is **unlocked**. Android's own behaviour-change note:

> "If your app shows non-dismissable foreground notifications to users, Android 14 has
> changed the behavior to allow users to dismiss such notifications."

It stays non-dismissable while the phone is **locked**, and it survives "Clear all" on
every version. The documented exception that would make it truly undismissable is
`CallStyle`, which `expo-notifications` cannot build. The owner accepted this.

## 2. Evidence this is buildable (verified in `expo-notifications@~56.0.22` sources)

| Need | Verified at | Result |
|---|---|---|
| Unswipeable, set by the **server** | `NotificationData.kt:36` → `ExpoNotificationBuilder.kt:101` | `data["sticky"]` → `builder.setOngoing()`. Works for remote FCM messages. |
| Answer / Decline buttons on **Android** | `ExpoNotificationBuilder.kt:113` → `addActionsToBuilder` | `data["categoryId"]` renders real action buttons. The docs call `categoryIdentifier` iOS-only; that applies to the *local* notification field, not the remote path. |
| Auto-cancel control | `NotificationData.kt:55` | `data["autoDismiss"]` → `setAutoCancel()`. |
| Full-screen intent / CallStyle / `setTimeoutAfter` | absent from `ExpoNotificationBuilder.kt` | Not reachable. Confirms the non-goals above. |
| Any audio format in `res/raw` | `plugin/build/withNotificationsAndroid.js:161` | The plugin copies by basename with no extension filter, so `.ogg` is fine. |

## 3. The bug this also fixes

`SoundResolver.resolve()` returns `Settings.System.DEFAULT_NOTIFICATION_URI` when the
named raw resource does not exist, and `NotificationChannelManagerModule.kt:49` only
**logs** an error — channel creation proceeds regardless.

The OTA published on 2026-09-23 ships JS that creates channel `calls_v3` asking for
`ringtone.wav`. That file is bundled natively and exists only in a build that has not
happened yet (the live APK `cd7ba942` predates it). So on every phone that opened
GenGal after that update:

1. `calls_v3` was created with the **plain default notification sound**.
2. Android froze it — a channel's settings cannot be changed after creation.
3. The device reported `callChannelId: calls_v3`, so the backend now posts calls there.

`calls_v3` will therefore never play the ringtone, **even after the ringtone ships**.
It is permanently poisoned on those installs. This design needs a fresh id anyway, and
adds a guard (§4.3) so the same class of mistake cannot recur.

## 4. Design

### 4.1 The ring — `assets/ringtone_long.ogg`

The current `assets/ringtone.wav` is **exactly 3.0 s** (44.1 kHz mono 16-bit, 258 KB),
and Android plays a channel's sound once. "Rings continuously" therefore means "ship a
longer file".

- ~45 s, produced by looping the existing 3 s ring with ffmpeg, so the cadence matches
  the ring GenGal already uses.
- **OGG, not WAV**: ~150 KB against ~4 MB for the same duration uncompressed.
- Filename uses an **underscore**. Android `res/raw` resource names accept only
  `[a-z0-9_]`; a hyphen fails the build.
- Added to the `expo-notifications` plugin `sounds` array in `app.json`. `ringtone.wav`
  stays listed — installs on `calls_v2`/`calls_v3` still reference it.

### 4.2 Channel `calls_v4`

Created in `registerForPushNotificationsAsync`:

- `importance: MAX`
- `sound: 'ringtone_long.ogg'`
- `vibrationPattern`: a repeating pattern spanning the ring rather than the current
  ~3.6 s burst
- `lockscreenVisibility: PUBLIC`, so the caller's name shows on a locked phone
- lights, as now

A new id is unavoidable: `calls_v3` is poisoned (§3) and channel settings freeze.

### 4.3 The guard that makes this self-correcting

After creating `calls_v4`, read it back with `getNotificationChannelAsync` and inspect
its `sound` (the serializer returns the channel's sound URI as a string —
`ExpoNotificationsChannelSerializer.java:35`).

- Sound points at the bundled resource → keep it, report `callChannelId: 'calls_v4'`.
- Anything else → this build predates the asset. **Delete `calls_v4`** and report
  `calls_v2`. The id stays clean for the build that does carry the file.

Also delete `calls_v3` when present, so upgraded phones do not keep a stale duplicate
in their system notification settings.

This converts "JS shipped ahead of native" from a silent, permanent failure into a
self-correcting one, at the cost of one extra read.

### 4.4 Sticky, and how it always gets cleaned up

The backend adds `"sticky": "true"` to **call** payloads only; messages stay swipeable.

An unswipeable notification needs a guaranteed exit, or a call that dies while the
receiver's app is closed leaves a notification nothing can remove. `setTimeoutAfter` is
not reachable, so the exit is a **replacement push**:

`POST /api/v1/calls/cancel-notify`, called by the **caller's** app immediately *before*
it clears an unanswered offer.

- Called **before** the offer is deleted, so the existing guard — the offer exists and
  its `callerUid` is the caller — still holds. Same shape as `/calls/notify`.
- **Only when the call was never picked up.** `clearCallOffer` runs on both sides and
  also after a conversation that actually happened, so an unconditional call here would
  announce a "Missed call" to someone who just finished talking to you. It fires from
  the **caller's** side only, and only while the offer's status is still `calling` —
  never after `accepted`, and never after `rejected` (a receiver who declined has
  already dismissed their own notification).
- Pushes the **same `tag=call_<roomId>`** on the quiet `messages` channel, without
  `sticky`: title "Missed call", body "<name> called you". Same tag means Android
  replaces the ringing notification rather than stacking beside it.
- Fire-and-forget: its failure must never delay or block clearing the offer.

Paths by which the notification leaves the tray, all covered:

| The call ends because | What removes the notification |
|---|---|
| Receiver taps Answer | app opens, `dismissCallNotification` |
| Receiver taps Decline | rejected from the tray, app dismisses |
| Caller gives up / offer expires | `cancel-notify` replaces it with a swipeable "Missed call" |
| Receiver opens the app later | existing dismissal on a dead offer |

### 4.5 Tap safety

`useIncomingCallWatcher` synthesises an `IncomingCall` from any notification response
carrying a `roomId`. A missed-call notification carries one too, so the response
listener is gated on `data.type === 'call'`. Otherwise tapping "Missed call" would try
to join a room that is gone.

The **dismissal** matcher keeps matching on `roomId`, which is correct: opening the app
should clear a stale missed-call notification too.

### 4.6 Channel registry

`KNOWN_CALL_CHANNELS` in `backend/push.py` gains `calls_v4`. The backend keeps posting
only to a channel the device reported, so installs on `calls_v2` are untouched.

## 5. Data flow

```
caller rings ──▶ POST /calls/notify ──▶ FCM data (sticky, categoryId, calls_v4)
                                             │
                    ┌────────────────────────┼────────────────────────┐
                    ▼                        ▼                        ▼
              tap Answer               tap Decline            caller gives up
         app opens, autoAnswer     rejectCallOffer from      POST /calls/cancel-notify
                                       the tray              same tag ──▶ "Missed call"
                                                                  (swipeable, quiet)
```

## 6. Error handling

- `cancel-notify` failing, timing out, or being refused never blocks `clearCallOffer`.
- Receiver has no push token, or is blocked, or has "Show me as online" off →
  `{ok: true, delivered: false}`, same as `/calls/notify`.
- Sound resource missing → §4.3 falls back to `calls_v2`, which rings with the system
  default rather than poisoning a new id.
- Channel read-back throwing (older devices, web) → treat as "cannot verify" and fall
  back, rather than reporting a channel that may be wrong.

## 7. Testing

**Backend (pytest, existing `fake_firestore`)**
- a call payload carries `sticky: "true"`; a message payload does not
- `cancel-notify`: 403 when the caller is not the offer's `callerUid`; 403 when no
  offer exists; rate limited; payload carries the same tag as the ringing push and no
  `sticky`; honours `pushReachable` / blocked / `isActiveMode` exactly as `/notify`

**On device (adb)**
- `dumpsys notification` shows the call notification with the ongoing flag and channel
  `calls_v4`
- the ring lasts ~45 s, not 3 s
- caller cancels → the ringing notification becomes a swipeable "Missed call"
- tapping "Missed call" opens the app without trying to join a dead room

## 8. Build and rollout

This splits cleanly in two, and the halves ship at different speeds:

- **Backend only, live immediately, no build and no OTA:** `sticky` on the call payload
  and the whole `cancel-notify` / "Missed call" mechanism. These are properties of the
  push, so every install already out there — including ones on `calls_v2` — gets the
  unswipeable call notification as soon as the server is deployed.
- **Needs a new EAS build:** the 45 s ring, because the audio is bundled natively, and
  with it `calls_v4` and the §4.3 guard.

Per the established rule, republish the OTA **after** the build finishes, so the
update's `createdAt` outranks the build's embedded bundle.

Until that build is installed, §4.3 keeps phones on `calls_v2`: they ring with the
system default sound and keep Answer/Decline, which is no worse than today.
