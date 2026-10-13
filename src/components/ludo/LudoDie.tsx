import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { GEMS, ludo, numeric } from '../../theme/ludoTheme';
import type { PlayerColor } from '../../screens/LudoConstants';
import { RING, buildFaceTrack, facePerspective, landingIndex, sideValue } from './dieGeometry';

/**
 * The die is the primary control, so it is sized and placed for the thumb.
 *
 * It is a cube: at rest it sits a little turned so a second face shows, it
 * tumbles a quarter turn at a time while a roll is in flight, and it comes down
 * on the rolled value. Three states still read differently at a glance: flat
 * and grey when it is not your turn, white with a coloured edge and a slow rock
 * when it is, and tumbling while the roll resolves.
 *
 * See dieGeometry.ts for why it turns one axis at a time.
 */

const SIZE = 76;
const PERSPECTIVE = 420;
const FACE_PERSPECTIVE = facePerspective(SIZE, PERSPECTIVE);
/** How far round the resting die sits, in quarter turns: enough to show an edge. */
const REST = 0.13;
const QUARTER_MS = 150;
/** A roll whose value never arrives must not spin for ever. */
const SPIN_LIMIT_MS = 1500;

const TRACKS = Array.from({ length: RING }, (_, j) => buildFaceTrack(j, SIZE, PERSPECTIVE));

const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[28, 28], [50, 50], [72, 72]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[28, 24], [72, 24], [28, 50], [72, 50], [28, 76], [72, 76]],
};

/** Values for the four views, with `front` showing in view `at`. */
function ringShowing(front: number, at: number): number[] {
  const side = sideValue(front);
  const order = [front, side, 7 - front, 7 - side];
  return Array.from({ length: RING }, (_, j) => order[(j - at + RING) % RING]);
}

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
  const turn = useRef(new Animated.Value(REST)).current;
  const rock = useRef(new Animated.Value(0)).current;
  const settle = useRef(new Animated.Value(1)).current;
  const [ring, setRing] = useState(() => ringShowing(value ?? 1, 0));

  /** The value the die is showing, or is on its way down to. */
  const shown = useRef(value ?? 1);
  /** The last `value` seen, so a roll of the same number again still tumbles. */
  const lastValue = useRef(value);
  const spinning = useRef(false);
  /** While tumbling: the listener that deals new numbers, and where it is up to. */
  const dealer = useRef<string | null>(null);
  const dealt = useRef({ step: -1, next: 0 });

  const stopDealing = useCallback(() => {
    if (dealer.current) turn.removeListener(dealer.current);
    dealer.current = null;
  }, [turn]);
  useEffect(() => stopDealing, [stopDealing]);

  const spin = useCallback(() => {
    spinning.current = true;
    Animated.spring(settle, { toValue: 0.88, friction: 7, tension: 160, useNativeDriver: true }).start();
    // Four views would otherwise show the same four numbers lap after lap. Each
    // time a face comes square-on, the view that has just gone out of sight is
    // given the next number -- it is two quarter turns from being seen again,
    // which is ample time for the change to land -- so all six sides go by.
    stopDealing();
    dealt.current.step = -1;
    dealer.current = turn.addListener(({ value: t }) => {
      const step = Math.floor(t) % RING;
      if (step === dealt.current.step) return;
      dealt.current.step = step;
      const face = ((dealt.current.next++) % 6) + 1;
      setRing((prev) => {
        const out = [...prev];
        out[(step + RING - 1) % RING] = face;
        return out;
      });
    });
    turn.stopAnimation((current) => {
      // The pose repeats every lap, so starting from the same place one lap
      // back keeps the numbers small without anything moving.
      const from = current % RING;
      turn.setValue(from);
      Animated.loop(
        Animated.timing(turn, {
          toValue: from + RING, duration: RING * QUARTER_MS, easing: Easing.linear, useNativeDriver: true,
        })
      ).start();
    });
  }, [turn, settle, stopDealing]);

  const land = useCallback((next: number) => {
    shown.current = next;
    spinning.current = false;
    stopDealing();
    turn.stopAnimation((current) => {
      const from = current % RING;
      turn.setValue(from);
      const target = landingIndex(from);
      // Both views being written are out of sight at this moment; the one after
      // the target is the edge that shows beside it at rest.
      setRing((prev) => {
        const out = [...prev];
        out[target % RING] = next;
        out[(target + 1) % RING] = sideValue(next);
        return out;
      });
      const run = () => {
        Animated.timing(turn, {
          toValue: target + REST,
          duration: Math.round((target + REST - from) * QUARTER_MS * 1.4),
          easing: Easing.out(Easing.back(1.3)),
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (finished) turn.setValue((target % RING) + REST);
        });
        Animated.sequence([
          Animated.delay(Math.round((target - from) * QUARTER_MS)),
          Animated.spring(settle, { toValue: 1, friction: 4, tension: 150, useNativeDriver: true }),
        ]).start();
      };
      // Let the new pips reach the screen before those views swing into sight.
      requestAnimationFrame(() => requestAnimationFrame(run));
    });
  }, [turn, settle, stopDealing]);

  /** No tumble: put the value on the face that is already showing. */
  const show = useCallback((next: number) => {
    shown.current = next;
    spinning.current = false;
    stopDealing();
    turn.stopAnimation((current) => {
      const at = Math.floor(current % RING);
      turn.setValue(at + REST);
      settle.setValue(1);
      setRing(ringShowing(next, at));
    });
  }, [turn, settle, stopDealing]);

  // Our own roll: tumble until the value comes back.
  useEffect(() => {
    if (rolling && !reduceMotion) spin();
  }, [rolling, reduceMotion, spin]);

  // A value arriving -- ours, or another player's -- brings the die down on it.
  useEffect(() => {
    if (rolling) return;
    const fresh = value != null && (spinning.current || lastValue.current == null || value !== shown.current);
    lastValue.current = value;
    if (fresh && value != null) {
      if (reduceMotion) show(value);
      else land(value);
      return;
    }
    if (!spinning.current) return;
    // The roll has finished but its value has not arrived (a refused roll, or
    // a slow snapshot). Give it a moment, then settle back where it was.
    const timer = setTimeout(() => { if (spinning.current) land(shown.current); }, SPIN_LIMIT_MS);
    return () => clearTimeout(timer);
  }, [rolling, value, reduceMotion, land, show]);

  // Idle invitation when the roll is available.
  useEffect(() => {
    if (!enabled || rolling || reduceMotion) {
      rock.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(rock, { toValue: 0.07, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(rock, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [enabled, rolling, reduceMotion, rock]);

  const faces = useMemo(() => {
    const position = Animated.add(turn, rock);
    const at = (outputRange: number[] | string[], inputRange: number[]) =>
      position.interpolate({ inputRange, outputRange, extrapolate: 'clamp' });
    return TRACKS.map((track) => ({
      opacity: at(track.opacity, track.input),
      shade: at(track.shade, track.input),
      transform: [
        { perspective: FACE_PERSPECTIVE },
        { translateX: at(track.translateX, track.input) },
        { translateY: at(track.translateY, track.input) },
        { scale: at(track.scale, track.input) },
        { rotateX: at(track.rotateX, track.input) },
        { rotateY: at(track.rotateY, track.input) },
      ],
    }));
  }, [turn, rock]);

  // The edge says whose turn it is; the pips have to be read, so they take the
  // ink variant. Yellow core on a white die face was 1.8:1.
  const accent = GEMS[turnColor].core;
  const pipColor = GEMS[turnColor].ink;
  const live = enabled || rolling;

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
        <Animated.View style={[styles.stage, { opacity: live ? 1 : 0.5, transform: [{ scale: settle }] }]}>
          <View style={[styles.ground, live && { backgroundColor: accent, opacity: 0.22 }]} />
          {faces.map((face, j) => (
            <Animated.View
              key={j}
              pointerEvents="none"
              style={[
                styles.face,
                { borderColor: live ? accent : ludo.grid, opacity: face.opacity, transform: face.transform },
              ]}
            >
              {(PIPS[ring[j]] ?? PIPS[1]).map(([px, py], i) => (
                <View
                  key={i}
                  style={[
                    styles.pip,
                    {
                      left: (px / 100) * SIZE - 8,
                      top: (py / 100) * SIZE - 8,
                      backgroundColor: live ? pipColor : ludo.inkFaint,
                    },
                  ]}
                />
              ))}
              <Animated.View style={[styles.shade, { opacity: face.shade }]} />
            </Animated.View>
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
  stage: { width: SIZE, height: SIZE },
  // The cast shadow lives on the ground, not on the faces: a shadow on a view
  // that is rotating in depth is drawn as if it were still flat.
  ground: {
    position: 'absolute',
    left: SIZE * 0.1,
    right: SIZE * 0.1,
    bottom: -9,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#000000',
    opacity: 0.12,
  },
  face: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: SIZE,
    height: SIZE,
    borderRadius: 13,
    borderWidth: 3,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  // Pips sit inside the 3pt border, so they are placed against the padding box.
  pip: { position: 'absolute', width: 10, height: 10, borderRadius: 5 },
  shade: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#1C1C1C' },
  cost: { color: ludo.inkFaint, fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },
});
