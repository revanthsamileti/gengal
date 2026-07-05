import { db } from '../config/firebase';
import { doc, getDoc, setDoc, updateDoc, onSnapshot } from 'firebase/firestore';

export interface GlobalSettings {
  voiceCallRatePerMin: number;
  videoCallRatePerMin: number;
  creatorSharePercentage: number; // 0 to 100
  femaleExpertHeartsThreshold: number;
  maleExpertRespectThreshold: number;
  callDurationForHeart: number; // in minutes
  heartToInrRate: number; // e.g., 3 Rs per Heart
  minRechargeAmount: number; // e.g., 49 Rs
  inrToCoinRechargeRate: number; // e.g., 1.1 Coins per Rs
}

const SETTINGS_DOC_ID = 'pricing';

/**
 * Ensures the global settings document exists with default values.
 */
export const initializeGlobalSettings = async () => {
  const settingsRef = doc(db, 'settings', SETTINGS_DOC_ID);
  const snap = await getDoc(settingsRef);
  if (!snap.exists()) {
    await setDoc(settingsRef, {
      voiceCallRatePerMin: 15,
      videoCallRatePerMin: 30,
      creatorSharePercentage: 70,
      femaleExpertHeartsThreshold: 50,
      maleExpertRespectThreshold: 30,
      callDurationForHeart: 3,
      heartToInrRate: 3,
      minRechargeAmount: 49,
      inrToCoinRechargeRate: 1.12
    });
  }
};

/**
 * Fetches the current global settings once.
 */
export const getGlobalSettings = async (): Promise<GlobalSettings> => {
  const settingsRef = doc(db, 'settings', SETTINGS_DOC_ID);
  const snap = await getDoc(settingsRef);
  if (snap.exists()) {
    return snap.data() as GlobalSettings;
  }
  return {
    voiceCallRatePerMin: 15,
    videoCallRatePerMin: 30,
    creatorSharePercentage: 70,
    femaleExpertHeartsThreshold: 50,
    maleExpertRespectThreshold: 30,
    callDurationForHeart: 3,
    heartToInrRate: 3,
    minRechargeAmount: 49,
    inrToCoinRechargeRate: 1.12
  };
};

/**
 * Subscribes to the global settings in real-time.
 */
export const subscribeToGlobalSettings = (callback: (settings: GlobalSettings) => void) => {
  const settingsRef = doc(db, 'settings', SETTINGS_DOC_ID);
  return onSnapshot(settingsRef, (snap) => {
    if (snap.exists()) {
      callback(snap.data() as GlobalSettings);
    } else {
      callback({
        voiceCallRatePerMin: 15,
        videoCallRatePerMin: 30,
        creatorSharePercentage: 70,
        femaleExpertHeartsThreshold: 50,
        maleExpertRespectThreshold: 30,
        callDurationForHeart: 3,
        heartToInrRate: 3,
        minRechargeAmount: 49,
        inrToCoinRechargeRate: 1.12
      });
    }
  });
};

/**
 * Updates the global settings. Requires admin privileges via security rules.
 */
export const updateGlobalSettings = async (newSettings: Partial<GlobalSettings>) => {
  const settingsRef = doc(db, 'settings', SETTINGS_DOC_ID);
  await updateDoc(settingsRef, newSettings);
};
