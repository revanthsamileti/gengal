import React, { useState } from 'react';
import { Platform, Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View, } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import ScreenShell from '../components/ScreenShell';
import { useUser } from '../context/UserContext';
import GengalAvatar from '../components/GengalAvatar';
import { skeuo } from '../theme/skeuomorphic';

type LanguageScreenProps = {
  navigate: (screen: string, params?: any) => void;
  route?: any;
};

const LANGUAGES = [
  { id: 'en', name: 'English', sub: 'English' },
  { id: 'es', name: 'Espanol', sub: 'Spanish' },
  { id: 'hi', name: 'Hindi', sub: 'Hindi' },
  { id: 'fr', name: 'Francais', sub: 'French' },
  { id: 'it', name: 'Italiano', sub: 'Italian' },
  { id: 'de', name: 'Deutsch', sub: 'German' },
];

export default function LanguageScreen({ navigate, route }: LanguageScreenProps) {
  const { profile: myProfile } = useUser();
  const [selectedLang, setSelectedLang] = useState('en');
  
  const isEditMode = route?.params?.isEditMode || false;
  const returnTo = route?.params?.returnTo || 'Settings';

  return (
    <ScreenShell tone="light">
      <View style={styles.phone}>
        {/* Header */}
        <View style={styles.header}>
          {isEditMode ? (
            <TouchableOpacity
              style={styles.backButton}
              activeOpacity={0.78}
              onPress={() => navigate(returnTo)}
            >
              <MaterialIcons name="arrow-back" size={22} color="#5A075F" />
            </TouchableOpacity>
          ) : (
            <View style={{ width: 44, height: 44 }} />
          )}
          <View style={styles.centerTitle}>
            <Text style={styles.brand}>Gengal</Text>
          </View>
          {isEditMode ? (
            <TouchableOpacity
              style={styles.avatarShadow}
              activeOpacity={0.85}
              onPress={() => navigate('Profile')}
            >
              {myProfile?.avatarData ? (
                <GengalAvatar data={myProfile.avatarData as any} size={36} />
              ) : (
                <Image
                  source={{ uri: myProfile?.avatarUrl || 'https://via.placeholder.com/36' }}
                  style={styles.avatar}
                />
              )}
            </TouchableOpacity>
          ) : (
            <View style={{ width: 44, height: 44 }} />
          )}
        </View>

        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.titleSection}>
            <Text style={styles.pageTitle}>Select Language</Text>
            <Text style={styles.pageSubtitle}>
              Choose your preferred tongue for a bespoke experience.
            </Text>
          </View>

          <View style={styles.langList}>
            {LANGUAGES.map((lang) => {
              const isSelected = selectedLang === lang.id;
              return (
                <TouchableOpacity
                  key={lang.id}
                  activeOpacity={0.8}
                  style={[
                    styles.langCard,
                    isSelected && styles.langCardSelected,
                  ]}
                  onPress={() => setSelectedLang(lang.id)}
                >
                  <View>
                    <Text style={[styles.langName, isSelected && styles.langNameSelected]}>
                      {lang.name}
                    </Text>
                    <Text style={styles.langSub}>{lang.sub}</Text>
                  </View>
                  {isSelected && (
                    <MaterialIcons name="check-circle" size={20} color="#9D8216" />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity activeOpacity={0.85} onPress={() => {
            if (isEditMode) {
              navigate(returnTo);
            } else {
              navigate('Phone');
            }
          }}>
            <LinearGradient
              colors={['#FDE68A', '#EAB308', '#CA8A04']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.saveButton}
            >
              <Text style={styles.saveButtonText}>SAVE PREFERENCES</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  phone: {
    flex: 1,
    backgroundColor: '#FFFDF8',
  },
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
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: '#FFFDF8',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  centerTitle: {
    flex: 1,
    alignItems: 'center',
  },
  brand: {
    color: '#321151',
    fontFamily: 'serif',
    fontSize: 26,
    fontWeight: '900',
  },
  avatarShadow: {
    borderRadius: 18,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#FFFDF8',
  },
  scroll: {
    paddingHorizontal: 26,
    paddingTop: 30,
    paddingBottom: 100, // Make room for footer
  },
  titleSection: {
    alignItems: 'center',
    marginBottom: 40,
  },
  pageTitle: {
    color: '#0D2040',
    fontFamily: 'serif',
    fontSize: 32,
    fontWeight: '800',
    marginBottom: 10,
    textShadowColor: 'rgba(234, 179, 8, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  pageSubtitle: {
    color: '#64748B',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 10,
  },
  langList: {
    gap: 16,
  },
  langCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFDF8',
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: '#F1F1F1',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  langCardSelected: {
    borderColor: '#EAB308',
    backgroundColor: '#FFFDF0',
  },
  langName: {
    fontFamily: 'serif',
    fontSize: 20,
    fontWeight: '700',
    color: '#0D2040',
    marginBottom: 4,
  },
  langNameSelected: {
    color: '#321151',
  },
  langSub: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '500',
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 26,
    backgroundColor: 'rgba(255, 253, 248, 0.9)',
  },
  saveButton: {
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: Platform.OS === 'web' ? skeuo.deepShadow : undefined,
  },
  saveButtonText: {
    color: '#422006',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
});
