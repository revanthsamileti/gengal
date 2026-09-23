import { auth } from '../config/firebase';
import { getBackendUrl } from './authService';

const authedPost = async <T>(path: string, body: Record<string, unknown>): Promise<T> => {
  const user = auth.currentUser;
  if (!user) throw new Error('You must be logged in.');

  const token = await user.getIdToken();
  const response = await fetch(`${getBackendUrl()}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    // The server's machine-readable `code` is carried onto the Error so callers
    // can tell "payments aren't set up" from a genuine failure. Without this it
    // was dropped here and every caller's code check was dead.
    const error: Error & { code?: string; status?: number } = new Error(
      data.error || 'Coin operation failed.',
    );
    error.code = data.code;
    error.status = response.status;
    throw error;
  }
  return data as T;
};

export const deductUserCoins = async (userId: string, amount: number) => {
  const data = await authedPost<{ newBalance: number }>('/api/v1/coins/deduct', { userId, amount });
  return data.newBalance;
};

export const deductUserCoinsWithCommission = async (
  userId: string,
  amount: number,
  hostUid: string,
  commissionAmount: number,
) => {
  const data = await authedPost<{ newBalance: number; hostNewBalance?: number }>('/api/v1/coins/deduct-with-commission', {
    userId,
    amount,
    hostUid,
    commissionAmount,
  });
  return data;
};

export const creditUserCoins = async (_userId: string, _amount: number) => {
  throw new Error('Direct client coin credits are disabled. Use a server-authorized purchase or game reward endpoint.');
};

export type CoinOrder = {
  ok: boolean;
  orderId: string;
  amountInr: number;
  coins: number;
  checkoutUrl: string;
};

/**
 * Opens a top-up order and returns the page to run checkout in.
 *
 * The coin yield is decided and frozen server-side here, so the number quoted
 * on the store screen is the number credited even if an admin changes the rate
 * while checkout is open.
 */
export const createCoinOrder = async (packageId: string, amountInr: number) => {
  return authedPost<CoinOrder>('/api/v1/coins/order', { packageId, amountInr });
};

export type RazorpayResult = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

/**
 * Confirms a completed checkout. The client sends only the ids Razorpay handed
 * back — no amount and no coin count — and the server credits the balance only
 * after checking the signature and confirming with Razorpay that the payment
 * was captured. Until a provider is configured this rejects with
 * `payments_not_configured` rather than granting free coins.
 */
export const purchaseCoins = async (result: RazorpayResult) => {
  return authedPost<{ ok: boolean; newBalance: number; coinsCredited: number }>(
    '/api/v1/coins/purchase',
    result,
  );
};

export const transferCoins = async (senderId: string, receiverId: string, amount: number) => {
  return authedPost<{
    success: boolean;
    senderNewBalance: number;
    receiverNewBalance: number;
  }>('/api/v1/coins/transfer', { senderId, receiverId, amount });
};

/**
 * Advances billing for an in-progress call. The server derives the elapsed time
 * and rate itself — the client only says which call to bill, so it can neither
 * understate nor inflate the charge. Either participant may tick, and the
 * result is the same, which is what stops a patched payer client from calling
 * for free by simply never billing itself.
 */
export const processCallBilling = async (roomId: string) => {
  return authedPost<{
    success: boolean;
    hasInsufficientFunds: boolean;
    billedAmount: number;
    billedSeconds: number;
    payerNewBalance: number | null;
    receiverNewBalance: number | null;
  }>('/api/v1/coins/call-billing', { roomId });
};

export const updateCallRewards = async (
  userId: string,
  secondsToAdd: number,
  thresholdMinutes: number,
  roomId: string,
  isReceiver: boolean = false,
) => {
  return authedPost<{ ok: boolean; creditedSeconds?: number }>('/api/v1/coins/call-rewards', {
    userId,
    secondsToAdd,
    thresholdMinutes,
    isReceiver,
    roomId,
  });
};
