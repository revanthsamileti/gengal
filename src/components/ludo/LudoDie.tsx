import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { GEMS, ludo, numeric } from '../../theme/ludoTheme';
import type { PlayerColor } from '../../screens/LudoConstants';

/**
 * The die is the primary control, so it is sized and placed for the thumb.
 *
 * A classic white die with black pips, the one the owner asked for. It looks
 * solid without any 3D transform: a shaded face, a darker edge offset behind it
 * for thickness, and a slight tilt. The earlier cube turned in depth, which
 * Android draws unreliably, and it was never tried on a phone; players there
 * reported the die "not working". Everything here is flat (rotate, scale,
 * translate) and runs on the native driver.
 *
 * Three states read differently at a glance: grey and still when it is not your
 * turn, white with a coloured glow and a slow breathe when it is, and shaking
 * through faces while the roll resolves.
 */

const SIZE = 70;
/** How thick the die looks: the edge drawn behind the face. */
const DEPTH = 5;
/** Resting tilt, like a die that has just come to a stop. */
const REST_DEG = -9;
/** How often the pips change while it is shaking. */
const FLICKER_MS = 85;
/** Another player's roll still shows as a short shake. */
const OTHERS_ROLL_MS = 450;

const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[27, 27], [73, 73]],
  3: [[27, 27], [50, 50], [73, 73]],
  4: [[27, 27], [73, 27], [27, 73], [73, 73]],
  5: [[27, 27], [73, 27], [50, 50], [27, 73], [73, 73]],
  6: [[27, 24], [73, 24], [27, 50], [73, 50], [27, 76], [73, 76]],
};
const PIP = SIZE * 0.17;

type Props = {
  value: number | null;
  rolling: boolean;
  enabled: boolean;
  turnColor: PlayerColor;
  /** Shown under the die when the roll costs coins. */
  cost?: number | null;
  onPress: () => void;
  reduceMotion: boolean;
};

export function LudoDie({ value, rolling, enabled, turnColor, cost, onPress, reduceMotion }: Props) {
  const spin = useRef(new Animated.Value(0)).current;
  const hop = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;
  const [face, setFace] = useState(value ?? 1);
  const [shaking, setShaking] = useState(false);
  const lastValue = useRef(value);

  // Shaking: spin and hop on the native driver, pips flicker on a timer.
  useEffect(() => {
    if (!shaking) return;
    const loop = Animated.loop(
      Animated.parallel([
        Animated.timing(spin, { toValue: 1, duration: 420, easing: Easing.linear, useNativeDriver: true }),
        Animated.sequence([
          Animated.timing(hop, { toValue: 1, duration: 140, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(hop, { toValue: 0, duration: 140, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        ]),
      ]),
    );
    spin.setValue(0);
    loop.start();
    let n = Math.floor(Math.random() * 6);
    const flicker = setInterval(() => {
      n = (n + 1 + Math.floor(Math.random() * 4)) % 6;
      setFace(n + 1);
    }, FLICKER_MS);
    return () => {
      loop.stop();
      clearInterval(flicker);
    };
  }, [shaking, spin, hop]);

  // Coming to rest: a quick settle onto the resting tilt.
  const settle = (next: number) => {
    setShaking(false);
    setFace(next);
    spin.setValue(0);
    hop.setValue(0.6);
    Animated.spring(hop, { toValue: 0, friction: 4, tension: 160, useNativeDriver: true }).start();
  };

  // Our own roll shakes for exactly as long as the server takes.
  useEffect(() => {
    if (rolling && !reduceMotion) setShaking(true);
  }, [rolling, reduceMotion]);

  // A value arriving -- ours, or another player's -- lands the die on it.
  useEffect(() => {
    if (rolling) return;
    const changed = value != null && value !== lastValue.current;
    lastValue.current = value;
    if (value == null) {
      setShaking(false);
      return;
    }
    if (shaking) {
      settle(value);
      return;
    }
    if (changed && !reduceMotion) {
      // Somebody else rolled: show it as a short shake, then the number.
      setShaking(true);
      const t = setTimeout(() => settle(value), OTHERS_ROLL_MS);
      return () => clearTimeout(t);
    }
    setFace(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rolling, value, reduceMotion]);

  // A roll that ends without a value (refused, timed out) must not keep shaking.
  useEffect(() => {
    if (rolling || !shaking || value != null) return;
    const t = setTimeout(() => setShaking(false), 600);
    return () => clearTimeout(t);
  }, [rolling, shaking, value]);

  // Your turn: a slow breathe that says "tap me".
  useEffect(() => {
    if (!enabled || rolling || reduceMotion) {
      breathe.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [enabled, rolling, reduceMotion, breathe]);

  const live = enabled || rolling || shaking;
  const accent = GEMS[turnColor].core;
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: [`${REST_DEG}deg`, `${REST_DEG + 360}deg`] });
  const translateY = hop.interpolate({ inputRange: [0, 1], outputRange: [0, -10] });
  const scale = breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });
  const glowOpacity = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.7] });

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={onPress}
        disabled={!enabled}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={
          enabled ? (cost ? `Roll the dice, costs ${cost} coins` : 'Roll the dice') : 'Dice, not your turn'
        }
        accessibilityState={{ disabled: !enabled, busy: rolling }}
        style={({ pressed }) => [styles.press, pressed && enabled && styles.pressed]}
      >
        {/* Turn colour, as a glow under the die. */}
        <Animated.View
          pointerEvents="none"
          style={[styles.glow, { backgroundColor: accent, opacity: live ? glowOpacity : 0 }]}
        />
        <Animated.View
          style={[
            styles.stage,
            { opacity: live ? 1 : 0.55, transform: [{ translateY }, { rotate }, { scale }] },
          ]}
        >
          {/* The edge behind the face makes it read as a solid block. */}
          <View style={styles.edge} />
          <LinearGradient
            colors={live ? ['#FFFFFF', '#F1F1F1', '#D9D9D9'] : ['#F2F2F2', '#E4E4E4', '#CFCFCF']}
            start={{ x: 0.15, y: 0.05 }}
            end={{ x: 0.95, y: 1 }}
            style={styles.face}
          >
            <View style={styles.highlight} />
            {(PIPS[face] ?? PIPS[1]).map(([px, py], i) => (
              <View
                key={i}
                style={[
                  styles.pip,
                  { left: (px / 100) * SIZE - PIP / 2, top: (py / 100) * SIZE - PIP / 2 },
                  !live && styles.pipIdle,
                ]}
              >
                <View style={styles.pipShine} />
              </View>
            ))}
          </LinearGradient>
        </Animated.View>
      </Pressable>

      {cost ? (
        <Text style={[styles.cost, numeric]} accessibilityElementsHidden>
          {cost} coins a roll
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 5 },
  press: { padding: 8, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.95 }] },
  glow: {
    position: 'absolute',
    width: SIZE * 0.9,
    height: 14,
    bottom: 2,
    borderRadius: 7,
  },
  stage: { width: SIZE + DEPTH, height: SIZE + DEPTH },
  edge: {
    position: 'absolute',
    left: DEPTH,
    top: DEPTH,
    width: SIZE,
    height: SIZE,
    borderRadius: 15,
    backgroundColor: '#A9A9A9',
  },
  face: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: SIZE,
    height: SIZE,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.12)',
    overflow: 'hidden',
  },
  // A soft shine on the upper left, where the light comes from.
  highlight: {
    position: 'absolute',
    left: 5,
    top: 4,
    width: SIZE * 0.55,
    height: SIZE * 0.22,
    borderRadius: SIZE * 0.11,
    backgroundColor: 'rgba(255,255,255,0.75)',
  },
  pip: {
    position: 'absolute',
    width: PIP,
    height: PIP,
    borderRadius: PIP / 2,
    backgroundColor: '#141414',
    borderTopWidth: 1.5,
    borderLeftWidth: 1.5,
    borderColor: '#000000',
  },
  pipIdle: { backgroundColor: '#8C8C8C', borderColor: '#7A7A7A' },
  // The little glint that makes a drilled pip look round.
  pipShine: {
    position: 'absolute',
    right: PIP * 0.16,
    bottom: PIP * 0.16,
    width: PIP * 0.28,
    height: PIP * 0.28,
    borderRadius: PIP * 0.14,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  cost: { color: ludo.inkFaint, fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },
});
