import { initializeApp, getApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

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

export const auth = getAuth(app);
auth.settings.appVerificationDisabledForTesting = true;
export const db = getFirestore(app);
