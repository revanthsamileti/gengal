import React, { useMemo, useState, useEffect } from 'react';
import { Platform, Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View, } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import Svg, { Circle, Path, G } from 'react-native-svg';
import ScreenShell from '../components/ScreenShell';
import TopBar from '../components/TopBar';
import BottomNav from '../components/BottomNav';
import GengalAvatar from '../components/GengalAvatar';
import { skeuo } from '../theme/skeuomorphic';

import CallPriceTag from '../components/CallPriceTag';
import { subscribeToOnlineUsers, UserProfile as FirebaseUser } from '../services/userService';
import { findMatch } from '../services/matchService';
import { auth } from '../config/firebase';
import { useUser } from '../context/UserContext';
import ConnectingOverlay from '../components/ConnectingOverlay';

type MatchNode = {
  uid?: string;
  name: string;
  age: number;
  language: string;
  tier: 'Elite' | 'VIP';
  side: 'left' | 'right';
  image: string;
  avatarData?: any;
  modes: Array<'call' | 'video'>;
};

type PersonalScreenProps = {
  navigate: (screen: string, params?: any) => void;
};

// Moved constants inside component to make them reactive

// PROFILE_PATH_POINTS removed because paths are generated dynamically
function heartPath(x: number, y: number, scale = 1) {
  return [
    `M ${x} ${y + 58 * scale}`,
    `C ${x - 12 * scale} ${y + 45 * scale}, ${x - 78 * scale} ${y + 5 * scale}, ${x - 78 * scale} ${y - 40 * scale}`,
    `C ${x - 78 * scale} ${y - 86 * scale}, ${x - 22 * scale} ${y - 99 * scale}, ${x} ${y - 58 * scale}`,
    `C ${x + 22 * scale} ${y - 99 * scale}, ${x + 78 * scale} ${y - 86 * scale}, ${x + 78 * scale} ${y - 40 * scale}`,
    `C ${x + 78 * scale} ${y + 5 * scale}, ${x + 12 * scale} ${y + 45 * scale}, ${x} ${y + 58 * scale}`,
    'Z',
  ].join(' ');
}

function PathBackground({ matchCount, isEndRight }: { matchCount: number; isEndRight: boolean }) {
  if (matchCount === 0) return null;

  const points = Array.from({ length: matchCount }).map((_, i) => ({
    x: i % 2 === 0 ? 79 : 351,
    y: 250 + i * 200
  }));

  const cardBottomY = 244 + (matchCount - 1) * 200;
  const buttonCenterY = cardBottomY + 113;
  const endY = buttonCenterY;
  const endX = isEndRight ? 360 : 70;
  const lastPoint = points[points.length - 1];

  let d = `M 215 55 C 160 120, 79 160, 79 250`;
  
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    d += ` C ${prev.x} ${prev.y + 90}, ${curr.x} ${curr.y - 100}, ${curr.x} ${curr.y}`;
  }

  // The '...' button is horizontally between the last card and the random button.
  // We can just curve the line to pass perfectly through the center of the elements.
  const moreButtonX = isEndRight ? 260 : 170; // rough guess based on flex-end/flex-start and gaps
  
  // Curve from last point down to the more button, then to the random button
  d += ` C ${lastPoint.x} ${lastPoint.y + 60}, ${moreButtonX} ${endY}, ${endX} ${endY}`;

  const svgHeight = endY + 100;
  
  const junctions = [];
  for (let y = 350; y < points[points.length - 1].y; y += 200) {
    junctions.push({
      y,
      x: ((y - 350) / 200) % 2 === 0 ? 215 : 210
    });
  }

  return (
    <Svg
      pointerEvents="none"
      width="100%"
      height={svgHeight}
      viewBox={`0 0 430 ${svgHeight}`}
      preserveAspectRatio="none"
      style={styles.pathLayer}
    >
      <Path
        d={d}
        fill="none"
        stroke="rgba(166, 132, 35, 0.48)"
        strokeWidth={2.2}
        strokeDasharray="5 8"
        strokeLinecap="round"
      />

      {points.map((point, index) => {
        const rotation = index % 2 === 0 ? 15 : -15;
        return (
          <G key={`heart-${point.y}`} transform={`rotate(${rotation}, ${point.x}, ${point.y})`}>
            <Path
              d={heartPath(point.x, point.y, index % 2 === 0 ? 1 : 0.96)}
              fill="rgba(255, 237, 241, 0.12)"
              stroke="rgba(195, 156, 169, 0.42)"
              strokeWidth={1.8}
              strokeDasharray="4 7"
              strokeLinecap="round"
            />
          </G>
        );
      })}

      {junctions.map((j) => (
        <Path
          key={`junction-${j.y}`}
          d={heartPath(j.x, j.y, 0.12)}
          fill="#F4A2B4"
          stroke="#FFFCF7"
          strokeWidth={3}
        />
      ))}

      <Circle cx={215} cy={55} r={4} fill="#C5A444" />
      <Circle cx={endX} cy={endY} r={4} fill="#C5A444" />
    </Svg>
  );
}

function ModeButton({
  mode,
  node,
  navigate,
}: {
  mode: 'call' | 'video';
  node: MatchNode;
  navigate: PersonalScreenProps['navigate'];
}) {
  const isVideo = mode === 'video';

  return (
    <TouchableOpacity
      activeOpacity={0.84}
      style={[styles.modeButton, isVideo && styles.modeButtonVideo]}
      onPress={() => navigate('Call', { profileName: node.name, mode, isCaller: true, matchData: node })}
    >
      <MaterialIcons
        name={isVideo ? 'videocam' : 'phone'}
        size={17}
        color={isVideo ? '#FFF' : '#FFF'}
      />
      <Text style={[styles.modeText, !isVideo && styles.modeTextCall]}>
        {isVideo ? 'Video' : 'Call'}
      </Text>
      <CallPriceTag mode={mode} />
    </TouchableOpacity>
  );
}

function AvatarNode({
  node,
  navigate,
}: {
  node: MatchNode;
  navigate: PersonalScreenProps['navigate'];
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.86}
      style={[styles.avatarNode, node.side === 'right' && styles.avatarNodeRight]}
      onPress={() => navigate('Profile', { profileName: node.name, matchData: node })}
    >
      <LinearGradient
        colors={['#FFF4CA', '#9C8215', '#EAD06F']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.matchRing}
      >
        <View style={styles.matchPhotoInner}>
          {node.avatarData ? (
            <GengalAvatar data={node.avatarData} size={86} />
          ) : (
            <Image source={{ uri: node.image }} style={styles.matchPhoto} />
          )}
        </View>
      </LinearGradient>

      <TouchableOpacity style={styles.likeBubble} activeOpacity={0.8}>
        <MaterialIcons name="favorite-border" size={22} color="#897006" />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

function InfoCard({
  node,
  navigate,
}: {
  node: MatchNode;
  navigate: PersonalScreenProps['navigate'];
}) {
  return (
    <View style={[styles.infoCard, node.side === 'right' && styles.infoCardLeft]}>
      <TouchableOpacity
        activeOpacity={0.78}
        style={styles.infoTap}
        onPress={() => navigate('Profile', { profileName: node.name, matchData: node })}
      >
        <View style={styles.memberBadge}>
          <MaterialIcons name="diamond" size={9} color="#B68D1C" />
          <Text style={styles.memberBadgeText}>{node.tier}</Text>
        </View>
        <View style={styles.nameRow}>
          {node.side === 'right' ? <Text style={styles.age}>{node.age}</Text> : null}
          <Text style={styles.matchName} numberOfLines={1} adjustsFontSizeToFit>
            {node.name}
          </Text>
          {node.side === 'left' ? <Text style={styles.age}>{node.age}</Text> : null}
        </View>
        <View style={styles.profileLanguageRow}>
          <MaterialIcons name="language" size={12} color="#B18A20" />
          <Text style={styles.profileLanguage}>{node.language}</Text>
        </View>
      </TouchableOpacity>
      <View style={styles.modeRow}>
        {node.modes.map((mode) => (
          <ModeButton key={mode} mode={mode} node={node} navigate={navigate} />
        ))}
      </View>
    </View>
  );
}

function LanguageFilter({
  selected,
  onSelect,
  languages,
  navigate,
}: {
  selected: string;
  onSelect: (lang: string) => void;
  languages: string[];
  navigate: PersonalScreenProps['navigate'];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedLabel = selected === 'ALL'
    ? 'All languages'
    : selected.charAt(0) + selected.slice(1).toLowerCase();

  const selectLanguage = (language: string) => {
    onSelect(language);
    setIsOpen(false);
  };

  return (
    <View style={[styles.languageFilter, { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }]}>
      <TouchableOpacity
        activeOpacity={0.8}
        style={styles.languageSelect}
        onPress={() => setIsOpen(true)}
      >
        <View style={styles.languageSelectIcon}>
          <MaterialIcons name="translate" size={15} color="#8C7209" />
        </View>
        <Text style={styles.languageSelectText}>{selectedLabel}</Text>
        <MaterialIcons name="keyboard-arrow-down" size={20} color="#8E8379" />
      </TouchableOpacity>



      <Modal
        visible={isOpen}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setIsOpen(false)}
      >
        <View style={styles.languageModal}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setIsOpen(false)} />
          <View style={styles.languageSheet}>
            <View style={styles.languageSheetHeader}>
              <View style={styles.languageSheetTitleRow}>
                <MaterialIcons name="translate" size={18} color="#8C7209" />
                <Text style={styles.languageSheetTitle}>Choose language</Text>
              </View>
              <TouchableOpacity style={styles.languageClose} onPress={() => setIsOpen(false)}>
                <MaterialIcons name="close" size={20} color="#746A62" />
              </TouchableOpacity>
            </View>

            <View style={styles.languageList}>
              {languages.map((language) => {
                const isSelected = language === selected;
                const label = language === 'ALL'
                  ? 'All languages'
                  : language.charAt(0) + language.slice(1).toLowerCase();
                return (
                  <TouchableOpacity
                    key={language}
                    activeOpacity={0.76}
                    style={[styles.languageOption, isSelected && styles.languageOptionSelected]}
                    onPress={() => selectLanguage(language)}
                  >
                    <Text style={[styles.languageOptionText, isSelected && styles.languageOptionTextSelected]}>
                      {label}
                    </Text>
                    {isSelected ? (
                      <MaterialIcons name="check-circle" size={20} color="#5A075F" />
                    ) : (
                      <View style={styles.languageOptionCircle} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function MatchRow({
  node,
  index,
  navigate,
}: {
  node: MatchNode;
  index: number;
  navigate: PersonalScreenProps['navigate'];
}) {
  const isLeft = node.side === 'left';

  return (
    <View style={[styles.matchRow, index === 0 && styles.firstRow, isLeft ? styles.matchRowLeft : styles.matchRowRight]}>
        {isLeft ? (
          <>
            <AvatarNode node={node} navigate={navigate} />
            <InfoCard node={node} navigate={navigate} />
          </>
        ) : (
          <>
            <InfoCard node={node} navigate={navigate} />
            <AvatarNode node={node} navigate={navigate} />
          </>
        )}
    </View>
  );
}

export default function PersonalScreen({ navigate }: PersonalScreenProps) {
  const [selectedLanguage, setSelectedLanguage] = useState('ALL');
  const [firebaseUsers, setFirebaseUsers] = useState<FirebaseUser[]>([]);
  const { profile: myProfile } = useUser();
  const [isSearching, setIsSearching] = useState(false);
  const [searchCleanup, setSearchCleanup] = useState<(() => void) | null>(null);
  const [vipOnly, setVipOnly] = useState(false);

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
      const cleanup = await findMatch(myProfile, (roomId, matchData) => {
        setIsSearching(false);
        setSearchCleanup(null);
        navigate('Match', { profileName: matchData.nickname, matchData, roomId } as any);
      });
      setSearchCleanup(() => cleanup);
    } catch {
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

  const combinedProfiles = useMemo(() => {
    return firebaseUsers.map(u => ({
      uid: u.uid,
      name: u.nickname || u.username || 'User',
      age: u.age || 20,
      lang: u.language || 'EN',
      tier: u.avatarUrl ? 'VIP' : 'Elite',
      uri: u.avatarUrl || 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?q=80&w=200&auto=format&fit=crop',
      avatarData: u.avatarData,
      modes: ['call', 'video'] as Array<'call' | 'video'>
    }));
  }, [firebaseUsers]);

  const MATCHES: MatchNode[] = useMemo(() => {
    return combinedProfiles.map((profile, index) => ({
      uid: profile.uid,
      name: profile.name,
      age: profile.age as number,
      language: profile.lang,
      tier: profile.tier as any,
      side: index % 2 === 0 ? 'left' : 'right',
      image: profile.uri,
      avatarData: (profile as any).avatarData,
      modes: profile.modes,
    }));
  }, [combinedProfiles]);

  const LANGUAGES = useMemo(() => ['ALL', ...Array.from(new Set(combinedProfiles.map(p => p.lang)))], [combinedProfiles]);

  const sortedMatches = useMemo(() => {
    const ordered = selectedLanguage === 'ALL'
      ? MATCHES
      : [
          ...MATCHES.filter((match) => match.language === selectedLanguage),
          ...MATCHES.filter((match) => match.language !== selectedLanguage),
        ];

    return ordered.map((match, index) => ({
      ...match,
      side: (index % 2 === 0 ? 'left' : 'right') as MatchNode['side'],
    }));
  }, [selectedLanguage, MATCHES]);

  const isEndRight = sortedMatches.length % 2 !== 0;

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
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
        >
          <PathBackground matchCount={sortedMatches.length} isEndRight={isEndRight} />



          <LanguageFilter selected={selectedLanguage} onSelect={setSelectedLanguage} languages={LANGUAGES} navigate={navigate} />

          <View style={styles.vipFilterRow}>
            <TouchableOpacity
              activeOpacity={0.75}
              style={[styles.vipPill, !vipOnly && styles.vipPillActive]}
              onPress={() => setVipOnly(false)}
            >
              <Text style={[styles.vipPillText, !vipOnly && styles.vipPillTextActive]}>All Online</Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.75}
              style={[styles.vipPill, vipOnly && styles.vipPillActive]}
              onPress={() => setVipOnly(true)}
            >
              <MaterialIcons name="diamond" size={11} color={vipOnly ? '#AA7C00' : '#B3A9A4'} />
              <Text style={[styles.vipPillText, vipOnly && styles.vipPillTextActive]}>VIP Only</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.matchList}>
            {sortedMatches.map((node, index) => (
              <MatchRow key={node.uid || (node.name + index)} node={node} index={index} navigate={navigate} />
            ))}
          </View>

          <View style={[
            styles.randomWrap,
            !isEndRight ? { justifyContent: 'flex-start', paddingLeft: 28, paddingRight: 0 } : {}
          ]}>
            {!isEndRight && (
              <View>
                <TouchableOpacity activeOpacity={0.85} style={styles.randomButton} onPress={handleRandomMatch}>
                  <MaterialIcons name={isSearching ? 'close' : 'favorite-border'} size={38} color="#887006" />
                </TouchableOpacity>
                <Text style={styles.randomLabel}>{isSearching ? 'Cancel' : 'Random Match'}</Text>
              </View>
            )}

            <TouchableOpacity 
              activeOpacity={0.85} 
              style={styles.moreButton}
              onPress={() => navigate('ActiveConnects')}
            >
              <MaterialIcons name="more-horiz" size={32} color="#887006" />
            </TouchableOpacity>

            {isEndRight && (
              <View>
                <TouchableOpacity activeOpacity={0.85} style={styles.randomButton} onPress={handleRandomMatch}>
                  <MaterialIcons name={isSearching ? 'close' : 'favorite-border'} size={38} color="#887006" />
                </TouchableOpacity>
                <Text style={styles.randomLabel}>{isSearching ? 'Cancel' : 'Random Match'}</Text>
              </View>
            )}
          </View>
        </ScrollView>

        <BottomNav active="Personal" navigate={navigate} />
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
    borderBottomWidth: 1,
    borderBottomColor: '#F0E9DF',
    backgroundColor: '#FFFCF7',
    boxShadow: Platform.OS === 'web' ? '0 6px 22px rgba(88, 61, 27, 0.06)' : undefined,
  },
  avatarRing: {
    width: 44,
    height: 44,
    borderRadius: 22,
    padding: 2,
    borderWidth: 2,
    borderColor: '#D4B142',
    backgroundColor: '#FFFDF8',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  headerAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: 19,
  },
  brand: {
    flex: 1,
    textAlign: 'center',
    paddingHorizontal: 8,
    color: '#4B0054',
    fontFamily: 'serif',
    fontSize: 28,
    fontWeight: '900',
  },
  scroll: {
    flexGrow: 1,
    paddingTop: 34,
    paddingBottom: 126,
  },
  heroTitle: {
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 24,
    marginBottom: 20,
  },
  title: {
    width: '100%',
    textAlign: 'center',
    color: '#4B0054',
    fontFamily: 'serif',
    fontSize: 30,
    fontWeight: '900',
  },
  subtitle: {
    width: '100%',
    textAlign: 'center',
    color: '#9D9798',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  languageFilter: {
    alignItems: 'center',
    marginBottom: 14,
  },
  languageSelect: {
    width: 176,
    height: 40,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    gap: 8,
    backgroundColor: 'rgba(255, 253, 248, 0.94)',
    borderWidth: 1,
    borderColor: '#E6DAC1',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  languageSelectIcon: {
    width: 27,
    height: 27,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF2C7',
  },
  languageSelectText: {
    flex: 1,
    color: '#5D3E50',
    fontSize: 12,
    fontWeight: '900',
  },
  languageModal: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(45, 21, 40, 0.26)',
  },
  languageSheet: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 430,
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 28,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    backgroundColor: '#FFFCF7',
    boxShadow: Platform.OS === 'web' ? '0 -14px 32px rgba(57, 34, 48, 0.16)' : undefined,
  },
  languageSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 14,
  },
  languageSheetTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  languageSheetTitle: {
    color: '#4F174F',
    fontFamily: 'serif',
    fontSize: 19,
    fontWeight: '800',
  },
  languageClose: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F4EEE5',
  },
  languageList: {
    gap: 5,
  },
  languageOption: {
    height: 43,
    borderRadius: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  languageOptionSelected: {
    backgroundColor: '#F9ECF8',
  },
  languageOptionText: {
    color: '#786E67',
    fontSize: 13,
    fontWeight: '800',
  },
  languageOptionTextSelected: {
    color: '#5A075F',
  },
  languageOptionCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#D9CEC0',
  },
  matchList: {
    gap: 64,
  },
  vipFilterRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 28,
  },
  vipPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E6DAC1',
    backgroundColor: '#FFFDF8',
  },
  vipPillActive: {
    backgroundColor: '#FFF4CF',
    borderColor: '#D4B142',
  },
  vipPillText: {
    color: '#B3A9A4',
    fontSize: 11,
    fontWeight: '800',
  },
  vipPillTextActive: {
    color: '#8A6715',
  },
  matchRow: {
    minHeight: 136,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 22,
    gap: 10,
    width: '100%',
  },
  matchRowLeft: {
    justifyContent: 'flex-start',
  },
  matchRowRight: {
    justifyContent: 'flex-end',
  },
  firstRow: {
    marginTop: 6,
  },
  avatarNode: {
    width: 114,
    alignItems: 'center',
  },
  avatarNodeRight: {
    marginTop: -10,
  },
  matchRing: {
    width: 96,
    height: 96,
    borderRadius: 48,
    padding: 3,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  matchPhotoInner: {
    flex: 1,
    borderRadius: 45,
    padding: 2,
    backgroundColor: '#FFFDF8',
    overflow: 'hidden',
  },
  matchPhoto: {
    width: '100%',
    height: '100%',
    borderRadius: 43,
  },
  likeBubble: {
    position: 'absolute',
    right: 2,
    bottom: 28,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFDF8',
    borderWidth: 2,
    borderColor: '#D9BB56',
    boxShadow: Platform.OS === 'web' ? '0 7px 14px rgba(74, 0, 78, 0.16)' : undefined,
  },
  infoCard: {
    minWidth: 140,
    alignItems: 'flex-end',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 253, 248, 0.9)',
    borderWidth: 1,
    borderColor: '#EEE4D3',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  infoCardLeft: {
    alignItems: 'flex-start',
  },
  infoTap: {
    width: '100%',
    gap: 5,
  },
  memberBadge: {
    alignSelf: 'flex-start',
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#FFF4CF',
    borderWidth: 1,
    borderColor: '#E3C867',
  },
  memberBadgeText: {
    color: '#8A6715',
    fontSize: 8,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  matchName: {
    flexShrink: 1,
    color: '#56105C',
    fontFamily: 'serif',
    fontSize: 20,
    fontWeight: '800',
  },
  age: {
    color: '#A8A2A3',
    fontSize: 13,
    lineHeight: 23,
    fontWeight: '700',
  },
  profileLanguageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  profileLanguage: {
    color: '#9A856E',
    fontSize: 9,
    fontWeight: '900',
  },
  modeRow: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
  },
  modeButton: {
    height: 30,
    minWidth: 58,
    borderRadius: 15,
    paddingHorizontal: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#7A256D',
    borderWidth: 1,
    borderColor: '#7A256D',
    boxShadow: Platform.OS === 'web' ? '0 8px 14px rgba(122, 37, 109, 0.3)' : undefined,
  },
  modeButtonVideo: {},
  modeText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '900',
  },
  modeTextCall: {},
  randomWrap: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingRight: 28,
    marginTop: 72,
    gap: 16,
  },
  moreButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFDF8',
    borderWidth: 2,
    borderColor: '#D2B243',
    boxShadow: Platform.OS === 'web' ? skeuo.deepShadow : undefined,
  },
  randomButton: {
    width: 82,
    height: 82,
    borderRadius: 41,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFDF8',
    borderWidth: 3,
    borderColor: '#D2B243',
    boxShadow: Platform.OS === 'web' ? skeuo.deepShadow : undefined,
  },
  randomLabel: {
    position: 'absolute',
    bottom: -24,
    width: 120,
    textAlign: 'center',
    left: '50%',
    marginLeft: -60,
    color: '#A2871A',
    fontFamily: 'serif',
    fontSize: 13,
    fontWeight: '800',
  },
  pathLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
});
