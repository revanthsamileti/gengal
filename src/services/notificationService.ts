import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { savePrivateUserData } from './userService';

// expo-notifications is loaded lazily and defensively: it is unavailable in Expo
// Go and on web. The previous NativeModules probe never resolved under the new
// architecture, so registration silently no-opped in every build.
let Notifications: any = null;
try {
  Notifications = require('expo-notifications');
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
} catch (e) {
  console.warn('[NotificationService] expo-notifications is not available in this build:', e);
}

/**
 * Android notification channel for incoming calls. Bump the suffix whenever the
 * channel's behaviour needs to change: Android freezes everything except a
 * channel's name and description once it has been created, so an existing
 * install can only be given new settings under a new id. Must stay in step with
 * `channelId` in the backend's /api/v1/calls/notify payload.
 */
export const CALL_CHANNEL_ID = 'calls_v2';

const getProjectId = () =>
  (Constants.expoConfig as any)?.extra?.eas?.projectId ??
  (Constants as any)?.easConfig?.projectId;

export async function registerForPushNotificationsAsync(userId: string) {
  if (Platform.OS === 'web' || !Notifications) {
    console.log('[NotificationService] Notifications module is not loaded.');
    return null;
  }

  try {
    // The Android channel must exist before a high-priority call notification
    // can be delivered with sound, so create it first.
    if (Platform.OS === 'android') {
      // `sound` here names a *custom* sound file that must be bundled into the
      // native app; it is not a way to ask for the system default. Passing
      // 'default' made expo-notifications log
      //   "Custom sound 'default' not found in native app"
      // and create the channel with no sound at all, which is why an incoming
      // call arrived in the notification bar in silence. Omitting the key
      // gives the channel the system default notification sound.
      //
      // The id is versioned because Android only lets you change a channel's
      // name and description after creation — the silent 'calls' channel on
      // existing installs can never be repaired, only replaced.
      await Notifications.setNotificationChannelAsync(CALL_CHANNEL_ID, {
        name: 'Incoming calls',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
      });
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('[NotificationService] Push notification permissions denied.');
      return null;
    }

    const projectId = getProjectId();
    if (!projectId) {
      console.warn('[NotificationService] No EAS projectId in app config; cannot mint a push token.');
      return null;
    }

    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;

    // Push tokens are private: they live in /user_private, and the backend reads
    // them with the Admin SDK when delivering a call notification.
    await savePrivateUserData(userId, { expoPushToken: token });

    return token;
  } catch (error) {
    console.warn('[NotificationService] Error setting up push notifications:', error);
    return null;
  }
}

/**
 * Removes all notifications from the tray/Notification Center.
 *
 * Called whenever a call ends for any reason — accept, decline, timeout, cancel,
 * or error. Without this the OS leaves a ringing heads-up notification in the
 * tray even after the call is over (the "ghost ring" bug), which confused users
 * into thinking they still had an incoming call and re-tapped it to find an
 * empty screen.
 *
 * `dismissAllNotificationsAsync` is intentional over
 * `dismissNotificationAsync(id)`: the push notification id is ephemeral and
 * not saved anywhere on the client, and a user may have received more than one
 * call notification if a previous call was missed. Clearing the slate entirely
 * is both simpler and more correct.
 */
export async function dismissCallNotification(): Promise<void> {
  if (!Notifications?.dismissAllNotificationsAsync) return;
  try {
    await Notifications.dismissAllNotificationsAsync();
  } catch (e) {
    // Not fatal — the notification may have already auto-dismissed.
    console.warn('[NotificationService] dismissAllNotificationsAsync failed:', e);
  }
}

/**
 * Subscribes to FCM/APNs token rotation events and re-saves the fresh Expo
 * push token to Firestore when one arrives.
 *
 * Expo's push service rolls tokens rarely, but when it does — e.g. after an
 * OS update or an app reinstall — calls sent to the stale token silently fail.
 * This listener catches the rotation and keeps the stored token current.
 *
 * Per the Expo docs: do NOT call getDevicePushTokenAsync() inside this
 * listener, as that triggers a re-emit and causes an infinite loop. Instead,
 * re-mint the Expo push token directly from getExpoPushTokenAsync.
 *
 * Returns a cleanup function that removes the listener.
 */
export function subscribeToTokenRefresh(userId: string): () => void {
  if (!Notifications?.addPushTokenListener) return () => {};

  const subscription = Notifications.addPushTokenListener(async (_deviceToken: any) => {
    // The device token changed; re-derive the Expo push token and persist it.
    // The Expo token is what the backend sends to; getExpoPushTokenAsync wraps
    // the device token in a way the Expo push service can route.
    try {
      const projectId = getProjectId();
      if (!projectId) return;
      const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
      console.log('[NotificationService] Push token rotated; updating stored token.');
      await savePrivateUserData(userId, { expoPushToken: token });
    } catch (e) {
      console.warn('[NotificationService] Failed to update rotated push token:', e);
    }
  });

  return () => {
    try {
      subscription.remove();
    } catch {
      /* already removed */
    }
  };
}

/**
 * Adds a listener that fires whenever the user taps (or acts on) a
 * notification while the app is foregrounded or backgrounded.
 *
 * For the killed-app case, use getLastNotificationResponseAsync() once on
 * startup instead — this listener is not called for the notification that
 * opened a killed app.
 *
 * Returns a cleanup function.
 */
export function addNotificationResponseListener(
  handler: (response: any) => void
): () => void {
  if (!Notifications?.addNotificationResponseReceivedListener) return () => {};

  const subscription = Notifications.addNotificationResponseReceivedListener(handler);
  return () => {
    try {
      subscription.remove();
    } catch {
      /* already removed */
    }
  };
}

/**
 * Returns the notification response that launched the app (i.e., the user
 * tapped a notification while the app was killed), or null if the app was
 * opened normally.
 *
 * Only call this once at startup — after the handler fires it should not be
 * called again, as the last response is not automatically cleared.
 */
export async function getInitialNotificationResponse(): Promise<any> {
  if (!Notifications?.getLastNotificationResponseAsync) return null;
  try {
    return await Notifications.getLastNotificationResponseAsync();
  } catch (e) {
    console.warn('[NotificationService] getLastNotificationResponseAsync failed:', e);
    return null;
  }
}
