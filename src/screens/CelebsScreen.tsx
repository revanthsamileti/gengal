import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Image,
  KeyboardAvoidingView,
  Animated,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import ScreenShell from '../components/ScreenShell';
import { useActionLock } from '../hooks/useActionLock';
import { launchCall } from '../services/callPermissionService';
import TopBar from '../components/TopBar';
import BottomNav from '../components/BottomNav';
import GengalAvatar from '../components/GengalAvatar';
import CallPriceTag from '../components/CallPriceTag';
import { skeuo } from '../theme/skeuomorphic';
import { auth } from '../config/firebase';
import { useUser } from '../context/UserContext';
import { subscribeToOnlineUsers, UserProfile } from '../services/userService';
import {
  subscribeToActiveRooms,
  subscribeToRoomEvents,
  sendChatMessage,
  joinRoom,
  leaveRoom,
  ExpertRoom,
  RoomEvent,
} from '../services/expertRoomService';
import { tap28 } from '../theme/touch';

type CelebsScreenProps = {
  navigate: (screen: string, params?: any) => void;
  goBack?: () => void;
};

// ── Live Room Chat Panel ─────────────────────────────────────────────────────

function LiveRoomChat({
  room,
  onClose,
  onEnterRoom,
}: {
  room: ExpertRoom;
  onClose: () => void;
  /** Leaves the text-only preview for the real room, where the audio is. */
  onEnterRoom: (room: ExpertRoom) => void;
}) {
  const { profile } = useUser();
  const myUid = auth.currentUser?.uid ?? '';
  const [events, setEvents] = useState<RoomEvent[]>([]);
  const [chatText, setChatText] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!room.id) return;
    joinRoom(room.id, myUid, profile?.nickname || 'Guest', profile?.avatarData || null);
    const unsub = subscribeToRoomEvents(room.id, (evts) => {
      setEvents([...evts].reverse());
    });
    return () => {
      unsub();
      if (room.id) leaveRoom(room.id, myUid, profile?.nickname || 'Guest');
    };
  }, [room.id]);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [events]);

  const handleSend = useCallback(async () => {
    if (!chatText.trim() || !room.id) return;
    setSending(true);
    try {
      await sendChatMessage(
        room.id,
        myUid,
        profile?.nickname || 'Guest',
        profile?.avatarData || null,
        chatText.trim(),
      );
      setChatText('');
    } finally {
      setSending(false);
    }
  }, [chatText, room.id, myUid, profile]);

  return (
    <View style={chatStyles.panel}>
      {/* Header */}
      <LinearGradient colors={['#2A0128', '#5B0068']} style={chatStyles.header}>
        <View style={chatStyles.headerLeft}>
          <View style={chatStyles.liveDot} />
          <Text style={chatStyles.hostName} numberOfLines={1}>{room.hostNickname}</Text>
          <Text style={chatStyles.topic} numberOfLines={1}>{room.topic}</Text>
        </View>
        {/* Until this existed the panel was a dead end: you could read and type,
            but there was no way through to the room's audio stage. */}
        <TouchableOpacity
          onPress={() => onEnterRoom(room)}
          style={chatStyles.enterBtn}
          hitSlop={tap28}
          accessibilityRole="button"
          accessibilityLabel={`Join ${room.hostNickname}'s live room`}
        >
          <MaterialIcons name="headset-mic" size={13} color="#2A0128" />
          <Text style={chatStyles.enterBtnText}>Join live</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onClose} style={chatStyles.closeBtn} hitSlop={tap28}
          accessibilityRole="button"
          accessibilityLabel="Close">
          <MaterialIcons name="close" size={18} color="#FFFDF8" />
        </TouchableOpacity>
      </LinearGradient>

      {/* Messages */}
      <ScrollView
        ref={scrollRef}
        style={chatStyles.messageList}
        contentContainerStyle={chatStyles.messageContent}
        showsVerticalScrollIndicator={false}
      >
        {events.filter(e => e.type === 'chat' || e.type === 'join').map((evt, i) => (
          <View key={evt.id || i} style={chatStyles.messageRow}>
            <Text style={[chatStyles.msgSender, evt.senderUid === myUid && chatStyles.msgSenderMe]}>
              {evt.senderUid === myUid ? 'You' : evt.senderName}
            </Text>
            {evt.type === 'join' ? (
              <Text style={chatStyles.joinText}> joined the live</Text>
            ) : (
              <Text style={chatStyles.msgText}>{evt.text}</Text>
            )}
          </View>
        ))}
      </ScrollView>

      {/* Input */}
      {/* Android needs an explicit behavior here too; with none, the keyboard
          covered the composer entirely. */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={chatStyles.inputRow}>
          <TextInput
            style={chatStyles.input}
            placeholder="Say something..."
            placeholderTextColor="#B0A090"
            value={chatText}
            onChangeText={setChatText}
            onSubmitEditing={handleSend}
            returnKeyType="send"
            maxLength={200}
          />
          <TouchableOpacity
            style={[chatStyles.sendBtn, !chatText.trim() && chatStyles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!chatText.trim() || sending}
          
            accessibilityRole="button"
            accessibilityLabel="Send message">
            {sending
              ? <ActivityIndicator size="small" color="#FFF" />
              : <MaterialIcons name="send" size={16} color="#FFF" />}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const chatStyles = StyleSheet.create({
  panel: {
    marginHorizontal: 14,
    marginBottom: 16,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(209,178,59,0.2)',
    backgroundColor: '#1A0714',
    boxShadow: Platform.OS === 'web' ? skeuo.deepShadow : undefined,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  headerLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#5EBB62' },
  hostName: { color: '#FFFDF8', fontSize: 13, fontWeight: '900', maxWidth: 100 },
  topic: { color: 'rgba(255,253,248,0.55)', fontSize: 11, fontWeight: '600', flex: 1 },
  closeBtn: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,253,248,0.1)',
  },
  enterBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, height: 28, borderRadius: 14,
    backgroundColor: '#E8CA58',
  },
  enterBtnText: { color: '#2A0128', fontSize: 11, fontWeight: '900' },
  messageList: { maxHeight: 180 },
  messageContent: { padding: 12, gap: 6 },
  messageRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 4 },
  msgSender: { color: '#D4B142', fontSize: 11, fontWeight: '900' },
  msgSenderMe: { color: '#A78BF0' },
  msgText: { color: '#EADCA8', fontSize: 12, fontWeight: '500', flexShrink: 1 },
  joinText: { color: 'rgba(234,220,168,0.5)', fontSize: 11, fontStyle: 'italic' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.07)',
  },
  input: {
    flex: 1,
    height: 38,
    borderRadius: 19,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(255,253,248,0.08)',
    color: '#FFFDF8',
    fontSize: 13,
    fontWeight: '500',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  sendBtn: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#5B0068',
  },
  sendBtnDisabled: { backgroundColor: 'rgba(91,0,104,0.35)' },
});

// ── Celeb Card ───────────────────────────────────────────────────────────────

function CelebCard({
  user,
  liveRoom,
  navigate,
  onJoinLive,
}: {
  user: UserProfile;
  liveRoom?: ExpertRoom;
  navigate: CelebsScreenProps['navigate'];
  onJoinLive: (room: ExpertRoom) => void;
}) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start();
  }, []);

  const profile = {
    uid: user.uid,
    name: user.nickname || user.username || 'User',
    age: typeof user.age === 'number' ? user.age : (user.age ? parseInt(user.age, 10) : undefined),
    uri: user.avatarUrl || '',
    avatarData: user.avatarData,
    language: user.language || 'EN',
    bio: user.bio || '',
  };

  const { locked: callLocked, run: runCall } = useActionLock();
  const startCall = (mode: 'call' | 'video') =>
    runCall(() =>
      launchCall(navigate, {
        profileName: profile.name,
        mode,
        isCaller: true,
        matchData: { ...profile, modes: ['call', 'video'] },
      })
    );

  return (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
      <View style={cardStyles.card}>
        <LinearGradient colors={['#1A0714', '#2E0138']} style={StyleSheet.absoluteFill} />

        {/* Photo / Avatar */}
        <TouchableOpacity
          activeOpacity={0.85}
          style={cardStyles.photoWrap}
          onPress={() => navigate('Profile', { profileName: profile.name, matchData: { ...profile, modes: ['call', 'video'] } })}
        >
          <LinearGradient
            colors={['#F8EFCB', '#B89628', '#FFF8DB']}
            style={cardStyles.photoRing}
          >
            <View style={cardStyles.photoInner}>
              {profile.avatarData ? (
                <GengalAvatar data={profile.avatarData} size={72} />
              ) : profile.uri ? (
                <Image source={{ uri: profile.uri }} style={cardStyles.photo} />
              ) : null}
            </View>
          </LinearGradient>

          {/* VIP badge */}
          <View style={cardStyles.vipBadge}>
            <MaterialIcons name="diamond" size={8} color="#B68D1C" />
            <Text style={cardStyles.vipText}>VIP</Text>
          </View>

          {/* Online dot */}
          <View style={cardStyles.onlineDot} />
        </TouchableOpacity>

        {/* Info */}
        <View style={cardStyles.info}>
          <Text style={cardStyles.name} numberOfLines={1}>{profile.name}, {profile.age}</Text>
          <View style={cardStyles.langRow}>
            <MaterialIcons name="language" size={9} color="#B88A2E" />
            <Text style={cardStyles.lang}>{profile.language}</Text>
          </View>
          {profile.bio ? (
            <Text style={cardStyles.bio} numberOfLines={2}>{profile.bio}</Text>
          ) : null}
        </View>

        {/* Actions */}
        <View style={cardStyles.actions}>
          {/* Call */}
          <TouchableOpacity
            style={[cardStyles.actionBtn, callLocked && { opacity: 0.5 }]}
            activeOpacity={0.82}
            disabled={callLocked}
            accessibilityRole="button"
            accessibilityLabel={`Call ${profile.name}`}
            onPress={() => startCall('call')}
          >
            <MaterialIcons name="phone" size={14} color="#FFF" />
            <Text style={cardStyles.actionText}>Call</Text>
            <CallPriceTag mode="call" />
          </TouchableOpacity>

          {/* Video */}
          <TouchableOpacity
            style={[cardStyles.actionBtn, cardStyles.actionBtnVideo, callLocked && { opacity: 0.5 }]}
            activeOpacity={0.82}
            disabled={callLocked}
            accessibilityRole="button"
            accessibilityLabel={`Video call ${profile.name}`}
            onPress={() => startCall('video')}
          >
            <MaterialIcons name="videocam" size={14} color="#FFF7FF" />
            <Text style={[cardStyles.actionText, cardStyles.actionTextVideo]}>Video</Text>
            <CallPriceTag mode="video" />
          </TouchableOpacity>

          {/* Join live room if hosting one */}
          {liveRoom ? (
            <TouchableOpacity
              style={cardStyles.liveBtn}
              activeOpacity={0.82}
              onPress={() => onJoinLive(liveRoom)}
            >
              <View style={cardStyles.liveBtnDot} />
              <Text style={cardStyles.liveBtnText}>Live</Text>
              <Text style={cardStyles.liveBtnCount}>{liveRoom.activeMemberCount}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </Animated.View>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(209,178,59,0.15)',
    padding: 14,
    gap: 12,
    boxShadow: Platform.OS === 'web' ? skeuo.deepShadow : undefined,
  },
  photoWrap: { alignSelf: 'center', alignItems: 'center' },
  photoRing: {
    width: 84, height: 84, borderRadius: 42,
    padding: 3, alignItems: 'center', justifyContent: 'center',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  photoInner: {
    flex: 1, width: '100%', borderRadius: 39,
    overflow: 'hidden', backgroundColor: '#FFFDF8',
    alignItems: 'center', justifyContent: 'center',
  },
  photo: { width: '100%', height: '100%', borderRadius: 37 },
  vipBadge: {
    position: 'absolute', bottom: 6, left: '50%', marginLeft: -18,
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8,
    backgroundColor: '#FFF4CF', borderWidth: 1, borderColor: '#E3C867',
  },
  vipText: { color: '#8A6715', fontSize: 7, fontWeight: '900', textTransform: 'uppercase' },
  onlineDot: {
    position: 'absolute', right: 3, top: 6,
    width: 11, height: 11, borderRadius: 6,
    backgroundColor: '#5EBB62', borderWidth: 2, borderColor: '#1A0714',
  },
  info: { gap: 3 },
  name: { color: '#FFFDF8', fontSize: 16, fontWeight: '900', fontFamily: 'serif' },
  langRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  lang: { color: '#EADCA8', fontSize: 9, fontWeight: '800' },
  bio: { color: 'rgba(234,220,168,0.65)', fontSize: 11, fontWeight: '500', lineHeight: 15, marginTop: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14,
    backgroundColor: '#7A256D', borderWidth: 1, borderColor: '#7A256D',
  },
  actionBtnVideo: {},
  actionText: { color: '#FFF', fontSize: 11, fontWeight: '900' },
  actionTextVideo: {},
  liveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14,
    backgroundColor: '#5B0068', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  liveBtnDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#5EBB62' },
  liveBtnText: { color: '#FFFDF8', fontSize: 11, fontWeight: '900' },
  liveBtnCount: { color: 'rgba(255,253,248,0.6)', fontSize: 10, fontWeight: '700' },
});

// ── Live Now strip ───────────────────────────────────────────────────────────

/**
 * Every room that is live right now, not just the ones hosted by a VIP who
 * also happens to be in the online list. The per-card Live button only ever
 * appeared when both of those lined up, which is why the page looked as though
 * it had no live controls at all.
 */
function LiveNowStrip({
  rooms,
  activeRoomId,
  onOpen,
}: {
  rooms: ExpertRoom[];
  activeRoomId?: string;
  onOpen: (room: ExpertRoom) => void;
}) {
  if (rooms.length === 0) return null;

  return (
    <View style={stripStyles.wrap}>
      <View style={stripStyles.headingRow}>
        <View style={stripStyles.dot} />
        <Text style={stripStyles.heading}>Live now</Text>
        <Text style={stripStyles.count}>{rooms.length}</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={stripStyles.row}
      >
        {rooms.map((room) => {
          const selected = room.id === activeRoomId;
          return (
            <TouchableOpacity
              key={room.id}
              activeOpacity={0.85}
              style={[stripStyles.tile, selected && stripStyles.tileSelected]}
              onPress={() => onOpen(room)}
              accessibilityRole="button"
              accessibilityLabel={`Open ${room.hostNickname}'s live room on ${room.topic}`}
            >
              <View style={stripStyles.tileAvatarRing}>
                {room.hostAvatarData ? (
                  <GengalAvatar data={room.hostAvatarData} size={40} />
                ) : (
                  <MaterialIcons name="mic" size={20} color="#E8CA58" />
                )}
              </View>
              <Text style={stripStyles.tileHost} numberOfLines={1}>{room.hostNickname}</Text>
              <Text style={stripStyles.tileTopic} numberOfLines={1}>{room.topic}</Text>
              <View style={stripStyles.tileMetaRow}>
                <MaterialIcons name="people" size={9} color="#B88A2E" />
                <Text style={stripStyles.tileMeta}>{room.activeMemberCount}</Text>
                <Text style={stripStyles.tileTier}>{room.tier}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const stripStyles = StyleSheet.create({
  wrap: { marginBottom: 14 },
  headingRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, marginBottom: 8,
  },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#5EBB62' },
  heading: { color: '#4B0054', fontSize: 13, fontWeight: '900', letterSpacing: 0.5 },
  count: { color: '#9A856E', fontSize: 11, fontWeight: '700' },
  row: { paddingHorizontal: 16, gap: 10 },
  tile: {
    width: 116,
    padding: 10,
    borderRadius: 16,
    backgroundColor: '#1A0714',
    borderWidth: 1,
    borderColor: 'rgba(209,178,59,0.22)',
    alignItems: 'center',
    gap: 3,
  },
  tileSelected: { borderColor: '#E8CA58' },
  tileAvatarRing: {
    width: 46, height: 46, borderRadius: 23,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: '#B89628',
    overflow: 'hidden', marginBottom: 4,
  },
  tileHost: { color: '#FFFDF8', fontSize: 12, fontWeight: '900', maxWidth: '100%' },
  tileTopic: { color: 'rgba(255,253,248,0.55)', fontSize: 10, maxWidth: '100%' },
  tileMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3 },
  tileMeta: { color: '#B88A2E', fontSize: 9, fontWeight: '800' },
  tileTier: { color: 'rgba(255,253,248,0.4)', fontSize: 9, fontWeight: '700', marginLeft: 4 },
});

// ── Main Screen ──────────────────────────────────────────────────────────────

export default function CelebsScreen({ navigate, goBack }: CelebsScreenProps) {
  const { profile: myProfile } = useUser();
  const myIsVip = myProfile?.isVip === true;
  const [vipUsers, setVipUsers] = useState<UserProfile[]>([]);
  const [liveRooms, setLiveRooms] = useState<ExpertRoom[]>([]);
  const [activeChat, setActiveChat] = useState<ExpertRoom | null>(null);
  const [vipsLoaded, setVipsLoaded] = useState(false);

  useEffect(() => {
    // VIP is the paid tier. This used to select on `avatarUrl`, which filled
    // the Celebs page with anyone who had uploaded a picture.
    const unsub = subscribeToOnlineUsers((users) => {
      setVipUsers(users.filter(u => u.isVip === true));
      setVipsLoaded(true);
    }, auth.currentUser?.uid, true);
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = subscribeToActiveRooms(setLiveRooms);
    return unsub;
  }, []);

  // Map VIP rooms by hostUid for quick lookup
  const roomByHost = liveRooms.reduce<Record<string, ExpertRoom>>((acc, r) => {
    acc[r.hostUid] = r;
    return acc;
  }, {});

  const handleJoinLive = (room: ExpertRoom) => {
    setActiveChat(room);
  };

  const handleEnterRoom = (room: ExpertRoom) => {
    if (!room.id) return;
    setActiveChat(null);
    navigate('ExpertRoom', { roomId: room.id });
  };

  return (
    <ScreenShell tone="light">
      <View style={styles.phone}>
        <TopBar navigate={navigate} subtitle="CELEBS" />

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* Hero strip */}
          <LinearGradient colors={['#2A0128', '#5B0068']} style={styles.hero}>
            <View style={styles.heroRow}>
              {vipUsers.length + liveRooms.length > 0 ? (
                <View style={styles.livePill}>
                  <View style={styles.livePillDot} />
                  <Text style={styles.livePillText}>LIVE NOW</Text>
                </View>
              ) : null}
              <Text style={styles.heroCount}>
                {vipUsers.length === 0 ? 'No VIPs online right now' : `${vipUsers.length} ${vipUsers.length === 1 ? 'VIP' : 'VIPs'} online`}
              </Text>
            </View>
            <Text style={styles.heroTitle}>Celebs</Text>
            <Text style={styles.heroSub}>Call · Video · Join their live</Text>

            {/* Going live is for VIP celebs; everyone else only sees it as a
                button they cannot use. */}
            {myIsVip && <TouchableOpacity
              style={styles.goLiveBtn}
              activeOpacity={0.85}
              onPress={() => navigate('Club')}
              accessibilityRole="button"
              accessibilityLabel="Go live and host your own room"
            >
              <MaterialIcons name="podcasts" size={14} color="#2A0128" />
              <Text style={styles.goLiveText}>Go live</Text>
            </TouchableOpacity>}
          </LinearGradient>

          <LiveNowStrip
            rooms={liveRooms}
            activeRoomId={activeChat?.id}
            onOpen={handleJoinLive}
          />

          {/* Active live chat panel */}
          {activeChat ? (
            <LiveRoomChat
              room={activeChat}
              onClose={() => setActiveChat(null)}
              onEnterRoom={handleEnterRoom}
            />
          ) : null}

          {/* VIP list */}
          {!vipsLoaded ? (
            <View style={styles.empty}>
              <ActivityIndicator color="#4B0054" />
            </View>
          ) : vipUsers.length === 0 ? (
            <View style={styles.empty}>
              <MaterialIcons name="diamond" size={40} color="#D1B23B" />
              <Text style={styles.emptyTitle}>No VIPs online</Text>
              <Text style={styles.emptyText}>Check back soon — VIP celebs will appear here when they're live.</Text>
            </View>
          ) : (
            <View style={styles.cardList}>
              {vipUsers.map((user) => (
                <CelebCard
                  key={user.uid}
                  user={user}
                  liveRoom={user.uid ? roomByHost[user.uid] : undefined}
                  navigate={navigate}
                  onJoinLive={handleJoinLive}
                />
              ))}
            </View>
          )}

        </ScrollView>

        <BottomNav active="Celebs" navigate={navigate} />
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  phone: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: 430 },
  scroll: { paddingBottom: 110 },

  hero: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 22,
    padding: 20,
    paddingBottom: 22,
  },
  heroRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 10,
  },
  goLiveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    marginTop: 12,
    paddingHorizontal: 14,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#E8CA58',
  },
  goLiveText: { color: '#2A0128', fontSize: 12, fontWeight: '900', letterSpacing: 0.4 },
  livePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,253,248,0.15)',
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12,
  },
  livePillDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#5EBB62' },
  livePillText: { color: '#FFFDF8', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  heroCount: { color: 'rgba(255,253,248,0.6)', fontSize: 11, fontWeight: '700' },
  heroTitle: {
    color: '#FFFDF8', fontSize: 26, fontWeight: '900',
    fontFamily: 'serif', marginBottom: 4,
  },
  heroSub: { color: 'rgba(255,253,248,0.65)', fontSize: 12, fontWeight: '600' },

  empty: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: 32 },
  emptyTitle: {
    color: '#4B0054', fontSize: 18, fontWeight: '900',
    fontFamily: 'serif', marginTop: 12, marginBottom: 6,
  },
  emptyText: {
    color: '#8A7C70', fontSize: 13, fontWeight: '600',
    textAlign: 'center', lineHeight: 19,
  },

  cardList: { paddingHorizontal: 16, marginTop: 16, gap: 12 },
});
