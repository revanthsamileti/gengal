import React, { useEffect, useRef, useState } from 'react';
import {
  Platform, View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Animated,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import ScreenShell from '../components/ScreenShell';
import TopBar from '../components/TopBar';
import BottomNav from '../components/BottomNav';
import GengalAvatar from '../components/GengalAvatar';
import { auth, db } from '../config/firebase';
import { collection, query, where, orderBy, onSnapshot, limit } from 'firebase/firestore';
import { subscribeToConversations, Conversation } from '../services/chatService';
import { getUserProfile, UserProfile } from '../services/userService';

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

  // durationSeconds is a float: the server bills against its own clock and
  // stores the exact elapsed time, so `% 60` produced labels like "1.471264s".
  // Round to whole seconds for display -- the precise value still drives
  // billing, it just has no business being shown to a person.
  const totalSecs = Math.max(0, Math.round(record.durationSeconds));
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
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
              {/* Two decimals rather than the raw float: a per-second rate
                  yields values like 0.735632, and "-0.735632" on a call row is
                  noise. Short calls still show a non-zero cost. */}
              <Text style={styles.statText}>-{record.coinsSpent.toFixed(2)}</Text>
            </View>
          )}
          {!isCaller && record.heartsEarned > 0 && (
            <View style={[styles.statPill, styles.heartPill]}>
              <MaterialIcons name="favorite" size={11} color="#C9504B" />
              <Text style={[styles.statText, { color: '#C9504B' }]}>+{Math.round(record.heartsEarned)}</Text>
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
  const [loadError, setLoadError] = useState(false);

  const [tab, setTab] = useState<'calls' | 'chats'>('calls');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [chatsLoading, setChatsLoading] = useState(true);
  const [chatsError, setChatsError] = useState(false);
  // uid -> profile, so a conversation row can show a face and a name. The chat
  // document stores only participant uids; looking each peer up once and
  // caching avoids re-reading the same profile on every snapshot.
  const [peers, setPeers] = useState<Record<string, UserProfile>>({});

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) { setChatsLoading(false); return; }
    const unsubscribe = subscribeToConversations(
      uid,
      (rows) => {
        setChatsError(false);
        setConversations(rows);
        setChatsLoading(false);
      },
      () => {
        // Surfaced rather than swallowed: an empty list and a failed listener
        // look identical, and "no chats yet" is the wrong thing to tell someone
        // whose conversations simply could not be read.
        setChatsError(true);
        setChatsLoading(false);
      },
    );
    return unsubscribe;
  }, []);

  useEffect(() => {
    // Fetch only peers not already cached, so this does nothing on the common
    // re-render and never re-reads a profile it has.
    const missing = conversations.map(c => c.peerUid).filter(uid => uid && !peers[uid]);
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const fetched = await Promise.all(missing.map(uid => getUserProfile(uid).catch(() => null)));
      if (cancelled) return;
      const next: Record<string, UserProfile> = {};
      missing.forEach((uid, i) => { if (fetched[i]) next[uid] = fetched[i] as UserProfile; });
      if (Object.keys(next).length) setPeers(prev => ({ ...prev, ...next }));
    })();
    return () => { cancelled = true; };
  }, [conversations, peers]);

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
    }, (e) => {
      // Previously this only called setLoading(false), so a permission error or
      // missing Firestore index on the callerUid query silently left the screen
      // showing an empty list — indistinguishable from "no calls yet".
      // The receiver listener already set loadError correctly; now both do.
      console.warn('[Activity] Caller history subscription failed:', e?.message ?? e);
      setLoadError(true);
      setLoading(false);
    });

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
    }, (e) => {
      console.warn('[Activity] Call history subscription failed:', e?.message ?? e);
      setLoadError(true);
      setLoading(false);
    });

    return () => { unsubCaller(); unsubReceiver(); };
  }, []);

  const totalSeconds = calls.reduce((s, c) => s + c.durationSeconds, 0);
  const totalMins = Math.floor(totalSeconds / 60);
  // Show seconds while under a minute rather than a flat "0m", which read as
  // "you have never talked to anyone" right after a real call.
  const talkTimeLabel = totalMins > 0 ? `${totalMins}m` : `${Math.round(totalSeconds)}s`;
  // Coins accrue per-second and are therefore fractional. Summing them raw put
  // "0.735632" on screen under COINS SPENT; the ledger keeps full precision,
  // the summary card does not need it.
  const totalCoins = Math.round(
    calls.filter(c => c.role === 'caller').reduce((s, c) => s + c.coinsSpent, 0),
  );
  const totalHearts = Math.round(
    calls.filter(c => c.role === 'receiver').reduce((s, c) => s + c.heartsEarned, 0),
  );

  return (
    <ScreenShell tone="light">
      <View style={styles.phone}>
        <TopBar navigate={navigate} />

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Header */}
          <Text style={styles.pageTitle}>{tab === 'calls' ? 'Recent Calls' : 'Messages'}</Text>

          {/* Calls / Chats switch. Unread total sits on the tab so an unopened
              message is visible without leaving whichever tab you are on. */}
          <View style={styles.tabRow}>
            {(['calls', 'chats'] as const).map((key) => {
              const active = tab === key;
              const unread = conversations.reduce((s, c) => s + c.unreadCount, 0);
              return (
                <TouchableOpacity
                  key={key}
                  style={[styles.tabBtn, active && styles.tabBtnActive]}
                  onPress={() => setTab(key)}
                  activeOpacity={0.85}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={
                    key === 'chats' && unread > 0
                      ? `Messages tab, ${unread} unread`
                      : `${key === 'calls' ? 'Calls' : 'Messages'} tab`
                  }
                >
                  <MaterialIcons
                    name={key === 'calls' ? 'call' : 'chat-bubble-outline'}
                    size={17}
                    color={active ? '#4B0054' : '#A99A86'}
                  />
                  <Text style={[styles.tabText, active && styles.tabTextActive]}>
                    {key === 'calls' ? 'Calls' : 'Messages'}
                  </Text>
                  {key === 'chats' && unread > 0 ? (
                    <View style={styles.tabBadge}>
                      <Text style={styles.tabBadgeText}>{unread > 99 ? '99+' : unread}</Text>
                    </View>
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>

          {tab === 'chats' ? (
            chatsLoading ? (
              <View style={styles.empty}>
                <MaterialIcons name="hourglass-empty" size={44} color="#D1B23B" />
                <Text style={styles.emptyTitle}>Loading…</Text>
              </View>
            ) : chatsError ? (
              <View style={styles.empty}>
                <MaterialIcons name="cloud-off" size={52} color="#D1B23B" />
                <Text style={styles.emptyTitle}>Could not load your messages</Text>
                <Text style={styles.emptySub}>Check your connection and try again.</Text>
              </View>
            ) : conversations.length === 0 ? (
              <View style={styles.empty}>
                <MaterialIcons name="chat-bubble-outline" size={52} color="#D1B23B" />
                <Text style={styles.emptyTitle}>No messages yet</Text>
                <Text style={styles.emptySub}>Say hello to someone and it will show up here</Text>
                <TouchableOpacity style={styles.goBtn} onPress={() => navigate('Personal')}>
                  <Text style={styles.goBtnText}>Find someone to talk to</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.list}>
                {conversations.map((c) => {
                  const peer = peers[c.peerUid];
                  const name = peer?.nickname || peer?.username || 'User';
                  return (
                    <TouchableOpacity
                      key={c.id}
                      style={styles.chatRow}
                      activeOpacity={0.85}
                      accessibilityRole="button"
                      accessibilityLabel={
                        c.unreadCount > 0
                          ? `Chat with ${name}, ${c.unreadCount} unread`
                          : `Chat with ${name}`
                      }
                      onPress={() =>
                        navigate('Chat', {
                          profileName: name,
                          matchData: { ...(peer || {}), uid: c.peerUid, name },
                        })
                      }
                    >
                      {/* Same avatar hierarchy as everywhere else: builder
                          avatar, then a photo, then an icon -- never an Image
                          with an empty uri. */}
                      {peer?.avatarData ? (
                        <GengalAvatar data={peer.avatarData} size={46} />
                      ) : (
                        <View style={styles.chatAvatarEmpty}>
                          <MaterialIcons name="person" size={24} color="#C9BDB2" />
                        </View>
                      )}

                      <View style={styles.chatBody}>
                        <Text style={styles.chatName} numberOfLines={1}>{name}</Text>
                        <Text
                          style={[styles.chatPreview, c.unreadCount > 0 && styles.chatPreviewUnread]}
                          numberOfLines={1}
                        >
                          {c.lastMessage}
                        </Text>
                      </View>

                      {c.unreadCount > 0 ? (
                        <View style={styles.chatBadge}>
                          <Text style={styles.chatBadgeText}>
                            {c.unreadCount > 99 ? '99+' : c.unreadCount}
                          </Text>
                        </View>
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )
          ) : (
          <>
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
                <Text style={styles.statValue}>{talkTimeLabel}</Text>
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
          ) : loadError ? (
            <View style={styles.empty}>
              <MaterialIcons name="cloud-off" size={52} color="#D1B23B" />
              <Text style={styles.emptyTitle}>Could not load your calls</Text>
              <Text style={styles.emptySub}>Check your connection and try again.</Text>
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
          </>
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

  tabRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#F0E4D2',
    backgroundColor: '#FFFDF8',
  },
  tabBtnActive: { backgroundColor: '#FFE899', borderColor: '#F0D68A' },
  tabText: { fontSize: 13, fontWeight: '800', color: '#A99A86' },
  tabTextActive: { color: '#4B0054' },
  tabBadge: {
    minWidth: 20,
    paddingHorizontal: 5,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#C9504B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBadgeText: { color: '#FFF', fontSize: 11, fontWeight: '800' },

  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 18,
    backgroundColor: '#FFFDF8',
    borderWidth: 1,
    borderColor: '#F5EADB',
    marginBottom: 10,
  },
  chatAvatarEmpty: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#F2ECE4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatBody: { flex: 1, minWidth: 0, gap: 2 },
  chatName: { fontSize: 14.5, fontWeight: '800', color: '#4B0054' },
  chatPreview: { fontSize: 12.5, fontWeight: '600', color: '#A99A86' },
  chatPreviewUnread: { color: '#6B5F57', fontWeight: '800' },
  chatBadge: {
    minWidth: 22,
    paddingHorizontal: 6,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#C9504B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatBadgeText: { color: '#FFF', fontSize: 11.5, fontWeight: '800' },

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
