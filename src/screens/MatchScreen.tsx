import React from 'react';
import { tap30, tap40, tap42 } from '../theme/touch';
import { Platform, Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View, } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import ScreenShell from '../components/ScreenShell';
import GengalAvatar from '../components/GengalAvatar';
import CallPriceTag from '../components/CallPriceTag';
import { useActionLock } from '../hooks/useActionLock';
import { launchCall } from '../services/callPermissionService';

type MatchScreenProps = {
  profileName?: string;
  matchData?: any;
  roomId?: string;
  navigate: (screen: string, params?: any) => void;
  goBack?: () => void;
};

function DottedBackground() {
  return (
    <View pointerEvents="none" style={styles.dots}>
      {Array.from({ length: 230 }).map((_, index) => (
        <View
          key={index}
          style={[
            styles.dot,
            {
              left: (index % 18) * 24 + 5,
              top: Math.floor(index / 18) * 24 + 6,
              opacity: index % 5 === 0 ? 0.28 : 0.16,
            },
          ]}
        />
      ))}
    </View>
  );
}

export default function MatchScreen({ profileName, matchData, roomId, navigate }: MatchScreenProps) {
  // Use matchData if available, fallback to mock profile
  const profile = matchData ? {
    name: matchData.nickname || matchData.name,
    uri: matchData.uri || matchData.avatarUrl || '',
    tier: matchData.tier === 'VIP' ? 'VIP' : 'Standard',
    avatarData: matchData.avatarData,
    uid: matchData.uid,
  } : { name: profileName || 'User', uri: '', tier: 'Standard', uid: undefined };

  const { locked: callLocked, run: runCall } = useActionLock();
  const startCall = (mode: 'call' | 'video') =>
    runCall(() =>
      launchCall(navigate, { profileName: profile.name, mode, roomId, matchData, isCaller: true })
    );

  return (
    <ScreenShell tone="dark">
      <View style={styles.phone}>
        <DottedBackground />
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.headerIcon}
            hitSlop={tap30}
            activeOpacity={0.78}
            onPress={() => navigate('Personal')}
          
            accessibilityRole="button"
            accessibilityLabel="Close">
            <MaterialIcons name="close" size={22} color="#F9F2EC" />
          </TouchableOpacity>
          <Text style={styles.headerText} numberOfLines={1}>
            Private Connect - Match Success
          </Text>
        </View>

        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
        >
          <LinearGradient
            colors={['#FFFDF8', '#FAF2E7']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.card}
          >
            <Text style={styles.title}>It's a Match!</Text>
            <Text style={styles.subtitle}>A PRIVATE CONNECTION AWAITS</Text>

            <View style={styles.stackStage}>
              <View style={styles.backCard} />
              <View style={styles.frontCard}>
                <View style={styles.miniHeart}>
                  <MaterialIcons name="favorite" size={15} color="#7E5206" />
                </View>
                {(profile as any).avatarData ? (
                  // App avatar builder — preferred for users who completed
                  // AvatarScreen; never an empty string.
                  <GengalAvatar data={(profile as any).avatarData} size={220} />
                ) : (profile as any).uri ? (
                  // Real avatarUrl; guard is necessary because a match whose
                  // account has no photo would produce source={{ uri: '' }},
                  // which warns on every render and draws nothing.
                  <Image source={{ uri: (profile as any).uri }} style={styles.matchPhoto} />
                ) : (
                  // No avatar, no photo — person icon at full card size.
                  <View style={[styles.matchPhoto, styles.matchPhotoFallback]}>
                    <MaterialIcons name="person" size={110} color="#C9BDB2" />
                  </View>
                )}
                <View style={styles.heartSeal}>
                  <MaterialIcons name="favorite" size={28} color="#7E6507" />
                </View>
              </View>
            </View>

            <View style={styles.namesRow}>
              <Text style={styles.matchName}>{profile.name}</Text>
              <Text style={styles.youName}>You</Text>
            </View>

            <TouchableOpacity
              activeOpacity={0.86}
              style={styles.primaryAction}
              hitSlop={tap42}
              onPress={() => navigate('Chat', { profileName: profile.name, matchData: { ...matchData, name: profile.name, uid: profile.uid } })}
            >
              <MaterialIcons name="chat-bubble-outline" size={16} color="#7E6507" />
              <Text style={styles.primaryActionText}>START CONVERSATION</Text>
            </TouchableOpacity>

            <View style={styles.callRow}>
              <TouchableOpacity
                activeOpacity={0.86}
                style={[styles.smallAction, callLocked && { opacity: 0.5 }]}
                hitSlop={tap40}
                disabled={callLocked}
                accessibilityRole="button"
                accessibilityLabel={`Voice call ${profile.name}`}
                onPress={() => startCall('call')}
              >
                <MaterialIcons name="phone" size={15} color="#FFF" />
                <Text style={styles.smallActionText}>VOICE CALL</Text>
                <CallPriceTag mode="call" />
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.86}
                style={[styles.smallAction, styles.smallActionVideo, callLocked && { opacity: 0.5 }]}
                hitSlop={tap40}
                disabled={callLocked}
                accessibilityRole="button"
                accessibilityLabel={`Video call ${profile.name}`}
                onPress={() => startCall('video')}
              >
                <MaterialIcons name="videocam" size={15} color="#FFF" />
                <Text style={[styles.smallActionText, styles.smallActionVideoText]}>VIDEO CALL</Text>
                <CallPriceTag mode="video" />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              activeOpacity={0.86}
              style={styles.outlineAction}
              hitSlop={tap42}
              onPress={() => navigate('Personal')}
            >
              <MaterialIcons name="explore" size={16} color="#7E6507" />
              <Text style={styles.outlineActionText}>CONTINUE DISCOVERING</Text>
            </TouchableOpacity>

            <View style={styles.sharedHint}>
              <View style={styles.hintIcon}>
                <MaterialIcons name="auto-awesome" size={18} color="#D6C99F" />
              </View>
              <Text style={styles.hintText}>
                You are both {profile.tier} members. Enjoy your private connection.
              </Text>
            </View>
          </LinearGradient>
        </ScrollView>
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
    backgroundColor: '#1E2224',
    overflow: 'hidden',
  },
  dots: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  dot: {
    position: 'absolute',
    width: 2,
    height: 2,
    borderRadius: 1,
    backgroundColor: '#FFF7EA',
  },
  header: {
    height: 48,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 247, 234, 0.34)',
  },
  headerText: {
    flex: 1,
    color: '#FFF7EA',
    fontSize: 14,
    fontWeight: '800',
  },
  scroll: {
    paddingHorizontal: 16,
    paddingBottom: 36,
  },
  card: {
    minHeight: 610,
    borderRadius: 8,
    paddingHorizontal: 34,
    paddingTop: 12,
    paddingBottom: 30,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E8DCCB',
  },
  title: {
    color: '#9B7C10',
    fontFamily: 'serif',
    fontSize: 32,
    fontStyle: 'italic',
    fontWeight: '900',
  },
  subtitle: {
    marginTop: 2,
    color: '#755E66',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.3,
  },
  stackStage: {
    width: 220,
    height: 210,
    marginTop: 48,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  backCard: {
    position: 'absolute',
    left: 72,
    top: 40,
    width: 118,
    height: 132,
    borderRadius: 24,
    backgroundColor: '#FFFDF8',
    borderWidth: 1,
    borderColor: '#EFE8DE',
    boxShadow: Platform.OS === 'web' ? '0 12px 20px rgba(76, 0, 84, 0.12)' : undefined,
  },
  frontCard: {
    width: 138,
    height: 150,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFDF8',
    boxShadow: Platform.OS === 'web' ? '0 16px 26px rgba(76, 0, 84, 0.18)' : undefined,
  },
  miniHeart: {
    position: 'absolute',
    top: 15,
    left: 15,
  },
  matchPhoto: {
    width: 86,
    height: 86,
    borderRadius: 43,
    opacity: 1.0,
  },
  // Shown when neither avatarData nor a photo URL is available.
  // Prevents source={{ uri: '' }} warnings and the resulting empty frame.
  matchPhotoFallback: {
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: '#F5ECE1',
  },
  heartSeal: {
    position: 'absolute',
    right: -8,
    bottom: 30,
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFDF8',
    borderWidth: 1,
    borderColor: '#9E7F12',
  },
  namesRow: {
    width: 150,
    marginTop: -6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  matchName: {
    color: '#4B0054',
    fontFamily: 'serif',
    fontSize: 17,
    fontWeight: '900',
  },
  youName: {
    color: '#4B0054',
    fontFamily: 'serif',
    fontSize: 17,
    fontWeight: '900',
  },
  primaryAction: {
    width: '100%',
    height: 42,
    marginTop: 45,
    borderRadius: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#FFFDF8',
    boxShadow: Platform.OS === 'web' ? '0 8px 14px rgba(75, 0, 84, 0.14)' : undefined,
  },
  primaryActionText: {
    color: '#4B0054',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  callRow: {
    width: '100%',
    marginTop: 16,
    flexDirection: 'column',
    gap: 12,
  },
  smallAction: {
    flex: 1,
    height: 40,
    borderRadius: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#7A256D',
    boxShadow: Platform.OS === 'web' ? '0 8px 14px rgba(122, 37, 109, 0.3)' : undefined,
  },
  smallActionText: {
    color: '#FFF',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  smallActionVideo: {},
  smallActionVideoText: {},
  outlineAction: {
    width: '100%',
    height: 42,
    marginTop: 16,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    backgroundColor: '#FFFDF8',
    borderWidth: 1,
    borderColor: '#E6DAC1',
  },
  outlineActionText: {
    color: '#4B0054',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.4,
  },
  sharedHint: {
    width: '100%',
    marginTop: 44,
    minHeight: 54,
    borderRadius: 9,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#EEE4D3',
    backgroundColor: 'rgba(255, 253, 248, 0.62)',
  },
  hintIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF6DA',
  },
  hintText: {
    flex: 1,
    color: '#C0B7AA',
    fontSize: 10,
    lineHeight: 15,
    fontWeight: '800',
  },
});
