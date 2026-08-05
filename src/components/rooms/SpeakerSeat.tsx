import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import GengalAvatar from '../GengalAvatar';
import { numeric, RoomTone, roomPalette, roomRadius } from '../../theme/roomTheme';

/**
 * A seat on the stage.
 *
 * Four states have to be distinguishable at a glance while someone is talking:
 * empty and claimable, occupied and muted, occupied and live, and occupied by
 * you. Empty seats say what they cost rather than just showing a dashed circle,
 * because a seat that costs coins should never be a surprise.
 */

type Props = {
  tone: RoomTone;
  /** Which side of the stage — used only for the label. */
  slot: 'boy' | 'girl' | 'host';
  occupant: { uid: string; nickname: string; avatarData?: any; isMuted?: boolean } | null;
  isYou: boolean;
  isHost: boolean;
  /** Drives the speaking halo. */
  isLive: boolean;
  size?: number;
  /** Shown on an empty seat. */
  seatPrice?: number | null;
  onTake?: () => void;
  onPressOccupant?: () => void;
  reduceMotion?: boolean;
};

const SLOT_LABEL: Record<Props['slot'], string> = {
  host: 'Host',
  boy: 'Open seat',
  girl: 'Open seat',
};

export function SpeakerSeat({
  tone, slot, occupant, isYou, isHost, isLive, size = 68,
  seatPrice, onTake, onPressOccupant, reduceMotion,
}: Props) {
  const c = roomPalette(tone);
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!isLive || reduceMotion) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 780, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 780, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isLive, reduceMotion, pulse]);

  if (!occupant) {
    return (
      <Pressable
        onPress={onTake}
        disabled={!onTake}
        accessibilityRole="button"
        accessibilityLabel={
          seatPrice
            ? `Take this seat for ${seatPrice} coins`
            : onTake ? 'Take this seat' : 'This seat is open'
        }
        style={({ pressed }) => [st.wrap, pressed && onTake && st.pressed]}
      >
        <View
          style={[
            st.avatar,
            st.empty,
            { width: size, height: size, borderRadius: size / 2, borderColor: c.line, backgroundColor: c.cardSunk },
          ]}
        >
          <MaterialIcons name="add" size={size * 0.3} color={c.inkFaint} />
        </View>
        <Text style={[st.name, { color: c.inkFaint }]} numberOfLines={1}>{SLOT_LABEL[slot]}</Text>
        {seatPrice ? (
          <Text style={[st.sub, numeric, { color: c.accent }]}>{seatPrice} coins</Text>
        ) : null}
      </Pressable>
    );
  }

  const muted = !!occupant.isMuted;

  return (
    <Pressable
      onPress={onPressOccupant}
      disabled={!onPressOccupant}
      accessibilityRole={onPressOccupant ? 'button' : undefined}
      accessibilityLabel={
        `${isYou ? 'You' : occupant.nickname}${isHost ? ', host' : ''}. ` +
        (muted ? 'Muted.' : isLive ? 'Speaking.' : 'On stage.')
      }
      style={({ pressed }) => [st.wrap, pressed && onPressOccupant && st.pressed]}
    >
      <View style={{ width: size, height: size }}>
        {isLive && !muted && (
          <Animated.View
            pointerEvents="none"
            style={[
              st.halo,
              {
                borderRadius: (size + 14) / 2,
                borderColor: c.live,
                opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.28, 0.85] }),
                transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) }],
              },
            ]}
          />
        )}
        <View
          style={[
            st.avatar,
            {
              width: size, height: size, borderRadius: size / 2,
              borderColor: isHost ? c.accent : muted ? c.line : c.live,
              backgroundColor: c.cardSunk,
            },
          ]}
        >
          <GengalAvatar data={occupant.avatarData} size={size - 6} />
        </View>

        {muted && (
          <View style={[st.badge, { backgroundColor: c.danger, borderColor: c.bg }]}>
            <MaterialIcons name="mic-off" size={11} color="#FFFFFF" />
          </View>
        )}
        {isHost && !muted && (
          <View style={[st.badge, { backgroundColor: c.accent, borderColor: c.bg }]}>
            <MaterialIcons name="star" size={11} color={c.onAccent} />
          </View>
        )}
      </View>

      <Text style={[st.name, { color: c.ink }]} numberOfLines={1}>
        {isYou ? 'You' : occupant.nickname}
      </Text>
      <Text style={[st.sub, { color: muted ? c.inkFaint : c.live }]} numberOfLines={1}>
        {muted ? 'Muted' : isHost ? 'Host' : 'On stage'}
      </Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 5, width: 96 },
  pressed: { opacity: 0.72 },
  avatar: {
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, overflow: 'hidden',
  },
  empty: { borderStyle: 'dashed' },
  halo: {
    position: 'absolute', left: -7, right: -7, top: -7, bottom: -7, borderWidth: 2,
  },
  badge: {
    position: 'absolute', right: -2, bottom: -2,
    width: 22, height: 22, borderRadius: 11, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  name: { fontSize: 12, fontWeight: '800' },
  sub: { fontSize: 10, fontWeight: '700' },
});
