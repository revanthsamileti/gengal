import React, { useState, useEffect } from 'react';
import { tap36 } from '../theme/touch';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Platform,
  ScrollView,
  Pressable,
  Modal,
  TextInput,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import Wordmark from '../components/Wordmark';
import ScreenShell from '../components/ScreenShell';
import { skeuo, skeuoGradients } from '../theme/skeuomorphic';
import { ActivityIndicator, StatusBar } from 'react-native';

type PhoneScreenProps = {
  navigate: (screen: string, params?: any) => void;
  goBack?: () => void;
  route?: any;
};

const NUMPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'backspace'];
/**
 * `min`/`max` are the national significant number length, excluding the dial
 * code. A flat 10-digit rule used to be hardcoded, which made it impossible for
 * anyone outside India/US/Canada to finish signing up — a UAE number is 9
 * digits and could never reach the threshold.
 */
// Reverse-OTP sign-in only accepts Indian mobiles: the gateway SIM is Indian
// and the backend rejects every other sender. Add a country back only with a
// gateway that can receive from it.
const COUNTRY_CODES = [
  { country: 'India', code: '+91', iso: 'IN', min: 10, max: 10 },
];

export default function PhoneScreen({ navigate, goBack, route }: PhoneScreenProps) {
  const [phone, setPhone] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [countryCode, setCountryCode] = useState('+91');
  const [countryIso, setCountryIso] = useState('IN');
  const [isCountryOpen, setIsCountryOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (route?.params?.phone) {
      const p = route.params.phone;
      if (p.startsWith('+')) {
        const spaceIdx = p.indexOf(' ') !== -1 ? p.indexOf(' ') : (p.length > 10 ? p.length - 10 : 2);
        const nextCode = p.substring(0, spaceIdx);
        const nextCountry = COUNTRY_CODES.find((item) => item.code === nextCode);
        setCountryCode(nextCode);
        if (nextCountry) setCountryIso(nextCountry.iso);
        setPhone(p.substring(spaceIdx).trim());
      } else {
        setPhone(p);
      }
    }
  }, [route?.params?.phone]);

  const selectedCountry = COUNTRY_CODES.find((item) => item.iso === countryIso) || COUNTRY_CODES.find((item) => item.code === countryCode) || COUNTRY_CODES[0];
  const isPhoneComplete = phone.length >= selectedCountry.min && phone.length <= selectedCountry.max;
  const isValidMobile = /^[6-9]\d{9}$/.test(phone);

  const handlePress = (val: string) => {
    if (val === '') return;
    if (val === 'backspace') {
      setPhone((p) => p.slice(0, -1));
    } else {
      if (phone.length < selectedCountry.max) setPhone((p) => p + val);
    }
  };

  const handleContinue = () => {
    if (!isPhoneComplete) return;
    if (!isValidMobile) {
      setErrorMsg('Enter a valid Indian mobile number starting with 6, 7, 8 or 9.');
      return;
    }
    setErrorMsg('');
    navigate('VerifyBySms', { phone: countryCode + phone });
  };

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isLoading) return;
      
      if (e.key >= '0' && e.key <= '9') {
        handlePress(e.key);
      } else if (e.key === 'Backspace') {
        handlePress('backspace');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (isPhoneComplete) {
          handleContinue();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // countryIso matters here too: selectedCountry resolves by iso first, and
    // it is what decides the accepted digit length.
  }, [phone, isLoading, countryCode, countryIso]);

  return (
    <ScreenShell tone="light">
      <ScrollView 
        contentContainerStyle={[styles.phoneContainer, { flexGrow: 1, paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 20 : 60 }]} 
        bounces={false} 
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Wordmark size={30} />
        </View>

        <View style={styles.titleSection}>
          <Text style={styles.title}>
            Enter Phone Number
          </Text>
          <Text style={styles.subtitle}>
            Enter your mobile number to continue
          </Text>
          {errorMsg ? <Text style={{color: '#ef4444', marginTop: 8, fontSize: 13, textAlign: 'center'}}>{errorMsg}</Text> : null}
        </View>

        <View style={styles.inputWrapper}>
          <View style={styles.inputBox}>
            <TouchableOpacity 
              style={styles.countrySelector} 
              activeOpacity={0.7} 
              onPress={() => setIsCountryOpen(true)}
            >
              <View style={styles.countryIsoBadge}>
                <Text style={styles.countryIsoText}>{selectedCountry.iso}</Text>
              </View>
              <View style={styles.countryCodeBlock}>
                <Text style={styles.countryName} numberOfLines={1}>{selectedCountry.country}</Text>
                <Text style={styles.countryCode}>{countryCode}</Text>
              </View>
              <MaterialIcons name="keyboard-arrow-down" size={18} color="#5A155A" />
              <View style={styles.divider} />
            </TouchableOpacity>
            {/* A real TextInput, not a Text: this is the first field in the
                signup funnel, and as a Text it could not be autofilled, pasted
                into, or corrected mid-way. The numpad below still drives the
                same state, so both input methods stay in sync. */}
            <TextInput
              style={[styles.inputText, !phone && styles.placeholderText, { flex: 1 }, Platform.OS === 'web' && { outlineStyle: 'none' } as any]}
              value={phone}
              onChangeText={(text) => {
                // Autofill and paste often arrive with the country code, spaces
                // or punctuation attached.
                let digits = text.replace(/\D/g, '');
                const bare = countryCode.replace(/\D/g, '');
                if (bare && digits.startsWith(bare) && digits.length > selectedCountry.max) {
                  digits = digits.slice(bare.length);
                }
                setPhone(digits.slice(0, selectedCountry.max));
              }}
              placeholder="0000000000"
              // Large text is a real preference and is honoured; the
              // accessibility sizes above this would not fit ten digits at
              // any weight, and a number you cannot read the end of is
              // worse than one shown slightly smaller than asked.
              maxFontSizeMultiplier={1.3}
              placeholderTextColor="#B9A7B9"
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
              autoComplete="tel"
              inputMode="tel"
              maxLength={selectedCountry.max}
              returnKeyType="done"
              onSubmitEditing={() => { if (isPhoneComplete && !isLoading) handleContinue(); }}
              accessibilityLabel="Phone number"
              numberOfLines={1}
            />
          </View>
        </View>

        <View style={styles.numpadContainer}>
          {NUMPAD.map((key, i) => {
            if (key === '') {
              return <View key={i} style={styles.numpadKey} />;
            }
            return (
              <Pressable
                key={i}
                onPress={() => handlePress(key)}
                accessibilityRole="button"
                accessibilityLabel={key === 'backspace' ? 'Delete last digit' : key}
                style={({ pressed }) => [
                  styles.numpadKey,
                  styles.numpadKeyElevated,
                  pressed && { transform: [{ translateY: 2 }], boxShadow: 'none' }
                ]}
              >
                {key === 'backspace' ? (
                  <MaterialIcons name="backspace" size={26} color="#3A0D3A" />
                ) : (
                  <Text style={styles.numpadText}>{key}</Text>
                )}
              </Pressable>
            );
          })}
        </View>
        
        <View style={styles.footer}>
          <Pressable
            disabled={!isPhoneComplete || isLoading}
            onPress={handleContinue}
          >
            {({ pressed }) => (
              <View style={[
                styles.continueButtonWrapper,
                !isPhoneComplete && styles.disabledWrapper,
                pressed && { elevation: 0, shadowOpacity: 0, boxShadow: 'none' }
              ]}>
                <LinearGradient
                  colors={[...skeuoGradients.gold]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[styles.continueButton, pressed && { transform: [{ translateY: 2 }] }]}
                >
                  {isLoading ? (
                    <ActivityIndicator color="#422006" />
                  ) : (
                    <>
                      <Text style={styles.continueText}>
                        Continue
                      </Text>
                      <MaterialIcons name="arrow-forward" size={18} color="#422006" />
                    </>
                  )}
                </LinearGradient>
              </View>
            )}
          </Pressable>

        </View>

        <Modal
          visible={isCountryOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setIsCountryOpen(false)}
        >
          <Pressable style={styles.modalOverlay} onPress={() => setIsCountryOpen(false)}>
            <View style={styles.countrySheet}>
              <View style={styles.countrySheetHeader}>
                <Text style={styles.countrySheetTitle}>Select Country Code</Text>
                <TouchableOpacity hitSlop={tap36} style={styles.countryCloseButton} onPress={() => setIsCountryOpen(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Close">
                  <MaterialIcons name="close" size={20} color="#5A155A" />
                </TouchableOpacity>
              </View>
              {COUNTRY_CODES.map((item) => {
                const isSelected = item.iso === selectedCountry.iso;
                return (
                  <TouchableOpacity
                    key={`${item.iso}-${item.code}`}
                    style={[styles.countryOption, isSelected && styles.countryOptionSelected]}
                    activeOpacity={0.78}
                    onPress={() => {
                      setCountryCode(item.code);
                      setCountryIso(item.iso);
                      // Trim anything the previous country allowed but this one
                      // does not, so the field can never sit over the limit.
                      setPhone((p) => p.slice(0, item.max));
                      setIsCountryOpen(false);
                    }}
                  >
                    <View style={styles.countryOptionLeft}>
                      <View style={styles.countryIsoBadge}>
                        <Text style={styles.countryIsoText}>{item.iso}</Text>
                      </View>
                      <Text style={styles.countryOptionName}>{item.country}</Text>
                    </View>
                    <Text style={styles.countryOptionCode}>{item.code}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Pressable>
        </Modal>
      </ScrollView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  phoneContainer: {
    paddingHorizontal: 24,
    backgroundColor: skeuo.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    // Centred, like the title and the field beneath it. 'space-between'
    // was left over from a row that had a second item in it, and it left
    // the wordmark hanging off the left edge of an otherwise centred page.
    justifyContent: 'center',
    marginBottom: 20,
  },
  titleSection: {
    alignItems: 'center',
    marginBottom: 20,
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
  inputWrapper: {
    alignItems: 'center',
    marginBottom: 20,
  },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: skeuo.surfaceInset,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: skeuo.border,
    paddingVertical: 14,
    paddingHorizontal: 14,
    width: '100%',
    minHeight: 78,
    boxShadow: Platform.OS === 'web' ? skeuo.insetShadow : undefined,
    elevation: 2,
    shadowColor: '#533A1D',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  countrySelector: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 110,
    flexShrink: 0,
  },
  countryIsoBadge: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F4E7F5',
    borderWidth: 1,
    borderColor: '#E1CBE4',
  },
  countryIsoText: {
    color: '#5A155A',
    fontSize: 11,
    fontWeight: '900',
  },
  countryCodeBlock: {
    flex: 1,
    marginLeft: 8,
    minWidth: 0,
  },
  countryName: {
    color: '#7B6E79',
    fontSize: 10,
    fontWeight: '800',
  },
  countryCode: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1A1A1A',
  },
  divider: {
    width: 1,
    height: 34,
    backgroundColor: '#E5E7EB',
    marginLeft: 10,
  },
  inputText: {
    flex: 1,
    // Ten digits at 22px with 2px of tracking left 25px of slack in a
    // 172px field, so anything past a 1.17x system font scale cut the last
    // digit off -- and Android's ordinary 'Large' setting is 1.3x. People
    // could not see the end of their own number while typing it.
    fontSize: 20,
    fontWeight: '700',
    color: '#1A1A1A',
    letterSpacing: 1,
    textAlign: 'left',
    marginLeft: 12,
    minWidth: 0,
  },
  placeholderText: {
    color: '#D1D5DB',
  },
  numpadContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
    width: '100%',
    maxWidth: 290,
    alignSelf: 'center',
    marginBottom: 20,
  },
  numpadKey: {
    width: 82,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
  },
  numpadKeyElevated: {
    backgroundColor: skeuo.surfaceRaised,
    borderWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
    elevation: 5,
    shadowColor: '#533A1D',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
  },
  numpadText: {
    fontFamily: 'serif',
    fontSize: 24,
    fontWeight: '700',
    color: '#321151',
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
  disabledWrapper: {
    opacity: 0.5,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(32, 16, 36, 0.32)',
    justifyContent: 'flex-end',
  },
  countrySheet: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 430,
    maxHeight: '72%',
    backgroundColor: skeuo.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 24,
    boxShadow: Platform.OS === 'web' ? '0 -14px 34px rgba(54, 30, 58, 0.18)' : undefined,
  },
  countrySheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  countrySheetTitle: {
    color: skeuo.plum,
    fontSize: 18,
    fontWeight: '900',
    fontFamily: 'serif',
  },
  countryCloseButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F4EEE8',
  },
  countryOption: {
    minHeight: 52,
    borderRadius: 14,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  countryOptionSelected: {
    backgroundColor: '#F7ECF8',
    borderColor: '#E1CBE4',
  },
  countryOptionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
    gap: 10,
  },
  countryOptionName: {
    flex: 1,
    color: '#3A0D3A',
    fontSize: 14,
    fontWeight: '800',
  },
  countryOptionCode: {
    color: '#5A155A',
    fontSize: 14,
    fontWeight: '900',
  },
});
