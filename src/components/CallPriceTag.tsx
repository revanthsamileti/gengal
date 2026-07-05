import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { subscribeToGlobalSettings, GlobalSettings } from '../services/adminService';

type CallPriceTagProps = {
  mode: 'call' | 'video';
};

export default function CallPriceTag({ mode }: CallPriceTagProps) {
  const [settings, setSettings] = useState<GlobalSettings | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToGlobalSettings((data) => {
      setSettings(data);
    });
    return unsubscribe;
  }, []);

  const isVideo = mode === 'video';
  // Fallbacks based on user request if settings aren't loaded yet
  const defaultPrice = isVideo ? 50 : 15;
  const currentPrice = settings ? (isVideo ? settings.videoCallRatePerMin : settings.voiceCallRatePerMin) : defaultPrice;

  return (
    <View style={styles.tag}>
      <Text style={styles.text}>{currentPrice}</Text>
      <MaterialIcons name="star" size={10} color="#FFD700" />
      <Text style={styles.text}>/m</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginLeft: 4,
    backgroundColor: 'rgba(0,0,0,0.05)',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 8,
  },
  text: {
    fontSize: 9,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  textVideo: {
    color: '#FFE8FF',
  }
});
