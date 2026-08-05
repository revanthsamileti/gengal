import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import GengalAvatar from '../GengalAvatar';
import { RosterPreviewEntry, ROSTER_PREVIEW_SIZE } from '../../services/presenceService';

type Props = {
  roster?: RosterPreviewEntry[];
  /** The true occupancy, used for the "+N" overflow chip. */
  count: number;
  size?: number;
  tone?: 'dark' | 'light';
};

/**
 * Overlapping faces of the people actually in a room, for lobby cards.
 *
 * Reads the `roster` preview the host denormalises onto the room document, so
 * a lobby of twenty rooms still costs twenty document reads rather than twenty
 * roster subscriptions.
 *
 * Renders nothing when there is no preview — rooms created before presence
 * existed have no `roster` field, and an empty row of placeholder circles would
 * imply an empty room rather than an unknown one.
 */
export default function RosterStrip({ roster, count, size = 22, tone = 'dark' }: Props) {
  if (!roster || roster.length === 0) return null;

  const shown = roster.slice(0, ROSTER_PREVIEW_SIZE);
  const overflow = Math.max(0, count - shown.length);
  const ring = tone === 'dark' ? '#2E0138' : '#FFFDF8';
  const chipInk = tone === 'dark' ? '#EADCA8' : '#8A7C70';

  return (
    <View
      style={styles.row}
      accessibilityRole="image"
      accessibilityLabel={
        count === 1 ? '1 person in this room' : `${count} people in this room`
      }
    >
      {shown.map((member, i) => (
        <View
          key={member.uid}
          style={[
            styles.face,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              borderColor: ring,
              marginLeft: i === 0 ? 0 : -size / 3,
              zIndex: shown.length - i,
            },
          ]}
        >
          <GengalAvatar data={member.avatarData} size={size} />
        </View>
      ))}
      {overflow > 0 && (
        <Text style={[styles.overflow, { color: chipInk, marginLeft: 6 }]}>+{overflow}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  face: {
    overflow: 'hidden',
    borderWidth: 1.5,
    backgroundColor: '#F2ECE4',
  },
  overflow: { fontSize: 10, fontWeight: '800' },
});
