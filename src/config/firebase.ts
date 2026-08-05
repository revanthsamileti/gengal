import { initializeApp, getApp, getApps } from 'firebase/app';
import * as FirebaseAuth from 'firebase/auth';
import { initializeAuth, getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const firebaseConfig = {
  apiKey: "AIzaSyDf20OS0bDrX76sRiVyPI-D6t8iLOlXpkQ",
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
export const db = getFirestore(app);
