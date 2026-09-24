import { Alert } from '../components/CustomAlert';
import React, { useEffect, useRef, useState } from 'react';
import { Platform, ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Modal,
  Pressable
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import DiamondBadge from '../components/DiamondBadge';
import { DEFAULT_AVATAR_DNA } from '../components/GengalAvatar';
import { auth } from '../config/firebase';
import { checkUsernameAvailable } from '../services/authService';
import { getUserProfile, saveUserProfile } from '../services/userService';
import { skeuo, skeuoGradients } from '../theme/skeuomorphic';
import { tap42 } from '../theme/touch';

const COUNTRY_LANGUAGE_MAP: Record<string, string[]> = {
  'United States': ['English', 'Spanish'],
  'India': ['Hindi', 'English', 'Bengali', 'Telugu', 'Marathi', 'Tamil', 'Urdu', 'Gujarati', 'Kannada', 'Odia', 'Malayalam'],
  'United Kingdom': ['English', 'Welsh', 'Scottish Gaelic'],
  'Canada': ['English', 'French'],
  'Australia': ['English'],
  'Germany': ['German', 'English'],
  'France': ['French', 'English'],
  'Japan': ['Japanese', 'English'],
  'Brazil': ['Portuguese', 'Spanish', 'English'],
  'Mexico': ['Spanish', 'English'],
  'South Africa': ['Zulu', 'Xhosa', 'Afrikaans', 'English'],
  'China': ['Mandarin', 'Cantonese', 'English'],
};
const COUNTRIES = Object.keys(COUNTRY_LANGUAGE_MAP).sort();

type ProfileDetailsScreenProps = {
  navigate: (screen: string, params?: any) => void;
  goBack?: () => void;
  route: any;
};

/**
 * Working out roughly where somebody is, from their IP.
 *
 * Three services are asked because any one of them can be down, rate-limited
 * or wrong. They used to be asked *in turn*, and none of the three had a
 * timeout -- so on a weak connection the first request could hang for as long
 * as the platform allowed, then the second, then the third, while the profile
 * screen sat on its spinner during signup with no way past it.
 *
 * Now all three are asked at once and the first usable answer wins, so the
 * wait is the fastest service rather than the sum of the slowest, and it is
 * bounded either way.
 */
const GEO_TIMEOUT_MS = 5000;

type GeoAnswer = { region: string; country: string; city: string };

const GEO_PROVIDERS: { url: string; read: (data: any) => GeoAnswer | null }[] = [
  {
    url: 'https://ipwhois.app/json/',
    read: (d) =>
      d?.success !== false && d?.region
        ? { region: d.region, country: d.country || '', city: d.city || '' }
        : null,
  },
  {
    url: 'https://ipapi.co/json/',
    read: (d) =>
      d?.region ? { region: d.region, country: d.country_name || '', city: d.city || '' } : null,
  },
  {
    // Answers 307 to its own https host; fetch follows that, curl without -L
    // does not, which is why this one looks broken when tested by hand.
    url: 'https://freeipapi.com/api/json/',
    read: (d) =>
      d?.regionName
        ? { region: d.regionName, country: d.countryName || '', city: d.cityName || '' }
        : null,
  },
];

const askGeoProvider = async (provider: (typeof GEO_PROVIDERS)[number]): Promise<GeoAnswer | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEO_TIMEOUT_MS);
  try {
    const res = await fetch(provider.url, { signal: controller.signal });
    if (!res.ok) return null;
    return provider.read(await res.json());
  } catch {
    // Timed out, offline, or HTML where JSON was expected. A provider that
    // fails must not stop the others answering.
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/** The first provider with a usable answer; null once all three have failed. */
const firstGeoAnswer = (): Promise<GeoAnswer | null> =>
  new Promise((resolve) => {
    let settled = false;
    let outstanding = GEO_PROVIDERS.length;
    GEO_PROVIDERS.forEach((provider) => {
      askGeoProvider(provider).then((answer) => {
        if (settled) return;
        if (answer) {
          settled = true;
          resolve(answer);
        } else if (--outstanding === 0) {
          settled = true;
          resolve(null);
        }
      });
    });
  });

export default function ProfileDetailsScreen({ navigate, route }: ProfileDetailsScreenProps) {
  const isEditMode = route?.params?.isEditMode || false;
  const returnTo = route?.params?.returnTo || 'Settings';
  const [nickname, setNickname] = useState(route?.params?.nickname || '');
  const [username, setUsername] = useState(route?.params?.name || '');
  const [age, setAge] = useState(route?.params?.dob ? String(route.params.dob) : '');
  const [gender, setGender] = useState<'Masculine' | 'Feminine' | ''>(route?.params?.gender || '');
  const [country, setCountry] = useState(route?.params?.country || '');
  const [stateText, setStateText] = useState(route?.params?.state || '');
  const [city, setCity] = useState(route?.params?.city || '');
  const [language, setLanguage] = useState(route?.params?.language || '');
  const [bio, setBio] = useState(route?.params?.bio || '');
  const [isLoading, setIsLoading] = useState(false);
  const [usernameError, setUsernameError] = useState(false);
  // Return advances through the form instead of dismissing the keyboard.
  const usernameRef = useRef<TextInput>(null);
  const ageRef = useRef<TextInput>(null);
  const [ageError, setAgeError] = useState(false);
  
  const [isCountryModalVisible, setIsCountryModalVisible] = useState(false);
  const [isLanguageModalVisible, setIsLanguageModalVisible] = useState(false);
  const [isDetectingState, setIsDetectingState] = useState(false);
  const [autoDetectedState, setAutoDetectedState] = useState(false);

  const detectStateAutomatically = async (isUserInitiated = false) => {
    if (!isUserInitiated && (stateText || route?.params?.state || isEditMode)) return;
    setIsDetectingState(true);
    try {
      const found = await firstGeoAnswer();
      const detectedRegion = found?.region ?? '';
      const detectedCountry = found?.country ?? '';
      const detectedCity = found?.city ?? '';

      if (detectedRegion) {
        setStateText(detectedRegion);
        setAutoDetectedState(true);
      }
      if (!city && detectedCity) {
        setCity(detectedCity);
      }
      if (!country && detectedCountry) {
        setCountry(detectedCountry);
      }
      if (isUserInitiated && !detectedRegion) {
        Alert.alert('Detection Notice', 'Could not detect location automatically. Please enter your state manually.');
      }
    } catch (e) {
      if (isUserInitiated) {
        Alert.alert('Detection Failed', 'Unable to automatically detect location. Please check your network.');
      }
    } finally {
      setIsDetectingState(false);
    }
  };

  useEffect(() => {
    // Auto-detect state name automatically during registration when screen mounts
    if (!isEditMode && !stateText && !route?.params?.state) {
      detectStateAutomatically(false);
    }
  }, []);

  const handleUsernameChange = (val: string) => {
    setUsername(val);
    const usernameRegex = /^[a-z0-9_]*$/;
    if (!usernameRegex.test(val)) {
      setUsernameError(true);
    } else {
      setUsernameError(false);
    }
  };

  const handleAgeChange = (val: string) => {
    setAge(val);
    if (val && parseInt(val, 10) < 18) {
      setAgeError(true);
    } else {
      setAgeError(false);
    }
  };
  const avatarData = route?.params?.avatarData || { ...DEFAULT_AVATAR_DNA, isPremiumConfig: true };

  useEffect(() => {
    const fetchProfile = async () => {
      if (!auth.currentUser) return;
      try {
        const profile = await getUserProfile(auth.currentUser.uid);
        if (!profile) return;
        // Only override if we don't already have draft values from params
        if (profile.nickname && !route?.params?.nickname) setNickname(profile.nickname);
        if (profile.username && !route?.params?.name) setUsername(profile.username);
        if (profile.age && !route?.params?.dob) setAge(profile.age.toString());
        if (profile.gender && !route?.params?.gender) setGender(profile.gender as any);
        if (profile.country && !route?.params?.country) setCountry(profile.country);
        if (profile.state && !route?.params?.state) setStateText(profile.state);
        if (profile.city && !route?.params?.city) setCity(profile.city);
        if (profile.language && !route?.params?.language) setLanguage(profile.language);
        if (profile.bio && !route?.params?.bio) setBio(profile.bio);
      } catch (e) {
        console.warn('Could not fetch existing profile', e);
      }
    };
    fetchProfile();
  }, [route?.params]);

  const handleBack = () => {
    if (isEditMode) {
      navigate(returnTo);
    } else {
      navigate('Phone', { step: 'phone', reset: true });
    }
  };

  const handleComplete = async () => {
    if (!nickname || !username || !age || !gender || !country || !language) {
      Alert.alert('Missing Fields', 'Please fill in all mandatory fields (Nickname, Username, Age, Gender, Country, Language).');
      return;
    }

    const usernameRegex = /^[a-z0-9_]+$/;
    if (!usernameRegex.test(username) || usernameError) {
      Alert.alert('Invalid Username', 'Username can only contain lowercase letters, numbers, and underscores.');
      return;
    }

    if (parseInt(age, 10) < 18 || ageError) {
      Alert.alert('Invalid Age', 'You must be 18 or older to join.');
      return;
    }

    setIsLoading(true);
    try {
      const cleanUsername = username.trim().toLowerCase();
      // Goes through the backend (Admin SDK) rather than a client Firestore
      // query: during signup this runs before signInWithCustomToken, so there
      // is no Firebase Auth session yet and the users/{uid} read rule would
      // reject a direct client query outright.
      const isUnique = await checkUsernameAvailable(cleanUsername, auth.currentUser?.uid);

      if (!isUnique) {
        Alert.alert('Username Taken', 'This username is already in use. Please choose another one.');
        setIsLoading(false);
        return;
      }

      if (isEditMode) {
        if (auth.currentUser) {
          await saveUserProfile(auth.currentUser.uid, {
            nickname: nickname.trim(),
            username: cleanUsername,
            age: parseInt(age, 10) || age,
            gender,
            country,
            state: stateText,
            city,
            language,
            bio: bio.trim()
          });
          Alert.alert('Success', 'Profile updated successfully!');
          navigate(returnTo);
        }
      } else {
        // The full builder, same one Settings and Profile open for editing.
        // Signup used to route to the older 'Avatar' screen, which exposes five
        // hair styles and no facial hair, eyes, eyebrows or clothing colour --
        // so a new account got a visibly poorer editor than the one it would
        // see the moment it went to change its avatar afterwards.
        navigate('FinalizeInvite', {
          phone: route?.params?.phone,
          token: route?.params?.token,
          name: cleanUsername,
          nickname: nickname.trim(),
          dob: parseInt(age, 10) || age,
          gender,
          country,
          state: stateText,
          city,
          language,
          bio: bio.trim(),
          avatar: avatarData
        });
      }

    } catch (error) {
      console.error('Failed to verify username:', error);
      Alert.alert('Error', 'Could not verify username. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.stageHeader}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton} hitSlop={tap42}
          accessibilityRole="button"
          accessibilityLabel="Go back">
          <MaterialIcons name="arrow-back" size={23} color={skeuo.plum} />
        </TouchableOpacity>
        <Text style={styles.brand}>GenGal</Text>
        <DiamondBadge compact />
      </View>

      <View style={styles.contentArea}>
        {/* Long form: the lower fields (State, City, Gender) and the Save
            button were sitting under the keyboard on smaller devices. */}
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
        <ScrollView contentContainerStyle={styles.infoContainer} keyboardShouldPersistTaps="handled">
          <Text style={styles.infoTitle}>Profile Details</Text>

          <View style={styles.formGroup}>
            <Text style={styles.label}>NICKNAME</Text>
            <TextInput
              style={styles.input}
              value={nickname}
              onChangeText={setNickname}
              returnKeyType="next"
              onSubmitEditing={() => usernameRef.current?.focus()}
              accessibilityLabel="Nickname"
            />
            <Text style={styles.hintText}>Your public display name</Text>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>BIO (Optional)</Text>
            <TextInput style={[styles.input, { height: 80, paddingTop: 14 }]} value={bio} onChangeText={setBio} multiline numberOfLines={3} placeholder="Tell us about yourself..." placeholderTextColor="#A0A0A0" />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>USERNAME</Text>
            <TextInput
              ref={usernameRef}
              style={[styles.input, usernameError && styles.inputError]}
              value={username}
              onChangeText={handleUsernameChange}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
              onSubmitEditing={() => ageRef.current?.focus()}
              accessibilityLabel="Username"
            />
            <Text style={[styles.hintText, usernameError && styles.hintError]}>Only lowercase letters, numbers, and underscores</Text>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>AGE</Text>
            <TextInput
              ref={ageRef}
              style={[styles.input, ageError && styles.inputError]}
              value={age}
              onChangeText={handleAgeChange}
              keyboardType="number-pad"
              maxLength={3}
              returnKeyType="done"
              accessibilityLabel="Age"
            />
            <Text style={[styles.hintText, ageError && styles.hintError]}>Must be 18 or older to join</Text>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>COUNTRY (Required)</Text>
            <TouchableOpacity 
              style={[styles.input, { justifyContent: 'center' }]} 
              activeOpacity={0.8}
              onPress={() => setIsCountryModalVisible(true)}
            >
              <Text style={{ color: country ? skeuo.plum : '#A0A0A0', fontSize: 16, fontWeight: '700' }}>
                {country || 'Select a country...'}
              </Text>
              <MaterialIcons name="arrow-drop-down" size={24} color={skeuo.plum} style={{ position: 'absolute', right: 12 }} />
            </TouchableOpacity>
          </View>

          {country ? (
            <View style={styles.formGroup}>
              <Text style={styles.label}>LANGUAGE (Required)</Text>
              <TouchableOpacity 
                style={[styles.input, { justifyContent: 'center' }]} 
                activeOpacity={0.8}
                onPress={() => setIsLanguageModalVisible(true)}
              >
                <Text style={{ color: language ? skeuo.plum : '#A0A0A0', fontSize: 16, fontWeight: '700' }}>
                  {language || 'Select your primary language...'}
                </Text>
                <MaterialIcons name="arrow-drop-down" size={24} color={skeuo.plum} style={{ position: 'absolute', right: 12 }} />
              </TouchableOpacity>
            </View>
          ) : null}

          <View style={styles.formGroup}>
            <View style={styles.labelRow}>
              <Text style={[styles.label, { marginBottom: 0 }]}>STATE / REGION</Text>
              <TouchableOpacity
                onPress={() => detectStateAutomatically(true)}
                disabled={isDetectingState}
                style={styles.autoDetectBtn}
                activeOpacity={0.8}
              >
                {isDetectingState ? (
                  <ActivityIndicator size="small" color={skeuo.plum} style={{ marginRight: 5 }} />
                ) : (
                  <MaterialIcons name="my-location" size={13} color={skeuo.plum} style={{ marginRight: 5 }} />
                )}
                <Text style={styles.autoDetectText}>
                  {isDetectingState ? 'Detecting...' : autoDetectedState ? '✨ Auto-Detected' : 'Auto Detect'}
                </Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={[styles.input, { marginTop: 8 }]}
              value={stateText}
              onChangeText={(val) => {
                setStateText(val);
                setAutoDetectedState(false);
              }}
              placeholder="e.g. Maharashtra (Auto-detecting...)"
              placeholderTextColor="#A0A0A0"
            />
            {autoDetectedState && (
              <Text style={styles.autoDetectSuccess}>
                ✓ State automatically detected during registration
              </Text>
            )}
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>CITY (Optional)</Text>
            <TextInput
              style={styles.input}
              value={city}
              onChangeText={setCity}
              placeholder="e.g. Los Angeles"
              placeholderTextColor="#A0A0A0"
              returnKeyType="done"
              accessibilityLabel="City"
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>IDENTITY</Text>
            <View style={styles.genderToggleFrame}>
              <TouchableOpacity hitSlop={tap42} style={[styles.toggleBtn, gender === 'Masculine' && styles.activeMasculine]} onPress={() => setGender('Masculine')}>
                <Text style={[styles.toggleBtnText, gender === 'Masculine' && styles.textActive]}>MASCULINE</Text>
              </TouchableOpacity>
              <TouchableOpacity hitSlop={tap42} style={[styles.toggleBtn, gender === 'Feminine' && styles.activeFeminine]} onPress={() => setGender('Feminine')}>
                <Text style={[styles.toggleBtnText, gender === 'Feminine' && styles.textActive]}>FEMININE</Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity style={styles.saveActionBtn} onPress={handleComplete} disabled={isLoading} activeOpacity={0.86}>
            <LinearGradient colors={[...skeuoGradients.gold]} style={styles.saveGradient}>
              {isLoading ? <ActivityIndicator color="#4A3600" /> : <Text style={styles.saveActionText}>SAVE PROFILE</Text>}
            </LinearGradient>
          </TouchableOpacity>
        </ScrollView>
        </KeyboardAvoidingView>
      </View>

      <Modal visible={isCountryModalVisible} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setIsCountryModalVisible(false)}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Select Country</Text>
            <ScrollView>
              {COUNTRIES.map((c) => (
                <TouchableOpacity 
                  key={c} 
                  style={[styles.modalItem, country === c && styles.modalItemActive]}
                  onPress={() => {
                    setCountry(c);
                    setLanguage('');
                    setIsCountryModalVisible(false);
                  }}
                >
                  <Text style={[styles.modalItemText, country === c && styles.modalItemTextActive]}>{c}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={isLanguageModalVisible} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setIsLanguageModalVisible(false)}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Select Language</Text>
            <ScrollView>
              {country && COUNTRY_LANGUAGE_MAP[country]?.map((l) => (
                <TouchableOpacity 
                  key={l} 
                  style={[styles.modalItem, language === l && styles.modalItemActive]}
                  onPress={() => {
                    setLanguage(l);
                    setIsLanguageModalVisible(false);
                  }}
                >
                  <Text style={[styles.modalItemText, language === l && styles.modalItemTextActive]}>{l}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: skeuo.surface },
  stageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 14,
    backgroundColor: skeuo.surfaceRaised,
    borderBottomWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? '0 8px 18px rgba(83, 58, 29, 0.10)' : undefined,
  },
  brand: { color: skeuo.plum, fontFamily: 'serif', fontSize: 28, fontWeight: '900' },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: skeuo.surfaceRaised,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  contentArea: { flex: 1 },
  infoContainer: { paddingHorizontal: 24, paddingTop: 28, paddingBottom: 112 },
  infoTitle: { color: skeuo.plum, fontFamily: 'serif', fontSize: 30, fontWeight: '900', marginBottom: 22 },
  formGroup: { marginBottom: 18 },
  label: { fontSize: 11, fontWeight: '900', color: '#9A8772', marginBottom: 8, letterSpacing: 1.1 },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  autoDetectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7EEFA',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2C8E6',
  },
  autoDetectText: {
    fontSize: 11,
    fontWeight: '800',
    color: skeuo.plum,
  },
  autoDetectSuccess: {
    fontSize: 12,
    fontWeight: '700',
    color: '#3E7B27',
    marginTop: 6,
    marginLeft: 4,
  },
  input: {
    backgroundColor: skeuo.surfaceInset,
    borderRadius: 18,
    height: 54,
    paddingHorizontal: 17,
    color: skeuo.plum,
    fontSize: 16,
    fontWeight: '700',
    borderWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? skeuo.insetShadow : undefined,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxHeight: '70%',
    backgroundColor: skeuo.surfaceInset,
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
    elevation: 10,
    shadowColor: '#533A1D',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: skeuo.plum,
    marginBottom: 16,
    textAlign: 'center',
  },
  modalItem: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(217, 197, 139, 0.3)',
  },
  modalItemActive: {
    backgroundColor: 'rgba(212, 154, 11, 0.15)',
    borderRadius: 12,
    borderBottomWidth: 0,
  },
  modalItemText: {
    fontSize: 16,
    color: skeuo.plum,
    fontWeight: '600',
  },
  modalItemTextActive: {
    color: '#D49A0B',
    fontWeight: '800',
  },
  hintText: {
    fontSize: 11,
    color: '#9A8772',
    marginTop: 6,
    marginLeft: 4,
    fontStyle: 'italic',
  },
  inputError: {
    borderColor: '#D32F2F',
    backgroundColor: '#FFEBEE',
  },
  hintError: {
    color: '#D32F2F',
    fontWeight: '700',
  },
  genderToggleFrame: {
    flexDirection: 'row',
    backgroundColor: skeuo.surfaceInset,
    padding: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? skeuo.insetShadow : undefined,
  },
  toggleBtn: { flex: 1, height: 42, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  activeMasculine: { backgroundColor: skeuo.surfaceRaised, borderWidth: 1, borderColor: skeuo.border, boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined },
  activeFeminine: { backgroundColor: skeuo.surfaceRaised, borderWidth: 1, borderColor: skeuo.border, boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined },
  toggleBtnText: { fontSize: 12, fontWeight: '900', color: '#9A8772', letterSpacing: 1 },
  textActive: { color: skeuo.plum },
  saveActionBtn: { width: '100%', height: 58, borderRadius: 29, marginTop: 30, overflow: 'hidden', boxShadow: Platform.OS === 'web' ? skeuo.goldShadow : undefined },
  saveGradient: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  saveActionText: { color: '#563F00', fontWeight: '900', fontSize: 14, letterSpacing: 1.6 },
});
