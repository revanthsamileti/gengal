import { Alert } from '../components/CustomAlert';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Modal,
  ActivityIndicator,
  Animated } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import ScreenShell from '../components/ScreenShell';
import TopBar from '../components/TopBar';
import BottomNav from '../components/BottomNav';
import GengalAvatar from '../components/GengalAvatar';
import { skeuo } from '../theme/skeuomorphic';
import { auth } from '../config/firebase';
import { useUser } from '../context/UserContext';
import {
  ChillRoom, CHILL_LANGUAGES,
  subscribeToChillRooms,
  createChillRoom,
} from '../services/chillService';
import { deductUserCoins } from '../services/coinService';
import {
  LudoRoom,
  subscribeToLudoRooms,
  createLudoRoom,
  joinLudoRoom,
} from '../services/ludoService';

interface Props {
  navigate: (screen: string, params?: any) => void;
  goBack?: () => void;
}

type ActiveGame = 'charades' | 'ludo';

// ── Dumb Charades room card ───────────────────────────────────────────────────

function CharadesRoomCard({ room, onJoin }: { room: ChillRoom; onJoin: () => void }) {
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 300, useNativeDriver: true }).start();
  }, []);

  const phaseColor: Record<string, string> = {
    waiting: '#A78BF0', acting: '#5EBB62', result: '#C9504B', finished: '#555',
  };
  const phaseLabel: Record<string, string> = {
    waiting: 'Lobby', prompt: 'Starting', acting: 'Live', result: 'Round End', finished: 'Done',
  };
  const color = phaseColor[room.phase] ?? '#A78BF0';

  return (
    <Animated.View style={{ opacity: fade }}>
      <TouchableOpacity style={crStyles.card} activeOpacity={0.82} onPress={onJoin}>
        <LinearGradient colors={['#1A0714', '#2E0138']} style={StyleSheet.absoluteFill} />
        <View style={crStyles.row}>
          <View style={crStyles.avatar}>
            <GengalAvatar data={room.hostAvatarData} size={38} />
          </View>
          <View style={crStyles.info}>
            <Text style={crStyles.host} numberOfLines={1}>{room.hostNickname}</Text>
            <Text style={crStyles.sub}>{room.language} · {room.activeMemberCount} players</Text>
          </View>
          <View style={[crStyles.pill, { borderColor: color + '55', backgroundColor: color + '18' }]}>
            {room.phase === 'acting' && <View style={[crStyles.dot, { backgroundColor: color }]} />}
            <Text style={[crStyles.pillText, { color }]}>{phaseLabel[room.phase] ?? room.phase}</Text>
          </View>
        </View>
        <TouchableOpacity style={crStyles.joinBtn} onPress={onJoin} activeOpacity={0.82}>
          <MaterialIcons name="login" size={13} color="#FFFDF8" />
          <Text style={crStyles.joinText}>Join Room</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    </Animated.View>
  );
}

const crStyles = StyleSheet.create({
  card: {
    borderRadius: 18, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(167,139,240,0.2)',
    padding: 12, gap: 10,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: {
    width: 44, height: 44, borderRadius: 22, overflow: 'hidden',
    borderWidth: 2, borderColor: 'rgba(167,139,240,0.3)',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,253,248,0.05)',
  },
  info: { flex: 1 },
  host: { color: '#FFFDF8', fontSize: 13, fontWeight: '900' },
  sub: { color: 'rgba(255,253,248,0.45)', fontSize: 10, fontWeight: '700', marginTop: 2 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, borderWidth: 1,
  },
  dot: { width: 5, height: 5, borderRadius: 3 },
  pillText: { fontSize: 9, fontWeight: '900', letterSpacing: 0.4 },
  joinBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 9, borderRadius: 12,
    backgroundColor: '#5B0068', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  joinText: { color: '#FFFDF8', fontSize: 12, fontWeight: '900' },
});

// ── Ludo room card ────────────────────────────────────────────────────────────

const LUDO_COLOR_HEX: Record<string, string> = {
  red: '#C9504B', blue: '#0891B2', green: '#5EBB62', yellow: '#D4B142',
};

function LudoRoomCard({
  room, onJoin, loading,
}: {
  room: LudoRoom; onJoin: () => void; loading: boolean;
}) {
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 300, useNativeDriver: true }).start();
  }, []);

  return (
    <Animated.View style={{ opacity: fade }}>
      <TouchableOpacity style={lrStyles.card} activeOpacity={0.82} onPress={onJoin}>
        <LinearGradient colors={['#071208', '#0D2B14']} style={StyleSheet.absoluteFill} />
        <View style={lrStyles.row}>
          <View style={lrStyles.avatar}>
            <GengalAvatar data={room.players[0]?.avatarData} size={38} />
          </View>
          <View style={lrStyles.info}>
            <Text style={lrStyles.host} numberOfLines={1}>{room.players[0]?.nickname ?? 'Host'}</Text>
            <Text style={lrStyles.sub}>{room.players.length}/4 players</Text>
          </View>
          <View style={[lrStyles.pill, room.phase === 'playing' && lrStyles.pillLive]}>
            {room.phase === 'playing' && <View style={lrStyles.liveDot} />}
            <Text style={[lrStyles.pillText, room.phase === 'playing' && lrStyles.pillTextLive]}>
              {room.phase === 'waiting' ? 'Lobby' : 'In Game'}
            </Text>
          </View>
        </View>
        {/* Color slot dots */}
        <View style={lrStyles.colorRow}>
          {['red', 'blue', 'green', 'yellow'].map(color => {
            const player = room.players.find(p => p.color === color);
            return (
              <View key={color} style={[lrStyles.colorSlot, { borderColor: LUDO_COLOR_HEX[color] + '40' }]}>
                <View style={[lrStyles.colorDot, { backgroundColor: LUDO_COLOR_HEX[color] }]} />
                <Text style={lrStyles.colorName} numberOfLines={1}>
                  {player ? player.nickname : 'Open'}
                </Text>
              </View>
            );
          })}
        </View>
        <TouchableOpacity
          style={[lrStyles.joinBtn, loading && lrStyles.joinBtnDisabled]}
          onPress={onJoin}
          disabled={loading}
          activeOpacity={0.82}
        >
          {loading
            ? <ActivityIndicator size="small" color="#FFF" />
            : <>
                <MaterialIcons
                  name={room.players.length < 4 && room.phase === 'waiting' ? 'login' : 'visibility'}
                  size={13}
                  color="#FFFDF8"
                />
                <Text style={lrStyles.joinText}>
                  {room.players.length < 4 && room.phase === 'waiting' ? 'Join' : 'Watch'}
                </Text>
              </>}
        </TouchableOpacity>
      </TouchableOpacity>
    </Animated.View>
  );
}

const lrStyles = StyleSheet.create({
  card: {
    borderRadius: 18, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(94,187,98,0.2)',
    padding: 12, gap: 10,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: {
    width: 44, height: 44, borderRadius: 22, overflow: 'hidden',
    borderWidth: 2, borderColor: 'rgba(94,187,98,0.3)',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,253,248,0.05)',
  },
  info: { flex: 1 },
  host: { color: '#FFFDF8', fontSize: 13, fontWeight: '900' },
  sub: { color: 'rgba(255,253,248,0.45)', fontSize: 10, fontWeight: '700', marginTop: 2 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  pillLive: { borderColor: 'rgba(94,187,98,0.4)', backgroundColor: 'rgba(94,187,98,0.1)' },
  liveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#5EBB62' },
  pillText: { color: 'rgba(255,253,248,0.5)', fontSize: 9, fontWeight: '900', letterSpacing: 0.4 },
  pillTextLive: { color: '#5EBB62' },
  colorRow: { flexDirection: 'row', gap: 5 },
  colorSlot: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 5, paddingVertical: 4, borderRadius: 8,
    borderWidth: 1, backgroundColor: 'rgba(255,253,248,0.04)',
  },
  colorDot: { width: 6, height: 6, borderRadius: 3 },
  colorName: { color: 'rgba(255,253,248,0.5)', fontSize: 8, fontWeight: '700', flex: 1 },
  joinBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 9, borderRadius: 12,
    backgroundColor: '#1A6B33', borderWidth: 1, borderColor: 'rgba(94,187,98,0.25)',
  },
  joinBtnDisabled: { opacity: 0.5 },
  joinText: { color: '#FFFDF8', fontSize: 12, fontWeight: '900' },
});

// ── Create Charades modal ─────────────────────────────────────────────────────

function CreateCharadesModal({
  visible, onClose, onCreate,
}: {
  visible: boolean;
  onClose: () => void;
  onCreate: (language: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState('Hindi');
  const [loading, setLoading] = useState(false);

  const handleCreate = useCallback(async () => {
    setLoading(true);
    try { await onCreate(selected); } finally { setLoading(false); }
  }, [selected, onCreate]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={mStyles.overlay}>
        <View style={mStyles.card}>
          <Text style={mStyles.title}>Host Dumb Charades</Text>
          <Text style={mStyles.subtitle}>Pick the language for the movie pool</Text>
          <ScrollView style={mStyles.langScroll} showsVerticalScrollIndicator={false}>
            {CHILL_LANGUAGES.map(lang => (
              <TouchableOpacity
                key={lang}
                style={[mStyles.langRow, selected === lang && mStyles.langRowActive]}
                onPress={() => setSelected(lang)}
              >
                <Text style={[mStyles.langText, selected === lang && mStyles.langTextActive]}>{lang}</Text>
                {selected === lang && <MaterialIcons name="check-circle" size={16} color="#A78BF0" />}
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity
            style={[mStyles.createBtn, mStyles.charadeBtn, loading && mStyles.createBtnLoading]}
            onPress={handleCreate}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#FFF" size="small" />
              : <>
                  <MaterialIcons name="play-circle-filled" size={18} color="#FFFDF8" />
                  <Text style={mStyles.createBtnText}>Create Room</Text>
                </>}
          </TouchableOpacity>
          <TouchableOpacity style={mStyles.cancelBtn} onPress={onClose}>
            <Text style={mStyles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const mStyles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(10,5,15,0.88)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: '#120018',
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 24, paddingBottom: Platform.OS === 'ios' ? 40 : 28,
    borderWidth: 1, borderColor: 'rgba(167,139,240,0.2)',
    gap: 14,
  },
  title: { color: '#FFFDF8', fontSize: 20, fontWeight: '900', fontFamily: 'serif', textAlign: 'center' },
  subtitle: { color: 'rgba(255,253,248,0.45)', fontSize: 12, fontWeight: '600', textAlign: 'center', marginTop: -6 },
  langScroll: { maxHeight: 260 },
  langRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, marginBottom: 6,
    backgroundColor: 'rgba(255,253,248,0.05)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
  },
  langRowActive: { backgroundColor: 'rgba(167,139,240,0.1)', borderColor: 'rgba(167,139,240,0.35)' },
  langText: { color: 'rgba(255,253,248,0.6)', fontSize: 14, fontWeight: '700' },
  langTextActive: { color: '#A78BF0' },
  createBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 52, borderRadius: 26,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
  charadeBtn: { backgroundColor: '#5B0068' },
  createBtnLoading: { opacity: 0.6 },
  createBtnText: { color: '#FFFDF8', fontSize: 15, fontWeight: '900' },
  cancelBtn: { alignItems: 'center', paddingVertical: 6 },
  cancelText: { color: 'rgba(255,253,248,0.4)', fontSize: 13, fontWeight: '700' },
});

// ── Main screen ───────────────────────────────────────────────────────────────

export default function ChillScreen({ navigate, goBack }: Props) {
  const { profile } = useUser();
  const myUid = auth.currentUser?.uid ?? '';
  const myName = profile?.nickname || profile?.username || 'Guest';
  const myAvatarData = profile?.avatarData;

  const [activeGame, setActiveGame] = useState<ActiveGame>('ludo');
  const [charadeRooms, setCharadeRooms] = useState<ChillRoom[]>([]);
  const [ludoRooms, setLudoRooms] = useState<LudoRoom[]>([]);
  const [showCreateCharades, setShowCreateCharades] = useState(false);
  const [ludoCreateModalVisible, setLudoCreateModalVisible] = useState(false);
  const [creatingLudo, setCreatingLudo] = useState(false);
  const [joiningLudoId, setJoiningLudoId] = useState<string | null>(null);
  const [langFilter, setLangFilter] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribeToChillRooms(setCharadeRooms, langFilter ?? undefined);
    return unsub;
  }, [langFilter]);

  useEffect(() => {
    const unsub = subscribeToLudoRooms(setLudoRooms);
    return unsub;
  }, []);

  // Dumb Charades actions
  const handleCreateCharades = useCallback(async (language: string) => {
    const roomId = await createChillRoom(myUid, myName, myAvatarData, language);
    setShowCreateCharades(false);
    navigate('DumCharadesRoom', { roomId });
  }, [myUid, myName, myAvatarData, navigate]);

  const handleJoinCharades = useCallback((room: ChillRoom) => {
    if (!room.id) return;
    navigate('DumCharadesRoom', { roomId: room.id });
  }, [navigate]);

  // Ludo actions
  const handleCreateLudo = useCallback(async (mode: 'per_game' | 'per_token') => {
    if (!profile || profile.coins === undefined || profile.coins < 10) {
      Alert.alert('Insufficient Coins', 'You need at least 10 coins to create a room.');
      return;
    }
    setCreatingLudo(true);
    setLudoCreateModalVisible(false);
    try {
      await deductUserCoins(myUid, 10);
      const roomId = await createLudoRoom(myUid, myName, myAvatarData, mode);
      navigate('LudoBoard', { roomId });
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'Failed to create room.');
    } finally {
      setCreatingLudo(false);
    }
  }, [myUid, myName, myAvatarData, navigate, profile]);

  const handleJoinLudo = useCallback(async (room: LudoRoom) => {
    if (!room.id || joiningLudoId) return;
    setJoiningLudoId(room.id);
    try {
      const { joined } = await joinLudoRoom(room.id, myUid, myName, myAvatarData);
      if (joined) navigate('LudoBoard', { roomId: room.id });
    } finally {
      setJoiningLudoId(null);
    }
  }, [myUid, myName, myAvatarData, navigate, joiningLudoId]);

  const isCharades = activeGame === 'charades';

  return (
    <ScreenShell tone="light">
      <View style={styles.phone}>
        <TopBar navigate={navigate} subtitle="CHILL LOUNGE" />

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.heroPanel}>
            <View style={styles.heroIconCup}>
              <MaterialIcons name="local-cafe" size={30} color="#8B6F09" />
            </View>
            <View style={styles.heroCopy}>
              <Text style={styles.heroTitle}>Chill Lounge</Text>
              <Text style={styles.heroSub}>Play, talk, and unwind in relaxed premium rooms.</Text>
            </View>
          </View>

          <View style={styles.gamePickerRow}>
            <TouchableOpacity
              style={[styles.gameCard, isCharades && styles.gameCardActive,
                { borderColor: isCharades ? '#D8BCE2' : '#E9D9BE' }]}
              activeOpacity={0.82}
              onPress={() => setActiveGame('charades')}
            >
              <LinearGradient
                colors={isCharades ? ['#FFFFFF', '#FFF0FC', '#F5E1FA'] : ['#FFFFFF', '#FFF8EA']}
                style={StyleSheet.absoluteFill}
              />
              {isCharades && <View style={[styles.activeIndicator, { backgroundColor: '#8B3A93' }]} />}
              <View style={[styles.gameIcon, { backgroundColor: '#F4E1F7' }]}>
                <MaterialIcons name="theaters" size={30} color="#6D1673" />
              </View>
              <Text style={styles.gameTitle}>Dumb Charades</Text>
              <Text style={styles.gameSubtitle}>Movie guessing rooms</Text>
              <View style={[styles.gameCountPill, { borderColor: '#D8BCE2' }]}>
                <Text style={[styles.gameCountText, { color: '#6D1673' }]}>
                  {charadeRooms.length} live
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.gameCard, !isCharades && styles.gameCardActive,
                { borderColor: !isCharades ? '#C4DDB7' : '#E9D9BE' }]}
              activeOpacity={0.82}
              onPress={() => setActiveGame('ludo')}
            >
              <LinearGradient
                colors={!isCharades ? ['#FFFFFF', '#F0FAEA', '#E0F4D8'] : ['#FFFFFF', '#FFF8EA']}
                style={StyleSheet.absoluteFill}
              />
              {!isCharades && <View style={[styles.activeIndicator, { backgroundColor: '#609B43' }]} />}
              <View style={[styles.gameIcon, { backgroundColor: '#E0F4D8' }]}>
                <MaterialIcons name="casino" size={30} color="#3F7D2B" />
              </View>
              <Text style={styles.gameTitle}>Ludo Live</Text>
              <Text style={styles.gameSubtitle}>4-player game rooms</Text>
              <View style={[styles.gameCountPill, { borderColor: '#C4DDB7' }]}>
                <Text style={[styles.gameCountText, { color: '#3F7D2B' }]}>
                  {ludoRooms.length} live
                </Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* ── Section: Dumb Charades ── */}
          {isCharades && (
            <>
              {/* Hero action bar */}
              <View style={styles.actionBar}>
                <View style={styles.actionBarInfo}>
                  <Text style={styles.actionBarTitle}>Dumb Charades</Text>
                  <Text style={styles.actionBarSub}>Act, guess, laugh, and earn coins</Text>
                </View>
                <TouchableOpacity
                  style={[styles.createBtn, { backgroundColor: '#5B0068', borderColor: 'rgba(167,139,240,0.3)' }]}
                  onPress={() => setShowCreateCharades(true)}
                  activeOpacity={0.82}
                >
                  <MaterialIcons name="add" size={16} color="#FFFDF8" />
                  <Text style={styles.createBtnText}>Host</Text>
                </TouchableOpacity>
              </View>

              {/* Language filter */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.filterScroll}
              >
                <TouchableOpacity
                  style={[styles.filterPill, !langFilter && styles.filterPillActiveCharades]}
                  onPress={() => setLangFilter(null)}
                >
                  <Text style={[styles.filterText, !langFilter && { color: '#A78BF0' }]}>All</Text>
                </TouchableOpacity>
                {CHILL_LANGUAGES.map(lang => (
                  <TouchableOpacity
                    key={lang}
                    style={[styles.filterPill, langFilter === lang && styles.filterPillActiveCharades]}
                    onPress={() => setLangFilter(lang === langFilter ? null : lang)}
                  >
                    <Text style={[styles.filterText, langFilter === lang && { color: '#A78BF0' }]}>{lang}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Room list */}
              <View style={styles.list}>
                {charadeRooms.length === 0 ? (
                  <View style={styles.empty}>
                    <MaterialIcons name="theaters" size={42} color="#8B3A93" />
                    <Text style={styles.emptyTitle}>No rooms yet</Text>
                    <Text style={styles.emptyText}>Be the first to host a game!</Text>
                    <TouchableOpacity
                      style={[styles.emptyBtn, { backgroundColor: '#5B0068' }]}
                      onPress={() => setShowCreateCharades(true)}
                    >
                      <Text style={styles.emptyBtnText}>Host a Room</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  charadeRooms.map(room => (
                    <CharadesRoomCard
                      key={room.id}
                      room={room}
                      onJoin={() => handleJoinCharades(room)}
                    />
                  ))
                )}
              </View>
            </>
          )}

          {/* ── Section: Ludo ── */}
          {!isCharades && (
            <>
              {/* Hero action bar */}
              <View style={styles.actionBar}>
                <View style={styles.actionBarInfo}>
                  <Text style={styles.actionBarTitle}>Ludo Live</Text>
                  <Text style={styles.actionBarSub}>Up to 4 players with voice-friendly play</Text>
                </View>
                <TouchableOpacity
                  style={[styles.createBtn, { backgroundColor: '#1A6B33', borderColor: 'rgba(94,187,98,0.3)' },
                    creatingLudo && styles.createBtnLoading]}
                  onPress={() => setLudoCreateModalVisible(true)}
                  disabled={creatingLudo}
                  activeOpacity={0.82}
                >
                  {creatingLudo
                    ? <ActivityIndicator size="small" color="#FFF" />
                    : <>
                        <MaterialIcons name="add" size={16} color="#FFFDF8" />
                        <Text style={styles.createBtnText}>Create</Text>
                      </>}
                </TouchableOpacity>
              </View>

              {/* How to play */}
              <View style={styles.howRow}>
                {[
                  { icon: 'casino', label: 'Roll dice' },
                  { icon: 'directions-run', label: 'Move token' },
                  { icon: 'emoji-events', label: 'Reach home' },
                ].map(item => (
                  <View key={item.label} style={styles.howItem}>
                    <MaterialIcons name={item.icon as any} size={18} color="#5EBB62" />
                    <Text style={styles.howLabel}>{item.label}</Text>
                  </View>
                ))}
              </View>

              {/* Room list */}
              <View style={styles.list}>
                {ludoRooms.length === 0 ? (
                  <View style={styles.empty}>
                    <MaterialIcons name="casino" size={42} color="#3F7D2B" />
                    <Text style={styles.emptyTitle}>No rooms open</Text>
                    <Text style={styles.emptyText}>Create a room and invite friends!</Text>
                    <TouchableOpacity
                      style={[styles.emptyBtn, { backgroundColor: '#1A6B33' },
                        creatingLudo && styles.createBtnLoading]}
                      onPress={() => setLudoCreateModalVisible(true)}
                      disabled={creatingLudo}
                    >
                      {creatingLudo
                        ? <ActivityIndicator size="small" color="#FFF" />
                        : <Text style={styles.emptyBtnText}>Create Room</Text>}
                    </TouchableOpacity>
                  </View>
                ) : (
                  ludoRooms.map(room => (
                    <LudoRoomCard
                      key={room.id}
                      room={room}
                      onJoin={() => handleJoinLudo(room)}
                      loading={joiningLudoId === room.id}
                    />
                  ))
                )}
              </View>
            </>
          )}

        </ScrollView>

        <Modal visible={ludoCreateModalVisible} transparent animationType="slide" onRequestClose={() => setLudoCreateModalVisible(false)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' }}>
            <View style={{ backgroundColor: '#FFFDF8', width: '85%', borderRadius: 20, padding: 24, alignItems: 'center' }}>
              <Text style={{ fontSize: 20, fontWeight: 'bold', color: '#4A3600', marginBottom: 8 }}>Choose Game Mode</Text>
              <Text style={{ fontSize: 13, color: '#7E7368', textAlign: 'center', marginBottom: 20 }}>
                Creating a room costs 10 coins. You will earn a 10% commission from player tickets and bets!
              </Text>
              
              <TouchableOpacity style={[styles.createBtn, { width: '100%', marginBottom: 12, backgroundColor: '#4A3600', justifyContent: 'center' }]} onPress={() => handleCreateLudo('per_game')}>
                <Text style={{color: '#FFF', fontWeight: '800'}}>Per Game Mode</Text>
              </TouchableOpacity>
              <Text style={{ fontSize: 11, color: '#8B7A6A', textAlign: 'center', marginBottom: 20 }}>
                Players buy a fixed ticket (50 coins) to join your table.
              </Text>

              <TouchableOpacity style={[styles.createBtn, { width: '100%', backgroundColor: '#1A6B33', marginBottom: 12, justifyContent: 'center' }]} onPress={() => handleCreateLudo('per_token')}>
                <Text style={{color: '#FFF', fontWeight: '800'}}>Per Token Mode</Text>
              </TouchableOpacity>
              <Text style={{ fontSize: 11, color: '#8B7A6A', textAlign: 'center', marginBottom: 20 }}>
                Audience bets on colors, and every dice roll costs 15 coins.
              </Text>

              <TouchableOpacity onPress={() => setLudoCreateModalVisible(false)} style={{ padding: 10 }}>
                <Text style={{ color: '#8B7A6A', fontWeight: 'bold' }}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        <CreateCharadesModal
          visible={showCreateCharades}
          onClose={() => setShowCreateCharades(false)}
          onCreate={handleCreateCharades}
        />

        <BottomNav active="Chill" navigate={navigate} />
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  phone: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: 430 },
  scroll: { paddingBottom: 110 },
  heroPanel: {
    marginHorizontal: 14,
    marginTop: 14,
    padding: 16,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: skeuo.border,
    backgroundColor: '#FFFDF8',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  heroIconCup: {
    width: 58,
    height: 58,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF1BB',
    borderWidth: 1,
    borderColor: '#E8D79B',
    boxShadow: Platform.OS === 'web' ? 'inset 0 1px 0 rgba(255,255,255,0.9), 0 8px 16px rgba(154,122,5,0.16)' : undefined,
  },
  heroCopy: { flex: 1 },
  heroTitle: {
    color: skeuo.plum,
    fontFamily: 'serif',
    fontSize: 24,
    fontWeight: '900',
  },
  heroSub: {
    marginTop: 3,
    color: '#8E8072',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
  },

  // Game picker
  gamePickerRow: {
    flexDirection: 'row', gap: 10,
    marginHorizontal: 14, marginTop: 14,
  },
  gameCard: {
    flex: 1, borderRadius: 20, overflow: 'hidden',
    borderWidth: 1.5, padding: 16, gap: 6, alignItems: 'center',
    minHeight: 156,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  gameCardActive: {
    boxShadow: Platform.OS === 'web' ? '0 14px 28px rgba(83, 58, 29, 0.18), inset 0 1px 0 rgba(255,255,255,0.95)' : undefined,
  },
  activeIndicator: {
    position: 'absolute', top: 0, left: 0, right: 0,
    height: 3, backgroundColor: '#A78BF0', borderTopLeftRadius: 20, borderTopRightRadius: 20,
  },
  gameIcon: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.75)',
  },
  gameTitle: {
    color: skeuo.plum, fontSize: 16, fontWeight: '900',
    fontFamily: 'serif', textAlign: 'center', lineHeight: 20,
  },
  gameSubtitle: {
    color: '#8E8072',
    fontSize: 10,
    fontWeight: '800',
    textAlign: 'center',
  },
  gameCountPill: {
    paddingHorizontal: 9, paddingVertical: 4, borderRadius: 12,
    borderWidth: 1, backgroundColor: '#FFFDF8',
  },
  gameCountText: { fontSize: 9, fontWeight: '900' },

  // Action bar
  actionBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginHorizontal: 14, marginTop: 18, marginBottom: 4,
  },
  actionBarInfo: { flex: 1, gap: 2 },
  actionBarTitle: { color: skeuo.plum, fontSize: 18, fontWeight: '900', fontFamily: 'serif' },
  actionBarSub: { color: '#8E8072', fontSize: 11, fontWeight: '700' },
  createBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, borderWidth: 1,
  },
  createBtnLoading: { opacity: 0.6 },
  createBtnText: { color: '#FFFDF8', fontSize: 12, fontWeight: '900' },

  // Language filter
  filterScroll: { paddingHorizontal: 14, paddingVertical: 10, gap: 7 },
  filterPill: {
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14,
    backgroundColor: '#FFFDF8',
    borderWidth: 1, borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  filterPillActiveCharades: {
    backgroundColor: '#F4E1F7',
    borderColor: '#D8BCE2',
  },
  filterText: { color: '#8E8072', fontSize: 11, fontWeight: '800' },

  // How to play (Ludo)
  howRow: {
    flexDirection: 'row', marginHorizontal: 14, marginTop: 4, marginBottom: 4,
    backgroundColor: '#FFFDF8',
    borderRadius: 16, borderWidth: 1, borderColor: '#C4DDB7',
    paddingVertical: 12,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  howItem: { flex: 1, alignItems: 'center', gap: 4 },
  howLabel: { color: '#6F8E60', fontSize: 9, fontWeight: '800' },

  // Room list
  list: { paddingHorizontal: 14, gap: 10, marginTop: 4 },

  // Empty state
  empty: {
    alignItems: 'center',
    paddingVertical: 34,
    paddingHorizontal: 18,
    gap: 8,
    borderRadius: 22,
    backgroundColor: '#FFFDF8',
    borderWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  emptyEmoji: { fontSize: 42 },
  emptyTitle: { color: skeuo.plum, fontSize: 18, fontWeight: '900', fontFamily: 'serif' },
  emptyText: { color: '#8E8072', fontSize: 12, fontWeight: '700', textAlign: 'center' },
  emptyBtn: {
    marginTop: 6, paddingHorizontal: 22, paddingVertical: 11, borderRadius: 20,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  emptyBtnText: { color: '#FFFDF8', fontSize: 13, fontWeight: '900' },
});
