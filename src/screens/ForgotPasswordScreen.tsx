import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  TextInput,
  Platform,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import ScreenShell from '../components/ScreenShell';
import { skeuo, skeuoGradients } from '../theme/skeuomorphic';
import { sendOTP, verifyOTP, setAccountPassword } from '../services/authService';
import { auth } from '../config/firebase';
import { signInWithCustomToken } from 'firebase/auth';
import { getUserProfile } from '../services/userService';

type Props = {
  navigate: (screen: string, params?: any) => void;
  goBack?: () => void;
  route?: any;
};

const NUMPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'backspace'];

export default function ForgotPasswordScreen({ navigate, route }: Props) {
  const phone = route?.params?.phone || '';
  
  const [step, setStep] = useState<'otp' | 'new_password'>('otp');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [resendTimer, setResendTimer] = useState(90);
  const [verifiedToken, setVerifiedToken] = useState('');

  useEffect(() => {
    let interval: any;
    if (resendTimer > 0) {
      interval = setInterval(() => {
        setResendTimer((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [resendTimer]);

  useEffect(() => {
    // Send OTP automatically when user lands on this screen. A silent failure
    // here left users waiting indefinitely for a code that was never sent.
    if (phone) {
      sendOTP(phone).catch((err: any) =>
        setErrorMsg(err?.message || 'We could not send your code. Tap Resend to try again.')
      );
    }
  }, [phone]);

  const handlePress = (val: string) => {
    if (val === '') return;
    if (step === 'otp') {
      if (val === 'backspace') {
        setOtp((o) => o.slice(0, -1));
      } else {
        if (otp.length < 6) setOtp((o) => o + val);
      }
    }
  };

  const formatOtp = (o: string) => {
    return o.padEnd(6, '-').split('').join(' ');
  };

  const handleContinue = async () => {
    if (step === 'otp') {
      if (otp.length === 6) {
        setIsLoading(true);
        setErrorMsg('');
        try {
          const result = await verifyOTP(phone, otp, 'signup'); // Use signup to just get token
          if (result.token) {
            setVerifiedToken(result.token);
            setStep('new_password');
          } else {
            throw new Error("Failed to verify OTP");
          }
        } catch (error: any) {
          setErrorMsg(error.message || "Invalid OTP code");
        } finally {
          setIsLoading(false);
        }
      }
    } else if (step === 'new_password') {
      if (newPassword.length >= 6) {
        setIsLoading(true);
        setErrorMsg('');
        try {
          // Log in with the custom token
          const userCredential = await signInWithCustomToken(auth, verifiedToken);
          await setAccountPassword(newPassword);
          
          if (userCredential.user) {
            const profile = await getUserProfile(userCredential.user.uid);
            const isComplete = Boolean(profile && (profile.username || profile.nickname || profile.coins !== undefined || profile.createdAt));
            
            if (isComplete) {
              navigate('Home');
            } else {
              navigate('ProfileDetails', { isEditMode: true, returnTo: 'Home' });
            }
          } else {
            navigate('Home');
          }
        } catch (error: any) {
          setErrorMsg(error.message || "Failed to reset password");
        } finally {
          setIsLoading(false);
        }
      }
    }
  };

  return (
    <ScreenShell tone="light">
      <ScrollView 
        contentContainerStyle={[styles.container, { flexGrow: 1 }]} 
        bounces={false} 
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigate('Phone', { step: 'password' })} style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Go back">
            <MaterialIcons name="arrow-back" size={24} color="#5A155A" />
          </TouchableOpacity>
        </View>

        <View style={styles.titleSection}>
          <Text style={styles.title}>
            {step === 'otp' ? 'Reset Password' : 'New Password'}
          </Text>
          <Text style={styles.subtitle}>
            {step === 'otp'
              ? `Enter the 6-digit code sent to ${phone}`
              : 'Enter a new password for your account'}
          </Text>
          {errorMsg ? <Text style={{color: '#ef4444', marginTop: 8, fontSize: 13, textAlign: 'center'}}>{errorMsg}</Text> : null}
        </View>

        {step === 'otp' ? (
          <>
            <View style={styles.inputWrapper}>
              <View style={styles.inputBox}>
                <Text 
                  style={[styles.inputTextCenter, !otp && styles.placeholderText, { flex: 1 }, Platform.OS === 'web' && { outlineStyle: 'none' } as any]}
                >
                  {formatOtp(otp)}
                </Text>
              </View>
            </View>

            <View style={styles.numpadContainer}>
              {NUMPAD.map((key, i) => {
                if (key === '') {
                  return <View key={i} style={styles.numpadKey} />;
                }
                return (
                  <TouchableOpacity
                    key={i}
                    style={[styles.numpadKey, key !== 'backspace' && styles.numpadKeyElevated]}
                    activeOpacity={0.7}
                    onPress={() => handlePress(key)}
                  >
                    {key === 'backspace' ? (
                      <MaterialIcons name="backspace" size={28} color="#4B5563" />
                    ) : (
                      <Text style={styles.numpadText}>{key}</Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        ) : (
          <View style={[styles.inputContainer, { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 16, borderRadius: 12, marginTop: 20 }]}>
            <TextInput
              style={{ flex: 1, fontSize: 18, color: '#1A1A1A' }}
              placeholder="Enter New Password"
              placeholderTextColor="#A0A0A0"
              secureTextEntry={!isPasswordVisible}
              value={newPassword}
              onChangeText={setNewPassword}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="newPassword"
              autoComplete="new-password"
              returnKeyType="done"
              onSubmitEditing={handleContinue}
              accessibilityLabel="New password"
            />
            <TouchableOpacity
              onPress={() => setIsPasswordVisible(!isPasswordVisible)}
              style={{ position: 'absolute', right: 15 }}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel={isPasswordVisible ? 'Hide password' : 'Show password'}
            >
              <MaterialIcons name={isPasswordVisible ? "visibility" : "visibility-off"} size={22} color="#A0A0A0" />
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.footer}>
          <Pressable
            disabled={(step === 'otp' && otp.length < 6) || (step === 'new_password' && newPassword.length < 6) || isLoading}
            onPress={handleContinue}
          >
            {({ pressed }) => (
              <View style={[
                styles.continueButtonWrapper,
                ((step === 'otp' && otp.length < 6) || (step === 'new_password' && newPassword.length < 6)) && styles.disabledWrapper,
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
                        {step === 'otp' ? 'Verify Code' : 'Save & Log In'}
                      </Text>
                      <MaterialIcons name="arrow-forward" size={18} color="#422006" />
                    </>
                  )}
                </LinearGradient>
              </View>
            )}
          </Pressable>

          {step === 'otp' && (
            <View style={{ alignItems: 'center' }}>
              <TouchableOpacity
                activeOpacity={resendTimer > 0 ? 1 : 0.7}
                style={{ marginTop: 20 }}
                disabled={resendTimer > 0 || isLoading}
                accessibilityRole="button"
                accessibilityLabel={resendTimer > 0 ? `Resend code available in ${resendTimer} seconds` : 'Resend verification code'}
                accessibilityState={{ disabled: resendTimer > 0 || isLoading }}
                onPress={async () => {
                  // Same race as the OTP screen: without the isLoading check a
                  // resend could fire while a verify was still in flight.
                  if (resendTimer === 0 && !isLoading) {
                    setIsLoading(true);
                    setErrorMsg('');
                    try {
                      await sendOTP(phone);
                      setResendTimer(90);
                    } catch (error: any) {
                      setErrorMsg(error.message || "Failed to resend OTP");
                    } finally {
                      setIsLoading(false);
                    }
                  }
                }}
              >
                <Text style={[{ color: '#5A155A', fontWeight: '600', fontSize: 15 }, resendTimer > 0 && { opacity: 0.5 }]}>
                  {resendTimer > 0 ? `Resend OTP in ${resendTimer}s` : 'Resend OTP'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
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
  titleSection: {
    marginBottom: 30,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#321151',
    marginBottom: 8,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    color: '#6B7280',
    lineHeight: 22,
  },
  inputWrapper: {
    marginBottom: 30,
  },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    minHeight: 64,
    borderWidth: 1,
    borderColor: skeuo.border,
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
  inputContainer: {
    borderWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? skeuo.insetShadow : undefined,
    elevation: 2,
    shadowColor: '#533A1D',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
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
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
