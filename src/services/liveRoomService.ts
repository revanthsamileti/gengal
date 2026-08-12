import { db } from '../config/firebase';
import {
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';

export interface IncomingCall {
  callerUid: string;
  callerName: string;
  callerAvatarUrl?: string | null;
  callerAvatarData?: any;
  roomId: string;
  mode: 'call' | 'video';
  status: 'calling' | 'accepted' | 'rejected';
  timestamp: any;
  /** Set by acceptCallOffer; the shared moment both sides base their on-screen
   *  timer on, so the two devices' timers start from the same instant instead
   *  of each starting from 0 whenever *its own* accept-confirmation arrives. */
  acceptedAt?: any;
}

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
    callerHeartbeat: Date.now(),
    receiverHeartbeat: Date.now(),
  });

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

export const updateCallHeartbeat = async (receiverUid: string, role: 'caller' | 'receiver') => {
  try {
    const callRef = doc(db, 'incoming_calls', receiverUid);
    if (role === 'caller') {
      await updateDoc(callRef, { callerHeartbeat: Date.now() });
    } else {
      await updateDoc(callRef, { receiverHeartbeat: Date.now() });
    }
  } catch (e) {
    console.warn(`[liveRoomService] Failed to update heartbeat for ${role}:`, e);
  }
};

/** How long an un-answered offer stays ringable if the caller vanishes without clearing it. */
const OFFER_EXPIRY_MS = 60000;

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

export const subscribeToOutboundCallStatus = (receiverUid: string, onUpdate: (status: 'calling' | 'accepted' | 'rejected' | null, data?: IncomingCall) => void) => {
  const callRef = doc(db, 'incoming_calls', receiverUid);
  return onSnapshot(callRef, (docSnap) => {
    if (docSnap.exists()) {
      const data = docSnap.data() as IncomingCall;
      onUpdate(data.status, data);
    } else {
      onUpdate(null);
    }
  }, (error) => {
    // The caller watches the *receiver's* document, so the rule's
    // `request.auth.uid == receiverId` arm is false and it falls through to
    // `resource.data.callerUid`. On a document that does not exist -- before
    // the offer is written, or right after either side deletes it -- there is
    // no `resource`, so that evaluates to permission-denied rather than "not
    // found". Treating it as "no active call" matches the not-exists branch.
    console.warn('[liveRoomService] Outbound-call listener stopped:', error);
    onUpdate(null);
  });
};

export const acceptCallOffer = async (receiverUid: string) => {
  const callRef = doc(db, 'incoming_calls', receiverUid);
  await setDoc(callRef, { status: 'accepted', acceptedAt: serverTimestamp() }, { merge: true });
};

export const rejectCallOffer = async (receiverUid: string) => {
  const callRef = doc(db, 'incoming_calls', receiverUid);
  await setDoc(callRef, { status: 'rejected' }, { merge: true });
};

export const cancelCallOffer = async (receiverUid: string) => {
  // Same as rejecting, just mark as rejected
  const callRef = doc(db, 'incoming_calls', receiverUid);
  await setDoc(callRef, { status: 'rejected' }, { merge: true });
};

export const clearCallOffer = async (receiverUid: string) => {
  const callRef = doc(db, 'incoming_calls', receiverUid);
  await deleteDoc(callRef);
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
