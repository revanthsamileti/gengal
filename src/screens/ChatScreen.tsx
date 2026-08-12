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
  const targetUid = matchData?.uid;
  const chatId = (currentUid && targetUid) ? getChatId(currentUid, targetUid) : '';

  useEffect(() => {
    if (!chatId) {
      setMessages([]);
      return;
    }

    // Clear the unread badge as soon as the conversation is open.
    // Non-fatal: if this fails the badge may lag, but reading continues.
    if (currentUid) {
      markConversationRead(chatId, currentUid);
    }

    const unsubscribe = subscribeToMessages(
      chatId,
      (fetchedMessages) => {
        setListenerError(false);
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
            <MaterialIcons name="arrow-back" size={22} color="#5A075F" />
          </TouchableOpacity>
          <View style={styles.headerProfile}>
            {/* Avatar hierarchy: avatarData (avatar builder) → photo URI → icon
                fallback. Previously used an empty-string uri which produced a
                warning on every render and drew a blank box. */}
            {profile.avatarData ? (
              <GengalAvatar data={profile.avatarData} size={44} />
            ) : profile.uri ? (
              <Image source={{ uri: profile.uri }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarEmpty]}>
                <MaterialIcons name="person" size={26} color="#C9BDB2" />
              </View>
            )}
            <View style={styles.headerCopy}>
              <Text style={styles.name}>{profile.name}</Text>
              <View style={styles.statusRow}>
                <View style={styles.onlineDot} />
                <Text style={styles.statusText}>Online now</Text>
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
              <MaterialIcons name="phone" size={16} color="#FFF" />
              <CallPriceTag mode="call" />
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
              <CallPriceTag mode="video" />
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
            colors={['#FFFDF8', '#F7EEDF']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.matchBanner}
          >
            <MaterialIcons name="favorite" size={17} color="#7E6507" />
            <Text style={styles.matchText}>Private match connected</Text>
          </LinearGradient>

          {listenerError ? (
            <View style={styles.emptyChat}>
              <MaterialIcons name="cloud-off" size={40} color="#D8C9AE" />
              <Text style={styles.emptyChatText}>Could not load messages. Check your connection.</Text>
            </View>
          ) : messages.length === 0 ? (
            <View style={styles.emptyChat}>
              <MaterialIcons name="chat-bubble-outline" size={40} color="#D8C9AE" />
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
                    <Image source={{ uri: profile.uri }} style={styles.messageAvatar} />
                  ) : (
                    <View style={[styles.messageAvatar, styles.messageAvatarEmpty]}>
                      <MaterialIcons name="person" size={16} color="#C9BDB2" />
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
                <Image source={{ uri: profile.uri }} style={styles.messageAvatar} />
              ) : (
                <View style={[styles.messageAvatar, styles.messageAvatarEmpty]}>
                  <MaterialIcons name="person" size={16} color="#C9BDB2" />
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
    backgroundColor: '#FFFCF7',
  },
  header: {
    minHeight: 76,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F0E7DA',
    backgroundColor: '#FFFCF7',
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF8EA',
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
    borderColor: '#D8BD57',
  },
  avatarEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F2ECE4',
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    color: '#4B0054',
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
    color: '#7D8B70',
    fontSize: 10,
    fontWeight: '900',
  },
  headerActions: {
    flexDirection: 'column',
    gap: 7,
  },
  headerAction: {
    height: 38,
    minWidth: 38,
    paddingHorizontal: 10,
    borderRadius: 19,
    flexDirection: 'row',
    gap: 4,
    alignItems: 'center',
    justifyContent: 'center',
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
    borderColor: '#EAD8A9',
  },
  matchText: {
    color: '#6B5B24',
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
    backgroundColor: '#F2ECE4',
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
    backgroundColor: '#FFFDF8',
    borderWidth: 1,
    borderColor: '#EFE4D3',
  },
  myBubble: {
    borderBottomRightRadius: 6,
    backgroundColor: '#4B0054',
    boxShadow: Platform.OS === 'web' ? '0 8px 16px rgba(75, 0, 84, 0.16)' : undefined,
  },
  bubbleText: {
    color: '#6B5F57',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  typingText: {
    color: '#A59A91',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    fontStyle: 'italic',
  },
  myBubbleText: {
    color: '#FFF7FF',
  },
  messageTime: {
    color: '#AAA098',
    fontSize: 9,
    fontWeight: '800',
  },
  myMessageTime: {
    color: '#D8C7DC',
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
    backgroundColor: '#FFF5D8',
    borderWidth: 1,
    borderColor: '#E1C460',
  },
  quickText: {
    color: '#806806',
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
    backgroundColor: '#FFFCF7',
  },
  input: {
    flex: 1,
    height: 42,
    borderRadius: 21,
    paddingHorizontal: 15,
    color: '#4B0054',
    fontSize: 13,
    fontWeight: '800',
    backgroundColor: '#FFFDF8',
    borderWidth: 1,
    borderColor: '#EFE4D3',
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#BCA9BF',
  },
  sendButtonActive: {
    backgroundColor: '#4B0054',
  },
  emptyChat: {
    alignItems: 'center',
    paddingVertical: 48,
    gap: 10,
  },
  emptyChatText: {
    color: '#B0A49A',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
});
