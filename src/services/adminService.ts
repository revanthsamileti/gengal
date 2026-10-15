import { db } from '../config/firebase';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { authedGet, authedPost } from './authService';

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
  minWithdrawalHearts: number; // hearts a creator must hold to request a payout
  // Ludo per-minute tables. Copied onto each table when it opens, so a change
  // applies to tables opened afterwards, never to a game in progress.
  ludoHostDeposit: number;
  ludoRateOnePlayer: number;
  ludoRateTwoPlayers: number;
  ludoRateThreePlayers: number;
  ludoHostSharePercent: number;
  ludoForfeitOnePlayer: number;
  ludoForfeitTwoPlayers: number;
  ludoForfeitThreePlayers: number;
  ludoWinnerPrize: number;
  ludoHostMaxLeaves: number;
  ludoHostMaxMissedTurns: number;
  ludoEmptyCloseMinutes: number;
  // Watchers: 1 coin per started step to the app and to the host, each capped
  // per minute (5 s steps up to 6, 15 s steps up to 4: 10 a minute).
  ludoWatchAppPerMinute: number;
  ludoWatchHostPerMinute: number;
  ludoWatchAppStepSeconds: number;
  ludoWatchHostStepSeconds: number;
}

const SETTINGS_DOC_ID = 'pricing';

export const DEFAULT_SETTINGS: GlobalSettings = {
  voiceCallRatePerMin: 15,
  videoCallRatePerMin: 30,
  creatorSharePercentage: 70,
  femaleExpertHeartsThreshold: 50,
  maleExpertRespectThreshold: 30,
  callDurationForHeart: 3,
  heartToInrRate: 3,
  minRechargeAmount: 49,
  inrToCoinRechargeRate: 1.12,
  minWithdrawalHearts: 33,
  ludoHostDeposit: 50,
  ludoRateOnePlayer: 10,
  ludoRateTwoPlayers: 12,
  ludoRateThreePlayers: 15,
  ludoHostSharePercent: 30,
  ludoForfeitOnePlayer: 25,
  ludoForfeitTwoPlayers: 15,
  ludoForfeitThreePlayers: 10,
  ludoWinnerPrize: 20,
  ludoHostMaxLeaves: 3,
  ludoHostMaxMissedTurns: 3,
  ludoEmptyCloseMinutes: 5,
  ludoWatchAppPerMinute: 6,
  ludoWatchHostPerMinute: 4,
  ludoWatchAppStepSeconds: 5,
  ludoWatchHostStepSeconds: 15,
};

/**
 * Fetches the current global settings once. Clients read /settings directly;
 * writes are server-only (see updateGlobalSettings).
 */
export const getGlobalSettings = async (): Promise<GlobalSettings> => {
  try {
    const snap = await getDoc(doc(db, 'settings', SETTINGS_DOC_ID));
    if (snap.exists()) {
      return { ...DEFAULT_SETTINGS, ...(snap.data() as GlobalSettings) };
    }
  } catch (e) {
    console.warn('Could not read global settings, using defaults:', e);
  }
  return DEFAULT_SETTINGS;
};

/**
 * Whether the signed-in user is on the backend's administrator allowlist. The
 * client cannot assert this itself.
 */
export const checkIsAdmin = async (): Promise<boolean> => {
  try {
    const { isAdmin } = await authedGet<{ isAdmin: boolean }>('/api/v1/admin/is-admin');
    return isAdmin;
  } catch {
    return false;
  }
};

export const getAdminSettings = async (): Promise<GlobalSettings> => {
  const { settings } = await authedGet<{ settings: GlobalSettings }>('/api/v1/admin/settings');
  return { ...DEFAULT_SETTINGS, ...settings };
};

/**
 * Subscribes to the global settings in real-time.
 */
export const subscribeToGlobalSettings = (callback: (settings: GlobalSettings) => void) => {
  const settingsRef = doc(db, 'settings', SETTINGS_DOC_ID);
  return onSnapshot(settingsRef, (snap) => {
    if (snap.exists()) {
      callback({ ...DEFAULT_SETTINGS, ...(snap.data() as GlobalSettings) });
    } else {
      callback(DEFAULT_SETTINGS);
    }
  }, (error) => {
    console.warn('Error subscribing to global settings:', error);
    callback(DEFAULT_SETTINGS);
  });
};

/**
 * Updates the global settings through the backend, which enforces the admin
 * allowlist and validates each value. Firestore rules deny all client writes to
 * /settings, so this cannot be done from the app directly.
 */
export const updateGlobalSettings = async (newSettings: Partial<GlobalSettings>) => {
  await authedPost('/api/v1/admin/settings', { settings: newSettings });
};
