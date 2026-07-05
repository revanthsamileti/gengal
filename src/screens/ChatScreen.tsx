import React, { useEffect, useMemo, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
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
import { skeuo } from '../theme/skeuomorphic';

import CallPriceTag from '../components/CallPriceTag';
import ScreenShell from '../components/ScreenShell';
import { getChatId, sendMessage, subscribeToMessages } from '../services/chatService';
import { auth } from '../config/firebase';

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
  const profile = matchData ? {
    name: matchData.nickname || matchData.name,
    uri: matchData.uri || matchData.avatarUrl || '',
  } : { name: profileName || 'User', uri: '' };
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
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
    const unsubscribe = subscribeToMessages(chatId, (fetchedMessages) => {
      const formatted: Message[] = fetchedMessages.map(m => ({
        id: m.id as any,
        from: m.senderId === currentUid ? 'me' : 'them',
        text: m.text,
        time: m.timestamp?.toDate ? m.timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Now'
      }));
      setMessages(formatted);
    });
    return unsubscribe;
  }, [chatId, currentUid]);

  const handleSend = async (text = draft) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setDraft('');
    if (!chatId || !currentUid) return;
    try {
      await sendMessage(chatId, currentUid, trimmed);
    } catch (e) {
      console.error('Failed to send message', e);
    }
  };

  return (
    <ScreenShell tone="light">
      <KeyboardAvoidingView
        style={styles.phone}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <TouchableOpacity style={styles.headerButton} activeOpacity={0.78} onPress={() => goBack ? goBack() : navigate('Home')}>
            <MaterialIcons name="arrow-back" size={22} color="#5A075F" />
          </TouchableOpacity>
          <View style={styles.headerProfile}>
            <Image source={{ uri: profile.uri }} style={styles.avatar} />
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
              style={styles.headerAction}
              activeOpacity={0.8}
              onPress={() => navigate('Call', { profileName: profile.name, mode: 'call', isCaller: true })}
            >
              <MaterialIcons name="phone" size={16} color="#FFF" />
              <CallPriceTag mode="call" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.headerAction, styles.headerActionDark]}
              activeOpacity={0.8}
              onPress={() => navigate('Call', { profileName: profile.name, mode: 'video', isCaller: true })}
            >
              <MaterialIcons name="videocam" size={16} color="#FFF7FF" />
              <CallPriceTag mode="video" />
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView
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

          {messages.length === 0 && (
            <View style={styles.emptyChat}>
              <MaterialIcons name="chat-bubble-outline" size={40} color="#D8C9AE" />
              <Text style={styles.emptyChatText}>Say hello to start the conversation</Text>
            </View>
          )}
          {messages.map((message) => {
            const mine = message.from === 'me';
            return (
              <View key={message.id} style={[styles.messageRow, mine && styles.messageRowMine]}>
                {!mine ? <Image source={{ uri: profile.uri }} style={styles.messageAvatar} /> : null}
                <View style={[styles.bubble, mine ? styles.myBubble : styles.theirBubble]}>
                  <Text style={[styles.bubbleText, mine && styles.myBubbleText]}>{message.text}</Text>
                  <Text style={[styles.messageTime, mine && styles.myMessageTime]}>{message.time}</Text>
                </View>
              </View>
            );
          })}
        </ScrollView>

        <View style={styles.quickRow}>
          {quickReplies.map((reply) => (
            <TouchableOpacity key={reply} style={styles.quickPill} onPress={() => handleSend(reply)}>
              <Text style={styles.quickText}>{reply}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.composer}>
          <TouchableOpacity style={styles.composerIcon} activeOpacity={0.8}>
            <MaterialIcons name="add" size={20} color="#8C7A70" />
          </TouchableOpacity>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Write a private message"
            placeholderTextColor="#A59A91"
            style={styles.input}
            onSubmitEditing={() => handleSend(draft)}
          />
          <TouchableOpacity
            style={[styles.sendButton, draft.trim() ? styles.sendButtonActive : null]}
            activeOpacity={0.84}
            onPress={() => handleSend(draft)}
          >
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
  composerIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5EEE5',
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
