import { db } from '../config/firebase';
import {
  collection,
  doc,
  deleteDoc,
  getCountFromServer,
  getDocs,
  limit,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  Timestamp,
} from 'firebase/firestore';

/**
 * Presence for live rooms.
 *
 * Rooms used to track occupancy with a bare counter on the room document —
 * `increment(1)` when someone joined, `increment(-1)` when they left. That only
 * holds if every client gets to run its leave path, and clients routinely don't:
 * force-quit, crash, backgrounded past the OS limit, network dropped in a
 * tunnel. Every one of those leaked a member, and because the drift is one-way
 * the number only ever climbs. Rooms slowly filled with people who left hours
 * ago, and nothing in the app ever brought the count back down.
 *
 * Presence here is a fact with an expiry date instead: each member re-asserts
 * "I am still here" on a heartbeat, and anyone who hasn't spoken up inside the
 * TTL is simply not counted. A client that disappears stops asserting, so it
 * ages out on its own with no cleanup path to miss.
 *
 * Expiry is evaluated by readers rather than by a server sweep, which keeps
 * this working against the Firestore rules and indexes already deployed.
 */

/** How often a present member re-asserts itself. */
export const HEARTBEAT_MS = 20_000;

/**
 * How long an assertion stays good for. Comfortably more than two heartbeats,
 * so one dropped write — or a slow network — doesn't blink someone out of a
 * room they are still sitting in.
 */
export const PRESENCE_TTL_MS = 55_000;

/** Rooms whose host stopped heartbeating are no longer live, whatever `status` says. */
export const ROOM_STALE_MS = 90_000;

/** How many faces a lobby card shows. */
export const ROSTER_PREVIEW_SIZE = 4;

/** A face on a lobby card. Denormalised onto the room document by the host. */
export interface RosterPreviewEntry {
  uid: string;
  nickname: string;
  avatarData?: any;
}

/** Collections that carry a `members` subcollection with presence. */
export type PresenceCollection = 'expert_rooms' | 'chill_rooms' | 'ludo_rooms';

export interface PresentMember {
  uid: string;
  nickname: string;
  avatarData?: any;
  lastSeen: number;
}

const toMillis = (value: any): number => {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return 0;
};

/**
 * Whether a heartbeat is recent enough to count as present.
 *
 * `now` is passed in so a single snapshot evaluates every member against one
 * instant — otherwise a long list can straddle the cutoff and report an
 * inconsistent roster.
 */
export const isFresh = (lastSeen: any, now: number = Date.now()): boolean => {
  const ms = toMillis(lastSeen);
  return ms > 0 && now - ms <= PRESENCE_TTL_MS;
};

/**
 * Assert that `uid` is in the room right now.
 *
 * Written with the client clock rather than `serverTimestamp()` on purpose:
 * a server timestamp resolves to null in the local snapshot until the write
 * lands, which would make a member briefly invisible to themselves on every
 * single heartbeat. The value is only ever compared against other members'
 * timestamps to answer "roughly still here?", so a few seconds of clock skew
 * costs nothing. Nothing billable is derived from it — the server bills off its
 * own clock via the billing tick.
 */
export const markPresent = async (
  collectionName: PresenceCollection,
  roomId: string,
  uid: string,
  member: { nickname: string; avatarData?: any },
) => {
  await setDoc(
    doc(db, collectionName, roomId, 'members', uid),
    {
      uid,
      nickname: member.nickname,
      avatarData: member.avatarData ?? null,
      lastSeen: Timestamp.now(),
    },
    { merge: true },
  );
};

/** Drop the presence record on a clean exit, so the room updates immediately. */
export const clearPresence = async (
  collectionName: PresenceCollection,
  roomId: string,
  uid: string,
) => {
  await deleteDoc(doc(db, collectionName, roomId, 'members', uid));
};

/**
 * The live roster, stale members filtered out.
 *
 * Re-filters on a timer as well as on each snapshot: presence expires with the
 * passage of time, not with a write, so a quiet room would otherwise keep
 * showing its last known occupants indefinitely.
 */
export const subscribeToPresence = (
  collectionName: PresenceCollection,
  roomId: string,
  callback: (members: PresentMember[]) => void,
  onError?: (error: Error) => void,
) => {
  let latest: PresentMember[] = [];

  const emit = () => {
    const now = Date.now();
    callback(latest.filter((m) => isFresh(m.lastSeen, now)));
  };

  const unsubscribe = onSnapshot(
    collection(db, collectionName, roomId, 'members'),
    (snap) => {
      latest = snap.docs.map((d) => {
        const data = d.data();
        return {
          uid: d.id,
          nickname: data.nickname ?? 'Guest',
          avatarData: data.avatarData ?? null,
          lastSeen: toMillis(data.lastSeen),
        };
      });
      emit();
    },
    (error) => {
      console.warn(`[Presence] ${collectionName}/${roomId} roster failed:`, error?.message ?? error);
      onError?.(error as Error);
    },
  );

  const sweep = setInterval(emit, HEARTBEAT_MS);

  return () => {
    clearInterval(sweep);
    unsubscribe();
  };
};

/**
 * Recompute `activeMemberCount` from presence and write the true value.
 *
 * The count stays on the room document because the lobby lists many rooms at
 * once and cannot open a roster subscription for each one. Keeping it as a
 * derived snapshot — `set` from a counting query, never `increment` — means a
 * missed leave is corrected by the next reconcile instead of compounding.
 *
 * Counted server-side so the whole roster never crosses the wire. The
 * `lastSeen` inequality needs only the automatic single-field index.
 */
export const reconcileMemberCount = async (
  collectionName: PresenceCollection,
  roomId: string,
  /**
   * Which field on the room stores the derived total. Ludo keeps
   * `activeMemberCount` for seated players — a distinct thing from "everyone in
   * the room" — so it stores presence under its own field instead of
   * overwriting the player count.
   */
  countField: string = 'activeMemberCount',
): Promise<number> => {
  const cutoff = Timestamp.fromMillis(Date.now() - PRESENCE_TTL_MS);
  const members = collection(db, collectionName, roomId, 'members');
  const present = query(members, where('lastSeen', '>', cutoff));

  const [countSnap, previewSnap] = await Promise.all([
    getCountFromServer(present),
    // A handful of faces for the lobby card. Denormalised onto the room rather
    // than read per row: a lobby shows many rooms at once, and opening a roster
    // subscription for each one would cost a listener per card for decoration.
    getDocs(query(present, limit(ROSTER_PREVIEW_SIZE))),
  ]);

  const preview: RosterPreviewEntry[] = previewSnap.docs.map((d) => {
    const data = d.data();
    return { uid: d.id, nickname: data.nickname ?? 'Guest', avatarData: data.avatarData ?? null };
  });

  const count = countSnap.data().count;
  await updateDoc(doc(db, collectionName, roomId), {
    [countField]: count,
    roster: preview,
  });
  return count;
};

/**
 * The host's heartbeat, kept on the room document itself.
 *
 * The lobby reads room documents and nothing else, so this is what lets it tell
 * an abandoned room from a quiet one without opening a roster per row.
 */
export const markRoomAlive = async (collectionName: PresenceCollection, roomId: string) => {
  await updateDoc(doc(db, collectionName, roomId), { hostLastSeen: Timestamp.now() });
};

/**
 * Whether a room in a lobby listing should still read as live.
 *
 * Rooms created before this field existed have no `hostLastSeen` at all. Those
 * are treated as live rather than swept away, so deploying this doesn't blank
 * out every room already open.
 */
export const isRoomLive = (room: { status?: string; hostLastSeen?: any }, now: number = Date.now()): boolean => {
  if (room.status && room.status !== 'live') return false;
  const beat = toMillis(room.hostLastSeen);
  if (beat === 0) return true;
  return now - beat <= ROOM_STALE_MS;
};
