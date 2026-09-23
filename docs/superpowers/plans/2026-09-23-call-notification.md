# Call notification that rings and stays put — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An incoming call rings for ~45 s, cannot be swiped away, is declined or answered from the tray, and always has a way to leave the tray when the call dies.

**Architecture:** Three independent layers. The backend marks the call push `sticky` and gains a `cancel-notify` endpoint that replaces the ringing notification with a swipeable "Missed call" on the same tag. The app calls that endpoint before it clears an unanswered offer. Separately, a new Android channel `calls_v4` carries a 45-second ring, created behind a read-back guard so a JS-only update can never poison the channel id again.

**Tech Stack:** Python/Flask + firebase-admin (backend), Expo SDK 56 + `expo-notifications` (app), pytest with `fake_firestore`, ffmpeg for the audio asset.

## Global Constraints

- **No new npm or Python dependency.** The owner chose to stay inside `expo-notifications`; notifee and react-native-callkeep are out of scope.
- **FCM data values must all be strings.** `push.expo_data` builds the map; booleans become `"true"` / omitted, never Python `True`.
- **Android channel settings freeze on creation.** Never "fix" a channel in place — a behaviour change means a new id.
- **Android `res/raw` resource names accept only `[a-z0-9_]`.** `ringtone_long.ogg`, never `ringtone-long.ogg`.
- **Backend changes reach every install immediately; app changes do not.** Tasks 1–3 need only a deploy. Task 5 needs an EAS build.
- Spec: `docs/superpowers/specs/2026-09-23-call-notification-design.md`.

---

### Task 1: The call notification cannot be swiped away

**Files:**
- Modify: `backend/push.py` (the `expo_data` signature, `KNOWN_CALL_CHANNELS`)
- Modify: `backend/app.py` (inside `notify_incoming_call`, the `push.expo_data(...)` call)
- Test: `backend/tests/test_push.py`, `backend/tests/test_push_routes.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `push.expo_data(title, message, data, channel_id, tag=None, category_id=None, sticky=False) -> dict[str, str]`. Task 2 calls it without `sticky`.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/test_push.py`:

```python
def test_a_notification_is_swipeable_unless_asked_otherwise():
    assert "sticky" not in push.expo_data("Title", "Body", {}, "messages")


def test_sticky_is_sent_as_a_string_because_fcm_rejects_booleans():
    data = push.expo_data("Title", "Body", {}, "calls_v4", sticky=True)
    assert data["sticky"] == "true"
    assert all(isinstance(v, str) for v in data.values())
```

In `backend/tests/test_push_routes.py`, at the end of the `# --- calls ---` section:

```python
def test_a_ringing_call_cannot_be_swiped_away(client, store, sent):
    call(client)

    assert sent[0][2]["sticky"] == "true"


def test_a_message_can_still_be_swiped_away(client, store, sent):
    message(client)

    assert "sticky" not in sent[0][2]
```

- [ ] **Step 2: Run them to verify they fail**

```bash
cd backend && python -m pytest tests/test_push.py tests/test_push_routes.py -q
```

Expected: FAIL — `TypeError: expo_data() got an unexpected keyword argument 'sticky'` and `KeyError: 'sticky'`.

- [ ] **Step 3: Add the parameter**

In `backend/push.py`, change the signature and add the key. Also register the new channel id, so the backend already knows it before any phone reports it:

```python
KNOWN_CALL_CHANNELS = (CALL_CHANNEL, "calls_v3", "calls_v4")
```

```python
def expo_data(title, message, data, channel_id, tag=None, category_id=None, sticky=False):
    """The FCM data map for a notification expo-notifications will display.

    Every value is a string, because FCM rejects anything else. There is no
    `sound` key on purpose: its value names a custom sound file bundled in the
    app, and 'default' is not one -- that mistake once created the call channel
    with no sound at all. Without the key the channel's own sound plays.

    `sticky` makes the notification unswipeable (Android setOngoing). It is for
    calls only: a call that is still ringing must not be flicked away by
    accident. Whatever sets it must also guarantee a way for the notification
    to leave the tray -- see /api/v1/calls/cancel-notify.
    """
    out = {
        "title": str(title),
        "message": str(message),
        "body": json.dumps(data),
        "channelId": channel_id,
    }
    if tag:
        out["tag"] = str(tag)
    if category_id:
        out["categoryId"] = str(category_id)
    if sticky:
        out["sticky"] = "true"
    return out
```

In `backend/app.py`, in `notify_incoming_call`, add the argument to the existing call:

```python
            push.call_channel_for(private_data),
            tag=f"call_{room_id}",
            category_id=push.CALL_CATEGORY,
            sticky=True,
        )
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd backend && python -m pytest tests/test_push.py tests/test_push_routes.py -q
```

Expected: PASS, no regressions.

- [ ] **Step 5: Commit**

```bash
git add backend/push.py backend/app.py backend/tests/test_push.py backend/tests/test_push_routes.py
git commit -m "A ringing call cannot be swiped away"
```

---

### Task 2: A dead call turns into a swipeable "Missed call"

**Files:**
- Modify: `backend/app.py` (new route after `notify_incoming_call`)
- Test: `backend/tests/test_push_routes.py`

**Interfaces:**
- Consumes: `push.expo_data(...)` from Task 1; existing `deliver_push(receiver_uid, private_data, data, ttl_seconds) -> bool`, `blocked_by(private_data, uid) -> bool`, `display_name(db_client, uid) -> str`, `require_bearer_uid() -> (uid, error_response)`, `rate_limited(key, limit, window) -> bool`.
- Produces: `POST /api/v1/calls/cancel-notify`, body `{"receiverUid": str, "roomId": str}` → `200 {"ok": true, "delivered": bool}`, `400` missing field, `403` not your live offer, `429` rate limited. Task 3 calls it.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_push_routes.py`:

```python
def cancel(client):
    return client.post("/api/v1/calls/cancel-notify", json={"receiverUid": PEER, "roomId": "room_1"})


def test_a_missed_call_replaces_the_ringing_notification(client, store, sent):
    r = cancel(client)

    assert r.status_code == 200 and r.get_json()["delivered"] is True
    (transport, token, data, ttl), = sent
    # Same tag is the whole mechanism: Android replaces the sticky notification
    # instead of stacking a second one beside it.
    assert data["tag"] == "call_room_1"
    assert data["channelId"] == push.MESSAGE_CHANNEL
    assert "sticky" not in data
    assert data["title"] == "Missed call"
    assert json.loads(data["body"])["type"] == "call_missed"


def test_only_the_caller_can_announce_a_missed_call(client, store, sent):
    store["incoming_calls/%s" % PEER]["callerUid"] = "someoneElse03"

    assert cancel(client).status_code == 403
    assert sent == []


def test_no_offer_means_nothing_to_replace(client, store, sent):
    del store["incoming_calls/%s" % PEER]

    assert cancel(client).status_code == 403
    assert sent == []


def test_a_call_that_was_picked_up_is_not_a_missed_call(client, store, sent):
    store["incoming_calls/%s" % PEER]["status"] = "accepted"

    r = cancel(client)

    assert r.status_code == 200 and r.get_json()["delivered"] is False
    assert sent == []


def test_a_declined_call_is_not_a_missed_call(client, store, sent):
    store["incoming_calls/%s" % PEER]["status"] = "rejected"

    assert cancel(client).get_json()["delivered"] is False
    assert sent == []


def test_a_blocked_caller_cannot_announce_a_missed_call(client, store, sent):
    store["user_private/%s" % PEER]["blockedUids"] = [ME]

    assert cancel(client).get_json()["delivered"] is False
    assert sent == []
```

- [ ] **Step 2: Run them to verify they fail**

```bash
cd backend && python -m pytest tests/test_push_routes.py -q
```

Expected: FAIL — 404 from Flask, because the route does not exist.

- [ ] **Step 3: Add the route**

In `backend/app.py`, immediately after `notify_incoming_call`:

```python
@app.route('/api/v1/calls/cancel-notify', methods=['POST', 'OPTIONS'])
def notify_missed_call():
    """Replaces a ringing call notification with a swipeable "Missed call".

    The ringing notification is posted sticky, so it cannot be swiped away.
    That is the point while a call is live, and a trap once it is not: a call
    that dies while the receiver's app is closed would leave a notification
    nothing on the phone can remove. Android replaces a notification that
    carries the same tag, so this posts the same tag without sticky.

    The live offer is the caller's proof of standing, which is why the app
    calls this *before* it deletes the offer.
    """
    if request.method == 'OPTIONS':
        return '', 200

    uid, error_response = require_bearer_uid()
    if error_response:
        return error_response

    data = request.json or {}
    receiver_uid = data.get('receiverUid')
    if not receiver_uid:
        return jsonify({"error": "Missing receiverUid"}), 400
    if receiver_uid == uid:
        return jsonify({"ok": True, "delivered": False}), 200

    if rate_limited(f"notify:{uid}", 30, 300):
        return jsonify({"error": "Too many call notifications"}), 429

    try:
        db_client = firestore.client()

        offer_snap = db_client.collection('incoming_calls').document(receiver_uid).get()
        offer = (offer_snap.to_dict() or {}) if offer_snap.exists else {}
        if not offer or offer.get('callerUid') != uid:
            return jsonify({"error": "No active call offer for this receiver"}), 403

        # Picked up, or already declined: the receiver's own app has dealt with
        # the notification, and "Missed call" would simply be untrue.
        if offer.get('status', 'calling') != 'calling':
            return jsonify({"ok": True, "delivered": False}), 200

        private_snap = db_client.collection('user_private').document(receiver_uid).get()
        private_data = (private_snap.to_dict() or {}) if private_snap.exists else {}
        # A blocked caller never rang, so there is nothing of theirs to replace
        # -- and without this check the endpoint would hand them a way to put a
        # notification on a phone that blocked them.
        if blocked_by(private_data, uid):
            return jsonify({"ok": True, "delivered": False}), 200

        # Deliberately not gated on isActiveMode. Cleaning up a notification
        # that is already on the phone has to work even if presence was turned
        # off after it arrived, or the sticky one would be stranded.
        caller_name = display_name(db_client, uid)
        room_id = offer.get('roomId')
        payload = push.expo_data(
            "Missed call",
            f"{caller_name} called you",
            {
                "type": "call_missed",
                "roomId": room_id,
                "callerUid": uid,
                "callerName": caller_name,
            },
            push.MESSAGE_CHANNEL,
            tag=f"call_{room_id}",
        )
        delivered = deliver_push(receiver_uid, private_data, payload, push.MESSAGE_TTL_SECONDS)
        return jsonify({"ok": True, "delivered": delivered}), 200
    except Exception as e:
        print(f"[CALLS] Missed-call notify error: {e}")
        return jsonify({"error": "Failed to deliver notification"}), 500
```

- [ ] **Step 4: Run the whole backend suite**

```bash
cd backend && python -m pytest -q
```

Expected: PASS, including the six new tests.

- [ ] **Step 5: Commit**

```bash
git add backend/app.py backend/tests/test_push_routes.py
git commit -m "Replace a dead call's notification with a missed call"
```

---

### Task 3: The app announces the missed call before clearing the offer

**Files:**
- Modify: `src/services/liveRoomService.ts` (new helper beside `notifyIncomingCall` at line 231; `clearCallOffer` at line 434)

**Interfaces:**
- Consumes: `POST /api/v1/calls/cancel-notify` from Task 2; existing `CallRef { callerUid: string; roomId: string }`.
- Produces: no new exports. `clearCallOffer(receiverUid, call)` keeps its signature and its behaviour; it simply tells the server first.

- [ ] **Step 1: Add the helper**

In `src/services/liveRoomService.ts`, directly below `notifyIncomingCall` (which ends at line 248), add:

```ts
/**
 * How long we will wait for the missed-call push before giving up and deleting
 * the offer anyway. Deleting the offer is what actually ends the call for both
 * sides, so it must never be held hostage by a slow network.
 */
const MISSED_CALL_TIMEOUT_MS = 2500;

/**
 * Asks the server to turn the receiver's ringing notification into a swipeable
 * "Missed call".
 *
 * Only the caller may do this, and only while the offer is still live -- the
 * server proves both from the offer document, which is why this runs *before*
 * clearCallOffer deletes it. Whether the call was actually picked up is the
 * server's decision too (it reads `status`), so this does not try to guess.
 *
 * Never throws: a failure here costs a tidy notification, not a call.
 */
const announceMissedCall = async (receiverUid: string, call: CallRef) => {
  const [{ auth }, { getBackendUrl }] = await Promise.all([
    import('../config/firebase'),
    import('./authService'),
  ]);
  const user = auth.currentUser;
  // The receiver clears their own slot too; only the caller has a notification
  // on someone else's phone to clean up.
  if (!user || user.uid !== call.callerUid) return;

  const idToken = await user.getIdToken();
  await fetch(`${getBackendUrl()}/api/v1/calls/cancel-notify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ receiverUid, roomId: call.roomId }),
  });
};
```

- [ ] **Step 2: Call it from `clearCallOffer`**

Change the opening of `clearCallOffer` (line 434) from:

```ts
export const clearCallOffer = async (receiverUid: string, call: CallRef) => {
  const callRef = doc(db, 'incoming_calls', receiverUid);
```

to:

```ts
export const clearCallOffer = async (receiverUid: string, call: CallRef) => {
  // Before the delete, because the live offer is what proves to the server
  // that this caller may touch that receiver's notification. Bounded, and it
  // swallows its own failures: the delete below is what ends the call.
  await Promise.race([
    announceMissedCall(receiverUid, call).catch(() => {}),
    new Promise<void>((resolve) => setTimeout(resolve, MISSED_CALL_TIMEOUT_MS)),
  ]);

  const callRef = doc(db, 'incoming_calls', receiverUid);
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/services/liveRoomService.ts
git commit -m "Tell the receiver's phone the call is over"
```

---

### Task 4: A missed-call notification is not a call to join

**Files:**
- Modify: `src/hooks/useIncomingCallWatcher.ts` (`callFromNotificationData`, around line 123)

**Interfaces:**
- Consumes: the `{"type": "call_missed", ...}` payload from Task 2.
- Produces: nothing new.

- [ ] **Step 1: Add the guard**

`callFromNotificationData` accepts anything carrying `roomId` and `callerUid`, and a missed-call notification carries both — so tapping "Missed call" would try to join a room that no longer exists. Change its opening from:

```ts
    const callFromNotificationData = (data: any): IncomingCall | null => {
      if (!data?.roomId || !data?.callerUid) return null;
```

to:

```ts
    const callFromNotificationData = (data: any): IncomingCall | null => {
      // A "Missed call" notification carries the same roomId and callerUid as
      // the ringing one it replaced. Without this, tapping it would navigate
      // into a call that is already over.
      if (data?.type && data.type !== 'call') return null;
      if (!data?.roomId || !data?.callerUid) return null;
```

Leave `dismissCallNotification`'s matcher (`data?.type === 'call' || !!data?.roomId`) alone — clearing a stale missed-call notification when the app opens is wanted.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useIncomingCallWatcher.ts
git commit -m "Do not answer a call that was already missed"
```

---

### Task 5: A 45-second ring on a channel that cannot be poisoned

**Files:**
- Create: `assets/ringtone_long.ogg`
- Modify: `app.json` (the `expo-notifications` plugin `sounds` array)
- Modify: `src/services/notificationService.ts` (`RINGING_CALL_CHANNEL_ID` and channel creation)

**Interfaces:**
- Consumes: `KNOWN_CALL_CHANNELS` already containing `"calls_v4"` from Task 1.
- Produces: `RINGING_CALL_CHANNEL_ID = 'calls_v4'`; `registerForPushNotificationsAsync` saves `user_private.callChannelId` as either `'calls_v4'` or `'calls_v2'`, never an id whose sound is wrong.

- [ ] **Step 1: Build the ring**

The existing `assets/ringtone.wav` is exactly 3.0 s, and Android plays a channel sound once. Loop it 15× for 45 s and encode as OGG (~150 KB; the same as WAV would be ~4 MB):

```bash
ffmpeg -y -stream_loop 14 -i assets/ringtone.wav -c:a libvorbis -b:a 48k -ac 1 -ar 44100 assets/ringtone_long.ogg
```

Verify duration and size — expect ~45 s and well under 300 KB:

```bash
ffprobe -v error -show_entries format=duration,size -of default=noprint_wrappers=1 assets/ringtone_long.ogg
```

If `libvorbis` is unavailable, re-run with `-c:a libopus` (Android supports Ogg Opus from API 21). Do **not** fall back to WAV without saying so — it costs ~4 MB of APK.

- [ ] **Step 2: Bundle it**

In `app.json`, extend the `expo-notifications` plugin's `sounds` array so it lists both files. `ringtone.wav` stays: installs still on `calls_v2`/`calls_v3` reference it.

```json
[
  "expo-notifications",
  {
    "sounds": ["./assets/ringtone.wav", "./assets/ringtone_long.ogg"]
  }
]
```

Keep any other keys already present in that plugin entry unchanged.

- [ ] **Step 3: Point the app at `calls_v4`, behind a guard**

In `src/services/notificationService.ts`, replace the `RINGING_CALL_CHANNEL_ID` declaration and its comment with:

```ts
/**
 * The call channel that rings with the app's own ringtone rather than a single
 * notification blip. Android takes an incoming call's sound from its channel
 * and freezes a channel's settings once created, so a ringing channel can only
 * ever be a new one -- hence the version suffix.
 *
 * v3 is burnt. It was created by a JS-only update, before any build carried
 * `ringtone.wav`, and expo-notifications' SoundResolver silently substitutes
 * the system default when a raw resource is missing. Those installs froze the
 * channel with the default sound and can never be repaired. `ensureRingingChannel`
 * below makes sure v4 cannot go the same way.
 */
export const RINGING_CALL_CHANNEL_ID = 'calls_v4';

/** Bundled natively by the expo-notifications plugin; see app.json. */
const RINGTONE_FILE = 'ringtone_long.ogg';
/** Android drops the extension: the channel's sound URI ends in /raw/<this>. */
const RINGTONE_RESOURCE = 'ringtone_long';
/** Poisoned as described above; deleted so it stops cluttering system settings. */
const RETIRED_CALL_CHANNEL_ID = 'calls_v3';

/**
 * Vibrates for the length of the ring instead of the ~3.6 s burst a
 * notification gets. First entry is the delay before the first buzz.
 */
const RING_VIBRATION: number[] = [0];
for (let i = 0; i < 22; i++) RING_VIBRATION.push(1000, 1000);
```

Then add, above `registerForPushNotificationsAsync`:

```ts
/**
 * Creates the ringing channel and proves it actually rings.
 *
 * A channel whose sound file is missing is not rejected -- Android stores the
 * system default instead, permanently, because channel settings freeze. That is
 * how `calls_v3` was lost. So the channel is read back and its sound checked;
 * if this build does not carry the ringtone, the channel is deleted and the
 * phone reports the plain call channel instead. The id stays clean for the
 * build that does carry it.
 *
 * Returns the channel id the backend should actually post calls to.
 */
async function ensureRingingChannel(): Promise<string> {
  try {
    await Notifications.setNotificationChannelAsync(RINGING_CALL_CHANNEL_ID, {
      name: 'Incoming calls (ringing)',
      importance: Notifications.AndroidImportance.MAX,
      sound: RINGTONE_FILE,
      vibrationPattern: RING_VIBRATION,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      lightColor: '#FF231F7C',
    });

    const channel = await Notifications.getNotificationChannelAsync(RINGING_CALL_CHANNEL_ID);
    const sound = typeof channel?.sound === 'string' ? channel.sound : '';
    if (sound.includes(RINGTONE_RESOURCE)) {
      await Notifications.deleteNotificationChannelAsync?.(RETIRED_CALL_CHANNEL_ID);
      return RINGING_CALL_CHANNEL_ID;
    }

    console.warn('[NotificationService] This build has no ringtone; staying on the plain call channel.');
    await Notifications.deleteNotificationChannelAsync?.(RINGING_CALL_CHANNEL_ID);
    return CALL_CHANNEL_ID;
  } catch (e) {
    // Could not verify -- reporting a channel that may be silent is worse than
    // reporting the one every build has.
    console.warn('[NotificationService] Ringing channel check failed:', e);
    return CALL_CHANNEL_ID;
  }
}
```

- [ ] **Step 4: Use it**

Inside `registerForPushNotificationsAsync`, in the `Platform.OS === 'android'` block, delete the existing `setNotificationChannelAsync(RINGING_CALL_CHANNEL_ID, …)` call and capture the verified id instead. The variable must be declared before the block so the token write can read it:

```ts
    let callChannelId = CALL_CHANNEL_ID;
    if (Platform.OS === 'android') {
      // ... the existing CALL_CHANNEL_ID and MESSAGE_CHANNEL_ID channels stay as they are ...
      callChannelId = await ensureRingingChannel();
    }
```

Then change the token write from `callChannelId: RINGING_CALL_CHANNEL_ID` to the verified value:

```ts
      await savePrivateUserData(userId, { fcmToken, callChannelId });
```

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add assets/ringtone_long.ogg app.json src/services/notificationService.ts
git commit -m "Ring for forty-five seconds, on a channel that cannot be poisoned"
```

---

### Task 6: Ship it

**Files:** none — deployment only.

**Interfaces:**
- Consumes: Tasks 1–5, all committed.

- [ ] **Step 1: Confirm the suite is green**

```bash
cd backend && python -m pytest -q
```

Expected: every test passes (293 before this plan, plus 8 new).

- [ ] **Step 2: Deploy the backend**

This makes the sticky notification and the missed-call replacement live on **every phone already installed**, with no build and no OTA, because both are properties of the push. Follow the deploy procedure in `docs/ORACLE_SETUP_RUNBOOK.md`: bundle the new commits, fetch and reset on the server, `chown -R gengal:gengal /opt/gengal`, then `systemctl restart gengal-backend`.

Ask the owner before touching the production server — the auto-mode classifier requires them to name it.

- [ ] **Step 3: Verify the deploy**

```bash
curl -s https://gengalapp.duckdns.org/_up
```

Expected: `{"status":"ok"}`.

- [ ] **Step 4: Start the EAS build**

The 45 s ring is a native asset, so it needs a build:

```bash
npx eas build --platform android --profile preview
```

- [ ] **Step 5: Republish the OTA after the build finishes**

The app runs whichever bundle has the newest `createdAt`, so an update published while the build ran would be outranked by the build's embedded bundle:

```bash
npx eas update --channel preview --message "Calls that ring and stay put"
```

`EXPO_PUBLIC_BACKEND_URL=https://gengalapp.duckdns.org` must be set in the shell, or the bundle ships with no backend URL.

- [ ] **Step 6: Verify on a phone**

Install the new APK on both phones, then with the receiver's app **swiped away**:

```bash
adb shell dumpsys notification --noredact | grep -A4 GenGal
```

Check: channel is `calls_v4`, flags include `FLAG_ONGOING_EVENT`, the ring lasts ~45 s, Answer and Decline both appear. Then have the caller give up without the receiver answering, and confirm the ringing notification becomes a swipeable "Missed call" — and that tapping it does not open a call screen.

---

## Self-Review

**Spec coverage:** §4.1 ring → Task 5 Step 1–2. §4.2 channel → Task 5 Step 3. §4.3 guard → Task 5 Step 3–4. §4.4 sticky → Task 1; cancel-notify → Task 2; client trigger and the "only while still calling" rule → Task 2 Step 3 (server-side `status` check) and Task 3. §4.5 tap safety → Task 4. §4.6 registry → Task 1 Step 3. §7 tests → Tasks 1, 2 and Task 6 Step 6. §8 rollout → Task 6.

**One deliberate deviation from the spec:** the spec put "only while the offer's status is still `calling`" on the client. The plan puts it on the **server** (Task 2, Step 3), because the server already reads the offer document — so the client needs no extra read, and there is no window in which the client's view of `status` is stale.

**Type consistency:** `expo_data(..., sticky=False)` defined in Task 1 is called with no `sticky` in Task 2 and with `sticky=True` in Task 1. `CallRef { callerUid, roomId }` is used as defined at `liveRoomService.ts:63`. `RINGING_CALL_CHANNEL_ID`, `CALL_CHANNEL_ID` and `callChannelId` match the existing names in `notificationService.ts`. The channel id string `"calls_v4"` is identical in `push.py` (Task 1) and `notificationService.ts` (Task 5).
