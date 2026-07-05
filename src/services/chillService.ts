import { db } from '../config/firebase';
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  increment,
  Timestamp,
} from 'firebase/firestore';
import { transferCoins } from './coinService';

// ── Types ────────────────────────────────────────────────────────────────────

export type GamePhase =
  | 'waiting'    // lobby — waiting for enough players
  | 'prompt'     // host assigned movie, actor sees popup
  | 'acting'     // countdown running, actor gives clues
  | 'result'     // round over — show winner / time-up
  | 'finished';  // game over

export interface PlayerSlot {
  uid: string;
  nickname: string;
  avatarData?: any;
  score: number;
  isHost: boolean;
}

export interface ChillRoom {
  id?: string;
  hostUid: string;
  hostNickname: string;
  hostAvatarData?: any;
  language: string;
  status: 'live' | 'closed';
  phase: GamePhase;
  // current round
  roundNumber: number;
  actorUid: string | null;
  actorNickname: string | null;
  actorAvatarData?: any;
  guesserUid: string | null;
  guesserNickname: string | null;
  guesserAvatarData?: any;
  // movie visible only to actor — stored but clients ignore it unless they are actor
  currentMovie: string | null;
  timerEndsAt: Timestamp | null;
  timerSeconds: number;
  winnerUid: string | null;
  winnerNickname: string | null;
  // scores map uid -> score (denormalised for quick read)
  scores: Record<string, number>;
  activeMemberCount: number;
  createdAt?: Timestamp;
}

export interface ChillEvent {
  id?: string;
  type: 'join' | 'leave' | 'chat' | 'guess' | 'gift' | 'round_start' | 'round_end' | 'correct';
  senderUid: string;
  senderName: string;
  senderAvatarData?: any;
  text?: string;          // chat / guess text
  giftName?: string;
  giftCost?: number;
  movie?: string;         // revealed in round_end
  timestamp?: Timestamp;
}

export const CHILL_GIFTS = [
  { id: 'rose',     name: 'Rose',     emoji: '🌹', cost: 50  },
  { id: 'heart',    name: 'Heart',    emoji: '💖', cost: 100 },
  { id: 'crown',    name: 'Crown',    emoji: '👑', cost: 200 },
  { id: 'confetti', name: 'Confetti', emoji: '🎉', cost: 250 },
  { id: 'diamond',  name: 'Diamond',  emoji: '💎', cost: 500 },
];

export const CHILL_LANGUAGES = [
  'Hindi', 'English', 'Telugu', 'Tamil', 'Kannada',
  'Malayalam', 'Marathi', 'Bengali', 'Gujarati', 'Punjabi',
];

// Curated Bollywood / Tollywood / English movie pool
export const MOVIE_POOL: Record<string, string[]> = {
  Hindi: [
    'Dilwale Dulhania Le Jayenge', '3 Idiots', 'Dangal', 'Sholay',
    'Dil Chahta Hai', 'Lagaan', 'Kabhi Khushi Kabhie Gham', 'Queen',
    'Gangs of Wasseypur', 'PK', 'Bajrangi Bhaijaan', 'Taare Zameen Par',
    'Andhadhun', 'Barfi', 'Zindagi Na Milegi Dobara',
  ],
  Telugu: [
    'Baahubali', 'Arjun Reddy', 'Magadheera', 'Pokiri', 'Jalsa',
    'Ala Vaikunthapurramuloo', 'Pushpa', 'RRR', 'Vakeel Saab', 'Jersey',
  ],
  Tamil: [
    'Enthiran', 'Vikram', 'Mersal', 'Kaithi', 'Master',
    'Vinnaithaandi Varuvaayaa', 'Jai Bhim', 'Soorarai Pottru',
  ],
  English: [
    'Titanic', 'The Dark Knight', 'Inception', 'Avengers', 'Interstellar',
    'Home Alone', 'The Lion King', 'Forrest Gump', 'Jurassic Park', 'Harry Potter',
  ],
};

const DEFAULT_MOVIES = MOVIE_POOL['Hindi'];

export function pickRandomMovie(language: string): string {
  const pool = MOVIE_POOL[language] ?? DEFAULT_MOVIES;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Firestore helpers ─────────────────────────────────────────────────────────

const logEvent = async (roomId: string, event: Omit<ChillEvent, 'id'>) => {
  await addDoc(collection(db, 'chill_rooms', roomId, 'events'), {
    ...event,
    timestamp: serverTimestamp(),
  });
};

// ── Room CRUD ─────────────────────────────────────────────────────────────────

export const createChillRoom = async (
  hostUid: string,
  hostNickname: string,
  hostAvatarData: any,
  language: string,
): Promise<string> => {
  const ref = await addDoc(collection(db, 'chill_rooms'), {
    hostUid,
    hostNickname,
    hostAvatarData: hostAvatarData || null,
    language,
    status: 'live',
    phase: 'waiting',
    roundNumber: 0,
    actorUid: null,
    actorNickname: null,
    actorAvatarData: null,
    guesserUid: null,
    guesserNickname: null,
    guesserAvatarData: null,
    currentMovie: null,
    timerEndsAt: null,
    timerSeconds: 45,
    winnerUid: null,
    winnerNickname: null,
    scores: {},
    activeMemberCount: 1,
    createdAt: serverTimestamp(),
  } as Omit<ChillRoom, 'id'>);
  return ref.id;
};

export const closeChillRoom = async (roomId: string) => {
  await updateDoc(doc(db, 'chill_rooms', roomId), { status: 'closed', phase: 'finished' });
};

export const subscribeToChillRooms = (
  callback: (rooms: ChillRoom[]) => void,
  language?: string,
) => {
  const base = collection(db, 'chill_rooms');
  const q = language
    ? query(base, where('status', '==', 'live'), where('language', '==', language), orderBy('activeMemberCount', 'desc'))
    : query(base, where('status', '==', 'live'), orderBy('activeMemberCount', 'desc'));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() } as ChillRoom)));
  });
};

export const subscribeToChillRoom = (
  roomId: string,
  callback: (room: ChillRoom | null) => void,
) => {
  return onSnapshot(doc(db, 'chill_rooms', roomId), (snap) => {
    callback(snap.exists() ? ({ id: snap.id, ...snap.data() } as ChillRoom) : null);
  });
};

export const subscribeToChillEvents = (
  roomId: string,
  callback: (events: ChillEvent[]) => void,
) => {
  const q = query(
    collection(db, 'chill_rooms', roomId, 'events'),
    orderBy('timestamp', 'desc'),
    limit(80),
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() } as ChillEvent)));
  });
};

// ── Member join / leave ───────────────────────────────────────────────────────

export const joinChillRoom = async (
  roomId: string,
  uid: string,
  nickname: string,
  avatarData: any,
) => {
  await updateDoc(doc(db, 'chill_rooms', roomId), {
    activeMemberCount: increment(1),
    [`scores.${uid}`]: 0,
  });
  await logEvent(roomId, { type: 'join', senderUid: uid, senderName: nickname, senderAvatarData: avatarData });
};

export const leaveChillRoom = async (roomId: string, uid: string, nickname: string) => {
  await updateDoc(doc(db, 'chill_rooms', roomId), {
    activeMemberCount: increment(-1),
  });
  await logEvent(roomId, { type: 'leave', senderUid: uid, senderName: nickname });
};

// ── Game state machine (host only) ───────────────────────────────────────────

export const startRound = async (
  roomId: string,
  actorUid: string,
  actorNickname: string,
  actorAvatarData: any,
  guesserUid: string,
  guesserNickname: string,
  guesserAvatarData: any,
  movie: string,
  timerSeconds: number,
) => {
  // timerEndsAt calculated from now + timerSeconds
  const endsAt = Timestamp.fromMillis(Date.now() + timerSeconds * 1000);
  await updateDoc(doc(db, 'chill_rooms', roomId), {
    phase: 'prompt',
    actorUid,
    actorNickname,
    actorAvatarData: actorAvatarData || null,
    guesserUid,
    guesserNickname,
    guesserAvatarData: guesserAvatarData || null,
    currentMovie: movie,
    timerEndsAt: endsAt,
    timerSeconds,
    winnerUid: null,
    winnerNickname: null,
    roundNumber: increment(1) as any,
  });
  await logEvent(roomId, {
    type: 'round_start',
    senderUid: actorUid,
    senderName: actorNickname,
    senderAvatarData: actorAvatarData,
  });
};

export const beginActing = async (roomId: string) => {
  await updateDoc(doc(db, 'chill_rooms', roomId), { phase: 'acting' });
};

export const markCorrect = async (
  roomId: string,
  winnerUid: string,
  winnerNickname: string,
  movie: string,
  currentScores: Record<string, number>,
) => {
  const newScores = { ...currentScores, [winnerUid]: (currentScores[winnerUid] ?? 0) + 1 };
  await updateDoc(doc(db, 'chill_rooms', roomId), {
    phase: 'result',
    winnerUid,
    winnerNickname,
    scores: newScores,
  });
  await logEvent(roomId, {
    type: 'correct',
    senderUid: winnerUid,
    senderName: winnerNickname,
    movie,
  });
};

export const markTimeUp = async (roomId: string, movie: string) => {
  await updateDoc(doc(db, 'chill_rooms', roomId), {
    phase: 'result',
    winnerUid: null,
    winnerNickname: null,
  });
  await logEvent(roomId, {
    type: 'round_end',
    senderUid: '',
    senderName: 'Timer',
    movie,
  });
};

export const resetToWaiting = async (roomId: string) => {
  await updateDoc(doc(db, 'chill_rooms', roomId), {
    phase: 'waiting',
    actorUid: null,
    actorNickname: null,
    actorAvatarData: null,
    guesserUid: null,
    guesserNickname: null,
    guesserAvatarData: null,
    currentMovie: null,
    timerEndsAt: null,
    winnerUid: null,
    winnerNickname: null,
  });
};

// ── Chat & Guess ──────────────────────────────────────────────────────────────

export const sendChillChat = async (
  roomId: string,
  uid: string,
  name: string,
  avatarData: any,
  text: string,
) => {
  if (!text.trim()) return;
  await logEvent(roomId, { type: 'chat', senderUid: uid, senderName: name, senderAvatarData: avatarData, text: text.trim() });
};

export const sendChillGuess = async (
  roomId: string,
  uid: string,
  name: string,
  avatarData: any,
  text: string,
) => {
  if (!text.trim()) return;
  await logEvent(roomId, { type: 'guess', senderUid: uid, senderName: name, senderAvatarData: avatarData, text: text.trim() });
};

// ── Gifting ───────────────────────────────────────────────────────────────────

export const sendChillGift = async (
  roomId: string,
  senderUid: string,
  senderName: string,
  senderAvatarData: any,
  recipientUid: string,
  giftName: string,
  giftCost: number,
) => {
  await transferCoins(senderUid, recipientUid, giftCost);
  await logEvent(roomId, {
    type: 'gift',
    senderUid,
    senderName,
    senderAvatarData,
    giftName,
    giftCost,
  });
};
