import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  TextInput,
  Platform,
  ScrollView,
  Pressable,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import ScreenShell from '../components/ScreenShell';
import { skeuo, skeuoGradients } from '../theme/skeuomorphic';
import { sendOTP, verifyOTP, loginWithPassword, checkUserExists } from '../services/authService';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../config/firebase';
import { ActivityIndicator } from 'react-native';

type PhoneScreenProps = {
  navigate: (screen: string, params?: any) => void;
  goBack?: () => void;
  route?: any;
};

const NUMPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'backspace'];

export let globalAuthMode: 'signup' | 'login' = 'signup';

export default function PhoneScreen({ navigate, goBack, route }: PhoneScreenProps) {
  const [authMode, setAuthMode] = useState<'signup' | 'login'>('signup');
  const [phone, setPhone] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [countryCode, setCountryCode] = useState('+1');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (route?.params?.phone) {
      const p = route.params.phone;
      if (p.startsWith('+')) {
        const spaceIdx = p.indexOf(' ') !== -1 ? p.indexOf(' ') : (p.length > 10 ? p.length - 10 : 2);
        setCountryCode(p.substring(0, spaceIdx));
        setPhone(p.substring(spaceIdx).trim());
      } else {
        setPhone(p);
      }
    }
  }, [route?.params?.phone]);

  const cycleCountryCode = () => {
    const codes = ['+1', '+91', '+44', '+61', '+33', '+49'];
    const currentIndex = codes.indexOf(countryCode);
    const nextIndex = (currentIndex + 1) % codes.length;
    setCountryCode(codes[nextIndex]);
  };

  useEffect(() => {
    globalAuthMode = authMode;
  }, [authMode]);

  useEffect(() => {
    fetch('https://ipwho.is/')
      .then((res) => res.json())
      .then((data) => {
        if (data?.calling_code) {
          setCountryCode('+' + data.calling_code);
        } else {
          throw new Error('Fallback');
        }
      })
      .catch(() => {
        try {
          const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
          if (tz.includes('Kolkata') || tz.includes('Calcutta')) setCountryCode('+91');
          else if (tz.includes('London')) setCountryCode('+44');
          else if (tz.includes('Sydney') || tz.includes('Melbourne')) setCountryCode('+61');
          else if (tz.includes('Paris')) setCountryCode('+33');
          else if (tz.includes('Berlin')) setCountryCode('+49');
        } catch (err) {
          console.log(err);
        }
      });
  }, []);

  const handlePress = (val: string) => {
    if (val === '') return;
    if (val === 'backspace') {
      setPhone((p) => p.slice(0, -1));
    } else {
      if (phone.length < 10) setPhone((p) => p + val);
    }
  };

  const handleContinue = async () => {
    if (phone.length === 10) {
      setIsLoading(true);
      setErrorMsg('');
      try {
        const fullPhone = countryCode + phone;

        try {
          const userExists = await checkUserExists(fullPhone);

          if (userExists) {
            navigate('LoginPassword', { phone: fullPhone, authMode: 'login' });
          } else {
            await sendOTP(fullPhone);
            navigate('Otp', { phone: fullPhone, authMode: 'signup' });
          }
        } catch (dbError: any) {
          throw dbError;
        }
      } catch (error: any) {
        setErrorMsg(error.message || "Failed to proceed");
      } finally {
        setIsLoading(false);
      }
    }
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
        if (phone.length === 10) {
          handleContinue();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [phone, isLoading, authMode, countryCode]);

  const formatPhone = (p: string) => {
    if (!p) return '0000000000';
    return p;
  };

  return (
    <ScreenShell tone="light">
      <ScrollView 
        contentContainerStyle={[styles.phoneContainer, { flexGrow: 1 }]} 
        bounces={false} 
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.brand}>Gengal</Text>
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
              style={styles.flagContainer} 
              activeOpacity={0.7} 
              onPress={cycleCountryCode}
            >
              <MaterialIcons name="flag" size={16} color="#5A155A" />
              <Text style={styles.countryCode}>{countryCode}</Text>
              <View style={styles.divider} />
            </TouchableOpacity>
            <Text 
              style={[styles.inputText, !phone && styles.placeholderText, { flex: 1 }, Platform.OS === 'web' && { outlineStyle: 'none' } as any]}
            >
              {phone ? formatPhone(phone) : '0000000000'}
            </Text>
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
                style={({ pressed }) => [
                  styles.numpadKey, 
                  styles.numpadKeyElevated,
                  pressed && { transform: [{ translateY: 2 }], boxShadow: 'none' }
                ]}
              >
                {key === 'backspace' ? (
                  <MaterialIcons name="backspace" size={20} color="#3A0D3A" />
                ) : (
                  <Text style={styles.numpadText}>{key}</Text>
                )}
              </Pressable>
            );
          })}
        </View>
        
        <View style={styles.footer}>
          <Pressable
            disabled={phone.length < 10 || isLoading}
            onPress={handleContinue}
          >
            {({ pressed }) => (
              <View style={[
                styles.continueButtonWrapper,
                (phone.length < 10) && styles.disabledWrapper,
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
      </ScrollView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  phoneContainer: {
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
    justifyContent: 'center',
    backgroundColor: skeuo.surfaceInset,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: skeuo.border,
    paddingVertical: 20,
    paddingHorizontal: 20,
    width: '100%',
    boxShadow: Platform.OS === 'web' ? skeuo.insetShadow : undefined,
    elevation: 2,
    shadowColor: '#533A1D',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  flagContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 15,
  },
  countryCode: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1A1A',
    marginLeft: 6,
  },
  divider: {
    width: 1,
    height: 20,
    backgroundColor: '#E5E7EB',
    marginLeft: 15,
  },
  inputText: {
    flex: 1,
    fontSize: 22,
    fontWeight: '600',
    color: '#1A1A1A',
    letterSpacing: 2,
  },
  placeholderText: {
    color: '#D1D5DB',
  },
  numpadContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 15,
    width: '100%',
    marginBottom: 20,
  },
  numpadKey: {
    width: '28%',
    aspectRatio: 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
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
  toggleAuthModeBtn: {
    marginTop: 12,
    alignItems: 'center',
    paddingVertical: 10,
  },
  toggleAuthModeText: {
    color: '#5A155A',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
});
