import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Easing, Dimensions, Platform, Modal, Image } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import GengalAvatar from './GengalAvatar';

/**
 * Where a private call actually is, as reported by CallScreen. Every value is
 * driven by a real event (offer written, answered, key minted, media joined),
 * so the progress never runs ahead of the call the way the old fixed 10-second
 * bar did.
 */
export type CallStage = 'setup' | 'ringing' | 'securing' | 'joining';

type ConnectingOverlayProps = {
  mode: 'random' | 'private';
  targetName?: string;
  onCancel: () => void;
  status?: 'connecting' | 'ringing';
  /** Private calls: the person on the other end, shown in the centre circle. */
  targetAvatarData?: any;
  targetAvatarUri?: string;
  stage?: CallStage;
  /** False on the receiving side, which has already answered. */
  isCaller?: boolean;
  isVideo?: boolean;
  /** Ringing is drawn against this, so the bar is the real time left to answer. */
  ringTimeoutMs?: number;
};

const { width, height } = Dimensions.get('window');

const STEP_LABELS = { setup: 'Calling', ringing: 'Ringing', connect: 'Connecting' } as const;
type Step = keyof typeof STEP_LABELS;

const formatElapsed = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Whole seconds since `key` last changed, ticking once a second. */
function useStageClock(key: string) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    setSeconds(0);
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [key]);
  return seconds;
}

function FloatingHeart({ index, delay }: { index: number, delay: number }) {
  const translateY = useRef(new Animated.Value(height / 3)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(translateY, {
            toValue: -height / 4,
            duration: 4000,
            easing: Easing.out(Easing.linear),
            useNativeDriver: true,
          }),
          Animated.sequence([
            Animated.timing(opacity, {
              toValue: 0.6,
              duration: 500,
              useNativeDriver: true,
            }),
            Animated.timing(opacity, {
              toValue: 0.6,
              duration: 2500,
              useNativeDriver: true,
            }),
            Animated.timing(opacity, {
              toValue: 0,
              duration: 1000,
              useNativeDriver: true,
            }),
          ]),
          Animated.timing(scale, {
            toValue: 1.2,
            duration: 4000,
            useNativeDriver: true,
          }),
        ])
      ])
    ).start();
  }, [delay, opacity, scale, translateY]);

  // Scatter hearts horizontally
  const left = 40 + (index * 45) % (width - 80);
  const size = 15 + (index % 3) * 10;

  return (
    <Animated.View style={[styles.floatingHeart, { left, transform: [{ translateY }, { scale }], opacity }]}>
      <MaterialIcons name="favorite" size={size} color="#E8CA58" />
    </Animated.View>
  );
}

/** Rings radiating from the avatar while the other phone is ringing. */
function RingPulse() {
  const first = useRef(new Animated.Value(0)).current;
  const second = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loops = [first, second].map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 900),
          Animated.timing(v, { toValue: 1, duration: 1800, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [first, second]);
  return (
    <>
      {[first, second].map((v, i) => (
        <Animated.View
          key={i}
          pointerEvents="none"
          style={[
            styles.pulseRing,
            {
              opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
              transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.45] }) }],
            },
          ]}
        />
      ))}
    </>
  );
}

/** A sweep for stages whose length nobody can know in advance. */
function IndeterminateBar() {
  const x = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(x, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [x]);
  return (
    <Animated.View
      style={[
        styles.sweep,
        { transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [-120, 320] }) }] },
      ]}
    >
      <LinearGradient
        colors={['rgba(212,175,55,0)', '#D4AF37', 'rgba(212,175,55,0)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ flex: 1 }}
      />
    </Animated.View>
  );
}

export default function ConnectingOverlay({
  mode, targetName, onCancel, status = 'connecting',
  targetAvatarData, targetAvatarUri, stage, isCaller = true, isVideo = false, ringTimeoutMs = 45000,
}: ConnectingOverlayProps) {
  if (mode === 'private') {
    return (
      <PrivateCallProgress
        targetName={targetName}
        onCancel={onCancel}
        stage={stage ?? (status === 'ringing' ? 'ringing' : 'setup')}
        targetAvatarData={targetAvatarData}
        targetAvatarUri={targetAvatarUri}
        isCaller={isCaller}
        isVideo={isVideo}
        ringTimeoutMs={ringTimeoutMs}
      />
    );
  }
  return <RandomSearch onCancel={onCancel} />;
}

function PrivateCallProgress({
  targetName, onCancel, stage, targetAvatarData, targetAvatarUri, isCaller, isVideo, ringTimeoutMs,
}: {
  targetName?: string;
  onCancel: () => void;
  stage: CallStage;
  targetAvatarData?: any;
  targetAvatarUri?: string;
  isCaller: boolean;
  isVideo: boolean;
  ringTimeoutMs: number;
}) {
  const elapsed = useStageClock(stage);
  const name = targetName || 'them';

  // The receiver has already answered, so the only step left is the join.
  const steps: Step[] = isCaller ? ['setup', 'ringing', 'connect'] : ['connect'];
  const current: Step = stage === 'setup' ? 'setup' : stage === 'ringing' ? 'ringing' : 'connect';
  const currentIndex = steps.indexOf(current);

  const title =
    stage === 'setup' ? `Calling ${name}…`
      : stage === 'ringing' ? 'Ringing…'
        : stage === 'securing' ? 'Securing the line…'
          : `Connecting ${isVideo ? 'video' : 'audio'}…`;
  const subtitle =
    stage === 'setup' ? 'Reaching their phone'
      : stage === 'ringing' ? `Waiting for ${name} to answer · ${formatElapsed(elapsed)}`
        : isCaller ? `${name} answered` : `Joining ${name}`;

  // Ringing has a real deadline, so its bar is the time actually left to
  // answer. The other stages have none and get a sweep instead of a bar that
  // pretends to know.
  const ringProgress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (stage !== 'ringing') return;
    ringProgress.setValue(0);
    const anim = Animated.timing(ringProgress, {
      toValue: 1, duration: ringTimeoutMs, easing: Easing.linear, useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [stage, ringTimeoutMs, ringProgress]);

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onCancel}>
      <View style={styles.container}>
        <View style={styles.privateHeader}>
          <Text style={styles.logoText}>Gengal</Text>
          <View style={styles.privatePill}>
            <MaterialIcons name={isVideo ? 'videocam' : 'lock'} size={12} color="#8D6E18" />
            <Text style={styles.privatePillText}>{isVideo ? 'Private Video Call' : 'Private Call'}</Text>
          </View>
        </View>

        {[...Array(6)].map((_, i) => (
          <FloatingHeart key={`heart-${i}`} index={i} delay={i * 600} />
        ))}

        <View style={styles.centerVisual}>
          <View style={styles.outerRing}>
            {stage === 'ringing' && <RingPulse />}
            <View style={styles.innerCircle}>
              {targetAvatarData ? (
                <GengalAvatar data={targetAvatarData} size={212} />
              ) : targetAvatarUri ? (
                <Image source={{ uri: targetAvatarUri }} style={styles.avatarImage} />
              ) : (
                <MaterialIcons name="person" size={96} color="#D8C9A8" />
              )}
            </View>
          </View>
        </View>

        <View style={styles.textContent}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>

        <View style={styles.bottomSection}>
          {steps.length > 1 && (
            <View style={styles.stepper} accessibilityRole="progressbar" accessibilityLabel={title}>
              {steps.map((step, i) => {
                const done = i < currentIndex;
                const active = i === currentIndex;
                return (
                  <React.Fragment key={step}>
                    {i > 0 && <View style={[styles.stepLine, (done || active) && styles.stepLineDone]} />}
                    <View style={styles.stepItem}>
                      <View style={[styles.stepDot, done && styles.stepDotDone, active && styles.stepDotActive]}>
                        {done ? <MaterialIcons name="check" size={12} color="#FFFFFF" /> : null}
                      </View>
                      <Text style={[styles.stepLabel, (done || active) && styles.stepLabelOn]}>{STEP_LABELS[step]}</Text>
                    </View>
                  </React.Fragment>
                );
              })}
            </View>
          )}

          <View style={styles.progressContainer}>
            <View style={styles.progressTrackPrivateBg}>
              {stage === 'ringing' ? (
                <Animated.View
                  style={[
                    styles.ringBar,
                    { width: ringProgress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
                  ]}
                />
              ) : (
                <IndeterminateBar />
              )}
            </View>
          </View>

          <TouchableOpacity
            style={styles.endCallBtn}
            onPress={onCancel}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Cancel call"
          >
            <MaterialIcons name="call-end" size={26} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.endCallLabel}>Cancel</Text>
        </View>
      </View>
    </Modal>
  );
}

function RandomSearch({ onCancel }: { onCancel: () => void }) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Pulse animation for the central heart
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.15,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        })
      ])
    ).start();

    // Progress bar animation (simulating connection progress)
    Animated.timing(progressAnim, {
      toValue: 1,
      duration: 10000, // 10s simulated connect
      easing: Easing.out(Easing.ease),
      useNativeDriver: false,
    }).start();
  }, [pulseAnim, progressAnim]);

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%']
  });

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onCancel}>
    <View style={styles.container}>
      {/* Central Visual */}
      <View style={styles.centerVisual}>
        <View style={styles.outerRing}>
          <View style={styles.innerCircle}>
            <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
              <MaterialIcons name="favorite" size={64} color="#E8CA58" />
            </Animated.View>
          </View>
        </View>
      </View>

      {/* Text Content */}
      <View style={styles.textContent}>
        <Text style={styles.title}>Finding a random connection...</Text>
        <Text style={styles.subtitle}>Your destiny is being chosen</Text>
      </View>

      {/* Progress & Cancel */}
      <View style={styles.bottomSection}>
        <View style={styles.progressContainer}>
          <View style={styles.progressTrackRandom}>
            <Animated.View style={[styles.progressBarRandom, { width: progressWidth }]} />
          </View>
        </View>

        <TouchableOpacity style={styles.cancelPill} onPress={onCancel} activeOpacity={0.8}>
          <MaterialIcons name="close" size={16} color="#B30005" />
          <Text style={styles.cancelPillText}>CANCEL</Text>
        </TouchableOpacity>
      </View>
    </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#FFFDF8',
    zIndex: 9999,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 60,
  },
  privateHeader: {
    position: 'absolute',
    top: 50,
    left: 24,
    right: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 10,
  },
  logoText: {
    fontFamily: 'serif',
    fontSize: 28,
    fontWeight: '700',
    color: '#4B0054',
    fontStyle: 'italic',
  },
  privatePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    ...Platform.select({
      ios: {
        shadowColor: '#4B0054',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
      },
      android: {
        elevation: 4,
      },
      web: {
        boxShadow: '0 4px 12px rgba(75,0,84,0.1)',
      }
    }),
  },
  privatePillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4B0054',
    marginLeft: 4,
  },
  centerVisual: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 60,
  },
  outerRing: {
    width: 280,
    height: 280,
    borderRadius: 140,
    borderWidth: 1,
    borderColor: 'rgba(232, 202, 88, 0.2)',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  innerCircle: {
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#E8CA58',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.2,
        shadowRadius: 40,
      },
      android: {
        elevation: 10,
      },
      web: {
        boxShadow: '0 0 40px rgba(232,202,88,0.2)',
      }
    }),
  },
  pulseRing: {
    position: 'absolute',
    width: 240,
    height: 240,
    borderRadius: 120,
    borderWidth: 2,
    borderColor: '#E8CA58',
  },
  avatarImage: { width: 212, height: 212, borderRadius: 106 },
  floatingHeart: {
    position: 'absolute',
    zIndex: 5,
  },
  textContent: {
    alignItems: 'center',
    paddingHorizontal: 32,
    marginBottom: 36,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#4B0054',
    textAlign: 'center',
    marginBottom: 12,
    fontFamily: 'serif',
  },
  subtitle: {
    fontSize: 15,
    color: '#666',
    textAlign: 'center',
    fontStyle: 'italic',
    lineHeight: 22,
  },
  bottomSection: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingBottom: 20,
  },
  stepper: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', marginBottom: 22, width: '100%' },
  stepItem: { alignItems: 'center', width: 76 },
  stepDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#E6DCCB',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotActive: { borderColor: '#B68D1C', backgroundColor: '#FFF4CC' },
  stepDotDone: { borderColor: '#B68D1C', backgroundColor: '#B68D1C' },
  stepLine: { height: 2, flex: 1, maxWidth: 48, backgroundColor: '#E6DCCB', marginTop: 9 },
  stepLineDone: { backgroundColor: '#B68D1C' },
  stepLabel: { marginTop: 6, fontSize: 11, fontWeight: '700', color: '#B3A79C' },
  stepLabelOn: { color: '#4B0054' },
  progressContainer: {
    width: '80%',
    height: 6,
    marginBottom: 30,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressTrackRandom: {
    width: '100%',
    height: '100%',
    backgroundColor: '#F3EFE9',
    borderRadius: 3,
  },
  progressBarRandom: {
    height: '100%',
    backgroundColor: '#F7D673',
    borderRadius: 3,
  },
  progressTrackPrivateBg: {
    width: '100%',
    height: '100%',
    backgroundColor: '#F3EFE9',
    borderRadius: 3,
    overflow: 'hidden',
  },
  ringBar: { height: '100%', borderRadius: 3, backgroundColor: '#D4AF37' },
  sweep: { position: 'absolute', top: 0, bottom: 0, width: 120 },
  endCallBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#D93A3A',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: { shadowColor: '#D93A3A', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12 },
      android: { elevation: 6 },
      web: { boxShadow: '0 6px 12px rgba(217,58,58,0.3)' },
    }),
  },
  endCallLabel: { marginTop: 8, fontSize: 12, fontWeight: '700', color: '#9A8C80', letterSpacing: 0.5 },
  cancelPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    ...Platform.select({
      ios: {
        shadowColor: '#4B0054',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.05,
        shadowRadius: 10,
      },
      android: {
        elevation: 2,
      },
      web: {
        boxShadow: '0 4px 10px rgba(75,0,84,0.05)',
      }
    }),
  },
  cancelPillText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#666',
    marginLeft: 8,
    letterSpacing: 1,
  },
});
