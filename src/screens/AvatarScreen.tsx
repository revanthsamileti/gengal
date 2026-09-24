import React, { useState } from 'react';
import { tap38, tap40 } from '../theme/touch';
import { StyleSheet, Text, TouchableOpacity, View, Platform, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import ScreenShell from '../components/ScreenShell';
import { Alert } from '../components/CustomAlert';
import { skeuo, skeuoGradients } from '../theme/skeuomorphic';
import GengalAvatar, { AvatarData, DEFAULT_AVATAR_DNA } from '../components/GengalAvatar';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useUser } from '../context/UserContext';
import { completeSignup, SignupExpiredError } from '../services/signupService';

type AvatarScreenProps = {
  navigate: (screen: string, params?: any) => void;
  goBack: () => void;
  route: any;
};

const TOP_TYPES = ['shortHairShortWaved', 'longHairBun', 'longHairStraight', 'shortHairDreads01', 'shortHairShortCurly'];
const HAIR_COLORS = ['black', 'brownDark', 'blonde', 'red', 'silverGray'];
const CLOTHE_TYPES = ['crewNeck', 'graphicShirt', 'collarSweater', 'blazerShirt', 'hoodie'];
const SKIN_COLORS = ['light', 'tanned', 'brown', 'dark', 'black'];
const BG_COLORS = ['#E2E8F0', '#FDE68A', '#FECACA', '#BFDBFE', '#A7F3D0', '#DDD6FE', '#F3E8FF', '#FFEDD5'];
const ACCESSORIES = ['none', 'designerEyewear', 'goldHoops', 'pearlChoker'];
const TABS = ['Hair', 'Face', 'Clothes', 'Background'];

export default function AvatarScreen({ navigate, goBack, route }: AvatarScreenProps) {
  const { profile } = useUser();
  const [isSaving, setIsSaving] = useState(false);
  const [avatarData, setAvatarData] = useState<AvatarData>(
    route?.params?.isEditMode && profile?.avatarData ? (profile.avatarData as AvatarData) : DEFAULT_AVATAR_DNA
  );
  const [activeTab, setActiveTab] = useState(TABS[0]);

  const randomizeAvatar = () => {
    setAvatarData({
      ...avatarData,
      topType: TOP_TYPES[Math.floor(Math.random() * TOP_TYPES.length)],
      hairColor: HAIR_COLORS[Math.floor(Math.random() * HAIR_COLORS.length)],
      clotheType: CLOTHE_TYPES[Math.floor(Math.random() * CLOTHE_TYPES.length)],
      skinColor: SKIN_COLORS[Math.floor(Math.random() * SKIN_COLORS.length)],
      bgColor: BG_COLORS[Math.floor(Math.random() * BG_COLORS.length)],
      accessoriesType: Math.random() > 0.5 ? 'designerEyewear' : 'none',
    });
  };

  const updateAvatar = (key: keyof AvatarData, value: string) => {
    setAvatarData(prev => ({ ...prev, [key]: value }));
  };

  const handleContinue = async () => {
    if (route?.params?.isEditMode && profile?.uid) {
      try {
        setIsSaving(true);
        const userRef = doc(db, 'users', profile.uid);
        await updateDoc(userRef, { avatarData });
        goBack();
      } catch (e: any) {
        // Silently failing here looked identical to success minus the
        // navigation — the user had no idea their avatar was not saved.
        Alert.alert('Avatar not saved', e?.message || 'Please check your connection and try again.', [{ text: 'OK' }]);
        setIsSaving(false);
      }
    } else {
      // Sign-up normally finishes in FinalizeInvite; this screen is kept for
      // any route that still lands here, and must not point at the removed
      // CreatePassword screen.
      try {
        setIsSaving(true);
        await completeSignup({ ...route?.params, avatar: avatarData });
        navigate('Home');
      } catch (e: any) {
        setIsSaving(false);
        if (e instanceof SignupExpiredError) {
          Alert.alert('Verification expired', e.message, [{ text: 'OK' }]);
          navigate('Phone', { phone: route?.params?.phone });
        } else {
          Alert.alert('Sign-up failed', e?.message || 'Could not create your account. Please try again.', [{ text: 'OK' }]);
        }
      }
    }
  };

  const renderOptions = () => {
    switch (activeTab) {
      case 'Hair':
        return (
          <View style={styles.optionsContainer}>
            <Text style={styles.sectionLabel}>STYLE</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionsScroll}>
              {TOP_TYPES.map(type => (
                <TouchableOpacity hitSlop={tap40} key={type} style={[styles.optionBtn, avatarData.topType === type && styles.activeOptionBtn]} onPress={() => updateAvatar('topType', type)}>
                  <Text style={[styles.optionText, avatarData.topType === type && styles.activeOptionText]}>Style {TOP_TYPES.indexOf(type) + 1}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={[styles.sectionLabel, { marginTop: 16 }]}>COLOR</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionsScroll}>
              {HAIR_COLORS.map(color => (
                <TouchableOpacity hitSlop={tap40} key={color} style={[styles.optionBtn, avatarData.hairColor === color && styles.activeOptionBtn]} onPress={() => updateAvatar('hairColor', color)}>
                  <Text style={[styles.optionText, avatarData.hairColor === color && styles.activeOptionText]}>{color}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        );
      case 'Face':
        return (
          <View style={styles.optionsContainer}>
            <Text style={styles.sectionLabel}>SKIN TONE</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionsScroll}>
              {SKIN_COLORS.map(color => (
                <TouchableOpacity hitSlop={tap40} key={color} style={[styles.optionBtn, avatarData.skinColor === color && styles.activeOptionBtn]} onPress={() => updateAvatar('skinColor', color)}>
                  <Text style={[styles.optionText, avatarData.skinColor === color && styles.activeOptionText]}>{color}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={[styles.sectionLabel, { marginTop: 16 }]}>ACCESSORIES</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionsScroll}>
              {ACCESSORIES.map(acc => (
                <TouchableOpacity hitSlop={tap40} key={acc} style={[styles.optionBtn, avatarData.accessoriesType === acc && styles.activeOptionBtn]} onPress={() => updateAvatar('accessoriesType', acc)}>
                  <Text style={[styles.optionText, avatarData.accessoriesType === acc && styles.activeOptionText]}>{acc}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        );
      case 'Clothes':
        return (
          <View style={styles.optionsContainer}>
            <Text style={styles.sectionLabel}>OUTFIT</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionsScroll}>
              {CLOTHE_TYPES.map(type => (
                <TouchableOpacity hitSlop={tap40} key={type} style={[styles.optionBtn, avatarData.clotheType === type && styles.activeOptionBtn]} onPress={() => updateAvatar('clotheType', type)}>
                  <Text style={[styles.optionText, avatarData.clotheType === type && styles.activeOptionText]}>{type.replace(/([A-Z])/g, ' $1')}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        );
      case 'Background':
        return (
          <View style={styles.optionsContainer}>
            <Text style={styles.sectionLabel}>COLOR</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionsScroll}>
              {BG_COLORS.map(color => (
                <TouchableOpacity
                  key={color}
                  style={[styles.colorOption, avatarData.bgColor === color && styles.activeColorOption, { backgroundColor: color }]}
                  onPress={() => updateAvatar('bgColor', color)}
                  accessibilityRole="radio"
                  accessibilityLabel={`Background colour ${color}`}
                  accessibilityState={{ selected: avatarData.bgColor === color, checked: avatarData.bgColor === color }}
                />
              ))}
            </ScrollView>
          </View>
        );
    }
  };

  return (
    <ScreenShell tone="light">
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Go back">
            <MaterialIcons name="arrow-back" size={24} color="#5A155A" />
          </TouchableOpacity>
          <Text style={styles.brand}>GenGal</Text>
          <View style={{ width: 44 }} />
        </View>

        <View style={styles.titleSection}>
          <Text style={styles.title}>{route?.params?.isEditMode ? 'Edit Avatar' : 'Create Avatar'}</Text>
          <Text style={styles.subtitle}>Customize your 2D avatar</Text>
        </View>

        <View style={styles.avatarWrapper}>
          <GengalAvatar data={avatarData} size={160} />
          <TouchableOpacity style={styles.randomizeBtn} onPress={randomizeAvatar} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel="Randomize avatar">
            <MaterialIcons name="shuffle" size={18} color={skeuo.plum} />
            <Text style={styles.randomizeText}>Randomize</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.customizerArea}>
          <View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsScroll}>
              {TABS.map(tab => (
                <TouchableOpacity
                  key={tab}
                  style={[styles.tabBtn, activeTab === tab && styles.activeTabBtn]}
                  hitSlop={tap38}
                  onPress={() => setActiveTab(tab)}
                  accessibilityRole="tab"
                  accessibilityLabel={tab}
                  accessibilityState={{ selected: activeTab === tab }}
                >
                  <Text style={[styles.tabText, activeTab === tab && styles.activeTabText]}>{tab}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
          {renderOptions()}
        </View>

        <View style={styles.footer}>
          <TouchableOpacity
            onPress={handleContinue}
            activeOpacity={0.8}
            disabled={isSaving}
            accessibilityRole="button"
            accessibilityLabel="Save avatar"
            accessibilityState={{ disabled: isSaving }}
          >
            <View style={styles.continueButtonWrapper}>
              <LinearGradient
                colors={[...skeuoGradients.gold]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.continueButton}
              >
                <Text style={styles.continueText}>{isSaving ? 'Saving...' : (route?.params?.isEditMode ? 'Save Avatar' : 'Looks Good, Continue')}</Text>
                {!isSaving && <MaterialIcons name={route?.params?.isEditMode ? 'check' : 'arrow-forward'} size={18} color="#422006" />}
              </LinearGradient>
            </View>
          </TouchableOpacity>
        </View>
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 40, paddingHorizontal: 20, backgroundColor: skeuo.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  backBtn: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FAF5EE', boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined },
  brand: { color: skeuo.plum, fontFamily: 'serif', fontSize: 24, fontWeight: '900' },
  titleSection: { alignItems: 'center', marginBottom: 20 },
  title: { fontFamily: 'serif', fontSize: 24, fontWeight: '700', color: skeuo.plum, marginBottom: 6 },
  subtitle: { fontSize: 14, color: '#6B7280', textAlign: 'center', paddingHorizontal: 20 },
  avatarWrapper: { alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  randomizeBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FAF5EE', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, marginTop: 15, gap: 6, borderWidth: 1, borderColor: '#E8DED1' },
  randomizeText: { color: skeuo.plum, fontSize: 14, fontWeight: '700' },
  customizerArea: { flex: 1, marginBottom: 20 },
  tabsScroll: { gap: 12, paddingVertical: 10, paddingHorizontal: 5 },
  tabBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 16, backgroundColor: '#F3F4F6', height: 38 },
  activeTabBtn: { backgroundColor: skeuo.plum },
  tabText: { fontSize: 14, fontWeight: '600', color: '#6B7280' },
  activeTabText: { color: '#FFFFFF' },
  optionsContainer: { marginTop: 15, flex: 1 },
  sectionLabel: { fontSize: 11, fontWeight: '800', color: '#9CA3AF', marginBottom: 10, letterSpacing: 1 },
  optionsScroll: { gap: 10, paddingHorizontal: 5, alignItems: 'center', paddingBottom: 10 },
  optionBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB', height: 40, justifyContent: 'center' },
  activeOptionBtn: { borderColor: skeuo.plum, backgroundColor: '#FDF2F8' },
  optionText: { fontSize: 14, color: '#374151', fontWeight: '500', textTransform: 'capitalize' },
  activeOptionText: { color: skeuo.plum, fontWeight: '700' },
  colorOption: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: 'transparent' },
  activeColorOption: { borderColor: skeuo.plum },
  footer: { marginBottom: 30 },
  continueButtonWrapper: { borderRadius: 16, backgroundColor: '#D0A92E', boxShadow: Platform.OS === 'web' ? skeuo.deepShadow : undefined, elevation: 8, shadowColor: '#533A1D', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.25, shadowRadius: 16 },
  continueButton: { flexDirection: 'row', height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', gap: 10, overflow: 'hidden' },
  continueText: { color: '#422006', fontSize: 16, fontWeight: '700' },
});
