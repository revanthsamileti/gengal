import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Easing, Dimensions, Platform, Modal } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

type ConnectingOverlayProps = {
  mode: 'random' | 'private';
  targetName?: string;
  onCancel: () => void;
  status?: 'connecting' | 'ringing';
};

const { width, height } = Dimensions.get('window');

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

export default function ConnectingOverlay({ mode, targetName, onCancel, status = 'connecting' }: ConnectingOverlayProps) {
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
      {mode === 'private' && (
        <>
          {/* Header specific to Private mode */}
          <View style={styles.privateHeader}>
            <Text style={styles.logoText}>Gengal</Text>
            <View style={styles.privatePill}>
              <MaterialIcons name="lock" size={12} color="#8D6E18" />
              <Text style={styles.privatePillText}>Private Session</Text>
            </View>
          </View>
          
          {/* Floating Hearts background */}
          {[...Array(6)].map((_, i) => (
            <FloatingHeart key={`heart-${i}`} index={i} delay={i * 600} />
          ))}
        </>
      )}

      {/* Central Visual */}
      <View style={styles.centerVisual}>
        <View style={styles.outerRing}>
          <View style={styles.innerCircle}>
            {mode === 'random' ? (
              <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                <MaterialIcons name="favorite" size={64} color="#E8CA58" />
              </Animated.View>
            ) : null /* Private mode has empty circle with hearts floating up through it */}
          </View>
        </View>
      </View>

      {/* Text Content */}
      <View style={styles.textContent}>
        <Text style={styles.title}>
          {status === 'ringing'
            ? 'Ringing...'
            : (mode === 'random' ? 'Finding a random connection...' : 'Connecting...')}
        </Text>
        
        {mode === 'random' ? (
          <Text style={styles.subtitle}>Your destiny is being chosen</Text>
        ) : (
          <Text style={styles.subtitle}>
            {status === 'ringing' ? (
              <>
                Waiting for <Text style={styles.targetName}>{targetName}</Text> to answer...
              </>
            ) : (
              <>
                Connecting you with <Text style={styles.targetName}>{targetName}</Text> for an exclusive private conversation.
              </>
            )}
          </Text>
        )}
      </View>

      {/* Progress & Cancel */}
      <View style={styles.bottomSection}>
        <View style={styles.progressContainer}>
          {mode === 'random' ? (
            <View style={styles.progressTrackRandom}>
              <Animated.View style={[styles.progressBarRandom, { width: progressWidth }]} />
            </View>
          ) : (
            <View style={styles.progressTrackPrivateBg}>
              <Animated.View style={{ height: '100%', width: progressWidth, overflow: 'hidden', borderRadius: 3 }}>
                <LinearGradient
                  colors={['#E8CA58', '#B68D1C']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={{ width: '100%', height: '100%', minWidth: 200 }} // Ensure gradient stretches correctly
                />
              </Animated.View>
            </View>
          )}
        </View>

        {mode === 'random' ? (
          <TouchableOpacity style={styles.cancelPill} onPress={onCancel} activeOpacity={0.8}>
            <MaterialIcons name="close" size={16} color="#B30005" />
            <Text style={styles.cancelPillText}>CANCEL</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.cancelTextBtn} onPress={onCancel} activeOpacity={0.8}>
            <Text style={styles.cancelTextBtnLabel}>CANCEL REQUEST</Text>
          </TouchableOpacity>
        )}
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
  floatingHeart: {
    position: 'absolute',
    zIndex: 5,
  },
  textContent: {
    alignItems: 'center',
    paddingHorizontal: 32,
    marginBottom: 60,
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
  targetName: {
    fontWeight: '700',
    color: '#B68D1C',
    fontStyle: 'normal',
  },
  bottomSection: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingBottom: 20,
  },
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
    backgroundColor: '#F3EFE9', // Subtle background for the private track
    borderRadius: 3,
  },
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
  cancelTextBtn: {
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  cancelTextBtnLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#999',
    letterSpacing: 1,
  },
});
