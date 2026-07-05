import React from 'react';
import { Platform, Text, StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { skeuoGradients } from '../theme/skeuomorphic';
import { useUser } from '../context/UserContext';

type DiamondBadgeProps = {
  amount?: number | string;
  compact?: boolean;
};

export default function DiamondBadge({ amount, compact }: DiamondBadgeProps) {
  const { profile } = useUser();

  const displayAmount = (profile?.coins !== undefined && profile?.coins !== null) 
    ? profile.coins.toLocaleString() 
    : (amount ?? 0);

  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]}>
      <LinearGradient colors={[...skeuoGradients.raised]} style={styles.inner}>
        <View style={[styles.coinCup, compact && styles.coinCupCompact]}>
          <MaterialIcons name="star" size={compact ? 13 : 16} color="#FFFFFF" />
        </View>
        <Text style={[styles.text, compact && styles.textCompact]}>{displayAmount} Coins</Text>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    minWidth: 118,
    height: 42,
    borderRadius: 21,
    padding: 2,
    backgroundColor: '#F4E6CF',
    borderWidth: 1,
    borderColor: '#FFFFFF',
    boxShadow: Platform.OS === 'web' ? '0 9px 18px rgba(83, 58, 29, 0.18), inset 0 1px 0 rgba(255,255,255,0.95)' : undefined,
  },
  wrapCompact: {
    minWidth: 104,
    height: 38,
    borderRadius: 19,
    paddingHorizontal: 13,
    gap: 4,
  },
  inner: {
    flex: 1,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.72)',
  },
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
  },
  textCompact: {
    fontSize: 13,
  },
});
