import React, { useMemo, useState, useEffect } from 'react';
import { tap33, tap34, tap38 } from '../theme/touch';
import {
  Platform,
  Image,
  Modal,
  Pressable,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Dimensions,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';

import ScreenShell from '../components/ScreenShell';
import TopBar from '../components/TopBar';
import BottomNav from '../components/BottomNav';
import GengalAvatar from '../components/GengalAvatar';
import { subscribeToOnlineUsers, toggleActiveMode, UserProfile as FirebaseUser } from '../services/userService';
import { findMatch } from '../services/matchService';
import { auth } from '../config/firebase';
import { useUser } from '../context/UserContext';
import ConnectingOverlay from '../components/ConnectingOverlay';
import { Alert } from '../components/CustomAlert';
import { useActionLock } from '../hooks/useActionLock';
import { SAMPLE_PROFILES } from '../data/sampleProfiles';
import { subscribeToGlobalSettings } from '../services/adminService';

type MatchNode = {
  uid?: string;
  name: string;
  age: number;
  language: string;
  tier: 'ELITE' | 'VIP' | 'STANDARD';
  image: string;
  avatarData?: any;
  modes: Array<'call' | 'video'>;
  city?: string;
  isOnline?: boolean;
  popularityScore?: number;
  isBusy?: boolean;
  waitlistPriorityActive?: boolean;
  /**
   * Seeded demo profile, not a real account. These keep the grid from looking
   * empty but have no uid behind them, so they must never be callable — a call
   * placed against one would ring a user that does not exist.
   */
  isSampleProfile?: boolean;
};

type PersonalScreenProps = {
  navigate: (screen: string, params?: any) => void;
  goBack?: () => void;
};

const SCREEN_WIDTH = Math.min(Dimensions.get('window').width, 460);

/** Per-minute cost shown inside a Call/Video pill. */
function PriceStars({ amount, tone }: { amount: number; tone: 'gold' | 'light' | 'muted' }) {
  const color = tone === 'light' ? '#F3D98A' : tone === 'muted' ? '#A99A86' : '#9A7A05';
  return (
    <View style={styles.pillPrice}>
      <MaterialIcons name="star" size={12} color={tone === 'muted' ? '#C4B9A6' : '#F0B71C'} />
      <Text style={[styles.pillPriceText, { color }]} numberOfLines={1}>{amount}/m</Text>
    </View>
  );
}

function ActionButtonsBar({
  modes,
  node,
  navigate,
  onCallPress,
  onJoinWaitlist,
  waitlistStatus,
  rates,
}: {
  modes: Array<'call' | 'video'>;
  node: MatchNode;
  navigate: PersonalScreenProps['navigate'];
  onCallPress: (node: MatchNode, mode: 'call' | 'video') => void;
  onJoinWaitlist: (node: MatchNode) => void;
  waitlistStatus?: 'none' | 'waiting' | 'ready';
  rates: { call: number; video: number };
}) {
  // Seeded demo profiles have no real account behind them. Keep the same two
  // controls so the row still reads as a profile, but mute them and let the tap
  // fall through to launchCall, which explains why it cannot connect. A full
  // width grey pill here made every card in the list look broken.
  if (node.isSampleProfile) {
    return (
      <View style={styles.buttonsRow}>
        <TouchableOpacity
          activeOpacity={0.85}
          style={[styles.callPillBtn, styles.pillMuted]}
          onPress={() => onCallPress(node, 'call')}
          accessibilityRole="button"
          accessibilityLabel={`Call ${node.name} — sample profile, not connectable`}
        >
          <MaterialIcons name="phone" size={18} color="#A99A86" />
          <PriceStars amount={rates.call} tone="muted" />
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.85}
          style={[styles.videoPillBtn, styles.pillMuted]}
          hitSlop={tap38}
          onPress={() => onCallPress(node, 'video')}
          accessibilityRole="button"
          accessibilityLabel={`Video call ${node.name} — sample profile, not connectable`}
        >
          <MaterialIcons name="videocam" size={19} color="#A99A86" />
          <PriceStars amount={rates.video} tone="muted" />
        </TouchableOpacity>
      </View>
    );
  }

  if (node.isBusy) {
    const isWaiting = waitlistStatus === 'waiting';
    return (
      <View style={styles.buttonsRow}>
        <TouchableOpacity
          activeOpacity={0.85}
          style={[styles.waitlistBtn, isWaiting && styles.waitlistBtnWaiting]}
          hitSlop={tap38}
          onPress={() => onJoinWaitlist(node)}
          disabled={isWaiting}
        >
          <MaterialIcons name={isWaiting ? "check-circle" : "stars"} size={17} color={isWaiting ? "#15803D" : "#B45309"} />
          <Text style={[styles.waitlistBtnText, isWaiting && styles.waitlistBtnTextWaiting]}>
            {isWaiting ? 'On Priority Waitlist' : 'Join Priority Waitlist'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.buttonsRow}>
      {modes.includes('call') && (
        <TouchableOpacity
          activeOpacity={0.85}
          style={styles.callPillBtn}
          onPress={() => onCallPress(node, 'call')}
          accessibilityRole="button"
          accessibilityLabel={`Call ${node.name}, ${rates.call} coins per minute`}
        >
          <MaterialIcons name="phone" size={18} color="#6E5211" />
          <PriceStars amount={rates.call} tone="gold" />
        </TouchableOpacity>
      )}

      {modes.includes('video') && (
        <TouchableOpacity
          activeOpacity={0.85}
          style={styles.videoPillBtn}
          hitSlop={tap38}
          onPress={() => onCallPress(node, 'video')}
          accessibilityRole="button"
          accessibilityLabel={`Video call ${node.name}, ${rates.video} coins per minute`}
        >
          <MaterialIcons name="videocam" size={19} color="#FFF" />
          <PriceStars amount={rates.video} tone="light" />
        </TouchableOpacity>
      )}
    </View>
  );
}

function FloatingProfileRow({
  node,
  index,
  isLast,
  navigate,
  onCallPress,
  onJoinWaitlist,
  waitlistStatus,
  rates,
}: {
  node: MatchNode;
  index: number;
  isLast: boolean;
  navigate: PersonalScreenProps['navigate'];
  onCallPress: (node: MatchNode, mode: 'call' | 'video') => void;
  onJoinWaitlist: (node: MatchNode) => void;
  waitlistStatus?: 'none' | 'waiting' | 'ready';
  rates: { call: number; video: number };
}) {
  const isLeft = index % 2 === 0;
  const [isLiked, setIsLiked] = useState(false);

  // Avatar Assembly (Big golden rim circle + heart rim icon + background dashed heart)
  const AvatarAssembly = (
    <View style={styles.avatarAssembly}>
      <TouchableOpacity
        activeOpacity={0.92}
        style={[
          styles.avatarCircleOuter,
          node.isBusy
            ? { 
                backgroundColor: '#9B1B30', // Red velvet for busy users
                borderColor: '#FB7185',     // Luminous ruby glow rim
                borderWidth: 2,
                shadowColor: '#F43F5E',     // 360-degree red glow
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.95,
                shadowRadius: 15,
                elevation: 20,
              }
            : node.isOnline
            ? { 
                backgroundColor: '#15803D', // Dark green for active users
                borderColor: '#4ADE80',     // Luminous emerald glow rim
                borderWidth: 2,
                shadowColor: '#22C55E',     // 360-degree green glow
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.95,
                shadowRadius: 15,
                elevation: 20,
              }
            : null
        ]}
        onPress={() => navigate('Profile', { profileName: node.name, matchData: node })}
      
        accessibilityRole="button"
        accessibilityLabel="Open this profile">
        <View style={styles.avatarCircleInner}>
          {node.avatarData ? (
            <GengalAvatar data={node.avatarData} size={102} />
          ) : (
            <Image source={{ uri: node.image }} style={styles.avatarImage} />
          )}
        </View>
      </TouchableOpacity>

      {/* Cute Rim Heart Like Button */}
      <TouchableOpacity 
        style={[
          styles.rimHeartBadge,
          isLiked && { backgroundColor: '#FFF0F5', borderColor: '#E83F6F' }
        ]}
        hitSlop={tap33} 
        activeOpacity={0.8}
        onPress={() => setIsLiked(!isLiked)}
        accessibilityRole="button"
        accessibilityLabel={isLiked ? `Unlike ${node.name}` : `Like ${node.name}`}
        accessibilityState={{ selected: isLiked }}
      >
        <MaterialIcons 
          name={isLiked ? "favorite" : "favorite-border"} 
          size={17} 
          color={isLiked ? "#E83F6F" : "#82611A"} 
        />
      </TouchableOpacity>
    </View>
  );

  // Floating Cream-White Glass Card
  const DetailsCard = (
    <View style={[styles.detailsCard, isLeft ? { marginLeft: 14 } : { marginRight: 14 }]}>
      <TouchableOpacity
        activeOpacity={0.92}
        onPress={() => navigate('Profile', { profileName: node.name, matchData: node })}
      >
        {/* Name and Age Row */}
        <View style={styles.nameAgeRow}>
          <Text style={styles.nameTypography} numberOfLines={1}>
            {node.name}
          </Text>
          <Text style={styles.ageTypography}>{node.age}</Text>
        </View>

        {/* Busy or Priority status badges */}
        {node.isBusy ? (
          <View style={styles.busyBadge}>
            <Text style={styles.busyBadgeText}>🔴 Busy in Call</Text>
          </View>
        ) : node.waitlistPriorityActive ? (
          <View style={styles.priorityBadge}>
            <Text style={styles.priorityBadgeText}>⚡ 5s Priority Window</Text>
          </View>
        ) : null}

        {/* Language & Location */}
        <View style={styles.langRow}>
          <MaterialIcons name="language" size={14} color="#8A6C28" />
          <Text style={styles.langText}>{node.language}</Text>
        </View>
        {node.city ? (
          <View style={styles.stateRow}>
            <MaterialIcons name="location-on" size={13} color="#8A6C28" />
            <Text style={styles.stateText}>{node.city}</Text>
          </View>
        ) : null}
      </TouchableOpacity>

      {/* Action Buttons */}
      <View style={styles.actionSection}>
        <ActionButtonsBar
          modes={node.modes}
          node={node}
          navigate={navigate}
          onCallPress={onCallPress}
          onJoinWaitlist={onJoinWaitlist}
          waitlistStatus={waitlistStatus}
          rates={rates}
        />
      </View>
    </View>
  );

  return (
    <View style={styles.rowWrapper}>
      <View style={styles.floatingContentRow}>
        {isLeft ? (
          <>
            {AvatarAssembly}
            {DetailsCard}
          </>
        ) : (
          <>
            {DetailsCard}
            {AvatarAssembly}
          </>
        )}
      </View>
    </View>
  );
}

function LanguageFilter({
  selected,
  onSelect,
  languages,
}: {
  selected: string;
  onSelect: (lang: string) => void;
  languages: string[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedLabel = selected === 'ALL' ? 'All Languages' : selected.toUpperCase();

  return (
    <View style={styles.filterWrap}>
      <TouchableOpacity hitSlop={tap38} activeOpacity={0.86} style={styles.filterBtn} onPress={() => setIsOpen(true)}>
        <View style={styles.globeCircle}>
          <MaterialIcons name="translate" size={15} color="#826416" />
        </View>
        <Text style={styles.filterText}>{selectedLabel}</Text>
        <MaterialIcons name="expand-more" size={19} color="#826416" />
      </TouchableOpacity>

      <Modal visible={isOpen} transparent animationType="fade" onRequestClose={() => setIsOpen(false)}>
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setIsOpen(false)} />
          <BlurView intensity={85} tint="light" style={styles.modalSheet}>
            <View style={styles.sheetHeader}>
              <View style={styles.sheetTitleRow}>
                <MaterialIcons name="translate" size={21} color="#5C1A5A" />
                <Text style={styles.sheetTitle}>Filter by Language</Text>
              </View>
              <TouchableOpacity hitSlop={tap34} style={styles.closeBtn} onPress={() => setIsOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Close">
                <MaterialIcons name="close" size={19} color="#5C1A5A" />
              </TouchableOpacity>
            </View>

            <View style={styles.sheetList}>
              {languages.map((lang) => {
                const isSelected = lang === selected;
                const label = lang === 'ALL' ? 'All Languages' : lang.toUpperCase();
                return (
                  <TouchableOpacity
                    key={lang}
                    activeOpacity={0.8}
                    style={[styles.sheetItem, isSelected && styles.sheetItemSelected]}
                    onPress={() => {
                      onSelect(lang);
                      setIsOpen(false);
                    }}
                  >
                    <Text style={[styles.sheetItemText, isSelected && styles.sheetItemTextSelected]}>{label}</Text>
                    {isSelected && <MaterialIcons name="check-circle" size={21} color="#5C1A5A" />}
                  </TouchableOpacity>
                );
              })}
            </View>
          </BlurView>
        </View>
      </Modal>
    </View>
  );
}

const STATUS_OPTIONS = [
  { key: 'ALL', label: 'All Status', icon: 'groups', color: '#826416' },
  { key: 'AVAILABLE_NOW', label: 'Available Now', icon: 'fiber-manual-record', color: '#10B981' },
  { key: 'NON_BUSY', label: 'Non-Busy', icon: 'phone-enabled', color: '#3B82F6' },
  { key: 'NON_WAITING_LIST', label: 'Non-Waiting List', icon: 'person-outline', color: '#8B5CF6' },
  { key: 'WAITING_LIST', label: 'Waiting List', icon: 'hourglass-full', color: '#D97706' },
];

type SortOption = 'status' | 'state' | 'recent' | 'popular' | 'age' | 'mode';

const SORT_OPTIONS: { key: SortOption; label: string; icon: string }[] = [
  { key: 'status', label: 'All Status', icon: 'groups' },
  { key: 'state', label: 'State', icon: 'location-on' },
  { key: 'recent', label: 'Recently Joined', icon: 'schedule' },
  { key: 'popular', label: 'Popular', icon: 'local-fire-department' },
  { key: 'age', label: 'Age', icon: 'cake' },
  { key: 'mode', label: 'Mode of Call', icon: 'phone-in-talk' },
];

export default function PersonalScreen({ navigate }: PersonalScreenProps) {
  const [selectedLanguage, setSelectedLanguage] = useState('ALL');
  const [selectedStatus, setSelectedStatus] = useState('ALL');
  const [isStatusPickerOpen, setIsStatusPickerOpen] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption | null>(null);
  const [selectedState, setSelectedState] = useState('ALL');
  const [isStatePickerOpen, setIsStatePickerOpen] = useState(false);
  const [selectedMode, setSelectedMode] = useState<'ALL' | 'call' | 'video'>('ALL');
  const [isModePickerOpen, setIsModePickerOpen] = useState(false);
  const [firebaseUsers, setFirebaseUsers] = useState<FirebaseUser[]>([]);
  const { profile: myProfile } = useUser();
  const [isSearching, setIsSearching] = useState(false);
  const { run: runCall } = useActionLock();
  const [searchCleanup, setSearchCleanup] = useState<(() => void) | null>(null);
  const [isMyActiveMode, setIsMyActiveMode] = useState(true);
  const [waitlistMap, setWaitlistMap] = useState<Record<string, 'waiting' | 'ready'>>({});
  const [freedMatchIds, setFreedMatchIds] = useState<Record<string, boolean>>({});
  // One listener for the whole list. CallPriceTag opens its own per instance,
  // which would be two per profile row here. Defaults match its fallbacks.
  const [rates, setRates] = useState({ call: 15, video: 30 });

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
  const [readyWaitlistModal, setReadyWaitlistModal] = useState<{ match: MatchNode; countdown: number } | null>(null);
  const [holdModal, setHoldModal] = useState<{ match: MatchNode; mode: 'call' | 'video'; timeLeft: number } | null>(null);

  useEffect(() => {
    let timer: any;
    if (readyWaitlistModal && readyWaitlistModal.countdown > 0) {
      timer = setTimeout(() => {
        setReadyWaitlistModal((prev) => (prev ? { ...prev, countdown: prev.countdown - 1 } : null));
      }, 1000);
    } else if (readyWaitlistModal && readyWaitlistModal.countdown === 0) {
      setReadyWaitlistModal(null);
    }
    return () => clearTimeout(timer);
  }, [readyWaitlistModal]);

  useEffect(() => {
    let timer: any;
    if (holdModal && holdModal.timeLeft > 0) {
      timer = setTimeout(() => {
        setHoldModal((prev) => (prev ? { ...prev, timeLeft: prev.timeLeft - 1 } : null));
      }, 1000);
    } else if (holdModal && holdModal.timeLeft === 0) {
      const { match, mode } = holdModal;
      setHoldModal(null);
      void launchCall(match, mode);
    }
    return () => clearTimeout(timer);
  }, [holdModal]);

  const handleJoinWaitlist = (node: MatchNode) => {
    const key = node.uid || '';
    setWaitlistMap((prev) => ({ ...prev, [key]: 'waiting' }));
    // Simulate receiver finishing their call after 4 seconds
    setTimeout(() => {
      setWaitlistMap((prev) => ({ ...prev, [key]: 'ready' }));
      setFreedMatchIds((prev) => ({ ...prev, [key]: true }));
      setReadyWaitlistModal({ match: node, countdown: 5 });
    }, 4000);
  };

  /**
   * The single door to CallScreen. Every entry point (cards, hold modal,
   * waitlist modal) goes through here so the sample-profile block and the
   * double-tap lock cannot be bypassed by adding a new button later.
   */
  const launchCall = (node: MatchNode, mode: 'call' | 'video') =>
    runCall(() => {
      if (node.isSampleProfile) {
        Alert.alert(
          'Sample profile',
          `${node.name} is a sample profile used to preview the app and cannot be called.`,
          [{ text: 'OK' }]
        );
        return;
      }
      navigate('Call', { profileName: node.name, mode, isCaller: true, matchData: node });
    });

  const handleCallPress = (node: MatchNode, mode: 'call' | 'video') => {
    if (node.isSampleProfile) {
      void launchCall(node, mode);
      return;
    }
    const key = node.uid || '';
    const wasOnWaitlist = waitlistMap[key] === 'ready' || waitlistMap[key] === 'waiting';
    const isPriorityWindowActive = node.waitlistPriorityActive || (freedMatchIds[key] && !wasOnWaitlist);

    if (isPriorityWindowActive && !wasOnWaitlist) {
      // Non-waitlist caller must wait 5 seconds for priority window!
      setHoldModal({ match: node, mode, timeLeft: 5 });
    } else {
      void launchCall(node, mode);
    }
  };

  useEffect(() => {
    if (myProfile?.isActiveMode !== undefined) {
      setIsMyActiveMode(myProfile.isActiveMode);
    }
  }, [myProfile]);

  const handleToggleActiveMode = async () => {
    const newVal = !isMyActiveMode;
    setIsMyActiveMode(newVal);
    if (auth.currentUser?.uid) {
      try {
        await toggleActiveMode(auth.currentUser.uid, newVal);
      } catch (err) {
        console.warn('Failed to toggle active mode', err);
      }
    }
  };

  useEffect(() => {
    const unsubscribe = subscribeToOnlineUsers((users) => {
      setFirebaseUsers(users);
    }, auth.currentUser?.uid, false);
    return () => unsubscribe();
  }, []);

  const MATCHES: MatchNode[] = useMemo(() => {
    // Base data lives in src/data/sampleProfiles so the More Connects directory
    // renders the same people. Only the busy/waitlist state is layered on here,
    // because it depends on this screen's runtime freedMatchIds.
    const defaultReferenceProfiles: MatchNode[] = SAMPLE_PROFILES.map((p) => {
      if (p.uid === 'ref_aanya') {
        return { ...p, isBusy: false, waitlistPriorityActive: true };
      }
      if (p.uid === 'ref_chloe' || p.uid === 'ref_valeria') {
        return {
          ...p,
          isBusy: !freedMatchIds[p.uid],
          waitlistPriorityActive: !!freedMatchIds[p.uid],
        };
      }
      return { ...p };
    });

    if (!firebaseUsers || firebaseUsers.length === 0) {
      return defaultReferenceProfiles.filter((p) => p.isOnline !== false);
    }

    const convertedFirebase: MatchNode[] = firebaseUsers.map((u, index) => {
      const fallback = defaultReferenceProfiles[index % defaultReferenceProfiles.length];
      const isOnline = u.isOnline ?? fallback.isOnline;
      const popularityScore = (u.hearts || 0) * 10 + (u.totalReceivedCallSeconds || 0) + (isOnline ? 5000 : 0) + (fallback.popularityScore || 500);
      const uid = u.uid || `fb_${index}`;
      return {
        uid,
        name: u.nickname || u.username || fallback.name,
        age: Number(u.age) || fallback.age,
        language: u.language || fallback.language,
        tier: u.tier === 'VIP' ? 'VIP' : 'STANDARD',
        image: u.avatarUrl || fallback.image,
        avatarData: u.avatarData,
        modes: ['call', 'video'],
        city: u.state || u.city || fallback.city,
        isOnline,
        popularityScore,
        isBusy: fallback.isBusy && !freedMatchIds[uid],
        waitlistPriorityActive: fallback.waitlistPriorityActive || !!freedMatchIds[uid],
      };
    });

    return [...defaultReferenceProfiles, ...convertedFirebase].filter((p) => p.isOnline !== false);
  }, [firebaseUsers, freedMatchIds]);

  const LANGUAGES = useMemo(() => ['ALL', 'ENGLISH', 'HINDI', 'SPANISH', 'FRENCH'], []);

  const STATES = useMemo(() => {
    const stateSet = new Set<string>();
    MATCHES.forEach((m) => { if (m.city) stateSet.add(m.city); });
    return ['ALL', ...Array.from(stateSet).sort()];
  }, [MATCHES]);

  const sortedMatches = useMemo(() => {
    let filtered = MATCHES;
    if (selectedLanguage !== 'ALL') {
      filtered = filtered.filter((match) => {
        const matchLang = match.language.toUpperCase();
        const target = selectedLanguage.toUpperCase();
        if (target === 'HI' || target === 'HINDI') return matchLang === 'HINDI' || matchLang === 'HI';
        if (target === 'EN' || target === 'ENGLISH') return matchLang === 'ENGLISH' || matchLang === 'EN';
        if (target === 'ES' || target === 'SPANISH') return matchLang === 'SPANISH' || matchLang === 'ES';
        return matchLang.includes(target);
      });
    }

    // Filter by selected state
    if (selectedState !== 'ALL') {
      filtered = filtered.filter((match) => match.city === selectedState);
    }

    // Filter by selected mode of call
    if (selectedMode !== 'ALL') {
      filtered = filtered.filter((match) => match.modes.includes(selectedMode));
    }

    // Filter by selected status dropdown (Available Now, Non-Busy, Non-Waiting List, Waiting List)
    if (selectedStatus === 'AVAILABLE_NOW') {
      filtered = filtered.filter((match) => match.isOnline && !match.isBusy && !match.waitlistPriorityActive);
    } else if (selectedStatus === 'NON_BUSY') {
      filtered = filtered.filter((match) => !match.isBusy);
    } else if (selectedStatus === 'WAITING_LIST') {
      filtered = filtered.filter((match) => (match.uid && (waitlistMap[match.uid] === 'waiting' || waitlistMap[match.uid] === 'ready')) || match.waitlistPriorityActive);
    } else if (selectedStatus === 'NON_WAITING_LIST') {
      filtered = filtered.filter((match) => (!match.uid || (waitlistMap[match.uid] !== 'waiting' && waitlistMap[match.uid] !== 'ready')) && !match.waitlistPriorityActive);
    }

    // Priority helper: Active call users NOT in busy state get highest priority first!
    const getActiveCallPriority = (m: any) => {
      const isCallUser = m.modes && (m.modes.includes('call') || m.modes.includes('video'));
      if (m.isOnline && !m.isBusy && isCallUser) return 3; // 1st Priority: Active call users NOT busy
      if (m.isOnline && !m.isBusy) return 2;               // 2nd Priority: Active non-busy users
      if (m.isOnline && m.isBusy) return 1;                // 3rd Priority: Active but busy users
      return 0;                                            // 4th Priority: Offline users
    };

    // Apply primary sorting priority by default
    filtered.sort((a, b) => {
      const pDiff = getActiveCallPriority(b) - getActiveCallPriority(a);
      return pDiff !== 0 ? pDiff : 0;
    });

    if (!sortBy) return filtered;

    const sorted = [...filtered];
    switch (sortBy) {
      case 'age':
        sorted.sort((a, b) => {
          const pDiff = getActiveCallPriority(b) - getActiveCallPriority(a);
          return pDiff !== 0 ? pDiff : a.age - b.age;
        });
        break;
      case 'recent':
        sorted.sort((a, b) => {
          const pDiff = getActiveCallPriority(b) - getActiveCallPriority(a);
          return pDiff !== 0 ? pDiff : 0;
        });
        break;
      case 'popular':
        sorted.sort((a, b) => {
          const pDiff = getActiveCallPriority(b) - getActiveCallPriority(a);
          return pDiff !== 0 ? pDiff : (b.popularityScore || 0) - (a.popularityScore || 0);
        });
        break;
      case 'state':
        sorted.sort((a, b) => {
          const pDiff = getActiveCallPriority(b) - getActiveCallPriority(a);
          return pDiff !== 0 ? pDiff : (a.city || '').localeCompare(b.city || '');
        });
        break;
      case 'mode':
        sorted.sort((a, b) => {
          const pDiff = getActiveCallPriority(b) - getActiveCallPriority(a);
          return pDiff !== 0 ? pDiff : b.modes.length - a.modes.length;
        });
        break;
    }
    return sorted;
  }, [selectedLanguage, selectedState, selectedMode, selectedStatus, sortBy, MATCHES, waitlistMap]);

  const handleRandomMatch = async () => {
    if (!myProfile) return;
    if (isSearching) {
      if (searchCleanup) searchCleanup();
      setIsSearching(false);
      setSearchCleanup(null);
      return;
    }
    setIsSearching(true);
    try {
      const cleanup = await findMatch(myProfile, 'call', (roomId: string, matchData: any) => {
        setIsSearching(false);
        setSearchCleanup(null);
        navigate('Match', { profileName: matchData.nickname, matchData, roomId } as any);
      });
      setSearchCleanup(() => cleanup);
    } catch {
      setIsSearching(false);
    }
  };

  return (
    <ScreenShell tone="light">
      <View style={styles.mainBox}>
        {isSearching && (
          <ConnectingOverlay
            mode="random"
            onCancel={() => {
              if (searchCleanup) searchCleanup();
              setIsSearching(false);
              setSearchCleanup(null);
            }}
          />
        )}
        <TopBar navigate={navigate} />

        <FlatList
          data={sortedMatches.length > 0 ? sortedMatches : MATCHES}
          keyExtractor={(item, idx) => item.uid || `perf-${idx}`}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <View style={styles.headerArea}>
              <View style={styles.pillsRow}>
                <TouchableOpacity style={styles.randomPill} activeOpacity={0.86} onPress={handleRandomMatch}>
                  <MaterialIcons name={isSearching ? 'close' : 'bolt'} size={21} color="#B8820B" />
                  <Text style={styles.randomPillText}>{isSearching ? 'Cancel Search' : 'Random Match'}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.connectsPill}
                  activeOpacity={0.86}
                  onPress={() => navigate('ActiveConnects')}
                  accessibilityRole="button"
                  accessibilityLabel="More connects, browse and search all profiles"
                >
                  <MaterialIcons name="groups" size={19} color="#B8820B" />
                  <Text style={styles.connectsPillText}>More Connects</Text>
                </TouchableOpacity>
              </View>

              {/* Show Active Status Toggle Banner */}
              <View style={styles.activeToggleBanner}>
                <View style={styles.activeToggleLeft}>
                  <View style={[styles.statusIndicatorDot, isMyActiveMode && styles.statusIndicatorDotOnline]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.activeToggleTitle}>
                      {isMyActiveMode ? 'Show Active to People: ON' : 'Show Active to People: OFF'}
                    </Text>
                    <Text style={styles.activeToggleSubtitle}>
                      {isMyActiveMode ? 'People can see your online status' : 'You appear offline to the community'}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={[styles.activeToggleBtn, isMyActiveMode && styles.activeToggleBtnOn]}
                  activeOpacity={0.85}
                  onPress={handleToggleActiveMode}
                >
                  <MaterialIcons
                    name={isMyActiveMode ? 'visibility' : 'visibility-off'}
                    size={17}
                    color={isMyActiveMode ? '#FFFFFF' : '#7A5C1F'}
                  />
                  <Text style={[styles.activeToggleBtnText, isMyActiveMode && styles.activeToggleBtnTextOn]}>
                    {isMyActiveMode ? 'Active' : 'Hidden'}
                  </Text>
                </TouchableOpacity>
              </View>

              <LanguageFilter selected={selectedLanguage} onSelect={setSelectedLanguage} languages={LANGUAGES} />

              {/* Sort Pills Row */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.sortPillsScroll}
                style={styles.sortPillsContainer}
              >
                {SORT_OPTIONS.map((opt) => {
                  const isStatusActive = opt.key === 'status' && selectedStatus !== 'ALL';
                  const isStateActive = opt.key === 'state' && selectedState !== 'ALL';
                  const isModeActive = opt.key === 'mode' && selectedMode !== 'ALL';
                  const isFilterOpt = opt.key === 'status' || opt.key === 'state' || opt.key === 'mode';
                  const isActive = (!isFilterOpt && sortBy === opt.key) || isStatusActive || isStateActive || isModeActive;
                  
                  let labelText = opt.label;
                  if (isStatusActive) {
                    const found = STATUS_OPTIONS.find((s) => s.key === selectedStatus);
                    if (found) labelText = found.label;
                  }
                  if (isStateActive) labelText = selectedState;
                  if (isModeActive) labelText = selectedMode === 'call' ? 'Audio Call' : 'Video Call';

                  return (
                    <TouchableOpacity
                      key={opt.key}
                      activeOpacity={0.8}
                      style={[styles.sortPill, isActive && styles.sortPillActive]}
                      hitSlop={tap34}
                      onPress={() => {
                        if (opt.key === 'status') {
                          setIsStatusPickerOpen(true);
                        } else if (opt.key === 'state') {
                          setIsStatePickerOpen(true);
                        } else if (opt.key === 'mode') {
                          setIsModePickerOpen(true);
                        } else {
                          setSortBy(sortBy === opt.key ? null : opt.key);
                        }
                      }}
                    >
                      <MaterialIcons
                        name={opt.icon as any}
                        size={14}
                        color={isActive ? '#FFF' : '#7A5C1F'}
                      />
                      <Text style={[styles.sortPillText, isActive && styles.sortPillTextActive]}>
                        {labelText}
                      </Text>
                      {isStatusActive && (
                        <TouchableOpacity
                          onPress={(e) => { e.stopPropagation(); setSelectedStatus('ALL'); }}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        
                          accessibilityRole="button"
                          accessibilityLabel="Close">
                          <MaterialIcons name="close" size={12} color="#FFF" style={{ marginLeft: 2 }} />
                        </TouchableOpacity>
                      )}
                      {isStateActive && (
                        <TouchableOpacity
                          onPress={(e) => { e.stopPropagation(); setSelectedState('ALL'); }}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        
                          accessibilityRole="button"
                          accessibilityLabel="Close">
                          <MaterialIcons name="close" size={12} color="#FFF" style={{ marginLeft: 2 }} />
                        </TouchableOpacity>
                      )}
                      {isModeActive && (
                        <TouchableOpacity
                          onPress={(e) => { e.stopPropagation(); setSelectedMode('ALL'); }}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        
                          accessibilityRole="button"
                          accessibilityLabel="Close">
                          <MaterialIcons name="close" size={12} color="#FFF" style={{ marginLeft: 2 }} />
                        </TouchableOpacity>
                      )}
                      {!isFilterOpt && isActive && (
                        <MaterialIcons name="close" size={12} color="#FFF" style={{ marginLeft: 2 }} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* Status Picker Modal */}
              <Modal visible={isStatusPickerOpen} transparent animationType="fade" onRequestClose={() => setIsStatusPickerOpen(false)}>
                <View style={styles.modalOverlay}>
                  <Pressable style={StyleSheet.absoluteFill} onPress={() => setIsStatusPickerOpen(false)} />
                  <BlurView intensity={85} tint="light" style={styles.modalSheet}>
                    <View style={styles.sheetHeader}>
                      <View style={styles.sheetTitleRow}>
                        <MaterialIcons name="filter-list" size={21} color="#5C1A5A" />
                        <Text style={styles.sheetTitle}>Filter by Status</Text>
                      </View>
                      <TouchableOpacity hitSlop={tap34} style={styles.closeBtn} onPress={() => setIsStatusPickerOpen(false)}
                        accessibilityRole="button"
                        accessibilityLabel="Close">
                        <MaterialIcons name="close" size={19} color="#5C1A5A" />
                      </TouchableOpacity>
                    </View>

                    <View style={styles.sheetList}>
                      {STATUS_OPTIONS.map((opt) => {
                        const isSelected = opt.key === selectedStatus;
                        return (
                          <TouchableOpacity
                            key={opt.key}
                            activeOpacity={0.8}
                            style={[styles.sheetItem, isSelected && styles.sheetItemSelected]}
                            onPress={() => {
                              setSelectedStatus(opt.key);
                              setIsStatusPickerOpen(false);
                            }}
                          >
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                              <MaterialIcons name={opt.icon as any} size={18} color={opt.color} />
                              <Text style={[styles.sheetItemText, isSelected && styles.sheetItemTextSelected]}>{opt.label}</Text>
                            </View>
                            {isSelected && <MaterialIcons name="check-circle" size={21} color="#5C1A5A" />}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </BlurView>
                </View>
              </Modal>

              {/* State Picker Modal */}
              <Modal visible={isStatePickerOpen} transparent animationType="fade" onRequestClose={() => setIsStatePickerOpen(false)}>
                <View style={styles.modalOverlay}>
                  <Pressable style={StyleSheet.absoluteFill} onPress={() => setIsStatePickerOpen(false)} />
                  <BlurView intensity={85} tint="light" style={styles.modalSheet}>
                    <View style={styles.sheetHeader}>
                      <View style={styles.sheetTitleRow}>
                        <MaterialIcons name="location-on" size={21} color="#5C1A5A" />
                        <Text style={styles.sheetTitle}>Filter by State</Text>
                      </View>
                      <TouchableOpacity hitSlop={tap34} style={styles.closeBtn} onPress={() => setIsStatePickerOpen(false)}
                        accessibilityRole="button"
                        accessibilityLabel="Close">
                        <MaterialIcons name="close" size={19} color="#5C1A5A" />
                      </TouchableOpacity>
                    </View>

                    <View style={styles.sheetList}>
                      {STATES.map((state) => {
                        const isSelected = state === selectedState;
                        const label = state === 'ALL' ? 'All States' : state;
                        return (
                          <TouchableOpacity
                            key={state}
                            activeOpacity={0.8}
                            style={[styles.sheetItem, isSelected && styles.sheetItemSelected]}
                            onPress={() => {
                              setSelectedState(state);
                              setIsStatePickerOpen(false);
                            }}
                          >
                            <Text style={[styles.sheetItemText, isSelected && styles.sheetItemTextSelected]}>{label}</Text>
                            {isSelected && <MaterialIcons name="check-circle" size={21} color="#5C1A5A" />}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </BlurView>
                </View>
              </Modal>

              {/* Mode of Call Picker Modal */}
              <Modal visible={isModePickerOpen} transparent animationType="fade" onRequestClose={() => setIsModePickerOpen(false)}>
                <View style={styles.modalOverlay}>
                  <Pressable style={StyleSheet.absoluteFill} onPress={() => setIsModePickerOpen(false)} />
                  <BlurView intensity={85} tint="light" style={styles.modalSheet}>
                    <View style={styles.sheetHeader}>
                      <View style={styles.sheetTitleRow}>
                        <MaterialIcons name="phone-in-talk" size={21} color="#5C1A5A" />
                        <Text style={styles.sheetTitle}>Select Mode of Call</Text>
                      </View>
                      <TouchableOpacity hitSlop={tap34} style={styles.closeBtn} onPress={() => setIsModePickerOpen(false)}
                        accessibilityRole="button"
                        accessibilityLabel="Close">
                        <MaterialIcons name="close" size={19} color="#5C1A5A" />
                      </TouchableOpacity>
                    </View>

                    <View style={styles.sheetList}>
                      {[
                        { key: 'ALL', label: 'All Modes (Audio & Video)', icon: 'all-inclusive' },
                        { key: 'call', label: 'Audio Call Only', icon: 'phone' },
                        { key: 'video', label: 'Video Call Only', icon: 'videocam' },
                      ].map((m) => {
                        const isSelected = m.key === selectedMode;
                        return (
                          <TouchableOpacity
                            key={m.key}
                            activeOpacity={0.8}
                            style={[styles.sheetItem, isSelected && styles.sheetItemSelected]}
                            onPress={() => {
                              setSelectedMode(m.key as any);
                              setIsModePickerOpen(false);
                            }}
                          >
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                              <MaterialIcons name={m.icon as any} size={20} color={isSelected ? '#5C1A5A' : '#7A5C1F'} />
                              <Text style={[styles.sheetItemText, isSelected && styles.sheetItemTextSelected]}>{m.label}</Text>
                            </View>
                            {isSelected && <MaterialIcons name="check-circle" size={21} color="#5C1A5A" />}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </BlurView>
                </View>
              </Modal>
            </View>
          }
          renderItem={({ item, index }) => (
            <FloatingProfileRow
              node={item}
              index={index}
              isLast={index === (sortedMatches.length > 0 ? sortedMatches.length - 1 : MATCHES.length - 1)}
              navigate={navigate}
              onCallPress={handleCallPress}
              onJoinWaitlist={handleJoinWaitlist}
              waitlistStatus={waitlistMap[item.uid || ''] || 'none'}
              rates={rates}
            />
          )}
        />

        {/* Ready Waitlist Modal (When Receiver Ends Call) */}
        <Modal
          visible={!!readyWaitlistModal}
          transparent
          animationType="fade"
          onRequestClose={() => setReadyWaitlistModal(null)}
        >
          <View style={styles.modalOverlay}>
            <BlurView intensity={90} tint="dark" style={styles.priorityModalSheet}>
              <View style={styles.priorityModalHeader}>
                <Text style={styles.priorityModalEmoji}>🎉</Text>
                <Text style={styles.priorityModalTitle}>Your Wait is Finished!</Text>
              </View>
              <Text style={styles.priorityModalDesc}>
                <Text style={{ fontWeight: '800', color: '#E83F6F' }}>{readyWaitlistModal?.match.name}</Text> just ended their call and is now free!
              </Text>
              <View style={styles.priorityBannerBox}>
                <MaterialIcons name="timer" size={20} color="#E83F6F" />
                <Text style={styles.priorityBannerText}>
                  Priority VIP Window: <Text style={{ fontWeight: '900', color: '#FFF' }}>00:0{readyWaitlistModal?.countdown || 0}s</Text>
                </Text>
              </View>
              <View style={styles.priorityModalButtons}>
                <TouchableOpacity
                  activeOpacity={0.85}
                  style={styles.priorityCallBtn}
                  onPress={() => {
                    const match = readyWaitlistModal?.match;
                    setReadyWaitlistModal(null);
                    if (match) void launchCall(match, 'call');
                  }}
                >
                  <MaterialIcons name="phone" size={20} color="#FFFFFF" />
                  <Text style={styles.priorityCallBtnText}>Audio Call Now</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.85}
                  style={styles.priorityVideoBtn}
                  onPress={() => {
                    const match = readyWaitlistModal?.match;
                    setReadyWaitlistModal(null);
                    if (match) void launchCall(match, 'video');
                  }}
                >
                  <MaterialIcons name="videocam" size={20} color="#FFFFFF" />
                  <Text style={styles.priorityVideoBtnText}>Video Call Now</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={styles.priorityDismissBtn} onPress={() => setReadyWaitlistModal(null)}>
                <Text style={styles.priorityDismissText}>Skip / Dismiss</Text>
              </TouchableOpacity>
            </BlurView>
          </View>
        </Modal>

        {/* Priority Hold Modal (Non-Waitlist Caller Waiting 5s) */}
        <Modal
          visible={!!holdModal}
          transparent
          animationType="fade"
          onRequestClose={() => setHoldModal(null)}
        >
          <View style={styles.modalOverlay}>
            <BlurView intensity={90} tint="dark" style={styles.priorityModalSheet}>
              <View style={styles.priorityModalHeader}>
                <MaterialIcons name="hourglass-empty" size={32} color="#F97316" />
                <Text style={styles.priorityModalTitle}>Priority Waitlist Hold</Text>
              </View>
              <Text style={styles.priorityModalDesc}>
                <Text style={{ fontWeight: '800', color: '#F97316' }}>{holdModal?.match.name}</Text> just finished a call. Users on the Waitlist have exclusive first-calling rights for <Text style={{ color: '#FFF', fontWeight: '800' }}>5 seconds</Text>.
              </Text>
              <View style={styles.holdCircleContainer}>
                <View style={styles.holdCircle}>
                  <Text style={styles.holdNumber}>{holdModal?.timeLeft || 0}s</Text>
                </View>
              </View>
              <Text style={styles.holdSubtext}>
                Please hold... connecting your call automatically as soon as the priority timer ends!
              </Text>
              <TouchableOpacity style={styles.priorityDismissBtn} onPress={() => setHoldModal(null)}>
                <Text style={styles.priorityDismissText}>Cancel Call</Text>
              </TouchableOpacity>
            </BlurView>
          </View>
        </Modal>

        <BottomNav active="Personal" navigate={navigate} />
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  mainBox: {
    flex: 1,
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
    backgroundColor: '#FBF8F2',
  },
  listContent: {
    paddingTop: 8,
    paddingBottom: 140,
  },
  headerArea: {
    paddingHorizontal: 16,
    marginBottom: 26,
  },
  pillsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 14,
  },
  activeToggleBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E6D3A3',
    ...Platform.select({
      android: { elevation: 3 },
      ios: { shadowColor: '#7E6507', shadowOpacity: 0.08, shadowOffset: { width: 0, height: 3 }, shadowRadius: 6 },
    }),
  },
  activeToggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    marginRight: 8,
  },
  statusIndicatorDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#C8B99C',
    borderWidth: 2,
    borderColor: '#FFF',
  },
  statusIndicatorDotOnline: {
    backgroundColor: '#10B981',
  },
  activeToggleTitle: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#3F1A3E',
  },
  activeToggleSubtitle: {
    fontSize: 11,
    color: '#7C673E',
    marginTop: 2,
  },
  activeToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: '#FFF8EA',
    borderWidth: 1,
    borderColor: '#D4B86A',
    gap: 5,
  },
  activeToggleBtnOn: {
    backgroundColor: '#52104F',
    borderColor: '#52104F',
  },
  activeToggleBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#7A5C1F',
  },
  activeToggleBtnTextOn: {
    color: '#FFFFFF',
  },
  randomPill: {
    flex: 1.1,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#FFFBF0',
    borderWidth: 1,
    borderColor: '#E6C972',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    ...Platform.select({
      android: { elevation: 3 },
      ios: { shadowColor: '#B8820B', shadowOpacity: 0.12, shadowOffset: { width: 0, height: 3 }, shadowRadius: 5 },
    }),
  },
  randomPillText: {
    color: '#805D0F',
    fontSize: 14,
    fontWeight: '800',
  },
  connectsPill: {
    flex: 0.9,
    height: 46,
    borderRadius: 23,
    // Same surface, border and label colour as randomPill: these are two peer
    // actions, so giving one its own tint made it read as the selected tab.
    backgroundColor: '#FFFBF0',
    borderWidth: 1,
    borderColor: '#E6C972',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    ...Platform.select({
      android: { elevation: 3 },
      ios: { shadowColor: '#B8820B', shadowOpacity: 0.12, shadowOffset: { width: 0, height: 3 }, shadowRadius: 5 },
    }),
  },
  connectsPillText: {
    color: '#805D0F',
    fontSize: 14,
    fontWeight: '800',
  },
  filterWrap: {
    alignItems: 'center',
  },
  filterBtn: {
    height: 38,
    borderRadius: 19,
    paddingHorizontal: 16,
    backgroundColor: '#FFFDF9',
    borderWidth: 1,
    borderColor: '#E6DBC6',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    ...Platform.select({
      android: { elevation: 2 },
      ios: { shadowColor: '#000', shadowOpacity: 0.06, shadowOffset: { width: 0, height: 2 }, shadowRadius: 4 },
    }),
  },
  globeCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FFF5DC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterText: {
    color: '#5C4926',
    fontSize: 13,
    fontWeight: '800',
  },
  sortPillsContainer: {
    marginTop: 12,
    maxHeight: 38,
  },
  sortPillsScroll: {
    gap: 8,
    paddingHorizontal: 2,
  },
  sortPill: {
    height: 34,
    borderRadius: 17,
    paddingHorizontal: 14,
    backgroundColor: '#FFFBF0',
    borderWidth: 1,
    borderColor: '#E4CC8B',
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
  },
  sortPillActive: {
    backgroundColor: '#52104F',
    borderColor: '#52104F',
  },
  sortPillText: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: '#7A5C1F',
  },
  sortPillTextActive: {
    color: '#FFF',
  },
  rowWrapper: {
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  floatingContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 2,
  },
  avatarAssembly: {
    position: 'relative',
    width: 118,
    height: 118,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  avatarCircleOuter: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: '#DCB25B',
    padding: 3.5,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    ...Platform.select({
      android: { elevation: 12 },
      ios: { shadowColor: '#A47D28', shadowOpacity: 0.25, shadowOffset: { width: 0, height: 4 }, shadowRadius: 8 },
    }),
  },
  avatarCircleInner: {
    width: 105,
    height: 105,
    borderRadius: 52.5,
    overflow: 'hidden',
    backgroundColor: '#F5ECE1',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  rimHeartBadge: {
    position: 'absolute',
    bottom: 3,
    right: 3,
    width: 33,
    height: 33,
    borderRadius: 16.5,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E6D3A3',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 25,
    ...Platform.select({
      android: { elevation: 16 },
      ios: { shadowColor: '#000', shadowOpacity: 0.15, shadowOffset: { width: 0, height: 2 }, shadowRadius: 4 },
    }),
  },
  detailsCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#F3E9D5',
    zIndex: 10,
    ...Platform.select({
      android: { elevation: 12 },
      ios: { shadowColor: '#785D2B', shadowOpacity: 0.1, shadowOffset: { width: 0, height: 5 }, shadowRadius: 10 },
    }),
  },
  nameAgeRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 7,
    marginBottom: 6,
  },
  nameTypography: {
    fontSize: 22,
    fontWeight: '900',
    color: '#4B1648',
  },
  ageTypography: {
    fontSize: 20,
    fontWeight: '700',
    color: '#8C828C',
  },
  langRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 14,
  },
  langText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#7D6123',
    letterSpacing: 0.4,
  },
  stateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: -8,
    marginBottom: 10,
  },
  stateText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8A6C28',
    letterSpacing: 0.3,
  },
  actionSection: {
    marginTop: 2,
    width: '100%',
  },
  buttonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    width: '100%',
  },
  // Applied over callPillBtn / videoPillBtn for seeded demo profiles. These must
  // stay visibly inert: without them the demo rows are indistinguishable from a
  // real, callable profile.
  pillMuted: {
    backgroundColor: '#F2F0EC',
    borderColor: '#DFD9CF',
    opacity: 0.75,
  },
  callPillBtn: {
    flex: 1,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFF9E8',
    borderWidth: 1.5,
    borderColor: '#E4CC8B',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    // Tight: these pills sit two-across inside an already narrow card and now
    // carry a price as well as an icon and label.
    paddingHorizontal: 12,
    gap: 3,
    ...Platform.select({
      android: { elevation: 2 },
      ios: { shadowColor: '#B8820B', shadowOpacity: 0.1, shadowOffset: { width: 0, height: 2 }, shadowRadius: 4 },
    }),
  },
  pillPrice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1,
    // Must not be squeezed out by the label: the price is the point of the pill.
    flexShrink: 0,
  },
  pillPriceText: {
    fontSize: 12.5,
    fontWeight: '800',
  },
  videoPillBtn: {
    flex: 1,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#52104F',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    gap: 3,
    ...Platform.select({
      android: { elevation: 3 },
      ios: { shadowColor: '#52104F', shadowOpacity: 0.25, shadowOffset: { width: 0, height: 3 }, shadowRadius: 5 },
    }),
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(38, 14, 34, 0.35)',
  },
  modalSheet: {
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
    backgroundColor: '#FFFDF9',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: Platform.OS === 'ios' ? 42 : 28,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  sheetTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#5C1A5A',
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F3EBE3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetList: {
    gap: 8,
  },
  sheetItem: {
    height: 46,
    borderRadius: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FAF5ED',
  },
  sheetItemSelected: {
    backgroundColor: '#F9EAF6',
    borderWidth: 1,
    borderColor: '#DFC6DC',
  },
  sheetItemText: {
    fontSize: 14.5,
    color: '#5D505B',
    fontWeight: '700',
  },
  sheetItemTextSelected: {
    color: '#5A1257',
    fontWeight: '900',
  },
  busyBadge: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginTop: 4,
    marginBottom: 2,
  },
  busyBadgeText: {
    color: '#B91C1C',
    fontSize: 11,
    fontWeight: '800',
  },
  priorityBadge: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginTop: 4,
    marginBottom: 2,
  },
  priorityBadgeText: {
    color: '#D97706',
    fontSize: 11,
    fontWeight: '800',
  },
  waitlistBtn: {
    flex: 1,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFFBEB',
    borderWidth: 1.5,
    borderColor: '#F59E0B',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    gap: 3,
    ...Platform.select({
      android: { elevation: 2 },
      ios: { shadowColor: '#D97706', shadowOpacity: 0.15, shadowOffset: { width: 0, height: 2 }, shadowRadius: 4 },
    }),
  },
  waitlistBtnWaiting: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1.5,
    borderColor: '#10B981',
  },
  waitlistBtnText: {
    color: '#B45309',
    fontSize: 13.5,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  waitlistBtnTextWaiting: {
    color: '#15803D',
    fontSize: 13.5,
    fontWeight: '800',
  },
  priorityModalSheet: {
    width: '88%',
    maxWidth: 380,
    backgroundColor: 'rgba(35, 10, 35, 0.96)',
    borderRadius: 26,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    ...Platform.select({
      android: { elevation: 20 },
      ios: { shadowColor: '#000', shadowOpacity: 0.5, shadowOffset: { width: 0, height: 10 }, shadowRadius: 20 },
    }),
  },
  priorityModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  priorityModalEmoji: {
    fontSize: 30,
  },
  priorityModalTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
  },
  priorityModalDesc: {
    color: '#E2E8F0',
    fontSize: 14.5,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 16,
  },
  priorityBannerBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(232, 63, 111, 0.25)',
    borderWidth: 1,
    borderColor: '#E83F6F',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
    gap: 8,
    marginBottom: 20,
  },
  priorityBannerText: {
    color: '#FCE7F3',
    fontSize: 13.5,
    fontWeight: '600',
  },
  priorityModalButtons: {
    width: '100%',
    gap: 12,
    marginBottom: 16,
  },
  priorityCallBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#10B981',
    paddingVertical: 15,
    borderRadius: 16,
    gap: 8,
  },
  priorityCallBtnText: {
    color: '#FFFFFF',
    fontSize: 15.5,
    fontWeight: '800',
  },
  priorityVideoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E83F6F',
    paddingVertical: 15,
    borderRadius: 16,
    gap: 8,
  },
  priorityVideoBtnText: {
    color: '#FFFFFF',
    fontSize: 15.5,
    fontWeight: '800',
  },
  priorityDismissBtn: {
    paddingVertical: 8,
  },
  priorityDismissText: {
    color: '#94A3B8',
    fontSize: 13.5,
    fontWeight: '600',
  },
  holdCircleContainer: {
    marginVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  holdCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: '#F97316',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(249, 115, 22, 0.15)',
  },
  holdNumber: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '900',
  },
  holdSubtext: {
    color: '#CBD5E1',
    fontSize: 13.5,
    textAlign: 'center',
    marginBottom: 22,
    lineHeight: 20,
  },
});
