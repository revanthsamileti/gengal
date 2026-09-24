import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { GEMS, ludo, numeric } from '../../theme/ludoTheme';
import type { PlayerColor } from '../../screens/LudoConstants';

/**
 * The die is the primary control, so it is sized and placed for the thumb.
 *
 * Three states read differently at a glance: flat and grey when it is not your
 * turn, white with a coloured ring and a slow breath when it is, and tumbling
 * while the roll resolves.
 */

const SIZE = 76;
const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[28, 28], [50, 50], [72, 72]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[28, 24], [72, 24], [28, 50], [72, 50], [28, 76], [72, 76]],
};

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
  const tumble = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;
  const settle = useRef(new Animated.Value(1)).current;
  const [face, setFace] = useState(value ?? 1);

  // Cycle faces while the roll is in flight, then land on the real value.
  useEffect(() => {
    if (!rolling) {
      if (value) setFace(value);
      return;
    }
    if (reduceMotion) return;
    const id = setInterval(() => setFace(Math.floor(Math.random() * 6) + 1), 70);
    return () => clearInterval(id);
  }, [rolling, value, reduceMotion]);

  // Tumble, then a short overshoot as it settles.
  useEffect(() => {
    if (reduceMotion) return;
    if (rolling) {
      tumble.setValue(0);
      Animated.loop(
        Animated.timing(tumble, {
          toValue: 1, duration: 460, easing: Easing.linear, useNativeDriver: true,
        })
      ).start();
    } else {
      tumble.stopAnimation(() => tumble.setValue(0));
      Animated.sequence([
        Animated.timing(settle, { toValue: 1.14, duration: 110, useNativeDriver: true }),
        Animated.spring(settle, { toValue: 1, friction: 4, tension: 140, useNativeDriver: true }),
      ]).start();
    }
  }, [rolling, reduceMotion, tumble, settle]);

  // Idle invitation when the roll is available.
  useEffect(() => {
    if (!enabled || rolling || reduceMotion) {
      breathe.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [enabled, rolling, reduceMotion, breathe]);

  const rotate = tumble.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const scale = Animated.multiply(
    settle,
    breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] })
  );

  // The border and glow say whose turn it is; the pips have to be read, so
  // they take the ink variant. Yellow core on a white die face was 1.8:1.
  const accent = GEMS[turnColor].core;
  const pipColor = GEMS[turnColor].ink;
  const live = enabled || rolling;
  const pips = PIPS[face] ?? PIPS[1];

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={onPress}
        disabled={!enabled}
        accessibilityRole="button"
        accessibilityLabel={
          enabled ? (cost ? `Roll the dice, costs ${cost} coins` : 'Roll the dice') : 'Dice, not your turn'
        }
        accessibilityState={{ disabled: !enabled, busy: rolling }}
        style={({ pressed }) => [styles.press, pressed && enabled && styles.pressed]}
      >
        <Animated.View
          style={[
            styles.die,
            {
              transform: [{ rotate }, { scale }],
              borderColor: live ? accent : ludo.grid,
              opacity: live ? 1 : 0.5,
              shadowColor: live ? accent : '#000',
            },
          ]}
        >
          {pips.map(([px, py], i) => (
            <View
              key={i}
              style={[
                styles.pip,
                {
                  left: (px / 100) * SIZE - 5,
                  top: (py / 100) * SIZE - 5,
                  backgroundColor: live ? pipColor : ludo.inkFaint,
                },
              ]}
            />
          ))}
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
  press: { padding: 5, borderRadius: 20 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.96 }] },
  die: {
    width: SIZE,
    height: SIZE,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 3,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 8,
  },
  pip: { position: 'absolute', width: 10, height: 10, borderRadius: 5 },
  cost: { color: ludo.inkFaint, fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },
});
