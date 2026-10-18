import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';

/**
 * Whose turn it is, on the board itself: the active player's home corner goes
 * a shade darker and breathes, the way Ludo King marks it. Sits over the board
 * art and passes every touch through.
 */
export function ActiveBaseGlow({
  origin, cellSize, reduceMotion,
}: { origin: { x: number; y: number }; cellSize: number; reduceMotion: boolean }) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(0.5);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, pulse]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.glow,
        {
          left: origin.x * cellSize,
          top: origin.y * cellSize,
          width: cellSize * 6,
          height: cellSize * 6,
          opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.1, 0.26] }),
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  glow: { position: 'absolute', backgroundColor: '#000000', borderRadius: 6 },
});
