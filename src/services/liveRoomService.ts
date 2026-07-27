import { db } from '../config/firebase';
import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  serverTimestamp,
  getDocs,
  getDoc,
} from 'firebase/firestore';

export interface LiveRoom {
  hostUid: string;
  status: 'available' | 'busy';
  currentGuestUid?: string | null;
  createdAt: any;
}

export interface CallRequest {
  requesterUid: string;
  requesterName: string;
  requestedAt: any;
}

/**
 * Creates a public live room for the current user, marking them as available.
 */
export const createLiveRoom = async (uid: string) => {
  const roomRef = doc(db, 'public_rooms', uid);
  await setDoc(roomRef, {
    hostUid: uid,
    status: 'available',
    currentGuestUid: null,
    createdAt: serverTimestamp(),
  });
};

/**
 * Ends the live room for the current user.
 */
export const endLiveRoom = async (uid: string) => {
  const roomRef = doc(db, 'public_rooms', uid);
  await deleteDoc(roomRef);
};

/**
 * Updates the status of the live room (e.g., to 'busy' when a call starts).
 */
export const setLiveRoomStatus = async (uid: string, status: 'available' | 'busy', guestUid?: string) => {
  const roomRef = doc(db, 'public_rooms', uid);
  const updateData: Partial<LiveRoom> = { status };
  if (guestUid !== undefined) {
    updateData.currentGuestUid = guestUid;
  }
  try {
    await setDoc(roomRef, updateData, { merge: true });
  } catch (e) {
    console.warn("Could not set live room status:", e);
  }
};

/**
 * Adds a call request to a busy host's room.
 */
export const requestToCall = async (hostUid: string, requesterUid: string, requesterName: string) => {
  const requestRef = doc(db, 'public_rooms', hostUid, 'requests', requesterUid);
  await setDoc(requestRef, {
    requesterUid,
    requesterName,
    requestedAt: serverTimestamp(),
  });
};

/**
 * Subscribes to all active live rooms.
 */
export const subscribeToLiveRooms = (onUpdate: (rooms: Record<string, LiveRoom>) => void) => {
  const q = query(collection(db, 'public_rooms'));
  return onSnapshot(q, (snapshot) => {
    const rooms: Record<string, LiveRoom> = {};
    snapshot.forEach((docSnap) => {
      rooms[docSnap.id] = docSnap.data() as LiveRoom;
    });
    onUpdate(rooms);
  });
};

/**
 * Fetches pending requests for a host's room.
 */
export const getPendingRequests = async (hostUid: string): Promise<CallRequest[]> => {
  const requestsRef = collection(db, 'public_rooms', hostUid, 'requests');
  const snapshot = await getDocs(requestsRef);
  return snapshot.docs.map(doc => doc.data() as CallRequest).sort((a, b) => {
    const timeA = a.requestedAt?.toMillis?.() || 0;
    const timeB = b.requestedAt?.toMillis?.() || 0;
    return timeA - timeB; // oldest first
  });
};

/**
 * Clears all requests for a host
 */
export const clearAllRequests = async (hostUid: string) => {
  const requestsRef = collection(db, 'public_rooms', hostUid, 'requests');
  const snapshot = await getDocs(requestsRef);
  const deletePromises = snapshot.docs.map(d => deleteDoc(d.ref));
  await Promise.all(deletePromises);
};

export interface IncomingCall {
  callerUid: string;
  callerName: string;
  callerAvatarUrl?: string | null;
  callerAvatarData?: any;
  roomId: string;
  mode: 'call' | 'video';
  status: 'calling' | 'accepted' | 'rejected';
  timestamp: any;
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

  // Attempt to fetch recipient's Expo push token for background signaling
  try {
    const userSnap = await getDoc(doc(db, 'users', receiverUid));
    if (userSnap.exists()) {
      const data = userSnap.data();
      if (data && data.expoPushToken) {
        console.log("[liveRoomService] Sending Expo push notification for incoming call...");
        fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: data.expoPushToken,
            title: `Incoming ${mode === 'video' ? 'Video' : 'Voice'} Call`,
            body: `${callerName} is calling you...`,
            data: {
              roomId,
              mode,
              callerUid,
              callerName,
              isIncomingPending: true,
            },
            sound: 'default',
            priority: 'high',
          })
        }).catch(e => console.warn("Failed to dispatch push notification:", e));
      }
    }
  } catch (err) {
    console.warn("[liveRoomService] Failed to fetch push token for receiver:", err);
  }
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

export const subscribeToIncomingCalls = (uid: string, onUpdate: (call: IncomingCall | null) => void) => {
  const callRef = doc(db, 'incoming_calls', uid);
  return onSnapshot(callRef, (docSnap) => {
    if (docSnap.exists()) {
      const data = docSnap.data() as IncomingCall;
      
      // Only show overlay if actively calling
      if (data.status !== 'calling') {
        onUpdate(null);
        return;
      }
      
      // Auto-expire after 60 seconds (in case caller disconnects abruptly without deleting)
      const now = Date.now();
      const callTime = data.timestamp?.toMillis?.() || now;
      if (now - callTime > 60000) {
        onUpdate(null);
      } else {
        onUpdate(data);
      }
    } else {
      onUpdate(null);
    }
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
  });
};

export const acceptCallOffer = async (receiverUid: string) => {
  const callRef = doc(db, 'incoming_calls', receiverUid);
  await setDoc(callRef, { status: 'accepted' }, { merge: true });
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
