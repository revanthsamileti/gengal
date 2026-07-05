import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
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
        onPress={() => navigate('Profile', { profileName: myProfile?.nickname || myProfile?.username || 'User' })}
      >
        {myProfile?.avatarData ? (
          <GengalAvatar data={myProfile.avatarData} size={38} />
        ) : myProfile ? (
          <Image
            source={{ uri: myProfile.avatarUrl || 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?q=80&w=200&auto=format&fit=crop' }}
            style={styles.avatar}
          />
        ) : (
          <View style={[styles.avatar, { backgroundColor: '#E2E8F0' }]} />
        )}
      </TouchableOpacity>

      <View style={styles.centerTitle}>
        <Text style={styles.brand} numberOfLines={1} adjustsFontSizeToFit>{title}</Text>
        {subtitle ? (
          <Text style={styles.headerSub}>{subtitle}</Text>
        ) : null}
      </View>

      <TouchableOpacity activeOpacity={0.85} onPress={() => navigate('Coins')}>
        <DiamondBadge amount={myProfile ? (myProfile.coins ?? 0) : 0} />
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
    paddingTop: 60,
    paddingBottom: 15,
    backgroundColor: '#FFFDF8',
    borderBottomWidth: 1,
    borderBottomColor: '#F5E6E6',
    zIndex: 10,
  },
  avatarShadow: {
    shadowColor: '#C4A000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 6,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    borderColor: '#FBE9B6',
  },
  centerTitle: {
    alignItems: 'center',
    flexDirection: 'column',
  },
  brand: {
    fontFamily: 'Outfit_700Bold',
    fontSize: 24,
    color: '#836A07',
    letterSpacing: -0.5,
  },
  headerSub: {
    fontFamily: 'Outfit_600SemiBold',
    fontSize: 10,
    color: '#D4B84D',
    letterSpacing: 1.2,
    marginTop: -2,
  },
});
