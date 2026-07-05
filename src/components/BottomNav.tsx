import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { skeuoGradients } from '../theme/skeuomorphic';

type TabId = 'Home' | 'Club' | 'Personal' | 'Activity' | 'Celebs' | 'Chill';

const TABS: { id: TabId; label: string; icon: keyof typeof MaterialIcons.glyphMap; screen?: string }[] = [
  { id: 'Home', label: 'Home', icon: 'home', screen: 'Home' },
  { id: 'Club', label: 'Club', icon: 'castle', screen: 'Club' },
  { id: 'Chill', label: 'Chill', icon: 'sports-esports', screen: 'Chill' },
  { id: 'Activity', label: 'Activity', icon: 'notifications-none', screen: 'Activity' },
  { id: 'Personal', label: 'Me', icon: 'person-pin', screen: 'Personal' },
];

type BottomNavProps = {
  active: TabId;
  navigate: (screen: string, params?: any) => void;
};

export default function BottomNav({ active, navigate }: BottomNavProps) {
  return (
    <View style={styles.container}>
      <View style={[styles.bar, Platform.OS === 'web' && styles.barWeb]}>
        {TABS.map((tab) => {
          const isActive = tab.id === active;
          return (
            <TouchableOpacity
              key={tab.id}
              style={[styles.tab, isActive && styles.tabActive]}
              activeOpacity={0.75}
              onPress={() => {
                if (tab.screen) {
                  navigate(tab.screen);
                }
              }}
            >
              {isActive ? (
                <LinearGradient colors={[...skeuoGradients.gold]} style={styles.activePlate} />
              ) : null}
              <MaterialIcons
                name={tab.icon}
                size={20}
                color={isActive ? '#9C8223' : '#AAA298'}
              />
              <Text style={[styles.label, isActive && styles.labelActive]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  bar: {
    flexDirection: 'row',
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 24 : 12,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: '#FFFFFF',
    backgroundColor: '#FFFDF8',
  },
  barWeb: {
    boxShadow: Platform.OS === 'web' ? '0 -10px 22px rgba(62, 46, 31, 0.13), inset 0 1px 0 rgba(255,255,255,0.9)' : undefined,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    minHeight: 54,
    borderRadius: 13,
    overflow: 'hidden',
  },
  tabActive: {
    backgroundColor: '#FFE899',
    borderWidth: 1,
    borderColor: '#F8E5A3',
    boxShadow: Platform.OS === 'web' ? '0 8px 16px rgba(156, 130, 35, 0.22), inset 0 1px 0 rgba(255,255,255,0.8)' : undefined,
  },
  activePlate: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    opacity: 0.5,
  },
  label: {
    fontSize: 10,
    fontWeight: '700',
    color: '#AAA298',
  },
  labelActive: {
    color: '#9C8223',
  },
});
