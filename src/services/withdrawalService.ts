import { auth, db } from '../config/firebase';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { authedPost } from './authService';

export type WithdrawalRequest = {
  id: string;
  uid: string;
  hearts: number;
  amountInr: number;
  status: 'pending' | 'approved' | 'rejected' | 'paid';
  createdAt: any;
};

/**
 * Opens a payout request.
 *
 * This used to `addDoc` straight into /withdrawalRequests with a hearts figure
 * and a rupee amount the client had worked out for itself. Firestore checked
 * only that both were numbers above zero, so the amount a user asked to be paid
 * was, in the end, whatever their device claimed it was — and nothing stopped a
 * second request being opened next to the first, or the same hearts being paid
 * out more than once.
 *
 * The server now owns all of it: it reads the real balance in a transaction,
 * prices the payout from `heartToInrRate`, and deducts the hearts as it records
 * the claim. Deliberately takes no arguments — there is nothing left for the
 * caller to state that the server would be willing to believe.
 */
export async function requestWithdrawal(): Promise<{ hearts: number; amountInr: number }> {
  const user = auth.currentUser;
  if (!user) throw new Error('You must be logged in to withdraw.');

  const { hearts, amountInr } = await authedPost<{ hearts: number; amountInr: number }>(
    '/api/v1/withdrawals/request',
    {},
  );
  return { hearts, amountInr };
}

/** Streams the signed-in user's own withdrawal requests, newest first. */
export function subscribeToMyWithdrawals(
  callback: (requests: WithdrawalRequest[]) => void
): () => void {
  const user = auth.currentUser;
  if (!user) return () => {};

  const q = query(
    collection(db, 'withdrawalRequests'),
    where('uid', '==', user.uid),
    orderBy('createdAt', 'desc')
  );

  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as WithdrawalRequest))),
    // Without a named error callback the SDK logs nothing and the listener
    // tears down silently, leaving the earnings screen stuck on whatever it
    // last displayed. Log the cause so it shows up in crash reports.
    (error) => {
      console.warn('[withdrawalService] Withdrawal request listener failed:', error?.message ?? error);
      callback([]);
    }
  );
}
