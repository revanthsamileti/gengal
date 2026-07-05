import React, { useState, useEffect, useRef } from 'react';
import { Platform, View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  useWindowDimensions,
  ActivityIndicator,
  Animated,
  Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import ScreenShell from '../components/ScreenShell';
import BottomNav from '../components/BottomNav';
import TopBar from '../components/TopBar';
import GengalAvatar from '../components/GengalAvatar';
import { skeuo, skeuoGradients } from '../theme/skeuomorphic';

import { subscribeToOnlineUsers, UserProfile as FirebaseUser } from '../services/userService';
import { findMatch } from '../services/matchService';
import { auth } from '../config/firebase';
import CallPriceTag from '../components/CallPriceTag';
import { useUser } from '../context/UserContext';
import ConnectingOverlay from '../components/ConnectingOverlay';

type HomeScreenProps = {
  navigate: (screen: string, params?: any) => void;
};

function ModeButton({
  mode,
  profile,
  navigate,
}: {
  mode: 'call' | 'video';
  profile: any;
  navigate: HomeScreenProps['navigate'];
}) {
  const isVideo = mode === 'video';

  return (
    <TouchableOpacity
      activeOpacity={0.82}
      style={[styles.modeButton, isVideo && styles.modeButtonVideo]}
      onPress={() => {
        navigate('Call', { profileName: profile.name, mode, isCaller: true, matchData: profile });
      }}
    >
      <MaterialIcons
        name={isVideo ? 'videocam' : 'phone'}
        size={13}
        color={isVideo ? '#FFFFFF' : '#FFFFFF'}
      />
      <Text style={[styles.modeText, isVideo && styles.modeTextVideo]}>
        {isVideo ? 'Video' : 'Call'}
      </Text>
      <CallPriceTag mode={mode} />
    </TouchableOpacity>
  );
}

function AnimatedProfileCard({ children, index }: { children: React.ReactNode; index: number }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(24)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 400,
        delay: index * 80,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 400,
        delay: index * 80,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  return (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
      {children}
    </Animated.View>
  );
}

export default function HomeScreen({ navigate }: HomeScreenProps) {
  const { height } = useWindowDimensions();
  const isSmall = height < 850;

  const [firebaseUsers, setFirebaseUsers] = useState<FirebaseUser[]>([]);
  const { profile: myProfile } = useUser();
  const [isSearching, setIsSearching] = useState(false);
  const [searchCleanup, setSearchCleanup] = useState<(() => void) | null>(null);
  const [vipOnly, setVipOnly] = useState(false);

  const handleExploreMatches = async () => {
    if (!myProfile) {
      Alert.alert('Profile not loaded', 'Please wait for your profile to load.');
      return;
    }

    if (isSearching) {
      if (searchCleanup) searchCleanup();
      setIsSearching(false);
      setSearchCleanup(null);
      return;
    }

    setIsSearching(true);
    try {
      const cleanup = await findMatch(myProfile, (roomId, matchData) => {
        setIsSearching(false);
        setSearchCleanup(null);
        navigate('Match', { profileName: matchData.nickname, matchData, roomId } as any);
      });
      setSearchCleanup(() => cleanup);
    } catch (e) {
      Alert.alert('Error', 'Could not start matchmaking.');
      setIsSearching(false);
    }
  };

  useEffect(() => {
    const unsubscribe = subscribeToOnlineUsers((users) => {
      setFirebaseUsers(users);
    }, auth.currentUser?.uid, vipOnly);

    return () => {
      unsubscribe();
    };
  }, [vipOnly]);

  // Only map the real firebase users
  const displayProfiles = firebaseUsers.map(u => ({
    uid: u.uid,
    name: u.nickname || u.username || 'User',
    age: (typeof u.age === 'number' ? u.age : parseInt(u.age || '20', 10)),
    uri: u.avatarUrl || 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?q=80&w=200&auto=format&fit=crop',
    avatarData: u.avatarData,
    tier: u.avatarUrl ? 'VIP' : 'Elite',
    lang: u.language || 'EN',
    modes: ['call', 'video'] as Array<'call' | 'video'>,
    followers: Array.isArray(u.followers) ? u.followers.length.toString() : (u.followers?.toString() || '0'),
    following: Array.isArray(u.following) ? u.following.length.toString() : (u.following?.toString() || '0'),
    bio: u.bio || ''
  }));

  return (
    <ScreenShell tone="light">
      <View style={styles.phone}>
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

        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={[styles.scroll, isSmall && styles.scrollSmall]}
          showsVerticalScrollIndicator={false}
        >
          <TouchableOpacity
            activeOpacity={0.93}
            style={[styles.heroShell, isSmall && styles.heroShellSmall]}
            onPress={() => navigate('Personal')}
          >
            <LinearGradient
              colors={[...skeuoGradients.raised]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.hero, isSmall && styles.heroSmall]}
            >
              <View style={styles.heroWash} />
              <View style={[styles.heroMoon, isSmall && styles.heroMoonSmall]} />

              <View style={[styles.heartOrb, isSmall && styles.heartOrbSmall]}>
                <MaterialIcons name="favorite" size={34} color="#4A0049" />
              </View>

              <View style={[styles.heroCopy, isSmall && styles.heroCopySmall]}>
                <View style={styles.heroTitleRow}>
                  <Text style={styles.heroTitle}>Private Connect</Text>
                  <View style={styles.premiumBadge}>
                    <Text style={styles.premiumText}>PREMIUM</Text>
                  </View>
                </View>
                <Text style={styles.heroSub}>
                  Find your perfect match in curated, high-value environment
                </Text>
              </View>

              <TouchableOpacity 
                style={[styles.heroButton, isSmall && styles.heroButtonSmall, isSearching && { opacity: 0.8 }]} 
                activeOpacity={0.8}
                onPress={handleExploreMatches}
              >
                {isSearching ? (
                  <ActivityIndicator color="#FFF7F2" size="small" style={{ marginRight: 8 }} />
                ) : null}
                <Text style={styles.heroButtonText}>{isSearching ? 'Cancel Search...' : 'Explore Matches'}</Text>
                {!isSearching && <MaterialIcons name="arrow-forward" size={14} color="#FFF7F2" />}
              </TouchableOpacity>
            </LinearGradient>
          </TouchableOpacity>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Online Now</Text>
            <View style={styles.filterRow}>
              <TouchableOpacity
                activeOpacity={0.75}
                style={[styles.filterPill, !vipOnly && styles.filterPillActive]}
                onPress={() => setVipOnly(false)}
              >
                <Text style={[styles.filterPillText, !vipOnly && styles.filterPillTextActive]}>All</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.75}
                style={[styles.filterPill, vipOnly && styles.filterPillActive]}
                onPress={() => setVipOnly(true)}
              >
                <MaterialIcons name="diamond" size={10} color={vipOnly ? '#AA7C00' : '#B3A9A4'} />
                <Text style={[styles.filterPillText, vipOnly && styles.filterPillTextActive]}>VIP</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity activeOpacity={0.75} onPress={() => navigate('Personal')}>
              <Text style={styles.viewAll}>View all</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentInsetAdjustmentBehavior="automatic"
            style={[styles.profileScroller, isSmall && styles.profileScrollerSmall]}
            contentContainerStyle={styles.profileRow}
          >
            {displayProfiles.map((profile, i) => (
              <AnimatedProfileCard key={profile.uid || profile.name + i} index={i}>
                <View style={styles.profileCard}>
                  <TouchableOpacity
                    activeOpacity={0.85}
                    style={styles.profileTap}
                    onPress={() => {
                      navigate('Profile', { profileName: profile.name, matchData: profile });
                    }}
                  >
                    <LinearGradient
                      colors={['#F8EFCB', '#B89628', '#FFF8DB']}
                      start={{ x: 0.1, y: 0 }}
                      end={{ x: 0.9, y: 1 }}
                      style={styles.profileRing}
                    >
                      <View style={styles.profilePhotoWrap}>
                        {profile.avatarData ? (
                          <GengalAvatar data={profile.avatarData as any} size={70} />
                        ) : (
                          <Image source={{ uri: profile.uri }} style={styles.profilePhoto} />
                        )}
                        <LinearGradient
                          colors={['transparent', 'rgba(50, 16, 36, 0.28)']}
                          style={styles.profileVignette}
                        />
                        <View style={styles.onlineDot} />
                      </View>
                    </LinearGradient>
                    <View style={styles.tierPill}>
                      <MaterialIcons name="diamond" size={7} color="#B68D1C" />
                      <Text style={styles.tierText}>{profile.tier}</Text>
                    </View>
                    <Text style={styles.profileName}>{profile.name}, {profile.age}</Text>
                    <View style={styles.langRow}>
                      <MaterialIcons name="language" size={8} color="#B88A2E" />
                      <Text style={styles.profileLang}>{profile.lang}</Text>
                    </View>
                  </TouchableOpacity>
                  <View style={styles.modeRow}>
                    {profile.modes.map((mode) => (
                      <ModeButton key={mode} mode={mode} profile={profile} navigate={navigate} />
                    ))}
                  </View>
                </View>
              </AnimatedProfileCard>
            ))}
          </ScrollView>

          <View style={styles.tileGrid}>
            <TouchableOpacity style={[styles.tile, isSmall && styles.tileSmall]} activeOpacity={0.9} onPress={() => navigate('Club')}>
              <View style={styles.tileIconGold}>
                <MaterialIcons name="castle" size={30} color="#A78312" />
              </View>
              <Text style={styles.tileTitle}>Club</Text>
              <Text style={styles.tileSub}>Expert Rooms</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.tile, isSmall && styles.tileSmall]} activeOpacity={0.9} onPress={() => navigate('Chill')}>
              <View style={styles.tileIconPink}>
                <MaterialIcons name="coffee" size={30} color="#D16CBF" />
              </View>
              <Text style={[styles.tileTitle, styles.tileTitleMuted]}>Chill</Text>
              <Text style={styles.tileSub}>Intimate Vibes</Text>
            </TouchableOpacity>
          </View>

        </ScrollView>

        <BottomNav active="Home" navigate={navigate} />
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  phone: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 430,
    backgroundColor: 'transparent',
  },
  header: {
    height: 72,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    backgroundColor: '#FFFDF8',
    borderBottomWidth: 1,
    borderBottomColor: '#EFE3D2',
  },
  avatarShadow: {
    width: 44,
    height: 44,
    borderRadius: 22,
    padding: 3,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DFC260',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  avatar: {
    width: '100%',
    height: '100%',
    borderRadius: 18,
  },
  centerTitle: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  brand: {
    color: '#5A155A',
    fontFamily: 'serif',
    fontSize: 28,
    fontWeight: '900',
  },
  scroll: {
    paddingHorizontal: 26,
    paddingTop: 20,
    paddingBottom: 110,
  },
  scrollSmall: {
    paddingBottom: 90,
  },
  heroShell: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#EAD8A9',
    backgroundColor: '#FFFDF8',
    boxShadow: Platform.OS === 'web' ? skeuo.deepShadow : undefined,
    marginBottom: 28,
  },
  heroShellSmall: {
    marginBottom: 18,
  },
  hero: {
    minHeight: 310,
    borderRadius: 23,
    overflow: 'hidden',
    paddingHorizontal: 24,
    paddingTop: 52,
    paddingBottom: 22,
    justifyContent: 'flex-end',
  },
  heroSmall: {
    minHeight: 240,
    paddingTop: 36,
  },
  heroWash: {
    position: 'absolute',
    top: -10,
    right: -18,
    width: 230,
    height: 226,
    borderRadius: 115,
    backgroundColor: '#E9E0E2',
  },
  heroMoon: {
    position: 'absolute',
    top: 60,
    left: '50%',
    width: 112,
    height: 112,
    marginLeft: -56,
    borderRadius: 56,
    backgroundColor: '#FDF7E8',
  },
  heroMoonSmall: {
    top: 40,
  },
  heartOrb: {
    position: 'absolute',
    top: 93,
    left: '50%',
    width: 62,
    height: 62,
    marginLeft: -31,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF9EA',
    borderWidth: 1,
    borderColor: '#FFFFFF',
    boxShadow: Platform.OS === 'web' ? '0 2px 4px rgba(0,0,0,0.1)' : undefined,
  },
  heartOrbSmall: {
    top: 70,
  },
  heroCopy: {
    gap: 9,
    marginBottom: 22,
  },
  heroCopySmall: {
    marginBottom: 16,
  },
  heroTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  heroTitle: {
    color: '#5B1A62',
    fontFamily: 'serif',
    fontSize: 19,
    fontWeight: '700',
  },
  premiumBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: '#F7DA55',
  },
  premiumText: {
    color: '#AA7C00',
    fontSize: 7,
    fontWeight: '900',
  },
  heroSub: {
    color: '#8F8491',
    fontSize: 13,
    lineHeight: 20,
    maxWidth: 260,
    fontWeight: '600',
  },
  heroButton: {
    height: 52,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#4B0054',
    borderWidth: 1,
    borderColor: '#7B2B82',
    boxShadow: Platform.OS === 'web' ? '0 9px 16px rgba(75, 0, 84, 0.28)' : undefined,
  },
  heroButtonSmall: {
    height: 48,
  },
  heroButtonText: {
    color: '#FFF7F2',
    fontSize: 14,
    fontWeight: '800',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 15,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 6,
  },
  filterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E6DAC1',
    backgroundColor: '#FFFDF8',
  },
  filterPillActive: {
    backgroundColor: '#FFF4CF',
    borderColor: '#D4B142',
  },
  filterPillText: {
    color: '#B3A9A4',
    fontSize: 10,
    fontWeight: '800',
  },
  filterPillTextActive: {
    color: '#8A6715',
  },
  sectionTitle: {
    color: '#5C3B23',
    fontFamily: 'serif',
    fontSize: 15,
    fontWeight: '800',
  },
  viewAll: {
    color: '#B78F22',
    fontSize: 12,
    fontWeight: '800',
  },
  profileScroller: {
    marginHorizontal: -26,
    marginBottom: 32,
  },
  profileScrollerSmall: {
    marginBottom: 20,
  },
  profileRow: {
    paddingHorizontal: 26,
    gap: 16,
  },
  profileCard: {
    width: 116,
    alignItems: 'center',
  },
  profileTap: {
    alignItems: 'center',
  },
  profileRing: {
    width: 78,
    height: 78,
    borderRadius: 39,
    padding: 3,
    marginBottom: 5,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  profilePhotoWrap: {
    flex: 1,
    borderRadius: 36,
    padding: 2,
    overflow: 'hidden',
    backgroundColor: '#FFFDF8',
  },
  profilePhoto: {
    width: '100%',
    height: '100%',
    borderRadius: 34,
  },
  profileVignette: {
    ...StyleSheet.absoluteFill,
    borderRadius: 34,
  },
  onlineDot: {
    position: 'absolute',
    right: 3,
    bottom: 9,
    width: 12,
    height: 12,
    borderRadius: 7,
    backgroundColor: '#74B95B',
    borderWidth: 2,
    borderColor: '#FFFDF8',
  },
  tierPill: {
    height: 15,
    minWidth: 38,
    paddingHorizontal: 6,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    backgroundColor: '#FFF8DD',
    borderWidth: 1,
    borderColor: '#E9D383',
    marginTop: -13,
    marginBottom: 5,
    boxShadow: Platform.OS === 'web' ? '0 4px 8px rgba(96, 65, 20, 0.12)' : undefined,
  },
  tierText: {
    color: '#8F6920',
    fontSize: 7,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  profileName: {
    color: '#7A256D',
    fontSize: 11.5,
    fontWeight: '900',
    marginBottom: 2,
  },
  langRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  profileLang: {
    color: '#A79386',
    fontSize: 8,
    fontWeight: '800',
  },
  modeRow: {
    marginTop: 8,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  modeButton: {
    height: 26,
    width: 116,
    borderRadius: 13,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#7A256D',
    borderWidth: 1,
    borderColor: '#7A256D',
    boxShadow: Platform.OS === 'web' ? '0 6px 12px rgba(122, 37, 109, 0.3)' : undefined,
  },
  modeButtonVideo: {},
  modeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '900',
  },
  modeTextVideo: {},
  tileGrid: {
    flexDirection: 'row',
    gap: 14,
  },
  tile: {
    flex: 1,
    minHeight: 172,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#FFFDF8',
    borderWidth: 1,
    borderColor: '#FFFFFF',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  tileSmall: {
    minHeight: 140,
  },
  tileIconGold: {
    width: 58,
    height: 58,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF1A7',
  },
  tileIconPink: {
    width: 58,
    height: 58,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF0FA',
  },
  tileTitle: {
    color: '#5C3763',
    fontFamily: 'serif',
    fontSize: 15,
    fontWeight: '800',
  },
  tileTitleMuted: {
    color: '#8E6A8C',
  },
  tileSub: {
    color: '#B3A9A4',
    fontSize: 12,
    fontWeight: '700',
  },
});
