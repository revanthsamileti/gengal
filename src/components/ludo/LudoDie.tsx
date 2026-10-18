import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { GEMS, ludo, numeric } from '../../theme/ludoTheme';
import type { PlayerColor } from '../../screens/LudoConstants';

/**
 * The die, the way Ludo King draws it (the owner pointed at it): a solid die
 * in the colour of whoever's turn it is, white pips, sitting in a bright slot,
 * with a bouncing arrow over it when it is yours to roll. Whose turn it is
 * reads from the colour alone, without a word of text.
 *
 * All flat transforms on the native driver; no 3D, which Android draws badly.
 */

const SIZE = 58;
/** The darker band under the die that makes it read as a block. */
const DEPTH = 5;
const SLOT = 82;
const FLICKER_MS = 80;
const OTHERS_ROLL_MS = 450;

const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[28, 28], [50, 50], [72, 72]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[28, 25], [72, 25], [28, 50], [72, 50], [28, 75], [72, 75]],
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
  const pulse = useRef(new Animated.Value(0)).current;
  const arrow = useRef(new Animated.Value(0)).current;
  const [face, setFace] = useState(value ?? 1);
  const [shaking, setShaking] = useState(false);
  const lastValue = useRef(value);

  // Shaking: a wobbling spin and a hop, pips flickering through faces.
  useEffect(() => {
    if (!shaking) return;
    const loop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(spin, { toValue: 1, duration: 110, easing: Easing.linear, useNativeDriver: true }),
          Animated.timing(spin, { toValue: -1, duration: 220, easing: Easing.linear, useNativeDriver: true }),
          Animated.timing(spin, { toValue: 0, duration: 110, easing: Easing.linear, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(hop, { toValue: 1, duration: 150, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(hop, { toValue: 0, duration: 150, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        ]),
      ]),
    );
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

  const settle = (next: number) => {
    setShaking(false);
    setFace(next);
    spin.setValue(0);
    hop.setValue(0.7);
    Animated.spring(hop, { toValue: 0, friction: 3.5, tension: 170, useNativeDriver: true }).start();
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

  // Your turn: the die pulses and an arrow bounces over it.
  useEffect(() => {
    if (!enabled || rolling || reduceMotion) {
      pulse.setValue(0);
      arrow.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1, duration: 520, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 0, duration: 520, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(arrow, { toValue: 1, duration: 420, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(arrow, { toValue: 0, duration: 620, easing: Easing.bounce, useNativeDriver: true }),
        ]),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [enabled, rolling, reduceMotion, pulse, arrow]);

  const gem = GEMS[turnColor];
  const live = enabled || rolling || shaking;
  const rotate = spin.interpolate({ inputRange: [-1, 1], outputRange: ['-18deg', '18deg'] });
  const translateY = hop.interpolate({ inputRange: [0, 1], outputRange: [0, -12] });
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });
  const arrowY = arrow.interpolate({ inputRange: [0, 1], outputRange: [0, -9] });

  return (
    <View style={styles.wrap}>
      {/* The arrow says "you": it only shows when the roll is yours. */}
      <Animated.View
        pointerEvents="none"
        style={[styles.arrow, { opacity: enabled && !rolling ? 1 : 0, transform: [{ translateY: arrowY }] }]}
      >
        <MaterialIcons name="arrow-drop-down" size={58} color="#F5A400" />
      </Animated.View>
      <Pressable
        onPress={onPress}
        disabled={!enabled}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={
          enabled ? (cost ? `Roll the dice, costs ${cost} coins` : 'Roll the dice') : 'Dice, not your turn'
        }
        accessibilityState={{ disabled: !enabled, busy: rolling }}
        style={({ pressed }) => [styles.slot, enabled && { borderColor: gem.core }, pressed && enabled && styles.pressed]}
      >
        <Animated.View
          style={[styles.die, { opacity: live ? 1 : 0.55, transform: [{ translateY }, { rotate }, { scale }] }]}
        >
          <View style={[styles.base, { backgroundColor: gem.dark }]} />
          <View style={[styles.face, { backgroundColor: gem.core }]}>
            <View style={styles.shine} />
            {(PIPS[face] ?? PIPS[1]).map(([px, py], i) => (
              <View
                key={i}
                style={[styles.pip, { left: (px / 100) * SIZE - PIP / 2, top: (py / 100) * SIZE - PIP / 2 }]}
              />
            ))}
          </View>
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
  wrap: { alignItems: 'center' },
  arrow: { position: 'absolute', top: -44, zIndex: 2 },
  slot: {
    width: SLOT,
    height: SLOT,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FCE4E4',
    borderWidth: 3,
    borderColor: '#F3C9C9',
  },
  pressed: { transform: [{ scale: 0.94 }] },
  die: { width: SIZE, height: SIZE + DEPTH },
  base: {
    position: 'absolute', left: 0, top: DEPTH, width: SIZE, height: SIZE, borderRadius: 13,
  },
  face: {
    position: 'absolute', left: 0, top: 0, width: SIZE, height: SIZE, borderRadius: 13, overflow: 'hidden',
  },
  shine: {
    position: 'absolute', left: 4, top: 3, width: SIZE * 0.6, height: SIZE * 0.24,
    borderRadius: SIZE * 0.12, backgroundColor: 'rgba(255,255,255,0.28)',
  },
  pip: {
    position: 'absolute', width: PIP, height: PIP, borderRadius: PIP / 2, backgroundColor: '#FFFFFF',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 1, shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  cost: { color: ludo.inkFaint, fontSize: 10, fontWeight: '800', letterSpacing: 0.3, marginTop: 4 },
});
