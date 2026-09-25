import { initializeApp, getApp, getApps } from 'firebase/app';
import * as FirebaseAuth from 'firebase/auth';
import { initializeAuth, getAuth } from 'firebase/auth';
import { getFirestore, initializeFirestore } from 'firebase/firestore';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Realtime Database, used only for onDisconnect presence (livePresenceService).
 *
 * Its URL carries the region, chosen when the database is created, so it cannot
 * be derived from the project id -- and a URL wrong by one region fails
 * silently. This one is the real instance: Singapore (asia-southeast1), on the
 * no-cost Spark plan. Public, like the apiKey beside it; the rules are what
 * protect the data, not the address.
 *
 * The env var stays as an override for a second project or a local emulator.
 * With no value at all the SDK reports no database, every presence call
 * catches, and the app falls back to the Firestore staleness rule.
 */
const databaseURL =
  process.env.EXPO_PUBLIC_FIREBASE_DATABASE_URL ||
  'https://gengal-38003-default-rtdb.asia-southeast1.firebasedatabase.app';

export const firebaseConfig = {
  apiKey: "AIzaSyDf20OS0bDrX76sRiVyPI-D6t8iLOlXpkQ",
  ...(databaseURL ? { databaseURL } : {}),
  authDomain: "gengal-38003.firebaseapp.com",
  projectId: "gengal-38003",
  storageBucket: "gengal-38003.firebasestorage.app",
  messagingSenderId: "564095466372",
  appId: "1:564095466372:web:6a7faf45eb986307113bd1",
  measurementId: "G-EZ63X75QBW"
};

// Initialize Firebase only if it hasn't been initialized yet
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

/**
 * Auth persistence differs by platform.
 *
 * Firebase expects `persistence` to be a class, not an instance. The previous
 * fallback handed it a plain `{ type: 'LOCAL', storage }` object whenever
 * `getReactNativePersistence` was missing — which is always the case on web —
 * producing "INTERNAL ASSERTION FAILED: Expected a class definition" on every
 * load. On web the SDK already picks indexedDB/localStorage on its own.
 */
const resolveAuth = () => {
  if (Platform.OS === 'web') {
    return getAuth(app);
  }

  const getReactNativePersistence = (FirebaseAuth as any).getReactNativePersistence;
  if (!getReactNativePersistence) {
    return getAuth(app);
  }

  try {
    return initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    // Already initialised — happens on fast refresh.
    return getAuth(app);
  }
};

export const auth = resolveAuth();
/**
 * Firestore, told to detect when its streaming connection is not getting
 * through.
 *
 * The default transport is a long-lived WebChannel stream. Indian mobile
 * networks, hotel and office Wi-Fi and some carrier proxies buffer or cut that
 * stream, which shows up as
 *   "WebChannelConnection RPC 'Listen' stream transport errored"
 * in the log and, on the phone, as lists and chats that quietly stop updating
 * until the app is restarted — exactly the "nothing works on bad internet"
 * complaint. Auto-detect falls back to long polling on those networks and
 * keeps the streaming path everywhere else.
 */
export const db = (() => {
  try {
    return initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
  } catch {
    // Already initialised (a second import, or a fast refresh).
    return getFirestore(app);
  }
})();
