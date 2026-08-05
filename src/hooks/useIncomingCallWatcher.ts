import { useEffect, useRef } from 'react';
import type { User } from 'firebase/auth';
import { subscribeToIncomingCalls, IncomingCall } from '../services/liveRoomService';
import { registerForPushNotificationsAsync } from '../services/notificationService';

/**
 * Watches for inbound call offers for the signed-in user and hands them to the
 * navigator. Without this the caller's offer document was written but never
 * observed, so no call could ever be answered.
 */
export function useIncomingCallWatcher(
  user: User | null,
  onIncomingCall: (call: IncomingCall) => void
) {
  // Keep the callback in a ref so a re-render never tears down the listener.
  const handlerRef = useRef(onIncomingCall);
  handlerRef.current = onIncomingCall;

  // Tracks the offer already handed off, so a status/heartbeat write on the same
  // document does not re-trigger navigation.
  const handledRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user) {
      handledRef.current = null;
      return;
    }

    registerForPushNotificationsAsync(user.uid).catch((e) =>
      console.warn('[IncomingCalls] Push registration failed:', e)
    );

    const unsubscribe = subscribeToIncomingCalls(user.uid, (call) => {
      if (!call) {
        handledRef.current = null;
        return;
      }
      const key = `${call.callerUid}:${call.roomId}`;
      if (handledRef.current === key) return;
      handledRef.current = key;
      handlerRef.current(call);
    });

    return unsubscribe;
  }, [user?.uid]);
}
