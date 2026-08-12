import { db } from '../config/firebase';
import {
  collection,
  doc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  increment,
  limitToLast,
  updateDoc,
  setDoc,
  deleteDoc,
  Timestamp,
} from 'firebase/firestore';
import { snapshotError } from './subscriptionError';

export interface ChatMessage {
  id?: string;
  senderId: string;
  text: string;
  timestamp: any;
  isRead: boolean;
}

/**
 * Sorted conversation key for two users.
 *
 * Sorting the two UIDs lexically guarantees the same key regardless of who
 * initiates — both sides write to and read from the same Firestore document.
 * Firebase UIDs are alphanumeric and do not contain underscores, so splitting
 * on '_' to recover the participants is reliable.
 */
export const getChatId = (uid1: string, uid2: string) => {
  return uid1 < uid2 ? `${uid1}_${uid2}` : `${uid2}_${uid1}`;
};

/**
 * Send a message and update the conversation summary in a single atomic batch.
 *
 * The previous implementation used two separate writes:
 *   1. setDoc(chatRef, { lastMessage … })   — updates summary
 *   2. addDoc(messagesRef, { text … })      — adds message
 *
 * If write 1 succeeded and write 2 failed, the conversation list permanently
 * showed a "last message" with no corresponding document in the subcollection.
 * And even when both wrote, the summary updated BEFORE the message existed,
 * so a reader racing the two writes saw an advertised message they couldn't
 * fetch yet.
 *
 * A writeBatch collapses both into one commit: either both land or neither
 * does. The message is written first within the batch so the summary can only
 * ever point to a message that is already there.
 *
 * `recipientId` is passed explicitly rather than derived from `chatId.split('_')`
 * so the unread counter is attributed to the correct user unambiguously.
 */

/**
 * Chats whose parent document is known to exist, for this session only.
 *
 * Purely a cost optimisation for `ensureChatExists` below — being wrong in
 * either direction is harmless, because the write it skips is idempotent and a
 * cold start simply pays for it once more.
 */
const knownChats = new Set<string>();

/**
 * Guarantees `chats/{chatId}` exists before anything writes to its messages.
 *
 * This cannot be folded into the batch below, and the reason is subtle enough
 * to be worth stating: the security rule on message creation is
 * `participantInChat(chatId)`, which resolves the parent through `get()`.
 * Rules evaluate `get()` against *committed* data, so writes made earlier in
 * the same batch are invisible to the rules of their siblings. On the first
 * message of a new conversation the parent does not exist yet, `get()` returns
 * null, `.data.participants` dereferences it, and the message write is denied —
 * taking the atomic batch, and therefore the parent's own creation, down with
 * it. The result was a conversation that could never be started: every attempt
 * failed, and each failure removed the very document the next attempt needed.
 *
 * Splitting this out costs one extra write the first time a conversation is
 * used. It does not weaken what the batch is for: this write carries no message
 * content and no summary, so it cannot leave the conversation list advertising
 * a message that isn't there.
 */
const ensureChatExists = async (chatId: string) => {
  if (knownChats.has(chatId)) return;
  await setDoc(
    doc(db, 'chats', chatId),
    { participants: chatId.split('_') },
    { merge: true },
  );
  knownChats.add(chatId);
};

export const sendMessage = async (
  chatId: string,
  senderId: string,
  recipientId: string,
  text: string,
) => {
  try {
    const chatRef = doc(db, 'chats', chatId);
    await ensureChatExists(chatId);

    // Pre-generate the message document reference so the batch can reference
    // it without a round-trip read.
    const messageRef = doc(collection(chatRef, 'messages'));

    const batch = writeBatch(db);

    // Message first — the summary must never advertise a message that doesn't
    // exist yet.
    batch.set(messageRef, {
      senderId,
      text,
      timestamp: serverTimestamp(),
      isRead: false,
    });

    // Summary: merge=true so fields owned by other code paths are not wiped.
    // Increment the recipient's unread counter server-side so concurrent sends
    // from different devices don't race and drop counts.
    batch.set(
      chatRef,
      {
        lastMessage: text,
        lastUpdatedAt: serverTimestamp(),
        participants: chatId.split('_'),
        [`unreadFor_${recipientId}`]: increment(1),
      },
      { merge: true },
    );

    await batch.commit();
  } catch (error) {
    console.error('[Chat] sendMessage failed:', error);
    throw error;
  }
};

/**
 * How long a "typing" assertion stays good for.
 *
 * Same expiring-fact model as room presence: the sender re-asserts while they
 * are still typing and readers age the assertion out, so a sender who closes
 * the app, crashes or loses signal mid-word cannot strand the other person
 * watching "typing…" forever. Nothing has to be cleared for the indicator to
 * go away — only for it to go away *promptly*.
 */
export const TYPING_TTL_MS = 6000;

/**
 * How often a continuously-typing user re-asserts.
 *
 * Comfortably inside the TTL so the indicator does not flicker, but far enough
 * apart that a fast typist costs one write every few seconds rather than one
 * per keystroke — which on a long message would be hundreds of writes and a
 * bill to match.
 */
export const TYPING_HEARTBEAT_MS = 3000;

/** Last time we told the server we were typing, per chat. */
const lastTypingWrite: Record<string, number> = {};

/**
 * Assert that `uid` is typing in `chatId`.
 *
 * Rate-limited internally rather than at the call site, so a screen can call
 * this on every keystroke — the natural thing to write — without generating a
 * write per character.
 */
export const setTyping = async (chatId: string, uid: string) => {
  const key = `${chatId}:${uid}`;
  const now = Date.now();
  if (now - (lastTypingWrite[key] ?? 0) < TYPING_HEARTBEAT_MS) return;
  lastTypingWrite[key] = now;
  try {
    await setDoc(doc(db, 'chats', chatId, 'typing', uid), { at: Timestamp.now() });
  } catch {
    // A dropped typing beat is cosmetic — never let it interrupt composing.
  }
};

/**
 * Stop asserting immediately, so the indicator clears the moment a message is
 * sent or the field is emptied rather than lingering for the rest of the TTL.
 */
export const clearTyping = async (chatId: string, uid: string) => {
  delete lastTypingWrite[`${chatId}:${uid}`];
  try {
    await deleteDoc(doc(db, 'chats', chatId, 'typing', uid));
  } catch {
    // Cosmetic; the TTL clears it shortly regardless.
  }
};

/**
 * Whether the *other* participant is typing.
 *
 * Re-evaluates on a timer as well as on each snapshot, because the assertion
 * expires with the passage of time rather than with a write — without the
 * timer, a sender who simply stopped typing would leave the indicator up until
 * they next touched the document.
 */
export const subscribeToTyping = (
  chatId: string,
  selfUid: string,
  callback: (isTyping: boolean) => void,
  onError?: (error: Error) => void,
) => {
  let latest: number[] = [];
  const emit = () => {
    const now = Date.now();
    callback(latest.some((t) => now - t <= TYPING_TTL_MS));
  };

  const unsubscribe = onSnapshot(
    collection(db, 'chats', chatId, 'typing'),
    (snap) => {
      latest = snap.docs
        .filter((d) => d.id !== selfUid)
        .map((d) => {
          const at = d.data()?.at;
          return typeof at?.toMillis === 'function' ? at.toMillis() : 0;
        });
      emit();
    },
    snapshotError('chat:typing', onError, () => callback(false)),
  );

  const sweep = setInterval(emit, 1000);
  return () => {
    clearInterval(sweep);
    unsubscribe();
  };
};

/**
 * Clear the unread counter for `uid` in a conversation.
 *
 * Called when the user opens the conversation. The document must already exist
 * for there to be an unread count, so updateDoc (rather than setDoc+merge) is
 * correct — if it throws, only the badge lags; no data is lost.
 */
export const markConversationRead = async (chatId: string, uid: string) => {
  try {
    await updateDoc(doc(db, 'chats', chatId), { [`unreadFor_${uid}`]: 0 });
  } catch {
    // Non-fatal — the badge may not clear this session, but nothing is lost.
    // Intentionally swallowed: a failed mark-read must never interrupt reading.
  }
};

/**
 * How many messages the subscription holds at once.
 *
 * limitToLast keeps the N most-recent messages in ascending timestamp order,
 * so the list renders oldest-first as a chat UI expects. Without a limit the
 * query payload grows with the conversation: a chat active for a year delivers
 * a year of history on every screen mount.
 */
export const MESSAGE_PAGE_SIZE = 50;

/**
 * Subscribe to the N most-recent messages in a conversation.
 *
 * `onError` is an explicit parameter, not optional noise. A Firestore listener
 * that has no error handler fails SILENTLY — a permission error or missing
 * index leaves the screen looking like an empty conversation with no way for
 * the user to know something went wrong. This is the same class of bug already
 * found and fixed in IncomingCallOverlay (commit "Handle errors on the two
 * incoming-call snapshot listeners") and in presenceService.ts.
 */
export const subscribeToMessages = (
  chatId: string,
  callback: (messages: ChatMessage[]) => void,
  onError?: (error: Error) => void,
) => {
  const messagesRef = collection(db, 'chats', chatId, 'messages');
  // limitToLast(N) with orderBy asc delivers the N newest in chronological
  // order — the same result as orderBy desc + limit(N) + client-side reverse,
  // but without the client-side reversal step.
  const q = query(
    messagesRef,
    orderBy('timestamp', 'asc'),
    limitToLast(MESSAGE_PAGE_SIZE),
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const messages: ChatMessage[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      } as ChatMessage));
      callback(messages);
    },
    (error) => {
      // Surface to the caller so they can show an error state rather than
      // sitting silent with an empty list.
      console.error('[Chat] subscribeToMessages failed:', error);
      onError?.(error as Error);
    },
  );
};
