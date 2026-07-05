import { db } from '../config/firebase';
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  collection,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  arrayUnion,
  arrayRemove
} from 'firebase/firestore';

export interface UserProfile {
  uid?: string;
  phoneNumber?: string;
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
  tier?: 'VIP' | 'Elite' | 'Standard';
  bio?: string;
  followers?: number | string[];
  following?: number | string[];
}

export const saveUserProfile = async (uid: string, profileData: Partial<UserProfile>) => {
  try {
    const userRef = doc(db, 'users', uid);
    
    // Check if user exists first to decide whether to set or update
    const userSnap = await getDoc(userRef);
    
    if (userSnap.exists()) {
      await updateDoc(userRef, {
        ...profileData,
        lastActive: serverTimestamp()
      });
    } else {
      await setDoc(userRef, {
        ...profileData,
        uid,
        coins: 500, // Initial signup bonus from UI
        hearts: 0,
        respectBadges: 0,
        unrewardedCallSeconds: 0,
        totalReceivedCallSeconds: 0,
        tier: profileData.avatarUrl ? 'VIP' : 'Elite',
        createdAt: serverTimestamp(),
        lastActive: serverTimestamp()
      });
    }
  } catch (error) {
    console.error("Error saving user profile:", error);
    throw error;
  }
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

export const subscribeToOnlineUsers = (callback: (users: UserProfile[]) => void, currentUid?: string, vipOnly = false) => {
  const usersRef = collection(db, 'users');
  const q = query(usersRef, where('isOnline', '==', true));

  return onSnapshot(q, (querySnapshot) => {
    const users: UserProfile[] = [];
    querySnapshot.forEach((doc) => {
      const data = doc.data() as UserProfile;
      if (currentUid && data.uid === currentUid) return;
      if (vipOnly && !data.avatarUrl) return;
      // Inject some mock data if missing to keep the UI looking good
      const derivedTier: 'VIP' | 'Elite' = data.avatarUrl ? 'VIP' : 'Elite';
      users.push({
        ...data,
        avatarData: data.avatarData || (() => {
          const seed = (data.uid || '').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
          return {
            topType: MOCK_TOPS[seed % MOCK_TOPS.length],
            hairColor: "Black",
            clotheType: MOCK_CLOTHES[seed % MOCK_CLOTHES.length],
            skinColor: MOCK_SKINS[seed % MOCK_SKINS.length],
          };
        })(),
        tier: derivedTier,
      });
    });
    callback(users);
  }, (error) => {
    console.error("Error subscribing to online users:", error);
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

export const followUser = async (currentUid: string, targetUid: string) => {
  const currentRef = doc(db, 'users', currentUid);
  const targetRef = doc(db, 'users', targetUid);
  await Promise.all([
    updateDoc(currentRef, { following: arrayUnion(targetUid) }),
    updateDoc(targetRef, { followers: arrayUnion(currentUid) }),
  ]);
};

export const unfollowUser = async (currentUid: string, targetUid: string) => {
  const currentRef = doc(db, 'users', currentUid);
  const targetRef = doc(db, 'users', targetUid);
  await Promise.all([
    updateDoc(currentRef, { following: arrayRemove(targetUid) }),
    updateDoc(targetRef, { followers: arrayRemove(currentUid) }),
  ]);
};

export const updateUserStatus = async (uid: string, isOnline: boolean) => {
  try {
    const userRef = doc(db, 'users', uid);
    await updateDoc(userRef, {
      isOnline,
      lastActive: serverTimestamp()
    });
  } catch (error) {
    console.error("Error updating user status:", error);
  }
};
