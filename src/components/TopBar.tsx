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

/** Height of the wordmark's line; the header row is centred on it. */
const BRAND_LINE = 40;

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    // The screen is already wrapped in a SafeAreaView (ScreenShell), which
    // reserves the real status-bar/notch inset. A hardcoded 48 here used to
    // stack on top of that inset instead of replacing it, leaving a large
    // dead gap above the header on any phone with a tall status bar.
    paddingTop: 14,
    // Room for the subtitle that hangs below the wordmark (see headerSub).
    paddingBottom: 18,
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
    height: BRAND_LINE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brand: {
    // Loaded in App.tsx's useFonts. No fontWeight: on Android a weight with a
    // custom family makes the system pick its own bold face instead.
    fontFamily: 'DancingScript_700Bold',
    fontSize: 31,
    lineHeight: BRAND_LINE,
    // A script's last stroke leans past the width the font reserves for it,
    // and Android clips text to its content box, so the final "l" ended in a
    // straight cut. Padding does not help (the clip excludes padding); a box
    // wider than the word does, with the word centred inside it.
    alignSelf: 'stretch',
    textAlign: 'center',
    color: '#7A256D',
    includeFontPadding: false,
  },
  headerSub: {
    // Hangs below the wordmark instead of stacking with it. Stacked, the
    // subtitle pushed "Gengal" 17px higher on Club, Celebs and Chill than on
    // the other tabs, so the logo jumped every time you switched tabs.
    position: 'absolute',
    // Clear of the script's descenders: the tail of the "g" reaches the
    // bottom of the line, and at BRAND_LINE - 4 it cut through the subtitle.
    top: BRAND_LINE + 1,
    fontSize: 10,
    fontWeight: '600',
    color: '#C08AA8',
    letterSpacing: 1.2,
    includeFontPadding: false,
  },
});
