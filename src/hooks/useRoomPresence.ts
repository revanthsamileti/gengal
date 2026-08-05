import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import {
  HEARTBEAT_MS,
  PresenceCollection,
  PresentMember,
  clearPresence,
  isRoomLive,
  markPresent,
  markRoomAlive,
  reconcileMemberCount,
  subscribeToPresence,
} from '../services/presenceService';

/**
 * How the room's realtime link is doing, from the client's point of view.
 *
 * `degraded` means writes are failing but we have not given up — worth telling
 * the user, since a room that silently stops syncing looks identical to a room
 * where nothing is happening.
 */
export type ConnectionState = 'connecting' | 'live' | 'degraded';

/** Consecutive failed heartbeats before we admit something is wrong. */
const DEGRADED_AFTER_FAILURES = 2;

/** How often the host recomputes the stored member count. */
const RECONCILE_EVERY_BEATS = 3;

type Options = {
  collectionName: PresenceCollection;
  roomId: string | undefined;
  uid: string;
  nickname: string;
  avatarData?: any;
  /** Hosts additionally heartbeat the room document and reconcile the count. */
  isHost: boolean;
  /** Room field the derived headcount is stored under. See reconcileMemberCount. */
  countField?: string;
  /** Hold off until the room has actually loaded. */
  enabled?: boolean;
};

/**
 * Keeps this client present in a room, and reports who else is.
 *
 * The heartbeat is the whole mechanism: presence expires on its own, so the
 * only way to stay in a room is to keep saying so. That means an unclean exit
 * needs no cleanup — stopping the heartbeat *is* leaving.
 *
 * Backgrounding pauses the heartbeat deliberately. A phone in someone's pocket
 * is not in the room, and letting it keep asserting presence would put the
 * ghosts straight back.
 */
export function useRoomPresence({
  collectionName,
  roomId,
  uid,
  nickname,
  avatarData,
  isHost,
  countField,
  enabled = true,
}: Options) {
  const [members, setMembers] = useState<PresentMember[]>([]);
  const [connection, setConnection] = useState<ConnectionState>('connecting');

  // Read inside the interval without making it a dependency — re-creating the
  // timer on every profile tweak would reset the heartbeat clock.
  const identity = useRef({ nickname, avatarData, isHost, countField });
  identity.current = { nickname, avatarData, isHost, countField };

  const failures = useRef(0);
  const beats = useRef(0);

  const active = Boolean(enabled && roomId && uid);

  const beat = useCallback(async () => {
    if (!roomId || !uid) return;
    const { nickname: name, avatarData: avatar, isHost: host, countField: field } = identity.current;
    try {
      await markPresent(collectionName, roomId, uid, { nickname: name, avatarData: avatar });

      if (host) {
        await markRoomAlive(collectionName, roomId);
        beats.current += 1;
        if (beats.current % RECONCILE_EVERY_BEATS === 0) {
          // Only the host reconciles. Every client doing it would be the same
          // write from N devices, racing to store the same number.
          await reconcileMemberCount(collectionName, roomId, field).catch((e) => {
            console.warn('[Presence] Count reconcile failed:', e?.message ?? e);
          });
        }
      }

      failures.current = 0;
      setConnection('live');
    } catch (e: any) {
      console.warn('[Presence] Heartbeat failed:', e?.message ?? e);
      failures.current += 1;
      if (failures.current >= DEGRADED_AFTER_FAILURES) setConnection('degraded');
    }
  }, [collectionName, roomId, uid]);

  // Heartbeat loop, paused while the app is not in the foreground.
  useEffect(() => {
    if (!active) return;

    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      beat();
      timer = setInterval(beat, HEARTBEAT_MS);
    };

    const stop = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };

    if (AppState.currentState === 'active') start();

    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        setConnection('connecting');
        start();
      } else {
        stop();
      }
    });

    return () => {
      stop();
      sub.remove();
      // Best effort: a clean exit removes the record immediately so the room
      // updates now instead of at the TTL. If it fails, the TTL still covers us
      // — which is the point of building it this way.
      if (roomId && uid) {
        clearPresence(collectionName, roomId, uid).catch(() => {});
      }
    };
  }, [active, beat, collectionName, roomId, uid]);

  // Live roster.
  useEffect(() => {
    if (!active || !roomId) {
      setMembers([]);
      return;
    }
    return subscribeToPresence(
      collectionName,
      roomId,
      setMembers,
      () => setConnection('degraded'),
    );
  }, [active, collectionName, roomId]);

  return {
    members,
    /** Trustworthy occupancy: derived from live heartbeats, not a stored counter. */
    liveCount: members.length,
    connection,
  };
}

/** How often a lobby re-checks whether the rooms it is showing are still live. */
const LOBBY_SWEEP_MS = 25_000;

/**
 * Filters a lobby listing down to rooms whose host is still heartbeating.
 *
 * A room only stops being live when its host closes it, and a host who crashes
 * or force-quits never gets to. Those rooms sit in the lobby as `status: 'live'`
 * forever, and tapping one drops you into an empty room with nobody in it.
 *
 * Liveness lapses with the passage of time rather than with a write, so this
 * re-evaluates on a timer as well as whenever the listing changes — otherwise a
 * lobby left open on screen would keep showing rooms that died while it sat there.
 */
export function useLiveRooms<T extends { status?: string; hostLastSeen?: any }>(rooms: T[]): T[] {
  const [sweep, setSweep] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setSweep((n) => n + 1), LOBBY_SWEEP_MS);
    return () => clearInterval(id);
  }, []);

  return useMemo(() => {
    const now = Date.now();
    return rooms.filter((room) => isRoomLive(room, now));
    // `sweep` is the point: it re-runs the filter as time passes.
  }, [rooms, sweep]);
}
