import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { subscribeToGlobalSettings, GlobalSettings } from '../services/adminService';

type CallPriceTagProps = {
  mode: 'call' | 'video';
  textColor?: string;
};

export default function CallPriceTag({ mode, textColor }: CallPriceTagProps) {
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

  const defaultColor = isVideo ? '#FFFFFF' : '#7A580D';
  const finalColor = textColor || defaultColor;

  return (
    <View style={[styles.tag, isVideo ? styles.tagVideo : styles.tagCall]}>
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
  text: {
    fontSize: 10.5,
    fontWeight: '800',
  },
});
