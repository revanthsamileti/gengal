import React, { useState, useEffect, useRef } from 'react';
import { tap40 } from '../theme/touch';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Modal,
  TextInput,
  ActivityIndicator,
  Animated,
  Share,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import ScreenShell from '../components/ScreenShell';
import TopBar from '../components/TopBar';
import BottomNav from '../components/BottomNav';
import GengalAvatar from '../components/GengalAvatar';
import { skeuo, skeuoGradients } from '../theme/skeuomorphic';
import { auth } from '../config/firebase';
import { useUser } from '../context/UserContext';
import {
  ExpertRoom,
  RoomTier,
  subscribeToActiveRooms,
  createExpertRoom,
  LANGUAGES,
  TOPICS,
} from '../services/expertRoomService';

const HEARTS_REQUIRED = 33;

const TIER_OPTIONS: RoomTier[] = ['Advance', 'VIP'];

const TIER_COLORS: Record<RoomTier, string> = {
  VIP: '#9A1E8A',
  Advance: '#B99916',
  Standard: '#4B6282',
};

const TIER_DESC: Record<RoomTier, string> = {
  Standard: 'Open to all',
  Advance: 'Curated listeners',
  VIP: 'Premium only',
};

type FilterType = RoomTier | 'all';

const FILTERS: Array<{ label: string; value: FilterType }> = [
  { label: 'All Live', value: 'all' },
  { label: 'VIP', value: 'VIP' },
  { label: 'Advance', value: 'Advance' },
];

export default function ClubScreen({ navigate, goBack }: {
  navigate: (screen: string, params?: any) => void;
  goBack?: () => void;
}) {
  const { profile } = useUser();
  const myUid = auth.currentUser?.uid ?? '';

  const [allRooms, setAllRooms] = useState<ExpertRoom[]>([]);
  // Rooms whose host stopped heartbeating are abandoned, whatever `status` says.
  const rooms = useLiveRooms(allRooms);
  // Separates "no live rooms" from "Firestore hasn't answered yet".
  const [roomsLoaded, setRoomsLoaded] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [activeLang, setActiveLang] = useState<string | null>(null);
  const [createModal, setCreateModal] = useState(false);
  const [heartsGate, setHeartsGate] = useState(false);
  const [infoModal, setInfoModal] = useState<{ title: string; msg: string } | null>(null);
  const [creating, setCreating] = useState(false);

  // Create form
  const [topic, setTopic] = useState(TOPICS[0]);
  const [customTopic, setCustomTopic] = useState('');
  const [selectedLang, setSelectedLang] = useState(LANGUAGES[0]);
  const [selectedTier, setSelectedTier] = useState<RoomTier>('Advance');
  const [ratePerMin, setRatePerMin] = useState('60');

  useEffect(() => {
    const tierFilter = activeFilter === 'all' ? undefined : activeFilter;
    const langFilter = activeLang ?? undefined;
    setRoomsLoaded(false);
    const unsub = subscribeToActiveRooms((next) => {
      setAllRooms(next);
      setRoomsLoaded(true);
    }, tierFilter, langFilter);
    return unsub;
  }, [activeFilter, activeLang]);

  const showInfo = (title: string, msg: string) => setInfoModal({ title, msg });

  const handleOpenCreate = () => {
    const hearts = profile?.hearts ?? 0;
    if (hearts < HEARTS_REQUIRED) {
      setHeartsGate(true);
      return;
    }
    setCreateModal(true);
  };

  const handleShareInvite = async () => {
    const finalTopic = customTopic.trim() || topic;
    const nickname = profile?.nickname || profile?.username || 'Host';
    try {
      await Share.share({
        message: `Hey! Join my live matchmaking room on GenGal Club.\nTopic: "${finalTopic}"\nExpert: ${nickname}\n\nSearch for my room in the Club tab!`,
      });
    } catch (e: any) {
      console.warn('Error sharing invite:', e);
    }
  };

  const handleCreateRoom = async () => {
    const finalTopic = customTopic.trim() || topic;
    const rate = parseInt(ratePerMin, 10);
    if (!finalTopic) { showInfo('Topic Required', 'Please choose or type a topic.'); return; }
    if (isNaN(rate) || rate < 10 || rate > 500) { showInfo('Invalid Rate', 'Rate must be 10–500 coins/min.'); return; }
    setCreating(true);
    try {
      const roomId = await createExpertRoom(
        myUid,
        profile?.nickname || profile?.username || 'Host',
        profile?.avatarData || null,
        finalTopic,
        selectedLang,
        selectedTier,
        rate,
      );
      setCreateModal(false);
      navigate('ExpertRoom', { roomId });
    } catch (e: any) {
      showInfo('Error', e.message || 'Could not create room.');
    } finally {
      setCreating(false);
    }
  };

  const tierColor = (tier: RoomTier) => TIER_COLORS[tier] ?? '#4B6282';
  const hearts = profile?.hearts ?? 0;

  return (
    <ScreenShell tone="light">
      <View style={styles.phone}>
        <TopBar navigate={navigate} subtitle="CLUB" />

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

          {/* Hero */}
          <LinearGradient colors={['#2A0128', '#5B0068']} style={styles.hero}>
            <View style={styles.heroRow}>
              {/* "LIVE" only when something is: a live badge over "0 rooms" read as broken. */}
              {rooms.length > 0 ? (
                <View style={styles.livePill}>
                  <View style={styles.liveDot} />
                  <Text style={styles.livePillText}>LIVE</Text>
                </View>
              ) : null}
              <Text style={styles.heroRoomCount}>
                {rooms.length === 0 ? 'No rooms open right now' : `${rooms.length} ${rooms.length === 1 ? 'room' : 'rooms'} open`}
              </Text>
            </View>
            <Text style={styles.heroTitle}>Expert Rooms</Text>
            <Text style={styles.heroSub}>Live coaching · Matchmaking · Community</Text>
          </LinearGradient>

          {/* Filters row — tier + language in one clean strip */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterStrip}
          >
            {FILTERS.map((f) => (
              <TouchableOpacity
                key={f.value}
                style={[styles.filterChip, activeFilter === f.value && styles.filterChipActive]}
                onPress={() => setActiveFilter(f.value)}
              >
                <Text style={[styles.filterText, activeFilter === f.value && styles.filterTextActive]}>
                  {f.label}
                </Text>
              </TouchableOpacity>
            ))}
            <View style={styles.filterDivider} />
            <TouchableOpacity
              style={[styles.filterChip, !activeLang && styles.filterChipLang]}
              onPress={() => setActiveLang(null)}
            >
              <Text style={[styles.filterText, !activeLang && styles.filterTextActive]}>All Lang</Text>
            </TouchableOpacity>
            {LANGUAGES.map((lang) => (
              <TouchableOpacity
                key={lang}
                style={[styles.filterChip, activeLang === lang && styles.filterChipLang]}
                onPress={() => setActiveLang(activeLang === lang ? null : lang)}
              >
                <Text style={[styles.filterText, activeLang === lang && styles.filterTextActive]}>{lang}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Section header */}
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>Live Now</Text>
            {/* Locked until the hearts requirement is met; still tappable so
                it can explain what unlocks hosting. */}
            <TouchableOpacity
              style={[styles.hostBtn, hearts < HEARTS_REQUIRED && styles.hostBtnLocked]}
              onPress={handleOpenCreate}
              accessibilityRole="button"
              accessibilityLabel={hearts < HEARTS_REQUIRED ? 'Host a room, locked' : 'Host a room'}
            >
              <MaterialIcons name={hearts < HEARTS_REQUIRED ? 'lock' : 'add'} size={15} color={hearts < HEARTS_REQUIRED ? '#8A7060' : '#FFF7FF'} />
              <Text style={[styles.hostBtnText, hearts < HEARTS_REQUIRED && styles.hostBtnTextLocked]}>Host</Text>
            </TouchableOpacity>
          </View>

          {/* Hearts bar — compact, under section header */}
          {hearts < HEARTS_REQUIRED && (
            <View style={styles.heartsBar}>
              <MaterialIcons name="favorite" size={12} color="#C9504B" />
              <Text style={styles.heartsBarText}>{Math.min(hearts, HEARTS_REQUIRED)}/{HEARTS_REQUIRED} to host</Text>
              <View style={styles.heartsTrack}>
                <View style={[styles.heartsFill, { width: `${Math.min((hearts / HEARTS_REQUIRED) * 100, 100)}%` as any }]} />
              </View>
            </View>
          )}

          {/* Room list */}
          {!roomsLoaded ? (
            <View style={styles.emptyState}>
              <ActivityIndicator color="#4B0054" />
            </View>
          ) : rooms.length === 0 ? (
            <View style={styles.emptyState}>
              <MaterialIcons name="record-voice-over" size={40} color="#D1B23B" />
              <Text style={styles.emptyTitle}>No live rooms</Text>
              <Text style={styles.emptyText}>
                {hearts >= HEARTS_REQUIRED
                  ? 'Be the first to open a room!'
                  : `Earn ${HEARTS_REQUIRED - Math.min(hearts, HEARTS_REQUIRED)} more hearts to host.`}
              </Text>
              {hearts >= HEARTS_REQUIRED && (
                <TouchableOpacity style={styles.emptyBtn} onPress={handleOpenCreate}>
                  <Text style={styles.emptyBtnText}>Open a Room</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <View style={styles.roomList}>
              {rooms.map((room, i) => (
                <RoomCard key={room.id} room={room} index={i} tierColor={tierColor} navigate={navigate} />
              ))}
            </View>
          )}

        </ScrollView>

        <BottomNav active="Club" navigate={navigate} />

        {/* Hearts Gate Modal */}
        <Modal visible={heartsGate} transparent animationType="fade" onRequestClose={() => setHeartsGate(false)}>
          <View style={styles.overlay}>
            <View style={styles.modalCard}>
              <MaterialIcons name="favorite" size={36} color="#C9504B" style={{ marginBottom: 10 }} />
              <Text style={styles.modalTitle}>Become a Host</Text>
              <Text style={styles.modalSub}>
                You need <Text style={styles.highlight}>{HEARTS_REQUIRED} hearts</Text> to open a room.
                You have <Text style={styles.highlight}>{hearts}</Text>.
              </Text>
              <View style={styles.gateTrack}>
                <View style={[styles.gateFill, { width: `${Math.min((hearts / HEARTS_REQUIRED) * 100, 100)}%` as any }]} />
              </View>
              <Text style={styles.gateHint}>Every 3 minutes of received calls earns 1 heart.</Text>
              <TouchableOpacity style={styles.modalBtn} onPress={() => setHeartsGate(false)}>
                <Text style={styles.modalBtnText}>Got it</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Create Room Modal */}
        <Modal visible={createModal} transparent animationType="slide" onRequestClose={() => setCreateModal(false)}>
          <TouchableOpacity style={styles.sheetOverlay} activeOpacity={1} onPress={() => setCreateModal(false)}>
            <View style={styles.sheet}>
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetTitle}>Open a Room</Text>
              <Text style={styles.sheetSub}>{hearts} ❤️ · Listeners pay per minute</Text>

              <Text style={styles.fieldLabel}>TOPIC</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                {TOPICS.map((t) => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.chip, topic === t && !customTopic && styles.chipActive]}
                    onPress={() => { setTopic(t); setCustomTopic(''); }}
                  >
                    <Text style={[styles.chipText, topic === t && !customTopic && styles.chipTextActive]}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <TextInput
                style={styles.customInput}
                placeholder="Or type a custom topic…"
                placeholderTextColor="#B0A090"
                value={customTopic}
                onChangeText={setCustomTopic}
                maxLength={60}
              />

              <Text style={styles.fieldLabel}>LANGUAGE</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                {LANGUAGES.map((lang) => (
                  <TouchableOpacity
                    key={lang}
                    style={[styles.chip, selectedLang === lang && styles.chipActive]}
                    onPress={() => setSelectedLang(lang)}
                  >
                    <Text style={[styles.chipText, selectedLang === lang && styles.chipTextActive]}>{lang}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={styles.fieldLabel}>TIER</Text>
              <View style={styles.tierRow}>
                {TIER_OPTIONS.map((t) => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.tierChip, selectedTier === t && { backgroundColor: tierColor(t), borderColor: tierColor(t) }]}
                    onPress={() => setSelectedTier(t)}
                  >
                    <Text style={[styles.tierChipLabel, selectedTier === t && { color: '#FFF' }]}>{t}</Text>
                    <Text style={[styles.tierChipDesc, selectedTier === t && { color: 'rgba(255,255,255,0.75)' }]}>{TIER_DESC[t]}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.fieldLabel}>RATE (COINS / MIN)</Text>
              <View style={styles.rateRow}>
                {['30', '60', '100', '150'].map((r) => (
                  <TouchableOpacity
                    key={r}
                    style={[styles.rateChip, ratePerMin === r && styles.rateChipActive]}
                    hitSlop={tap40}
                    onPress={() => setRatePerMin(r)}
                  >
                    <Text style={[styles.rateChipText, ratePerMin === r && styles.rateChipTextActive]}>{r}</Text>
                  </TouchableOpacity>
                ))}
                <TextInput
                  style={styles.rateInput}
                  placeholder="Other"
                  placeholderTextColor="#B0A090"
                  keyboardType="numeric"
                  value={['30', '60', '100', '150'].includes(ratePerMin) ? '' : ratePerMin}
                  onChangeText={setRatePerMin}
                  maxLength={4}
                />
              </View>

              <TouchableOpacity style={styles.shareInviteBtn} onPress={handleShareInvite}>
                <MaterialIcons name="share" size={16} color="#4B0054" />
                <Text style={styles.shareInviteBtnText}>SHARE INVITE LINK</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.goLiveBtn} activeOpacity={0.85} onPress={handleCreateRoom} disabled={creating}>
                <LinearGradient colors={skeuoGradients.plumButton} style={styles.goLiveBtnInner}>
                  {creating ? <ActivityIndicator color="#FFF" /> : (
                    <>
                      <MaterialIcons name="live-tv" size={18} color="#FFFDF8" />
                      <Text style={styles.goLiveBtnText}>GO LIVE</Text>
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>

        {/* Info Modal */}
        <Modal visible={!!infoModal} transparent animationType="fade" onRequestClose={() => setInfoModal(null)}>
          <View style={styles.overlay}>
            <View style={styles.modalCard}>
              <MaterialIcons name="error-outline" size={28} color="#D1B23B" style={{ marginBottom: 10 }} />
              <Text style={styles.modalTitle}>{infoModal?.title}</Text>
              <Text style={styles.modalSub}>{infoModal?.msg}</Text>
              <TouchableOpacity style={styles.modalBtn} onPress={() => setInfoModal(null)}>
                <Text style={styles.modalBtnText}>Got it</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>
    </ScreenShell>
  );
}

function RoomCard({ room, index, tierColor, navigate }: {
  room: ExpertRoom;
  index: number;
  tierColor: (t: RoomTier) => string;
  navigate: (s: string, p?: any) => void;
}) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 350, delay: index * 70, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 350, delay: index * 70, useNativeDriver: true }),
    ]).start();
  }, []);

  const tc = tierColor(room.tier);

  return (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
      <TouchableOpacity
        style={styles.roomCard}
        activeOpacity={0.88}
        accessibilityRole="button"
        accessibilityLabel={
          `${room.hostNickname}'s room. ${room.topic}. ${room.tier}, ${room.language}, ` +
          `${room.activeMemberCount} here. ` +
          (room.ratePerMin > 0 ? `Costs ${room.ratePerMin} coins a minute.` : 'Free to join.')
        }
        onPress={() => navigate('ExpertRoom', { roomId: room.id })}
      >
        <LinearGradient colors={['#1A0714', '#3B0044']} style={StyleSheet.absoluteFill} />

        <View style={styles.roomInner}>
          {/* Left: avatar */}
          <View style={[styles.hostRing, { borderColor: tc }]}>
            <GengalAvatar data={room.hostAvatarData} size={46} />
            <View style={styles.hostDot} />
          </View>

          {/* Center: info */}
          <View style={styles.roomInfo}>
            <Text style={styles.roomHost} numberOfLines={1}>{room.hostNickname}</Text>
            <Text style={styles.roomTopic} numberOfLines={2}>{room.topic}</Text>
            {/* Who is actually in there right now, from the host's roster preview. */}
            <RosterStrip roster={room.roster} count={room.activeMemberCount} tone="dark" />
            <View style={styles.roomMeta}>
              <View style={[styles.tierPill, { borderColor: tc + '60', backgroundColor: tc + '22' }]}>
                <Text style={[styles.tierText, { color: tc }]}>{room.tier}</Text>
              </View>
              <View style={styles.langPill}>
                <Text style={styles.langPillText}>{room.language}</Text>
              </View>
              <View style={styles.statPill}>
                <MaterialIcons name="people" size={10} color="#EADCA8" />
                <Text style={[styles.statText, tabular]}>{room.activeMemberCount}</Text>
              </View>
              <View style={[styles.ratePill, room.ratePerMin > 0 && styles.ratePillPaid]}>
                <MaterialIcons
                  name={room.ratePerMin > 0 ? 'stars' : 'lock-open'}
                  size={10}
                  color={room.ratePerMin > 0 ? '#F7B500' : '#8FD98F'}
                />
                <Text
                  style={[styles.rateText, tabular, room.ratePerMin > 0 && styles.rateTextPaid]}
                >
                  {room.ratePerMin > 0 ? `${room.ratePerMin}/min` : 'Free'}
                </Text>
              </View>
            </View>
          </View>

          {/* Right: join */}
          <View style={styles.joinBtn}>
            <MaterialIcons name="headset-mic" size={15} color="#FFF" />
            <Text style={styles.joinBtnText}>Join</Text>
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

import type { TextStyle } from 'react-native';
import { useLiveRooms } from '../hooks/useRoomPresence';
import RosterStrip from '../components/rooms/RosterStrip';

const tabular: TextStyle = { fontVariant: ['tabular-nums'] };

const styles = StyleSheet.create({
  ratePill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8,
    borderWidth: 1, borderColor: 'rgba(143, 217, 143, 0.4)',
    backgroundColor: 'rgba(143, 217, 143, 0.14)',
  },
  ratePillPaid: {
    borderColor: 'rgba(247, 181, 0, 0.45)',
    backgroundColor: 'rgba(247, 181, 0, 0.16)',
  },
  rateText: { color: '#8FD98F', fontSize: 9, fontWeight: '900' },
  rateTextPaid: { color: '#F7B500' },
  phone: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: 430 },
  scroll: { paddingBottom: 110 },

  // Hero
  hero: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 22,
    padding: 20,
    paddingBottom: 22,
  },
  heroRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12, minHeight: 26 },
  livePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,253,248,0.15)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#5EBB62' },
  livePillText: { color: '#FFFDF8', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  heroRoomCount: { color: 'rgba(255,253,248,0.6)', fontSize: 11, fontWeight: '700' },
  heroTitle: { color: '#FFFDF8', fontSize: 26, fontWeight: '900', fontFamily: 'serif', marginBottom: 4 },
  heroSub: { color: 'rgba(255,253,248,0.65)', fontSize: 12, fontWeight: '600' },

  // Filters
  filterStrip: { paddingHorizontal: 16, paddingVertical: 14, gap: 8 },
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16,
    backgroundColor: '#FFFDF8', borderWidth: 1, borderColor: '#EEE4D8',
  },
  filterChipActive: { backgroundColor: '#4B0054', borderColor: '#4B0054' },
  filterChipLang: { backgroundColor: '#9A1E8A', borderColor: '#9A1E8A' },
  filterText: { color: '#8A7060', fontSize: 12, fontWeight: '800' },
  filterTextActive: { color: '#FFF' },
  filterDivider: { width: 1, backgroundColor: '#EEE4D8', marginVertical: 4 },

  // Section header
  sectionRow: {
    paddingHorizontal: 16, marginBottom: 10,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  sectionTitle: { color: '#2A0128', fontSize: 20, fontWeight: '900', fontFamily: 'serif' },
  hostBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#4B0054', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 14,
  },
  hostBtnText: { color: '#FFF7FF', fontSize: 12, fontWeight: '700' },
  hostBtnLocked: { backgroundColor: '#F3EDE4', borderWidth: 1, borderColor: '#E2D6C4' },
  hostBtnTextLocked: { color: '#8A7060' },

  // Hearts bar
  heartsBar: {
    marginHorizontal: 16, marginBottom: 12,
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  heartsBarText: { color: '#7F6808', fontSize: 11, fontWeight: '700' },
  heartsTrack: { flex: 1, height: 4, borderRadius: 2, backgroundColor: '#EEE4D8', overflow: 'hidden' },
  heartsFill: { height: '100%', borderRadius: 2, backgroundColor: '#C9504B' },

  // Empty state
  emptyState: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 32 },
  emptyTitle: { color: '#4B0054', fontSize: 18, fontWeight: '900', fontFamily: 'serif', marginTop: 12, marginBottom: 6 },
  emptyText: { color: '#8A7C70', fontSize: 13, fontWeight: '600', textAlign: 'center', lineHeight: 19, marginBottom: 20 },
  emptyBtn: { backgroundColor: '#4B0054', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 20 },
  emptyBtnText: { color: '#FFF', fontWeight: '900', fontSize: 13 },

  // Room cards
  roomList: { paddingHorizontal: 16, gap: 10 },
  roomCard: {
    borderRadius: 20, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(209,178,59,0.15)',
    boxShadow: Platform.OS === 'web' ? skeuo.deepShadow : undefined,
  },
  roomInner: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  hostRing: { width: 54, height: 54, borderRadius: 27, borderWidth: 2, overflow: 'hidden', flexShrink: 0, position: 'relative' },
  hostDot: {
    position: 'absolute', bottom: 2, right: 2,
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: '#5EBB62', borderWidth: 1.5, borderColor: '#1A0714',
  },
  roomInfo: { flex: 1 },
  roomHost: { color: '#FFFDF8', fontSize: 15, fontWeight: '900', marginBottom: 2 },
  roomTopic: { color: '#EADCA8', fontSize: 11, fontWeight: '600', lineHeight: 16, marginBottom: 7 },
  roomMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  tierPill: {
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, borderWidth: 1,
  },
  tierText: { fontSize: 9, fontWeight: '900', textTransform: 'uppercase' },
  langPill: {
    backgroundColor: 'rgba(234,220,168,0.15)', paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: 8, borderWidth: 1, borderColor: 'rgba(234,220,168,0.3)',
  },
  langPillText: { color: '#EADCA8', fontSize: 9, fontWeight: '800' },
  statPill: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  statText: { color: '#EADCA8', fontSize: 10, fontWeight: '700' },
  joinBtn: {
    flexDirection: 'column', alignItems: 'center', gap: 2,
    backgroundColor: '#4B0054', paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', flexShrink: 0,
  },
  joinBtnText: { color: '#FFF', fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },

  // Modals shared
  overlay: {
    flex: 1, backgroundColor: 'rgba(26,7,22,0.7)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  modalCard: {
    width: '100%', maxWidth: 320, backgroundColor: '#FFFCF7',
    borderRadius: 24, padding: 24, alignItems: 'center',
    boxShadow: Platform.OS === 'web' ? '0 20px 40px rgba(0,0,0,0.35)' : undefined,
  },
  modalTitle: { color: '#4B0054', fontSize: 20, fontWeight: '900', fontFamily: 'serif', textAlign: 'center', marginBottom: 8 },
  modalSub: { color: '#7F6808', fontSize: 13, fontWeight: '600', textAlign: 'center', lineHeight: 20, marginBottom: 14 },
  highlight: { color: '#C9504B', fontWeight: '900' },
  gateTrack: { width: '100%', height: 7, borderRadius: 4, backgroundColor: '#EEE4D8', overflow: 'hidden', marginBottom: 12 },
  gateFill: { height: '100%', borderRadius: 4, backgroundColor: '#C9504B' },
  gateHint: { color: '#8A7C70', fontSize: 12, fontWeight: '600', textAlign: 'center', lineHeight: 18, marginBottom: 18 },
  modalBtn: {
    width: '100%', height: 46, borderRadius: 23,
    backgroundColor: '#4B0054', justifyContent: 'center', alignItems: 'center',
  },
  modalBtnText: { color: '#FFFDF8', fontSize: 14, fontWeight: '700' },

  // Create sheet
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(26,7,22,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#FFFDF8', borderTopLeftRadius: 26, borderTopRightRadius: 26,
    padding: 22, paddingBottom: 44, maxHeight: '92%',
  },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#DDD5CB', alignSelf: 'center', marginBottom: 18 },
  sheetTitle: { color: '#4B0054', fontSize: 22, fontWeight: '900', fontFamily: 'serif', textAlign: 'center', marginBottom: 4 },
  sheetSub: { color: '#8A7C70', fontSize: 12, fontWeight: '600', textAlign: 'center', marginBottom: 14 },
  fieldLabel: { color: '#7F7068', fontSize: 9, fontWeight: '900', letterSpacing: 0.5, marginBottom: 8, marginTop: 14 },
  chipRow: { gap: 8, paddingBottom: 2 },
  chip: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 14, backgroundColor: '#F8F5EF', borderWidth: 1, borderColor: '#EEE4D8' },
  chipActive: { backgroundColor: '#4B0054', borderColor: '#4B0054' },
  chipText: { color: '#7F6808', fontSize: 12, fontWeight: '800' },
  chipTextActive: { color: '#FFF' },
  customInput: {
    marginTop: 8, height: 42, borderRadius: 12, paddingHorizontal: 13,
    backgroundColor: '#F8F5EF', borderWidth: 1, borderColor: '#EEE4D8',
    color: '#3D3441', fontSize: 13, fontWeight: '600',
  },
  tierRow: { flexDirection: 'row', gap: 8 },
  tierChip: { flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center', backgroundColor: '#F8F5EF', borderWidth: 1, borderColor: '#EEE4D8' },
  tierChipLabel: { color: '#7F6808', fontSize: 12, fontWeight: '900' },
  tierChipDesc: { color: '#A19891', fontSize: 9, fontWeight: '700', marginTop: 2 },
  rateRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  rateChip: { width: 48, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8F5EF', borderWidth: 1, borderColor: '#EEE4D8' },
  rateChipActive: { backgroundColor: '#4B0054', borderColor: '#4B0054' },
  rateChipText: { color: '#7F6808', fontSize: 13, fontWeight: '900' },
  rateChipTextActive: { color: '#FFF' },
  rateInput: { flex: 1, height: 40, borderRadius: 10, paddingHorizontal: 12, backgroundColor: '#F8F5EF', borderWidth: 1, borderColor: '#EEE4D8', color: '#3D3441', fontSize: 14, fontWeight: '700' },
  goLiveBtn: { marginTop: 20, borderRadius: 20, overflow: 'hidden', boxShadow: Platform.OS === 'web' ? '0 10px 20px rgba(75,0,84,0.28)' : undefined },
  goLiveBtnInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 15 },
  goLiveBtnText: { color: '#FFFDF8', fontSize: 14, fontWeight: '900', letterSpacing: 3 },
  shareInviteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 18, paddingVertical: 12, borderRadius: 14,
    backgroundColor: '#F8F5EF', borderWidth: 1, borderColor: '#4B0054',
  },
  shareInviteBtnText: { color: '#4B0054', fontSize: 12, fontWeight: '900', letterSpacing: 1 },
});
