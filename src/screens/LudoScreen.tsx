import { Alert } from '../components/CustomAlert';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import Svg, { Circle, Defs, Ellipse, LinearGradient as SvgGradient, Path, Stop } from 'react-native-svg';

import BottomNav from '../components/BottomNav';
import GengalAvatar from '../components/GengalAvatar';
import ScreenShell from '../components/ScreenShell';
import TopBar from '../components/TopBar';
import { useUser } from '../context/UserContext';
import { auth } from '../config/firebase';
import {
  createLudoRoom, joinLudoRoom, LudoRoom, subscribeToLudoRooms, TokenColor,
} from '../services/ludoService';
import { deductUserCoins } from '../services/coinService';
import { GEMS, ludo, numeric } from '../theme/ludoTheme';
import { skeuo } from '../theme/skeuomorphic';
import { useLiveRooms } from '../hooks/useRoomPresence';

interface Props {
  navigate: (screen: string, params?: any) => void;
  goBack?: () => void;
}

const TABLE_COST = 10;

/** Board order, clockwise from the top-left seat — same as the table itself. */
const SEAT_ORDER: TokenColor[] = ['red', 'blue', 'green', 'yellow'];

const MODES: {
  id: 'per_game' | 'per_token';
  name: string;
  cost: string;
  detail: string;
  icon: string;
}[] = [
  {
    id: 'per_game',
    name: 'Ticket table',
    cost: '50 coins a seat',
    detail: 'Players pay once to sit down. You keep 10% of every ticket.',
    icon: 'confirmation-number',
  },
  {
    id: 'per_token',
    name: 'Roll & back',
    cost: '15 coins a roll',
    detail: 'Free to sit. Players pay per roll and watchers back a colour.',
    icon: 'casino',
  },
];

/** The same pawn silhouette as the board, so both screens share a vocabulary. */
function Pawn({ color, size = 22 }: { color: TokenColor; size?: number }) {
  const c = GEMS[color];
  return (
    <Svg width={size} height={size * (44 / 40)} viewBox="0 0 40 44">
      <Defs>
        <SvgGradient id={`lp-${color}`} x1="0.2" y1="0" x2="0.85" y2="1">
          <Stop offset="0" stopColor={c.light} />
          <Stop offset="0.45" stopColor={c.core} />
          <Stop offset="1" stopColor={c.dark} />
        </SvgGradient>
      </Defs>
      <Ellipse cx="20" cy="39.5" rx="12" ry="3.2" fill="#000" opacity="0.18" />
      <Path
        d="M20 15 C25.5 15 29 21 30.5 28 C31.8 34 29 38.5 20 38.5 C11 38.5 8.2 34 9.5 28 C11 21 14.5 15 20 15 Z"
        fill={`url(#lp-${color})`} stroke={c.dark} strokeWidth="1.6" strokeLinejoin="round"
      />
      <Circle cx="20" cy="11" r="8" fill={`url(#lp-${color})`} stroke={c.dark} strokeWidth="1.6" />
      <Ellipse cx="16.6" cy="8.2" rx="3.1" ry="3.6" fill="#FFFFFF" opacity="0.55" transform="rotate(-20 16.6 8.2)" />
    </Svg>
  );
}

function TableCard({
  room, onOpen, busy,
}: { room: LudoRoom; onOpen: () => void; busy: boolean }) {
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fade, {
      toValue: 1, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true,
    }).start();
  }, [fade]);

  const seated = room.players.length;
  const open = seated < 4 && room.phase === 'waiting';
  const host = room.players.find((p) => p.uid === room.hostUid) ?? room.players[0];

  return (
    <Animated.View style={{ opacity: fade }}>
      <Pressable
        onPress={onOpen}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={
          `${host?.nickname ?? 'Host'}'s table, ${seated} of 4 seated. ${open ? 'Join' : 'Watch'}.`
        }
        style={({ pressed }) => [cardStyles.card, pressed && cardStyles.pressed]}
      >
        <View style={cardStyles.head}>
          <View style={cardStyles.avatar}>
            <GengalAvatar data={host?.avatarData} size={40} />
          </View>
          <View style={cardStyles.headMeta}>
            <Text style={cardStyles.host} numberOfLines={1}>{host?.nickname ?? 'Host'}</Text>
            <Text style={[cardStyles.headSub, numeric]}>
              {room.gameMode === 'per_token' ? 'Roll & back' : 'Ticket table'} · {seated}/4
            </Text>
          </View>
          <View style={[cardStyles.status, room.phase === 'playing' && cardStyles.statusLive]}>
            {room.phase === 'playing' && <View style={cardStyles.liveDot} />}
            <Text style={[cardStyles.statusText, room.phase === 'playing' && cardStyles.statusTextLive]}>
              {room.phase === 'playing' ? 'Playing' : 'Open'}
            </Text>
          </View>
        </View>

        {/* Seat strip mirrors the board's clockwise order. */}
        <View style={cardStyles.seats}>
          {SEAT_ORDER.map((color) => {
            const p = room.players.find((pl) => pl.color === color);
            return (
              <View key={color} style={[cardStyles.seat, !p && cardStyles.seatOpen]}>
                <Pawn color={color} size={13} />
                <Text style={cardStyles.seatName} numberOfLines={1}>
                  {p ? p.nickname : 'Open'}
                </Text>
              </View>
            );
          })}
        </View>

        <View style={cardStyles.foot}>
          <View style={cardStyles.watchers}>
            <MaterialIcons name="visibility" size={13} color="#8B7A6A" />
            <Text style={[cardStyles.watchersText, numeric]}>
              {Math.max(0, (room.presentCount ?? room.players.length) - room.players.length)} watching
            </Text>
          </View>
          <View style={[cardStyles.cta, busy && cardStyles.ctaBusy]}>
            {busy ? (
              <ActivityIndicator size="small" color="#FFFDF8" />
            ) : (
              <>
                <MaterialIcons name={open ? 'login' : 'visibility'} size={14} color="#FFFDF8" />
                <Text style={cardStyles.ctaText}>{open ? 'Take a seat' : 'Watch'}</Text>
              </>
            )}
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

export default function LudoScreen({ navigate }: Props) {
  const { profile } = useUser();
  const myUid = auth.currentUser?.uid ?? '';
  const myName = profile?.nickname || profile?.username || 'Guest';
  const myAvatarData = profile?.avatarData;

  const [allRooms, setAllRooms] = useState<LudoRoom[]>([]);
  // Tables whose host stopped heartbeating are abandoned, whatever `status` says.
  const rooms = useLiveRooms(allRooms);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [modeSheet, setModeSheet] = useState(false);

  useEffect(() => subscribeToLudoRooms(setAllRooms), []);

  const handleCreate = useCallback(async (mode: 'per_game' | 'per_token') => {
    if ((profile?.coins ?? 0) < TABLE_COST) {
      Alert.alert('Not enough coins', `Opening a table costs ${TABLE_COST} coins. Top up in the store.`);
      return;
    }
    setModeSheet(false);
    setCreating(true);
    try {
      await deductUserCoins(myUid, TABLE_COST);
      const roomId = await createLudoRoom(myUid, myName, myAvatarData, mode);
      navigate('LudoBoard', { roomId });
    } catch (e: any) {
      Alert.alert('Could not open a table', e?.message || 'Try again in a moment.');
    } finally {
      setCreating(false);
    }
  }, [profile, myUid, myName, myAvatarData, navigate]);

  const handleOpen = useCallback(async (room: LudoRoom) => {
    if (!room.id || openingId) return;
    setOpeningId(room.id);
    try {
      const { joined } = await joinLudoRoom(room.id, myUid, myName, myAvatarData);
      // joined is false only when the table no longer exists -- a lobby
      // card that outlived its room. Doing nothing here left the button
      // spinning and then simply stopping, with no screen and no reason.
      if (!joined) {
        Alert.alert('That table is gone', 'It closed before you could join. Try another one.');
        return;
      }
      navigate('LudoBoard', { roomId: room.id });
    } catch (e: any) {
      Alert.alert('Could not open that table', e?.message || 'Try again in a moment.');
    } finally {
      setOpeningId(null);
    }
  }, [myUid, myName, myAvatarData, navigate, openingId]);

  return (
    <ScreenShell tone="light">
      <View style={styles.phone}>
        <TopBar navigate={navigate} subtitle="LUDO" />

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* The table itself is the hero — a lit board on the felt. */}
          <View style={styles.hero}>
            <LinearGradient
              colors={['#FFFFFF', '#FFFFFF']}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.heroGems}>
              {SEAT_ORDER.map((c) => (
                <Pawn key={c} color={c} size={30} />
              ))}
            </View>
            <Text style={styles.heroTitle}>Four stones, one board</Text>
            <Text style={styles.heroBody}>
              Open a table, call your friends in, and play with voice on.
            </Text>
            <Pressable
              onPress={() => setModeSheet(true)}
              disabled={creating}
              accessibilityRole="button"
              accessibilityLabel={`Open a table, costs ${TABLE_COST} coins`}
              style={({ pressed }) => [styles.heroBtn, pressed && styles.pressed, creating && styles.pressed]}
            >
              {creating ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <MaterialIcons name="add" size={18} color="#FFFFFF" />
                  <Text style={[styles.heroBtnText, numeric]}>Open a table · {TABLE_COST}</Text>
                </>
              )}
            </Pressable>
          </View>

          <Text style={styles.section}>
            {rooms.length > 0
              ? `${rooms.length} table${rooms.length > 1 ? 's' : ''} live`
              : 'No tables live'}
          </Text>

          {rooms.length === 0 ? (
            <View style={styles.empty}>
              <View style={styles.emptyGems}>
                {SEAT_ORDER.map((c) => <Pawn key={c} color={c} size={20} />)}
              </View>
              <Text style={styles.emptyTitle}>Nobody is playing yet</Text>
              <Text style={styles.emptyBody}>Open the first table and invite your friends.</Text>
            </View>
          ) : (
            <View style={styles.list}>
              {rooms.map((room) => (
                <TableCard
                  key={room.id}
                  room={room}
                  onOpen={() => handleOpen(room)}
                  busy={openingId === room.id}
                />
              ))}
            </View>
          )}

          <View style={{ height: 110 }} />
        </ScrollView>

        {/* Mode picker */}
        <Modal visible={modeSheet} transparent animationType="slide" onRequestClose={() => setModeSheet(false)}>
          <View style={styles.sheetRoot}>
            <Pressable
              style={styles.scrim}
              onPress={() => setModeSheet(false)}
              accessibilityLabel="Close"
            />
            <View style={styles.sheet}>
              <View style={styles.grip} />
              <Text style={styles.sheetTitle}>How should this table pay?</Text>
              <Text style={styles.sheetBody}>
                Opening costs {TABLE_COST} coins. You earn 10% of what the table spends.
              </Text>

              {MODES.map((m) => (
                <Pressable
                  key={m.id}
                  onPress={() => handleCreate(m.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`${m.name}. ${m.cost}. ${m.detail}`}
                  style={({ pressed }) => [styles.mode, pressed && styles.pressed]}
                >
                  <View style={styles.modeIcon}>
                    <MaterialIcons name={m.icon as any} size={20} color={ludo.ink} />
                  </View>
                  <View style={styles.modeMeta}>
                    <View style={styles.modeHead}>
                      <Text style={styles.modeName}>{m.name}</Text>
                      <Text style={[styles.modeCost, numeric]}>{m.cost}</Text>
                    </View>
                    <Text style={styles.modeDetail}>{m.detail}</Text>
                  </View>
                  <MaterialIcons name="chevron-right" size={20} color="#B9A78F" />
                </Pressable>
              ))}
            </View>
          </View>
        </Modal>

        {/* Ludo is reached through the Chill games hub, so that tab stays lit. */}
        <BottomNav active="Chill" navigate={navigate} />
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  phone: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: 430 },
  scroll: { paddingBottom: 24 },
  pressed: { opacity: 0.75 },

  hero: {
    marginHorizontal: 14,
    marginTop: 14,
    borderRadius: 24,
    paddingVertical: 26,
    paddingHorizontal: 22,
    alignItems: 'center',
    gap: 10,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: ludo.frame,
    boxShadow: Platform.OS === 'web' ? skeuo.deepShadow : undefined,
  },
  heroGems: { flexDirection: 'row', gap: 14, marginBottom: 4, alignItems: 'flex-end' },
  heroTitle: {
    fontFamily: 'serif',
    fontSize: 26,
    fontWeight: '900',
    color: ludo.ink,
    textAlign: 'center',
  },
  heroBody: {
    color: ludo.inkSoft,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 19,
    maxWidth: 260,
  },
  heroBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    height: 46,
    paddingHorizontal: 22,
    borderRadius: 23,
    backgroundColor: ludo.ink,
  },
  heroBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },

  section: {
    color: '#8B7A6A',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginHorizontal: 16,
    marginTop: 22,
    marginBottom: 10,
  },
  list: { paddingHorizontal: 14, gap: 10 },

  empty: {
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 14,
    paddingVertical: 32,
    paddingHorizontal: 20,
    borderRadius: 22,
    backgroundColor: skeuo.surfaceRaised,
    borderWidth: 1,
    borderColor: skeuo.border,
  },
  emptyGems: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  emptyTitle: { color: skeuo.plum, fontSize: 17, fontWeight: '900', fontFamily: 'serif' },
  emptyBody: { color: '#8B7A6A', fontSize: 12, fontWeight: '700', textAlign: 'center' },

  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  scrim: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(28,28,28,0.5)' },
  sheet: {
    backgroundColor: skeuo.surfaceRaised,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 30,
    gap: 10,
  },
  grip: { width: 38, height: 4, borderRadius: 2, backgroundColor: skeuo.border, alignSelf: 'center', marginBottom: 6 },
  sheetTitle: { color: skeuo.plum, fontSize: 19, fontWeight: '900', fontFamily: 'serif' },
  sheetBody: { color: '#8B7A6A', fontSize: 12, fontWeight: '700', lineHeight: 17, marginBottom: 4 },
  mode: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: skeuo.border,
    backgroundColor: skeuo.surface,
  },
  modeIcon: {
    width: 40, height: 40, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: ludo.cardSunk,
  },
  modeMeta: { flex: 1, gap: 3 },
  modeHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  modeName: { color: skeuo.plum, fontSize: 15, fontWeight: '900' },
  modeCost: { color: ludo.inkSoft, fontSize: 11, fontWeight: '800' },
  modeDetail: { color: '#8B7A6A', fontSize: 11, fontWeight: '600', lineHeight: 16 },
});

const cardStyles = StyleSheet.create({
  card: {
    borderRadius: 20,
    padding: 14,
    gap: 12,
    backgroundColor: skeuo.surfaceRaised,
    borderWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  pressed: { opacity: 0.82 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
    backgroundColor: skeuo.surfaceInset,
    borderWidth: 1.5, borderColor: ludo.hairline,
  },
  headMeta: { flex: 1, gap: 2 },
  host: { color: skeuo.plum, fontSize: 14, fontWeight: '900' },
  headSub: { color: '#8B7A6A', fontSize: 11, fontWeight: '700' },
  status: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 9, paddingVertical: 5, borderRadius: 11,
    borderWidth: 1, borderColor: skeuo.border, backgroundColor: skeuo.surface,
  },
  statusLive: { borderColor: 'rgba(56,168,28,0.42)', backgroundColor: 'rgba(56,168,28,0.10)' },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: GEMS.green.core },
  statusText: { color: '#8B7A6A', fontSize: 9, fontWeight: '900', letterSpacing: 0.4 },
  statusTextLive: { color: GEMS.green.dark },
  seats: { flexDirection: 'row', gap: 6 },
  seat: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 7, paddingVertical: 7, borderRadius: 10,
    backgroundColor: skeuo.surface, borderWidth: 1, borderColor: skeuo.border,
  },
  seatOpen: { borderStyle: 'dashed', borderColor: '#D8C7AC' },
  seatName: { color: '#7E7368', fontSize: 9, fontWeight: '800', flex: 1 },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  watchers: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  watchersText: { color: '#8B7A6A', fontSize: 10, fontWeight: '700' },
  cta: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, height: 36, borderRadius: 18,
    justifyContent: 'center', minWidth: 112,
    backgroundColor: skeuo.plum,
  },
  ctaBusy: { opacity: 0.7 },
  ctaText: { color: '#FFFDF8', fontSize: 12, fontWeight: '900' },
});
