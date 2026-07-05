import React, { useState } from 'react';
import { Platform, View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import ScreenShell from '../components/ScreenShell';
import { skeuo } from '../theme/skeuomorphic';
import { auth, db } from '../config/firebase';
import { signInWithCustomToken } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';

export default function CreatePasswordScreen({ navigate, goBack, route }: any) {
  const { params } = route || {};
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleSignUp = async () => {
    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match');
      return;
    }

    setIsLoading(true);
    setErrorMsg('');

    try {
      // 1. Log the user in with the custom token we generated earlier
      const userCredential = await signInWithCustomToken(auth, params.token);
      const user = userCredential.user;

      // 2. Create the Firestore user document
      const userRef = doc(db, 'users', user.uid);
      await setDoc(userRef, {
        phoneNumber: params.phone,
        username: params.name,
        nickname: params.nickname || params.name,
        age: params.dob,
        gender: params.gender,
        country: params.country || '',
        state: params.state || '',
        city: params.city || '',
        language: params.language || '',
        avatar3dUrl: 'CUSTOM_BUILDER_AVATAR',
        avatarData: params.avatar,
        password: password, // Note: In a real app, hash this or use proper providers.
        coins: 0,
        createdAt: new Date().toISOString(),
      });

      // App.tsx onAuthStateChanged will detect the login and route to Home!
    } catch (error: any) {
      setErrorMsg(error.message || 'Failed to create account');
      setIsLoading(false);
    }
  };

  return (
    <ScreenShell tone="light">
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={goBack} style={styles.backBtn}>
            <MaterialIcons name="arrow-back" size={24} color="#5A155A" />
          </TouchableOpacity>
        </View>

        <Text style={styles.title}>Secure Your Account</Text>
        <Text style={styles.subtitle}>Create a password to access your GenGal account later.</Text>

        <View style={[styles.inputContainer, { flexDirection: 'row', alignItems: 'center' }]}>
          <TextInput
            style={[styles.input, { flex: 1, marginBottom: 0 }]}
            placeholder="Enter Password"
            placeholderTextColor="#A0A0A0"
            secureTextEntry={!isPasswordVisible}
            value={password}
            onChangeText={setPassword}
          />
          <TouchableOpacity onPress={() => setIsPasswordVisible(!isPasswordVisible)} style={{ position: 'absolute', right: 15 }}>
            <MaterialIcons name={isPasswordVisible ? "visibility" : "visibility-off"} size={22} color="#A0A0A0" />
          </TouchableOpacity>
        </View>
        <View style={[styles.inputContainer, { flexDirection: 'row', alignItems: 'center' }]}>
          <TextInput
            style={[styles.input, { flex: 1, marginBottom: 0 }]}
            placeholder="Confirm Password"
            placeholderTextColor="#A0A0A0"
            secureTextEntry={!isPasswordVisible}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
          />
        </View>

        {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}

        <TouchableOpacity 
          style={[styles.signupBtn, isLoading && { opacity: 0.7 }]} 
          onPress={handleSignUp}
          disabled={isLoading}
        >
          <LinearGradient
            colors={['#5A155A', '#2D0A2D']}
            style={styles.btnGradient}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.signupText}>Complete Sign Up</Text>
            )}
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 60,
  },
  headerRow: {
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
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#5A155A',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#5A155A',
    opacity: 0.8,
    marginBottom: 30,
  },
  inputContainer: {
    backgroundColor: '#FAF5EE',
    borderRadius: 16,
    marginBottom: 16,
    paddingHorizontal: 16,
    height: 56,
    justifyContent: 'center',
    boxShadow: Platform.OS === 'web' ? skeuo.insetShadow : undefined,
  },
  input: {
    fontSize: 16,
    color: '#5A155A',
    height: '100%',
  },
  errorText: {
    color: '#ef4444',
    marginBottom: 16,
    textAlign: 'center',
  },
  signupBtn: {
    borderRadius: 16,
    overflow: 'hidden',
    marginTop: 20,
  },
  btnGradient: {
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
  },
  signupText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
});
