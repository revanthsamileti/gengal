import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import BottomNav from '../components/BottomNav';
import GengalAvatar from '../components/GengalAvatar';
import ScreenShell from '../components/ScreenShell';
import TopBar from '../components/TopBar';
import { useUser } from '../context/UserContext';
import { auth } from '../config/firebase';
import {
  createLudoRoom,
  joinLudoRoom,
  LudoRoom,
  subscribeToLudoRooms,
  TOKEN_COLORS,
  TokenColor,
} from '../services/ludoService';
import { skeuo } from '../theme/skeuomorphic';

interface Props {
  navigate: (screen: string, params?: any) => void;
  goBack?: () => void;
}

const COLOR_HEX: Record<TokenColor, string> = {
  red: '#C9504B',
  blue: '#0891B2',
  green: '#5EBB62',
  yellow: '#D4B142',
};

function RoomCard({ room, onJoin, loading }: { room: LudoRoom; onJoin: () => void; loading: boolean }) {
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 280, useNativeDriver: true }).start();
  }, [fade]);

  const slotsFilled = room.players.length;
  const canJoin = slotsFilled < 4 && room.phase === 'waiting';

  return (
    <Animated.View style={{ opacity: fade }}>
      <TouchableOpacity style={cardStyles.card} activeOpacity={0.84} onPress={onJoin}>
        <LinearGradient colors={['#FFFFFF', '#FFF8EA', '#EDF8E8']} style={StyleSheet.absoluteFill} />

        <View style={cardStyles.hostRow}>
          <View style={cardStyles.avatarWrap}>
            <GengalAvatar data={room.players[0]?.avatarData} size={44} />
          </View>
          <View style={cardStyles.hostInfo}>
            <Text style={cardStyles.hostName} numberOfLines={1}>{room.players[0]?.nickname ?? 'Host'}</Text>
            <Text style={cardStyles.hostSub}>Hosting · {slotsFilled}/4 players</Text>
          </View>
          <View style={[cardStyles.phasePill, room.phase === 'playing' && cardStyles.phasePillLive]}>
            {room.phase === 'playing' ? <View style={cardStyles.liveDot} /> : null}
            <Text style={[cardStyles.phaseText, room.phase === 'playing' && cardStyles.phaseTextLive]}>
              {room.phase === 'waiting' ? 'Lobby' : 'In Game'}
            </Text>
          </View>
        </View>

        <View style={cardStyles.colorRow}>
          {TOKEN_COLORS.map((color) => {
            const player = room.players.find((p) => p.color === color);
            return (
              <View key={color} style={[cardStyles.colorSlot, { borderColor: COLOR_HEX[color] + '55' }]}>
                <View style={[cardStyles.colorDot, { backgroundColor: COLOR_HEX[color] }]} />
                <Text style={cardStyles.colorSlotText} numberOfLines={1}>{player ? player.nickname : 'Open'}</Text>
              </View>
            );
          })}
        </View>

        <View style={cardStyles.footer}>
          <View style={cardStyles.specRow}>
            <MaterialIcons name="visibility" size={13} color="#8B7A6A" />
            <Text style={cardStyles.specText}>{room.spectatorCount} watching</Text>
          </View>
          <TouchableOpacity style={[cardStyles.joinBtn, loading && cardStyles.joinBtnDisabled]} onPress={onJoin} disabled={loading}>
            {loading ? (
              <ActivityIndicator size="small" color="#FFFDF8" />
            ) : (
              <>
                <MaterialIcons name={canJoin ? 'login' : 'visibility'} size={14} color="#FFFDF8" />
                <Text style={cardStyles.joinText}>{canJoin ? 'Join Table' : 'Watch'}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#D8E8CF',
    padding: 14,
    gap: 12,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  hostRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatarWrap: {
    width: 50,
    height: 50,
    borderRadius: 25,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#C4DDB7',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFDF8',
  },
  hostInfo: { flex: 1, gap: 2 },
  hostName: { color: skeuo.plum, fontSize: 14, fontWeight: '900' },
  hostSub: { color: '#8B7A6A', fontSize: 10, fontWeight: '700' },
  phasePill: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D8E8CF',
    backgroundColor: '#F4FAF0',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  phasePillLive: { borderColor: '#B9DAA6', backgroundColor: '#EAF7E3' },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#4E8E32' },
  phaseText: { color: '#7B8B72', fontSize: 9, fontWeight: '900', letterSpacing: 0.4 },
  phaseTextLive: { color: '#3F7D2B' },
  colorRow: { flexDirection: 'row', gap: 6 },
  colorSlot: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: '#FFFDF8',
  },
  colorDot: { width: 7, height: 7, borderRadius: 4 },
  colorSlotText: { color: '#7E7368', fontSize: 9, fontWeight: '800', flex: 1 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  specRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  specText: { color: '#8B7A6A', fontSize: 10, fontWeight: '700' },
  joinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 16,
    backgroundColor: '#4E8E32',
    borderWidth: 1,
    borderColor: '#C4DDB7',
  },
  joinBtnDisabled: { opacity: 0.55 },
  joinText: { color: '#FFFDF8', fontSize: 12, fontWeight: '900' },
});

export default function LudoScreen({ navigate }: Props) {
  const { profile } = useUser();
  const myUid = auth.currentUser?.uid ?? '';
  const myName = profile?.nickname || profile?.username || 'Guest';
  const myAvatarData = profile?.avatarData;

  const [rooms, setRooms] = useState<LudoRoom[]>([]);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const unsub = subscribeToLudoRooms(setRooms);
    return unsub;
  }, []);

  const handleCreate = useCallback(async () => {
    setCreating(true);
    try {
      const roomId = await createLudoRoom(myUid, myName, myAvatarData);
      navigate('LudoBoard', { roomId });
    } finally {
      setCreating(false);
    }
  }, [myUid, myName, myAvatarData, navigate]);

  const handleJoin = useCallback(async (room: LudoRoom) => {
    if (!room.id || joiningId) return;
    setJoiningId(room.id);
    try {
      const { joined } = await joinLudoRoom(room.id, myUid, myName, myAvatarData);
      if (joined) navigate('LudoBoard', { roomId: room.id });
    } finally {
      setJoiningId(null);
    }
  }, [myUid, myName, myAvatarData, navigate, joiningId]);

  return (
    <ScreenShell tone="light">
      <View style={styles.phone}>
        <TopBar navigate={navigate} subtitle="LUDO LIVE" />

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <LinearGradient colors={['#FFFFFF', '#FFF7E2', '#EAF7E3']} style={styles.hero}>
            <View style={styles.boardPreview}>
              {TOKEN_COLORS.map((color) => (
                <View key={color} style={[styles.previewQuadrant, { backgroundColor: COLOR_HEX[color] + '22', borderColor: COLOR_HEX[color] + '66' }]}>
                  <View style={[styles.previewPawn, { backgroundColor: COLOR_HEX[color] }]} />
                </View>
              ))}
              <View style={styles.previewCenter}>
                <MaterialIcons name="casino" size={23} color="#8B6F09" />
              </View>
            </View>
            <Text style={styles.heroTitle}>Ludo Live</Text>
            <Text style={styles.heroSub}>Create a relaxed premium table, roll dice, and play with friends.</Text>

            <TouchableOpacity style={[styles.createBtn, creating && styles.createBtnLoading]} onPress={handleCreate} disabled={creating} activeOpacity={0.84}>
              {creating ? (
                <ActivityIndicator color="#4A3600" size="small" />
              ) : (
                <>
                  <MaterialIcons name="add-circle" size={19} color="#4A3600" />
                  <Text style={styles.createBtnText}>Create Table</Text>
                </>
              )}
            </TouchableOpacity>
          </LinearGradient>

          <View style={styles.howRow}>
            {[
              { icon: 'casino', label: 'Roll' },
              { icon: 'touch-app', label: 'Tap token' },
              { icon: 'emoji-events', label: 'Win coins' },
            ].map((item) => (
              <View key={item.label} style={styles.howItem}>
                <MaterialIcons name={item.icon as any} size={20} color="#4E8E32" />
                <Text style={styles.howLabel}>{item.label}</Text>
              </View>
            ))}
          </View>

          <Text style={styles.sectionTitle}>
            {rooms.length > 0 ? `${rooms.length} Live Table${rooms.length > 1 ? 's' : ''}` : 'No tables open'}
          </Text>

          {rooms.length === 0 ? (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <MaterialIcons name="casino" size={42} color="#4E8E32" />
              </View>
              <Text style={styles.emptyTitle}>Start the first table</Text>
              <Text style={styles.emptyText}>Create a table and invite friends to join the match.</Text>
              <TouchableOpacity style={[styles.emptyBtn, creating && styles.createBtnLoading]} onPress={handleCreate} disabled={creating}>
                {creating ? <ActivityIndicator size="small" color="#FFFDF8" /> : <Text style={styles.emptyBtnText}>Create Table</Text>}
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.list}>
              {rooms.map((room) => (
                <RoomCard key={room.id} room={room} onJoin={() => handleJoin(room)} loading={joiningId === room.id} />
              ))}
            </View>
          )}

          <View style={{ height: 110 }} />
        </ScrollView>

        <BottomNav active="Chill" navigate={navigate} />
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  phone: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: 430 },
  scroll: { paddingBottom: 24 },
  hero: {
    marginHorizontal: 14,
    marginTop: 14,
    borderRadius: 24,
    padding: 22,
    alignItems: 'center',
    gap: 9,
    borderWidth: 1,
    borderColor: '#D8E8CF',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  boardPreview: {
    width: 112,
    height: 112,
    borderRadius: 26,
    backgroundColor: '#FFFDF8',
    borderWidth: 1,
    borderColor: '#E9D9BE',
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 7,
    position: 'relative',
    boxShadow: Platform.OS === 'web' ? 'inset 0 2px 6px rgba(83,58,29,0.12), 0 10px 18px rgba(83,58,29,0.14)' : undefined,
  },
  previewQuadrant: {
    width: '50%',
    height: '50%',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewPawn: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  previewCenter: {
    position: 'absolute',
    left: 39,
    top: 39,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF1BB',
    borderWidth: 1,
    borderColor: '#E8D79B',
  },
  heroTitle: {
    color: skeuo.plum,
    fontSize: 28,
    fontWeight: '900',
    fontFamily: 'serif',
  },
  heroSub: {
    color: '#7E7368',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 280,
  },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 13,
    borderRadius: 26,
    backgroundColor: '#F6D66D',
    borderWidth: 1,
    borderColor: '#D5B64D',
    boxShadow: Platform.OS === 'web' ? skeuo.goldShadow : undefined,
  },
  createBtnLoading: { opacity: 0.65 },
  createBtnText: { color: '#4A3600', fontSize: 14, fontWeight: '900' },
  howRow: {
    flexDirection: 'row',
    marginHorizontal: 14,
    marginTop: 14,
    backgroundColor: '#FFFDF8',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#D8E8CF',
    paddingVertical: 14,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  howItem: { flex: 1, alignItems: 'center', gap: 5 },
  howLabel: { color: '#6F8E60', fontSize: 10, fontWeight: '900' },
  sectionTitle: {
    color: '#8B7A6A',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginHorizontal: 14,
    marginTop: 20,
    marginBottom: 10,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 34,
    paddingHorizontal: 18,
    marginHorizontal: 14,
    gap: 8,
    borderRadius: 22,
    backgroundColor: '#FFFDF8',
    borderWidth: 1,
    borderColor: '#D8E8CF',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  emptyIcon: {
    width: 70,
    height: 70,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EAF7E3',
    borderWidth: 1,
    borderColor: '#C4DDB7',
  },
  emptyTitle: { color: skeuo.plum, fontSize: 18, fontWeight: '900', fontFamily: 'serif' },
  emptyText: { color: '#8B7A6A', fontSize: 12, fontWeight: '700', textAlign: 'center' },
  emptyBtn: {
    marginTop: 8,
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: 20,
    backgroundColor: '#4E8E32',
    borderWidth: 1,
    borderColor: '#C4DDB7',
  },
  emptyBtnText: { color: '#FFFDF8', fontSize: 13, fontWeight: '900' },
  list: { paddingHorizontal: 14, gap: 10 },
});
