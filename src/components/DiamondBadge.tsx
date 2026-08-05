import React from 'react';
import { Platform, Text, StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { skeuoGradients } from '../theme/skeuomorphic';
import { useUser } from '../context/UserContext';

type DiamondBadgeProps = {
  /** Used when there is no signed-in profile to read a balance from. */
  amount?: number | string;
  compact?: boolean;
};

/**
 * Large balances are abbreviated so the badge keeps a fixed width. It sits in a
 * row next to a title, so a badge that grows with the number of digits pushes
 * everything beside it around every time the balance changes.
 */
const formatCoins = (value: number): string => {
  if (!Number.isFinite(value)) return '0';
  const n = Math.max(0, Math.floor(value));
  if (n < 10000) return n.toLocaleString();
  if (n < 1000000) return `${(n / 1000).toFixed(n < 100000 ? 1 : 0)}K`;
  return `${(n / 1000000).toFixed(1)}M`;
};

export default function DiamondBadge({ amount, compact }: DiamondBadgeProps) {
  const { profile } = useUser();

  const raw = profile?.coins ?? (typeof amount === 'number' ? amount : Number(amount ?? 0));
  const displayAmount = formatCoins(raw);

  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]}>
      <LinearGradient
        colors={[...skeuoGradients.raised]}
        style={[styles.inner, compact && styles.innerCompact]}
      >
        <View style={[styles.coinCup, compact && styles.coinCupCompact]}>
          <MaterialIcons name="star" size={compact ? 13 : 16} color="#FFFFFF" />
        </View>
        {/* The word "Coins" used to sit here, but at a fixed pill width any
            balance of 1,000-9,999 overflowed and clipped to "9,980 Co…". The
            star cup already reads as currency and the label below keeps the
            full value for screen readers. */}
        <Text
          style={[styles.text, compact && styles.textCompact]}
          numberOfLines={1}
          accessibilityLabel={`${raw.toLocaleString()} coins`}
        >
          {displayAmount}
        </Text>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    // Fixed rather than minWidth: the pill must not resize as coins change.
    // 112 comfortably fits the longest value formatCoins can produce ("1000K").
    width: 112,
    height: 42,
    borderRadius: 21,
    padding: 2,
    backgroundColor: '#F6E7D2',
    borderWidth: 1,
    borderColor: '#FFFFFF',
    boxShadow: Platform.OS === 'web' ? '0 9px 18px rgba(83, 58, 29, 0.18), inset 0 1px 0 rgba(255,255,255,0.95)' : undefined,
  },
  wrapCompact: {
    width: 94,
    height: 38,
    borderRadius: 19,
  },
  inner: {
    flex: 1,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.72)',
  },
  innerCompact: { borderRadius: 18, paddingHorizontal: 6, gap: 5 },
  coinCup: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#C99B22',
    boxShadow: Platform.OS === 'web' ? 'inset 0 1px 0 rgba(255,255,255,0.65), 0 3px 7px rgba(154,122,5,0.26)' : undefined,
  },
  coinCupCompact: {
    width: 21,
    height: 21,
    borderRadius: 11,
  },
  text: {
    color: '#7F6808',
    fontWeight: '900',
    fontSize: 15,
    // Android adds asymmetric padding inside the text box, which drops the
    // label a couple of pixels below a vertically centred icon.
    includeFontPadding: false,
    textAlignVertical: 'center',
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
  },
  textCompact: {
    fontSize: 13,
  },
});
