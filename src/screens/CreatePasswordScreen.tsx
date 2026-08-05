import React, { useState, useRef } from 'react';
import { Platform, View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import ScreenShell from '../components/ScreenShell';
import { skeuo } from '../theme/skeuomorphic';
import { auth, db } from '../config/firebase';
import { signInWithCustomToken } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { saveAuthSession, setAccountPassword } from '../services/authService';
import { savePrivateUserData } from '../services/userService';

export default function CreatePasswordScreen({ navigate, goBack, route }: any) {
  const { params } = route || {};
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  // Return on the first field advances to confirm instead of dismissing the
  // keyboard and stranding the user mid-form.
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

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

      // 2. The phone number is private, so it goes to /user_private rather than
      // the world-readable profile document.
      await savePrivateUserData(user.uid, { phoneNumber: params.phone });

      // 3. Create the Firestore user document. Passwords are stored only on the backend.
      const userRef = doc(db, 'users', user.uid);
      await setDoc(userRef, {
        // Security rules require uid to match the document id.
        uid: user.uid,
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
        coins: 500,
        hearts: 0,
        respectBadges: 0,
        unrewardedCallSeconds: 0,
        totalReceivedCallSeconds: 0,
        isActiveMode: true,
        isOnline: true,
        isSessionActive: true,
        lastActive: serverTimestamp(),
        createdAt: serverTimestamp(),
      });
      await setAccountPassword(password);
      await saveAuthSession(params.phone, password);

      // 4. Navigate manually since App.tsx is ignoring auth changes during CreatePassword
      navigate('Home');
    } catch (error: any) {
      setErrorMsg(error.message || 'Failed to create account');
      setIsLoading(false);
    }
  };

  return (
    <ScreenShell tone="light">
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={goBack} style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Go back">
            <MaterialIcons name="arrow-back" size={24} color="#5A155A" />
          </TouchableOpacity>
        </View>

        <Text style={styles.title}>Secure Your Account</Text>
        <Text style={styles.subtitle}>Create a password to access your GenGal account later.</Text>

        <View style={[styles.inputContainer, { flexDirection: 'row', alignItems: 'center' }]}>
          <TextInput
            ref={passwordRef}
            style={[styles.input, { flex: 1, marginBottom: 0 }]}
            placeholder="Enter Password"
            placeholderTextColor="#A0A0A0"
            secureTextEntry={!isPasswordVisible}
            value={password}
            onChangeText={setPassword}
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="newPassword"
            autoComplete="new-password"
            returnKeyType="next"
            onSubmitEditing={() => confirmRef.current?.focus()}
            accessibilityLabel="Password"
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
        <View style={[styles.inputContainer, { flexDirection: 'row', alignItems: 'center' }]}>
          <TextInput
            ref={confirmRef}
            style={[styles.input, { flex: 1, marginBottom: 0 }]}
            placeholder="Confirm Password"
            placeholderTextColor="#A0A0A0"
            secureTextEntry={!isPasswordVisible}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="newPassword"
            autoComplete="new-password"
            returnKeyType="done"
            onSubmitEditing={handleSignUp}
            accessibilityLabel="Confirm password"
          />
        </View>

        {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}

        <TouchableOpacity 
          style={[styles.signupBtn, isLoading && { opacity: 0.7 }]} 
          onPress={handleSignUp}
          disabled={isLoading || !password || !confirmPassword}
          accessibilityRole="button"
          accessibilityLabel="Create account"
          accessibilityState={{ disabled: isLoading || !password || !confirmPassword }}
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
