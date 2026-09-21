import { useSyncExternalStore } from 'react';
import { addDoc, arrayRemove, arrayUnion, collection, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../config/firebase';

/**
 * Block and report.
 *
 * The block list lives in /user_private/{uid}.blockedUids, which only its owner
 * can read, so a blocked person is never told they were blocked. Enforcement is
 * on the blocker's device: blocked people are filtered out of every user
 * listing, their calls are declined without ringing, and their chats are
 * hidden. Reports are write-only for clients and reviewed from the console.
 */

let blocked: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

const publish = (next: ReadonlySet<string>) => {
  blocked = next;
  listeners.forEach((fn) => fn());
};

export const isBlocked = (uid?: string | null): boolean => Boolean(uid) && blocked.has(uid as string);

export const onBlockListChange = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/** Mirrors the signed-in user's block list into memory. Call once per sign-in. */
export const startBlockListSync = (uid: string) => {
  const unsub = onSnapshot(
    doc(db, 'user_private', uid),
    (snap) => {
      const list = snap.data()?.blockedUids;
      publish(new Set(Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string') : []));
    },
    (error) => console.warn('[safetyService] Block list listener stopped:', error),
  );
  return () => {
    unsub();
    publish(new Set());
  };
};

export const useBlockedUids = (): ReadonlySet<string> =>
  useSyncExternalStore(onBlockListChange, () => blocked, () => blocked);

export const blockUser = async (myUid: string, targetUid: string) => {
  // Optimistic, so lists drop the person immediately; the snapshot confirms it.
  publish(new Set([...blocked, targetUid]));
  await setDoc(doc(db, 'user_private', myUid), { blockedUids: arrayUnion(targetUid) }, { merge: true });
};

export const unblockUser = async (myUid: string, targetUid: string) => {
  const next = new Set(blocked);
  next.delete(targetUid);
  publish(next);
  await setDoc(doc(db, 'user_private', myUid), { blockedUids: arrayRemove(targetUid) }, { merge: true });
};

export const REPORT_REASONS = [
  'Fake profile',
  'Harassment or abuse',
  'Sexual or explicit content',
  'Asking for money',
  'Underage',
  'Something else',
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

export const reportUser = async (
  reporterUid: string,
  targetUid: string,
  reason: ReportReason,
  source: 'profile' | 'chat' | 'call',
) => {
  await addDoc(collection(db, 'reports'), {
    reporterUid,
    targetUid,
    reason,
    source,
    status: 'open',
    createdAt: serverTimestamp(),
  });
};
