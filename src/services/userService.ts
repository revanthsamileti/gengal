import { db } from '../config/firebase';
import { isBlocked, onBlockListChange } from './safetyService';
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  getCountFromServer,
  arrayUnion,
  arrayRemove,
  deleteField
} from 'firebase/firestore';

/**
 * How long a lastActive timestamp stays fresh enough to count as "online".
 *
 * Exported so App.tsx (the heartbeat driver) and any screen that renders
 * availability status use the same number — previously this was a private
 * constant, so callers invented their own cutoffs that could drift apart.
 *
 * This is the ceiling on how long someone can linger in Online Now after they
 * are gone. A phone that is swiped away, powered off, or loses signal writes
 * nothing on the way out — there is no process left to write — so nothing but
 * this window can hide them. Five minutes was too long to be believable, hence
 * 90 seconds. It cannot go much lower without the heartbeat below becoming
 * expensive, and must stay at least two heartbeats wide so a single dropped
 * write does not blink an active user out of the feed.
 *
 * The backend applies the same window to its own listings; see FRESHNESS_MS in
 * backend/app.py.
 */
export const ONLINE_FRESHNESS_MS = 90 * 1000;

/**
 * How often the App-level heartbeat should call touchLastActive.
 *
 * Must be comfortably shorter than ONLINE_FRESHNESS_MS (at least 2 heartbeat
 * intervals fit inside the TTL window), so one dropped write doesn't
 * blink a user out of the "Online Now" feed mid-session.
 *
 * Distinct from presenceService.HEARTBEAT_MS: room presence is ephemeral and
 * high-frequency (20 s), user presence is persistent and cheaper.
 *
 * Only beats while the app is on screen, so the cost is one write per 30 s of
 * actual use rather than around the clock.
 */
export const USER_HEARTBEAT_MS = 30 * 1000;

/**
 * How long an `inCallSince` stamp keeps someone reading as mid-call.
 *
 * The server re-stamps both participants on every billing tick, which runs
 * every 15 s, so three ticks of slack absorbs a dropped write or a slow network
 * without flickering someone back to "available" while they are still talking.
 *
 * The expiry is what makes this safe: a call that ends by force-quit, crash or
 * dead network is never explicitly cleared, and a boolean flag would strand
 * that user as permanently busy — invisible to callers, earning nothing. Here
 * the stamp simply stops being refreshed and ages out on its own.
 */
export const CALL_BUSY_TTL_MS = 45 * 1000;

/**
 * Whether this user is on a call right now.
 *
 * Server-written (see the billing tick), so it cannot be spoofed by a client
 * wanting to look unavailable — or to hide that it is already talking to
 * someone else.
 */
export const isUserInCall = (user: UserProfile, now: number = Date.now()): boolean => {
  const since = toMillis((user as any).inCallSince);
  return since > 0 && now - since <= CALL_BUSY_TTL_MS;
};

/**
 * Whether touchLastActive should write on the next tick.
 *
 * Driven by setHeartbeatEnabled, which UserContext calls whenever the user's
 * isActiveMode changes. Avoids a Firestore read on every heartbeat tick just
 * to check whether the user turned off "Show Active" — the read would cost
 * more than the write it is trying to prevent.
 *
 * Reset to true on every auth-state sign-in (via UserContext) so a sign-out
 * / sign-in cycle with a different account does not carry the previous
 * session's preference.
 */
let _heartbeatEnabled = true;

/** Called by UserContext to sync the heartbeat gate with isActiveMode. */
export const setHeartbeatEnabled = (enabled: boolean) => {
  _heartbeatEnabled = enabled;
};

/** Any signed-in user can read /users, so the listings are capped. */
const DIRECTORY_PAGE_SIZE = 50;

export interface UserProfile {
  uid?: string;
  language?: string;
  country?: string;
  state?: string;
  city?: string;
  nickname?: string;
  username?: string;
  age?: string | number;
  gender?: string;
  isVip?: boolean;
  coins?: number;
  hearts?: number;
  respectBadges?: number;
  unrewardedCallSeconds?: number;
  totalReceivedCallSeconds?: number;
  createdAt?: any;
  lastActive?: any;
  avatarUrl?: string; // Legacy
  avatar3dUrl?: string; // Ready Player Me GLB string
  avatarData?: {
    topType: string;
    hairColor: string;
    clotheType: string;
    skinColor: string;
    facialHairType?: string;
    facialHairColor?: string;
    accessoriesType?: string;
    clotheColor?: string;
    mouthType?: string;
    eyeType?: string;
    eyebrowType?: string;
    bgColor?: string;
    isPremiumConfig?: boolean;
  };
  isOnline?: boolean;
  isActiveMode?: boolean;
  isSessionActive?: boolean;
  /**
   * This person's phone can get a call as a notification while GenGal is not
   * on screen. Set by the app once its Firebase token is stored; cleared by the
   * backend when that token stops working, and on sign-out. See isListedOnline.
   */
  pushReachable?: boolean;
  /** Server-stamped on every billing tick while on a call. See isUserInCall. */
  inCallSince?: any;
  isDeleted?: boolean;
  deletedAt?: any;
  tier?: 'VIP' | 'Advance' | 'Standard';
  bio?: string;
  followers?: number | string[];
  following?: number | string[];
}

/**
 * Fields that must never live on /users, because that document is readable by
 * every signed-in user. Stored in /user_private/{uid}, owner-access only.
 */
export interface UserPrivateData {
  phoneNumber?: string;
  expoPushToken?: string;
  /** Firebase Cloud Messaging token; what backend/push.py sends to. */
  fcmToken?: string;
  /** Which Android call channel this install has (see notificationService). */
  callChannelId?: string;
}

export const savePrivateUserData = async (uid: string, data: Partial<UserPrivateData>) => {
  await setDoc(doc(db, 'user_private', uid), data, { merge: true });
};

export const getPrivateUserData = async (uid: string): Promise<UserPrivateData | null> => {
  const snap = await getDoc(doc(db, 'user_private', uid));
  return snap.exists() ? (snap.data() as UserPrivateData) : null;
};

/**
 * Balances and hearts are server-authoritative (see coinService) and private
 * contact details belong in /user_private, so both are dropped here rather than
 * silently failing against the security rules at write time.
 */
const SERVER_OWNED_KEYS = ['coins', 'hearts', 'respectBadges', 'password', 'passwordHash'] as const;
const PRIVATE_KEYS = ['phoneNumber', 'expoPushToken', 'fcmToken'] as const;

const splitProfileData = (profileData: Record<string, any>) => {
  const publicData: Record<string, any> = {};
  const privateData: Record<string, any> = {};

  Object.entries(profileData).forEach(([key, value]) => {
    if ((PRIVATE_KEYS as readonly string[]).includes(key)) {
      privateData[key] = value;
    } else if ((SERVER_OWNED_KEYS as readonly string[]).includes(key)) {
      console.warn(`[userService] Ignoring server-owned field "${key}" in saveUserProfile.`);
    } else {
      publicData[key] = value;
    }
  });

  return { publicData, privateData };
};

export const saveUserProfile = async (uid: string, profileData: Partial<UserProfile> & Record<string, any>) => {
  try {
    const userRef = doc(db, 'users', uid);
    const { publicData, privateData } = splitProfileData(profileData);

    if (Object.keys(privateData).length > 0) {
      await savePrivateUserData(uid, privateData);
    }

    // Check if user exists first to decide whether to set or update
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
      await updateDoc(userRef, {
        ...publicData,
        lastActive: serverTimestamp()
      });
    } else {
      await setDoc(userRef, {
        ...publicData,
        uid,
        coins: 500, // Initial signup bonus from UI
        hearts: 0,
        respectBadges: 0,
        unrewardedCallSeconds: 0,
        totalReceivedCallSeconds: 0,
        tier: resolveTier(profileData),
        isActiveMode: profileData.isActiveMode !== false,
        isOnline: profileData.isActiveMode !== false,
        isSessionActive: true,
        createdAt: serverTimestamp(),
        lastActive: serverTimestamp()
      });
    }
  } catch (error) {
    console.error("Error saving user profile:", error);
    throw error;
  }
};

const toMillis = (value: any): number => {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return 0;
};

/**
 * Whether a profile should read as reachable right now.
 *
 * Mirrors the conditions the online-only listings filter on, so someone cannot
 * show "Available now" in the full directory while being excluded from the
 * online lists. Kept here rather than in a screen so the rule has one home.
 */
export type Presence = {
  text: string;
  tone: 'online' | 'busy' | 'offline';
};

/** "3m", "4h", "2d" -- short enough for the narrow column in a chat header. */
const sinceLabel = (ms: number): string => {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d ago` : 'a while ago';
};

/**
 * What to show under someone's name: one sentence, and the colour for the dot.
 *
 * Lives next to the rules it reads so a header cannot drift from the listings.
 * The chat header used to render a green dot and the words "Online now" as
 * static text, for everybody, forever.
 *
 * Someone who has turned "Show me as online" off gets a bare "Offline" with no
 * time: a last-seen stamp would hand back exactly the presence they asked the
 * app to stop publishing.
 */
export const describePresence = (user: UserProfile | null, now: number = Date.now()): Presence => {
  if (!user) return { text: '', tone: 'offline' };
  if (isUserInCall(user, now)) return { text: 'On a call', tone: 'busy' };
  if (isUserAvailableNow(user)) return { text: 'Online now', tone: 'online' };
  if (user.isActiveMode === false) return { text: 'Offline', tone: 'offline' };
  const lastActiveMs = toMillis(user.lastActive);
  if (!lastActiveMs) return { text: 'Offline', tone: 'offline' };
  return { text: `Last seen ${sinceLabel(now - lastActiveMs)}`, tone: 'offline' };
};

export const isUserAvailableNow = (user: UserProfile): boolean => {
  // Someone mid-call is online but not reachable. Showing them as "Available
  // now" invites a call that cannot be answered, and the caller pays the full
  // ring timeout to discover it.
  return isListedOnline(user) && !isUserInCall(user);
};

/**
 * Whether someone shows as online: their "Show me as online" switch is on,
 * they are signed in, and a call can reach them.
 *
 * A call reaches them either because GenGal is open (a heartbeat inside
 * ONLINE_FRESHNESS_MS) or because their phone gets calls as notifications
 * (`pushReachable`). The second is what keeps someone online after they press
 * Home or swipe the app away: leaving the app used to write isOnline: false,
 * so the switch looked on while nobody could see or call them. The switch is
 * what decides now.
 *
 * Records with neither -- web sessions that ended, installs from before push
 * worked -- still age out after ONLINE_FRESHNESS_MS, so people nobody can
 * reach do not pile up in the list.
 */
export const isListedOnline = (user: UserProfile, now: number = Date.now()): boolean => {
  if (user.isOnline !== true) return false;
  if (user.isActiveMode === false) return false;
  if (user.isSessionActive === false) return false;
  // `pushReachable` used to keep someone listed indefinitely while they were
  // away, on the grounds that a call could still reach their phone. It made
  // people who had swiped GenGal off their recents sit in Online Now for
  // hours, which is worse than missing them: the list stopped meaning
  // anything. Being reachable is not the same as being there, and it still
  // decides call delivery -- it just no longer decides this.
  const lastActiveMs = toMillis(user.lastActive);
  return lastActiveMs > 0 && now - lastActiveMs <= ONLINE_FRESHNESS_MS;
};

export const getUserProfile = async (uid: string): Promise<UserProfile | null> => {
  try {
    const userRef = doc(db, 'users', uid);
    const userSnap = await getDoc(userRef);
    
    if (userSnap.exists()) {
      return userSnap.data() as UserProfile;
    }
    return null;
  } catch (error) {
    console.error("Error fetching user profile:", error);
    throw error;
  }
};

const MOCK_TOPS = ["ShortHairShortWaved", "LongHairBun", "LongHairStraight", "ShortHairDreads01", "ShortHairShortCurly"];
const MOCK_CLOTHES = ["GraphicShirt", "CollarSweater", "BlazerShirt", "Hoodie", "ShirtCrewNeck"];
const MOCK_SKINS = ["Light", "Brown", "Black", "DarkBrown", "Yellow"];

/**
 * VIP is a paid tier, so it has to come from the paid flag and nothing else.
 * This used to read `avatarUrl ? 'VIP' : 'Advance'`, which promoted anyone who
 * uploaded a picture into the tier real subscribers pay for — and left the
 * "VIP only" filter showing non-subscribers.
 */
export const resolveTier = (data: UserProfile): 'VIP' | 'Standard' =>
  data.isVip === true ? 'VIP' : 'Standard';

/**
 * A deterministic illustrated avatar for users who never built one. Clearly an
 * illustration, so it reads as a placeholder rather than as the person — unlike
 * the stock photograph that screens used to fall back to.
 */
const placeholderAvatarData = (id: string) => {
  const seed = (id || '').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return {
    topType: MOCK_TOPS[seed % MOCK_TOPS.length],
    hairColor: "Black",
    clotheType: MOCK_CLOTHES[seed % MOCK_CLOTHES.length],
    skinColor: MOCK_SKINS[seed % MOCK_SKINS.length],
  };
};

/**
 * Wraps a directory listener so blocked people never reach a screen, and so a
 * block takes effect at once instead of on the next Firestore snapshot.
 */
const blockAware = (callback: (users: UserProfile[]) => void) => {
  let last: UserProfile[] | null = null;
  const emit = () => {
    if (last) callback(last.filter((u) => !isBlocked(u.uid)));
  };
  const off = onBlockListChange(emit);
  return {
    deliver: (users: UserProfile[]) => {
      last = users;
      emit();
    },
    off,
  };
};

export const subscribeToOnlineUsers = (callback: (users: UserProfile[]) => void, currentUid?: string, vipOnly = false) => {
  const usersRef = collection(db, 'users');
  const q = query(
    usersRef,
    where('isOnline', '==', true),
    orderBy('lastActive', 'desc'),
    limit(DIRECTORY_PAGE_SIZE)
  );

  const sink = blockAware(callback);
  const unsub = onSnapshot(q, (querySnapshot) => {
    const users: UserProfile[] = [];
    querySnapshot.forEach((doc) => {
      const data = doc.data() as UserProfile;
      if (currentUid && doc.id === currentUid) return;
      if (vipOnly && data.isVip !== true) return;
      if (!isListedOnline(data)) return;

      users.push({
        ...data,
        uid: doc.id,
        avatarData: data.avatarData || placeholderAvatarData(doc.id),
        tier: resolveTier(data),
      });
    });
    sink.deliver(users);
  }, (error) => {
    console.error("Error subscribing to online users:", error);
  });
  return () => {
    unsub();
    sink.off();
  };
};

const normalizeVisibleUser = (id: string, data: UserProfile): UserProfile => ({
  ...data,
  uid: id,
  avatarData: data.avatarData || placeholderAvatarData(id),
  tier: resolveTier(data),
});

/**
 * Every visible profile, online or not, newest activity first.
 *
 * Unlike subscribeToRecentUsers this deliberately omits the `isOnline` filter
 * and the freshness cutoff, so offline people still show up — the directory
 * screen renders them as "Inactive" with calling disabled. Ordering on
 * lastActive alone needs only the automatic single-field index.
 */
export const subscribeToAllUsers = (callback: (users: UserProfile[]) => void, currentUid?: string) => {
  // Deliberately no orderBy: Firestore drops documents that lack the ordering
  // field, so ordering on lastActive would silently hide every profile that has
  // never had it written — exactly the dormant accounts this screen exists to
  // show. Recency ordering is applied on the client instead, where a missing
  // value just sorts last. Trade-off: with more than DIRECTORY_PAGE_SIZE users
  // the page is an arbitrary slice, so this needs real pagination before the
  // directory grows large.
  const q = query(
    collection(db, 'users'),
    limit(DIRECTORY_PAGE_SIZE)
  );

  const sink = blockAware(callback);
  const unsub = onSnapshot(q, (querySnapshot) => {
    const users: UserProfile[] = [];
    querySnapshot.forEach((doc) => {
      const data = doc.data() as UserProfile;
      if (currentUid && doc.id === currentUid) return;
      if (data.isDeleted === true || data.deletedAt) return;

      // A document with no display name is a half-finished signup, not a
      // browsable profile.
      if (!data.nickname && !data.username) return;

      users.push(normalizeVisibleUser(doc.id, data));
    });

    users.sort((a, b) => toMillis(b.lastActive) - toMillis(a.lastActive));
    sink.deliver(users);
  }, (error) => {
    console.error("Error subscribing to all users:", error);
  });
  return () => {
    unsub();
    sink.off();
  };
};

export const subscribeToRecentUsers = (callback: (users: UserProfile[]) => void, currentUid?: string) => {
  // Previously an unfiltered listener over the whole users collection, which
  // re-read every document on every write. The freshness window is enforced by
  // the query rather than client-side.
  const q = query(
    collection(db, 'users'),
    where('isOnline', '==', true),
    orderBy('lastActive', 'desc'),
    limit(DIRECTORY_PAGE_SIZE)
  );

  const sink = blockAware(callback);
  const unsub = onSnapshot(q, (querySnapshot) => {
    const users: UserProfile[] = [];
    querySnapshot.forEach((doc) => {
      const data = doc.data() as UserProfile;
      if (currentUid && doc.id === currentUid) return;
      if (data.isDeleted === true || data.deletedAt) return;

      const hasProfileIdentity = Boolean(data.nickname || data.username);
      if (!hasProfileIdentity) return;

      if (!isListedOnline(data)) return;

      users.push(normalizeVisibleUser(doc.id, data));
    });

    sink.deliver(users);
  }, (error) => {
    console.error("Error subscribing to recent users:", error);
  });
  return () => {
    unsub();
    sink.off();
  };
};

export const subscribeToUserProfile = (uid: string, callback: (user: UserProfile | null) => void) => {
  const userRef = doc(db, 'users', uid);
  return onSnapshot(userRef, (docSnap) => {
    if (docSnap.exists()) {
      callback(docSnap.data() as UserProfile);
    } else {
      callback(null);
    }
  }, (error) => {
    console.error("Error subscribing to user profile:", error);
  });
};

/**
 * `following` is an array on the actor's own document, so "am I following X"
 * needs no extra read. Followers are one document per follower in a
 * subcollection, so a user can only ever add or remove themselves from someone
 * else's follower list — writing the target's user document directly is denied.
 */
export const followUser = async (currentUid: string, targetUid: string) => {
  await Promise.all([
    updateDoc(doc(db, 'users', currentUid), { following: arrayUnion(targetUid) }),
    setDoc(doc(db, 'users', targetUid, 'followers', currentUid), {
      uid: currentUid,
      createdAt: serverTimestamp(),
    }),
  ]);
};

export const unfollowUser = async (currentUid: string, targetUid: string) => {
  await Promise.all([
    updateDoc(doc(db, 'users', currentUid), { following: arrayRemove(targetUid) }),
    deleteDoc(doc(db, 'users', targetUid, 'followers', currentUid)),
  ]);
};

export const getFollowerCount = async (uid: string): Promise<number> => {
  try {
    const snap = await getCountFromServer(collection(db, 'users', uid, 'followers'));
    return snap.data().count;
  } catch (e) {
    console.warn('Error counting followers:', e);
    return 0;
  }
};

export const toggleActiveMode = async (uid: string, isActiveMode: boolean) => {
  try {
    const userRef = doc(db, 'users', uid);
    await updateDoc(userRef, {
      isActiveMode,
      isOnline: isActiveMode,
      isSessionActive: true,
      lastActive: serverTimestamp()
    });
  } catch (error) {
    console.error("Error toggling active mode:", error);
  }
};

/**
 * Refreshes only `lastActive`, to keep an open app inside ONLINE_FRESHNESS_MS.
 *
 * Deliberately does not touch isOnline or isSessionActive: a heartbeat should
 * report that the session is alive, not re-assert a state the user may have
 * changed from the Active Mode toggle in between beats.
 */
export const touchLastActive = async (uid: string) => {
  // The user has turned off "Show Active". Stop writing lastActive so we don't
  // accidentally keep them visible in freshness-filtered feeds. isOnline is
  // already false (set by toggleActiveMode), so the query filter would exclude
  // them anyway — but halting the write here is cheap and explicit.
  if (!_heartbeatEnabled) return;
  try {
    const userRef = doc(db, 'users', uid);
    // Rules read `resource.data` for an update, so a write against a document
    // that doesn't exist yet fails permission-denied rather than not-found.
    // The app's foreground/heartbeat effects can fire the instant sign-in
    // completes, before a brand-new account's profile doc has been created by
    // the onboarding flow — this is that race, not an authorization problem.
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) return;
    await updateDoc(userRef, { lastActive: serverTimestamp() });
  } catch (error) {
    console.warn('Error refreshing lastActive:', error);
  }
};

/** Records whether this phone can get calls as notifications. See isListedOnline. */
export const setPushReachable = async (uid: string, reachable: boolean) => {
  const userRef = doc(db, 'users', uid);
  const userSnap = await getDoc(userRef);
  // Same race as touchLastActive: a brand-new account may not have its profile
  // document yet. Registration runs again on the next launch.
  if (!userSnap.exists()) return;
  await updateDoc(userRef, { pushReachable: reachable });
};

/**
 * Takes a signing-out account offline and off this phone.
 *
 * Staying online outside the app depends on push, so a signed-out account
 * must also drop its tokens: otherwise it would still be listed as online and
 * its calls and messages would keep ringing whoever uses this phone next.
 */
export const markSignedOut = async (uid: string) => {
  await Promise.all([
    updateDoc(doc(db, 'users', uid), {
      isOnline: false,
      isSessionActive: false,
      pushReachable: false,
    }),
    setDoc(
      doc(db, 'user_private', uid),
      { fcmToken: deleteField(), expoPushToken: deleteField() },
      { merge: true },
    ),
  ]);
};

export const updateUserStatus = async (uid: string, isOnline: boolean) => {
  try {
    const userRef = doc(db, 'users', uid);
    const userSnap = await getDoc(userRef);
    // Same race as touchLastActive: nothing to mark online/offline before the
    // profile document exists.
    if (!userSnap.exists()) return;
    const isActiveMode = userSnap.data().isActiveMode !== false;
    // isSessionActive means "signed in", not "app on screen". Leaving the app
    // used to clear it, and isListedOnline rejects on isSessionActive === false
    // *before* it reaches the pushReachable escape hatch -- so one wrong
    // offline write hid someone from everybody until they reopened the app,
    // even though their phone could still take calls. Ending a session is
    // markSignedOut's job.
    await updateDoc(userRef, {
      isOnline: isOnline && isActiveMode,
      ...(isOnline ? { isSessionActive: true } : {}),
      lastActive: serverTimestamp()
    });
  } catch (error) {
    console.error("Error updating user status:", error);
  }
};
