import React, { useEffect, useRef, useState } from 'react';
import {
  Platform, View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Animated,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import ScreenShell from '../components/ScreenShell';
import TopBar from '../components/TopBar';
import BottomNav from '../components/BottomNav';
import GengalAvatar from '../components/GengalAvatar';
import { auth, db } from '../config/firebase';
import { collection, query, where, orderBy, onSnapshot, limit } from 'firebase/firestore';

type Props = { navigate: (s: string, p?: any) => void };

type CallRecord = {
  id: string;
  partnerName: string;
  partnerAvatarData?: any;
  partnerAvatarUrl?: string;
  mode: 'call' | 'video';
  durationSeconds: number;
  coinsSpent: number;
  heartsEarned: number;
  createdAt: any;
  role: 'caller' | 'receiver';
};

function CallRow({ record, index }: { record: CallRecord; index: number }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 350, delay: index * 50, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 350, delay: index * 50, useNativeDriver: true }),
    ]).start();
  }, []);

  const mins = Math.floor(record.durationSeconds / 60);
  const secs = record.durationSeconds % 60;
  const durationLabel = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  const isVideo = record.mode === 'video';
  const isCaller = record.role === 'caller';

  let when = '';
  if (record.createdAt?.toDate) {
    const d = record.createdAt.toDate() as Date;
    const now = new Date();
    const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
    if (diff < 60) when = 'Just now';
    else if (diff < 3600) when = `${Math.floor(diff / 60)}m ago`;
    else if (diff < 86400) when = `${Math.floor(diff / 3600)}h ago`;
    else when = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }

  return (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
      <View style={styles.row}>
        {/* Avatar */}
        <View style={styles.avatarWrap}>
          {record.partnerAvatarData ? (
            <GengalAvatar data={record.partnerAvatarData} size={48} />
          ) : (
            <View style={styles.avatarFallback}>
              <MaterialIcons name="person" size={24} color="#9A7A05" />
            </View>
          )}
          <View style={[styles.modeDot, isVideo ? styles.modeDotVideo : styles.modeDotCall]}>
            <MaterialIcons name={isVideo ? 'videocam' : 'phone'} size={10} color="#FFF" />
          </View>
        </View>

        {/* Info */}
        <View style={styles.rowInfo}>
          <View style={styles.rowNameRow}>
            <Text style={styles.rowName}>{record.partnerName}</Text>
            <Text style={styles.rowWhen}>{when}</Text>
          </View>
          <View style={styles.rowMeta}>
            <MaterialIcons
              name={isCaller ? 'call-made' : 'call-received'}
              size={12}
              color={isCaller ? '#4B0054' : '#16A34A'}
            />
            <Text style={styles.rowMetaText}>{isCaller ? 'Outgoing' : 'Incoming'}</Text>
            <View style={styles.metaDot} />
            <MaterialIcons name="timer" size={12} color="#9A7A05" />
            <Text style={styles.rowMetaText}>{durationLabel}</Text>
          </View>
        </View>

        {/* Stats */}
        <View style={styles.rowStats}>
          {isCaller && record.coinsSpent > 0 && (
            <View style={styles.statPill}>
              <MaterialIcons name="monetization-on" size={11} color="#D49A0B" />
              <Text style={styles.statText}>-{record.coinsSpent}</Text>
            </View>
          )}
          {!isCaller && record.heartsEarned > 0 && (
            <View style={[styles.statPill, styles.heartPill]}>
              <MaterialIcons name="favorite" size={11} color="#C9504B" />
              <Text style={[styles.statText, { color: '#C9504B' }]}>+{record.heartsEarned}</Text>
            </View>
          )}
        </View>
      </View>
    </Animated.View>
  );
}

export default function ActivityScreen({ navigate }: Props) {
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) { setLoading(false); return; }

    // Listen to calls where user was caller OR receiver
    const callerQ = query(
      collection(db, 'calls'),
      where('callerUid', '==', uid),
      orderBy('createdAt', 'desc'),
      limit(30)
    );
    const receiverQ = query(
      collection(db, 'calls'),
      where('receiverUid', '==', uid),
      orderBy('createdAt', 'desc'),
      limit(30)
    );

    const merged: Record<string, CallRecord> = {};

    const processCalls = () => {
      const sorted = Object.values(merged).sort((a, b) => {
        const ta = a.createdAt?.toDate?.()?.getTime?.() ?? 0;
        const tb = b.createdAt?.toDate?.()?.getTime?.() ?? 0;
        return tb - ta;
      });
      setCalls(sorted.slice(0, 40));
      setLoading(false);
    };

    const unsubCaller = onSnapshot(callerQ, snap => {
      snap.docs.forEach(d => {
        const data = d.data();
        merged[d.id] = {
          id: d.id,
          partnerName: data.receiverName || 'Unknown',
          partnerAvatarData: data.receiverAvatarData,
          partnerAvatarUrl: data.receiverAvatarUrl,
          mode: data.mode || 'call',
          durationSeconds: data.durationSeconds || 0,
          coinsSpent: data.coinsDeducted || 0,
          heartsEarned: 0,
          createdAt: data.createdAt,
          role: 'caller',
        };
      });
      processCalls();
    }, () => setLoading(false));

    const unsubReceiver = onSnapshot(receiverQ, snap => {
      snap.docs.forEach(d => {
        const data = d.data();
        if (!merged[d.id]) {
          merged[d.id] = {
            id: d.id,
            partnerName: data.callerName || 'Unknown',
            partnerAvatarData: data.callerAvatarData,
            partnerAvatarUrl: data.callerAvatarUrl,
            mode: data.mode || 'call',
            durationSeconds: data.durationSeconds || 0,
            coinsSpent: 0,
            heartsEarned: data.heartsEarned || 0,
            createdAt: data.createdAt,
            role: 'receiver',
          };
        }
      });
      processCalls();
    }, () => {});

    return () => { unsubCaller(); unsubReceiver(); };
  }, []);

  const totalMins = Math.floor(calls.reduce((s, c) => s + c.durationSeconds, 0) / 60);
  const totalCoins = calls.filter(c => c.role === 'caller').reduce((s, c) => s + c.coinsSpent, 0);
  const totalHearts = calls.filter(c => c.role === 'receiver').reduce((s, c) => s + c.heartsEarned, 0);

  return (
    <ScreenShell tone="light">
      <View style={styles.phone}>
        <TopBar navigate={navigate} />

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Header */}
          <Text style={styles.pageTitle}>Recent Calls</Text>

          {/* Summary stats */}
          {calls.length > 0 && (
            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <MaterialIcons name="history" size={22} color="#4B0054" />
                <Text style={styles.statValue}>{calls.length}</Text>
                <Text style={styles.statLabel}>Calls</Text>
              </View>
              <View style={styles.statCard}>
                <MaterialIcons name="timer" size={22} color="#D49A0B" />
                <Text style={styles.statValue}>{totalMins}m</Text>
                <Text style={styles.statLabel}>Talk Time</Text>
              </View>
              <View style={styles.statCard}>
                <MaterialIcons name="monetization-on" size={22} color="#D49A0B" />
                <Text style={styles.statValue}>{totalCoins}</Text>
                <Text style={styles.statLabel}>Coins Spent</Text>
              </View>
              <View style={styles.statCard}>
                <MaterialIcons name="favorite" size={22} color="#C9504B" />
                <Text style={styles.statValue}>{totalHearts}</Text>
                <Text style={styles.statLabel}>Hearts</Text>
              </View>
            </View>
          )}

          {/* List */}
          {loading ? (
            <View style={styles.empty}>
              <MaterialIcons name="hourglass-empty" size={44} color="#D1B23B" />
              <Text style={styles.emptyTitle}>Loading…</Text>
            </View>
          ) : calls.length === 0 ? (
            <View style={styles.empty}>
              <MaterialIcons name="call-end" size={52} color="#D1B23B" />
              <Text style={styles.emptyTitle}>No calls yet</Text>
              <Text style={styles.emptySub}>Your call history will appear here</Text>
              <TouchableOpacity style={styles.goBtn} onPress={() => navigate('Personal')}>
                <Text style={styles.goBtnText}>Find someone to call</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.list}>
              {calls.map((c, i) => (
                <CallRow key={c.id} record={c} index={i} />
              ))}
            </View>
          )}
        </ScrollView>

        <BottomNav active="Activity" navigate={navigate} />
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  phone: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: 430 },
  scroll: { padding: 16, paddingBottom: 110 },

  pageTitle: {
    fontSize: 26, fontWeight: '900', color: '#4B0054',
    fontFamily: 'serif', marginBottom: 16,
  },

  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  statCard: {
    flex: 1, backgroundColor: '#FFFDF8', borderRadius: 16, padding: 12, alignItems: 'center',
    borderWidth: 1, borderColor: '#EAD8A9',
    boxShadow: Platform.OS === 'web' ? '0 2px 8px rgba(68,44,21,0.06)' : undefined,
  },
  statValue: { fontSize: 18, fontWeight: '900', color: '#4B0054', marginTop: 4, marginBottom: 1 },
  statLabel: { fontSize: 9, color: '#9A8772', fontWeight: '700', textTransform: 'uppercase' },

  list: { gap: 8 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FFFDF8', borderRadius: 16, padding: 12,
    borderWidth: 1, borderColor: '#EEE4D8',
    boxShadow: Platform.OS === 'web' ? '0 1px 4px rgba(68,44,21,0.05)' : undefined,
  },
  avatarWrap: {
    width: 52, height: 52, borderRadius: 26,
    borderWidth: 2, borderColor: '#EAD691', overflow: 'visible',
    position: 'relative', flexShrink: 0,
  },
  avatarFallback: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: '#FFF8DD', alignItems: 'center', justifyContent: 'center',
  },
  modeDot: {
    position: 'absolute', bottom: -2, right: -2,
    width: 18, height: 18, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#FFFDF8',
  },
  modeDotCall: { backgroundColor: '#4B0054' },
  modeDotVideo: { backgroundColor: '#0284C7' },

  rowInfo: { flex: 1 },
  rowNameRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  rowName: { fontSize: 14, fontWeight: '800', color: '#4B0054' },
  rowWhen: { fontSize: 11, color: '#A89A8C', fontWeight: '600' },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowMetaText: { fontSize: 11, color: '#8A7C70', fontWeight: '700' },
  metaDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: '#CCC' },

  rowStats: { alignItems: 'flex-end', gap: 4 },
  statPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#FFF8DD', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8,
    borderWidth: 1, borderColor: '#E5CB70',
  },
  heartPill: { backgroundColor: '#FFF0F0', borderColor: '#ECAAA8' },
  statText: { fontSize: 11, fontWeight: '800', color: '#9A7A05' },

  empty: { alignItems: 'center', paddingVertical: 60, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '900', color: '#4B0054', fontFamily: 'serif' },
  emptySub: { fontSize: 13, color: '#8A7C70', fontWeight: '600' },
  goBtn: {
    marginTop: 8, backgroundColor: '#4B0054', borderRadius: 14,
    paddingHorizontal: 20, paddingVertical: 12,
  },
  goBtnText: { color: '#FFFDF8', fontWeight: '800', fontSize: 14 },
});
