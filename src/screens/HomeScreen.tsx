import React, { useState, useEffect, useRef } from 'react';
import { Platform, View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  useWindowDimensions,
  Animated,
  ActivityIndicator,
  Easing } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import ScreenShell from '../components/ScreenShell';
import { useActionLock } from '../hooks/useActionLock';
import { launchCall } from '../services/callPermissionService';
import BottomNav from '../components/BottomNav';
import TopBar from '../components/TopBar';
import GengalAvatar from '../components/GengalAvatar';
import { skeuo, skeuoGradients } from '../theme/skeuomorphic';

import { subscribeToOnlineUsers, UserProfile as FirebaseUser } from '../services/userService';
import { auth } from '../config/firebase';
import CallPriceTag from '../components/CallPriceTag';

type HomeScreenProps = {
  navigate: (screen: string, params?: any) => void;
  goBack?: () => void;
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
  const { locked, run } = useActionLock();

  return (
    <TouchableOpacity
      activeOpacity={0.82}
      style={[styles.modeButton, isVideo && styles.modeButtonVideo, locked && { opacity: 0.5 }]}
      disabled={locked}
      accessibilityRole="button"
      accessibilityLabel={isVideo ? `Video call ${profile.name}` : `Call ${profile.name}`}
      onPress={() =>
        run(() =>
          launchCall(navigate, { profileName: profile.name, mode, isCaller: true, matchData: profile })
        )
      }
    >
      <MaterialIcons
        name={isVideo ? 'videocam' : 'phone'}
        size={13}
        color="#FFFFFF"
      />
      <Text style={[styles.modeText, isVideo && styles.modeTextVideo]}>
        {isVideo ? 'Video' : 'Call'}
      </Text>
      <CallPriceTag mode={mode} textColor="#FFFFFF" />
    </TouchableOpacity>
  );
}

const HEART_LEFTS = [26, 78, 148, 214, 268];
const HEART_SIZES = [11, 15, 9, 17, 12];

function DriftingHeart({ index }: { index: number }) {
  const drift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Staggered via setTimeout rather than an Animated.delay inside the loop:
    // the native driver does not reliably restart a looped sequence that leads
    // with a delay, so each heart would fade out once and never come back.
    const loop = Animated.loop(
      Animated.timing(drift, {
        toValue: 1,
        duration: 6200,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      })
    );
    const timer = setTimeout(() => loop.start(), index * 1400);
    return () => {
      clearTimeout(timer);
      loop.stop();
    };
  }, [drift, index]);

  const translateY = drift.interpolate({ inputRange: [0, 1], outputRange: [26, -104] });
  const opacity = drift.interpolate({ inputRange: [0, 0.18, 0.72, 1], outputRange: [0, 0.5, 0.32, 0] });
  const scale = drift.interpolate({ inputRange: [0, 1], outputRange: [0.65, 1.15] });

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        bottom: 96,
        left: HEART_LEFTS[index % HEART_LEFTS.length],
        opacity,
        transform: [{ translateY }, { scale }],
      }}
    >
      <MaterialIcons name="favorite" size={HEART_SIZES[index % HEART_SIZES.length]} color="#E48AAE" />
    </Animated.View>
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
  const [vipOnly, setVipOnly] = useState(false);
  // Distinguishes "no one is online" from "we haven't heard back yet" — the
  // empty state used to paint on first frame, before Firestore had answered.
  const [hasLoaded, setHasLoaded] = useState(false);

  useEffect(() => {
    setHasLoaded(false);
    const unsubscribe = subscribeToOnlineUsers((users) => {
      setFirebaseUsers(users);
      setHasLoaded(true);
    }, auth.currentUser?.uid, vipOnly);

    return () => {
      unsubscribe();
    };
  }, [vipOnly]);

  // Only map the real firebase users
  const displayProfiles = firebaseUsers.map(u => ({
    uid: u.uid,
    name: u.nickname || u.username || 'User',
    // Age is shown only when the user actually gave one — the old `|| '20'`
    // fallback printed a made-up age next to every incomplete profile.
    age: (typeof u.age === 'number' ? u.age : (u.age ? parseInt(u.age, 10) : undefined)),
    uri: u.avatarUrl || '',
    avatarData: u.avatarData,
    tier: u.tier,
    lang: u.language || 'EN',
    modes: ['call', 'video'] as Array<'call' | 'video'>,
    followers: Array.isArray(u.followers) ? u.followers.length.toString() : (u.followers?.toString() || '0'),
    following: Array.isArray(u.following) ? u.following.length.toString() : (u.following?.toString() || '0'),
    bio: u.bio || ''
  }));

  return (
    <ScreenShell tone="light">
      <View style={styles.phone}>
        <TopBar navigate={navigate} />

        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <TouchableOpacity
            activeOpacity={0.93}
            style={[styles.heroShell, isSmall && styles.heroShellSmall]}
            onPress={() => navigate('Personal')}
          >
            <LinearGradient
              colors={[...skeuoGradients.romanticHero]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.hero, isSmall && styles.heroSmall]}
            >
              <View style={styles.heroWash} />
              <View style={styles.heroBlush} />
              {[0, 1, 2, 3, 4].map(i => <DriftingHeart key={i} index={i} />)}

              <View style={styles.heroTop}>
                <View style={[styles.heartOrb, isSmall && styles.heartOrbSmall]}>
                  <View style={styles.heartOrbInner}>
                    <MaterialIcons name="favorite" size={isSmall ? 26 : 30} color="#C2477E" />
                  </View>
                </View>
              </View>

              <View style={[styles.heroCopy, isSmall && styles.heroCopySmall]}>
                <View style={styles.heroTitleRow}>
                  <Text style={styles.heroTitle}>Private Connect</Text>
                  <View style={styles.premiumBadge}>
                    <Text style={styles.premiumText}>PREMIUM</Text>
                  </View>
                </View>
                <Text style={styles.heroSub}>
                  Somewhere out there, someone is hoping to meet you tonight.
                </Text>
              </View>

              {/* Opens the Connect tab to browse people rather than starting a
                  random paid call straight from the home screen. Random
                  matchmaking still lives in Connect behind its own button. */}
              <TouchableOpacity
                style={[styles.heroButtonShell, isSmall && styles.heroButtonShellSmall]}
                activeOpacity={0.85}
                onPress={() => navigate('Personal')}
                accessibilityRole="button"
                accessibilityLabel="Explore matches, opens Connect"
              >
                <LinearGradient
                  colors={[...skeuoGradients.romanticButton]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.heroButton}
                >
                  <MaterialIcons name="favorite" size={14} color="#F7C9DC" />
                  <Text style={styles.heroButtonText}>Explore Matches</Text>
                  <MaterialIcons name="arrow-forward" size={14} color="#FFF7F2" />
                </LinearGradient>
              </TouchableOpacity>
            </LinearGradient>
          </TouchableOpacity>

          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleWrap}>
              <MaterialIcons name="favorite" size={11} color="#D98BAE" />
              <Text style={styles.sectionTitle}>Online Now</Text>
            </View>
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

          {!hasLoaded ? (
            <View style={styles.emptyHearts}>
              <ActivityIndicator color="#D98BAE" />
              <Text style={styles.emptyText}>Looking for people online…</Text>
            </View>
          ) : displayProfiles.length === 0 ? (
            <View style={styles.emptyHearts}>
              <View style={styles.emptyHeartOrb}>
                <MaterialIcons name="favorite-border" size={26} color="#D98BAE" />
              </View>
              <Text style={styles.emptyTitle}>Nobody's here just yet</Text>
              <Text style={styles.emptyText}>
                New hearts come online all evening. Start a private connect and we'll find someone for you.
              </Text>
            </View>
          ) : (
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
                      colors={[...skeuoGradients.blushRing]}
                      start={{ x: 0.1, y: 0 }}
                      end={{ x: 0.9, y: 1 }}
                      style={styles.profileRing}
                    >
                      <View style={styles.profilePhotoWrap}>
                        {profile.avatarData ? (
                          <GengalAvatar data={profile.avatarData as any} size={70} />
                        ) : profile.uri ? (
                          <Image source={{ uri: profile.uri }} style={styles.profilePhoto} />
                        ) : (
                          <View style={[styles.profilePhoto, styles.profilePhotoEmpty]}>
                            <MaterialIcons name="person" size={34} color="#C9BDB2" />
                          </View>
                        )}
                        <LinearGradient
                          colors={['transparent', 'rgba(50, 16, 36, 0.28)']}
                          style={styles.profileVignette}
                        />
                        <View style={styles.onlineDot} />
                      </View>
                    </LinearGradient>
                    {profile.tier === 'VIP' ? (
                      <View style={styles.tierPill}>
                        <MaterialIcons name="diamond" size={7} color="#B68D1C" />
                        <Text style={styles.tierText}>VIP</Text>
                      </View>
                    ) : null}
                    <Text style={styles.profileName}>
                      {profile.age ? `${profile.name}, ${profile.age}` : profile.name}
                    </Text>
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
          )}

          <View style={styles.tileGrid}>
            <TouchableOpacity style={[styles.tile, isSmall && styles.tileSmall]} activeOpacity={0.9} onPress={() => navigate('Club')}>
              <View style={styles.tileIconGold}>
                <MaterialIcons name="groups" size={30} color="#A78312" />
              </View>
              <Text style={styles.tileTitle}>Club</Text>
              <Text style={styles.tileSub}>Expert Rooms</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.tile, isSmall && styles.tileSmall]} activeOpacity={0.9} onPress={() => navigate('Chill')}>
              <View style={styles.tileIconPink}>
                <MaterialIcons name="sports-esports" size={30} color="#D16CBF" />
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
  // BottomNav is position:'absolute', so nothing pushes it out of the
  // ScrollView's way -- the content itself has to reserve enough bottom
  // clearance. A height-based threshold used to pick between 90/130 here,
  // but real devices land on both sides of any cutoff (an 875dp-tall phone
  // fell just above a "isSmall < 850" line and still clipped its last row
  // behind BottomNav). Always reserving the larger amount costs nothing on
  // tall screens and guarantees clearance on short ones.
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 130,
  },
  heroShell: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#F0D3DE',
    backgroundColor: '#FFFDF8',
    boxShadow: Platform.OS === 'web' ? '0 16px 34px rgba(140, 45, 95, 0.16)' : undefined,
    shadowColor: '#8C2D5F',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.16,
    shadowRadius: 24,
    elevation: 8,
    marginBottom: 28,
  },
  heroShellSmall: {
    marginBottom: 18,
  },
  hero: {
    minHeight: 320,
    borderRadius: 23,
    overflow: 'hidden',
    paddingHorizontal: 24,
    paddingTop: 30,
    paddingBottom: 22,
    justifyContent: 'flex-end',
  },
  heroSmall: {
    minHeight: 262,
    paddingTop: 22,
  },
  heroWash: {
    position: 'absolute',
    top: -46,
    right: -40,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: 'rgba(255, 255, 255, 0.55)',
  },
  heroBlush: {
    position: 'absolute',
    bottom: -70,
    left: -50,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(226, 138, 178, 0.16)',
  },
  heroTop: {
    alignItems: 'center',
    marginBottom: 20,
  },
  heartOrb: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.62)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.9)',
  },
  heartOrbSmall: {
    width: 62,
    height: 62,
    borderRadius: 31,
  },
  heartOrbInner: {
    width: '76%',
    height: '76%',
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    shadowColor: '#C2477E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 12,
    elevation: 5,
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
    fontSize: 21,
    fontWeight: '700',
    letterSpacing: 0.2,
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
    color: '#8A6B7E',
    fontSize: 13,
    lineHeight: 20,
    maxWidth: 268,
    fontWeight: '600',
    fontStyle: 'italic',
  },
  heroButtonShell: {
    height: 52,
    borderRadius: 26,
    overflow: 'hidden',
    shadowColor: '#4B0054',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
    elevation: 7,
  },
  heroButtonShellSmall: {
    height: 48,
  },
  heroButton: {
    flex: 1,
    borderRadius: 26,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
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
  sectionTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  sectionTitle: {
    color: '#5C3B23',
    fontFamily: 'serif',
    fontSize: 15,
    fontWeight: '800',
  },
  viewAll: {
    color: '#C2477E',
    fontSize: 12,
    fontWeight: '800',
  },
  emptyHearts: {
    alignItems: 'center',
    paddingVertical: 30,
    paddingHorizontal: 26,
    marginBottom: 32,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 246, 249, 0.75)',
    borderWidth: 1,
    borderColor: '#F5DFE7',
  },
  emptyHeartOrb: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F7E0E9',
    marginBottom: 12,
  },
  emptyTitle: {
    color: '#7A256D',
    fontFamily: 'serif',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 6,
  },
  emptyText: {
    color: '#A98D9C',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
    textAlign: 'center',
    maxWidth: 250,
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
    boxShadow: Platform.OS === 'web' ? '0 8px 18px rgba(180, 90, 130, 0.22)' : undefined,
    shadowColor: '#B45A82',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
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
  profilePhotoEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F2ECE4',
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
    backgroundColor: '#FFF4F8',
    borderWidth: 1,
    borderColor: '#F0C9DA',
    marginTop: -13,
    marginBottom: 5,
    boxShadow: Platform.OS === 'web' ? '0 4px 8px rgba(150, 70, 110, 0.14)' : undefined,
  },
  tierText: {
    color: '#A34C7B',
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
    // Voice now uses the video button's colour, by request. They are equal
    // actions rather than a primary and a secondary, so a single colour reads
    // better than the two-tone split that was here.
    backgroundColor: '#C2477E',
    borderWidth: 1,
    borderColor: '#D96297',
    boxShadow: Platform.OS === 'web' ? '0 6px 12px rgba(194, 71, 126, 0.3)' : undefined,
    shadowColor: '#C2477E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 8,
    elevation: 3,
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
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#FFFDF8',
    borderWidth: 1,
    borderColor: '#F7E7EE',
    boxShadow: Platform.OS === 'web' ? '0 10px 22px rgba(150, 80, 115, 0.13)' : undefined,
    shadowColor: '#96506F',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.13,
    shadowRadius: 16,
    elevation: 4,
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
