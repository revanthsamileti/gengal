import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';

/**
 * Whose turn it is, on the board itself: the coloured frame of the active
 * player's home corner goes a shade darker and breathes, the way Ludo King
 * marks it. Only the frame -- covering the white yard too turned it grey, which
 * read as "switched off". Sits over the board art and passes every touch through.
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
          borderWidth: cellSize * 0.75,
          opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.12, 0.34] }),
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  glow: { position: 'absolute', borderColor: '#000000' },
});
