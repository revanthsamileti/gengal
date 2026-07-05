import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Platform,
  ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import ScreenShell from '../components/ScreenShell';
import { skeuo, skeuoGradients } from '../theme/skeuomorphic';
import GengalAvatar, { AvatarData, DEFAULT_AVATAR_DNA } from '../components/GengalAvatar';

type AvatarScreenProps = {
  navigate: (screen: string, params?: any) => void;
  goBack: () => void;
  route: any;
};

const RANDOM_COLORS = ['#E2E8F0', '#FDE68A', '#FECACA', '#BFDBFE', '#A7F3D0', '#DDD6FE'];
const TOP_TYPES = ['shortHairShortWaved', 'longHairBun', 'longHairStraight', 'shortHairDreads01', 'shortHairShortCurly'];
const HAIR_COLORS = ['black', 'brownDark', 'blonde', 'red', 'silverGray'];
const CLOTHE_TYPES = ['crewNeck', 'graphicShirt', 'collarSweater', 'blazerShirt', 'hoodie'];

export default function AvatarScreen({ navigate, goBack, route }: AvatarScreenProps) {
  const [avatarData, setAvatarData] = useState<AvatarData>(DEFAULT_AVATAR_DNA);

  const randomizeAvatar = () => {
    setAvatarData({
      ...DEFAULT_AVATAR_DNA,
      topType: TOP_TYPES[Math.floor(Math.random() * TOP_TYPES.length)],
      hairColor: HAIR_COLORS[Math.floor(Math.random() * HAIR_COLORS.length)],
      clotheType: CLOTHE_TYPES[Math.floor(Math.random() * CLOTHE_TYPES.length)],
      bgColor: RANDOM_COLORS[Math.floor(Math.random() * RANDOM_COLORS.length)],
    });
  };

  const handleContinue = () => {
    // Pass everything collected so far to CreatePasswordScreen
    navigate('CreatePassword', {
      ...route?.params,
      avatar: avatarData
    });
  };

  return (
    <ScreenShell tone="light">
      <ScrollView 
        contentContainerStyle={[styles.container, { flexGrow: 1 }]} 
        bounces={false} 
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack} style={styles.backBtn}>
            <MaterialIcons name="arrow-back" size={24} color="#5A155A" />
          </TouchableOpacity>
          <Text style={styles.brand}>Gengal</Text>
          <View style={{ width: 44 }} />
        </View>

        <View style={styles.titleSection}>
          <Text style={styles.title}>Choose Your Avatar</Text>
          <Text style={styles.subtitle}>
            This is how others will see you in the lounge.
          </Text>
        </View>

        <View style={styles.avatarWrapper}>
          <GengalAvatar data={avatarData} size={200} />
          
          <TouchableOpacity style={styles.randomizeBtn} onPress={randomizeAvatar} activeOpacity={0.8}>
            <MaterialIcons name="shuffle" size={20} color="#FFF" />
            <Text style={styles.randomizeText}>Randomize</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <TouchableOpacity onPress={handleContinue} activeOpacity={0.8}>
            <View style={styles.continueButtonWrapper}>
              <LinearGradient
                colors={[...skeuoGradients.gold]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.continueButton}
              >
                <Text style={styles.continueText}>Looks Good, Continue</Text>
                <MaterialIcons name="arrow-forward" size={18} color="#422006" />
              </LinearGradient>
            </View>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 40,
    paddingHorizontal: 30,
    backgroundColor: skeuo.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FAF5EE',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  brand: {
    color: skeuo.plum,
    fontFamily: 'serif',
    fontSize: 28,
    fontWeight: '900',
  },
  titleSection: {
    alignItems: 'center',
    marginBottom: 40,
  },
  title: {
    fontFamily: 'serif',
    fontSize: 24,
    fontWeight: '700',
    color: skeuo.plum,
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 20,
  },
  avatarWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 40,
  },
  randomizeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: skeuo.plum,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    marginTop: 30,
    gap: 8,
    boxShadow: Platform.OS === 'web' ? skeuo.deepShadow : undefined,
    elevation: 4,
  },
  randomizeText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  footer: {
    marginTop: 'auto',
    marginBottom: 20,
  },
  continueButtonWrapper: {
    borderRadius: 16,
    backgroundColor: '#D0A92E',
    boxShadow: Platform.OS === 'web' ? skeuo.deepShadow : undefined,
    elevation: 8,
    shadowColor: '#533A1D',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
  },
  continueButton: {
    flexDirection: 'row',
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    overflow: 'hidden',
  },
  continueText: {
    color: '#422006',
    fontSize: 15,
    fontWeight: '700',
  },
});
