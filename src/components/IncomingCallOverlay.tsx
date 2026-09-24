import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Easing, Dimensions, Image } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { IncomingCall } from '../services/liveRoomService';
import GengalAvatar from './GengalAvatar';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface Props {
  call: IncomingCall | null;
  /** The parent owns the accept/reject writes so the offer is only updated once. */
  onAccept: (call: IncomingCall) => void;
  onReject: () => void;
}

const { width, height } = Dimensions.get('window');
const SCREEN_WIDTH = Math.min(width, 430);
const AVATAR = 132;
const RING_MAX = AVATAR + 130;

/**
 * One expanding ring behind the caller avatar. Three of these on a stagger read
 * as a radiating pulse, which is the thing that makes a ringing screen feel
 * alive rather than frozen.
 */
function PulseRing({ delay, tint }: { delay: number; tint: string }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(progress, {
          toValue: 1,
          duration: 2100,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        // Snap back invisibly; without the reset the ring pops at full size.
        Animated.timing(progress, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [delay]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ring,
        {
          borderColor: tint,
          opacity: progress.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.5, 0] }),
          transform: [
            { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.62, 1] }) },
          ],
        },
      ]}
    />
  );
}

/** "Incoming voice call" with the trailing dots animating one at a time. */
function TypingDots({ color }: { color: string }) {
  const dots = [useRef(new Animated.Value(0.25)).current, useRef(new Animated.Value(0.25)).current, useRef(new Animated.Value(0.25)).current];

  useEffect(() => {
    const loops = dots.map((d, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 200),
          Animated.timing(d, { toValue: 1, duration: 320, useNativeDriver: true }),
          Animated.timing(d, { toValue: 0.25, duration: 320, useNativeDriver: true }),
          Animated.delay((dots.length - 1 - i) * 200),
        ])
      )
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, []);

  return (
    <View style={styles.dotRow}>
      {dots.map((d, i) => (
        <Animated.View key={i} style={[styles.dot, { backgroundColor: color, opacity: d }]} />
      ))}
    </View>
  );
}

export default function IncomingCallOverlay({ call, onAccept, onReject }: Props) {
  // Rendered full-bleed rather than inside a safe-area shell, so the insets are
  // applied here — the accept/decline row otherwise sits under the home bar.
  const insets = useSafeAreaInsets();

  // The action bar rises from below the fold; the card above it fades in.
  const barAnim = useRef(new Animated.Value(140)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const rockAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!call) {
      barAnim.setValue(140);
      fadeAnim.setValue(0);
      pulseAnim.setValue(1);
      rockAnim.setValue(0);
      return;
    }

    Animated.parallel([
      Animated.spring(barAnim, { toValue: 0, tension: 55, friction: 9, useNativeDriver: true }),
      Animated.timing(fadeAnim, { toValue: 1, duration: 320, useNativeDriver: true }),
    ]).start();

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.09, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );

    // The handset rocks like a physical phone rattling on a table.
    const rock = Animated.loop(
      Animated.sequence([
        Animated.timing(rockAnim, { toValue: 1, duration: 110, useNativeDriver: true }),
        Animated.timing(rockAnim, { toValue: -1, duration: 110, useNativeDriver: true }),
        Animated.timing(rockAnim, { toValue: 1, duration: 110, useNativeDriver: true }),
        Animated.timing(rockAnim, { toValue: 0, duration: 110, useNativeDriver: true }),
        Animated.delay(1100),
      ])
    );

    pulse.start();
    rock.start();
    return () => {
      pulse.stop();
      rock.stop();
    };
  }, [call]);

  if (!call) return null;

  const isVideo = call.mode === 'video';
  const accent = isVideo ? '#E0A6FF' : '#8CE8A0';
  const backdrop: [string, string, string] = isVideo
    ? ['#2A0128', '#4A0F63', '#1A0714']
    : ['#0B2A16', '#123D22', '#07160D'];

  return (
    <View style={styles.root}>
      <LinearGradient colors={backdrop} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={StyleSheet.absoluteFill} />

      <Animated.View style={[styles.body, { opacity: fadeAnim, paddingTop: insets.top + 16 }]}>
        <View style={styles.topLabelRow}>
          <Animated.View style={{ transform: [{ rotate: rockAnim.interpolate({ inputRange: [-1, 1], outputRange: ['-14deg', '14deg'] }) }] }}>
            <MaterialIcons name={isVideo ? 'videocam' : 'phone-in-talk'} size={17} color={accent} />
          </Animated.View>
          <Text style={[styles.topLabel, { color: accent }]}>
            {isVideo ? 'INCOMING VIDEO CALL' : 'INCOMING VOICE CALL'}
          </Text>
        </View>

        {/* Announced on arrival — otherwise a screen-reader user gets no
            indication that a call is ringing at all. */}
        <View
          style={styles.avatarStage}
          accessible
          accessibilityLiveRegion="assertive"
          accessibilityLabel={`Incoming ${isVideo ? 'video' : 'voice'} call from ${call.callerName}`}
        >
          <PulseRing delay={0} tint={accent} />
          <PulseRing delay={700} tint={accent} />
          <PulseRing delay={1400} tint={accent} />

          <View style={[styles.avatarFrame, { borderColor: accent }]}>
            {call.callerAvatarData ? (
              <GengalAvatar data={call.callerAvatarData} size={AVATAR} />
            ) : call.callerAvatarUrl ? (
              <Image source={{ uri: call.callerAvatarUrl }} style={styles.avatarImage} accessible={false} />
            ) : (
              <View style={styles.avatarFallback}>
                <MaterialIcons name="person" size={64} color="rgba(255,255,255,0.85)" />
              </View>
            )}
          </View>
        </View>

        <Text style={styles.callerName} numberOfLines={1}>{call.callerName}</Text>

        <View style={styles.statusRow}>
          <Text style={styles.statusText}>is calling you</Text>
          <TypingDots color={accent} />
        </View>
      </Animated.View>

      <Animated.View
        style={[styles.actionBar, { paddingBottom: insets.bottom + 28, transform: [{ translateY: barAnim }] }]}
      >
        <View style={styles.actionSlot}>
          <TouchableOpacity
            activeOpacity={0.8}
            style={[styles.actionBtn, styles.rejectBtn]}
            onPress={onReject}
            accessibilityRole="button"
            accessibilityLabel={`Decline ${isVideo ? 'video' : 'voice'} call from ${call.callerName}`}
          >
            <MaterialIcons name="call-end" size={30} color="#FFF" />
          </TouchableOpacity>
          <Text style={styles.actionLabel}>Decline</Text>
        </View>

        <View style={styles.actionSlot}>
          <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
            <TouchableOpacity
              activeOpacity={0.8}
              style={[styles.actionBtn, styles.acceptBtn]}
              onPress={() => onAccept(call)}
              accessibilityRole="button"
              accessibilityLabel={`Accept ${isVideo ? 'video' : 'voice'} call from ${call.callerName}`}
            >
              <MaterialIcons name={isVideo ? 'videocam' : 'call'} size={30} color="#FFF" />
            </TouchableOpacity>
          </Animated.View>
          <Text style={styles.actionLabel}>Accept</Text>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 99999,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  topLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: Math.min(48, height * 0.05),
  },
  topLabel: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 2,
  },
  avatarStage: {
    width: RING_MAX,
    height: RING_MAX,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: RING_MAX,
    height: RING_MAX,
    borderRadius: RING_MAX / 2,
    borderWidth: 2,
  },
  avatarFrame: {
    width: AVATAR + 8,
    height: AVATAR + 8,
    borderRadius: (AVATAR + 8) / 2,
    borderWidth: 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  avatarImage: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
  },
  avatarFallback: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  callerName: {
    color: '#FFFDF8',
    fontSize: 30,
    fontWeight: '800',
    marginTop: 28,
    maxWidth: SCREEN_WIDTH - 48,
    textAlign: 'center',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  statusText: {
    color: 'rgba(255,253,248,0.72)',
    fontSize: 15,
  },
  dotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 5,
    gap: 3,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  actionBar: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'flex-start',
    paddingTop: 20,
  },
  actionSlot: {
    alignItems: 'center',
    gap: 10,
  },
  actionBtn: {
    width: 68,
    height: 68,
    borderRadius: 34,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
  },
  actionLabel: {
    color: 'rgba(255,253,248,0.75)',
    fontSize: 12,
    fontWeight: '700',
  },
  rejectBtn: {
    backgroundColor: '#FF3B30',
  },
  acceptBtn: {
    backgroundColor: '#34C759',
  },
});
