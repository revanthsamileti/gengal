import { useEffect, useRef } from 'react';
import type { User } from 'firebase/auth';
import {
  addNotificationResponseListener,
  clearInitialNotificationResponse,
  getInitialNotificationResponse,
} from '../services/notificationService';

/** What a message notification carries (see notify_new_message in backend/app.py). */
export type MessageTap = {
  chatId: string;
  senderUid: string;
  senderName: string;
};

const messageFrom = (response: any): MessageTap | null => {
  const data = response?.notification?.request?.content?.data;
  if (data?.type !== 'message' || !data?.chatId || !data?.senderUid) return null;
  return {
    chatId: String(data.chatId),
    senderUid: String(data.senderUid),
    senderName: typeof data.senderName === 'string' && data.senderName ? data.senderName : 'Someone',
  };
};

/**
 * Opens the conversation a tapped message notification is about.
 *
 * Covers both ways a tap arrives: the listener, for an app that was running in
 * the background, and the launch response, for one that was not running at
 * all. Call notifications are left to useIncomingCallWatcher.
 */
export function useMessageNotificationTaps(user: User | null, onOpen: (message: MessageTap) => void) {
  const handlerRef = useRef(onOpen);
  handlerRef.current = onOpen;

  useEffect(() => {
    if (!user) return;
    // One tap can be reported by both paths; open the chat once.
    const handled = new Set<string>();

    const handle = (response: any) => {
      const message = messageFrom(response);
      if (!message) return;
      const key = response?.notification?.request?.identifier ?? message.chatId;
      if (handled.has(key)) return;
      handled.add(key);
      // The launch response is never cleared on its own; without this the
      // same chat would reopen on every later launch.
      clearInitialNotificationResponse().catch(() => {});
      handlerRef.current(message);
    };

    const off = addNotificationResponseListener(handle);
    getInitialNotificationResponse().then(handle).catch(() => {});
    return off;
  }, [user?.uid]);
}
