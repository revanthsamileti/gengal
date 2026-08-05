import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Platform,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import ScreenShell from '../components/ScreenShell';
import { skeuo, skeuoGradients } from '../theme/skeuomorphic';
import { verifyOTP, sendOTP } from '../services/authService';

type OtpScreenProps = {
  navigate: (screen: string, params?: any) => void;
  goBack: () => void;
  route: any;
};

const NUMPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'backspace'];

// Module-level variables for OTP rate limiting rules
let otpRequestTime: number = Date.now();
let singleRequestErrors: number = 0;
let sequentialErrors: number = 0;
let blockUntil: number = 0;

export default function OtpScreen({ navigate, goBack, route }: OtpScreenProps) {
  const phone = route?.params?.phone || '';
  const authMode = route?.params?.authMode || 'signup';

  const [otp, setOtp] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [resendTimer, setResendTimer] = useState(90);
  const [blockRemaining, setBlockRemaining] = useState(0);

  useEffect(() => {
    // Reset timers when mounted
    otpRequestTime = Date.now();
    singleRequestErrors = 0;
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      if (blockUntil > now) {
        setBlockRemaining(Math.ceil((blockUntil - now) / 1000));
      } else {
        setBlockRemaining(0);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let interval: any;
    if (resendTimer > 0) {
      interval = setInterval(() => {
        setResendTimer((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [resendTimer]);

  const handlePress = (val: string) => {
    if (val === '') return;
    if (val === 'backspace') {
      setOtp((o) => o.slice(0, -1));
    } else {
      if (otp.length < 6) setOtp((o) => o + val);
    }
  };

  const handleContinue = async () => {
    if (blockRemaining > 0) {
      setErrorMsg(`Too many incorrect attempts. Please try again in ${Math.ceil(blockRemaining / 60)} minutes.`);
      return;
    }

    if (otp.length === 6) {
      if (Date.now() - otpRequestTime > 5 * 60 * 1000) {
        setErrorMsg("OTP expired. Please request a new one.");
        return;
      }

      setIsLoading(true);
      setErrorMsg('');
      try {
        const result = await verifyOTP(phone, otp, authMode);
        
        singleRequestErrors = 0;
        sequentialErrors = 0;

        if (authMode === 'signup') {
          navigate('ProfileDetails', { phone: phone, token: result.token });
        } else {
          // App.tsx onAuthStateChanged will detect login and automatically navigate
        }
      } catch (error: any) {
        singleRequestErrors++;
        sequentialErrors++;

        if (sequentialErrors >= 3) {
          blockUntil = Date.now() + 60 * 60 * 1000; // 1 hour
          setErrorMsg("You have entered an incorrect OTP too many times. Blocked for 1 hour.");
          setBlockRemaining(60 * 60);
        } else if (singleRequestErrors >= 3) {
          blockUntil = Date.now() + 5 * 60 * 1000; // 5 mins
          setErrorMsg("Too many incorrect attempts for this OTP. Blocked for 5 minutes.");
          setBlockRemaining(5 * 60);
        } else {
          setErrorMsg(error.message || "Invalid OTP code");
        }
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
        if (otp.length === 6) {
          handleContinue();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [otp, isLoading]);

  const formatOtp = (o: string) => {
    return o.padEnd(6, '-').split('').join(' ');
  };

  return (
    <ScreenShell tone="light">
      <ScrollView 
        contentContainerStyle={[styles.container, { flexGrow: 1 }]} 
        bounces={false} 
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack} style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Go back">
            <MaterialIcons name="arrow-back" size={24} color="#5A155A" />
          </TouchableOpacity>
          <Text style={styles.brand}>Gengal</Text>
          <View style={{ width: 44 }} />
        </View>

        <View style={styles.titleSection}>
          <Text style={styles.title}>Verify Identity</Text>
          <Text style={styles.subtitle}>
            Enter the 6-digit code sent to {phone}
          </Text>
          {errorMsg ? <Text style={{color: '#ef4444', marginTop: 8, fontSize: 13, textAlign: 'center'}}>{errorMsg}</Text> : null}
        </View>

        <View style={styles.inputWrapper}>
          <View style={styles.inputBox}>
            {/* A real TextInput, not a Text: this is what makes SMS autofill
                and paste possible. The numpad below still drives the same
                state, so both entry methods work. */}
            <TextInput
              style={[styles.inputTextCenter, !otp && styles.placeholderText, { flex: 1 }, Platform.OS === 'web' && { outlineStyle: 'none' } as any]}
              value={otp}
              onChangeText={(t) => setOtp(t.replace(/\D/g, '').slice(0, 6))}
              placeholder={formatOtp('')}
              placeholderTextColor="#B9A48F"
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="sms-otp"
              maxLength={6}
              returnKeyType="done"
              onSubmitEditing={() => { if (otp.length === 6 && !isLoading) handleContinue(); }}
              accessibilityLabel="Six digit verification code"
              editable={!isLoading}
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
            disabled={otp.length < 6 || isLoading}
            onPress={handleContinue}
          >
            {({ pressed }) => (
              <View style={[
                styles.continueButtonWrapper,
                (otp.length < 6 || isLoading) && styles.disabledWrapper,
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
                      <Text style={styles.continueText}>Verify & Proceed</Text>
                      <MaterialIcons name="arrow-forward" size={18} color="#422006" />
                    </>
                  )}
                </LinearGradient>
              </View>
            )}
          </Pressable>

          <View style={{ alignItems: 'center' }}>
            <TouchableOpacity 
              activeOpacity={resendTimer > 0 ? 1 : 0.7} 
              style={[styles.toggleAuthModeBtn, { marginTop: 10 }]}
              disabled={resendTimer > 0 || isLoading}
              accessibilityRole="button"
              accessibilityLabel={resendTimer > 0 ? `Resend code available in ${resendTimer} seconds` : 'Resend verification code'}
              accessibilityState={{ disabled: resendTimer > 0 || isLoading }}
              onPress={async () => {
                // isLoading matters as well as the timer: without it a resend
                // could fire while a verify was still in flight, racing two
                // auth requests against each other.
                if (resendTimer === 0 && !isLoading) {
                  setIsLoading(true);
                  setErrorMsg('');
                  try {
                    await sendOTP(phone);
                    setResendTimer(90);
                    otpRequestTime = Date.now();
                    singleRequestErrors = 0;
                  } catch (error: any) {
                    setErrorMsg(error.message || "Failed to resend OTP");
                  } finally {
                    setIsLoading(false);
                  }
                }
              }}
            >
              <Text style={[styles.toggleAuthModeText, resendTimer > 0 && { opacity: 0.5 }]}>
                {resendTimer > 0 ? `Resend OTP in ${resendTimer}s` : 'Resend OTP'}
              </Text>
            </TouchableOpacity>
          </View>
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
  inputTextCenter: {
    fontSize: 26,
    fontWeight: '600',
    color: '#1A1A1A',
    letterSpacing: 8,
    textAlign: 'center',
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
