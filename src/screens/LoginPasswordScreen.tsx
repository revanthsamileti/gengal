import React, { useState } from 'react';
import { Platform, View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import ScreenShell from '../components/ScreenShell';
import { skeuo } from '../theme/skeuomorphic';
import { loginWithPassword } from '../services/authService';

export default function LoginPasswordScreen({ navigate, goBack, route }: any) {
  const { params } = route || {};
  const phone = params?.phone || '';

  const [password, setPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleLogin = async () => {
    if (!password) {
      setErrorMsg('Please enter your password');
      return;
    }

    setIsLoading(true);
    setErrorMsg('');

    try {
      await loginWithPassword(phone, password);
      // App.tsx onAuthStateChanged will detect the login and route to Home automatically!
    } catch (error: any) {
      setErrorMsg(error.message || 'Invalid password or account');
      setIsLoading(false);
    }
  };

  return (
    <ScreenShell tone="light">
      <View style={styles.phone}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            activeOpacity={0.78}
            onPress={() => goBack ? goBack() : navigate('Phone')}
          >
            <MaterialIcons name="arrow-back" size={22} color="#5A075F" />
          </TouchableOpacity>
        </View>

        <View style={styles.content}>
          <View style={styles.iconWrapper}>
            <MaterialIcons name="lock-outline" size={42} color="#D49A0B" />
          </View>
          
          <Text style={styles.title}>Enter Password</Text>
          <Text style={styles.subtitle}>
            Welcome back! Please enter your password for {phone}.
          </Text>

          <View style={styles.inputContainer}>
            <View style={[styles.inputWrapper, { boxShadow: Platform.OS === 'web' ? skeuo.insetShadow : undefined }]}>
              <MaterialIcons name="vpn-key" size={20} color="#B68D1C" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Password"
                placeholderTextColor="#A89F91"
                secureTextEntry={!isPasswordVisible}
                value={password}
                onChangeText={setPassword}
                autoCapitalize="none"
              />
              <TouchableOpacity
                onPress={() => setIsPasswordVisible(!isPasswordVisible)}
                style={styles.eyeButton}
              >
                <MaterialIcons
                  name={isPasswordVisible ? 'visibility-off' : 'visibility'}
                  size={20}
                  color="#A89F91"
                />
              </TouchableOpacity>
            </View>
          </View>

          {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}

          <TouchableOpacity style={styles.forgotPasswordButton} onPress={() => navigate('ForgotPassword', { phone })}>
            <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
          </TouchableOpacity>

          <View style={{ flex: 1 }} />

          <TouchableOpacity
            style={[styles.continueButton, !password && styles.continueButtonDisabled]}
            activeOpacity={0.85}
            onPress={handleLogin}
            disabled={!password || isLoading}
          >
            <LinearGradient
              colors={password ? ['#F3DA79', '#D49A0B'] : ['#F7EEC7', '#D8C783']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.continueGradient}
            >
              {isLoading ? (
                <ActivityIndicator color="#5A075F" />
              ) : (
                <Text style={[styles.continueButtonText, !password && styles.continueButtonTextDisabled]}>Login</Text>
              )}
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
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 10 : 0,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F8F0E5',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  content: {
    flex: 1,
    paddingHorizontal: 32,
    paddingTop: 20,
    paddingBottom: 40,
  },
  iconWrapper: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FFF',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 24,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
    borderWidth: 1,
    borderColor: 'rgba(212,154,11,0.2)',
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#342D26',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: '#756A62',
    lineHeight: 22,
    marginBottom: 32,
    textAlign: 'center',
  },
  inputContainer: {
    marginBottom: 16,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8F0E5',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EFE5D5',
    height: 56,
    paddingHorizontal: 16,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#342D26',
    fontWeight: '500',
    ...Platform.select({
      web: { outlineStyle: 'none' } as any
    }),
  },
  eyeButton: {
    padding: 8,
  },
  errorText: {
    color: '#D32F2F',
    fontSize: 14,
    marginBottom: 16,
    textAlign: 'center',
  },
  forgotPasswordButton: {
    alignSelf: 'center',
    padding: 8,
  },
  forgotPasswordText: {
    color: '#D49A0B',
    fontSize: 14,
    fontWeight: '600',
  },
  continueButton: {
    height: 56,
    borderRadius: 28,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
    marginTop: 20,
  },
  continueButtonDisabled: {
    boxShadow: Platform.OS === 'web' ? 'inset 0 1px 0 rgba(255,255,255,0.7)' : undefined,
  },
  continueGradient: {
    flex: 1,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueButtonText: {
    fontSize: 17,
    fontWeight: '800',
    color: '#3F2F00',
  },
  continueButtonTextDisabled: {
    color: '#9E9277',
  },
});
