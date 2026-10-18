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
  Timestamp,
  getDoc,
  getDocFromServer,
} from 'firebase/firestore';
import { transferCoins } from './coinService';
import { authedPost, getBackendUrl } from './authService';
import { Share } from 'react-native';
import { auth } from '../config/firebase';

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

export type LudoMode = 'per_minute' | 'per_game' | 'per_token';

/**
 * What a per-minute table charges and pays, fixed when it was opened. Mirrors
 * ludo_terms() in backend/app.py; keys are the player count as a string.
 */
export interface LudoTerms {
  deposit: number;
  rates: Record<'1' | '2' | '3', number>;
  hostSharePercent: number;
  forfeitEach: Record<'1' | '2' | '3', number>;
  winnerPrize: number;
  hostMaxLeaves: number;
  hostMaxMissed: number;
  emptyCloseSecs: number;
  /** Absent on tables opened before watchers paid. */
  watch?: LudoWatchTerms;
}

/**
 * What watchers pay: 1 coin per started step to each side, up to its cap for
 * the minute (6 + 4 by default). Mirrors ludo_watch_due() in backend/app.py.
 */
export interface LudoWatchTerms {
  appPerMinute: number;
  hostPerMinute: number;
  appStepSecs: number;
  hostStepSecs: number;
}

/** A watcher's full minute, or 0 where watching is free. */
export const watchPerMinute = (terms: LudoTerms | undefined): number =>
  terms?.watch ? terms.watch.appPerMinute + terms.watch.hostPerMinute : 0;

export interface LudoSettlement {
  reason: 'game_over' | 'empty_table' | 'closed_before_start';
  deposit?: number;
  depositToPlayers?: Record<string, number>;
  depositToApp?: number;
  prize?: { uid: string; amount: number } | null;
  refund?: Record<string, number>;
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
  gameMode: LudoMode;
  ticketPrice: number;       // 50 on ticket tables; 0 on per-minute tables
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
  // Per-minute tables only (see backend/app.py, LUDO_PER_MINUTE)
  terms?: LudoTerms;
  /** The minute paid for so far ends here. */
  billedUntil?: Timestamp | null;
  /** Set while no player is seated: the board is paused. */
  emptySince?: Timestamp | null;
  hostAway?: boolean;
  hostLeaves?: number;
  hostMissed?: number;
  /** Host broke a limit: their turns are passed over, the deposit goes to the players. */
  hostBenched?: boolean;
  /** Left or removed mid-game; still committed to it until it ends. */
  departedUids?: string[];
  paidBy?: Record<string, number>;
  hostEarned?: number;
  settled?: boolean;
  settlement?: LudoSettlement | null;
  // Watchers have no mic; they ask the host (server-owned, see /ludo/speak).
  speakRequests?: Record<string, LudoMicEntry & { at?: Timestamp }>;
  /** Watchers the host has given a mic. */
  micGuests?: Record<string, LudoMicEntry>;
  /** Coins each person has given at this table. Orders the mic requests. */
  giftTotals?: Record<string, number>;
  /**
   * The latest roll at the table, kept after the pawn moves (diceValue is
   * cleared then). Every phone animates its die when seq goes up.
   */
  lastRoll?: { value: number; color: TokenColor; seq: number } | null;
  /** Six letters; friends join with it, typed or inside a link. */
  code?: string;
  /** Left out of the lobby: only the code or link finds it. */
  private?: boolean;
  // Meta
  createdAt?: Timestamp;
}

export interface LudoMicEntry {
  nickname: string;
  avatarData?: any;
}

export interface LudoMicRequest extends LudoMicEntry {
  uid: string;
  /** Coins they have given at this table. */
  gave: number;
}

/**
 * Who is asking for a mic, in the order the host sees them: whoever has given
 * the most at this table first, and among equals whoever asked first.
 */
export const micQueue = (room: Pick<LudoRoom, 'speakRequests' | 'giftTotals'>): LudoMicRequest[] =>
  Object.entries(room.speakRequests ?? {})
    .map(([uid, r]) => ({
      uid,
      nickname: r.nickname,
      avatarData: r.avatarData,
      gave: Math.floor(room.giftTotals?.[uid] ?? 0),
      at: r.at?.toMillis?.() ?? 0,
    }))
    .sort((a, b) => b.gave - a.gave || a.at - b.at)
    .map(({ at: _at, ...request }) => request);

export const isPerMinute = (room?: Pick<LudoRoom, 'gameMode'> | null): boolean =>
  room?.gameMode === 'per_minute';

/** What each player pays per minute with `players` of them seated (host excluded). */
export const ludoRate = (terms: LudoTerms | undefined, players: number): number => {
  if (!terms || players <= 0) return 0;
  return terms.rates[String(Math.min(players, 3)) as '1' | '2' | '3'] ?? 0;
};

/** Seated players who pay: everyone but the host. */
export const payingPlayers = (room: Pick<LudoRoom, 'players' | 'hostUid'>): LudoPlayer[] =>
  room.players.filter((p) => p.uid !== room.hostUid);

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
  gameMode: LudoMode = 'per_minute',
  opts: { private?: boolean } = {},
): Promise<string> => {
  // The deposit is charged server-side in the same write that creates the room,
  // so a patched client cannot skip payment and a failed create cannot eat coins.
  // Refused with code 'ludo_busy' (and the table's roomId) while a game holds you.
  const data = await authedPost<{ roomId: string }>('/api/v1/ludo/create-table', {
    gameMode,
    private: opts.private === true,
    nickname: hostNickname,
    avatarData: hostAvatarData || null,
  });
  return data.roomId;
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
    // Private tables stay out of the lobby, except to the people already at one.
    const me = auth.currentUser?.uid;
    callback(snap.docs
      .map(d => ({ id: d.id, ...d.data() } as LudoRoom))
      .filter(r => !r.private || (!!me && (r.hostUid === me || r.players.some((p) => p.uid === me)))));
  }, snapshotError('ludo:lobby', onError));
};

/** What a player acts on: if any of it differs, the board is out of date. */
const boardFingerprint = (r: LudoRoom | null) => r && JSON.stringify([
  r.phase, r.status, r.currentTurn, r.diceRolled, r.diceValue,
  r.turnStartedAt?.toMillis?.() ?? null, r.emptySince?.toMillis?.() ?? null,
  r.hostBenched ?? false, (r.players ?? []).map((p) => p.uid),
  (r.tokens ?? []).map((t) => t.position),
]);

/** How often the board checks its live listener against the server. */
const ROOM_WATCHDOG_MS = 5000;

/**
 * One "check the server now" per open board. Called right after this phone's
 * own start, roll, move or skip: the host who tapped Start used to sit on the
 * waiting card for up to 8 s while the game ran, and lose the opening turn.
 */
const roomResyncers = new Map<string, () => void>();
const resyncLudoRoom = (roomId: string) => { roomResyncers.get(roomId)?.(); };

/** The table with this code (typed, or from a link). Throws code 'no_table' if none is open. */
export const findLudoTable = (code: string) =>
  authedPost<{ roomId: string; private: boolean; hostName: string; phase: LudoPhase }>(
    '/api/v1/ludo/find', { code },
  );

/** The https link a table is shared by; its page opens the app at the table. */
export const ludoTableLink = (code: string) => `${getBackendUrl()}/ludo/${code}`;

/** Opens the phone's share sheet (WhatsApp and the rest) with the table's link and code. */
export const shareLudoTable = (room: Pick<LudoRoom, 'code' | 'players' | 'hostUid'>) => {
  if (!room.code) return Promise.resolve();
  const host = room.players.find((p) => p.uid === room.hostUid)?.nickname ?? 'my';
  const owner = host === 'my' ? 'my' : `${host}'s`;
  return Share.share({
    message:
      `Play Ludo with me on GenGal! Join ${owner} table:\n${ludoTableLink(room.code)}\n\n` +
      `Or open GenGal, go to Chill \u2192 Ludo \u2192 Join with code, and type ${room.code}. Seats are free.`,
  }).then(() => undefined).catch(() => undefined);
};

export const subscribeToLudoRoom = (
  roomId: string,
  callback: (room: LudoRoom | null) => void,
  onError?: SubscriptionErrorHandler,
) => {
  const ref = doc(db, 'ludo_rooms', roomId);
  let last: LudoRoom | null = null;
  let unsub: (() => void) | null = null;
  let stopped = false;

  const deliver = (room: LudoRoom | null) => {
    last = room;
    callback(room);
  };
  const listen = () => {
    unsub?.();
    unsub = onSnapshot(
      ref,
      snap => {
        deliver(snap.exists() ? ({ id: snap.id, ...snap.data() } as LudoRoom) : null);
      },
      // This document *is* the board — turn order, token positions, whose roll it
      // is. A dead listener freezes the game with no indication, and because coins
      // are staked on the result the player is left watching a turn that will
      // never arrive. Null is the "room is gone" value the screen already handles,
      // so they land somewhere real instead of on a board that stopped moving.
      snapshotError('ludo:room', onError, () => deliver(null)),
    );
  };
  listen();

  // A listener can also go quiet without an error: on two phones the second
  // sat on "Waiting for Hem to start" for over two minutes after the game had
  // begun, so it never saw its turn and every one ran out on the clock. Every
  // few seconds the board asks the server directly; if what it is showing is
  // out of date it takes the server's copy and restarts the listener.
  const check = () => {
    getDocFromServer(ref)
      .then((snap) => {
        if (stopped || !snap.exists()) return;
        const fresh = { id: snap.id, ...snap.data() } as LudoRoom;
        if (boardFingerprint(fresh) === boardFingerprint(last)) return;
        console.warn('[Ludo] room listener was behind the server; resyncing', roomId);
        deliver(fresh);
        listen();
      })
      .catch(() => {});
  };
  roomResyncers.set(roomId, check);
  const watchdog = setInterval(() => {
    if (last && last.status === 'live') check();
  }, ROOM_WATCHDOG_MS);

  return () => {
    stopped = true;
    clearInterval(watchdog);
    if (roomResyncers.get(roomId) === check) roomResyncers.delete(roomId);
    unsub?.();
  };
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

  // Seats are paid via buy-ticket (or the host seat from create-table). A free
  // client-side `players` write is denied by rules and was the unpaid seat hole.
  await logEvent(roomId, {
    type: 'join',
    senderUid: uid,
    senderName: nickname,
    senderAvatarData: avatarData,
    text: 'joined as spectator',
  });
  return { joined: true, asSpectator: true };
};

export const buyLudoTicket = async (
  roomId: string,
  uid: string,
  nickname: string,
  avatarData: any,
  _ticketPrice: number,
  _hostUid: string,
  targetColor: TokenColor
) => {
  // Seat price and host cut come from the room document on the server so a
  // race for the same colour cannot charge both buyers, and a patched client
  // cannot underpay.
  await authedPost('/api/v1/ludo/buy-ticket', {
    roomId,
    color: targetColor,
    nickname,
    avatarData: avatarData || null,
  });
  await logEvent(roomId, {
    type: 'system',
    senderUid: uid,
    senderName: nickname,
    senderAvatarData: avatarData,
    text: 'took a seat',
  });
};

export const placeLudoBet = async (
  roomId: string,
  uid: string,
  nickname: string,
  color: TokenColor,
  _amount: number,
  _hostUid: string
) => {
  // Amount is fixed server-side (50). Client cannot underpay or forge bets.
  const data = await authedPost<{ amount: number }>('/api/v1/ludo/place-bet', {
    roomId,
    color,
  });
  await logEvent(roomId, {
    type: 'system',
    senderUid: uid,
    senderName: nickname,
    text: `placed a ${data.amount} 💎 bet on ${color}!`,
  });
};

export const leaveLudoRoom = async (roomId: string, uid: string, nickname: string, asSpectator: boolean) => {
  if (!asSpectator) {
    // players / playerUids are server-owned; guests cannot rewrite them.
    try {
      await authedPost('/api/v1/ludo/leave-seat', { roomId });
    } catch (e) {
      console.warn('[Ludo] leave-seat failed:', (e as Error)?.message ?? e);
    }
  }
  await logEvent(roomId, { type: 'leave', senderUid: uid, senderName: nickname });
};

// ── Game control (host-authoritative) ────────────────────────────────────────

/**
 * Deal the board and open play, on the server. A per-minute table charges its
 * first minute in the same write.
 */
export const startGame = async (roomId: string) => {
  await authedPost('/api/v1/ludo/start', { roomId });
  resyncLudoRoom(roomId);
  logEvent(roomId, { type: 'system', senderUid: '', senderName: 'Game', text: 'Game started!' }).catch(() => {});
};

/**
 * Keeps a per-minute table's clock honest: the minute's charge, a host gone
 * quiet, an empty table closing. Every phone at the table calls it; whichever
 * lands first does the work. `here: false` is the host stepping away.
 */
export const tickLudo = async (roomId: string, here = true) => {
  await authedPost('/api/v1/ludo/tick', { roomId, here });
};

export interface WatchReport {
  ok: boolean;
  /** False for the host and seated players, who never pay to watch. */
  watching: boolean;
  charged?: number;
  paid?: number;
  perMinute?: number;
}

/**
 * A watcher's phone reporting in, every 15 seconds while the board is open
 * and once with `here: false` on leaving. The server bills the seconds since
 * the last report; it refuses with code `watch_coins` when they run out.
 */
export const watchLudo = (roomId: string, here = true) =>
  authedPost<WatchReport>('/api/v1/ludo/watch', { roomId, here });

export type LudoSpeakAction = 'request' | 'cancel' | 'accept' | 'decline' | 'remove';

/**
 * Mic requests. A watcher sends `request` / `cancel` (cancel also hands a mic
 * back); the host sends `accept` / `decline` / `remove` naming `targetUid`.
 */
export const speakLudo = (
  roomId: string,
  action: LudoSpeakAction,
  extra: { targetUid?: string; nickname?: string; avatarData?: any } = {},
) => authedPost<{ ok: boolean; requested: boolean; onMic: boolean }>(
  '/api/v1/ludo/speak',
  { roomId, action, ...extra },
);

// Host (or current player) rolls dice — returns rolled value.
// Per-token mode is charged on the server in the same write that sets the die.
/**
 * The board waits on a roll or a move with the die locked. A request stuck on a
 * bad connection used to hold it locked for as long as the network took to
 * give up -- the die simply stopped answering. After this long the board is
 * released with a message; if the request did land, the room shows it anyway.
 */
const BOARD_REQUEST_MS = 8000;
const withinMs = <T,>(work: Promise<T>, ms: number, message: string): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    work.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });

export const rollDice = async (
  roomId: string,
  rollerUid: string,
  rollerName: string,
  rollerAvatarData: any,
  _room: LudoRoom,
): Promise<number> => {
  const data = await withinMs(
    authedPost<{ diceValue: number; forfeited?: boolean }>('/api/v1/ludo/roll', { roomId }),
    BOARD_REQUEST_MS,
    'The roll is taking too long. Check your connection and tap the dice again.',
  );
  const value = data.diceValue;
  resyncLudoRoom(roomId);

  // The feed entries are not waited for. They used to be, so the die kept
  // tumbling for a second write to finish after the value was already known.
  logEvent(roomId, {
    type: 'roll',
    senderUid: rollerUid,
    senderName: rollerName,
    senderAvatarData: rollerAvatarData,
    diceValue: value,
  }).catch(() => {});

  if (data.forfeited) {
    logEvent(roomId, {
      type: 'system',
      senderUid: '',
      senderName: 'Game',
      text: `${rollerName} rolled three 6s — turn forfeited!`,
    }).catch(() => {});
  }

  return value;
};

/**
 * Move one of your pawns by the die the server rolled. The server checks the
 * move, applies captures and finishing, passes the turn, and -- on the move
 * that ends a per-minute game -- pays out, all in one write.
 */
export const moveToken = async (
  roomId: string,
  moverUid: string,
  moverName: string,
  moverAvatarData: any,
  tokenId: string,
  room: LudoRoom,
) => {
  if (!room.diceRolled || room.diceValue === null) return;
  const result = await withinMs(
    authedPost<{
      fromPos: number; toPos: number; diceValue: number;
      captured: string | null; colorDone: boolean;
    }>('/api/v1/ludo/move', { roomId, tokenId }),
    BOARD_REQUEST_MS,
    'The move is taking too long. Check your connection and tap the pawn again.',
  );
  resyncLudoRoom(roomId);

  // The feed is not waited for, so the board never lags behind it.
  const by = { senderUid: moverUid, senderName: moverName, senderAvatarData: moverAvatarData };
  logEvent(roomId, {
    type: 'move', ...by, tokenId,
    fromPos: result.fromPos, toPos: result.toPos, diceValue: result.diceValue,
  }).catch(() => {});
  if (result.captured) {
    logEvent(roomId, { type: 'capture', ...by, capturedToken: result.captured }).catch(() => {});
  }
  if (result.colorDone) {
    logEvent(roomId, { type: 'win', senderUid: moverUid, senderName: moverName }).catch(() => {});
  }
};

// Host skips a player's turn (timeout)
/**
 * Clear a turn whose clock has run out.
 *
 * Server-side, and asked for by whoever is still at the table. This used to be
 * a direct write, which the room rules only permit the host to make -- so when
 * the host was the player who went away mid-turn, nobody left was allowed to
 * move the game on and the table sat at "0s left" for ever.
 *
 * The server re-checks that the turn really has expired, so asking early is
 * refused rather than stealing a roll somebody is still taking.
 */
export const skipTurn = async (roomId: string, _room?: LudoRoom) => {
  await authedPost<{ currentTurn: string }>('/api/v1/ludo/skip', { roomId });
  resyncLudoRoom(roomId);
};

/**
 * How long past zero the server waits before it will retire a turn -- mirrors
 * LUDO_SKIP_GRACE_SECONDS in backend/app.py, plus a little for the round trip.
 * Asking any sooner is always refused.
 */
export const SKIP_GRACE_MS = 1200;

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
  await transferCoins(senderUid, targetUid, giftCost, roomId);
  await logEvent(roomId, {
    type: 'gift',
    senderUid, senderName, senderAvatarData,
    targetUid, giftName, giftCost,
  });
};
