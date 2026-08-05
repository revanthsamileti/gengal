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
      await Notifications.setNotificationChannelAsync('calls', {
        name: 'Incoming calls',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
        sound: 'default',
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
