import { db } from '../config/firebase';
import { 
  collection, 
  addDoc, 
  query, 
  orderBy, 
  onSnapshot,
  serverTimestamp,
  doc,
  setDoc
} from 'firebase/firestore';

export interface ChatMessage {
  id?: string;
  senderId: string;
  text: string;
  timestamp: any;
  isRead: boolean;
}

// Generate a unique, consistent chat ID for two users
export const getChatId = (uid1: string, uid2: string) => {
  return uid1 < uid2 ? `${uid1}_${uid2}` : `${uid2}_${uid1}`;
};

export const sendMessage = async (chatId: string, senderId: string, text: string) => {
  try {
    const chatRef = doc(db, 'chats', chatId);
    
    // Ensure the chat document exists
    await setDoc(chatRef, {
      lastMessage: text,
      lastUpdatedAt: serverTimestamp(),
      participants: chatId.split('_')
    }, { merge: true });

    // Add the message to the subcollection
    const messagesRef = collection(chatRef, 'messages');
    await addDoc(messagesRef, {
      senderId,
      text,
      timestamp: serverTimestamp(),
      isRead: false
    });
  } catch (error) {
    console.error("Error sending message:", error);
    throw error;
  }
};

export const subscribeToMessages = (chatId: string, callback: (messages: ChatMessage[]) => void) => {
  const messagesRef = collection(db, 'chats', chatId, 'messages');
  const q = query(messagesRef, orderBy('timestamp', 'asc'));

  return onSnapshot(q, (snapshot) => {
    const messages: ChatMessage[] = [];
    snapshot.forEach((doc) => {
      messages.push({ id: doc.id, ...doc.data() } as ChatMessage);
    });
    callback(messages);
  }, (error) => {
    console.error("Error subscribing to messages:", error);
  });
};
