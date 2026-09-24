import * as TaskManager from 'expo-task-manager';

/**
 * Declining a call from the tray when GenGal is not running.
 *
 * The Decline button is deliberately set not to open the app — you should be
 * able to turn down a call without being dragged into it. The cost is that when
 * the app has been swiped away there is no JS running to hear the tap, so the
 * button did nothing at all and the caller rang on until the offer expired.
 *
 * This is the missing half: expo-task-manager starts a headless JS context for
 * a notification action when the app is backgrounded or terminated, and that
 * context can do the one thing needed — write the rejection.
 *
 * It is defined in its own module, imported from index.ts, because the task has
 * to be registered in the module scope of something the bundle loads early. The
 * headless context evaluates that entry point and nothing else, so a task
 * defined inside a React component would never exist when it mattered.
 */
export const CALL_ACTION_TASK = 'GENGAL_CALL_ACTION';

/**
 * How long to wait for Firebase to restore the signed-in account.
 *
 * Auth is persisted in AsyncStorage, so a fresh JS context has it on disk but
 * not yet in memory; onAuthStateChanged fires once it has been read. Android
 * allows a notification task only a short while to finish, so this gives up
 * rather than holding the context open until the OS kills it.
 */
const AUTH_RESTORE_TIMEOUT_MS = 8000;

const waitForSignedInUid = async (): Promise<string | null> => {
  const { auth } = await import('../config/firebase');
  const { onAuthStateChanged } = await import('firebase/auth');

  if (auth.currentUser) return auth.currentUser.uid;

  return new Promise<string | null>((resolve) => {
    let settled = false;
    const finish = (uid: string | null) => {
      if (settled) return;
      settled = true;
      resolve(uid);
    };
    const timer = setTimeout(() => finish(null), AUTH_RESTORE_TIMEOUT_MS);
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      clearTimeout(timer);
      unsubscribe();
      finish(user?.uid ?? null);
    });
  });
};

TaskManager.defineTask(CALL_ACTION_TASK, async ({ data, error }: any) => {
  if (error) {
    console.warn('[CallActionTask] Task error:', error);
    return;
  }

  // Only the Decline button is handled here. Answer opens the app, which has
  // the whole call stack; a headless context could not join a call anyway.
  const { CALL_ACTION_DECLINE } = await import('./notificationService');
  if (data?.actionIdentifier !== CALL_ACTION_DECLINE) return;

  const payload = data?.notification?.request?.content?.data;
  const callerUid = payload?.callerUid;
  const roomId = payload?.roomId;
  if (!callerUid || !roomId) return;

  try {
    const uid = await waitForSignedInUid();
    if (!uid) {
      console.warn('[CallActionTask] Declined, but the account had not been restored in time.');
      return;
    }
    const { rejectCallOffer } = await import('./liveRoomService');
    await rejectCallOffer(uid, { callerUid: String(callerUid), roomId: String(roomId) });

    const { dismissCallNotification } = await import('./notificationService');
    await dismissCallNotification();
  } catch (e) {
    console.warn('[CallActionTask] Declining from a closed app failed:', e);
  }
});
