import React, { useState } from 'react';
import { tap42 } from '../theme/touch';
import { Platform, Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View, } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import ScreenShell from '../components/ScreenShell';
import GengalAvatar from '../components/GengalAvatar';
import { RtcSurfaceView } from '../hooks/AgoraViews';
import { skeuo } from '../theme/skeuomorphic';
import { useGengalVoice, FreeProvider } from '../hooks/useGengalVoice';
import { auth, db } from '../config/firebase';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { transferCoins, processCallBilling } from '../services/coinService';
import { subscribeToGlobalSettings, GlobalSettings } from '../services/adminService';
import ConnectingOverlay from '../components/ConnectingOverlay';
import { createCallOffer, acceptCallOffer, rejectCallOffer, subscribeToOutboundCallStatus, clearCallOffer, openCallRecord, closeCallRecord, ReceiverBusyError, CallSetupTimeoutError, CallGoneError, OFFER_EXPIRY_MS } from '../services/liveRoomService';
import IncomingCallOverlay from '../components/IncomingCallOverlay';
import { authedPost } from '../services/authService';
import { generateRoomId } from '../utils/ids';
import { Alert } from '../components/CustomAlert';
import { popTone, pushTone } from '../theme/activeTone';
import { useActionLock } from '../hooks/useActionLock';
import { startRingtone, stopRingtone } from '../services/ringtoneService';

// A call that is never answered must not ring forever: the caller path leaves
// `isConnecting` true, so neither the peer-timeout nor the heartbeat watchdog
// can fire. This is the only thing that ends an unanswered outbound call.
const RING_TIMEOUT_MS = 45000;

/**
 * How long the caller may sit on "Connecting..." before the call is abandoned.
 *
 * Comfortably longer than the offer write's own 10 s bound
 * (OFFER_WRITE_TIMEOUT_MS in liveRoomService), so in the ordinary case that
 * write reports its own failure with a more specific message and this backstop
 * never fires.
 */
const CALL_SETUP_TIMEOUT_MS = 20000;

/**
 * How long to wait, after our own Agora join resolves, for the peer to show
 * up as a `remoteUid` before giving up on the connection.
 *
 * This used to be 10 s and it was a false-positive machine: on real hardware
 * over real networks, one side's engine joining does not mean the other
 * side's join + ICE negotiation + Agora's own channel propagation finishes
 * within 10 s of that instant, especially on a cold SDK (first call of the
 * session). Measured failures on live devices where both legs connected
 * fine at 11-14 s. 20 s matches CALL_SETUP_TIMEOUT_MS above.
 */
const PEER_JOIN_TIMEOUT_MS = 20000;

/**
 * Providers the app can actually carry a call on, in preference order.
 *
 * Only Agora is implemented — `useGengalVoice.connectSeat` throws for anything
 * else. Listing `zegocloud` here was worse than useless: on a video call the
 * hop off Agora fired "Switched to voice — you are being charged the lower
 * voice rate", which was false, because zego then failed too (no adapter, and
 * the backend returns 503 without credentials) and the call was dropped a
 * moment later. One honest "Connection failed" beats a reassuring lie followed
 * by the same failure.
 *
 * Adding a provider back means implementing its adapter first. Keep the
 * `losesVideo` downgrade below when you do — without it the server keeps
 * charging the video rate for a call that has gone audio-only.
 */
const WATERFALL: FreeProvider[] = ['agora'];

type CallScreenProps = {
  profileName?: string;
  mode?: 'call' | 'video';
  roomId?: string;
  matchData?: any;
  isCaller?: boolean;
  isIncomingPending?: boolean;
  navigate: (screen: string, params?: { profileName?: string; mode?: 'call' | 'video'; roomId?: string; matchData?: any; isCaller?: boolean; isIncomingPending?: boolean }) => void;
  goBack: () => void;
};

export default function CallScreen({ profileName, mode = 'call', roomId: initialRoomId, matchData, isCaller, isIncomingPending = false, navigate, goBack }: CallScreenProps) {
  /**
   * One room per call attempt, minted here whenever we are the one placing it.
   *
   * A receiver must use the id it was given -- that is the channel the caller
   * is sitting in, and it arrives with the offer. A caller must not, even when
   * a screen hands one down. MatchScreen passes the matchmaking room id, and
   * both matched people are looking at that same screen with the same id: if
   * they both press Call, both try to open `calls/{roomId}` on the same
   * document, and the second write is rejected outright for changing
   * callerUid. The same id also comes back on a second attempt after a first
   * call ends, where it would reopen a record already marked ended. The id is
   * only ever an Agora channel name and a record key, and the peer learns it
   * from the offer, so there is nothing to be gained by inheriting it.
   */
  const [roomId] = useState(() => (isCaller || !initialRoomId ? generateRoomId() : initialRoomId));
  // Age is shown only when the peer actually has one. It previously defaulted
  // to '24', which displayed a fabricated age for every user missing the field.
  const profile = matchData ? {
    name: matchData.nickname || matchData.name,
    uri: matchData.uri || matchData.avatarUrl || '',
    age: matchData.age || null,
    avatarData: matchData.avatarData
  } : { name: profileName || 'User', uri: '', age: null as string | null };

  // Only Agora can render remote video here. If the waterfall falls through to
  // any other provider the call is audio-only, so it must stop being treated —
  // and billed — as video.
  const [videoDowngraded, setVideoDowngraded] = useState(false);
  const isVideo = mode === 'video' && !videoDowngraded;
  const [isGifting, setIsGifting] = useState(false);
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings | null>(null);
  const [currentUserProfile, setCurrentUserProfile] = useState<any>(null);
  const [isConnecting, setIsConnecting] = useState(!isIncomingPending);
  const [isPending, setIsPending] = useState(isIncomingPending);
  const [callerStatus, setCallerStatus] = useState<'calling' | 'accepted' | 'rejected' | null>(null);
  const [callStep, setCallStep] = useState<'connecting' | 'ringing' | 'talking'>('connecting');
  const overlayStatus = (isCaller && callStep === 'ringing') ? 'ringing' : 'connecting';

  const [callDurationSeconds, setCallDurationSeconds] = useState(0);
  const [callerLiveCoins, setCallerLiveCoins] = useState(0);
  const [isPeerUnstable, setIsPeerUnstable] = useState(false);
  /** Same value, readable from inside long-lived interval callbacks. */
  const isPeerUnstableRef = React.useRef(false);
  /**
   * Whether the RTC peer has ever actually shown up (`remoteUids` non-empty).
   *
   * Billing hangs off this rather than off the call being *accepted*. The
   * server measures elapsed wall-clock time and has no idea whether audio ever
   * flowed, so anchoring the clock at accept charged the caller for calls that
   * were accepted and then failed to connect on the media layer -- the app
   * told them the connection was lost and billed them for it anyway.
   *
   * Gating the whole billing effect (rather than just its teardown flush) is
   * deliberate: the opening tick is what stamps `lastBilledAt` and marks both
   * parties busy, so withholding it means a never-connected call leaves no
   * billing clock to charge against *and* no busy marker needing release.
   */
  const [peerEverConnected, setPeerEverConnected] = useState(false);
  const isCallActive = isCaller ? (callerStatus === 'accepted') : (!isPending);

  // The ringing UI below paints its own dark backdrop instead of using
  // ScreenShell, so nothing else publishes a tone while it is up and any alert
  // raised over it would arrive in the cream dress meant for the rest of app.
  React.useEffect(() => {
    if (!isPending) return;
    const id = pushTone('dark');
    return () => popTone(id);
  }, [isPending]);

  /**
   * The instant both sides treat as "call started," in epoch ms -- always
   * read from `acceptedAt`, a Firestore serverTimestamp(), never from either
   * device's own clock.
   *
   * Two problems compounded here. First, each side used to start its own
   * 0-based counter the moment *its own* `isCallActive` flipped true, and the
   * receiver's flips instantly on tapping Accept while the caller's only
   * flips once that acceptance round-trips back through Firestore -- so the
   * caller was always a beat behind. Anchoring both to a shared start instant
   * fixed that. But the first version anchored the receiver to its own
   * `Date.now()` at tap-time and the caller to the resolved server
   * timestamp -- two different clocks. Two real phones are rarely in sync,
   * so the timers still didn't agree, just by a fixed offset instead of a
   * shrinking one. Both sides now wait for the resolved `acceptedAt` value
   * (never the transient local null a serverTimestamp() write shows before
   * the server acknowledges it), so both are reading the same instant off
   * the same clock.
   */
  const callStartRef = React.useRef<number | null>(null);

  /** Whether `calls/{roomId}` has been observed in a not-yet-ended state. */
  const sawLiveCallRecordRef = React.useRef(false);

  /** Whether the ring slot last held an offer belonging to a different call. */
  const slotIsForeignRef = React.useRef(false);

  const lastObservedCallerHeartbeatRef = React.useRef<number | null>(null);
  const lastObservedReceiverHeartbeatRef = React.useRef<number | null>(null);
  const lastObservedCallerTimeRef = React.useRef<number>(Date.now());
  const lastObservedReceiverTimeRef = React.useRef<number>(Date.now());

  /**
   * Which uid owns the ring slot for this call, and which offer inside it is
   * ours. Every write to `incoming_calls` goes through these two, so a slot
   * that has moved on to another caller is left alone instead of being
   * accepted, declined or deleted on some stranger's behalf.
   */
  const peerUid: string | undefined = matchData?.uid;
  const selfUid = auth.currentUser?.uid;
  const ringSlotUid = isCaller ? peerUid : selfUid;
  const callRef = React.useMemo(
    () => ({ callerUid: (isCaller ? selfUid : peerUid) || '', roomId: roomId || '' }),
    [isCaller, selfUid, peerUid, roomId]
  );

  /**
   * Teardown runs exactly once.
   *
   * Half a dozen things can end a call -- the End button, the ring timeout,
   * the peer timeout, the heartbeat watchdog, the offer being cleared, the
   * record being closed, running out of coins -- and several of them fire
   * together when a call drops. `useActionLock` only covers a double-tap: it
   * releases after 900 ms, so two of those arriving a second apart both ran,
   * and each one called `goBack()`. Two pops leave the user a screen further
   * back than they started, stacked behind two "call ended" alerts.
   */
  const endedRef = React.useRef(false);

  const endCall = async () => {
    if (endedRef.current) return;
    endedRef.current = true;

    disconnectSeat();
    if (roomId) {
      // Closed by whichever side hangs up first, not just the caller. When the
      // receiver hung up, the record stayed 'active' forever -- the call sat
      // unfinished in both histories, and the caller learnt the call was over
      // only from the offer document going away. That signal lives in a slot
      // any later caller can overwrite, so it cannot be the only one.
      closeCallRecord(roomId);
    }
    if (ringSlotUid && callRef.callerUid) {
      // Deliberately not awaited before goBack(). This is a network round-trip,
      // and awaiting it meant a stalled or offline Firestore write pinned the
      // user on the call screen -- with useActionLock still held, so every
      // further tap on End/Cancel was swallowed and the screen became a dead
      // end with no way out but killing the app. Leaving the call must never
      // depend on the network. The write still runs to completion because it is
      // a plain service call rather than component state, so the peer is still
      // told the call is over.
      void clearCallOffer(ringSlotUid, callRef).catch((e) =>
        console.warn('Failed to clear call offer on end call', e)
      );
    }
    goBack();
  };

  // Guarded so a double-tap on End (or Back) cannot fire two teardowns.
  const { locked: isEnding, run: runEndCall } = useActionLock();
  const handleEndCall = () => runEndCall(endCall);

  /**
   * Ends the call after telling the user why, without letting a second cause
   * of death queue up another dialog behind the first. Before the guard, a
   * dropped connection commonly produced two alerts -- the heartbeat watchdog
   * and the peer timeout both firing -- and the user had to dismiss the same
   * news twice.
   */
  const endCallWithNotice = (title: string, message: string) => {
    if (endedRef.current) return;
    Alert.alert(title, message, [{ text: 'OK' }]);
    void endCall();
  };

  /**
   * The ringing phone gives up too, not just the caller.
   *
   * Every other way an inbound ring ends depends on the caller's device still
   * working: they hang up, they time out at 45 s, they lose the call and their
   * heartbeat stops. If that device simply stops -- force-quit, battery dead,
   * killed by the OS while the app was backgrounded -- nothing clears the
   * offer, and this screen rang, vibrated and refused to go away until the
   * user forced their own app closed. The offer is dead to everyone else after
   * OFFER_EXPIRY_MS, so this screen should not outlive it either.
   */
  React.useEffect(() => {
    if (!isPending) return;

    const timer = setTimeout(() => {
      endCallWithNotice('Missed call', `${profile.name} stopped calling.`);
    }, OFFER_EXPIRY_MS);

    return () => clearTimeout(timer);
  }, [isPending]);

  // An unanswered outbound call otherwise rings indefinitely: the caller path
  // keeps `isConnecting` true, which disables both the peer timeout and the
  // heartbeat watchdog below.
  React.useEffect(() => {
    if (!isCaller || callStep !== 'ringing') return;

    const timer = setTimeout(() => {
      endCallWithNotice('No answer', `${profile.name} did not pick up.`);
    }, RING_TIMEOUT_MS);

    return () => clearTimeout(timer);
  }, [isCaller, callStep]);

  // The ring timeout above only arms once the call has *reached* the ringing
  // step, so anything that stalls before then -- a profile read that never
  // settles, an offer write that hangs on a degraded connection -- left the
  // caller on "Connecting..." with no timer running and no way out but the
  // back button. Both of those have been fixed at their source, but the shape
  // of the bug is worth closing off for good: any future stall on the way to
  // ringing now surfaces instead of hanging silently. Generous, because it is
  // a backstop and must never pre-empt a call that is merely slow to dial.
  React.useEffect(() => {
    if (!isCaller || callStep !== 'connecting') return;

    const timer = setTimeout(() => {
      endCallWithNotice(
        'Could not connect',
        'We could not start this call. Please check your connection and try again.'
      );
    }, CALL_SETUP_TIMEOUT_MS);

    return () => clearTimeout(timer);
  }, [isCaller, callStep]);

  // Audible ring. Until this existed an inbound call arrived in complete
  // silence whenever the app was already open, because the push notification —
  // the only thing that made a sound — is not delivered to a foregrounded app.
  React.useEffect(() => {
    if (isPending) {
      void startRingtone('incoming');
    } else if (isCaller && callStep === 'ringing' && callerStatus !== 'accepted') {
      // Ringback for the caller: no vibration, they are already holding the phone.
      void startRingtone('outgoing', false);
    } else {
      stopRingtone();
    }
  }, [isPending, isCaller, callStep, callerStatus]);

  // Belt and braces: leaving the screen by any route must silence the ring.
  React.useEffect(() => stopRingtone, []);

  // A call needs a resolvable peer uid: without it no offer can be created and
  // the screen would otherwise sit on the connecting overlay forever.
  React.useEffect(() => {
    if (isCaller && !matchData?.uid) {
      // Nothing has been created yet, so there is nothing to tear down -- but
      // the profile load below can fail for the same call and also leave, and
      // two departures pop two screens.
      if (endedRef.current) return;
      endedRef.current = true;
      Alert.alert('Unavailable', 'This profile cannot be called right now.', [{ text: 'OK' }]);
      goBack();
    }
  }, [isCaller, matchData?.uid]);

  // 0. Fetch current user profile to determine gender/role
  React.useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;
    let cancelled = false;
    import('../services/userService')
      .then(({ getUserProfile }) => getUserProfile(user.uid))
      .then(p => {
        if (cancelled) return;
        setCurrentUserProfile(p);
        if (p?.coins) setCallerLiveCoins(p.coins);
      })
      .catch(e => {
        // This had no .catch() at all, which was the original cause of calls
        // silently never going through: the offer-creation effect below is
        // gated on currentUserProfile ever being set, so a failed read here
        // left the caller staring at "Connecting..." forever -- no offer sent,
        // no error shown, nothing in the receiver's incoming_calls to explain
        // why. For the receiver this profile only feeds a cosmetic live coin
        // counter, so their answer flow is unaffected and this stays a
        // console warning; only the caller side, which cannot proceed at all
        // without it, needs to fail loudly and let the user retry.
        console.warn('[CallScreen] Failed to load caller profile:', e);
        if (cancelled) return;
        if (isCaller) {
          if (endedRef.current) return;
          endedRef.current = true;
          Alert.alert('Could not connect', 'Could not reach that user. Please try again.', [{ text: 'OK' }]);
          goBack();
        }
      });
    return () => { cancelled = true; };
  }, []);

  // 1. Initialize the 40K Multi-Adapter
  const initialProvider = (matchData?.audioProvider || 'agora') as FreeProvider;
  const audioToken = matchData?.audioTokenOrUrl || '';
  const [currentProvider, setCurrentProvider] = useState<FreeProvider>(initialProvider);
  const { connectSeat, disconnectSeat, toggleMic, micMuted, toggleSpeaker, speakerOn, toggleCamera, cameraOn, flipCamera, localUid, remoteUids } = useGengalVoice(currentProvider);

  /**
   * The RTC token round-trip used to start only *after* the call was answered,
   * so every answer paid for a full backend request before any audio could
   * flow. The token depends only on the room and the signed-in uid, both known
   * while the phone is still ringing — so fetch it during the ring and have it
   * in hand the moment someone taps Accept.
   */
  const tokenPrefetchRef = React.useRef<Promise<{ token: string; uid?: number } | null> | null>(null);

  React.useEffect(() => {
    if (currentProvider !== 'agora' || !roomId || !auth.currentUser) return;
    if (tokenPrefetchRef.current) return;

    const ringing = isPending || (isCaller && callerStatus !== 'accepted');
    if (!ringing) return;

    // Resolves to null rather than rejecting on failure: a flaky prefetch must
    // degrade to the old behaviour (fetch on answer), never fail the call.
    tokenPrefetchRef.current = authedPost<{ token: string; uid?: number }>(
      '/api/v1/agora/generate-token',
      { roomId }
    ).catch((e) => {
      console.warn('[CallScreen] Token prefetch failed; will fetch on answer.', e);
      return null;
    });
  }, [currentProvider, roomId, isPending, isCaller, callerStatus]);

  // Firestore listener for room provider updates (so both users stay in sync on
  // fallbacks). This lives on the `calls` record rather than `rooms`, because
  // direct (non-matchmade) calls never create a `rooms` document.
  React.useEffect(() => {
    if (!roomId) return;
    const unsub = onSnapshot(doc(db, 'calls', roomId), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.audioProvider && data.audioProvider !== currentProvider) {
          console.log(`[Waterfall] Room provider changed by peer to ${data.audioProvider}. Connecting...`);
          setCurrentProvider(data.audioProvider as FreeProvider);
        }
        // The server bills from this field, so it is the authority on what the
        // call has actually become after a fallback — not the `mode` prop.
        if (data.mode === 'call' && mode === 'video') {
          setVideoDowngraded(true);
        }
        // Whichever side hangs up closes this record, and unlike the ring slot
        // there is exactly one of these per call -- nobody else's call can
        // overwrite it. That makes it the reliable "the other person left"
        // signal for both sides. The slot's own delete still fires first in the
        // ordinary case; this covers the case where the slot has already been
        // taken over by a later caller and can no longer speak for this call.
        //
        // Only honoured after this record has been seen live at least once.
        // `openCallRecord` is not awaited before the offer goes out, and a
        // matchmade room id can be handed out again, so the first snapshot can
        // still be the *previous* call's closed record -- which would otherwise
        // end this call the instant it started.
        if (data.status === 'ended') {
          if (sawLiveCallRecordRef.current) {
            console.log('[CallScreen] Call record closed by peer. Ending call.');
            void endCall();
          }
        } else {
          sawLiveCallRecordRef.current = true;
        }

        // Peer liveness. What is compared is only whether the *value changed*,
        // and the elapsed time is measured from when this device saw it change,
        // so the two phones' clocks never have to agree.
        const peerBeat = isCaller ? data.receiverHeartbeat : data.callerHeartbeat;
        const lastBeatRef = isCaller ? lastObservedReceiverHeartbeatRef : lastObservedCallerHeartbeatRef;
        const lastSeenRef = isCaller ? lastObservedReceiverTimeRef : lastObservedCallerTimeRef;
        if (typeof peerBeat === 'number' && lastBeatRef.current !== peerBeat) {
          lastBeatRef.current = peerBeat;
          lastSeenRef.current = Date.now();
        }
      }
    }, (error) => {
      // The rules on /calls read `resource.data`, so this listener is denied
      // outright whenever the record does not exist yet — which is the normal
      // state on the receiver, who subscribes as soon as the offer arrives
      // while the caller is still writing the record. Without a handler the SDK
      // reported it as an uncaught snapshot error and tore the listener down,
      // so a provider fallback published later in the call never reached the
      // receiver. Provider sync is best-effort; the call itself is unaffected.
      console.warn('[CallScreen] Call record listener unavailable:', error?.message);
    });
    return unsub;
  }, [roomId, currentProvider, isCaller]);

  // Listen for the incoming_calls document being deleted, which means the call ended.
  React.useEffect(() => {
    if (isCaller) return;
    const user = auth.currentUser;
    if (!user) return;

    const unsub = onSnapshot(doc(db, 'incoming_calls', user.uid), (snap) => {
      if (!snap.exists()) {
        // A delete carries no data, so it cannot be attributed on its own. If
        // the last thing in the slot was somebody else's offer, this is that
        // caller giving up, not ours -- ending here would hang up a working
        // call because a stranger cancelled theirs.
        if (slotIsForeignRef.current) {
          console.log("[CallScreen] Another caller's offer was cleared; ignoring.");
          return;
        }
        console.log("[CallScreen] Call offer document deleted. Ending call.");
        void endCall();
      } else {
        const data = snap.data();

        // Everything below describes *this* call, so anything else in the slot
        // is somebody else's business. Without this check a second person
        // dialling mid-conversation ended the conversation: their offer landed
        // here, the busy-guard in App.tsx stamped `rejected` on it, and this
        // listener read that as "the person I am talking to hung up". The
        // newcomer is handled by the watcher in App.tsx; from in here it is
        // noise, and this call's own liveness comes from the per-call `calls`
        // record and the heartbeat watchdog instead.
        if (data.callerUid !== callRef.callerUid || data.roomId !== callRef.roomId) {
          slotIsForeignRef.current = true;
          // Mid-call this is pure noise. Still ringing, though, it means our
          // caller's offer has been displaced and will never be answered --
          // there is nothing left to accept, so stop ringing now rather than
          // buzzing at a dead offer until it expires.
          if (isPending) {
            console.log('[CallScreen] Ring slot taken over while ringing; ending.');
            endCallWithNotice('Missed call', `${profile.name} stopped calling.`);
          } else {
            console.log('[CallScreen] Ring slot now holds another call; ignoring.');
          }
          return;
        }
        slotIsForeignRef.current = false;

        if (data.status === 'rejected') {
          // We declined (nobody else can write this status for our own call).
          // Leave the offer and the history record exactly as they are: that
          // 'rejected' status is the only way the caller finds out why their
          // call stopped, and clearing the offer or closing the record here
          // races that message -- Firestore is free to coalesce a delete over
          // an update the caller has not read yet, and then all they see is
          // the call vanishing, with a "No answer" forty-five seconds later.
          // The caller tidies both up once it has shown the decline.
          console.log("[CallScreen] Call declined here. Leaving the call screen.");
          if (!endedRef.current) {
            endedRef.current = true;
            disconnectSeat();
            goBack();
          }
          return;
        }

        // Anchor the timer to the resolved server timestamp, not this
        // device's own clock. `acceptCallOffer` writes this doc from this
        // same device, so a local `Date.now()` at tap-time felt "instant" but
        // was reading a different clock than the caller's -- two real phones
        // are rarely in perfect sync, so the two timers drifted by however
        // far the clocks were apart, not just by network latency. A
        // serverTimestamp() write reports back as null on the optimistic
        // local snapshot and resolves to the real value once the server
        // acknowledges it; only take the resolved one so both sides end up
        // reading the identical instant.
        if (callStartRef.current === null && typeof (data as any).acceptedAt?.toMillis === 'function') {
          callStartRef.current = (data as any).acceptedAt.toMillis();
        }
      }
    }, (error) => {
      // This listener is what ends the receiver's call when the offer is
      // cleared. Left unhandled it surfaced as an uncaught snapshot error and
      // the listener was dropped, stranding the receiver on a call screen that
      // nothing could close.
      // Clearing the offer rather than just leaving also tells the caller the
      // call is over — their own listener sees the delete. A bare goBack() left
      // the caller talking to a screen nobody was on.
      console.warn('[CallScreen] Offer listener failed; ending call.', error?.message);
      void endCall();
    });
    return unsub;
  }, [isCaller, isPending, callRef]);

  // 2. Automatically connect to the voice room when the screen mounts or provider changes
  React.useEffect(() => {
    let isMounted = true;
    
    if (isPending) return; // Wait until accepted!
    if (isCaller && callerStatus !== 'accepted') return; // Wait for receiver to accept!

    const establishSecureCall = async () => {
      if (!roomId) return;
      if (isMounted) setIsConnecting(true);
      
      let connectionToken = audioToken;
      let extraParam = auth.currentUser?.uid || '';
      const user = auth.currentUser;

      const connectionPromise = async () => {
        // Ephemeral RTC keys are minted by the backend, which derives the uid
        // from the bearer token rather than trusting the request body.
        if (currentProvider === 'agora' && user) {
          // Usually already in flight (or done) from the prefetch above, so this
          // resolves immediately instead of adding a round-trip after answering.
          const prefetched = tokenPrefetchRef.current ? await tokenPrefetchRef.current : null;
          if (!prefetched) {
            console.log("[CallScreen] Requesting secure ephemeral key from token authority...");
          }
          const credentials = prefetched ?? await authedPost<{ token: string; uid?: number }>(
            '/api/v1/agora/generate-token',
            { roomId }
          );
          connectionToken = credentials.token;
          if (credentials.uid) extraParam = String(credentials.uid);
        } else if (currentProvider === 'zegocloud' && user) {
          console.log("[CallScreen] Resolving crypto credentials from Zego Token Authority...");
          const tokenPayload = await authedPost<{ token: string }>(
            '/api/v1/zego/generate-token',
            { roomId }
          );
          connectionToken = tokenPayload.token;
        }

        if (isMounted) {
          await connectSeat(roomId, connectionToken, extraParam);
          if (isMounted) setIsConnecting(false);
        }
      };

      try {
        // Enforce a strict 7-second timeout for the provider to connect
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Connection Timeout")), 7000));
        await Promise.race([connectionPromise(), timeoutPromise]);
      } catch (error: any) {
        // A denied microphone is not a connection failure to route around —
        // there is no provider that makes a call work without one. Previously
        // this fell into the same waterfall path as a network error, and with
        // only 'agora' in WATERFALL that path already ended the call, but via
        // a generic "Connection failed" message that gave no indication the
        // fix was to grant the permission and try again.
        if (error?.code === 'PERMISSION_DENIED') {
          console.warn('[CallScreen] Microphone permission denied; not proceeding with call.');
          if (isMounted) setIsConnecting(false);
          endCallWithNotice(
            'Microphone access needed',
            'GenGal needs microphone access to make and receive calls. Please allow it in your device settings and try again.'
          );
          return;
        }

        console.error(`[Waterfall] Provider ${currentProvider} failed:`, error);

        // Trigger Waterfall Fallback. Only the caller publishes the switch — it
        // owns the `calls` record, and the receiver picks the change up through
        // the listener above.
        const currentIndex = WATERFALL.indexOf(currentProvider);
        if (currentIndex !== -1 && currentIndex + 1 < WATERFALL.length) {
          const nextProvider = WATERFALL[currentIndex + 1];
          console.warn(`[Waterfall] Falling back to next adapter: ${nextProvider}`);
          // Falling off Agora means remote video can no longer be rendered.
          // Downgrade the record to a voice call so the backend stops charging
          // the video rate for what is now an audio-only call.
          const losesVideo = mode === 'video' && nextProvider !== 'agora';

          if (isCaller) {
            try {
              await updateDoc(doc(db, 'calls', roomId), {
                audioProvider: nextProvider,
                ...(losesVideo ? { mode: 'call' } : {}),
              });
            } catch (e) {
              console.error("[Waterfall] Failed to update call record with new provider", e);
            }
          } else {
            setCurrentProvider(nextProvider);
          }

          if (losesVideo) {
            setVideoDowngraded(true);
            Alert.alert(
              'Switched to voice',
              'Video was unavailable on this connection, so the call continued as voice — you are being charged the lower voice rate.',
              [{ text: 'OK' }]
            );
          }
        } else {
          // endCall, not goBack: this leaves an opened history record and a
          // live offer behind otherwise, so the call reads as still running to
          // the server and to the person at the other end.
          endCallWithNotice(
            'Connection failed',
            'We could not establish a secure connection. Please try again later.'
          );
        }
      }
    };

    establishSecureCall();

    return () => {
      isMounted = false;
      disconnectSeat();
    };
  }, [roomId, currentProvider, isPending, isCaller, callerStatus]);

  // 2b. Initiate call if Caller (runs once on mount)
  React.useEffect(() => {
    if (!isCaller || !roomId || !matchData?.uid || !currentUserProfile) return;

    // Do not ring someone for a call that cannot be paid for. The server
    // refuses it on its opening tick regardless -- that is the check that
    // counts, and this one only reads a balance the client happens to be
    // holding -- but without it the other person's phone rings, they answer,
    // and the call dies in their ear a second later.
    if ((currentUserProfile.coins ?? 0) <= 0) {
      endCallWithNotice(
        'Not enough coins',
        'You need coins to place a call. Top up and try again.'
      );
      return;
    }

    const callerName = currentUserProfile.name || currentUserProfile.nickname || 'Someone';
    const callerAvatarUrl = currentUserProfile.avatarUrl || currentUserProfile.uri || null;

    import('../services/debugLogger').then(({ logDebugEvent }) => {
      logDebugEvent('call.createOffer.start', { targetUid: matchData.uid, roomId });

      // The history record has to exist before anyone is told about the call,
      // and the call cannot proceed without it. It is not just history: the
      // billing endpoint reads the rate, the participants and the elapsed
      // clock from this document and returns "Unknown call" without it, so a
      // call placed after a failed write connected, ran, and was never charged
      // for. It is also the document both sides sync the provider through and
      // the one that reports the hang-up, so the receiver used to be able to
      // subscribe to it before it existed.
      openCallRecord(
        roomId,
        { uid: auth.currentUser!.uid, name: callerName, avatarUrl: callerAvatarUrl, avatarData: currentUserProfile.avatarData },
        { uid: matchData.uid, name: profile.name, avatarUrl: matchData.avatarUrl || matchData.uri, avatarData: matchData.avatarData },
        mode
      ).then(() => createCallOffer(
        auth.currentUser!.uid,
        matchData.uid,
        callerName,
        callerAvatarUrl,
        currentUserProfile.avatarData || null,
        mode,
        roomId
      )).then(() => {
        logDebugEvent('call.createOffer.success', { targetUid: matchData.uid });
        setCallStep('ringing');
      }).catch(e => {
        console.warn('Failed to send call offer', e);
        logDebugEvent('call.createOffer.failed', { error: String(e), targetUid: matchData.uid }, 'error');
        const isBusy = e instanceof ReceiverBusyError;
        const isTimeout = e instanceof CallSetupTimeoutError;
        // Through endCall rather than a bare goBack: the history record was
        // opened a moment ago, and leaving without closing it left a call that
        // never happened sitting in both users' history as still in progress.
        endCallWithNotice(
          isBusy ? 'Line busy' : 'Could not connect',
          isBusy
            // Covers both "on a call" and "someone else's phone is ringing
            // them right now" — the caller is not allowed to see which, and
            // claiming the wrong one would be a guess stated as fact.
            ? `${profile.name} is busy right now. Try again in a moment.`
            : isTimeout
              ? 'We could not reach the server to start this call. Please check your connection and try again.'
              : 'Could not reach that user. Please try again.'
        );
      });
    }).catch(e => {
      // Everything above -- the history record, the offer, the move to
      // "ringing" -- happens inside this dynamically imported block, so a
      // failed chunk load means the call was never placed at all. With no
      // catch here that surfaced only as an unhandled rejection, while the
      // caller watched a screen that was never going to resolve.
      console.warn('[CallScreen] Could not load call services:', e);
      endCallWithNotice(
        'Could not connect',
        'Something went wrong starting this call. Please try again.'
      );
    });

    return () => {
      if (isCaller && ringSlotUid && callRef.callerUid) {
        clearCallOffer(ringSlotUid, callRef).catch(() => {});
        // Leaving without a teardown -- the navigator replacing this screen,
        // which is what happens when we yield to the same person calling us
        // back -- would otherwise strand the record it opened, leaving a call
        // that never happened showing as still in progress in two histories.
        // When endCall did run it has already closed it.
        if (!endedRef.current && roomId) closeCallRecord(roomId);
      }
    };
  }, [isCaller, roomId, matchData?.uid, currentUserProfile]);

  // 2c. Listen for status changes on the outbound call offer
  React.useEffect(() => {
    if (!isCaller || !ringSlotUid || !callRef.callerUid) return;

    const unsubStatus = subscribeToOutboundCallStatus(ringSlotUid, callRef, (status, data) => {
      if (status === 'accepted') {
        setCallerStatus('accepted');
        setCallStep('talking');
        if (callStartRef.current === null) {
          const acceptedAt = (data as any)?.acceptedAt;
          // A serverTimestamp() write is briefly null locally (pending server
          // round-trip) before resolving, so fall back to "now" rather than
          // treating that transient null as a valid start time.
          callStartRef.current = typeof acceptedAt?.toMillis === 'function'
            ? acceptedAt.toMillis()
            : Date.now();
        }
        return;
      }

      if (status === 'rejected') {
        setCallerStatus('rejected');
        // A device that is already on a call declines automatically, and the
        // person never sees it ring. Reporting that as "they declined your
        // call" told the caller something untrue about someone who was given
        // no say in it.
        const busy = (data as any)?.rejectReason === 'busy';
        // Must go through endCall, not a bare disconnect. Declining only sets
        // status='rejected'; nothing deletes the offer document, so leaving here
        // without clearing it stranded a stale offer on the receiver and left
        // the /calls history record stuck at status 'active' forever.
        endCallWithNotice(
          busy ? 'Line busy' : 'Call declined',
          busy
            ? `${profile.name} is already on another call. Try again in a moment.`
            : `${profile.name} declined the call.`
        );
        return;
      }

      if (status === 'taken') {
        // Another caller now owns the ring slot. While we were still ringing
        // that means our offer was displaced and will never be answered, so
        // say so now instead of leaving the caller listening to a ringtone for
        // the full forty-five seconds with nothing at the other end.
        //
        // Once the call is up it means nothing: the conversation runs on the
        // per-call record, its heartbeats and the RTC session, none of which a
        // stranger's offer can touch. Ending here is what used to let a third
        // person's unanswered call hang up on two people mid-sentence.
        //
        // `ringing` specifically, and not merely "not talking": the step only
        // becomes `ringing` once createCallOffer has resolved, so before that
        // our own offer is not in the slot yet and whatever is sitting there
        // -- a previous call's document still being cleared, most often --
        // fails `isSameCall` for the ordinary reason that it is not ours yet.
        // Treating that as displacement killed the call the instant it was
        // placed, telling the caller the other person "could not take this
        // call" while their phone had never even rung. This is the same window
        // the 'gone' branch below already declines to judge.
        if (callStep === 'ringing') {
          endCallWithNotice(
            'Unavailable',
            `${profile.name} could not take this call. Please try again in a moment.`
          );
        }
        return;
      }

      if (status === 'calling') {
        setCallerStatus('calling');
        return;
      }

      // 'gone' -- no offer in the slot. Expected before our own write lands, so
      // it only means something once the call is up: the receiver hung up.
      setCallerStatus(null);
      if (callStep === 'talking') {
        // Offer already gone, but the history record still needs closing.
        void endCall();
      }
    });

    return () => {
      unsubStatus();
    };
  }, [isCaller, ringSlotUid, callRef, callStep]);

  // 2c. Send periodic local heartbeat on the call's own record, so the peer can
  // tell a quiet line from a dead one.
  React.useEffect(() => {
    if (!isCallActive || !roomId) return;

    const sendHeartbeat = () => {
      // updateCallHeartbeat swallows its own write failures, so the only thing
      // that can reject here is the import. Left uncaught it fired an
      // unhandled rejection every five seconds for the length of the call --
      // seen on a handset whose lazy chunk fetches were failing -- while the
      // heartbeat itself silently stopped, which is the very signal the peer
      // uses to tell a quiet line from a dead one.
      import('../services/liveRoomService')
        .then(({ updateCallHeartbeat }) => {
          updateCallHeartbeat(roomId, isCaller ? 'caller' : 'receiver');
        })
        .catch(e => console.warn('[CallScreen] Heartbeat module unavailable:', e));
    };

    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, 5000);
    return () => clearInterval(interval);
  }, [isCallActive, isCaller, roomId]);

  // 2d. Latch the first sighting of the peer. Billing below starts from here,
  // not from the call being accepted, so dead air is never charged.
  React.useEffect(() => {
    if (remoteUids.length > 0) setPeerEverConnected(true);
  }, [remoteUids.length]);

  // 2e. Auto-hangup if peer is offline on Agora for more than PEER_JOIN_TIMEOUT_MS
  React.useEffect(() => {
    if (isPending || isConnecting || remoteUids.length > 0) return;

    const timeout = setTimeout(() => {
      console.log("[CallScreen] Peer connection timeout. Terminating call.");
      endCallWithNotice('Call ended', 'The connection to the other person was lost.');
    }, PEER_JOIN_TIMEOUT_MS);

    return () => clearTimeout(timeout);
  }, [isPending, isConnecting, remoteUids.length]);

  // 3. Fetch global billing settings
  React.useEffect(() => {
    const unsub = subscribeToGlobalSettings((settings) => {
      setGlobalSettings(settings);
    });
    return unsub;
  }, []);

  // 4. Background Billing Loop (ticks the server every 15s)
  const syncIntervalRef = React.useRef(0);

  // Periodic check for heartbeat timeout (immune to clock drift)
  React.useEffect(() => {
    if (!isCallActive) return;

    // Reset the baseline timestamps NOW so the watchdog does not fire immediately
    // on the first tick due to stale component-mount timestamps.
    lastObservedCallerTimeRef.current = Date.now();
    lastObservedReceiverTimeRef.current = Date.now();
    // Also clear any stale heartbeat values so the first snapshot update is counted
    lastObservedCallerHeartbeatRef.current = null;
    lastObservedReceiverHeartbeatRef.current = null;

    const interval = setInterval(() => {
      // Judge the peer only once they have actually been heard from. If their
      // beats never arrive at all -- a call record listener that could not be
      // established, say -- silence means "no information", not "they are
      // gone", and hanging up on a working call for want of a status document
      // is the worse failure. A peer who genuinely never joins is caught by
      // the RTC peer timeout above instead.
      const lastBeat = isCaller ? lastObservedReceiverHeartbeatRef.current : lastObservedCallerHeartbeatRef.current;
      if (lastBeat === null) return;

      const now = Date.now();
      const lastTime = isCaller ? lastObservedReceiverTimeRef.current : lastObservedCallerTimeRef.current;
      const elapsed = now - lastTime;

      const unstable = elapsed > 20000;
      setIsPeerUnstable(unstable);
      // Mirrored into a ref because the billing loop below reads it from inside
      // a `setInterval` callback that is created once and never re-created --
      // it closed over the value at the moment the call started, which is
      // always `false`. The pause it is supposed to apply therefore never
      // happened, and both parties kept paying through an outage.
      isPeerUnstableRef.current = unstable;

      if (elapsed > 45000) {
        console.log(`[CallScreen] Heartbeat timed out after ${elapsed}ms. Ending call.`);
        endCallWithNotice(
          'Call ended',
          isCaller ? `${profile.name}'s connection was lost.` : "The caller's connection was lost."
        );
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isCallActive, isCaller]);

  React.useEffect(() => {
    // `peerEverConnected` and not merely `isCallActive`: acceptance is not
    // connection. See the state's declaration for why billing must not start
    // until the media session actually carries the other person.
    if (!roomId || !matchData?.uid || !globalSettings || !currentUserProfile || !isCallActive) return;
    if (!peerEverConnected) return;

    // Billing is server-authoritative: the backend measures elapsed time from
    // its own clock and applies the configured rate. Both participants tick the
    // same endpoint, so the payer cannot ride for free by patching its client.
    // The local figure below is a display estimate only.
    const billingRatePerSec =
      (isVideo ? globalSettings.videoCallRatePerMin : globalSettings.voiceCallRatePerMin) / 60;

    /**
     * One tick immediately, before the fifteen-second cadence starts.
     *
     * The first tick bills nothing -- it only starts the server's clock -- but
     * it is also what stamps `inCallSince` on both participants, and that stamp
     * is the only signal telling everyone else these two are busy. Waiting for
     * the regular cadence left a fifteen-second window at the start of every
     * call in which both people still read as free: long enough for a third
     * party to dial straight into a conversation that had only just begun,
     * which is the most likely moment for someone to be calling them.
     */
    void processCallBilling(roomId)
      .then((result) => {
        if (isCaller && typeof result.payerNewBalance === 'number') {
          setCallerLiveCoins(result.payerNewBalance);
        }
        // The opening interval is the one the server charges nothing for, so a
        // caller with an empty balance has to be stopped on this reply. Left to
        // the regular cadence they would get every call's first quarter-minute
        // free and could simply keep redialling.
        if (result.hasInsufficientFunds) {
          endCallWithNotice(
            'Call ended',
            isCaller
              ? 'You do not have enough coins for this call. Top up to keep talking.'
              : 'The caller does not have enough coins for this call.'
          );
        }
      })
      .catch((e) => console.warn('[Billing Engine] Opening tick failed:', e?.message));

    const billingInterval = setInterval(async () => {
      const user = auth.currentUser;
      if (!user) return;

      // Pause ticks while the peer link is down so neither side pays for dead air.
      if (isPeerUnstableRef.current) {
        console.log("[CallScreen] Peer connection is unstable. Pausing billing ticks.");
        return;
      }

      if (isCaller) {
        setCallerLiveCoins(prev => Math.max(0, prev - billingRatePerSec));
      }

      syncIntervalRef.current += 1;
      // Computed from the shared start instant rather than incremented, so a
      // paused/backgrounded tab still snaps to the correct elapsed time on
      // its next tick instead of resuming a locally-stalled count.
      if (callStartRef.current !== null) {
        setCallDurationSeconds(Math.max(0, Math.round((Date.now() - callStartRef.current) / 1000)));
      }

      if (syncIntervalRef.current >= 15) {
        const secondsInThisBatch = syncIntervalRef.current;
        syncIntervalRef.current = 0;

        try {
          const result = await processCallBilling(roomId);

          // Keep the on-screen balance aligned with the authoritative figure.
          if (isCaller && typeof result.payerNewBalance === 'number') {
            setCallerLiveCoins(result.payerNewBalance);
          }

          if (result.hasInsufficientFunds) {
            console.warn(`[Billing Engine] Call disconnected: User ran out of coins.`);
            endCallWithNotice(
              'Call ended',
              isCaller
                ? 'You have run out of coins. Top up to keep talking.'
                : 'The caller has run out of coins.'
            );
            return;
          }
        } catch (error: any) {
          console.warn(`[Billing Engine] Error syncing billing: ${error.message}`);
        }

        // Rewards are staggered so they do not contend with the billing
        // transaction on the same user document.
        setTimeout(async () => {
          try {
            const { updateCallRewards } = await import('../services/coinService');
            await updateCallRewards(user.uid, secondsInThisBatch, globalSettings.callDurationForHeart, !isCaller);
          } catch (e) {
            console.warn("[Rewards Engine] Failed to update call rewards", e);
          }
        }, isCaller ? 3000 : 6000);
      }
    }, 1000);

    return () => {
      clearInterval(billingInterval);

      const remainingSeconds = syncIntervalRef.current;
      // Consumed, so it cannot be paid out twice. This effect re-runs whenever
      // its inputs change -- `globalSettings` is a live subscription, so an
      // admin editing the rates mid-call is enough -- and the counter used to
      // survive the teardown, so the seconds flushed here were then counted
      // again by the next interval's first batch.
      syncIntervalRef.current = 0;
      const user = auth.currentUser;

      // Final tick so the last partial interval is charged from the server
      // clock. Unconditional on purpose: this is also the call that releases
      // the server-side busy marker, and skipping it would leave both parties
      // advertised as mid-call until the marker aged out. The effect only runs
      // once the peer has actually connected, so a call that never carried
      // audio never reaches this teardown in the first place.
      processCallBilling(roomId)
        .catch(e => console.warn('[Billing Engine] Final flush failed:', e));

      if (remainingSeconds > 0 && user) {
        import('../services/coinService')
          .then(({ updateCallRewards }) =>
            updateCallRewards(user.uid, remainingSeconds, globalSettings.callDurationForHeart, !isCaller)
          )
          // Chained rather than nested: the inner .catch() covered the call but
          // not the import that produces it, so a failed chunk load rejected
          // with nothing attached to it.
          .catch(e => console.warn("[Rewards Engine] Final flush failed", e));
      }
    };
  }, [roomId, matchData?.uid, globalSettings, currentUserProfile, isCaller, isVideo, isCallActive, peerEverConnected]);

  const formatTimer = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const sendGift = async (amount: number) => {
    const user = auth.currentUser;
    if (!user || !matchData?.uid) return;

    setIsGifting(true);
    try {
      await transferCoins(user.uid, matchData.uid, amount);
      Alert.alert('Gift sent', `You sent a ${amount}G gift to ${profile.name}.`, [{ text: 'OK' }]);
    } catch (error: any) {
      Alert.alert('Gift failed', error?.message || 'Could not send the gift.', [{ text: 'OK' }]);
    }
    setIsGifting(false);
  };

  // Confirm before moving coins — this used to fire on a single tap with no
  // way back, so a mis-tap during a call cost the user real balance.
  const handleGift = (amount: number) => {
    if (isGifting) return;
    Alert.alert(
      'Send gift?',
      `This will send ${amount}G to ${profile.name}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: `Send ${amount}G`, onPress: () => { void sendGift(amount); } },
      ]
    );
  };

  if (isPending) {
    // Deliberately not wrapped in ScreenShell: the ringing UI paints its own
    // full-bleed backdrop, and the shell's plum gradient used to show through
    // behind the status bar and clash with it. Previously this branch rendered
    // the shell plus a small top banner, which is why answering a call meant
    // staring at a black screen.
    return (
      <View style={styles.ringRoot}>
        <IncomingCallOverlay
          call={{
            callerUid: matchData?.uid || '',
            callerName: profile.name,
            callerAvatarUrl: profile.uri,
            // Was omitted, so callers who use a built avatar rather than an
            // uploaded photo rang through as a generic person icon.
            callerAvatarData: (profile as any).avatarData,
            roomId: roomId || '',
            mode: mode,
            status: 'calling',
            timestamp: null,
          }}
          onAccept={() => {
            if (!ringSlotUid || !callRef.callerUid) return;
            // callStartRef is deliberately NOT set here from Date.now(): this
            // device's own clock can be skewed from the caller's, which
            // showed up as the two timers being permanently offset rather
            // than just briefly out of step. The incoming_calls listener
            // above sets it once the write's serverTimestamp resolves, so
            // both sides read the same instant off the same clock.
            //
            // The acceptance is recorded against *this* offer or not at all.
            // It used to be written straight into the ring slot whatever was in
            // it, so a second caller arriving in the moment between the phone
            // ringing and the tap got accepted instead: this device joined the
            // first caller's room while the newcomer was told they were through,
            // leaving two people in empty rooms and the newcomer paying for it.
            // The screen still moves on immediately -- the answer has to feel
            // instant -- and unwinds if the offer turns out to be gone.
            //
            // Leaving `isPending` set is what made every answered call fail:
            // it gates the effect that joins the RTC channel, so the receiver
            // sat on the ringing overlay having accepted in Firestore but
            // never joined. The caller joined an empty channel, waited out the
            // peer timeout alone, and both sides were told the connection had
            // been lost. Nothing else in the component clears this.
            setIsPending(false);
            acceptCallOffer(ringSlotUid, callRef).catch((e) => {
              console.warn('Failed to accept call:', e);
              if (e instanceof CallGoneError) {
                endCallWithNotice('Call ended', `${profile.name} is no longer on the line.`);
              } else {
                endCallWithNotice(
                  'Could not answer',
                  'Something went wrong answering that call. Please try again.'
                );
              }
            });
          }}
          onReject={() => {
            // Claim the teardown before writing: the rejection shows up on this
            // device's own listener almost immediately (Firestore surfaces the
            // local write before the server acknowledges it), and that listener
            // also leaves the screen. Without the claim both fire and the
            // navigator pops twice, landing the user a screen further back than
            // they were when the phone rang.
            if (endedRef.current) return;
            endedRef.current = true;
            if (ringSlotUid && callRef.callerUid) {
              rejectCallOffer(ringSlotUid, callRef).catch(e =>
                console.warn('Failed to reject call:', e)
              );
            }
            goBack();
          }}
        />
      </View>
    );
  }

  if (!isVideo) {
    return (
      <ScreenShell tone="light">
        {isConnecting && (
          <ConnectingOverlay 
            mode="private" 
            targetName={profile.name}
            onCancel={handleEndCall} 
            status={overlayStatus}
          />
        )}
        <View style={styles.voicePhone}>
          <View style={styles.voiceContent}>
            <View style={styles.voiceAvatarShadow}>
              <LinearGradient
                colors={['#FFFFFF', '#F2E7DD']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.voiceAvatarOuter}
              >
                <View style={styles.voiceAvatarInner}>
                  {/* `profile.uri` falls back to '' when the peer has no photo
                      (avatar-builder accounts store avatarData instead). An
                      Image with an empty uri warns on every render and draws a
                      blank box, so fall through to an icon rather than "" . */}
                  {(profile as any).avatarData ? (
                    <GengalAvatar data={(profile as any).avatarData} size={200} />
                  ) : profile.uri ? (
                    <Image source={{ uri: profile.uri }} style={styles.voiceAvatar} />
                  ) : (
                    <MaterialIcons name="person" size={120} color="#C9BDB2" />
                  )}
                </View>
              </LinearGradient>
            </View>

            <Text style={styles.voiceName}>{profile.age ? `${profile.name}, ${profile.age}` : profile.name}</Text>
            <Text style={[styles.voiceStatus, isPeerUnstable && { color: '#B30005', fontWeight: '800' }]}>
              {isPeerUnstable ? 'Reconnecting peer...' : 'Talking...'}
            </Text>
            <Text style={{ fontSize: 24, fontWeight: '700', color: '#4B0054', marginTop: 12 }}>{formatTimer(callDurationSeconds)}</Text>
            
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 16, backgroundColor: '#FFFDF8', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, boxShadow: Platform.OS === 'web' ? '0 4px 12px rgba(68, 44, 21, 0.05)' : undefined }}>
              <MaterialIcons name="account-balance-wallet" size={20} color="#D49A0B" />
              <Text style={{ fontSize: 16, fontWeight: '800', color: '#4B0054', marginLeft: 6 }}>
                {Math.floor(callerLiveCoins)} G
              </Text>
            </View>
          </View>

          <View style={styles.voiceControlsBar}>
            <View style={styles.voiceControls}>
              <TouchableOpacity style={styles.voiceControlItem} activeOpacity={0.82} onPress={toggleMic}>
                <View style={[styles.voiceControlButton, micMuted && styles.voiceControlButtonActive]}>
                  <MaterialIcons name={micMuted ? "mic-off" : "mic"} size={21} color={micMuted ? "#B30005" : "#4B0054"} />
                </View>
                <Text style={styles.voiceControlLabel}>{micMuted ? "Muted" : "Mute"}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.voiceControlItem} activeOpacity={0.82} onPress={toggleSpeaker}>
                <View style={[styles.voiceControlButton, speakerOn && styles.voiceControlButtonActive]}>
                  <MaterialIcons name={speakerOn ? "volume-up" : "volume-off"} size={21} color={speakerOn ? "#4B0054" : "#9A856E"} />
                </View>
                <Text style={styles.voiceControlLabel}>{speakerOn ? "Speaker" : "Earpiece"}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.voiceControlItem}
                activeOpacity={0.82}
                onPress={() => handleGift(100)} // Send 100G Rose
                disabled={isGifting}
              >
                <View style={[styles.voiceControlButton, { borderColor: '#E8CA58', borderWidth: 2 }]}>
                  <MaterialIcons name="card-giftcard" size={21} color="#E8CA58" />
                </View>
                <Text style={styles.voiceControlLabel}>{isGifting ? "Sending..." : "100G Rose"}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.voiceControlItem}
                activeOpacity={0.82}
                onPress={handleEndCall}
                disabled={isEnding}
                accessibilityRole="button"
                accessibilityLabel="End call"
              >
                <View style={styles.voiceEndButton}>
                  <MaterialIcons name="call-end" size={23} color="#FFFFFF" />
                </View>
                <Text style={styles.voiceEndLabel}>End</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell tone="dark">
      {isConnecting && (
        <ConnectingOverlay 
          mode="private" 
          targetName={profile.name}
          onCancel={handleEndCall} 
          status={overlayStatus}
        />
      )}
      <View style={styles.videoPhone}>
        {isPeerUnstable && (
          <View style={{
            position: 'absolute',
            top: 100,
            left: 20,
            right: 20,
            backgroundColor: 'rgba(180, 0, 5, 0.9)',
            padding: 12,
            borderRadius: 12,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}>
            <MaterialIcons name="wifi-off" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
            <Text style={{ color: '#FFFFFF', fontWeight: 'bold', fontSize: 15 }}>
              Connection unstable. Reconnecting...
            </Text>
          </View>
        )}
        {(currentProvider === 'agora' && RtcSurfaceView && remoteUids.length > 0) ? (
          <RtcSurfaceView canvas={{ uid: remoteUids[0] }} style={styles.videoRemoteImage} />
        ) : (
          <LinearGradient
            colors={['#1B0718', '#4B0054', '#11040F']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.videoOffBackdrop}
          >
            <View style={styles.videoOffHalo}>
              <LinearGradient
                colors={['#FFF8DF', '#B19622', '#F6D96B']}
                style={styles.videoOffAvatarRing}
              >
                <View style={styles.videoOffAvatarInner}>
                  {profile.avatarData ? (
                    <GengalAvatar data={profile.avatarData} size={110} />
                  ) : profile.uri ? (
                    <Image source={{ uri: profile.uri }} style={styles.videoOffAvatar} />
                  ) : (
                    <MaterialIcons name="person" size={70} color="#FFFDF8" />
                  )}
                </View>
              </LinearGradient>
              <View style={styles.videoOffIcon}>
                <MaterialIcons name="videocam-off" size={25} color="#4B0054" />
              </View>
            </View>
            <Text style={styles.videoOffName}>{profile.age ? `${profile.name}, ${profile.age}` : profile.name}</Text>
            <Text style={styles.videoOffStatus}>Connecting to video...</Text>
          </LinearGradient>
        )}
        <LinearGradient
          colors={cameraOn
            ? ['rgba(18, 6, 12, 0.62)', 'rgba(18, 6, 12, 0.04)', 'rgba(18, 6, 12, 0.32)']
            : ['rgba(18, 6, 12, 0.34)', 'rgba(18, 6, 12, 0.02)', 'rgba(18, 6, 12, 0.22)']}
          locations={[0, 0.42, 1]}
          style={styles.videoShade}
        />

        <View style={styles.videoTopBar}>
          <TouchableOpacity
            style={styles.videoCircleButton}
            hitSlop={tap42}
            activeOpacity={0.82}
            onPress={handleEndCall}
            disabled={isEnding}
            accessibilityRole="button"
            accessibilityLabel="End call and go back"
          >
            <MaterialIcons name="arrow-back" size={23} color="#4B0054" />
          </TouchableOpacity>
          <View style={styles.videoTitleBlock}>
            <Text style={styles.videoName} numberOfLines={1}>{profile.name}</Text>
          </View>
          <View style={styles.videoTimerPill}>
            <Text style={styles.videoTimer}>{formatTimer(callDurationSeconds)}</Text>
          </View>
          <View style={{ marginLeft: 6, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16 }}>
            <MaterialIcons name="account-balance-wallet" size={14} color="#D49A0B" />
            <Text style={{ fontSize: 13, fontWeight: '800', color: '#FFF', marginLeft: 3 }}>
              {Math.floor(callerLiveCoins)} G
            </Text>
          </View>
        </View>

        <View style={styles.selfPreview}>
          {cameraOn ? (
            (currentProvider === 'agora' && RtcSurfaceView && localUid !== null) ? (
              // zOrderMediaOverlay is required, not cosmetic. On Android an
              // RtcSurfaceView is a native SurfaceView, and two overlapping
              // SurfaceViews ignore React Native's view order — they composite
              // at the window level instead. Without this flag the fullscreen
              // remote view above wins, and the peer's video shows through
              // inside this box, so the self-preview appeared to be a second
              // copy of "their" camera. Note it must be zOrderMediaOverlay and
              // not zOrderOnTop: on-top would also paint over the call
              // controls and the top bar, which are ordinary RN views.
              <RtcSurfaceView
                canvas={{ uid: 0 }}
                zOrderMediaOverlay
                style={StyleSheet.absoluteFill}
              />
            ) : currentUserProfile?.avatarUrl ? (
              <Image source={{ uri: currentUserProfile.avatarUrl }} style={StyleSheet.absoluteFill} />
            ) : (
              <View style={styles.selfPreviewOffContent}>
                {currentUserProfile?.avatarData ? (
                  <GengalAvatar data={currentUserProfile.avatarData} size={50} />
                ) : (
                  <MaterialIcons name="person" size={34} color="#FFFDF8" />
                )}
              </View>
            )
          ) : (
            <View style={styles.selfPreviewOffContent}>
              {currentUserProfile?.avatarData ? (
                <GengalAvatar data={currentUserProfile.avatarData} size={50} />
              ) : currentUserProfile?.avatarUrl ? (
                <Image source={{ uri: currentUserProfile.avatarUrl }} style={styles.selfPreviewAvatar} />
              ) : (
                <MaterialIcons name="person" size={34} color="#FFFDF8" />
              )}
              <View style={styles.selfPreviewOffBadge}>
                <MaterialIcons name="videocam-off" size={15} color="#FFFDF8" />
              </View>
            </View>
          )}
        </View>

        <View style={styles.videoControlsTray}>
          <TouchableOpacity style={styles.videoControlItem} activeOpacity={0.82} onPress={toggleMic}>
            <View style={[styles.videoControlButton, micMuted && styles.videoControlButtonActive]}>
              <MaterialIcons name={micMuted ? "mic-off" : "mic"} size={22} color={micMuted ? "#B30005" : "#756A62"} />
            </View>
            <Text style={styles.videoControlLabel}>{micMuted ? "Muted" : "Mute"}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.videoControlItem}
            activeOpacity={0.82}
            onPress={toggleCamera}
          >
            <View style={[styles.videoControlButton, !cameraOn && styles.videoControlButtonActive]}>
              <MaterialIcons name={cameraOn ? 'videocam' : 'videocam-off'} size={22} color={cameraOn ? '#756A62' : '#B30005'} />
            </View>
            <Text style={styles.videoControlLabel}>{cameraOn ? "Camera" : "Cam Off"}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.videoControlItem} activeOpacity={0.82} onPress={flipCamera}>
            <View style={styles.videoControlButton}>
              <MaterialIcons name="flip-camera-ios" size={22} color="#756A62" />
            </View>
            <Text style={styles.videoControlLabel}>Flip</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.videoControlItem}
            activeOpacity={0.82}
            onPress={handleEndCall}
            disabled={isEnding}
            accessibilityRole="button"
            accessibilityLabel="End call"
          >
            <View style={styles.videoEndButton}>
              <MaterialIcons name="call-end" size={25} color="#FFFFFF" />
            </View>
            <Text style={styles.videoEndLabel}>End</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  // The ringing screen is full-bleed; IncomingCallOverlay paints its own
  // backdrop and handles its own safe-area insets.
  ringRoot: { flex: 1, backgroundColor: '#1A0714' },
  voicePhone: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 430,
    backgroundColor: '#FFFCF7',
  },
  voiceContent: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 34,
    backgroundColor: '#FFFCF7',
  },
  voiceAvatarShadow: {
    width: 212,
    height: 212,
    borderRadius: 106,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    boxShadow: Platform.OS === 'web' ? '0 12px 28px rgba(72, 54, 42, 0.22)' : undefined,
  },
  voiceAvatarOuter: {
    width: 202,
    height: 202,
    borderRadius: 101,
    padding: 5,
  },
  voiceAvatarInner: {
    flex: 1,
    borderRadius: 96,
    padding: 5,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  voiceAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: 91,
  },
  voiceName: {
    marginTop: 62,
    color: '#4B0054',
    fontFamily: 'serif',
    fontSize: 33,
    fontWeight: '900',
  },
  voiceStatus: {
    marginTop: 4,
    color: '#9A7A08',
    fontFamily: 'serif',
    fontSize: 21,
    fontStyle: 'italic',
    fontWeight: '700',
  },
  voiceControlsBar: {
    minHeight: 154,
    paddingHorizontal: 22,
    paddingTop: 26,
    paddingBottom: 26,
    backgroundColor: '#F9F5EF',
    borderTopWidth: 1,
    borderTopColor: '#EFE8DD',
    boxShadow: Platform.OS === 'web' ? '0 -12px 28px rgba(80, 55, 36, 0.10)' : undefined,
  },
  voiceControls: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  voiceControlItem: {
    width: 78,
    alignItems: 'center',
    gap: 10,
  },
  voiceControlButton: {
    width: 66,
    height: 66,
    borderRadius: 33,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1ECE4',
    borderWidth: 1,
    borderColor: '#FFFFFF',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  voiceControlButtonActive: {
    backgroundColor: '#EADCD0',
    boxShadow: Platform.OS === 'web' ? '0 2px 4px rgba(0,0,0,0.1)' : undefined,
  },
  voiceEndButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#B30005',
    borderWidth: 1,
    borderColor: '#C53A3A',
    boxShadow: Platform.OS === 'web' ? '0 11px 20px rgba(179, 0, 5, 0.28)' : undefined,
  },
  voiceControlLabel: {
    color: '#3E3440',
    fontSize: 13,
    fontWeight: '800',
  },
  voiceEndLabel: {
    color: '#B30005',
    fontSize: 13,
    fontWeight: '900',
  },
  videoPhone: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 430,
    overflow: 'hidden',
    backgroundColor: '#12060F',
  },
  videoRemoteImage: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  videoShade: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  videoOffBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  videoOffHalo: {
    width: 188,
    height: 188,
    borderRadius: 94,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 253, 248, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 248, 222, 0.18)',
    boxShadow: Platform.OS === 'web' ? '0 20px 44px rgba(0, 0, 0, 0.36)' : undefined,
  },
  videoOffAvatarRing: {
    width: 152,
    height: 152,
    borderRadius: 76,
    padding: 4,
  },
  videoOffAvatarInner: {
    flex: 1,
    borderRadius: 72,
    padding: 4,
    backgroundColor: '#FFFDF8',
    overflow: 'hidden',
  },
  videoOffAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: 68,
  },
  videoOffIcon: {
    position: 'absolute',
    right: 17,
    bottom: 19,
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFDF8',
    borderWidth: 2,
    borderColor: '#CFB13D',
    boxShadow: Platform.OS === 'web' ? '0 10px 18px rgba(0, 0, 0, 0.24)' : undefined,
  },
  videoOffName: {
    marginTop: 28,
    color: '#FFF7EA',
    fontFamily: 'serif',
    fontSize: 31,
    fontWeight: '900',
    textAlign: 'center',
  },
  videoOffStatus: {
    marginTop: 7,
    color: '#E9D79D',
    fontSize: 13,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  videoTopBar: {
    position: 'absolute',
    top: 16,
    left: 18,
    right: 18,
    height: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  videoCircleButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 247, 244, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255, 247, 244, 0.42)',
    boxShadow: Platform.OS === 'web' ? '0 8px 20px rgba(23, 5, 18, 0.32)' : undefined,
  },
  videoTitleBlock: {
    flex: 1,
    justifyContent: 'center',
    marginHorizontal: 8,
  },
  videoName: {
    color: '#FFF7EA',
    fontFamily: 'serif',
    fontSize: 21,
    fontWeight: '900',
    ...(Platform.OS === 'web' ? { textShadow: '0px 2px 8px rgba(0, 0, 0, 0.42)' } : {
      textShadowColor: 'rgba(0, 0, 0, 0.42)',
      textShadowOffset: { width: 0, height: 2 },
      textShadowRadius: 8,
    }) as any,
  },
  videoTimerPill: {
    minWidth: 62,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 247, 244, 0.75)',
    borderWidth: 1,
    borderColor: 'rgba(255, 247, 244, 0.46)',
  },
  videoTimer: {
    color: '#755D56',
    fontSize: 11,
    fontWeight: '900',
  },
  selfPreview: {
    position: 'absolute',
    top: 106,
    right: 16,
    width: 120,
    height: 160,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
    elevation: 8,
  },
  selfPreviewOffContent: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selfPreviewAvatar: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 3,
    borderColor: '#D3B742',
  },
  selfPreviewOffBadge: {
    position: 'absolute',
    right: 12,
    bottom: 13,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4B0054',
    borderWidth: 2,
    borderColor: '#FFFDF8',
  },
  videoControlsTray: {
    position: 'absolute',
    left: 30,
    right: 30,
    bottom: 38,
    minHeight: 116,
    borderRadius: 36,
    paddingHorizontal: 14,
    paddingTop: 16,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 249, 242, 0.78)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.34)',
    boxShadow: Platform.OS === 'web' ? '0 14px 30px rgba(18, 6, 15, 0.28)' : undefined,
  },
  videoControlItem: {
    width: 68,
    alignItems: 'center',
    gap: 8,
  },
  videoControlButton: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1ECE4',
    borderWidth: 1,
    borderColor: '#FFFFFF',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  videoControlButtonActive: {
    backgroundColor: '#FFF1C2',
    borderWidth: 1,
    borderColor: '#D3B742',
  },
  videoEndButton: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#C90812',
    boxShadow: Platform.OS === 'web' ? '0 12px 22px rgba(201, 8, 18, 0.3)' : undefined,
  },
  videoControlLabel: {
    color: '#3E3440',
    fontSize: 13,
    fontWeight: '900',
    ...(Platform.OS === 'web' ? { textShadow: '0px 1px 4px rgba(255, 255, 255, 0.3)' } : {
      textShadowColor: 'rgba(255, 255, 255, 0.3)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 4,
    }) as any,
  },
  videoEndLabel: {
    color: '#B30005',
    fontSize: 13,
    fontWeight: '900',
  },
});
