import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import ScreenShell from '../components/ScreenShell';
import GengalAvatar from '../components/GengalAvatar';
import { Alert } from '../components/CustomAlert';
import { auth } from '../config/firebase';
import { useUser } from '../context/UserContext';
import {
  followUser,
  unfollowUser,
  getUsersByIds,
  isUserAvailableNow,
  subscribeToFollowerIds,
  subscribeToOnlineUsers,
  subscribeToUserProfile,
  UserProfile,
} from '../services/userService';
import { useBlockedUids } from '../services/safetyService';
import { tap40 } from '../theme/touch';

type Tab = 'followers' | 'following';

type Props = {
  navigate: (screen: string, params?: any) => void;
  goBack?: () => void;
  /** Whose lists these are. */
  uid: string;
  name?: string;
  tab?: Tab;
};

/**
 * Someone's followers and the people they follow, both live: a follow made on
 * another phone shows up here (and in the counts on the tabs) without leaving
 * the screen. Each row has its own Follow button, so you can follow back.
 */
export default function FollowListScreen({ navigate, goBack, uid, name, tab: initialTab }: Props) {
  const { profile: myProfile } = useUser();
  const myUid = auth.currentUser?.uid;
  const [tab, setTab] = useState<Tab>(initialTab ?? 'followers');
  const [followerIds, setFollowerIds] = useState<string[] | null>(null);
  const [followingIds, setFollowingIds] = useState<string[] | null>(null);
  const [profiles, setProfiles] = useState<Record<string, UserProfile | null>>({});
  const [onlineUids, setOnlineUids] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  // Optimistic Follow taps, until the profile snapshot catches up.
  const [pendingFollow, setPendingFollow] = useState<Record<string, boolean>>({});
  const requested = useRef(new Set<string>());
  const blockedUids = useBlockedUids();

  useEffect(() => subscribeToFollowerIds(uid, setFollowerIds), [uid]);
  useEffect(() => subscribeToUserProfile(uid, (u) => {
    // arrayUnion appends, so the newest follow is last; show it first.
    setFollowingIds(Array.isArray(u?.following) ? [...(u!.following as string[])].reverse() : []);
  }), [uid]);
  useEffect(() => subscribeToOnlineUsers((users) => {
    setOnlineUids(new Set(users.filter(isUserAvailableNow).map((u) => u.uid as string)));
  }, myUid), [myUid]);

  // Load each profile once, in batches, as ids appear in either list.
  useEffect(() => {
    const missing = [...(followerIds ?? []), ...(followingIds ?? [])]
      .filter((id) => !requested.current.has(id));
    if (!missing.length) return;
    missing.forEach((id) => requested.current.add(id));
    getUsersByIds(missing)
      .then((found) => setProfiles((prev) => {
        const next = { ...prev };
        missing.forEach((id) => { next[id] = null; });
        found.forEach((p) => { next[p.uid as string] = p; });
        return next;
      }))
      .catch(() => missing.forEach((id) => requested.current.delete(id)));
  }, [followerIds, followingIds]);

  const myFollowing = useMemo(
    () => new Set(Array.isArray(myProfile?.following) ? (myProfile!.following as string[]) : []),
    [myProfile?.following],
  );
  const amFollowing = (id: string) => pendingFollow[id] ?? myFollowing.has(id);

  // Drop the optimistic value once the real one agrees with it.
  useEffect(() => {
    setPendingFollow((prev) => {
      const next = { ...prev };
      let changed = false;
      Object.keys(next).forEach((id) => {
        if (next[id] === myFollowing.has(id)) { delete next[id]; changed = true; }
      });
      return changed ? next : prev;
    });
  }, [myFollowing]);

  const toggleFollow = async (id: string) => {
    if (!myUid) return;
    const was = amFollowing(id);
    setPendingFollow((p) => ({ ...p, [id]: !was }));
    try {
      if (was) await unfollowUser(myUid, id);
      else await followUser(myUid, id);
    } catch {
      setPendingFollow((p) => { const n = { ...p }; delete n[id]; return n; });
      Alert.alert(was ? 'Could not unfollow' : 'Could not follow', 'Please check your connection and try again.');
    }
  };

  const ids = (tab === 'followers' ? followerIds : followingIds) ?? null;
  const q = search.trim().toLowerCase();
  const rows = (ids ?? [])
    .filter((id) => !blockedUids.has(id) && profiles[id] !== null)
    .filter((id) => {
      if (!q) return true;
      const p = profiles[id];
      return !!p && `${p.nickname ?? ''} ${p.username ?? ''}`.toLowerCase().includes(q);
    });
  // Deleted/banned accounts are left out of the list, so count what is shown
  // once every profile has loaded.
  const countFor = (list: string[] | null) =>
    list === null ? '–' : String(list.filter((id) => !blockedUids.has(id) && profiles[id] !== null).length);
  const isMine = uid === myUid;
  const title = isMine ? 'Your connections' : (name || 'Connections');

  return (
    <ScreenShell tone="light">
      <View style={styles.phone}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} hitSlop={tap40} onPress={() => goBack ? goBack() : navigate('Home')}
            accessibilityRole="button" accessibilityLabel="Go back">
            <MaterialIcons name="arrow-back" size={22} color="#4B0054" />
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.tabs}>
          {(['followers', 'following'] as Tab[]).map((t) => {
            const active = tab === t;
            return (
              <TouchableOpacity key={t} style={[styles.tab, active && styles.tabActive]} onPress={() => setTab(t)}
                accessibilityRole="tab" accessibilityState={{ selected: active }}>
                <Text style={[styles.tabCount, active && styles.tabTextActive]}>
                  {countFor(t === 'followers' ? followerIds : followingIds)}
                </Text>
                <Text style={[styles.tabLabel, active && styles.tabTextActive]}>
                  {t === 'followers' ? 'Followers' : 'Following'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {(ids?.length ?? 0) > 6 && (
          <View style={styles.searchBox}>
            <MaterialIcons name="search" size={18} color="#9A856E" />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search by name"
              placeholderTextColor="#B9AC9E"
              style={styles.searchInput}
              autoCorrect={false}
            />
            {!!search && (
              <TouchableOpacity onPress={() => setSearch('')} hitSlop={tap40} accessibilityLabel="Clear search">
                <MaterialIcons name="close" size={18} color="#9A856E" />
              </TouchableOpacity>
            )}
          </View>
        )}

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {ids === null ? (
            <ActivityIndicator style={{ marginTop: 60 }} color="#4B0054" />
          ) : rows.length === 0 ? (
            <View style={styles.empty}>
              <MaterialIcons name={tab === 'followers' ? 'favorite-border' : 'person-search'} size={44} color="#C9A93A" />
              <Text style={styles.emptyTitle}>
                {q ? 'No one by that name'
                  : tab === 'followers' ? 'No followers yet' : 'Not following anyone yet'}
              </Text>
              {!q && (
                <Text style={styles.emptyText}>
                  {tab === 'followers'
                    ? (isMine ? 'When someone follows you, they appear here right away.' : 'Be the first to follow.')
                    : (isMine ? 'Tap Follow on a profile and they will be listed here.' : 'Nobody here yet.')}
                </Text>
              )}
            </View>
          ) : rows.map((id) => {
            const p = profiles[id];
            const display = p?.nickname || p?.username || '…';
            const online = onlineUids.has(id);
            const following = amFollowing(id);
            // On your own Following tab: the ones who follow you back.
            const mutual = isMine && tab === 'following' && (followerIds ?? []).includes(id);
            return (
              <TouchableOpacity
                key={id}
                style={styles.row}
                activeOpacity={0.85}
                disabled={!p}
                onPress={() => p && navigate('Profile', { profileName: display, matchData: { ...p, uid: id, name: display } })}
                accessibilityRole="button"
                accessibilityLabel={`Open ${display}'s profile`}
              >
                <View>
                  <View style={styles.avatarWrap}>
                    {p?.avatarData
                      ? <GengalAvatar data={p.avatarData as any} size={48} />
                      : p ? <MaterialIcons name="person" size={26} color="#9A7A05" />
                        : <ActivityIndicator size="small" color="#C9A93A" />}
                  </View>
                  {online && <View style={styles.onlineDot} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name} numberOfLines={1}>{display}</Text>
                  {(online || mutual || !!p?.bio) && (
                    <Text style={[styles.sub, online && styles.subOnline]} numberOfLines={1}>
                      {online ? 'Online now' : mutual ? 'Follows you' : p?.bio}
                    </Text>
                  )}
                </View>
                {id !== myUid && p && (
                  <TouchableOpacity
                    style={[styles.followBtn, following && styles.followingBtn]}
                    activeOpacity={0.8}
                    hitSlop={tap40}
                    onPress={() => { void toggleFollow(id); }}
                    accessibilityRole="button"
                    accessibilityLabel={following ? `Unfollow ${display}` : `Follow ${display}`}
                  >
                    <MaterialIcons name={following ? 'check' : 'person-add-alt-1'} size={14} color={following ? '#806806' : '#FFF7FF'} />
                    <Text style={[styles.followText, following && styles.followingText]}>
                      {following ? 'Following' : (isMine && tab === 'followers' ? 'Follow back' : 'Follow')}
                    </Text>
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
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
    backgroundColor: '#FFFDF8',
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '900', color: '#4B0054', fontFamily: 'serif' },
  tabs: {
    flexDirection: 'row', marginHorizontal: 16, marginTop: 4, padding: 4, borderRadius: 18,
    backgroundColor: '#F6EEDD', borderWidth: 1, borderColor: '#EAD8A9',
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 14 },
  tabActive: { backgroundColor: '#4B0054' },
  tabCount: { fontSize: 18, fontWeight: '900', color: '#4B0054' },
  tabLabel: { fontSize: 11, fontWeight: '900', color: '#9A856E' },
  tabTextActive: { color: '#FFF7FF' },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 10,
    paddingHorizontal: 12, height: 42, borderRadius: 14,
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#EAD8A9',
  },
  searchInput: { flex: 1, fontSize: 14, color: '#4B0054', paddingVertical: 0 },
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
  onlineDot: {
    position: 'absolute', right: 0, bottom: 0, width: 13, height: 13, borderRadius: 7,
    backgroundColor: '#5BBF3A', borderWidth: 2, borderColor: '#FFFFFF',
  },
  name: { fontSize: 15, fontWeight: '800', color: '#4B0054' },
  sub: { marginTop: 2, fontSize: 12, color: '#9A856E' },
  subOnline: { color: '#5E8D48', fontWeight: '800' },
  followBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    height: 34, paddingHorizontal: 12, borderRadius: 17, backgroundColor: '#4B0054',
  },
  followingBtn: { backgroundColor: '#FFF8DD', borderWidth: 1, borderColor: '#D4B142' },
  followText: { color: '#FFF7FF', fontSize: 12, fontWeight: '900' },
  followingText: { color: '#806806' },
  empty: { alignItems: 'center', paddingTop: 70, paddingHorizontal: 24, gap: 10 },
  emptyTitle: { fontSize: 20, fontWeight: '900', color: '#4B0054', fontFamily: 'serif' },
  emptyText: { fontSize: 14, color: '#8A7E74', textAlign: 'center', lineHeight: 20 },
});
