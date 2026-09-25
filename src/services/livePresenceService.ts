import { getApp } from 'firebase/app';
import {
  getDatabase,
  onDisconnect,
  onValue,
  ref,
  serverTimestamp,
  set,
} from 'firebase/database';

/**
 * Instant "they are gone" presence, using Realtime Database onDisconnect.
 *
 * Firestore can only ever say someone left if their phone lives long enough to
 * write it. A phone that is powered off, force-stopped, or loses signal writes
 * nothing, so the only thing left is a staleness window -- and a window is, by
 * definition, a delay.
 *
 * onDisconnect inverts that. The "mark me offline" write is registered *on
 * Google's servers* while the phone is still connected, and their server
 * performs it when the socket drops. Nothing has to run on the dead phone.
 *
 * Used as a negative signal only: RTDB can hide somebody sooner than the
 * Firestore rule would, never show somebody that rule says is offline. A uid
 * with no record here -- an install still on an older build -- is simply not
 * known to be offline, and falls through to the existing behaviour. That makes
 * this strictly additive: the worst it can do is nothing.
 *
 * Free on the Spark plan, within 100 simultaneous connections and 1 GB. A
 * presence record is a boolean and a timestamp, so the storage and bandwidth
 * limits are not the binding constraint; the connection count is.
 *
 * Inert until a Realtime Database exists for the project: every entry point
 * catches, and `available` stays false, so the app behaves exactly as it did
 * before if the database was never created.
 */

/** Where each signed-in phone publishes whether it is connected. */
const STATUS_PATH = 'status';

type Listener = () => void;

const listeners = new Set<Listener>();
/** uids RTDB has positively told us are offline. Absence means "no opinion". */
let knownOffline = new Set<string>();
let available = false;

const publish = (next: Set<string>) => {
  knownOffline = next;
  listeners.forEach((fn) => fn());
};

/** True once a Realtime Database has actually answered us. */
export const isLivePresenceAvailable = () => available;

/**
 * Whether RTDB has positively reported this uid as disconnected.
 *
 * Deliberately false for a uid it has never heard of, so an install that does
 * not publish presence is never hidden on the strength of missing data.
 */
export const isKnownOffline = (uid?: string | null): boolean =>
  Boolean(uid) && knownOffline.has(uid as string);

export const onLivePresenceChange = (fn: Listener) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

const database = () => {
  const app = getApp();
  // Throws when the app carries no databaseURL, which is the "not set up yet"
  // case and is handled by every caller.
  return getDatabase(app);
};

/**
 * Publish this user's presence and register the disconnect write.
 *
 * `.info/connected` is the hook rather than a one-off call at sign-in: an
 * onDisconnect registration is consumed when it fires, and a phone on mobile
 * data reconnects constantly. Re-arming on every reconnect is what keeps it
 * true for the whole session rather than only until the first blip.
 *
 * Returns a stop function. Safe to call when there is no database.
 */
export const startLivePresence = (uid: string): (() => void) => {
  let stopped = false;
  let offConnected: (() => void) | undefined;
  let offStatus: (() => void) | undefined;

  try {
    const db = database();
    const mine = ref(db, `${STATUS_PATH}/${uid}`);

    offConnected = onValue(ref(db, '.info/connected'), (snap) => {
      if (stopped || snap.val() !== true) return;
      available = true;
      // Arm the disconnect write BEFORE claiming to be online. The other order
      // leaves a gap where a drop between the two writes would strand this
      // user as permanently online -- the exact bug this exists to remove.
      onDisconnect(mine)
        .set({ online: false, at: serverTimestamp() })
        .then(() => {
          if (!stopped) void set(mine, { online: true, at: serverTimestamp() });
        })
        .catch(() => {
          // No database, or rules refuse: stay on the Firestore rule.
        });
    });

    offStatus = onValue(
      ref(db, STATUS_PATH),
      (snap) => {
        const all = snap.val() as Record<string, { online?: boolean }> | null;
        if (!all) return;
        available = true;
        const offline = new Set<string>();
        for (const [id, value] of Object.entries(all)) {
          if (value && value.online === false) offline.add(id);
        }
        publish(offline);
      },
      () => {
        // Unreadable: no opinion rather than a wrong one.
        available = false;
        publish(new Set());
      },
    );
  } catch {
    available = false;
  }

  return () => {
    stopped = true;
    try {
      offConnected?.();
      offStatus?.();
    } catch {
      // Nothing to unhook.
    }
    publish(new Set());
    available = false;
  };
};

/**
 * Say so immediately when leaving or returning, rather than waiting for the
 * socket to notice. Backgrounding does not always drop the connection, so
 * onDisconnect alone would not cover pressing Home.
 */
export const markLivePresence = async (uid: string, online: boolean): Promise<void> => {
  try {
    await set(ref(database(), `${STATUS_PATH}/${uid}`), {
      online,
      at: serverTimestamp(),
    });
  } catch {
    // Without a database this is a no-op; Firestore still carries the state.
  }
};
