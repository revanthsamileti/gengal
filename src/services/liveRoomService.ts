import { db } from '../config/firebase';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import { isUserInCall, UserProfile } from './userService';

export interface IncomingCall {
  callerUid: string;
  callerName: string;
  callerAvatarUrl?: string | null;
  callerAvatarData?: any;
  roomId: string;
  mode: 'call' | 'video';
  status: 'calling' | 'accepted' | 'rejected';
  /** Why a 'rejected' offer was rejected. Absent on older/other writes. */
  rejectReason?: RejectReason;
  timestamp: any;
  /** Set by acceptCallOffer; the shared moment both sides base their on-screen
   *  timer on, so the two devices' timers start from the same instant instead
   *  of each starting from 0 whenever *its own* accept-confirmation arrives. */
  acceptedAt?: any;
}

/** How long an un-answered offer stays ringable if the caller vanishes without clearing it. */
export const OFFER_EXPIRY_MS = 60000;

/**
 * Why an offer was turned down.
 *
 * 'busy' is an automatic decline by a device that is already on a call, and
 * saying so matters: the caller was told "they declined your call" for a call
 * the other person never saw a ring for and had no chance to answer.
 */
export type RejectReason = 'declined' | 'busy';

/**
 * Identifies one specific call.
 *
 * `incoming_calls/{receiverUid}` is a single-slot mailbox: every caller writes
 * to the same document id, and "last call wins" means a second caller replaces
 * whatever is in it. Every read and write below therefore has to say *which*
 * call it means, or it silently acts on a stranger's.
 *
 * That was not a theoretical gap. Unscoped, a second person dialling someone
 * who was already mid-call replaced the slot, and from there: the receiver's
 * busy-guard wrote `rejected` into the newcomer's offer, the receiver's own
 * in-call listener read that `rejected` as "the person I am talking to hung
 * up" and tore the live call down, and the original caller -- no longer the
 * slot's owner, so no longer permitted to read it -- lost its status listener
 * and ended too. A stranger's unanswered call dropped a conversation between
 * two other people. Worse, if the receiver was still ringing when the slot was
 * replaced, tapping Accept accepted the *newcomer's* offer while joining the
 * *first* caller's room: two people connected to empty rooms, and the newcomer
 * was billed for it.
 */
export interface CallRef {
  callerUid: string;
  roomId: string;
}

/** True when the slot still holds the exact offer `call` refers to. */
const isSameCall = (data: IncomingCall | undefined, call: CallRef): boolean =>
  !!data && data.callerUid === call.callerUid && data.roomId === call.roomId;

export class ReceiverBusyError extends Error {
  constructor() {
    super('RECEIVER_BUSY');
    this.name = 'ReceiverBusyError';
  }
}

/**
 * The offer this operation meant to act on is no longer in the slot -- it was
 * cancelled, already answered, or replaced by another caller. Distinct from a
 * write failure: nothing went wrong, the call simply no longer exists.
 */
export class CallGoneError extends Error {
  constructor() {
    super('CALL_GONE');
    this.name = 'CallGoneError';
  }
}

/**
 * How long the offer write may take before we give up on it.
 *
 * A Firestore write promise resolves on server acknowledgement, and there is no
 * offline path here, so on a degraded connection it sits pending -- it never
 * resolves and never rejects. This is not hypothetical, it is what the
 * collision fix originally shipped with: the caller sat on "Connecting..."
 * indefinitely, nothing reached incoming_calls, and neither the success nor the
 * failure branch of the caller ever ran. The caller's own 45 s ring timeout
 * could not save it either, because that timer only arms once the call reaches
 * the *ringing* step, which is exactly what the hang prevents.
 *
 * Ten seconds is far longer than a healthy write (tens of milliseconds) and
 * still well inside a caller's patience for "is this dialling or not".
 */
const OFFER_WRITE_TIMEOUT_MS = 10000;

export class CallSetupTimeoutError extends Error {
  constructor() {
    super('CALL_SETUP_TIMEOUT');
    this.name = 'CallSetupTimeoutError';
  }
}

/**
 * Whether `receiverUid` is already on a call, judged from a signal the caller
 * is actually allowed to read.
 *
 * The obvious place to look is the receiver's own `incoming_calls` document,
 * and an earlier version of this did exactly that inside a transaction. It
 * cannot work: the read rule on that collection only admits the receiver and
 * the offer's *own* caller, so `get()` on an offer belonging to somebody else
 * is denied outright -- which is precisely the case a busy check exists to
 * detect. Worse, the denial is indiscriminate: a stale, abandoned offer reads
 * as denied too, so a receiver whose last offer was never cleaned up became
 * permanently unreachable, the exact failure the "last call wins" overwrite
 * was designed to prevent. Keeping that document private is correct -- it
 * carries a third party's name, avatar and room id -- so the check moves
 * rather than the rule.
 *
 * `users/{uid}.inCallSince` is the right source instead: readable by any
 * signed-in user, written only by the server's billing tick (`inCallSince` is
 * absent from userMutableKeys, so a client cannot forge or clear it), and
 * self-expiring, so a call that ends by crash ages out instead of stranding
 * someone as forever busy. See isUserInCall / CALL_BUSY_TTL_MS.
 *
 * Failing open is deliberate. A profile read that errors must not cost the
 * user a call: the receiver's own busy guard (App.tsx) auto-declines a second
 * call regardless, so this is an early, friendlier "line busy" rather than the
 * thing that enforces it.
 *
 * What this does not cover: two callers dialling an *idle* receiver within the
 * same moment, where neither is marked busy yet. That collision is not
 * resolvable on the client without exposing the offer document, and it
 * degrades safely -- the receiver rings for whoever's write landed last, and
 * the other caller times out on "No answer".
 */
const isReceiverBusy = async (receiverUid: string): Promise<boolean> => {
  try {
    const snap = await getDoc(doc(db, 'users', receiverUid));
    return snap.exists() && isUserInCall(snap.data() as UserProfile);
  } catch (e) {
    console.warn('[liveRoomService] Busy check failed; proceeding with the call:', e);
    return false;
  }
};

export const createCallOffer = async (
  callerUid: string,
  receiverUid: string,
  callerName: string,
  callerAvatarUrl: string | null,
  callerAvatarData: any,
  mode: 'call' | 'video',
  roomId: string
) => {
  const callRef = doc(db, 'incoming_calls', receiverUid);

  const offerWrite = (async () => {
    if (await isReceiverBusy(receiverUid)) throw new ReceiverBusyError();

    // Whether this overwrites an existing offer is decided by the `update` rule
    // in firestore.rules, not here: a client cannot read another caller's offer
    // (by design -- it carries a third party's name, avatar and room id), so it
    // cannot judge for itself whether the slot is free. The rule admits the
    // overwrite only when the receiver is not on a call and any offer already
    // in the slot has gone stale, which is what keeps the first of two
    // simultaneous callers from being silently displaced while still ringing --
    // and what stops an offer left uncleared by a crash from blocking that
    // receiver forever.
    try {
      await setDoc(callRef, {
        callerUid,
        // Security rules require receiverUid to match the document id on create.
        // Without it every outbound offer is rejected.
        receiverUid,
        callerName,
        callerAvatarUrl,
        callerAvatarData: callerAvatarData || null,
        roomId,
        mode,
        status: 'calling',
        timestamp: serverTimestamp(),
      });
    } catch (e: any) {
      // The only thing that rule denies is writing over a live offer or a
      // receiver who is already talking to someone, so this is "line busy"
      // rather than a fault -- and saying so is the whole point of enforcing
      // it server-side. The busy pre-check above catches the common case
      // first; this catches the two-callers-in-the-same-instant case it
      // cannot see.
      if (e?.code === 'permission-denied') throw new ReceiverBusyError();
      throw e;
    }
  })();

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      offerWrite,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new CallSetupTimeoutError()), OFFER_WRITE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    // The write is not cancellable, so it may still land after we have given up
    // on it. Swallow its eventual outcome rather than letting a late rejection
    // surface as an unhandled promise rejection long after the caller has
    // already been told the call failed.
    offerWrite.catch(() => {});
  }

  // Push delivery is server-side: the receiver's Expo token lives in a
  // private document the caller cannot read.
  notifyIncomingCall(receiverUid, mode).catch((e) =>
    console.warn('[liveRoomService] Failed to dispatch push notification:', e)
  );
};

const notifyIncomingCall = async (receiverUid: string, mode: 'call' | 'video') => {
  const [{ auth }, { getBackendUrl }] = await Promise.all([
    import('../config/firebase'),
    import('./authService'),
  ]);
  const user = auth.currentUser;
  if (!user) return;

  const idToken = await user.getIdToken();
  await fetch(`${getBackendUrl()}/api/v1/calls/notify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ receiverUid, mode }),
  });
};

/**
 * How long we will wait for the missed-call push before deleting the offer
 * anyway. Deleting the offer is what actually ends the call for both sides, so
 * it must never be held hostage by a slow network.
 *
 * Kept short because this sits in the caller's teardown: every millisecond here
 * is a millisecond the caller stares at a call screen that is already over. One
 * POST on a working connection is well inside this; a connection that is not
 * working will not deliver the push at a longer timeout either.
 */
const MISSED_CALL_TIMEOUT_MS = 1200;

/**
 * Asks the server to turn the receiver's ringing notification into a swipeable
 * "Missed call".
 *
 * The call notification is posted sticky so it cannot be flicked away while
 * the phone is ringing; the price is that something has to take it down again
 * when the call dies, or a receiver whose app is closed is left with a
 * notification they cannot remove.
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
  // on somebody else's phone to clean up.
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

/**
 * "I am still here", written to the call's own record.
 *
 * These used to live on `incoming_calls/{receiverUid}` alongside the offer,
 * which tied the liveness of an established call to a document any later
 * caller can replace. Once replaced, the caller was no longer permitted to
 * write to it, its heartbeats stopped landing, and forty-five seconds later
 * the receiver's watchdog announced that the caller's connection had been lost
 * and hung up on a call that was working perfectly. `calls/{roomId}` is
 * per-call, writable by both participants and already watched by both, so
 * nothing outside the call can interfere with it.
 */
export const updateCallHeartbeat = async (roomId: string, role: 'caller' | 'receiver') => {
  try {
    const recordRef = doc(db, 'calls', roomId);
    await updateDoc(recordRef, {
      [role === 'caller' ? 'callerHeartbeat' : 'receiverHeartbeat']: Date.now(),
    });
  } catch (e) {
    console.warn(`[liveRoomService] Failed to update heartbeat for ${role}:`, e);
  }
};

export const subscribeToIncomingCalls = (uid: string, onUpdate: (call: IncomingCall | null) => void) => {
  const callRef = doc(db, 'incoming_calls', uid);

  /**
   * Offer age is measured from when *this* device first saw it, deliberately
   * not by subtracting the document's serverTimestamp from a local Date.now().
   * Those are two different clocks, and the comparison failed closed: a handset
   * running even a minute fast judged every freshly-written offer to be already
   * expired, so it never rang and logged nothing to say why. This is the same
   * clock-mixing mistake that was already fixed once for the in-call timer.
   */
  let firstSeenAt: number | null = null;
  let firstSeenKey: string | null = null;

  return onSnapshot(callRef, (docSnap) => {
    if (!docSnap.exists()) {
      firstSeenAt = null;
      firstSeenKey = null;
      onUpdate(null);
      return;
    }

    const data = docSnap.data() as IncomingCall;

    // Only show the overlay while actively calling.
    if (data.status !== 'calling') {
      onUpdate(null);
      return;
    }

    // A genuinely new offer restarts the window; repeat writes to the same one
    // (heartbeats, status churn) must not keep extending it.
    const offerKey = `${data.callerUid}:${data.roomId}`;
    if (firstSeenKey !== offerKey) {
      firstSeenKey = offerKey;
      firstSeenAt = Date.now();
    }

    if (Date.now() - (firstSeenAt ?? Date.now()) > OFFER_EXPIRY_MS) {
      onUpdate(null);
    } else {
      onUpdate(data);
    }
  }, (error) => {
    // Without this the SDK reports "Uncaught Error in snapshot listener" and
    // the rejection surfaces as a redbox on whatever screen happens to be
    // mounted. Worse, the listener is torn down: this is how the app learns it
    // is being called, so losing it silently means the account looks online and
    // simply never rings.
    console.error('[liveRoomService] Incoming-call listener stopped:', error);
    onUpdate(null);
  });
};

/**
 * What the caller's own offer is doing.
 *
 * `gone` -- the offer is no longer there: the receiver hung up, or we cleared
 * it ourselves. `taken` -- the slot now holds somebody else's call, so ours
 * was displaced and will never be answered. They are separated because only
 * `taken` can honestly be reported to the caller as "they are unavailable".
 */
export type OutboundCallStatus = 'calling' | 'accepted' | 'rejected' | 'gone' | 'taken';

export const subscribeToOutboundCallStatus = (
  receiverUid: string,
  call: CallRef,
  onUpdate: (status: OutboundCallStatus, data?: IncomingCall) => void
) => {
  const callRef = doc(db, 'incoming_calls', receiverUid);
  return onSnapshot(callRef, (docSnap) => {
    if (!docSnap.exists()) {
      onUpdate('gone');
      return;
    }
    const data = docSnap.data() as IncomingCall;
    // Reporting another call's status as our own is how a caller ended up
    // "accepted" -- and billed -- for a conversation the receiver was having
    // with somebody else, and how an unrelated decline surfaced as "they
    // declined your call".
    if (!isSameCall(data, call)) {
      onUpdate('taken');
      return;
    }
    onUpdate(data.status, data);
  }, (error) => {
    // The caller watches the *receiver's* document, so the rule's
    // `request.auth.uid == receiverId` arm is false and it falls through to
    // `resource.data.callerUid`. A document that does not exist is explicitly
    // readable (the `resource == null` arm), so a denial here means the slot
    // exists and belongs to a different caller -- our offer was replaced.
    // Anything else is a transport failure; either way this listener is
    // terminal, so the call has to end rather than sit with no signalling.
    const displaced = (error as any)?.code === 'permission-denied';
    console.warn('[liveRoomService] Outbound-call listener stopped:', error);
    onUpdate(displaced ? 'taken' : 'gone');
  });
};

/**
 * Answers `call`, and only `call`.
 *
 * Transactional because the check and the write have to be one step: between a
 * plain read and a plain write another caller can replace the slot, which is
 * precisely the race being closed. A bare merge-write here used to accept
 * whichever offer happened to be in the slot at that instant -- so a receiver
 * who tapped Accept just as a second call landed answered the newcomer while
 * their own screen (and the room they joined) still belonged to the first
 * caller.
 *
 * Throws CallGoneError when the offer has been withdrawn or replaced, so the
 * screen can say "call ended" instead of connecting to nobody.
 */
export const acceptCallOffer = async (receiverUid: string, call: CallRef) => {
  const callRef = doc(db, 'incoming_calls', receiverUid);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(callRef);
    const data = snap.exists() ? (snap.data() as IncomingCall) : undefined;
    // A merge write on a deleted document re-creates it, and the re-created
    // document would carry only these two fields -- no callerUid, no roomId --
    // which the create rule rejects outright and which nothing could interpret
    // anyway. Failing loudly on the caller-hung-up-mid-answer race is right.
    if (!isSameCall(data, call) || data!.status === 'rejected') throw new CallGoneError();
    tx.set(callRef, { status: 'accepted', acceptedAt: serverTimestamp() }, { merge: true });
  });
};

/**
 * Declines `call`. Used both by the receiver tapping Decline and by the
 * busy-guard in App.tsx auto-declining a call that arrives mid-conversation.
 *
 * Silently does nothing when the slot has moved on: an auto-decline that fired
 * a moment late must not stamp `rejected` onto a *different* caller's offer,
 * which is how one person's declined call used to end somebody else's.
 * Resolves to whether the decline actually applied.
 */
export const rejectCallOffer = async (
  receiverUid: string,
  call: CallRef,
  reason: RejectReason = 'declined'
): Promise<boolean> => {
  const callRef = doc(db, 'incoming_calls', receiverUid);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(callRef);
    const data = snap.exists() ? (snap.data() as IncomingCall) : undefined;
    if (!isSameCall(data, call)) return false;
    tx.set(callRef, { status: 'rejected', rejectReason: reason }, { merge: true });
    return true;
  });
};

/**
 * Removes the offer once the call is over, but only while it is still ours.
 *
 * Both sides run this when a call ends, and the receiver is allowed to delete
 * their own slot unconditionally -- so an unscoped delete here erased a *new*
 * caller's offer that had arrived in the meantime, and that caller rang on
 * into a document nobody was watching. The caller side was already protected
 * by the delete rule, but only by accident of the rule, and it logged a
 * failure every time.
 */
export const clearCallOffer = async (receiverUid: string, call: CallRef) => {
  // Before the delete, because the live offer is what proves to the server that
  // this caller may touch that receiver's notification. Bounded, and it
  // swallows its own failures: the delete below is what ends the call.
  await Promise.race([
    announceMissedCall(receiverUid, call).catch(() => {}),
    new Promise<void>((resolve) => setTimeout(resolve, MISSED_CALL_TIMEOUT_MS)),
  ]);

  const callRef = doc(db, 'incoming_calls', receiverUid);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(callRef);
    if (!snap.exists()) return;
    if (!isSameCall(snap.data() as IncomingCall, call)) return;
    tx.delete(callRef);
  });
};

/**
 * Call history. ActivityScreen reads the `calls` collection, but nothing used to
 * write to it, so the screen was permanently empty. The caller opens the record
 * and whichever side hangs up first closes it.
 */
export const openCallRecord = async (
  roomId: string,
  caller: { uid: string; name: string; avatarUrl?: string | null; avatarData?: any },
  receiver: { uid: string; name: string; avatarUrl?: string | null; avatarData?: any },
  mode: 'call' | 'video'
) => {
  const callRef = doc(db, 'calls', roomId);
  await setDoc(callRef, {
    callerUid: caller.uid,
    callerName: caller.name,
    callerAvatarUrl: caller.avatarUrl || null,
    callerAvatarData: caller.avatarData || null,
    receiverUid: receiver.uid,
    receiverName: receiver.name,
    receiverAvatarUrl: receiver.avatarUrl || null,
    receiverAvatarData: receiver.avatarData || null,
    mode,
    status: 'active',
    durationSeconds: 0,
    coinsDeducted: 0,
    heartsEarned: 0,
    // Heart awards are capped to server-billed duration minus these counters
    // (see /api/v1/coins/call-rewards). Seeded at zero so the first tick has
    // a definite baseline rather than treating a missing field as untrusted.
    callerRewardedSeconds: 0,
    receiverRewardedSeconds: 0,
    createdAt: serverTimestamp(),
  });
};

/**
 * Marks the call finished. Duration and coins are deliberately not written here:
 * the billing endpoint accumulates both from the server clock, and letting the
 * client set them would overwrite the authoritative values.
 */
export const closeCallRecord = async (roomId: string) => {
  try {
    await updateDoc(doc(db, 'calls', roomId), {
      status: 'ended',
      endedAt: serverTimestamp(),
    });
  } catch (e) {
    console.warn('[liveRoomService] Failed to close call record:', e);
  }
};
