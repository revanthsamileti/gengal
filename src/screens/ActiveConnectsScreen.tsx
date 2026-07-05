import React, { useState, useEffect, useRef } from 'react';
import {
  Platform, View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Image, TextInput, Animated,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import ScreenShell from '../components/ScreenShell';
import TopBar from '../components/TopBar';
import GengalAvatar from '../components/GengalAvatar';
import { subscribeToOnlineUsers, UserProfile as FirebaseUser } from '../services/userService';
import { auth } from '../config/firebase';

type Props = {
  navigate: (screen: string, params?: any) => void;
  goBack?: () => void;
};

function UserCard({ profile, index, navigate }: { profile: any; index: number; navigate: Props['navigate'] }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(16)).current;
  const tier = profile.avatarUrl ? 'VIP' : 'Elite';
  const tierColor = tier === 'VIP' ? '#9A1E8A' : '#B99916';

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 350, delay: index * 50, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 350, delay: index * 50, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.88}
        onPress={() => navigate('Profile', { profileName: profile.name, matchData: profile })}
      >
        {/* Avatar */}
        <View style={[styles.avatarRing, { borderColor: tierColor }]}>
          {profile.avatarData ? (
            <GengalAvatar data={profile.avatarData} size={52} />
          ) : (
            <Image source={{ uri: profile.uri }} style={styles.avatarImg} />
          )}
          <View style={styles.onlineDot} />
        </View>

        {/* Info */}
        <View style={styles.cardInfo}>
          <View style={styles.nameRow}>
            <Text style={styles.cardName}>{profile.name}, {profile.age}</Text>
            <View style={[styles.tierPill, { backgroundColor: tierColor + '20', borderColor: tierColor + '55' }]}>
              <MaterialIcons name="diamond" size={9} color={tierColor} />
              <Text style={[styles.tierText, { color: tierColor }]}>{tier}</Text>
            </View>
          </View>
          <View style={styles.metaRow}>
            <MaterialIcons name="language" size={12} color="#9A7A05" />
            <Text style={styles.metaText}>{profile.lang}</Text>
            <View style={styles.dot} />
            <MaterialIcons name="circle" size={8} color="#5EBB62" />
            <Text style={[styles.metaText, { color: '#5EBB62' }]}>Online</Text>
          </View>
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => navigate('Call', { profileName: profile.name, mode: 'call', matchData: profile, isCaller: true })}
          >
            <MaterialIcons name="phone" size={16} color="#FFF" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.videoBtn]}
            onPress={() => navigate('Call', { profileName: profile.name, mode: 'video', matchData: profile, isCaller: true })}
          >
            <MaterialIcons name="videocam" size={16} color="#FFF" />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function ActiveConnectsScreen({ navigate, goBack }: Props) {
  const [firebaseUsers, setFirebaseUsers] = useState<FirebaseUser[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const unsub = subscribeToOnlineUsers((users) => setFirebaseUsers(users), auth.currentUser?.uid);
    return unsub;
  }, []);

  const displayProfiles = firebaseUsers.map(u => ({
    uid: u.uid,
    name: u.nickname || u.username || 'User',
    age: typeof u.age === 'number' ? u.age : parseInt(u.age || '20', 10),
    uri: u.avatarUrl || '',
    avatarUrl: u.avatarUrl,
    avatarData: u.avatarData,
    lang: u.language || 'EN',
  }));

  const filtered = displayProfiles.filter(p =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <ScreenShell tone="light">
      <View style={styles.phone}>
        <TopBar navigate={navigate} />

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Header */}
          <View style={styles.pageHeader}>
            <View>
              <Text style={styles.pageTitle}>People Online</Text>
              <Text style={styles.pageCount}>{displayProfiles.length} connected now</Text>
            </View>
          </View>

          {/* Search */}
          <View style={styles.searchBox}>
            <MaterialIcons name="search" size={20} color="#A79386" />
            <TextInput
              style={styles.searchInput}
              placeholder="Search by name…"
              placeholderTextColor="#A79386"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <MaterialIcons name="close" size={18} color="#A79386" />
              </TouchableOpacity>
            )}
          </View>

          {/* Legend */}
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#9A1E8A' }]} />
              <Text style={styles.legendText}>VIP — uploaded photo</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#B99916' }]} />
              <Text style={styles.legendText}>Elite — avatar only</Text>
            </View>
          </View>

          {/* List */}
          <View style={styles.list}>
            {filtered.length === 0 ? (
              <View style={styles.empty}>
                <MaterialIcons name="people-outline" size={48} color="#D1B23B" />
                <Text style={styles.emptyTitle}>
                  {searchQuery ? 'No results found' : 'No one online yet'}
                </Text>
                <Text style={styles.emptySub}>
                  {searchQuery ? 'Try a different name' : 'Check back soon!'}
                </Text>
              </View>
            ) : (
              filtered.map((profile, i) => (
                <UserCard key={profile.uid || profile.name + i} profile={profile} index={i} navigate={navigate} />
              ))
            )}
          </View>
        </ScrollView>
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  phone: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: 430 },
  scroll: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 60 },

  pageHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  pageTitle: { fontSize: 24, fontWeight: '900', color: '#4B0054', fontFamily: 'serif' },
  pageCount: { fontSize: 12, color: '#9A7A05', fontWeight: '700', marginTop: 2 },

  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#FFF', borderRadius: 14, paddingHorizontal: 14, height: 46,
    borderWidth: 1, borderColor: '#EEE4D8', marginBottom: 12,
    boxShadow: Platform.OS === 'web' ? '0 1px 4px rgba(68,44,21,0.06)' : undefined,
  },
  searchInput: { flex: 1, fontSize: 14, color: '#4B0054', fontWeight: '600' },

  legend: { flexDirection: 'row', gap: 16, marginBottom: 14 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 11, color: '#8A7C70', fontWeight: '700' },

  list: { gap: 10 },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FFFDF8', borderRadius: 18, padding: 14,
    borderWidth: 1, borderColor: '#EEE4D8',
    boxShadow: Platform.OS === 'web' ? '0 2px 8px rgba(68,44,21,0.06)' : undefined,
  },
  avatarRing: {
    width: 60, height: 60, borderRadius: 30,
    borderWidth: 2, overflow: 'hidden', position: 'relative', flexShrink: 0,
  },
  avatarImg: { width: '100%', height: '100%', borderRadius: 28 },
  onlineDot: {
    position: 'absolute', bottom: 2, right: 2,
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: '#5EBB62', borderWidth: 2, borderColor: '#FFFDF8',
  },

  cardInfo: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 5 },
  cardName: { fontSize: 15, fontWeight: '900', color: '#4B0054' },
  tierPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 7, borderWidth: 1,
  },
  tierText: { fontSize: 8, fontWeight: '900', textTransform: 'uppercase' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { fontSize: 11, color: '#8A7C70', fontWeight: '700' },
  dot: { width: 3, height: 3, borderRadius: 2, backgroundColor: '#CCC' },

  actions: { flexDirection: 'row', gap: 8 },
  actionBtn: {
    width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#7A256D', borderWidth: 1, borderColor: '#7A256D',
  },
  videoBtn: {},

  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyTitle: { fontSize: 18, fontWeight: '900', color: '#4B0054', fontFamily: 'serif', marginTop: 12, marginBottom: 4 },
  emptySub: { fontSize: 13, color: '#8A7C70', fontWeight: '600' },
});
