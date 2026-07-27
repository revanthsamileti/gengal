import { db } from '../config/firebase';
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  getDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  increment,
  limit,
  Timestamp,
  setDoc,
  deleteDoc,
  runTransaction,
} from 'firebase/firestore';
import { transferCoins } from './coinService';

export type RoomStatus = 'live' | 'closed';
export type RoomTier = 'VIP' | 'Advance' | 'Standard';

export interface SpeakerSlot {
  uid: string;
  nickname: string;
  avatarData?: any;
  isMuted: boolean;
  gender?: 'boy' | 'girl';
}

export interface ExpertRoom {
  id?: string;
  hostUid: string;
  hostNickname: string;
  hostAvatarData?: any;
  topic: string;
  language: string;
  tier: RoomTier;
  ratePerMin: number;
  status: RoomStatus;
  // hand-raise queue — uids who tapped "Raise Hand"
  handQueue: string[];
  handQueueBoy?: string[];
  handQueueGirl?: string[];
  // uids currently on stage (speakers), max ~4
  speakers: SpeakerSlot[];
  activeMemberCount: number;
  // uid whose profile is currently being reviewed (shown in shared modal)
  reviewingUid?: string | null;
  reviewingNickname?: string | null;
  reviewingAvatarData?: any | null;
  reviewingBio?: string | null;
  // pending private match connect {fromUid, toUid}
  pendingMatch?: { fromUid: string; toUid: string; fromName: string; toName: string } | null;
  createdAt?: Timestamp;
}

export interface RoomEvent {
  id?: string;
  type: 'join' | 'gift' | 'waitlist' | 'leave' | 'raise_hand' | 'stage_up' | 'review' | 'chat' | 'match';
  senderUid: string;
  senderName: string;
  senderAvatarData?: any;
  giftName?: string;
  giftCost?: number;
  recipientUid?: string;
  recipientName?: string;
  text?: string;
  timestamp?: Timestamp;
}

export interface TopGifter {
  uid: string;
  nickname: string;
  avatarData?: any;
  totalCoins: number;
}

export interface HandRequest {
  uid: string;
  nickname: string;
  avatarData?: any;
  gender: 'boy' | 'girl';
}

export const subscribeToHandRequests = (roomId: string, callback: (reqs: HandRequest[]) => void) => {
  return onSnapshot(collection(db, 'expert_rooms', roomId, 'hand_requests'), (snap) => {
    callback(snap.docs.map(d => ({ uid: d.id, ...d.data() } as HandRequest)));
  });
};

export const GIFTS = [
  { id: 'rose',        name: 'Rose',       icon: 'favorite',            cost: 50,   emoji: '🌹' },
  { id: 'heart',       name: 'Heart',      icon: 'favorite-border',     cost: 100,  emoji: '💖' },
  { id: 'crown',       name: 'Crown',      icon: 'workspace-premium',   cost: 200,  emoji: '👑' },
  { id: 'confetti',    name: 'Confetti',   icon: 'celebration',         cost: 250,  emoji: '🎉' },
  { id: 'diamond',     name: 'Diamond',    icon: 'diamond',             cost: 500,  emoji: '💎' },
  { id: 'rocket',      name: 'Rocket',     icon: 'rocket-launch',       cost: 1000, emoji: '🚀' },
];

export const LANGUAGES = [
  'Hindi', 'English', 'Telugu', 'Tamil', 'Kannada',
  'Malayalam', 'Marathi', 'Bengali', 'Gujarati', 'Punjabi',
];

export const TOPICS = [
  'Love & Relationships', 'Life Advice', 'Career Coaching',
  'Spiritual Guidance', 'Finance Tips', 'Mental Wellness',
  'Astrology', 'Fitness & Health', 'Heartbreak Help', 'Friendship',
];

// ── Room CRUD ──────────────────────────────────────────────────────────────

export const createExpertRoom = async (
  hostUid: string,
  hostNickname: string,
  hostAvatarData: any,
  topic: string,
  language: string,
  tier: RoomTier,
  ratePerMin: number,
) => {
  const hostSlot: SpeakerSlot = { uid: hostUid, nickname: hostNickname, avatarData: hostAvatarData || null, isMuted: false };
  const roomRef = await addDoc(collection(db, 'expert_rooms'), {
    hostUid,
    hostNickname,
    hostAvatarData: hostAvatarData || null,
    topic,
    language,
    tier,
    ratePerMin,
    status: 'live',
    handQueue: [],
    handQueueBoy: [],
    handQueueGirl: [],
    speakers: [hostSlot],
    activeMemberCount: 1,
    reviewingUid: null,
    reviewingNickname: null,
    reviewingAvatarData: null,
    reviewingBio: null,
    pendingMatch: null,
    createdAt: serverTimestamp() as any,
  } as Omit<ExpertRoom, 'id'>);
  return roomRef.id;
};

export const subscribeToActiveRooms = (
  callback: (rooms: ExpertRoom[]) => void,
  tierFilter?: RoomTier,
  languageFilter?: string,
) => {
  const roomsRef = collection(db, 'expert_rooms');
  let q = query(roomsRef, where('status', '==', 'live'));
  if (tierFilter) {
    q = query(roomsRef, where('status', '==', 'live'), where('tier', '==', tierFilter));
  }
  if (languageFilter) {
    q = query(roomsRef, where('status', '==', 'live'), where('language', '==', languageFilter));
  }
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ExpertRoom)));
  });
};

export const subscribeToRoom = (roomId: string, callback: (room: ExpertRoom | null) => void) => {
  return onSnapshot(doc(db, 'expert_rooms', roomId), (snap) => {
    callback(snap.exists() ? ({ id: snap.id, ...snap.data() } as ExpertRoom) : null);
  });
};

export const closeExpertRoom = async (roomId: string) => {
  await updateDoc(doc(db, 'expert_rooms', roomId), { status: 'closed' });
};

export const getExpertRoom = async (roomId: string): Promise<ExpertRoom | null> => {
  const snap = await getDoc(doc(db, 'expert_rooms', roomId));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as ExpertRoom) : null;
};

// ── Chat / Events ──────────────────────────────────────────────────────────

const logEvent = async (roomId: string, event: Omit<RoomEvent, 'id'>) => {
  await addDoc(collection(db, 'expert_rooms', roomId, 'events'), {
    ...event,
    timestamp: serverTimestamp(),
  });
};

export const subscribeToRoomEvents = (roomId: string, callback: (events: RoomEvent[]) => void) => {
  const q = query(
    collection(db, 'expert_rooms', roomId, 'events'),
    orderBy('timestamp', 'desc'),
    limit(60),
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as RoomEvent)));
  });
};

export const sendChatMessage = async (
  roomId: string,
  senderUid: string,
  senderName: string,
  senderAvatarData: any,
  text: string,
) => {
  if (!text.trim()) return;
  await logEvent(roomId, { type: 'chat', senderUid, senderName, senderAvatarData, text: text.trim() });
};

// ── Member join/leave ──────────────────────────────────────────────────────

export const joinRoom = async (roomId: string, uid: string, nickname: string, avatarData: any) => {
  await updateDoc(doc(db, 'expert_rooms', roomId), { activeMemberCount: increment(1) });
  await logEvent(roomId, { type: 'join', senderUid: uid, senderName: nickname, senderAvatarData: avatarData });
};

export const leaveRoom = async (roomId: string, uid: string, nickname: string) => {
  try {
    await deleteDoc(doc(db, 'expert_rooms', roomId, 'hand_requests', uid));
  } catch (e) {}
  await updateDoc(doc(db, 'expert_rooms', roomId), {
    activeMemberCount: increment(-1),
    handQueue: arrayRemove(uid),
    handQueueBoy: arrayRemove(uid),
    handQueueGirl: arrayRemove(uid),
  });
};

// ── Raise Hand / Stage ─────────────────────────────────────────────────────

export const raiseHand = async (
  roomId: string,
  uid: string,
  nickname: string,
  avatarData: any,
  gender: 'boy' | 'girl',
) => {
  await setDoc(doc(db, 'expert_rooms', roomId, 'hand_requests', uid), {
    nickname,
    avatarData: avatarData || null,
    gender,
    createdAt: serverTimestamp(),
  });
  const updateData: any = {
    handQueue: arrayUnion(uid)
  };
  if (gender === 'girl') {
    updateData.handQueueGirl = arrayUnion(uid);
  } else {
    updateData.handQueueBoy = arrayUnion(uid);
  }
  await updateDoc(doc(db, 'expert_rooms', roomId), updateData);
  await logEvent(roomId, { type: 'raise_hand', senderUid: uid, senderName: nickname, text: gender });
};

export const lowerHand = async (roomId: string, uid: string) => {
  try {
    await deleteDoc(doc(db, 'expert_rooms', roomId, 'hand_requests', uid));
  } catch (e) {}
  await updateDoc(doc(db, 'expert_rooms', roomId), {
    handQueue: arrayRemove(uid),
    handQueueBoy: arrayRemove(uid),
    handQueueGirl: arrayRemove(uid),
  });
};

export const acceptOnStage = async (
  roomId: string,
  uid: string,
  nickname: string,
  avatarData: any,
  gender: 'boy' | 'girl',
) => {
  const roomRef = doc(db, 'expert_rooms', roomId);
  const requestRef = doc(db, 'expert_rooms', roomId, 'hand_requests', uid);
  const slot: SpeakerSlot = { uid, nickname, avatarData: avatarData || null, isMuted: true, gender };

  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(roomRef);
    if (!snap.exists()) throw new Error('Room no longer exists.');

    const room = snap.data() as ExpertRoom;
    if (room.status !== 'live') throw new Error('Room has ended.');

    const speakers = room.speakers || [];
    if (speakers.some((speaker) => speaker.uid === uid)) {
      transaction.delete(requestRef);
      transaction.update(roomRef, {
        handQueue: arrayRemove(uid),
        handQueueBoy: arrayRemove(uid),
        handQueueGirl: arrayRemove(uid),
      });
      return;
    }

    const seatTaken = speakers.some((speaker) => speaker.gender === gender);
    if (seatTaken) {
      throw new Error(gender === 'girl' ? 'Girl speaker seat is already occupied.' : 'Boy speaker seat is already occupied.');
    }

    transaction.delete(requestRef);
    transaction.update(roomRef, {
      handQueue: arrayRemove(uid),
      handQueueBoy: arrayRemove(uid),
      handQueueGirl: arrayRemove(uid),
      speakers: [...speakers, slot],
    });
  });

  await logEvent(roomId, { type: 'stage_up', senderUid: uid, senderName: nickname });
};

export const removeFromStage = async (roomId: string, uid: string, currentSpeakers: SpeakerSlot[]) => {
  const updated = currentSpeakers.filter((s) => s.uid !== uid);
  await updateDoc(doc(db, 'expert_rooms', roomId), { speakers: updated });
};

export const toggleMute = async (roomId: string, uid: string, currentSpeakers: SpeakerSlot[]) => {
  const updated = currentSpeakers.map((s) => s.uid === uid ? { ...s, isMuted: !s.isMuted } : s);
  await updateDoc(doc(db, 'expert_rooms', roomId), { speakers: updated });
};

// ── Profile Review ─────────────────────────────────────────────────────────

export const triggerProfileReview = async (
  roomId: string,
  uid: string,
  nickname: string,
  avatarData: any,
  bio: string,
) => {
  await updateDoc(doc(db, 'expert_rooms', roomId), {
    reviewingUid: uid,
    reviewingNickname: nickname,
    reviewingAvatarData: avatarData || null,
    reviewingBio: bio || '',
  });
  await logEvent(roomId, { type: 'review', senderUid: uid, senderName: nickname });
};

export const clearProfileReview = async (roomId: string) => {
  await updateDoc(doc(db, 'expert_rooms', roomId), {
    reviewingUid: null,
    reviewingNickname: null,
    reviewingAvatarData: null,
    reviewingBio: null,
  });
};

// ── Match Connect ──────────────────────────────────────────────────────────

export const pushMatchConnect = async (
  roomId: string,
  fromUid: string,
  fromName: string,
  toUid: string,
  toName: string,
) => {
  await updateDoc(doc(db, 'expert_rooms', roomId), {
    pendingMatch: { fromUid, toUid, fromName, toName },
  });
  await logEvent(roomId, { type: 'match', senderUid: fromUid, senderName: fromName });
};

export const clearPendingMatch = async (roomId: string) => {
  await updateDoc(doc(db, 'expert_rooms', roomId), { pendingMatch: null });
};

// ── Gifts ──────────────────────────────────────────────────────────────────

export const sendGiftInRoom = async (
  roomId: string,
  senderId: string,
  senderName: string,
  senderAvatarData: any,
  recipientUid: string,
  recipientName: string,
  giftId: string,
) => {
  const gift = GIFTS.find((g) => g.id === giftId);
  if (!gift) throw new Error('Unknown gift');
  await transferCoins(senderId, recipientUid, gift.cost);
  await logEvent(roomId, {
    type: 'gift',
    senderUid: senderId,
    senderName,
    senderAvatarData,
    giftName: gift.name,
    giftCost: gift.cost,
    recipientUid,
    recipientName,
  });
  // track top gifters in a subcollection
  const gifterRef = doc(db, 'expert_rooms', roomId, 'gifters', senderId);
  const snap = await getDoc(gifterRef);
  if (snap.exists()) {
    await updateDoc(gifterRef, { totalCoins: increment(gift.cost), nickname: senderName });
  } else {
    await setDoc(gifterRef, { uid: senderId, nickname: senderName, avatarData: senderAvatarData || null, totalCoins: gift.cost });
  }
  return gift;
};

export const subscribeToTopGifters = (roomId: string, callback: (gifters: TopGifter[]) => void) => {
  const q = query(
    collection(db, 'expert_rooms', roomId, 'gifters'),
    orderBy('totalCoins', 'desc'),
    limit(5),
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => d.data() as TopGifter));
  });
};

// ── Direct Join (coin-gated) ───────────────────────────────────────────────

export const directJoinRoom = async (
  roomId: string,
  uid: string,
  nickname: string,
  avatarData: any,
  hostUid: string,
  ratePerMin: number,
) => {
  await transferCoins(uid, hostUid, ratePerMin);
  await updateDoc(doc(db, 'expert_rooms', roomId), { activeMemberCount: increment(1) });
  await logEvent(roomId, { type: 'join', senderUid: uid, senderName: nickname, senderAvatarData: avatarData });
  return ratePerMin;
};
