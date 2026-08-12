import { useEffect, useRef } from 'react';
import type { User } from 'firebase/auth';
import { subscribeToIncomingCalls, IncomingCall } from '../services/liveRoomService';
import {
  registerForPushNotificationsAsync,
  dismissCallNotification,
  subscribeToTokenRefresh,
  addNotificationResponseListener,
  getInitialNotificationResponse,
} from '../services/notificationService';

/**
 * How old a notification response can be before we ignore it.
 *
 * The Firestore offer expires in 60 s from first-seen (OFFER_EXPIRY_MS in
 * liveRoomService). We add a generous buffer because:
 *   1. The device may have been offline when the push arrived and delivered it
 *      later.
 *   2. getLastNotificationResponseAsync() does NOT auto-clear, so a response
 *      from a long-ago launch would be returned every time the app starts until
 *      a newer notification response overwrites it. We discard anything older
 *      than this threshold rather than blindly navigating to a stale call.
 *
 * 90 s covers normal delivery delays; anything older is certainly dead.
 */
const MAX_NOTIFICATION_AGE_MS = 90_000;

/**
 * Watches for inbound call offers for the signed-in user and hands them to the
 * navigator. Without this the caller's offer document was written but never
 * observed, so no call could ever be answered.
 *
 * DELIVERY WHEN BACKGROUNDED OR KILLED
 * ─────────────────────────────────────
 * A Firestore onSnapshot listener is frozen when the JS runtime is suspended
 * (app backgrounded or killed). It cannot wake the device on its own. The
 * actual wakeup mechanism is the FCM push notification sent by the backend's
 * /api/v1/calls/notify endpoint. When the push arrives:
 *
 *   • App is KILLED: Android shows the notification. The user taps it, the
 *     app restarts. `getInitialNotificationResponse()` returns the response
 *     and we synthesise an IncomingCall from its data payload. Auth resolves,
 *     the Firestore listener also fires (if the offer is still live), but the
 *     handledRef dedup means only one navigation happens.
 *
 *   • App is BACKGROUNDED (JS frozen): Android shows the notification as a
 *     heads-up banner. The user taps it, the app comes to foreground. The JS
 *     runtime resumes and the Firestore listener re-connects — but there is a
 *     brief window before the first snapshot fires. `addNotificationResponseListener`
 *     covers that window by routing the tap immediately.
 *
 *   • App is FOREGROUNDED: The Firestore listener is live, so the push is
 *     redundant. The response listener fires anyway but the handledRef dedup
 *     means it is a no-op.
 *
 * GHOST NOTIFICATION DISMISSAL
 * ─────────────────────────────
 * When the Firestore offer becomes null (caller cancelled, call answered, or
 * offer expired) this hook dismisses all notifications. Without this, the
 * heads-up banner sits in the tray indefinitely and retapping it opens the
 * app to a screen that finds no offer and immediately goes back — confusing.
 */
export function useIncomingCallWatcher(
  user: User | null,
  onIncomingCall: (call: IncomingCall) => void
) {
  // Keep the callback in a ref so a re-render never tears down the listener.
  const handlerRef = useRef(onIncomingCall);
  handlerRef.current = onIncomingCall;

  // Tracks the offer already handed off, so a status/heartbeat write on the same
  // document, OR a duplicate notification response for the same call, does not
  // re-trigger navigation.
  const handledRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user) {
      handledRef.current = null;
      return;
    }

    // Register / refresh push token on login.
    registerForPushNotificationsAsync(user.uid).catch((e) =>
      console.warn('[IncomingCalls] Push registration failed:', e)
    );

    // Keep the stored token current if the FCM/APNs service rotates it. Stale
    // tokens cause push delivery to silently fail — calls go undelivered when
    // the app is backgrounded, which is the exact scenario where the push is
    // the ONLY delivery mechanism.
    const unsubTokenRefresh = subscribeToTokenRefresh(user.uid);

    /**
     * Central handler for a new incoming call, whether it arrives via the
     * Firestore listener or a notification tap response. The handledRef dedup
     * key `callerUid:roomId` ensures exactly one navigation per offer even when
     * both paths fire simultaneously (e.g., notification tap resumes foreground
     * app at the same instant the Firestore snapshot re-delivers).
     */
    const handleCall = (call: IncomingCall | null) => {
      if (!call) {
        handledRef.current = null;
        // The offer vanished (caller cancelled, timed out, or was answered).
        // Dismiss any notification in the tray so it doesn't linger as a ghost.
        dismissCallNotification().catch(() => {});
        return;
      }
      const key = `${call.callerUid}:${call.roomId}`;
      if (handledRef.current === key) return;
      handledRef.current = key;
      handlerRef.current(call);
    };

    // PRIMARY DELIVERY: live Firestore listener (works when app is foregrounded).
    const unsubFirestore = subscribeToIncomingCalls(user.uid, handleCall);

    /**
     * Builds a synthetic IncomingCall from the notification data payload, for
     * when the app was not foregrounded when the offer arrived. The backend
     * serialises the caller fields into `data` alongside roomId and mode, so
     * we can construct a complete IncomingCall without a round-trip.
     */
    const callFromNotificationData = (data: any): IncomingCall | null => {
      if (!data?.roomId || !data?.callerUid) return null;
      return {
        callerUid: String(data.callerUid),
        callerName: data.callerName || 'Someone',
        callerAvatarUrl: data.callerAvatarUrl ?? null,
        callerAvatarData: data.callerAvatarData ?? null,
        roomId: String(data.roomId),
        mode: data.mode === 'video' ? 'video' : 'call',
        status: 'calling',
        timestamp: null,
      };
    };

    // BACKGROUND DELIVERY: fired when the user taps the notification while the
    // app is backgrounded (JS was frozen) and comes to foreground as a result.
    // The Firestore listener will re-connect and fire shortly after, but this
    // fires immediately so the user isn't stranded on the home screen while
    // waiting for the network round-trip.
    const unsubNotifResponse = addNotificationResponseListener((response: any) => {
      const data = response?.notification?.request?.content?.data;
      const notifDate: number = response?.notification?.date ?? 0;
      // Discard stale responses. getLastNotificationResponseAsync is not
      // auto-cleared; without this check a user who opens the app an hour after
      // missing a call would be routed to a long-dead offer.
      if (Date.now() - notifDate > MAX_NOTIFICATION_AGE_MS) {
        console.log('[IncomingCalls] Notification response is too old; ignoring.');
        return;
      }
      const call = callFromNotificationData(data);
      if (call) handleCall(call);
    });

    // KILLED-APP DELIVERY: the response that caused the app to open is not
    // delivered via the listener above; it must be read once from
    // getLastNotificationResponseAsync. We check it after registering the
    // Firestore listener so that if BOTH fire for the same call, the
    // handledRef dedup prevents double navigation.
    getInitialNotificationResponse().then((response: any) => {
      if (!response) return;
      const data = response?.notification?.request?.content?.data;
      const notifDate: number = response?.notification?.date ?? 0;
      if (Date.now() - notifDate > MAX_NOTIFICATION_AGE_MS) {
        console.log('[IncomingCalls] Initial notification response is too old; ignoring.');
        return;
      }
      const call = callFromNotificationData(data);
      if (call) handleCall(call);
    });

    return () => {
      unsubFirestore();
      unsubNotifResponse();
      unsubTokenRefresh();
    };
  }, [user?.uid]);
}
