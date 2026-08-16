import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { subscribeToGlobalSettings, GlobalSettings } from '../services/adminService';

type CallPriceTagProps = {
  mode: 'call' | 'video';
  textColor?: string;
  /**
   * Drop the pill background and render the rate as plain text.
   *
   * For places where this already sits inside a button — a tinted chip nested
   * in a coloured pill reads as two competing controls, and on the small
   * variants it left the price barely legible.
   */
  bare?: boolean;
};

export default function CallPriceTag({ mode, textColor, bare }: CallPriceTagProps) {
  const [settings, setSettings] = useState<GlobalSettings | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToGlobalSettings((data) => {
      setSettings(data);
    });
    return unsubscribe;
  }, []);

  const isVideo = mode === 'video';
  // Fallbacks based on admin defaults
  const defaultPrice = isVideo ? 30 : 15;
  const currentPrice = settings ? (isVideo ? settings.videoCallRatePerMin : settings.voiceCallRatePerMin) : defaultPrice;

  // Both default to white because every place this renders unlabelled sits on
  // the filled purple call button (Profile, Celebs, Match). The voice variant
  // used to default to a dark gold, which on that background was very nearly
  // invisible -- the rate was on screen but could not actually be read, on the
  // one control where the price is the thing the user needs to see. Anywhere
  // on a light surface passes textColor explicitly.
  const finalColor = textColor || '#FFFFFF';

  return (
    <View style={[styles.tag, !bare && (isVideo ? styles.tagVideo : styles.tagCall), bare && styles.tagBare]}>
      <Text style={[styles.text, { color: finalColor }]}>{currentPrice}</Text>
      <MaterialIcons name="star" size={11} color="#FFD700" style={{ marginHorizontal: 1 }} />
      <Text style={[styles.text, { color: finalColor }]}>/m</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 10,
  },
  tagCall: {
    backgroundColor: 'rgba(218, 165, 32, 0.18)',
  },
  tagVideo: {
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
  },
  tagBare: {
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  text: {
    fontSize: 10.5,
    fontWeight: '800',
  },
});
