import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

/**
 * The GenGal lockup: the heart from the logo beside the name in the app's
 * script face.
 *
 * Lifted out of TopBar because the sign-in screens were drawing the name as
 * `fontFamily: 'serif'` at weight 900 — a generic system serif, not the brand.
 * The first two screens a new person ever sees were the only place the
 * wordmark was not used, so the app introduced itself in the wrong typeface
 * and then switched once they were signed in.
 *
 * Everything scales from `size` (the cap height of the script), including the
 * geometry that stops Android clipping the final stroke, so a larger wordmark
 * stays intact.
 */

/** DancingScript's ascenders and descenders need more room than its point size. */
const LINE_RATIO = 1.29;
/** The mark reads as a square-ish heart beside the word at this proportion. */
const MARK_RATIO = 0.97;
const GAP_RATIO = 0.26;
/**
 * A script's last stroke leans past the width the font reserves for it, and
 * Android clips text to its content box — so the final "l" ended in a straight
 * cut. Padding does not help, because the clip excludes padding; only a box
 * wider than the word gives the stroke somewhere to go.
 */
const BOX_RATIO = 3.6;

type Props = {
  /** Cap height of the script, in points. */
  size?: number;
  color?: string;
  /** Overridable so a future white-on-dark placement does not need a fork. */
  name?: string;
};

export default function Wordmark({ size = 31, color = '#7A256D', name = 'GenGal' }: Props) {
  const line = Math.round(size * LINE_RATIO);
  return (
    <View style={[styles.lockup, { gap: Math.round(size * GAP_RATIO) }]}>
      <Image
        source={require('../../assets/logo-mark.png')}
        style={{ width: Math.round(size * MARK_RATIO), height: line }}
        resizeMode="contain"
        // The name is right beside it; announcing the mark separately
        // would read the brand twice.
        accessible={false}
      />
      <Text
        style={[
          styles.brand,
          {
            fontSize: size,
            lineHeight: line,
            minWidth: Math.round(size * BOX_RATIO),
            color,
          },
        ]}
        numberOfLines={1}
      >
        {name}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  lockup: { flexDirection: 'row', alignItems: 'center' },
  brand: {
    // Loaded in App.tsx's useFonts. No fontWeight: on Android a weight with a
    // custom family makes the system pick its own bold face instead.
    fontFamily: 'DancingScript_700Bold',
    textAlign: 'center',
    includeFontPadding: false,
  },
});
