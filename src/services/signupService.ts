import { PermissionsAndroid, Platform } from 'react-native';
import { signInWithCustomToken } from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { logDebugEvent, setDebugContext } from './debugLogger';
import { savePrivateUserData } from './userService';

/** Carried from VerifyBySms -> ProfileDetails -> FinalizeInvite. */
export type SignupParams = {
  phone: string;
  token: string;
  name: string;
  nickname?: string;
  dob: number | string;
  gender: string;
  country?: string;
  state?: string;
  city?: string;
  language?: string;
  avatar: unknown;
};

/** Firebase custom tokens live one hour; a slow sign-up can outlast it. */
export class SignupExpiredError extends Error {
  constructor() {
    super('Your verification has expired. Please verify your number again.');
    this.name = 'SignupExpiredError';
  }
}

const EXPIRED_TOKEN_CODES = new Set(['auth/invalid-custom-token', 'auth/custom-token-mismatch']);

/**
 * Signs in with the token minted at verification time and creates the
 * account documents. Sign-in is deferred to here, as before, so an abandoned
 * sign-up never leaves a half-made account behind.
 */
export const completeSignup = async (params: SignupParams): Promise<void> => {
  let uid: string;
  try {
    const credential = await signInWithCustomToken(auth, params.token);
    uid = credential.user.uid;
  } catch (error: any) {
    if (EXPIRED_TOKEN_CODES.has(error?.code)) throw new SignupExpiredError();
    throw error;
  }
  setDebugContext({ userId: uid });

  // The phone number is private, so it goes to /user_private rather than the
  // world-readable profile document.
  await savePrivateUserData(uid, { phoneNumber: params.phone });

  await setDoc(doc(db, 'users', uid), {
    // Security rules require uid to match the document id.
    uid,
    username: params.name,
    nickname: params.nickname || params.name,
    age: params.dob,
    gender: params.gender,
    country: params.country || '',
    state: params.state || '',
    city: params.city || '',
    language: params.language || '',
    avatar3dUrl: 'CUSTOM_BUILDER_AVATAR',
    avatarData: params.avatar,
    coins: 500,
    hearts: 0,
    respectBadges: 0,
    unrewardedCallSeconds: 0,
    totalReceivedCallSeconds: 0,
    isActiveMode: true,
    isOnline: true,
    isSessionActive: true,
    lastActive: serverTimestamp(),
    createdAt: serverTimestamp(),
  });
  logDebugEvent('auth.signup.completed', { uid });

  // Prime mic/camera permissions now, before the first call needs them.
  // Best-effort: CallScreen still gates on the mic permission itself.
  if (Platform.OS === 'android') {
    PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      PermissionsAndroid.PERMISSIONS.CAMERA,
    ]).catch(() => {});
  }
};
