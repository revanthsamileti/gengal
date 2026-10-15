import { Alert } from '../components/CustomAlert';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';

import BottomNav from '../components/BottomNav';
import ScreenShell from '../components/ScreenShell';
import TopBar from '../components/TopBar';
import { useUser } from '../context/UserContext';
import { auth } from '../config/firebase';
import {
  LUDO_TABLE_COST, LudoModeSheet, LudoTableCard, Pawn, SEAT_ORDER,
} from '../components/ludo/LudoLobby';
import {
  createLudoRoom, joinLudoRoom, LudoRoom, subscribeToLudoRooms,
} from '../services/ludoService';
import { ludo, numeric } from '../theme/ludoTheme';
import { skeuo } from '../theme/skeuomorphic';
import { useLiveRooms } from '../hooks/useRoomPresence';

interface Props {
  navigate: (screen: string, params?: any) => void;
  goBack?: () => void;
}

const TABLE_COST = LUDO_TABLE_COST;

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
                <LudoTableCard
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

        <LudoModeSheet visible={modeSheet} onClose={() => setModeSheet(false)} onPick={handleCreate} />

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

});
