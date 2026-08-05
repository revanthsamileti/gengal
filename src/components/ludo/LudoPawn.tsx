import React, { memo, useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, Stop } from 'react-native-svg';
import { cellForPosition, pathBetween, PlayerColor } from '../../screens/LudoConstants';
import { GEMS } from '../../theme/ludoTheme';

/**
 * A player's pawn: the classic Ludo silhouette — round head over a bell body,
 * with a gloss highlight and a soft shadow so it reads as sitting on the board.
 *
 * Movement is animated hop by hop along the squares the pawn actually travels,
 * rather than cutting to the destination — on a shared board that is the only
 * way the other three players can see what just happened.
 */

const HOP_MS = 110;
/** Minimum comfortable touch target; the pawn itself is smaller than this. */
const MIN_TOUCH = 44;

type Props = {
  color: PlayerColor;
  index: number;
  position: number;
  cellSize: number;
  /** Nudge for pawns sharing a square, in cell units. */
  stackOffset: number;
  movable: boolean;
  reduceMotion: boolean;
  onPress?: () => void;
  label: string;
};

function PawnArt({ width, height, color }: { width: number; height: number; color: PlayerColor }) {
  const c = GEMS[color];
  return (
    <Svg width={width} height={height} viewBox="0 0 40 44">
      <Defs>
        <LinearGradient id={`pw-${color}`} x1="0.2" y1="0" x2="0.85" y2="1">
          <Stop offset="0" stopColor={c.light} />
          <Stop offset="0.45" stopColor={c.core} />
          <Stop offset="1" stopColor={c.dark} />
        </LinearGradient>
      </Defs>

      {/* Contact shadow */}
      <Ellipse cx="20" cy="39.5" rx="12" ry="3.2" fill="#000" opacity="0.22" />

      {/* Body — narrow at the neck, bellied at the base */}
      <Path
        d="M20 15 C25.5 15 29 21 30.5 28 C31.8 34 29 38.5 20 38.5 C11 38.5 8.2 34 9.5 28 C11 21 14.5 15 20 15 Z"
        fill={`url(#pw-${color})`}
        stroke={c.dark}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      {/* Head */}
      <Circle cx="20" cy="11" r="8" fill={`url(#pw-${color})`} stroke={c.dark} strokeWidth="1.6" />

      {/* Gloss */}
      <Ellipse cx="16.6" cy="8.2" rx="3.1" ry="3.6" fill="#FFFFFF" opacity="0.55" transform="rotate(-20 16.6 8.2)" />
      <Path d="M14.6 22 C13.4 26 13 30 13.6 34" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" opacity="0.30" fill="none" />
    </Svg>
  );
}

function LudoPawnImpl({
  color, index, position, cellSize, stackOffset, movable, reduceMotion, onPress, label,
}: Props) {
  const target = cellForPosition(color, position, index);
  const anim = useRef(new Animated.ValueXY({ x: target.x, y: target.y })).current;
  const lift = useRef(new Animated.Value(0)).current;
  const prevPosition = useRef(position);

  // Walk the pawn through every square between its old and new position.
  useEffect(() => {
    const from = prevPosition.current;
    prevPosition.current = position;
    if (from === position) return;

    const dest = cellForPosition(color, position, index);
    if (reduceMotion) {
      anim.setValue({ x: dest.x, y: dest.y });
      return;
    }

    const steps = pathBetween(color, from, position).map((p) => {
      const cell = cellForPosition(color, p, index);
      return Animated.timing(anim, {
        toValue: { x: cell.x, y: cell.y },
        duration: HOP_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      });
    });

    Animated.sequence(steps).start();
  }, [position, color, index, reduceMotion, anim]);

  // A legal move bobs so it reads as tappable without extra chrome.
  useEffect(() => {
    if (!movable || reduceMotion) {
      lift.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(lift, { toValue: 1, duration: 520, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(lift, { toValue: 0, duration: 520, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [movable, reduceMotion, lift]);

  // Pawns stand taller than a cell, so the art overhangs upward.
  const pawnW = cellSize * 1.02;
  const pawnH = pawnW * (44 / 40);
  const pad = Math.max(0, (MIN_TOUCH - pawnW) / 2);

  // cellForPosition gives the CENTRE of the square. Centre the pawn on that x,
  // and plant its base on the square's bottom edge so it reads as standing on
  // the square rather than floating over it.
  const offsetX = -pawnW / 2 + stackOffset * cellSize;
  const offsetY = cellSize / 2 - pawnH + stackOffset * cellSize;

  const translateX = anim.x.interpolate({
    inputRange: [0, 1], outputRange: [offsetX, offsetX + cellSize],
  });
  const translateY = anim.y.interpolate({
    inputRange: [0, 1], outputRange: [offsetY, offsetY + cellSize],
  });

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.root,
        {
          width: pawnW,
          height: pawnH,
          transform: [
            { translateX },
            { translateY },
            { translateY: lift.interpolate({ inputRange: [0, 1], outputRange: [0, -cellSize * 0.22] }) },
          ],
          zIndex: movable ? 40 : 20,
        },
      ]}
    >
      <Pressable
        onPress={onPress}
        disabled={!movable}
        hitSlop={{ top: pad, bottom: pad, left: pad, right: pad }}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: !movable }}
        style={styles.press}
      >
        {movable && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.halo,
              {
                width: cellSize * 0.92,
                height: cellSize * 0.92,
                borderRadius: cellSize * 0.46,
                borderColor: GEMS[color].light,
                opacity: lift.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.95] }),
              },
            ]}
          />
        )}
        <View style={StyleSheet.absoluteFill}>
          <PawnArt width={pawnW} height={pawnH} color={color} />
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', left: 0, top: 0 },
  press: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'flex-end' },
  halo: { position: 'absolute', bottom: -2, borderWidth: 2 },
});

export const LudoPawn = memo(LudoPawnImpl);
