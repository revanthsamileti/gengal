import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import ScreenShell from '../components/ScreenShell';
import GengalAvatar from '../components/GengalAvatar';
import { Alert } from '../components/CustomAlert';
import { auth } from '../config/firebase';
import { getUserProfile, UserProfile } from '../services/userService';
import { unblockUser, useBlockedUids } from '../services/safetyService';
import { tap40 } from '../theme/touch';

type Props = {
  navigate: (screen: string, params?: any) => void;
  goBack?: () => void;
};

/**
 * The only way back to someone you blocked: they are filtered out of every
 * listing and chat, so their profile cannot be reached from anywhere else.
 */
export default function BlockedUsersScreen({ navigate, goBack }: Props) {
  const blockedUids = useBlockedUids();
  const [profiles, setProfiles] = useState<Record<string, UserProfile | null>>({});
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const missing = [...blockedUids].filter((uid) => !(uid in profiles));
    if (!missing.length) return;
    Promise.all(missing.map((uid) => getUserProfile(uid).catch(() => null))).then((results) => {
      if (!active) return;
      setProfiles((prev) => {
        const next = { ...prev };
        missing.forEach((uid, i) => { next[uid] = results[i]; });
        return next;
      });
    });
    return () => { active = false; };
  }, [blockedUids, profiles]);

  const onUnblock = async (uid: string) => {
    const myUid = auth.currentUser?.uid;
    if (!myUid) return;
    setPending(uid);
    try {
      await unblockUser(myUid, uid);
    } catch {
      Alert.alert('Could not unblock', 'Please check your connection and try again.');
    } finally {
      setPending(null);
    }
  };

  const uids = [...blockedUids];

  return (
    <ScreenShell tone="light">
      <View style={styles.phone}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} hitSlop={tap40} onPress={() => goBack ? goBack() : navigate('Settings')}
            accessibilityRole="button"
            accessibilityLabel="Go back">
            <MaterialIcons name="arrow-back" size={22} color="#4B0054" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Blocked Users</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          {uids.length === 0 ? (
            <View style={styles.empty}>
              <MaterialIcons name="check-circle-outline" size={44} color="#C9A93A" />
              <Text style={styles.emptyTitle}>No one is blocked</Text>
              <Text style={styles.emptyText}>
                Block someone from their profile and they will be listed here.
              </Text>
            </View>
          ) : uids.map((uid) => {
            const p = profiles[uid];
            const name = p?.nickname || p?.username || (p === null ? 'Deleted account' : '…');
            return (
              <View key={uid} style={styles.row}>
                <View style={styles.avatarWrap}>
                  {p?.avatarData ? (
                    <GengalAvatar data={p.avatarData as any} size={48} />
                  ) : (
                    <MaterialIcons name="person" size={26} color="#9A7A05" />
                  )}
                </View>
                <Text style={styles.name} numberOfLines={1}>{name}</Text>
                <TouchableOpacity
                  style={styles.unblockBtn}
                  activeOpacity={0.8}
                  disabled={pending === uid}
                  onPress={() => onUnblock(uid)}
                >
                  {pending === uid
                    ? <ActivityIndicator size="small" color="#4B0054" />
                    : <Text style={styles.unblockText}>Unblock</Text>}
                </TouchableOpacity>
              </View>
            );
          })}
        </ScrollView>
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  phone: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: 430 },
  header: {
    height: 60, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 16,
    backgroundColor: '#FFFDF8', borderBottomWidth: 1, borderBottomColor: '#EAD8A9',
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '900', color: '#4B0054', fontFamily: 'serif' },
  content: { padding: 16, gap: 10, paddingBottom: 32 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FFFFFF', padding: 12, borderRadius: 16,
    borderWidth: 1, borderColor: '#F0E9DF',
  },
  avatarWrap: {
    width: 48, height: 48, borderRadius: 24, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF8DD',
  },
  name: { flex: 1, fontSize: 15, fontWeight: '800', color: '#4B0054' },
  unblockBtn: {
    minWidth: 88, height: 36, paddingHorizontal: 14, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#D4B142', backgroundColor: '#FFF8DD',
  },
  unblockText: { color: '#4B0054', fontSize: 13, fontWeight: '900' },
  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 24, gap: 10 },
  emptyTitle: { fontSize: 20, fontWeight: '900', color: '#4B0054', fontFamily: 'serif' },
  emptyText: { fontSize: 14, color: '#8A7E74', textAlign: 'center', lineHeight: 20 },
});
