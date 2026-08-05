import { db } from '../config/firebase';
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
  arrayRemove
} from 'firebase/firestore';

const ONLINE_FRESHNESS_MS = 5 * 60 * 1000;

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
const PRIVATE_KEYS = ['phoneNumber', 'expoPushToken'] as const;

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
export const isUserAvailableNow = (user: UserProfile): boolean => {
  if (user.isOnline !== true) return false;
  if (user.isActiveMode === false) return false;
  if ((user as any).isSessionActive === false) return false;
  const lastActiveMs = toMillis(user.lastActive);
  return lastActiveMs > 0 && Date.now() - lastActiveMs <= ONLINE_FRESHNESS_MS;
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

export const subscribeToOnlineUsers = (callback: (users: UserProfile[]) => void, currentUid?: string, vipOnly = false) => {
  const usersRef = collection(db, 'users');
  const q = query(
    usersRef,
    where('isOnline', '==', true),
    orderBy('lastActive', 'desc'),
    limit(DIRECTORY_PAGE_SIZE)
  );

  return onSnapshot(q, (querySnapshot) => {
    const users: UserProfile[] = [];
    querySnapshot.forEach((doc) => {
      const data = doc.data() as UserProfile;
      if (currentUid && doc.id === currentUid) return;
      if (vipOnly && data.isVip !== true) return;
      if (data.isActiveMode === false) return;

      const lastActiveMs = toMillis(data.lastActive);
      if (!lastActiveMs || Date.now() - lastActiveMs > ONLINE_FRESHNESS_MS) return;

      users.push({
        ...data,
        uid: doc.id,
        avatarData: data.avatarData || placeholderAvatarData(doc.id),
        tier: resolveTier(data),
      });
    });
    callback(users);
  }, (error) => {
    console.error("Error subscribing to online users:", error);
  });
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

  return onSnapshot(q, (querySnapshot) => {
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
    callback(users);
  }, (error) => {
    console.error("Error subscribing to all users:", error);
  });
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

  return onSnapshot(q, (querySnapshot) => {
    const users: UserProfile[] = [];
    querySnapshot.forEach((doc) => {
      const data = doc.data() as UserProfile;
      if (currentUid && doc.id === currentUid) return;
      if (data.isDeleted === true || data.deletedAt) return;

      const hasProfileIdentity = Boolean(data.nickname || data.username);
      if (!hasProfileIdentity) return;

      if (data.isSessionActive === false) return;

      const lastActiveMs = toMillis(data.lastActive);
      if (!lastActiveMs || Date.now() - lastActiveMs > ONLINE_FRESHNESS_MS) return;

      users.push(normalizeVisibleUser(doc.id, data));
    });

    callback(users);
  }, (error) => {
    console.error("Error subscribing to recent users:", error);
  });
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

export const updateUserStatus = async (uid: string, isOnline: boolean) => {
  try {
    const userRef = doc(db, 'users', uid);
    const userSnap = await getDoc(userRef);
    const isActiveMode = userSnap.exists() ? userSnap.data().isActiveMode !== false : true;
    await updateDoc(userRef, {
      isOnline: isOnline && isActiveMode,
      isSessionActive: isOnline,
      lastActive: serverTimestamp()
    });
  } catch (error) {
    console.error("Error updating user status:", error);
  }
};
