import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { ConnectionState } from '../../hooks/useRoomPresence';

type Props = {
  state: ConnectionState;
  /** Rooms render dark; the lobbies render light. */
  tone?: 'dark' | 'light';
};

/**
 * Tells the user when a live room has stopped being live for them.
 *
 * Without this, a dropped connection is indistinguishable from a quiet room:
 * the roster freezes, chat stops arriving, and nothing on screen says why. That
 * matters most in Club, where the room is charging per minute — someone should
 * never be sitting in a paid room wondering whether it is broken or boring.
 *
 * Deliberately silent in the healthy state. A permanent "connected" chip is
 * noise that trains people to stop reading the strip exactly when it starts
 * saying something.
 */
export default function ConnectionBanner({ state, tone = 'dark' }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const visible = state !== 'live';

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [visible, opacity]);

  if (!visible) return null;

  const reconnecting = state === 'connecting';
  const palette = tone === 'dark'
    ? { bg: 'rgba(58, 20, 54, 0.94)', border: 'rgba(255, 214, 122, 0.32)', ink: '#FFE7B0' }
    : { bg: '#FFF4D6', border: '#F0D68A', ink: '#7A5B05' };

  return (
    <Animated.View
      style={[styles.wrap, { opacity, backgroundColor: palette.bg, borderColor: palette.border }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <MaterialIcons
        name={reconnecting ? 'sync' : 'cloud-off'}
        size={14}
        color={palette.ink}
      />
      <View style={styles.copy}>
        <Text style={[styles.title, { color: palette.ink }]}>
          {reconnecting ? 'Reconnecting…' : 'Connection lost'}
        </Text>
        <Text style={[styles.sub, { color: palette.ink }]} numberOfLines={1}>
          {reconnecting
            ? 'Catching up with the room.'
            : 'You may not be seeing the room as it is right now.'}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 14,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  copy: { flex: 1, minWidth: 0 },
  title: { fontSize: 12, fontWeight: '900' },
  sub: { fontSize: 10, fontWeight: '600', opacity: 0.85, marginTop: 1 },
});
