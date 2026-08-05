import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import GengalAvatar from './GengalAvatar';
import DiamondBadge from './DiamondBadge';
import { useUser } from '../context/UserContext';

type TopBarProps = {
  navigate: (screen: string, params?: any) => void;
  title?: string;
  subtitle?: string;
};

export default function TopBar({ navigate, title = 'Gengal', subtitle }: TopBarProps) {
  const { profile: myProfile } = useUser();

  return (
    <View style={styles.header}>
      <TouchableOpacity
        style={styles.avatarShadow}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Open your profile"
        onPress={() => navigate('Profile', { profileName: myProfile?.nickname || myProfile?.username || 'User' })}
      >
        {myProfile?.avatarData ? (
          <GengalAvatar data={myProfile.avatarData} size={38} />
        ) : myProfile?.avatarUrl ? (
          <Image source={{ uri: myProfile.avatarUrl }} style={styles.avatar} />
        ) : myProfile ? (
          <View style={[styles.avatar, styles.avatarEmpty]}>
            <MaterialIcons name="person" size={22} color="#C9BDB2" />
          </View>
        ) : (
          <View style={[styles.avatar, { backgroundColor: '#E2E8F0' }]} />
        )}
      </TouchableOpacity>

      <View style={styles.centerTitle}>
        <Text style={styles.brand} numberOfLines={1}>{title}</Text>
        {subtitle ? (
          <Text style={styles.headerSub} numberOfLines={1}>{subtitle}</Text>
        ) : null}
      </View>

      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => navigate('Coins')}
        accessibilityRole="button"
        accessibilityLabel="Coin balance, opens the store"
      >
        <DiamondBadge amount={myProfile?.coins ?? 0} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 48,
    paddingBottom: 14,
    backgroundColor: '#FFFDF8',
    borderBottomWidth: 1,
    borderBottomColor: '#F7E7EE',
    zIndex: 10,
  },
  avatarShadow: {
    shadowColor: '#B45A82',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 6,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    borderColor: '#F3D3E0',
  },
  avatarEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F2ECE4',
  },
  centerTitle: {
    // Takes the space between the avatar and the badge and centres within it.
    // Previously this had no flex, so space-between positioned it by equal gaps
    // and it slid sideways whenever the coin balance changed width.
    flex: 1,
    minWidth: 0,
    marginHorizontal: 10,
    alignItems: 'center',
    flexDirection: 'column',
  },
  brand: {
    // Outfit was referenced here but never loaded (App.tsx registers only the
    // MaterialIcons glyphs), so this silently fell back to the system face with
    // different metrics. Install @expo-google-fonts/outfit and load it in
    // useFonts if the Outfit look is wanted.
    fontSize: 24,
    fontWeight: '800',
    color: '#7A256D',
    letterSpacing: -0.5,
    includeFontPadding: false,
  },
  headerSub: {
    fontSize: 10,
    fontWeight: '600',
    color: '#C08AA8',
    letterSpacing: 1.2,
    marginTop: -2,
    includeFontPadding: false,
  },
});
