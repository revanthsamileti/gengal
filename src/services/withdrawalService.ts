import { auth, db } from '../config/firebase';
import { addDoc, collection, onSnapshot, orderBy, query, serverTimestamp, where } from 'firebase/firestore';

export type WithdrawalRequest = {
  id: string;
  uid: string;
  hearts: number;
  amountInr: number;
  status: 'pending' | 'approved' | 'rejected' | 'paid';
  createdAt: any;
};

/**
 * Records a withdrawal request for manual review.
 *
 * There is no payout endpoint yet, so this is deliberately a request record
 * rather than a transfer: the screen must never claim money is on its way
 * without something durable existing on the server.
 */
export async function requestWithdrawal(hearts: number, amountInr: number): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('You must be logged in to withdraw.');
  if (!(hearts > 0) || !(amountInr > 0)) throw new Error('Nothing to withdraw yet.');

  await addDoc(collection(db, 'withdrawalRequests'), {
    uid: user.uid,
    hearts,
    amountInr,
    status: 'pending',
    createdAt: serverTimestamp(),
  });
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
    () => callback([])
  );
}
