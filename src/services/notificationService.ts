import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { savePrivateUserData, setPushReachable } from './userService';

/**
 * The conversation on screen right now, so a message notification for it is
 * not also shown as a banner on top of the very chat it is about.
 */
let openChatId: string | null = null;
export const setOpenChat = (chatId: string | null) => {
  openChatId = chatId;
};

// expo-notifications is loaded lazily and defensively: it is unavailable in Expo
// Go and on web. The previous NativeModules probe never resolved under the new
// architecture, so registration silently no-opped in every build.
let Notifications: any = null;
try {
  Notifications = require('expo-notifications');
  Notifications.setNotificationHandler({
    handleNotification: async (notification: any) => {
      const data = notification?.request?.content?.data;
      const aboutOpenChat = data?.type === 'message' && !!data?.chatId && data.chatId === openChatId;
      return {
        shouldShowBanner: !aboutOpenChat,
        shouldShowList: !aboutOpenChat,
        shouldPlaySound: !aboutOpenChat,
        shouldSetBadge: false,
      };
    },
  });
} catch (e) {
  console.warn('[NotificationService] expo-notifications is not available in this build:', e);
}

/**
 * Android notification channel for incoming calls. Bump the suffix whenever the
 * channel's behaviour needs to change: Android freezes everything except a
 * channel's name and description once it has been created, so an existing
 * install can only be given new settings under a new id. Must stay in step with
 * CALL_CHANNEL in backend/push.py.
 */
export const CALL_CHANNEL_ID = 'calls_v2';

/**
 * The call channel that rings with the app's own ringtone rather than a single
 * notification blip. Android takes an incoming call's sound from its channel
 * and freezes a channel's settings once created, so a ringing channel can only
 * ever be a new one — hence the version suffix.
 *
 * v3 is burnt. It was created by a JS-only update, before any build carried
 * `ringtone.wav`, and expo-notifications' SoundResolver silently substitutes
 * the system default when a raw resource is missing. Those installs froze the
 * channel with the default sound and can never be repaired — so v3 would still
 * be silent of the ringtone even now that the file ships. `ensureRingingChannel`
 * below is what stops v4 going the same way.
 *
 * Which channel the backend may post to is recorded per device in
 * user_private.callChannelId: posting to a channel a phone lacks shows nothing.
 */
export const RINGING_CALL_CHANNEL_ID = 'calls_v4';

/** Bundled natively by the expo-notifications plugin; see app.json. */
const RINGTONE_FILE = 'ringtone_long.ogg';
/** Android drops the extension: the channel's sound URI ends in /raw/<this>. */
const RINGTONE_RESOURCE = 'ringtone_long';
/** Poisoned as described above; deleted so it stops cluttering system settings. */
const RETIRED_CALL_CHANNEL_ID = 'calls_v3';

/**
 * Vibrates for the length of the ring rather than the single burst a
 * notification gets. The first entry is the delay before the first buzz.
 */
const RING_VIBRATION: number[] = [0];
for (let i = 0; i < 22; i++) RING_VIBRATION.push(1000, 1000);

/**
 * The Answer / Decline buttons on an incoming-call notification.
 *
 * Android shows them only when the notification names this category, so the
 * backend puts `categoryId` in the call payload (see push.py). The ids come
 * back on the notification response as `actionIdentifier`.
 */
export const CALL_CATEGORY_ID = 'incoming_call';
export const CALL_ACTION_ANSWER = 'answer';
export const CALL_ACTION_DECLINE = 'decline';

/** Chat messages. Must stay in step with MESSAGE_CHANNEL in backend/push.py. */
export const MESSAGE_CHANNEL_ID = 'messages';

/**
 * Creates the ringing channel and proves it actually rings.
 *
 * A channel whose sound file is missing is not rejected — expo-notifications
 * logs a warning and Android stores the system default instead, permanently,
 * because channel settings freeze on creation. That is exactly how `calls_v3`
 * was lost. So the channel is read back and its sound inspected; if this build
 * does not carry the ringtone, the channel is deleted again and the phone
 * reports the plain call channel, leaving the id clean for a build that does.
 *
 * Returns the channel id the backend should actually post calls to.
 */
async function ensureRingingChannel(): Promise<string> {
  try {
    await Notifications.setNotificationChannelAsync(RINGING_CALL_CHANNEL_ID, {
      name: 'Incoming calls (ringing)',
      importance: Notifications.AndroidImportance.MAX,
      // Names the bundled res/raw resource, not a system sound.
      sound: RINGTONE_FILE,
      vibrationPattern: RING_VIBRATION,
      // So the caller's name is readable on a locked phone.
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      lightColor: '#FF231F7C',
    });

    const channel = await Notifications.getNotificationChannelAsync(RINGING_CALL_CHANNEL_ID);
    const sound = typeof channel?.sound === 'string' ? channel.sound : '';
    if (sound.includes(RINGTONE_RESOURCE)) {
      await Notifications.deleteNotificationChannelAsync?.(RETIRED_CALL_CHANNEL_ID);
      return RINGING_CALL_CHANNEL_ID;
    }

    console.warn('[NotificationService] This build has no ringtone; staying on the plain call channel.');
    await Notifications.deleteNotificationChannelAsync?.(RINGING_CALL_CHANNEL_ID);
    return CALL_CHANNEL_ID;
  } catch (e) {
    // Could not verify — reporting a channel that may be silent is worse than
    // reporting the one every build has.
    console.warn('[NotificationService] Ringing channel check failed:', e);
    return CALL_CHANNEL_ID;
  }
}

const getProjectId = () =>
  (Constants.expoConfig as any)?.extra?.eas?.projectId ??
  (Constants as any)?.easConfig?.projectId;

export async function registerForPushNotificationsAsync(userId: string) {
  if (Platform.OS === 'web' || !Notifications) {
    console.log('[NotificationService] Notifications module is not loaded.');
    return null;
  }

  // What the backend may post calls to. Stays the plain channel unless this
  // build proves it can actually ring (ensureRingingChannel).
  let callChannelId = CALL_CHANNEL_ID;

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
      callChannelId = await ensureRingingChannel();
      await Notifications.setNotificationChannelAsync(MESSAGE_CHANNEL_ID, {
        name: 'Messages',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 200],
        lightColor: '#FF7A256D',
      });
    }

    // Declined from the tray without opening the app; answering has to open it,
    // because a call cannot be held anywhere else.
    await Notifications.setNotificationCategoryAsync(CALL_CATEGORY_ID, [
      {
        identifier: CALL_ACTION_ANSWER,
        buttonTitle: 'Answer',
        options: { opensAppToForeground: true },
      },
      {
        identifier: CALL_ACTION_DECLINE,
        buttonTitle: 'Decline',
        options: { opensAppToForeground: false, isDestructive: true },
      },
    ]);

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

    // The Firebase token is what the backend sends calls and messages to
    // (backend/push.py). It needs google-services.json in the native build;
    // without it this throws "Default FirebaseApp is not initialized", which is
    // how every call notification went missing before.
    //
    // Push tokens are private: they live in /user_private, and the backend
    // reads them with the Admin SDK.
    const device = await Notifications.getDevicePushTokenAsync();
    const fcmToken = Platform.OS === 'android' && typeof device?.data === 'string' ? device.data : null;
    if (fcmToken) {
      // callChannelId travels with the token: it says which call channel this
      // install actually has *and can ring on*, so the backend never posts to a
      // missing or silent one. Firestore rejects undefined, and this branch is
      // Android-only anyway.
      await savePrivateUserData(userId, { fcmToken, callChannelId });
      await setPushReachable(userId, true);
    }

    // Expo's token too, as the backend's fallback transport. Its failure must
    // not undo the Firebase registration above, so it is tried on its own.
    const projectId = getProjectId();
    if (projectId) {
      try {
        const expoToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
        await savePrivateUserData(userId, { expoPushToken: expoToken });
      } catch (e) {
        console.warn('[NotificationService] Expo push token unavailable:', e);
      }
    }

    return fcmToken;
  } catch (error) {
    console.warn('[NotificationService] Error setting up push notifications:', error);
    return null;
  }
}

/**
 * Dismisses presented notifications that `matches` picks out.
 *
 * Targeted rather than dismissAllNotificationsAsync: ending a call used to
 * wipe the whole tray, which now also holds message notifications the user
 * has not read yet.
 */
async function dismissWhere(matches: (data: any) => boolean): Promise<void> {
  if (!Notifications?.getPresentedNotificationsAsync || !Notifications?.dismissNotificationAsync) return;
  try {
    const presented: any[] = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(
      presented
        .filter((n) => matches(n?.request?.content?.data))
        .map((n) => Notifications.dismissNotificationAsync(n.request.identifier)),
    );
  } catch (e) {
    // Not fatal — the notification may have already auto-dismissed.
    console.warn('[NotificationService] Dismissing notifications failed:', e);
  }
}

/**
 * Removes incoming-call notifications from the tray.
 *
 * Called whenever a call ends for any reason — accept, decline, timeout, cancel,
 * or error. Without this the OS leaves a ringing heads-up notification in the
 * tray even after the call is over (the "ghost ring" bug), which confused users
 * into thinking they still had an incoming call and re-tapped it to find an
 * empty screen. Every call notification carries a roomId, so all of them are
 * cleared, including one left from an earlier missed call.
 */
export function dismissCallNotification(): Promise<void> {
  return dismissWhere((data) => data?.type === 'call' || !!data?.roomId);
}

/** Clears a conversation's notification once its chat is open. */
export function dismissChatNotifications(chatId: string): Promise<void> {
  return dismissWhere((data) => data?.type === 'message' && data?.chatId === chatId);
}

/**
 * Keeps the stored Firebase token current when FCM rotates it (reinstall,
 * restore, or FCM's own periodic refresh). Pushes to the old token fail, and
 * the backend then forgets it, so a missed rotation leaves the phone
 * unreachable outside the app.
 *
 * The listener is handed the new device token itself, so nothing here fetches
 * a token. That matters: fetching one (device or Expo) re-emits this event,
 * and an earlier version that did so looped dozens of times a second on a real
 * handset, saturating the JS thread and blanking the screen.
 *
 * Returns a cleanup function that removes the listener.
 */
export function subscribeToTokenRefresh(userId: string): () => void {
  if (!Notifications?.addPushTokenListener) return () => {};

  let lastStoredToken: string | null = null;

  const subscription = Notifications.addPushTokenListener(async (deviceToken: any) => {
    const token = Platform.OS === 'android' && typeof deviceToken?.data === 'string' ? deviceToken.data : null;
    if (!token || token === lastStoredToken) return;
    try {
      await savePrivateUserData(userId, { fcmToken: token });
      // Recorded only once the write has actually landed. Setting it before the
      // await made a failed write look like a completed one: every later event
      // for the same token then returned early, and the phone stayed
      // unreachable, silently and permanently, from one transient failure.
      lastStoredToken = token;
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

/**
 * Forgets the response getInitialNotificationResponse returns.
 *
 * It is not cleared on its own, so without this a message notification that
 * once opened the app would reopen that chat on every later launch.
 */
export async function clearInitialNotificationResponse(): Promise<void> {
  if (!Notifications?.clearLastNotificationResponseAsync) return;
  try {
    await Notifications.clearLastNotificationResponseAsync();
  } catch (e) {
    console.warn('[NotificationService] clearLastNotificationResponseAsync failed:', e);
  }
}
