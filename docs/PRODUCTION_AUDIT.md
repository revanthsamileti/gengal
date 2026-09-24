# GenGal — Production Readiness Audit

Audit of all 29 screens and shared components (~23k lines) for production-level UI/UX.
Every finding below was verified by reading source, not inferred.

**Status legend:** ✅ fixed in this pass · ⬜ open

---

## Live device pass (2026-08-02)

### ✅ `ConnectingOverlay` was untappable on Android — matchmaking and outgoing calls could not be cancelled
Verified live on a physical device (not just static review). `ConnectingOverlay` (shown while
searching for a random match in `HomeScreen`/`PersonalScreen`, and while an outgoing call is
ringing/connecting in `CallScreen`, both voice and video) was rendered as a plain absolutely
positioned `View` with `zIndex: 9999`, declared *before* its sibling `ScrollView`/content in JSX.
On Android, `zIndex` only affects paint order, not touch-dispatch order — the later-declared
sibling still received touches first. Result: the Cancel button was completely unresponsive.
Reproduced 7+ times on-device (plain tap, double tap, held tap) with correct coordinates
confirmed via `uiautomator`; ruled out coordinate error and the custom router double-rendering
before concluding this was a real touch-dispatch bug. For `CallScreen` this meant a user placing
an outgoing call had no way to cancel it from the UI before the 45s ring timeout — only a force-
quit escaped it, and state persisted across backgrounding.
**Fix:** `src/components/ConnectingOverlay.tsx` now renders its content inside a native
`<Modal transparent>`, which always wins touch dispatch on both platforms. Fixes all four call
sites (`HomeScreen`, `PersonalScreen`, `CallScreen` voice, `CallScreen` video) from one change.
Re-verified live: Cancel now dismisses immediately.

### Verified working live (no code change needed)
- `CustomAlert` dialogs render correctly on-device (confirmed via the Ludo "waiting for players" alert).
- Ludo room creation deducts coins correctly (10,000 → 9,990) and cleans up the room on leave.
- Hardware back navigation works correctly from Chill back to Home.

## Ship-blockers (all fixed)

### ✅ `CustomAlert` was never mounted — every error dialog was invisible
`src/components/CustomAlert.tsx` exported the component, but nothing rendered it. Eight screens
imported its `Alert` API (AdminPanel, Chill, Coins, Earnings, LudoBoard, Ludo, ProfileDetails,
Settings), so `customAlertRef` stayed `null` and every call fell through to `console.warn`.

On a device that meant total silence for: "insufficient coins", "could not save settings",
"could not delete account", "failed to log out". Users saw failures as nothing happening at all.

Fixed: mounted `<CustomAlert />` at the app root in `App.tsx`. The fallback no longer auto-invokes
`buttons[0].onPress()` (it was executing actions the user never confirmed) and now defers to the
platform dialog. Also removed two reads of Animated's private `._value`, which break under Fabric.

### ✅ Withdraw button fabricated a financial confirmation
`EarningsScreen.tsx` told users *"Your withdrawal of ₹X has been submitted. Processing within 24
hours."* and made **no network call and no write of any kind**. No payout endpoint exists anywhere
in `backend/`. Combined with the bug above, tapping Withdraw did visibly nothing while the user
believed money was on its way.

Fixed: added `src/services/withdrawalService.ts` writing a real `withdrawalRequests` document
(pending, server timestamp), copy changed to "Request submitted for review", button disabled while
in flight. Firestore rules let a user file and read their own request but never update `status`.

### ✅ Debug button shipped to production
`ActiveConnectsScreen.tsx` rendered a bright-red **"TEST CALL RINGING UI"** button that started a
video call against `uid: 'test_target_uid'`. Deleted.

### ✅ Call buttons on Profile and Chat were entirely broken
Both passed `isCaller: true` with **no `matchData`**, and `CallScreen` rejects that outright
("This profile cannot be called right now") — so every call started from a profile page or a chat
header failed. Root cause: both screens dropped `uid` when building their local `profile` object.

Fixed: `uid` now carried through, `matchData` passed, and the buttons disable themselves when no
uid is available instead of pretending to work.

### ✅ Video calls billed at 2× for audio-only
Remote video renders only under Agora. When the waterfall fell back to zegocloud — which has no
video support in this codebase at all — the call continued as audio while the backend kept charging
`videoCallRatePerMin` (the server bills off `calls/{roomId}.mode`).

Fixed: falling off Agora during a video call now downgrades the call record to `mode: 'call'`, so
the server charges the voice rate, and both sides are told the call switched to voice.

### ✅ Unanswered outbound calls rang forever
For the caller, `isConnecting` never clears while the peer hasn't accepted, which disables both the
10s peer timeout and the heartbeat watchdog. A call to an unreachable user rang indefinitely until
manually cancelled. Fixed with an explicit 45s ring timeout.

### ✅ Double-tap fired paid actions twice
15 `navigate('Call', …)` sites across 7 screens had no in-flight guard, as did the coin-spending
controls in Chill, LudoBoard, ExpertRoom and DumCharades.

Fixed with one shared hook, `src/hooks/useActionLock.ts`. It uses a synchronous ref (a `useState`
boolean re-renders too late to block the second tap) plus a short cooldown, which matters because
`navigate()` returns immediately and would otherwise unlock before the second tap lands.

### ✅ Other CallScreen defects
- Video back button called `goBack()` directly, skipping `closeCallRecord` and leaving the call
  record open. Now routed through the guarded end-call path.
- `more-vert` button had no `onPress` at all. Removed.
- 9 raw `alert()` calls (a web API) replaced with the app's own dialog.
- `age: matchData.age || '24'` displayed a **fabricated age** for every user missing one. Now shown
  only when real.
- `PREMIUM` was hardcoded on every video call regardless of tier. Removed.
- Gift button transferred 100 coins on a single tap with no confirmation. Now confirms first.

### ✅ Seeded demo profiles were callable
`PersonalScreen` ships six hardcoded profiles (Elena, Sophia, Aanya, Chloe, Meera, Valeria) with
Unsplash photos and fake uids like `ref_elena`, mixed in with real users. Calling one started a
paid call to an account that does not exist.

Per your decision they stay (so the grid never looks empty) but are now flagged
`isSampleProfile`, labelled **"Sample profile — not callable"**, and blocked at the single
`launchCall` chokepoint every entry point goes through.

---

## Second pass (all fixed)

### ✅ AdminPanel had no client-side gate and no confirmation
The backend does enforce `require_admin_uid()`, so writes were never actually open — but the screen
rendered the full pricing form to anyone who reached it, and `navigate('AdminPanel')` is callable
from anywhere. Worse, "Deploy Changes" wrote immediately with no confirmation, changing pricing for
every user with no undo.

Fixed: the screen now verifies with the existing `checkIsAdmin()` before rendering anything and
shows a restricted notice otherwise. Deploy now lists each changed field and its new value in a
confirmation dialog before writing.

### ✅ Non-Indian phone numbers could never sign up
A flat `phone.length === 10` rule gated the continue button. A UAE number is 9 digits, so those
users could never reach the threshold — the numpad also stopped accepting input at 10, so longer
German numbers were truncated.

Fixed: `COUNTRY_CODES` now carries real per-country `min`/`max` national-number lengths, and the
input limit, continue button, and web Enter-key handler all derive from the selected country.
Switching country trims any excess digits so the field can't sit over the new limit.

### ✅ Incoming call was invisible to screen readers
Accept and reject were icon-only with no labels — on a decision the user has seconds to make.
Both now carry labels naming the caller and call type, and the banner announces itself via
`accessibilityLiveRegion`.

Also fixed a real rendering gap found here: `callerAvatarData` was being dropped, so every user with
a generated avatar showed a generic person icon. The overlay now renders `GengalAvatar` (which was
imported but unused).

### ✅ Language preference was discarded
"SAVE PREFERENCES" performed no save of any kind and always defaulted to English, ignoring any
existing choice. Added `src/services/languageService.ts`: writes to AsyncStorage always (so
onboarding survives a restart) and to the user profile once an account exists. The screen now
preselects the stored value, shows a saving state, surfaces failures, and exposes selection state
to screen readers.

---

## Third pass (all fixed)

### ✅ ChatScreen destroyed messages on send failure
`setDraft('')` ran before the await, and the `!chatId` guard sat *after* it — so a missing chat id
silently wiped what the user typed and sent nothing. A network failure did the same, leaving only a
`console.error`.

Fixed: validation moved ahead of the clear, the draft is restored on failure, and the user is told
the message did not send. The dead "+" attachment button (no handler, no feature behind it) was
removed, and Android now gets `behavior="height"` so the keyboard stops covering the composer.

### ✅ OTP could not be autofilled or pasted
The code display was a `<Text>`, so SMS autofill and paste were impossible on the screen with the
highest drop-off in the funnel. It is now a real `TextInput` with `textContentType="oneTimeCode"`
and `autoComplete="sms-otp"` — tapping the field gives autofill, paste and the system keyboard,
while the custom numpad still drives the same state. Numpad keys are labelled.

Also fixed the resend race: the button checked only the cooldown timer, so a resend could fire
while a verify was still in flight, racing two auth requests.

### ✅ Password managers were never offered a chance to fill
None of the three password fields carried `textContentType` or `autoComplete`, so no manager
offered to fill or save. Added across `LoginPassword`, `CreatePassword` and `ForgotPassword`, with
return-key submit, focus advance between fields, larger `hitSlop` on the eye toggles and labels
describing show/hide state. Create-account is now disabled until both fields have content.

`ForgotPasswordScreen` also swallowed its auto-send failure — users waited indefinitely for a code
that was never sent. The error now surfaces on screen.

### ✅ Keyboard covered form fields
`CoinsScreen` and `ProfileDetailsScreen` are now wrapped in `KeyboardAvoidingView` (`height` on
Android, `padding` on iOS), with `keyboardShouldPersistTaps="handled"` so the first tap after
typing registers. `ProfileDetailsScreen` gained focus chaining and correct keyboard types.

### ✅ More inert controls removed
- `ProfileScreen` Followers/Following were `TouchableOpacity` with no handler and no list to open —
  now plain `View`s.
- The heart icon shown on other people's profiles was a button whose handler did nothing; it is now
  rendered only for the owner, as a settings button.
- `AvatarScreen` save error was swallowed to console; it now surfaces, and the button is guarded
  against double-submit.

---

---

## Fourth pass — production hardening (2026-08-05)

### ✅ VIP was awarded for uploading a photo
`tier` was derived as `avatarUrl ? 'VIP' : 'Advance'` in seven places (`userService`
×3, `HomeScreen`, `ProfileScreen`, `MatchScreen`, `ActiveConnectsScreen`, `SettingsScreen`,
`PersonalScreen`). VIP is the paid tier, so anyone who set a picture was shown with the badge
real subscribers pay for — and the "VIP only" filter on Home plus the entire Celebs page were
selecting on `avatarUrl` too, so both listed non-subscribers.

Fixed at the source: `resolveTier()` in `userService` reads `isVip` and nothing else, the
online-users subscription filters on `isVip`, and every screen now consumes the resolved tier
instead of re-deriving it. Non-VIP users no longer render an empty tier pill.

### ✅ Fabricated ages and a stock photo of a real person
`age || 20` / `age || '20'` printed an invented age beside every profile that had none
(`HomeScreen`, `ProfileScreen` ×3, `ActiveConnectsScreen`, `CelebsScreen`). Age is now shown
only when the user actually supplied it.

The avatar fallback was a specific Unsplash photograph of a real person, used for any user
without a picture (`HomeScreen`, `ProfileScreen` ×3, `TopBar`). Replaced with a neutral person
glyph. The deterministic illustrated avatar for users who never built one stays — it reads as
an illustration, not as the person.

### ✅ "1 Heart = 45 Coins" was invented
`CoinsScreen` displayed this exchange rate on the store screen. Nothing in `src/` or `backend/`
implements any heart↔coin conversion, and no `45` appears anywhere near either. Replaced with
the recharge rate the server actually applies (`inrToCoinRechargeRate`).

### ✅ Coin packages quoted a better rate than the custom box
Packages were hardcoded (₹89 → 100 coins) while custom top-ups used the server rate — so ₹89
bought 100 coins one way and 99 the other, and an admin changing the rate in the pricing panel
silently affected custom top-ups only. Packages now carry a price point and derive their coin
yield from the same server rate.

### ✅ Room billing failures were invisible
`ExpertRoomScreen`'s billing tick logged failures to console and carried on. The server keeps
accumulating unbilled seconds while unreachable, so a run of failures landed later as one large
unexplained deduction. Three consecutive failures now leave the room with an explanation. A
failed `joinRoom` — which left the user staring at a room they were not in — is surfaced too,
as are the stage, mute, match and close-room actions. Chat send now restores the draft on
failure instead of silently eating the message.

### ✅ The router dropped screens silently
`App.tsx` maintained the screen list in three places: a `ScreenName` union, a
`next === 'X' || next === 'Y'` chain inside `navigate`, and an if-chain in the render. Missing
any one made `navigate()` a no-op with no error — the failure mode behind the Connect tab
appearing dead. All three now derive from one `SCREENS` registry, and an unknown screen name
logs an error rather than vanishing.

Bottom-nav destinations also rebase the stack (`Home` underneath, then the tab) instead of
pushing, so tab-hopping no longer grows an unbounded history for the back button to walk.

### ✅ Development auth bypasses could reach production
`ALLOW_DEV_OTP_BYPASS` (accept `000000` for any number), `ALLOW_LEGACY_PLAINTEXT_LOGIN`
(unhashed password compare) and `FLASK_DEBUG` (the Werkzeug console — remote code execution)
were plain env reads with nothing stopping them being set in a deployed environment.
`assert_safe_production_config()` now runs on import and refuses to boot when `APP_ENV` is
production and any of them is `true`; `app.run()` likewise refuses, since it is the dev server.
`backend/.env` has the OTP bypass back off after this session's device testing.

### ✅ Loading states, touch targets, dead controls
- `HomeScreen`, `ClubScreen`, `ChillScreen` (both lists) and `CelebsScreen` painted their empty
  states on first frame, before Firestore answered. Each now distinguishes "nothing here" from
  "still loading". `ActivityScreen`'s snapshot error handler was `() => {}`; failures now show a
  message instead of an indefinite empty list.
- Added `src/theme/touch.ts` and brought the flagged controls to a 44pt touch target via
  `hitSlop` (which leaves the painted layout alone): the Ludo bet button — a money control that
  measured ~15pt — plus room back, Celebs close, ActiveConnects call/video, and the Settings,
  Earnings, AdminPanel, Language and ProfileDetails back buttons.
- `ProfileScreen`'s edit modal was unreachable (`setIsEditModalVisible(true)` was never called).
  Rather than delete a working form, it is now opened from an edit button in the owner's header,
  prefilled from the profile, moved into a real `<Modal>` (a bare overlay loses touch dispatch on
  Android), given age validation, and its swallowed save error surfaced.
- `RoomGifts` rendered a single gift recipient as a tappable chip wired to `() => {}`. With one
  recipient there is nothing to choose, so it is now a plain label.
- Labelled the Dumb Charades send button for screen readers.

**Verified on hardware (vivo 1920, `a3527f67`):** bundle compiles (1568 modules), app cold-starts
into Home with no red box and no JS error in logcat, and the Connect tab — previously unreachable —
navigates correctly with the pill styling and ★15/m / ★30/m pricing rendering as intended.

---

## Fourth pass — realtime, presence and fabricated data (all fixed)

### ✅ Room occupancy was a counter that only ever grew
`activeMemberCount` was `increment(1)` on join and `increment(-1)` on leave, so it was
correct only if every client got to run its leave path. Force-quit, crash, backgrounding or a
dropped connection all leaked a member permanently, and the drift is one-way — rooms filled
with people who had left hours ago. Chill was worse: it had no member records at all, so its
scoreboard and actor picker were derived from the `scores` map, which nothing ever removes
from, and showed raw Firestore uids for anyone who wasn't currently host, actor or guesser.
It also gated "can the game start?" on that number, so ghosts could start a game alone.

Fixed with heartbeat presence (`src/services/presenceService.ts`, `src/hooks/useRoomPresence.ts`):
members re-assert themselves every 20s into `{collection}/{roomId}/members/{uid}`, readers
ignore anyone past a 55s TTL, and the stored count is periodically *set* from a counting query
rather than incremented, so a missed leave is corrected instead of compounding. Backgrounding
pauses the heartbeat deliberately — a phone in a pocket is not in the room.

### ✅ Abandoned rooms stayed in the lobby forever
A room leaves `status: 'live'` only when its host closes it, and a host who crashes never
does. Hosts now heartbeat `hostLastSeen` onto the room document and lobbies filter on it
(`useLiveRooms`), re-evaluating on a timer since liveness lapses with time, not with a write.

### ✅ A dropped connection was indistinguishable from a quiet room
Rosters froze and chat stopped arriving with nothing on screen explaining why — in Club, while
still being charged per minute. Added `ConnectionBanner`, driven by heartbeat write failures.

### ✅ VIP was awarded for uploading a photo
`avatarUrl ? 'VIP' : 'Advance'` appeared in six places, so any user with a picture was shown in
the tier real subscribers pay for, and the "VIP only" filters (Home, Celebs) selected on it.
Tier now derives from `isVip` alone, via `resolveTier()`.

### ✅ Fabricated ages, stock photos and an invented exchange rate
`age || 20` (and `|| '24'`) printed a made-up age next to every incomplete profile; a stock
Unsplash photograph of a real person was the avatar fallback in four screens; and the store
displayed **"1 Heart = 45 Coins"**, a rate that exists nowhere in the app or the backend. Ages
now render only when real, missing avatars get a neutral icon, and the store shows the recharge
rate the server actually applies. Coin packages derive their coin yield from
`inrToCoinRechargeRate` too — they previously quoted a better rate than the custom-amount box
for the same money, and could not be changed without an app release.

### ✅ The router silently dropped screens
`navigate()` validated against a hand-written `next === 'X' || …` chain, the render was a
separate hand-written if-chain, and `ScreenName` a third list. Missing any one made a screen
unreachable with no error. All three now derive from one `SCREENS` registry in `App.tsx`, and
an unknown name logs instead of no-opping. Tab navigation also rebases the stack instead of
pushing, so hopping between tabs no longer grows an unbounded history.

### ✅ Development auth bypasses could reach production
`ALLOW_DEV_OTP_BYPASS` accepts `000000` for any phone number. It is now `false`, and
`assert_safe_production_config()` refuses to boot when `APP_ENV=production` with it,
`ALLOW_LEGACY_PLAINTEXT_LOGIN` or `FLASK_DEBUG` enabled. `app.run()` also refuses to serve
production traffic, since it is the Werkzeug development server.

### ✅ Swallowed errors and first-paint empty states
The ExpertRoom billing tick logged failures to console while the server kept accruing unbilled
seconds — the next successful tick then landed as one large unexplained deduction. It now
leaves the room after three consecutive failures and says why. Room chat restores the draft on
failure. Club, Chill, Celebs and Home no longer paint "nothing here" before Firestore answers,
and Activity surfaces a load error instead of an empty `() => {}` handler.

**Not verified on hardware.** Typecheck is clean and the rules compile, but none of the
presence, connection-banner or lobby-liveness behaviour has been exercised on a device.

## Fifth pass — payments (2026-08-05)

### ✅ Coins could not be bought at all
`/api/v1/coins/purchase` returned 501 for every request because no provider was configured. That
was the right refusal — the flow it replaced let the client add coins to its own balance with no
payment step — but it left the app with no way to take money. Razorpay is now wired end to end:
`/api/v1/coins/order` opens an order and **freezes the coin yield onto it**, so an admin changing
`inrToCoinRechargeRate` mid-checkout cannot re-price an order the buyer was already quoted.
Confirmation passes three independent checks before a balance moves — the HMAC signature (the ids
came from checkout), a payment fetch against Razorpay (money actually captured, not merely
authorized), and the order document flipped to `paid` inside the same transaction that credits, so
a replayed receipt credits nothing. The client sends no amount and no coin count. Checkout runs in
a WebView against a backend-served page loading Razorpay's own script, so no card details reach
this code and no native SDK had to be added.

### ✅ Error codes were dropped before any caller could read them
`authedPost` in `coinService.ts` threw `new Error(data.error)`, discarding the server's `code`.
`CoinsScreen` branched on `e?.code === 'payments_not_configured'` — a branch that could never be
taken, so a "payments aren't set up yet" response surfaced as a generic failure.

### ✅ Touch targets under 44×44 — swept

Every `Pressable`/`TouchableOpacity` in `src/` was matched against its style block and checked
for a painted box under 44pt. 28 controls were still short and now carry `hitSlop` from
`theme/touch.ts`; the rest already had it. The earlier entries here were partly wrong — the
`PlayerSeat` bet button no longer exists (the 17pt element is a decorative pip) and
`CelebsScreen`'s 28pt close already had `hitSlop`.

`hitSlop`, not a bigger box: `theme/touch.ts` exists precisely because several of these are
small on purpose, and growing the painted box wrecks the layout. Resizing them was tried first
and reverted — on the back buttons it would have double-counted against `hitSlop` that was
already there.

### ✅ Dead style definitions removed

72 unreferenced `StyleSheet` keys across 11 files, left behind by rewritten screens —
`CallScreen` (22, from the call-UI rework), `FinalizeInviteScreen` (24, from a removed form
flow), `PersonalScreen` (8), `HomeScreen` (5), and 7 others. Detection had to resolve the
StyleSheet's actual variable name: `RoomChrome` uses `s.` and `SpeakerSeat` uses `st.`, and a
naive `styles.` scan reports all 51 of their keys as dead.

## Sixth pass — call fallback, open endpoints, tests (2026-08-05)

### ✅ The call fallback was a dead end that lied to the user first
`WATERFALL = ['agora', 'zegocloud']` advertised redundancy that did not exist. Zego failed at
three layers: the backend returns 503 without credentials (`ZEGO_APP_ID=0`), `useGengalVoice`
had no adapter (`connectSeat` throws for any provider but Agora), and zego was last in the list
so exhaustion dropped the call. The damage was the ordering — on a **video** call, falling off
Agora fired *"Switched to voice — you are being charged the lower voice rate"* and then failed
anyway. The user was told they were in a cheaper call and then dumped out. `WATERFALL` is now
`['agora']`, so a failure produces one honest "Connection failed". The `losesVideo` downgrade is
kept and documented: any provider added back needs it, or the server bills the video rate for an
audio-only call.

`FreeProvider` also listed `dyte`, `daily`, `videosdk` and `stream`, none of which were ever
dispatched on, alongside four client refs that were never assigned. Removed.

### ✅ Four unauthenticated endpoints that spent money or minted identity
`/api/v1/stream/generate-token` signed a JWT for **any uid the caller named** — full
impersonation. `/api/v1/daily/create-room` and `/api/v1/dyte/create-room` burned provider quota
on server-held API keys. `/api/v1/red5/config` returned `RED5_SDK_LICENSE` to anyone. All four
had **zero client references** — dead scaffolding that only failed closed because the credentials
happened to be unset. Deleted along with their config constants (190 lines), 35 routes down to 31.

### ✅ The debug log wrote subscriber phone numbers to an unrotated file
`/api/v1/debug/log` accepts unauthenticated writes by design (auth failures have to stay
diagnosable) and was already rate limited per address, but it appended the caller's phone number
to a flat file that nothing rotates. The field is dropped server-side, removed from
`DebugContext` so the type system catches re-additions — it immediately caught 5 live call sites
— and the endpoint now requires `ENABLE_REMOTE_DEBUG_LOG=true`, returning 404 otherwise.
`/log` was unauthenticated, unrated and unused; deleted.

### ✅ First tests, on the money paths
`backend/tests/` — 20 pytest cases over the coin order and purchase endpoints, with a small
in-memory Firestore stand-in so they need no emulator and no network. They assert what must
never credit (forged signature, uncaptured payment, amount mismatch, another user's order,
unknown order, payment for a different order) and what must credit exactly once (valid payment,
replayed receipt, second payment against a paid order).

Each guard was **mutation-tested**: disabling the signature, capture, amount, owner and replay
checks one at a time turns the suite red every time, so the tests are load-bearing rather than
decorative. `npm run verify` runs typecheck plus tests.

## Open — payments configuration

`PAYMENT_PROVIDER`, `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` are empty. Until all three are
set the purchase endpoints return 501 and the store shows "Coming Soon" — the code is complete but
untested against live Razorpay credentials.

`TWILIO_*` is also empty, so real SMS OTP cannot be sent; signup currently works only via the dev
bypass, which must stay `false` outside local testing. `ZEGO_APP_ID=0`, so only Agora can carry a
call and the fallback leg of the provider waterfall is unconfigured.

## ✅ Accessibility — decorative imagery (2026-09-25)

The long tail in the room and game screens was labelled in an earlier pass (mute, speaker,
scoreboard, gift, share, back and close across `ExpertRoomScreen`, `DumCharadesRoomScreen`,
`LudoBoardScreen`, `ClubScreen`, `ChillScreen` and 13 other screens — 28 controls). What
remained was decorative imagery without `accessible={false}`, and composite rows that read as
several separate controls rather than one.

Every `<Image>` in `src/` is an avatar or the logo mark, and in both cases the meaning is
already in adjacent text — so announcing the image adds nothing, and inside a button that
carries its own label it actively splits one control into two. All 19 are now
`accessible={false}`, including the one inside `GengalAvatar`, which covers every avatar
rendered through that component rather than only the raw call sites.

Verified by script rather than by eye: 19 `<Image>` elements found, 0 without an
accessibility prop.

## Verification performed

- `npx tsc --noEmit` — exit 0, clean.
- `firebase deploy --only firestore:rules --dry-run` — rules compile successfully.
- Greps confirm: no `TEST CALL` remains, no raw `alert(` remains in `src/`, `<CustomAlert />` is
  mounted, all 15 call entry points route through a guarded wrapper.
- Tap targets: every touchable in `src/` re-scanned after the change — 0 remain without either a
  44pt box or `hitSlop`. `tsc --noEmit` clean after the style deletions.
- `npm run verify` — typecheck clean, 20/20 backend tests pass.
- Mutation testing on the five purchase guards: each one disabled individually turns the suite red.
- Payments: the app imports and boots, `/api/v1/coins/order`, `/api/v1/coins/purchase` and
  `/pay/razorpay/<order_id>` are registered, an unauthenticated order request is refused with 401,
  the checkout page returns 501 while unconfigured, and a **forged HMAC signature is rejected with
  400 before any Razorpay call or Firestore write**. Not exercised against live Razorpay
  credentials — no keys are configured.

**Not verified — needs a real device.** Audio/video paths cannot be exercised in an emulator.
Before shipping, confirm on hardware: dialogs actually appear, double-tap yields exactly one call
offer / one coin deduction, the zego fallback charges the voice rate, and the 45s ring timeout
fires.
