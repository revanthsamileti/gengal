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
  // Offers (0 switches one off). Mirrors DEFAULT_SETTINGS in backend/app.py.
  /** A lower price for the same coins on every pack, 0-50%. */
  coinDiscountPercent: number;
  /** One pack per account that has never recharged. */
  firstBuyPriceInr: number;
  firstBuyCoins: number;
  /** Claimable once a day after this many paid voice minutes. */
  dailyBonusCoins: number;
  dailyBonusMinVoiceMinutes: number;
  /** Daily host bonus: who qualifies, how many win, and the pool's share of the day's call revenue. */
  hostBonusMinMinutes: number;
  hostBonusTopCount: number;
  hostBonusPoolPercent: number;
}

const SETTINGS_DOC_ID = 'pricing';

export const DEFAULT_SETTINGS: GlobalSettings = {
  voiceCallRatePerMin: 10,
  videoCallRatePerMin: 50,
  creatorSharePercentage: 70,
  femaleExpertHeartsThreshold: 50,
  maleExpertRespectThreshold: 30,
  callDurationForHeart: 3,
  heartToInrRate: 3,
  minRechargeAmount: 49,
  inrToCoinRechargeRate: 1.25,
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
  coinDiscountPercent: 0,
  firstBuyPriceInr: 6,
  firstBuyCoins: 60,
  dailyBonusCoins: 30,
  dailyBonusMinVoiceMinutes: 5,
  hostBonusMinMinutes: 30,
  hostBonusTopCount: 10,
  hostBonusPoolPercent: 8,
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
export interface HostBonusWinner {
  rank: number;
  uid: string;
  nickname: string;
  minutes: number;
  inr: number;
  hearts: number;
}

export interface HostBonusPlan {
  day: string;
  paid: boolean;
  revenueInr: number;
  poolInr: number;
  poolPercent: number;
  fixedAmount: boolean;
  winners: HostBonusWinner[];
}

/**
 * One day's host bonus (India time, YYYY-MM-DD; the server defaults to
 * yesterday). `amountInr` replaces the percentage pool with a set amount.
 * `pay` credits the winners' hearts, once per day, and only for a day that is over.
 */
export const hostBonus = (action: 'preview' | 'pay', day?: string, amountInr?: number) =>
  authedPost<HostBonusPlan>('/api/v1/admin/host-bonus', {
    action,
    ...(day ? { day } : {}),
    ...(amountInr !== undefined ? { amountInr } : {}),
  });

export interface ReportGroup {
  targetUid: string;
  nickname: string;
  banned: boolean;
  count: number;
  reasons: Record<string, number>;
  latestAt: string | null;
  reports: { id: string; reason: string; source: string; reporter: string; createdAt: string | null }[];
}

export interface BannedAccount {
  uid: string;
  nickname: string;
  reason: string;
  bannedAt: string | null;
}

/** Open reports, grouped by the person reported, most-reported first; plus who is banned. */
export const getReports = () =>
  authedPost<{ groups: ReportGroup[]; banned: BannedAccount[] }>('/api/v1/admin/reports', { action: 'list' });

/** Close one person's open reports without banning them. */
export const dismissReports = (targetUid: string) =>
  authedPost<{ closed: number }>('/api/v1/admin/reports', { action: 'dismiss', targetUid });

/**
 * Ban: signs them out, blocks sign-in, hides them from every list and closes
 * their reports. `banned: false` lifts it.
 */
export const setBanned = (uid: string, banned: boolean, reason = '') =>
  authedPost<{ banned: boolean; signInUpdated: boolean; reportsClosed: number }>(
    '/api/v1/admin/ban', { uid, banned, reason },
  );

export interface Coupon {
  code: string;
  coins: number;
  /** 0 = unlimited. */
  maxUses: number;
  uses: number;
  active: boolean;
  expiresAt: string | null;
  createdAt: string | null;
}

export const listCoupons = () =>
  authedPost<{ coupons: Coupon[] }>('/api/v1/admin/coupons', { action: 'list' });

/** Blank code: the server makes one up. maxUses 0 = unlimited; days 0 = no end date. */
export const createCoupon = (c: { code?: string; coins: number; maxUses: number; days: number }) =>
  authedPost<{ code: string }>('/api/v1/admin/coupons', { action: 'create', ...c });

export const setCouponActive = (code: string, active: boolean) =>
  authedPost('/api/v1/admin/coupons', { action: active ? 'enable' : 'disable', code });

export const updateGlobalSettings = async (newSettings: Partial<GlobalSettings>) => {
  await authedPost('/api/v1/admin/settings', { settings: newSettings });
};
