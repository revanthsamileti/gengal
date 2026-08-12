import { db } from '../config/firebase';
import { RosterPreviewEntry } from './presenceService';
import { snapshotError, SubscriptionErrorHandler } from './subscriptionError';
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
  getDoc,
} from 'firebase/firestore';
import { transferCoins } from './coinService';

// ── Board constants ───────────────────────────────────────────────────────────

export type TokenColor = 'red' | 'blue' | 'green' | 'yellow';
export const TOKEN_COLORS: TokenColor[] = ['red', 'blue', 'green', 'yellow'];

// The shared track has 52 cells (0-51). Each color enters at a different offset.
// Safe cells: 0, 8, 13, 21, 26, 34, 39, 47 (standard Ludo)
export const SAFE_CELLS = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

// Entry cell on the main track for each color
export const COLOR_ENTRY: Record<TokenColor, number> = {
  red: 0,
  blue: 13,
  green: 26,
  yellow: 39,
};

// The cell just before home column entry for each color (token has lapped the board)
// After reaching this cell + 1, token enters home column (positions 52-57)
export const HOME_ENTRY: Record<TokenColor, number> = {
  red: 51,
  blue: 12,
  green: 25,
  yellow: 38,
};

// Home column: 6 cells numbered 52–57 (per-color internal track)
export const HOME_COLUMN_START = 52;
export const HOME_COLUMN_END = 57; // cell 57 = home (finished)

// Each color has 4 tokens. Token IDs: "red-0", "red-1", etc.
// Position -1 means "in base" (not yet on board)
// Position 52-57 means "in home column"
// Position 58 means "finished" (at home)
export const BASE_POSITION = -1;
export const FINISHED_POSITION = 58;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Token {
  id: string;          // e.g. "red-0"
  color: TokenColor;
  index: number;       // 0-3
  position: number;    // -1 (base) | 0-51 (main track) | 52-57 (home col) | 58 (finished)
}

export interface LudoPlayer {
  uid: string;
  nickname: string;
  avatarData?: any;
  color: TokenColor;
  isHost: boolean;
  isOnline: boolean;
  score: number;       // tokens finished (0-4)
  finishedAt?: number; // rank position (1st, 2nd…)
}

export type LudoPhase =
  | 'waiting'    // lobby
  | 'playing'    // game active
  | 'finished';  // game over

export interface LudoRoom {
  id?: string;
  hostUid: string;
  phase: LudoPhase;
  status: 'live' | 'closed';
  gameMode: 'per_game' | 'per_token';
  ticketPrice: number;       // e.g. 50 coins to join
  audienceBets: Record<string, { color: TokenColor, amount: number }>; // map of uid to bet
  // Players (up to 4)
  players: LudoPlayer[];
  activeMemberCount: number;
  /**
   * Everyone heartbeating in the room — players and spectators together.
   * Spectators are this minus the seated players; `spectatorCount` was a bare
   * counter that only ever grew when a watcher's client died without leaving.
   */
  presentCount?: number;
  /** Host heartbeat. Absent on rooms created before presence existed. */
  hostLastSeen?: Timestamp;
  /** Up to four present members, denormalised by the host for lobby cards. */
  roster?: RosterPreviewEntry[];
  // Game state
  tokens: Token[];           // all 16 tokens
  currentTurn: TokenColor;   // whose turn
  diceValue: number | null;  // last rolled value (null = not rolled yet)
  diceRolled: boolean;       // has current player rolled yet
  consecutiveSixes: number;  // track rule: 3 sixes = forfeit turn
  turnStartedAt: Timestamp | null;
  turnTimeoutSecs: number;   // default 15
  finishRank: number;        // 1 for first to finish, increments
  winnersOrder: string[];    // uids in finish order
  // Spectator
  /** @deprecated Drifting counter, replaced by `presentCount` minus seated players. */
  spectatorCount?: number;
  // Meta
  createdAt?: Timestamp;
}

export interface LudoEvent {
  id?: string;
  type: 'join' | 'leave' | 'roll' | 'move' | 'capture' | 'win' | 'chat' | 'gift' | 'system';
  senderUid: string;
  senderName: string;
  senderAvatarData?: any;
  text?: string;
  diceValue?: number;
  tokenId?: string;
  fromPos?: number;
  toPos?: number;
  capturedToken?: string;
  giftName?: string;
  giftCost?: number;
  targetUid?: string;
  timestamp?: Timestamp;
}

// ── Gifts ────────────────────────────────────────────────────────────────────

export const LUDO_GIFTS = [
  { id: 'cheer',   name: 'Cheer',   emoji: '🎉', cost: 50  },
  { id: 'tomato',  name: 'Tomato',  emoji: '🍅', cost: 30  },
  { id: 'crown',   name: 'Crown',   emoji: '👑', cost: 200 },
  { id: 'thunder', name: 'Thunder', emoji: '⚡', cost: 100 },
  { id: 'diamond', name: 'Diamond', emoji: '💎', cost: 500 },
];

// ── Initial state builders ────────────────────────────────────────────────────

export function buildInitialTokens(): Token[] {
  const tokens: Token[] = [];
  for (const color of TOKEN_COLORS) {
    for (let i = 0; i < 4; i++) {
      tokens.push({ id: `${color}-${i}`, color, index: i, position: BASE_POSITION });
    }
  }
  return tokens;
}

// ── Path logic ────────────────────────────────────────────────────────────────

// Given a token's current absolute position and color, compute new position after moving `steps`
// Returns null if move is illegal (overshoots home column)
export function computeNewPosition(token: Token, steps: number): number | null {
  const pos = token.position;
  const color = token.color;
  const entry = COLOR_ENTRY[color];
  const homeEntry = HOME_ENTRY[color];

  if (pos === FINISHED_POSITION) return null; // already done
  if (pos === BASE_POSITION) {
    // Can only exit base on a 6
    if (steps !== 6) return null;
    return entry;
  }

  // In home column (52-57)
  if (pos >= HOME_COLUMN_START) {
    const newPos = pos + steps;
    if (newPos > HOME_COLUMN_END) return null; // overshoot — illegal
    if (newPos === HOME_COLUMN_END) return FINISHED_POSITION;
    return newPos;
  }

  // On main track (0-51)
  // Distance already traveled from entry
  const traveled = (pos - entry + 52) % 52;
  const remaining = 51 - traveled; // steps to reach home-entry cell

  if (steps <= remaining) {
    // Still on main track
    return (pos + steps) % 52;
  } else {
    // Entering home column
    const overshoot = steps - remaining - 1;
    const homePos = HOME_COLUMN_START + overshoot;
    if (homePos > HOME_COLUMN_END) return null; // overshoot
    if (homePos === HOME_COLUMN_END) return FINISHED_POSITION;
    return homePos;
  }
}

// Return all token IDs for a color that can legally move given dice roll
export function getLegalMoves(tokens: Token[], color: TokenColor, dice: number): string[] {
  return tokens
    .filter(t => t.color === color)
    .filter(t => {
      if (t.position === FINISHED_POSITION) return false;
      if (t.position === BASE_POSITION) return dice === 6;
      return computeNewPosition(t, dice) !== null;
    })
    .map(t => t.id);
}

// ── Authoritative move (host executes) ───────────────────────────────────────

export function applyMove(
  tokens: Token[],
  tokenId: string,
  dice: number,
  players: LudoPlayer[],
): {
  tokens: Token[];
  captured: string | null;  // captured token ID if any
  finished: boolean;        // this token reached home
} {
  const tokenIdx = tokens.findIndex(t => t.id === tokenId);
  if (tokenIdx === -1) return { tokens, captured: null, finished: false };

  const token = tokens[tokenIdx];
  const newPos = computeNewPosition(token, dice);
  if (newPos === null) return { tokens, captured: null, finished: false };

  const updated = [...tokens];
  updated[tokenIdx] = { ...token, position: newPos };

  let captured: string | null = null;

  if (newPos !== FINISHED_POSITION && newPos >= 0 && newPos < HOME_COLUMN_START) {
    // Check capture — only on main track, non-safe cells
    if (!SAFE_CELLS.has(newPos)) {
      const victim = updated.find(
        t => t.id !== tokenId && t.color !== token.color && t.position === newPos
      );
      if (victim) {
        captured = victim.id;
        const vidx = updated.findIndex(t => t.id === victim.id);
        updated[vidx] = { ...victim, position: BASE_POSITION };
      }
    }
  }

  return { tokens: updated, captured, finished: newPos === FINISHED_POSITION };
}

// Advance turn to next color that still has tokens in play
export function nextTurn(currentTurn: TokenColor, players: LudoPlayer[], tokens: Token[]): TokenColor {
  const activePlayers = players.filter(p => {
    const done = tokens.filter(t => t.color === p.color).every(t => t.position === FINISHED_POSITION);
    return !done;
  });
  if (activePlayers.length === 0) return currentTurn;
  const colors = activePlayers.map(p => p.color);
  const idx = colors.indexOf(currentTurn);
  return colors[(idx + 1) % colors.length];
}

// ── Firestore helpers ─────────────────────────────────────────────────────────

const logEvent = async (roomId: string, event: Omit<LudoEvent, 'id'>) => {
  await addDoc(collection(db, 'ludo_rooms', roomId, 'events'), {
    ...event,
    timestamp: serverTimestamp(),
  });
};

// ── Room CRUD ─────────────────────────────────────────────────────────────────

export const createLudoRoom = async (
  hostUid: string,
  hostNickname: string,
  hostAvatarData: any,
  gameMode: 'per_game' | 'per_token'
): Promise<string> => {
  const hostPlayer: LudoPlayer = {
    uid: hostUid,
    nickname: hostNickname,
    avatarData: hostAvatarData || null,
    color: 'red',
    isHost: true,
    isOnline: true,
    score: 0,
  };
  const ref = await addDoc(collection(db, 'ludo_rooms'), {
    hostUid,
    phase: 'waiting',
    status: 'live',
    gameMode,
    ticketPrice: 50,
    audienceBets: {},
    players: [hostPlayer],
    activeMemberCount: 1,
    presentCount: 1,
    // Seeded so a host that dies before its first heartbeat still ages out.
    hostLastSeen: Timestamp.now(),
    tokens: buildInitialTokens(),
    currentTurn: 'red',
    diceValue: null,
    diceRolled: false,
    consecutiveSixes: 0,
    turnStartedAt: null,
    turnTimeoutSecs: 15,
    finishRank: 1,
    winnersOrder: [],
    spectatorCount: 0,
    createdAt: serverTimestamp() as any,
  } as Omit<LudoRoom, 'id'>);
  return ref.id;
};

export const closeLudoRoom = async (roomId: string) => {
  await updateDoc(doc(db, 'ludo_rooms', roomId), { status: 'closed', phase: 'finished' });
};

export const subscribeToLudoRooms = (
  callback: (rooms: LudoRoom[]) => void,
  onError?: SubscriptionErrorHandler,
) => {
  const q = query(
    collection(db, 'ludo_rooms'),
    where('status', '==', 'live'),
    orderBy('activeMemberCount', 'desc'),
  );
  // An errored lobby and an empty lobby both render as "no games". The screen
  // gets the error so it can tell the user which of the two actually happened.
  return onSnapshot(q, snap => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() } as LudoRoom)));
  }, snapshotError('ludo:lobby', onError));
};

export const subscribeToLudoRoom = (
  roomId: string,
  callback: (room: LudoRoom | null) => void,
  onError?: SubscriptionErrorHandler,
) => {
  return onSnapshot(
    doc(db, 'ludo_rooms', roomId),
    snap => {
      callback(snap.exists() ? ({ id: snap.id, ...snap.data() } as LudoRoom) : null);
    },
    // This document *is* the board — turn order, token positions, whose roll it
    // is. A dead listener freezes the game with no indication, and because coins
    // are staked on the result the player is left watching a turn that will
    // never arrive. Null is the "room is gone" value the screen already handles,
    // so they land somewhere real instead of on a board that stopped moving.
    snapshotError('ludo:room', onError, () => callback(null)),
  );
};

export const subscribeToLudoEvents = (
  roomId: string,
  callback: (events: LudoEvent[]) => void,
  onError?: SubscriptionErrorHandler,
) => {
  const q = query(
    collection(db, 'ludo_rooms', roomId, 'events'),
    orderBy('timestamp', 'desc'),
    limit(60),
  );
  // No fallback: the last few events staying put beats blanking the feed.
  return onSnapshot(q, snap => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() } as LudoEvent)));
  }, snapshotError('ludo:events', onError));
};

// ── Join / Leave ──────────────────────────────────────────────────────────────

const COLORS_ORDER: TokenColor[] = ['red', 'blue', 'green', 'yellow'];

export const joinLudoRoom = async (
  roomId: string,
  uid: string,
  nickname: string,
  avatarData: any,
): Promise<{ joined: boolean; asSpectator: boolean }> => {
  const snap = await getDoc(doc(db, 'ludo_rooms', roomId));
  if (!snap.exists()) return { joined: false, asSpectator: false };
  const room = snap.data() as LudoRoom;

  // Already a player?
  if (room.players.find(p => p.uid === uid)) {
    return { joined: true, asSpectator: false };
  }

  if (room.phase !== 'waiting' || room.players.length >= 4) {
    // Join as spectator
    // Spectator headcount comes from heartbeat presence now, so there is no
    // counter to bump — and none to leak when this client dies without leaving.
    await logEvent(roomId, { type: 'join', senderUid: uid, senderName: nickname, senderAvatarData: avatarData, text: 'joined as spectator' });
    return { joined: true, asSpectator: true };
  }

  // Join as spectator initially for all new monetized games unless host
  if (uid !== room.hostUid) {
    await logEvent(roomId, { type: 'join', senderUid: uid, senderName: nickname, senderAvatarData: avatarData, text: 'joined as spectator' });
    return { joined: true, asSpectator: true };
  }

  // Assign next available color
  const taken = new Set(room.players.map(p => p.color));
  const color = COLORS_ORDER.find(c => !taken.has(c))!;
  const newPlayer: LudoPlayer = {
    uid, nickname, avatarData: avatarData || null,
    color, isHost: false, isOnline: true, score: 0,
  };

  const updatedPlayers = [...room.players, newPlayer];
  await updateDoc(doc(db, 'ludo_rooms', roomId), {
    players: updatedPlayers,
    activeMemberCount: increment(1),
  });
  await logEvent(roomId, { type: 'join', senderUid: uid, senderName: nickname, senderAvatarData: avatarData, text: 'joined the table' });
  return { joined: true, asSpectator: false };
};

export const buyLudoTicket = async (
  roomId: string,
  uid: string,
  nickname: string,
  avatarData: any,
  ticketPrice: number,
  hostUid: string,
  targetColor: TokenColor
) => {
  const { deductUserCoinsWithCommission } = await import('./coinService');
  const commission = Math.floor(ticketPrice * 0.1);
  await deductUserCoinsWithCommission(uid, ticketPrice, hostUid, commission);

  const snap = await getDoc(doc(db, 'ludo_rooms', roomId));
  const room = snap.data() as LudoRoom;
  
  if (room.players.find(p => p.color === targetColor)) {
    throw new Error('Color already taken');
  }

  const newPlayer: LudoPlayer = {
    uid, nickname, avatarData: avatarData || null,
    color: targetColor, isHost: false, isOnline: true, score: 0,
  };

  await updateDoc(doc(db, 'ludo_rooms', roomId), {
    players: [...room.players, newPlayer],
    activeMemberCount: increment(1),
  });
  await logEvent(roomId, { type: 'system', senderUid: uid, senderName: nickname, senderAvatarData: avatarData, text: `bought a ticket and joined the table!` });
};

export const placeLudoBet = async (
  roomId: string,
  uid: string,
  nickname: string,
  color: TokenColor,
  amount: number,
  hostUid: string
) => {
  const { deductUserCoinsWithCommission } = await import('./coinService');
  const commission = Math.floor(amount * 0.1);
  await deductUserCoinsWithCommission(uid, amount, hostUid, commission);

  const snap = await getDoc(doc(db, 'ludo_rooms', roomId));
  const room = snap.data() as LudoRoom;
  const newBets = { ...room.audienceBets };
  
  if (newBets[uid]) {
    newBets[uid].amount += amount;
  } else {
    newBets[uid] = { color, amount };
  }

  await updateDoc(doc(db, 'ludo_rooms', roomId), { audienceBets: newBets });
  await logEvent(roomId, { type: 'system', senderUid: uid, senderName: nickname, text: `placed a ${amount} 💎 bet on ${color}!` });
};

export const leaveLudoRoom = async (roomId: string, uid: string, nickname: string, asSpectator: boolean) => {
  if (asSpectator) {
    // Presence expiry handles this; see joinLudoRoom.
    return;
  }
  const snap = await getDoc(doc(db, 'ludo_rooms', roomId));
  if (!snap.exists()) return;
  const room = snap.data() as LudoRoom;
  const updated = room.players.filter(p => p.uid !== uid);
  await updateDoc(doc(db, 'ludo_rooms', roomId), {
    players: updated,
    activeMemberCount: increment(-1),
  });
  await logEvent(roomId, { type: 'leave', senderUid: uid, senderName: nickname });
};

// ── Game control (host-authoritative) ────────────────────────────────────────

export const startGame = async (roomId: string) => {
  await updateDoc(doc(db, 'ludo_rooms', roomId), {
    phase: 'playing',
    currentTurn: 'red',
    diceValue: null,
    diceRolled: false,
    consecutiveSixes: 0,
    turnStartedAt: serverTimestamp(),
    tokens: buildInitialTokens(),
    finishRank: 1,
    winnersOrder: [],
  });
  await logEvent(roomId, { type: 'system', senderUid: '', senderName: 'Game', text: 'Game started!' });
};

// Host (or current player) rolls dice — returns rolled value
export const rollDice = async (
  roomId: string,
  rollerUid: string,
  rollerName: string,
  rollerAvatarData: any,
  room: LudoRoom,
): Promise<number> => {
  const value = Math.floor(Math.random() * 6) + 1;
  const newConsec = value === 6 ? room.consecutiveSixes + 1 : 0;

  await updateDoc(doc(db, 'ludo_rooms', roomId), {
    diceValue: value,
    diceRolled: true,
    consecutiveSixes: newConsec,
  });
  await logEvent(roomId, {
    type: 'roll',
    senderUid: rollerUid,
    senderName: rollerName,
    senderAvatarData: rollerAvatarData,
    diceValue: value,
  });

  // Three sixes = forfeit turn automatically
  if (newConsec >= 3) {
    const next = nextTurn(room.currentTurn, room.players, room.tokens);
    await updateDoc(doc(db, 'ludo_rooms', roomId), {
      currentTurn: next,
      diceValue: null,
      diceRolled: false,
      consecutiveSixes: 0,
      turnStartedAt: serverTimestamp(),
    });
    await logEvent(roomId, { type: 'system', senderUid: '', senderName: 'Game', text: `${rollerName} rolled three 6s — turn forfeited!` });
  }

  return value;
};

// Move a specific token; check capture, win, next turn
export const moveToken = async (
  roomId: string,
  moverUid: string,
  moverName: string,
  moverAvatarData: any,
  tokenId: string,
  room: LudoRoom,
) => {
  if (!room.diceRolled || room.diceValue === null) return;

  const { tokens: newTokens, captured, finished } = applyMove(
    room.tokens, tokenId, room.diceValue, room.players,
  );

  const movedToken = newTokens.find(t => t.id === tokenId)!;

  // Check if this color has won (all 4 tokens finished)
  const colorTokens = newTokens.filter(t => t.color === movedToken.color);
  const colorDone = colorTokens.every(t => t.position === FINISHED_POSITION);

  // Compute player updates
  const updatedPlayers = room.players.map(p => {
    if (p.color !== movedToken.color) return p;
    const finCount = newTokens.filter(t => t.color === p.color && t.position === FINISHED_POSITION).length;
    return { ...p, score: finCount };
  });

  let newPhase: LudoPhase = room.phase;
  let newFinishRank = room.finishRank;
  const newWinnersOrder = [...room.winnersOrder];

  if (colorDone && !newWinnersOrder.includes(moverUid)) {
    newWinnersOrder.push(moverUid);
    newFinishRank += 1;
    if (newWinnersOrder.length >= room.players.length - 1) {
      newPhase = 'finished';
    }
  }

  // Earn a re-roll if: rolled a 6 OR caused a capture OR token finished
  const earnedReroll = room.diceValue === 6 || captured !== null || finished;
  const nextColor = earnedReroll && !colorDone
    ? room.currentTurn
    : nextTurn(room.currentTurn, updatedPlayers, newTokens);

  await updateDoc(doc(db, 'ludo_rooms', roomId), {
    tokens: newTokens,
    players: updatedPlayers,
    currentTurn: nextColor,
    diceValue: null,
    diceRolled: false,
    consecutiveSixes: earnedReroll ? room.consecutiveSixes : 0,
    turnStartedAt: serverTimestamp(),
    phase: newPhase,
    finishRank: newFinishRank,
    winnersOrder: newWinnersOrder,
  });

  await logEvent(roomId, {
    type: 'move',
    senderUid: moverUid, senderName: moverName, senderAvatarData: moverAvatarData,
    tokenId, fromPos: movedToken.position, toPos: movedToken.position, diceValue: room.diceValue,
  });

  if (captured) {
    await logEvent(roomId, {
      type: 'capture',
      senderUid: moverUid, senderName: moverName, senderAvatarData: moverAvatarData,
      capturedToken: captured,
    });
  }

  if (colorDone) {
    await logEvent(roomId, { type: 'win', senderUid: moverUid, senderName: moverName });
  }
};

// Host skips a player's turn (timeout)
export const skipTurn = async (roomId: string, room: LudoRoom) => {
  const next = nextTurn(room.currentTurn, room.players, room.tokens);
  await updateDoc(doc(db, 'ludo_rooms', roomId), {
    currentTurn: next,
    diceValue: null,
    diceRolled: false,
    consecutiveSixes: 0,
    turnStartedAt: serverTimestamp(),
  });
};

// ── Chat & Gifts ──────────────────────────────────────────────────────────────

export const sendLudoChat = async (
  roomId: string,
  uid: string,
  name: string,
  avatarData: any,
  text: string,
) => {
  if (!text.trim()) return;
  await logEvent(roomId, { type: 'chat', senderUid: uid, senderName: name, senderAvatarData: avatarData, text: text.trim() });
};

export const sendLudoGift = async (
  roomId: string,
  senderUid: string,
  senderName: string,
  senderAvatarData: any,
  targetUid: string,
  giftName: string,
  giftCost: number,
) => {
  await transferCoins(senderUid, targetUid, giftCost);
  await logEvent(roomId, {
    type: 'gift',
    senderUid, senderName, senderAvatarData,
    targetUid, giftName, giftCost,
  });
};
