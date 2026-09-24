import React, { useEffect, useMemo, useRef, useState } from 'react';
import { tap34, tap38, tap40, tap42 } from '../theme/touch';
import {
  Image,
  KeyboardAvoidingView,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';

import CallPriceTag from '../components/CallPriceTag';
import GengalAvatar from '../components/GengalAvatar';
import ScreenShell from '../components/ScreenShell';
import { dismissChatNotifications, setOpenChat } from '../services/notificationService';
import {
  clearTyping,
  getChatId,
  markConversationRead,
  sendMessage,
  setTyping,
  subscribeToMessages,
  subscribeToTyping,
} from '../services/chatService';
import { auth } from '../config/firebase';
import { useActionLock } from '../hooks/useActionLock';
import { launchCall } from '../services/callPermissionService';
import { Alert } from '../components/CustomAlert';
import { useBlockedUids } from '../services/safetyService';

type ChatScreenProps = {
  profileName?: string;
  navigate: (screen: string, params?: any) => void;
  goBack?: () => void;
  route?: any;
};

type Message = {
  id: number;
  from: 'me' | 'them';
  text: string;
  time: string;
};

export default function ChatScreen({ profileName, navigate, goBack, route }: ChatScreenProps) {
  const matchData = route?.params?.matchData;
  // Carry avatarData so we can render the avatar-builder avatar instead of a
  // photo URI. Without it we always fell through to an empty-string uri.
  const profile = matchData ? {
    uid: matchData.uid,
    name: matchData.nickname || matchData.name,
    avatarData: matchData.avatarData ?? null,
    uri: matchData.uri || matchData.avatarUrl || '',
  } : {
    uid: undefined as string | undefined,
    name: profileName || 'User',
    avatarData: null as any,
    uri: '',
  };
  const { locked: callLocked, run: runCall } = useActionLock();
  // Without a uid CallScreen cannot create an offer, so the button must not
  // pretend to work — it used to navigate and immediately bounce back.
  const canCall = !!profile.uid;

  const startCall = (mode: 'call' | 'video') =>
    runCall(() =>
      launchCall(navigate, { profileName: profile.name, mode, isCaller: true, matchData })
    );
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  // Surface listener failures so the user sees an error instead of a blank list.
  const [listenerError, setListenerError] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);

  // ScrollView ref and scroll-position tracking for smart auto-scroll.
  const scrollRef = useRef<ScrollView>(null);
  // Whether the viewport is at (or near) the bottom of the message list.
  // Stored as a ref rather than state so updates don't trigger re-renders.
  const atBottomRef = useRef(true);

  const quickReplies = useMemo(
    () => ['Start softly', 'Voice call?', 'Tell me about you'],
    [],
  );

  const currentUid = auth.currentUser?.uid;
  // Callers arrive with the peer's uid in one of two shapes: inside `matchData`
  // (profile cards, the conversation list) or as a top-level `targetUid`
  // (ExpertRoomScreen's private-match hand-off). Reading only the first meant
  // the second produced an empty chatId, and every send died on the "not ready
  // yet" guard below. Accept both rather than making every caller conform.
  const targetUid = matchData?.uid ?? route?.params?.targetUid;
  const chatId = (currentUid && targetUid) ? getChatId(currentUid, targetUid) : '';
  const peerBlocked = useBlockedUids().has(targetUid ?? '');

  // While this conversation is on screen its messages are right here, so no
  // banner for them, and any already in the tray are cleared.
  useEffect(() => {
    if (!chatId) return;
    setOpenChat(chatId);
    dismissChatNotifications(chatId).catch(() => {});
    return () => setOpenChat(null);
  }, [chatId]);

  // Newest peer message already marked read, so a snapshot carrying nothing new
  // from them (our own send, a typing change) costs no write.
  const lastReadPeerMessageRef = useRef<string | null>(null);

  useEffect(() => {
    if (!chatId) {
      setMessages([]);
      return;
    }
    lastReadPeerMessageRef.current = null;

    // Clear the unread badge as soon as the conversation is open.
    // Non-fatal: if this fails the badge may lag, but reading continues.
    if (currentUid) {
      markConversationRead(chatId, currentUid);
    }

    const unsubscribe = subscribeToMessages(
      chatId,
      (fetchedMessages) => {
        setListenerError(false);

        // Messages that arrive while the screen is already open increment the
        // recipient's counter exactly as they do when it is closed, and this
        // ran on mount only -- so reading a conversation as it happened left a
        // badge on the Messages tab for messages that were already on screen,
        // and it stayed there until the user backed out and came in again.
        const newestFromPeer = [...fetchedMessages]
          .reverse()
          .find(m => m.senderId !== currentUid);
        if (
          currentUid &&
          newestFromPeer?.id &&
          newestFromPeer.id !== lastReadPeerMessageRef.current
        ) {
          lastReadPeerMessageRef.current = newestFromPeer.id;
          markConversationRead(chatId, currentUid);
        }

        const formatted: Message[] = fetchedMessages.map(m => ({
          id: m.id as any,
          from: m.senderId === currentUid ? 'me' : 'them',
          text: m.text,
          time: m.timestamp?.toDate
            ? m.timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : 'Now',
        }));
        setMessages(formatted);
      },
      (error) => {
        // Firestore rejected the listener — permission error, missing index, or
        // network failure. Show an error state rather than a blank list.
        console.warn('[ChatScreen] Message listener failed:', error?.message ?? error);
        setListenerError(true);
      },
    );
    return unsubscribe;
  }, [chatId, currentUid]);

  // Peer typing indicator. Kept in its own effect so a typing-subscription
  // failure cannot take the message listener down with it, and so leaving the
  // screen retracts our own indicator rather than leaving the other person
  // watching "typing…" until it expires.
  useEffect(() => {
    if (!chatId || !currentUid) return;
    const unsubscribe = subscribeToTyping(chatId, currentUid, setPeerTyping);
    return () => {
      unsubscribe();
      void clearTyping(chatId, currentUid);
    };
  }, [chatId, currentUid]);

  // Auto-scroll to the newest message, but only when the user is already at
  // the bottom of the list. Scrolling them back while they are reading history
  // is a real annoyance that made users miss context.
  useEffect(() => {
    if (!atBottomRef.current) return;
    // The brief delay lets the layout engine finish measuring the new content
    // before scrollToEnd runs; without it the first render undershoots.
    const t = setTimeout(
      () => scrollRef.current?.scrollToEnd({ animated: messages.length > 1 }),
      80,
    );
    return () => clearTimeout(t);
  }, [messages.length]);

  const handleSend = async (text = draft) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Validate before clearing. The guard used to sit after `setDraft('')`, so
    // a missing chat id wiped what the user typed and sent nothing.
    if (!chatId || !currentUid) {
      Alert.alert('Cannot send', 'This conversation is not ready yet. Please try again.', [{ text: 'OK' }]);
      return;
    }

    const previousDraft = draft;
    setDraft('');
    // Drop the indicator immediately rather than letting it expire — the
    // message has arrived, so "typing…" alongside it reads as a second message
    // that never comes.
    if (currentUid) void clearTyping(chatId, currentUid);
    try {
      // recipientId is now required so sendMessage can increment the correct
      // unread counter atomically in the same batch as the message write.
      // chatId is non-empty only when both currentUid and targetUid are defined,
      // so the non-null assertion is safe.
      await sendMessage(chatId, currentUid, targetUid!, trimmed);
    } catch (e: any) {
      // Put the text back rather than destroying it — the send is optimistic,
      // so a failure has to be recoverable.
      setDraft(previousDraft);
      Alert.alert('Message not sent', e?.message || 'Check your connection and try again.', [{ text: 'OK' }]);
    }
  };

  // Track whether the user's viewport is near the bottom of the message list.
  // Capped at a 100 ms throttle so the handler doesn't fire on every pixel.
  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    // 80px headroom: a single tall message can be taller than the threshold,
    // so use a generous margin so we don't falsely conclude they've scrolled up.
    atBottomRef.current =
      contentOffset.y + layoutMeasurement.height >= contentSize.height - 80;
  };

  return (
    <ScreenShell tone="light">
      {/* Android needs 'height' here; leaving behavior undefined let the soft
          keyboard cover the composer entirely. */}
      <KeyboardAvoidingView
        style={styles.phone}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.header}>
          <TouchableOpacity hitSlop={tap40} style={styles.headerButton} activeOpacity={0.78} onPress={() => goBack ? goBack() : navigate('Home')}
            accessibilityRole="button"
            accessibilityLabel="Go back">
            <MaterialIcons name="arrow-back" size={22} color="#8C5566" />
          </TouchableOpacity>
          <View style={styles.headerProfile}>
            {/* Avatar hierarchy: avatarData (avatar builder) → photo URI → icon
                fallback. Previously used an empty-string uri which produced a
                warning on every render and drew a blank box. */}
            {profile.avatarData ? (
              <GengalAvatar data={profile.avatarData} size={44} />
            ) : profile.uri ? (
              <Image source={{ uri: profile.uri }} style={styles.avatar} accessible={false} />
            ) : (
              <View style={[styles.avatar, styles.avatarEmpty]}>
                <MaterialIcons name="person" size={26} color="#D5BFB6" />
              </View>
            )}
            <View style={styles.headerCopy}>
              {/* Truncate rather than let a long name push the call buttons
                  off the right edge -- the container already has minWidth 0,
                  but without numberOfLines the text still forces the row wider. */}
              <Text style={styles.name} numberOfLines={1}>{profile.name}</Text>
              <View style={styles.statusRow}>
                <View style={styles.onlineDot} />
                {/* Single line: the two price pills leave this column narrow,
                    and without it "Online now" wrapped and pushed the header
                    taller than the name it sits under. */}
                <Text style={styles.statusText} numberOfLines={1}>Online now</Text>
              </View>
            </View>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={[styles.headerAction, (!canCall || callLocked) && { opacity: 0.5 }]}
              hitSlop={tap38}
              activeOpacity={0.8}
              disabled={!canCall || callLocked}
              accessibilityRole="button"
              accessibilityLabel={`Call ${profile.name}`}
              accessibilityState={{ disabled: !canCall || callLocked }}
              onPress={() => startCall('call')}
            >
              <MaterialIcons name="phone" size={16} color="#FFF7FF" />
              <CallPriceTag mode="call" bare textColor="#FFF7FF" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.headerAction, styles.headerActionDark, (!canCall || callLocked) && { opacity: 0.5 }]}
              hitSlop={tap38}
              activeOpacity={0.8}
              disabled={!canCall || callLocked}
              accessibilityRole="button"
              accessibilityLabel={`Video call ${profile.name}`}
              accessibilityState={{ disabled: !canCall || callLocked }}
              onPress={() => startCall('video')}
            >
              <MaterialIcons name="videocam" size={16} color="#FFF7FF" />
              <CallPriceTag mode="video" bare textColor="#FFF7FF" />
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView
          ref={scrollRef}
          scrollEventThrottle={100}
          onScroll={handleScroll}
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.messages}
        >
          <LinearGradient
            colors={['#FFFDF8', '#F7EDE4']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.matchBanner}
          >
            <MaterialIcons name="favorite" size={17} color="#C08497" />
            <Text style={styles.matchText}>Private match connected</Text>
          </LinearGradient>

          {listenerError ? (
            <View style={styles.emptyChat}>
              <MaterialIcons name="cloud-off" size={40} color="#DDC9BF" />
              <Text style={styles.emptyChatText}>Could not load messages. Check your connection.</Text>
            </View>
          ) : messages.length === 0 ? (
            <View style={styles.emptyChat}>
              <MaterialIcons name="chat-bubble-outline" size={40} color="#DDC9BF" />
              <Text style={styles.emptyChatText}>Say hello to start the conversation</Text>
            </View>
          ) : null}

          {messages.map((message) => {
            const mine = message.from === 'me';
            return (
              <View key={message.id} style={[styles.messageRow, mine && styles.messageRowMine]}>
                {/* Avatar hierarchy for in-message avatars: same rules as the
                    header — guard empty uri rather than letting RN warn. */}
                {!mine ? (
                  profile.avatarData ? (
                    <GengalAvatar data={profile.avatarData} size={30} />
                  ) : profile.uri ? (
                    <Image source={{ uri: profile.uri }} style={styles.messageAvatar} accessible={false} />
                  ) : (
                    <View style={[styles.messageAvatar, styles.messageAvatarEmpty]}>
                      <MaterialIcons name="person" size={16} color="#D5BFB6" />
                    </View>
                  )
                ) : null}
                <View style={[styles.bubble, mine ? styles.myBubble : styles.theirBubble]}>
                  <Text style={[styles.bubbleText, mine && styles.myBubbleText]}>{message.text}</Text>
                  <Text style={[styles.messageTime, mine && styles.myMessageTime]}>{message.time}</Text>
                </View>
              </View>
            );
          })}

          {/* Rendered inside the scroll view so it sits below the last message
              and rides the existing auto-scroll, the way a real bubble does. */}
          {peerTyping ? (
            <View style={styles.messageRow}>
              {profile.avatarData ? (
                <GengalAvatar data={profile.avatarData} size={30} />
              ) : profile.uri ? (
                <Image source={{ uri: profile.uri }} style={styles.messageAvatar} accessible={false} />
              ) : (
                <View style={[styles.messageAvatar, styles.messageAvatarEmpty]}>
                  <MaterialIcons name="person" size={16} color="#D5BFB6" />
                </View>
              )}
              <View style={[styles.bubble, styles.theirBubble]}>
                <Text
                  style={styles.typingText}
                  accessibilityLiveRegion="polite"
                  accessibilityLabel={`${profile.name || 'They'} are typing`}
                >
                  typing…
                </Text>
              </View>
            </View>
          ) : null}
        </ScrollView>

        {peerBlocked ? (
          <View style={styles.blockedBar}>
            <MaterialIcons name="block" size={18} color="#8B2E2E" />
            <Text style={styles.blockedText}>You blocked this person. Unblock them from their profile to chat.</Text>
          </View>
        ) : (<>
        <View style={styles.quickRow}>
          {quickReplies.map((reply) => (
            <TouchableOpacity hitSlop={tap34} key={reply} style={styles.quickPill} onPress={() => handleSend(reply)}>
              <Text style={styles.quickText}>{reply}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={(text) => {
              setDraft(text);
              // Safe to call per keystroke: setTyping rate-limits internally,
              // so a long message costs a write every few seconds rather than
              // one per character. Clearing on an emptied field means backing
              // out of a message retracts the indicator straight away.
              if (!chatId || !currentUid) return;
              if (text.trim()) void setTyping(chatId, currentUid);
              else void clearTyping(chatId, currentUid);
            }}
            placeholder="Write a private message"
            placeholderTextColor="#A59A91"
            style={styles.input}
            onSubmitEditing={() => handleSend(draft)}
          />
          <TouchableOpacity
            style={[styles.sendButton, draft.trim() ? styles.sendButtonActive : null]}
            hitSlop={tap42}
            activeOpacity={0.84}
            onPress={() => handleSend(draft)}

            accessibilityRole="button"
            accessibilityLabel="Send message">
            <MaterialIcons name="send" size={18} color="#FFF7FF" />
          </TouchableOpacity>
        </View>
        </>)}
      </KeyboardAvoidingView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  phone: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 430,
    backgroundColor: '#FFFBF4',
  },
  header: {
    minHeight: 76,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F0E4D8',
    backgroundColor: '#FFFDF8',
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FBF2E8',
  },
  headerProfile: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: '#E8C6C1',
  },
  avatarEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5EDE5',
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    color: '#8C5566',
    fontFamily: 'serif',
    fontSize: 22,
    fontWeight: '900',
  },
  statusRow: {
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  onlineDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#73BB58',
  },
  statusText: {
    color: '#9E8C82',
    fontSize: 10,
    fontWeight: '900',
  },
  headerActions: {
    // Was `column`, which stacked two 38dp pills plus a 7dp gap into a header
    // whose minHeight is 76 -- so the second one spilled over the bottom
    // border. Side by side also stops the two heaviest elements on the screen
    // from towering over the name they belong to.
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerAction: {
    height: 34,
    // Tight horizontally on purpose: two priced pills plus a back button and an
    // avatar leave the name very little room on a narrow handset.
    paddingHorizontal: 8,
    borderRadius: 17,
    flexDirection: 'row',
    gap: 3,
    alignItems: 'center',
    justifyContent: 'center',
    // Voice and video share one colour by request: the two are equal-weight
    // actions, so giving voice a quieter tint made it read as the lesser
    // option when it is simply the cheaper one.
    //
    // Deliberately held at the brand purple and NOT re-tinted with the red
    // velvet palette around it: these two are the only controls on this screen
    // that spend money, and keeping them the colour they are everywhere else
    // in the app is worth more than matching the surrounding theme.
    backgroundColor: '#7A256D',
    borderWidth: 1,
    borderColor: '#7A256D',
    boxShadow: Platform.OS === 'web' ? '0 6px 12px rgba(122, 37, 109, 0.3)' : undefined,
  },
  headerActionDark: {},
  messages: {
    padding: 16,
    paddingBottom: 20,
    gap: 13,
  },
  matchBanner: {
    alignSelf: 'center',
    minHeight: 38,
    paddingHorizontal: 14,
    borderRadius: 19,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderWidth: 1,
    borderColor: '#EBD9D2',
  },
  matchText: {
    color: '#8C5566',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  messageRowMine: {
    justifyContent: 'flex-end',
  },
  messageAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
  },
  messageAvatarEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5EDE5',
  },
  bubble: {
    maxWidth: '76%',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 5,
  },
  theirBubble: {
    borderBottomLeftRadius: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F0E2DA',
  },
  myBubble: {
    borderBottomRightRadius: 6,
    backgroundColor: '#C08497',
    boxShadow: Platform.OS === 'web' ? '0 8px 16px rgba(75, 0, 84, 0.16)' : undefined,
  },
  bubbleText: {
    color: '#5F5048',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  typingText: {
    color: '#A99A90',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    fontStyle: 'italic',
  },
  myBubbleText: {
    color: '#FFFFFF',
  },
  messageTime: {
    color: '#A99A90',
    fontSize: 9,
    fontWeight: '800',
  },
  myMessageTime: {
    color: '#F5E3E7',
  },
  quickRow: {
    paddingHorizontal: 14,
    paddingBottom: 10,
    flexDirection: 'row',
    gap: 8,
  },
  quickPill: {
    flex: 1,
    minHeight: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    backgroundColor: '#FDF6EF',
    borderWidth: 1,
    borderColor: '#EBDCCF',
  },
  quickText: {
    color: '#8C5566',
    fontSize: 10,
    fontWeight: '900',
  },
  composer: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#F0E7DA',
    backgroundColor: '#FFFDF8',
  },
  input: {
    flex: 1,
    height: 42,
    borderRadius: 21,
    paddingHorizontal: 15,
    color: '#5F5048',
    fontSize: 13,
    fontWeight: '800',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F0E2DA',
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E0CBC6',
  },
  sendButtonActive: {
    backgroundColor: '#C08497',
  },
  emptyChat: {
    alignItems: 'center',
    paddingVertical: 48,
    gap: 10,
  },
  emptyChatText: {
    color: '#A99A90',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  blockedBar: {
    margin: 16,
    padding: 14,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFF1F0',
    borderWidth: 1,
    borderColor: '#F0C9C6',
  },
  blockedText: {
    flex: 1,
    color: '#8B2E2E',
    fontSize: 13,
    fontWeight: '700',
  },
});
