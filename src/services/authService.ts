import { auth } from '../config/firebase';
import {
  signInWithCustomToken,
  User,
} from 'firebase/auth';

import { Platform } from 'react-native';
import { logDebugEvent, setDebugContext } from './debugLogger';

export const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://127.0.0.1:5000';
const SESSION_PHONE_KEY = 'gengal.session.phone';
const SESSION_PASSWORD_KEY = 'gengal.session.password';

const safeParseJson = async (response: Response, defaultError: string): Promise<any> => {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(
      `${defaultError} (Server offline or returned non-JSON format: ${text.substring(0, 100)}...)`
    );
  }
};

const secureSet = async (key: string, value: string) => {
  if (Platform.OS === 'web') return;
  try {
    const SecureStore = await import('expo-secure-store');
    await SecureStore.setItemAsync(key, value);
  } catch (error) {
    console.warn('[Auth] Secure session storage is unavailable in this build:', error);
  }
};

const secureGet = async (key: string) => {
  if (Platform.OS === 'web') return null;
  try {
    const SecureStore = await import('expo-secure-store');
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
};

const secureDelete = async (key: string) => {
  if (Platform.OS === 'web') return;
  try {
    const SecureStore = await import('expo-secure-store');
    await SecureStore.deleteItemAsync(key);
  } catch {}
};

export const saveAuthSession = async (phoneNumber: string, password: string) => {
  await Promise.all([
    secureSet(SESSION_PHONE_KEY, phoneNumber),
    secureSet(SESSION_PASSWORD_KEY, password),
  ]);
};

export const clearAuthSession = async () => {
  await Promise.all([
    secureDelete(SESSION_PHONE_KEY),
    secureDelete(SESSION_PASSWORD_KEY),
  ]);
};

export const restoreAuthSession = async (): Promise<User | null> => {
  const [phone, password] = await Promise.all([
    secureGet(SESSION_PHONE_KEY),
    secureGet(SESSION_PASSWORD_KEY),
  ]);

  if (!phone || !password) return null;

  try {
    const { user } = await loginWithPassword(phone, password, false);
    return user || null;
  } catch (error) {
    await clearAuthSession();
    throw error;
  }
};

export const sendOTP = async (phoneNumber: string): Promise<void> => {
  try {
    const cleanPhone = phoneNumber.replace(/\s+/g, '');
    const formattedPhone = cleanPhone.startsWith('+') ? cleanPhone : `+91${cleanPhone}`;
    setDebugContext({ phone: formattedPhone });
    logDebugEvent('auth.sendOtp.start', { phone: formattedPhone, backendUrl: BACKEND_URL });
    
    const response = await fetch(`${BACKEND_URL}/api/v1/auth/send-otp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Bypass-Tunnel-Reminder': 'true' // Bypass localtunnel warning page
      },
      body: JSON.stringify({ phone: formattedPhone }),
    });

    if (!response.ok) {
      const data = await safeParseJson(response, 'Failed to send OTP');
      logDebugEvent('auth.sendOtp.httpError', { phone: formattedPhone, status: response.status, response: data }, 'warn');
      throw new Error(data.error || 'Failed to send OTP');
    }
    logDebugEvent('auth.sendOtp.success', { phone: formattedPhone });
  } catch (error) {
    logDebugEvent('auth.sendOtp.failed', { phone: phoneNumber, backendUrl: BACKEND_URL, error }, 'error');
    console.error("Error sending Fast2SMS OTP", error);
    throw error;
  }
};

export const checkUserExists = async (phoneNumber: string): Promise<boolean> => {
  try {
    const cleanPhone = phoneNumber.replace(/\s+/g, '');
    const formattedPhone = cleanPhone.startsWith('+') ? cleanPhone : `+91${cleanPhone}`;
    setDebugContext({ phone: formattedPhone });
    logDebugEvent('auth.checkUser.start', { phone: formattedPhone, backendUrl: BACKEND_URL });
    
    const response = await fetch(`${BACKEND_URL}/api/v1/auth/check-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Bypass-Tunnel-Reminder': 'true'
      },
      body: JSON.stringify({ phone: formattedPhone }),
    });

    if (!response.ok) {
      const data = await safeParseJson(response, 'Failed to check user');
      logDebugEvent('auth.checkUser.httpError', { phone: formattedPhone, status: response.status, response: data }, 'warn');
      throw new Error(data.error || 'Failed to check user');
    }
    
    const data = await safeParseJson(response, 'Failed to check user');
    logDebugEvent('auth.checkUser.success', { phone: formattedPhone, exists: data.exists });
    return data.exists;
  } catch (error) {
    logDebugEvent('auth.checkUser.failed', { phone: phoneNumber, backendUrl: BACKEND_URL, error }, 'error');
    console.error("Error checking user existence", error);
    throw error;
  }
};

export const verifyOTP = async (phoneNumber: string, code: string, authMode: 'signup' | 'login'): Promise<{user?: User, token?: string}> => {
  try {
    const cleanPhone = phoneNumber.replace(/\s+/g, '');
    const formattedPhone = cleanPhone.startsWith('+') ? cleanPhone : `+91${cleanPhone}`;
    setDebugContext({ phone: formattedPhone });
    logDebugEvent('auth.verifyOtp.start', { phone: formattedPhone, authMode, backendUrl: BACKEND_URL });

    const response = await fetch(`${BACKEND_URL}/api/v1/auth/verify-otp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Bypass-Tunnel-Reminder': 'true'
      },
      body: JSON.stringify({ phone: formattedPhone, otp: code }),
    });

    if (!response.ok) {
      const data = await safeParseJson(response, 'Invalid OTP');
      logDebugEvent('auth.verifyOtp.httpError', { phone: formattedPhone, authMode, status: response.status, response: data }, 'warn');
      throw new Error(data.error || 'Invalid OTP');
    }

    const data = await safeParseJson(response, 'Failed to verify OTP');
    const token = data.token;

    if (authMode === 'login') {
      const userCredential = await signInWithCustomToken(auth, token);
      setDebugContext({ userId: userCredential.user.uid });
      logDebugEvent('auth.verifyOtp.loginSuccess', { phone: formattedPhone, uid: userCredential.user.uid });
      return { user: userCredential.user };
    } else {
      // In signup mode, just return the token so we can login at the VERY end
      logDebugEvent('auth.verifyOtp.signupTokenSuccess', { phone: formattedPhone });
      return { token };
    }
  } catch (error) {
    logDebugEvent('auth.verifyOtp.failed', { phone: phoneNumber, authMode, backendUrl: BACKEND_URL, error }, 'error');
    console.error("Error verifying Fast2SMS OTP", error);
    throw error;
  }
};

export const loginWithPassword = async (phoneNumber: string, password: string, persistSession = true): Promise<{user?: User, token?: string}> => {
  try {
    const cleanPhone = phoneNumber.replace(/\s+/g, '');
    const formattedPhone = cleanPhone.startsWith('+') ? cleanPhone : `+91${cleanPhone}`;
    setDebugContext({ phone: formattedPhone });
    logDebugEvent('auth.loginPassword.start', { phone: formattedPhone, persistSession, backendUrl: BACKEND_URL });

    const response = await fetch(`${BACKEND_URL}/api/v1/auth/login-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Bypass-Tunnel-Reminder': 'true'
      },
      body: JSON.stringify({ phone: formattedPhone, password }),
    });

    if (!response.ok) {
      const data = await safeParseJson(response, 'Invalid credentials');
      logDebugEvent('auth.loginPassword.httpError', { phone: formattedPhone, status: response.status, response: data }, 'warn');
      throw new Error(data.error || 'Invalid credentials');
    }

    const data = await safeParseJson(response, 'Failed to login with password');
    const token = data.token;
    const userCredential = await signInWithCustomToken(auth, token);
    setDebugContext({ userId: userCredential.user.uid });
    if (persistSession) {
      await saveAuthSession(formattedPhone, password);
    }
    logDebugEvent('auth.loginPassword.success', { phone: formattedPhone, uid: userCredential.user.uid, persisted: persistSession });
    return { user: userCredential.user, token };
  } catch (error) {
    logDebugEvent('auth.loginPassword.failed', { phone: phoneNumber, persistSession, backendUrl: BACKEND_URL, error }, 'error');
    console.error("Error logging in with password", error);
    throw error;
  }
};

export const logout = async () => {
  try {
    logDebugEvent('auth.logout.start', {});
    await clearAuthSession();
    await auth.signOut();
    setDebugContext({ userId: null, phone: null });
    logDebugEvent('auth.logout.success', {});
  } catch (error) {
    logDebugEvent('auth.logout.failed', { error }, 'error');
    console.error("Error logging out", error);
    throw error;
  }
};
