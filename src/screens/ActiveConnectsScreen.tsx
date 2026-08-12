import React, { useState, useEffect, useRef } from 'react';
import {
  Platform, View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Image, TextInput, Animated, Modal,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import ScreenShell from '../components/ScreenShell';
import { useActionLock } from '../hooks/useActionLock';
import { launchCall } from '../services/callPermissionService';
import TopBar from '../components/TopBar';
import GengalAvatar from '../components/GengalAvatar';
import BottomNav from '../components/BottomNav';
import { tap36, tap38 } from '../theme/touch';
import { subscribeToAllUsers, isUserAvailableNow, UserProfile as FirebaseUser } from '../services/userService';
import { subscribeToGlobalSettings } from '../services/adminService';
import { useUser } from '../context/UserContext';

type Props = {
  navigate: (screen: string, params?: any) => void;
  goBack?: () => void;
};

/** lastActive/createdAt arrive as a Firestore Timestamp, a Date or a number. */
const toMs = (value: any): number => {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return 0;
};

const STATUS_KEYS = ['ALL', 'ACTIVE', 'INACTIVE'];
const STATUS_LABELS: Record<string, string> = {
  ALL: 'All Status',
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
};

const labelFor = (kind: 'language' | 'status' | 'state', value: string) => {
  if (kind === 'status') return STATUS_LABELS[value] ?? value;
  if (value !== 'ALL') return value;
  return kind === 'language' ? 'All Languages' : 'All States';
};

function UserCard({
  profile,
  index,
  navigate,
  rates,
}: {
  profile: any;
  index: number;
  navigate: Props['navigate'];
  rates: { call: number; video: number };
}) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(16)).current;
  const tier = profile.tier === 'VIP' ? 'VIP' : 'Standard';
  const tierColor = tier === 'VIP' ? '#9A1E8A' : '#B99916';
  const isActive = profile.isActiveMode === true;
  const { locked: callLocked, run: runCall } = useActionLock();
  const startCall = (mode: 'call' | 'video') =>
    runCall(() =>
      launchCall(navigate, { profileName: profile.name, mode, matchData: profile, isCaller: true })
    );

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
            // App avatar builder — preferred; always present for users who
            // completed AvatarScreen during onboarding.
            <GengalAvatar data={profile.avatarData} size={52} />
          ) : profile.uri ? (
            // Real avatarUrl or the sample profile's Unsplash image.
            <Image source={{ uri: profile.uri }} style={styles.avatarImg} />
          ) : (
            // No avatar and no URL. source={{ uri: '' }} warns on every render
            // and draws a blank box — show a person icon instead.
            <View style={[styles.avatarImg, styles.avatarFallback]}>
              <MaterialIcons name="person" size={28} color="#C9BDB2" />
            </View>
          )}
          <View style={[styles.onlineDot, !isActive && styles.inactiveDot]} />
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
            <MaterialIcons name="circle" size={8} color={isActive ? '#10B981' : '#B0A49A'} />
            <Text
              numberOfLines={1}
              style={[styles.metaText, { color: isActive ? '#10B981' : '#8A7C70', flexShrink: 1 }]}
            >
              {isActive ? 'Available now' : 'Inactive'}
            </Text>
          </View>
        </View>

        {/* Actions — each carries its per-minute price so the cost is visible
            before the call starts, not after the first tick is billed. */}
        <View style={styles.actions}>
          <View style={styles.actionCol}>
            <TouchableOpacity
              style={[styles.actionBtn, (!isActive || callLocked) && styles.actionBtnDisabled]}
              hitSlop={tap38}
              disabled={!isActive || callLocked}
              accessibilityRole="button"
              accessibilityLabel={`Call ${profile.name}, ${rates.call} coins per minute`}
              accessibilityState={{ disabled: !isActive || callLocked }}
              onPress={() => startCall('call')}
            >
              <MaterialIcons name="phone" size={16} color="#FFF" />
            </TouchableOpacity>
            <View style={styles.priceRow}>
              <MaterialIcons name="star" size={9} color="#D9A404" />
              <Text style={styles.priceText}>{rates.call}/m</Text>
            </View>
          </View>

          <View style={styles.actionCol}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.videoBtn, (!isActive || callLocked) && styles.actionBtnDisabled]}
              hitSlop={tap38}
              disabled={!isActive || callLocked}
              accessibilityRole="button"
              accessibilityLabel={`Video call ${profile.name}, ${rates.video} coins per minute`}
              accessibilityState={{ disabled: !isActive || callLocked }}
              onPress={() => startCall('video')}
            >
              <MaterialIcons name="videocam" size={16} color="#FFF" />
            </TouchableOpacity>
            <View style={styles.priceRow}>
              <MaterialIcons name="star" size={9} color="#D9A404" />
              <Text style={styles.priceText}>{rates.video}/m</Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function ActiveConnectsScreen({ navigate, goBack }: Props) {
  const [firebaseUsers, setFirebaseUsers] = useState<FirebaseUser[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [language, setLanguage] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [stateFilter, setStateFilter] = useState('ALL');
  const [recentFirst, setRecentFirst] = useState(false);
  const [picker, setPicker] = useState<null | 'language' | 'status' | 'state'>(null);
  // Subscribed once here rather than inside each card: a listener per button
  // would open a dozen for a screen of six profiles. Defaults match CallPriceTag.
  const [rates, setRates] = useState({ call: 15, video: 30 });

  const { profile: myProfile } = useUser();

  useEffect(() => {
    const unsub = subscribeToGlobalSettings((s) => {
      if (!s) return;
      setRates({
        call: s.voiceCallRatePerMin ?? 15,
        video: s.videoCallRatePerMin ?? 30,
      });
    });
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = subscribeToAllUsers((users) => setFirebaseUsers(users), myProfile?.uid);
    return unsub;
  }, [myProfile?.uid]);

  const realProfiles = firebaseUsers.map(u => ({
    uid: u.uid,
    name: u.nickname || u.username || 'User',
    age: typeof u.age === 'number' ? u.age : (u.age ? parseInt(u.age, 10) : undefined),
    uri: u.avatarUrl || '',
    avatarUrl: u.avatarUrl,
    avatarData: u.avatarData,
    lang: (u.language || 'EN').toUpperCase(),
    state: u.state || u.city || '',
    isActiveMode: isUserAvailableNow(u),
    lastActive: u.lastActive,
    joinedAt: toMs((u as any).createdAt) || toMs(u.lastActive),
  }));

  // Real accounts only. The directory used to be padded with seeded demo people
  // so it was never blank before real signups; they are gone because a browsable
  // list of people who do not exist misrepresents how busy the app is, and the
  // filters below derive their options from whatever is on screen — so fake
  // rows also invented languages and states nobody could actually be found in.
  const displayProfiles = realProfiles;

  // Option lists come from the data actually on screen, so a filter can never
  // offer a value that matches nothing.
  const languageOptions = ['ALL', ...Array.from(
    new Set(displayProfiles.map(p => p.lang).filter(Boolean))
  ).sort()];
  const stateOptions = ['ALL', ...Array.from(
    new Set(displayProfiles.map(p => p.state).filter(Boolean))
  ).sort()];

  const query = searchQuery.trim().toLowerCase();

  const filtered = displayProfiles.filter(p => {
    if (query && !p.name.toLowerCase().includes(query)) return false;
    if (language !== 'ALL' && p.lang !== language) return false;
    if (stateFilter !== 'ALL' && p.state !== stateFilter) return false;
    if (status === 'ACTIVE' && !p.isActiveMode) return false;
    if (status === 'INACTIVE' && p.isActiveMode) return false;
    return true;
  });

  // Active people first, then inactive, so callable profiles are not buried.
  // "Recently Joined" overrides that and sorts purely by join time.
  const ordered = [...filtered].sort((a, b) => {
    if (recentFirst) return b.joinedAt - a.joinedAt;
    const byActive = Number(b.isActiveMode) - Number(a.isActiveMode);
    return byActive !== 0 ? byActive : toMs(b.lastActive) - toMs(a.lastActive);
  });

  const activeCount = displayProfiles.filter(p => p.isActiveMode).length;
  const activeFilterCount =
    (language !== 'ALL' ? 1 : 0) +
    (status !== 'ALL' ? 1 : 0) +
    (stateFilter !== 'ALL' ? 1 : 0) +
    (recentFirst ? 1 : 0);

  const clearFilters = () => {
    setLanguage('ALL');
    setStatus('ALL');
    setStateFilter('ALL');
    setRecentFirst(false);
  };

  const pickerConfig =
    picker === 'language'
      ? { title: 'Language', options: languageOptions, selected: language, onSelect: setLanguage }
      : picker === 'state'
      ? { title: 'State', options: stateOptions, selected: stateFilter, onSelect: setStateFilter }
      : picker === 'status'
      ? { title: 'Status', options: STATUS_KEYS, selected: status, onSelect: setStatus }
      : null;

  return (
    <ScreenShell tone="light">
      <View style={styles.phone}>
        <TopBar navigate={navigate} />

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={styles.pageHeader}>
            <View>
              <Text style={styles.pageTitle}>More Connects</Text>
              <Text style={styles.pageCount}>
                {displayProfiles.length} {displayProfiles.length === 1 ? 'profile' : 'profiles'} · {activeCount} active
              </Text>
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
              <TouchableOpacity onPress={() => setSearchQuery('')}
                accessibilityRole="button"
                accessibilityLabel="Close">
                <MaterialIcons name="close" size={18} color="#A79386" />
              </TouchableOpacity>
            )}
          </View>

          {/* Filters — same set the Connect tab offers */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.filterScroller}
            contentContainerStyle={styles.filterRow}
            keyboardShouldPersistTaps="handled"
          >
            {([
              { kind: 'language' as const, value: language, icon: 'translate' },
              { kind: 'status' as const, value: status, icon: 'groups' },
              { kind: 'state' as const, value: stateFilter, icon: 'location-on' },
            ]).map(({ kind, value, icon }) => {
              const isSet = value !== 'ALL';
              return (
                <TouchableOpacity
                  key={kind}
                  style={[styles.filterChip, isSet && styles.filterChipActive]}
                  hitSlop={tap36}
                  activeOpacity={0.85}
                  onPress={() => setPicker(kind)}
                  accessibilityRole="button"
                  accessibilityLabel={`${labelFor(kind, value)}, change filter`}
                >
                  <MaterialIcons name={icon as any} size={14} color={isSet ? '#5F205C' : '#8A6C28'} />
                  <Text style={[styles.filterChipText, isSet && styles.filterChipTextActive]}>
                    {labelFor(kind, value)}
                  </Text>
                  {isSet ? (
                    <TouchableOpacity
                      onPress={(e) => {
                        e.stopPropagation();
                        if (kind === 'language') setLanguage('ALL');
                        else if (kind === 'status') setStatus('ALL');
                        else setStateFilter('ALL');
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityRole="button"
                      accessibilityLabel={`Clear ${kind} filter`}
                    >
                      <MaterialIcons name="close" size={15} color="#5F205C" />
                    </TouchableOpacity>
                  ) : (
                    <MaterialIcons name="expand-more" size={15} color="#8A6C28" />
                  )}
                </TouchableOpacity>
              );
            })}

            <TouchableOpacity
              style={[styles.filterChip, recentFirst && styles.filterChipActive]}
              hitSlop={tap36}
              activeOpacity={0.85}
              onPress={() => setRecentFirst(v => !v)}
              accessibilityRole="button"
              accessibilityLabel="Sort by recently joined"
              accessibilityState={{ selected: recentFirst }}
            >
              <MaterialIcons name="schedule" size={14} color={recentFirst ? '#5F205C' : '#8A6C28'} />
              <Text style={[styles.filterChipText, recentFirst && styles.filterChipTextActive]}>
                Recently Joined
              </Text>
            </TouchableOpacity>

            {activeFilterCount > 0 && (
              <TouchableOpacity
                style={styles.clearChip}
                hitSlop={tap36}
                activeOpacity={0.85}
                onPress={clearFilters}
                accessibilityRole="button"
                accessibilityLabel="Clear all filters"
              >
                <MaterialIcons name="close" size={14} color="#B3261E" />
                <Text style={styles.clearChipText}>Clear</Text>
              </TouchableOpacity>
            )}
          </ScrollView>

          {/* Legend */}
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#10B981' }]} />
              <Text style={styles.legendText}>Active profile</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#B0A49A' }]} />
              <Text style={styles.legendText}>Inactive profile</Text>
            </View>
          </View>

          {/* List */}
          <View style={styles.list}>
            {ordered.length === 0 ? (
              <View style={styles.empty}>
                <MaterialIcons name="people-outline" size={48} color="#D1B23B" />
                <Text style={styles.emptyTitle}>
                  {searchQuery || activeFilterCount > 0 ? 'No results found' : 'No profiles yet'}
                </Text>
                <Text style={styles.emptySub}>
                  {searchQuery
                    ? `Nobody matches “${searchQuery.trim()}”`
                    : activeFilterCount > 0
                    ? 'Try clearing a filter'
                    : 'Profiles appear here as people join'}
                </Text>
              </View>
            ) : (
              ordered.map((profile, i) => (
                <UserCard key={profile.uid || profile.name + i} profile={profile} index={i} navigate={navigate} rates={rates} />
              ))
            )}
          </View>
        </ScrollView>

        <Modal
          visible={picker !== null}
          transparent
          animationType="fade"
          statusBarTranslucent
          onRequestClose={() => setPicker(null)}
        >
          <TouchableOpacity
            style={styles.pickerBackdrop}
            activeOpacity={1}
            onPress={() => setPicker(null)}
          >
            <View style={styles.pickerCard}>
              <Text style={styles.pickerTitle}>{pickerConfig?.title}</Text>
              <ScrollView style={{ maxHeight: 320 }}>
                {pickerConfig?.options.map(opt => {
                  const isSel = pickerConfig.selected === opt;
                  return (
                    <TouchableOpacity
                      key={opt}
                      style={[styles.pickerRow, isSel && styles.pickerRowActive]}
                      activeOpacity={0.85}
                      onPress={() => {
                        pickerConfig.onSelect(opt);
                        setPicker(null);
                      }}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: isSel, checked: isSel }}
                    >
                      <Text style={[styles.pickerRowText, isSel && styles.pickerRowTextActive]}>
                        {picker ? labelFor(picker, opt) : opt}
                      </Text>
                      {isSel && <MaterialIcons name="check" size={18} color="#5F205C" />}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          </TouchableOpacity>
        </Modal>

        <BottomNav active="Personal" navigate={navigate} />
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

  filterScroller: { marginHorizontal: -20, marginBottom: 14 },
  filterRow: { paddingHorizontal: 20, gap: 8, alignItems: 'center' },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#EBD9AE',
    backgroundColor: '#FFFDF8',
  },
  filterChipActive: {
    backgroundColor: '#FBEDF7',
    borderColor: '#D9A8CE',
  },
  filterChipText: { fontSize: 12, fontWeight: '800', color: '#8A6C28' },
  filterChipTextActive: { color: '#5F205C' },
  clearChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#F0C9C4',
    backgroundColor: '#FFF5F4',
  },
  clearChipText: { fontSize: 12, fontWeight: '800', color: '#B3261E' },

  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(30, 10, 26, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  pickerCard: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 20,
    backgroundColor: '#FFFDF8',
    paddingVertical: 16,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: '#F1E2D2',
  },
  pickerTitle: {
    fontSize: 15,
    fontWeight: '900',
    color: '#5F205C',
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 46,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  pickerRowActive: { backgroundColor: '#FBEDF7' },
  pickerRowText: { fontSize: 14, fontWeight: '700', color: '#6B5A4A' },
  pickerRowTextActive: { color: '#5F205C', fontWeight: '900' },

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
  // Shown when both avatarData and uri are absent (source={{ uri: '' }} warns).
  avatarFallback: {
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: '#F5ECE1',
  },
  onlineDot: {
    position: 'absolute', bottom: 2, right: 2,
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: '#10B981', borderWidth: 2, borderColor: '#FFFDF8',
  },
  inactiveDot: {
    backgroundColor: '#B0A49A',
  },

  // minWidth 0 lets this column actually shrink; without it the meta line keeps
  // its intrinsic width and runs underneath the price labels.
  cardInfo: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 5 },
  cardName: { fontSize: 15, fontWeight: '900', color: '#4B0054' },
  tierPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 7, borderWidth: 1,
  },
  tierText: { fontSize: 8, fontWeight: '900', textTransform: 'uppercase' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
  metaText: { fontSize: 11, color: '#8A7C70', fontWeight: '700' },
  dot: { width: 3, height: 3, borderRadius: 2, backgroundColor: '#CCC' },

  actions: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  actionCol: { alignItems: 'center', gap: 3 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  priceText: { fontSize: 9, fontWeight: '800', color: '#8A7C70' },
  actionBtn: {
    width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#7A256D', borderWidth: 1, borderColor: '#7A256D',
  },
  actionBtnDisabled: {
    backgroundColor: '#B8ACA4',
    borderColor: '#B8ACA4',
    opacity: 0.65,
  },
  videoBtn: {},

  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyTitle: { fontSize: 18, fontWeight: '900', color: '#4B0054', fontFamily: 'serif', marginTop: 12, marginBottom: 4 },
  emptySub: { fontSize: 13, color: '#8A7C70', fontWeight: '600' },
});
