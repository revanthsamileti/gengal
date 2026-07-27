import { Platform, NativeModules } from 'react-native';
import { db } from '../config/firebase';
import { doc, updateDoc } from 'firebase/firestore';

// Safely require expo-notifications to prevent startup crashes if native module is absent
let Notifications: any = null;
try {
  // Only load if the native module is actually registered in this build
  if (NativeModules && (NativeModules.ExpoNotifications || NativeModules.RNExpoNotifications)) {
    Notifications = require('expo-notifications');
    if (Notifications) {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        }),
      });
    }
  } else {
    console.warn('[NotificationService] ExpoNotifications native module not registered in this build, skipping.');
  }
} catch (e) {
  console.warn('[NotificationService] expo-notifications native module not available:', e);
}

export async function registerForPushNotificationsAsync(userId: string) {
  if (Platform.OS === 'web' || !Notifications) {
    console.log('[NotificationService] Notifications native module is not loaded.');
    return null;
  }

  try {
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

    // EAS Project ID retrieved from app.json config
    const token = (await Notifications.getExpoPushTokenAsync({
      projectId: '5dad5e21-3524-4aff-98e7-d1c6bc12a2ef',
    })).data;

    console.log('[NotificationService] Generated Expo Push Token:', token);

    // Save the token to the user document in Firestore so caller can query it
    const userRef = doc(db, 'users', userId);
    await updateDoc(userRef, { expoPushToken: token });

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
      });
    }

    return token;
  } catch (error) {
    console.warn('[NotificationService] Error setting up push notifications:', error);
    return null;
  }
}
