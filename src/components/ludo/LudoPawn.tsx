import React, { memo, useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, Stop } from 'react-native-svg';
import { cellForPosition, pathBetween, PlayerColor } from '../../screens/LudoConstants';
import { GEMS } from '../../theme/ludoTheme';

/**
 * A player's pawn, as Ludo King draws it: a silver map pin with the player's
 * colour in its head, standing on a coloured ring that marks the square. The
 * pin rises above the board, so pawns stay readable even on small squares.
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

/** The art's box, and where the ring it stands on is centred in it. */
const ART_W = 40;
const ART_H = 50;
const RING_Y = 43;

function PawnArt({ width, height, color }: { width: number; height: number; color: PlayerColor }) {
  const c = GEMS[color];
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${ART_W} ${ART_H}`}>
      <Defs>
        <LinearGradient id={`pw-${color}`} x1="0.2" y1="0" x2="0.85" y2="1">
          <Stop offset="0" stopColor={c.light} />
          <Stop offset="0.5" stopColor={c.core} />
          <Stop offset="1" stopColor={c.dark} />
        </LinearGradient>
        <LinearGradient id="pw-silver" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#FFFFFF" />
          <Stop offset="0.55" stopColor="#E3E7EC" />
          <Stop offset="1" stopColor="#9EA7B1" />
        </LinearGradient>
      </Defs>

      {/* The ring on the square: the player's colour with a dark rim */}
      <Ellipse cx="20" cy={RING_Y} rx="12.5" ry="5.6" fill={c.dark} />
      <Ellipse cx="20" cy={RING_Y - 0.6} rx="10.8" ry="4.5" fill={c.core} />
      <Ellipse cx="20" cy={RING_Y - 0.6} rx="6.4" ry="2.5" fill={c.dark} opacity="0.35" />

      {/* The pin: a silver teardrop whose point stands in the ring */}
      <Path
        d={`M20 ${RING_Y} C16 35 7.5 28.5 7.5 17 A12.5 12.5 0 1 1 32.5 17 C32.5 28.5 24 35 20 ${RING_Y} Z`}
        fill="url(#pw-silver)"
        stroke="#7D8792"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      {/* The player's colour in the head */}
      <Circle cx="20" cy="16.5" r="7.6" fill={`url(#pw-${color})`} stroke={c.dark} strokeWidth="1.2" />

      {/* Gloss */}
      <Ellipse cx="17" cy="13.6" rx="2.6" ry="2.1" fill="#FFFFFF" opacity="0.7" transform="rotate(-25 17 13.6)" />
      <Path d="M11.5 12 C10.6 16 11.2 21 13.4 25" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" opacity="0.8" fill="none" />
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
        // A real hop, as in Ludo King: up quickly, down with a bounce.
        Animated.timing(lift, { toValue: 1, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(lift, { toValue: 0, duration: 420, easing: Easing.bounce, useNativeDriver: true }),
        Animated.delay(120),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [movable, reduceMotion, lift]);

  // Pins stand taller than a cell, so the art overhangs upward.
  const pawnW = cellSize * 1.16;
  const pawnH = pawnW * (ART_H / ART_W);
  const pad = Math.max(0, (MIN_TOUCH - pawnW) / 2);
  // Where the ring sits, measured up from the bottom of the art.
  const ringFromBottom = pawnH * ((ART_H - RING_Y) / ART_H);

  // cellForPosition gives the CENTRE of the square: centre the pawn on that x,
  // and put the ring it stands on just below the centre, so the ring marks the
  // square and the pin rises out of it.
  const offsetX = -pawnW / 2 + stackOffset * cellSize;
  const offsetY = cellSize * 0.12 - (pawnH - ringFromBottom) + stackOffset * cellSize;

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
            { translateY: lift.interpolate({ inputRange: [0, 1], outputRange: [0, -cellSize * 0.45] }) },
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
                bottom: ringFromBottom - cellSize * 0.46,
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
  halo: { position: 'absolute', borderWidth: 2.5 },
});

export const LudoPawn = memo(LudoPawnImpl);
