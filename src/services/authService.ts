import { auth } from '../config/firebase';
import {
  signInWithCustomToken,
  User,
} from 'firebase/auth';

import { Platform } from 'react-native';
import { logDebugEvent, setDebugContext } from './debugLogger';

export const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
const SESSION_PHONE_KEY = 'gengal.session.phone';

/**
 * EXPO_PUBLIC_* values are inlined at bundle time, so whatever is set when a
 * build is made is baked into the binary permanently. Development tunnels are
 * rotated or torn down, which silently bricks every install pointing at them.
 */
const EPHEMERAL_TUNNEL_HOSTS = [
  'trycloudflare.com',
  'ngrok.io',
  'ngrok-free.app',
  'loca.lt',
  'serveo.net',
  'pinggy.link',
];

let warnedAboutTunnel = false;

const warnIfEphemeral = (url: string) => {
  if (warnedAboutTunnel || __DEV__) return;
  if (EPHEMERAL_TUNNEL_HOSTS.some(host => url.includes(host))) {
    warnedAboutTunnel = true;
    console.warn(
      `[Auth] EXPO_PUBLIC_BACKEND_URL points at a temporary tunnel (${url}). ` +
      'This build will stop working when the tunnel closes — set a stable HTTPS backend URL before releasing.'
    );
  }
};

export const getBackendUrl = () => {
  if (!BACKEND_URL) {
    throw new Error('Missing EXPO_PUBLIC_BACKEND_URL. Configure a production HTTPS backend URL before running the app.');
  }
  const url = BACKEND_URL.replace(/\/$/, '');
  warnIfEphemeral(url);
  return url;
};

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

/**
 * POSTs to the backend with the caller's Firebase ID token attached. Endpoints
 * that mint RTC tokens or read private data require this.
 */
export const authedPost = async <T>(path: string, body: Record<string, unknown> = {}): Promise<T> => {
  const user = auth.currentUser;
  if (!user) throw new Error('You must be logged in.');

  const idToken = await user.getIdToken();
  const response = await fetch(`${getBackendUrl()}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(body),
  });

  const data = await safeParseJson(response, `Request to ${path} failed`);
  if (!response.ok) {
    const error = new Error(data.error || `Request to ${path} failed`);
    (error as any).code = data.code;
    (error as any).status = response.status;
    throw error;
  }
  return data as T;
};

export const authedGet = async <T>(path: string): Promise<T> => {
  const user = auth.currentUser;
  if (!user) throw new Error('You must be logged in.');

  const idToken = await user.getIdToken();
  const response = await fetch(`${getBackendUrl()}${path}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });

  const data = await safeParseJson(response, `Request to ${path} failed`);
  if (!response.ok) {
    const error = new Error(data.error || `Request to ${path} failed`);
    (error as any).status = response.status;
    throw error;
  }
  return data as T;
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
  await secureSet(SESSION_PHONE_KEY, phoneNumber);
};

export const clearAuthSession = async () => {
  await secureDelete(SESSION_PHONE_KEY);
};

export const restoreAuthSession = async (): Promise<User | null> => {
  return null;
};

export const sendOTP = async (phoneNumber: string): Promise<void> => {
  try {
    const cleanPhone = phoneNumber.replace(/\s+/g, '');
    const formattedPhone = cleanPhone.startsWith('+') ? cleanPhone : `+91${cleanPhone}`;
    logDebugEvent('auth.sendOtp.start', { backendUrl: getBackendUrl() });
    
    const response = await fetch(`${getBackendUrl()}/api/v1/auth/send-otp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Bypass-Tunnel-Reminder': 'true' // Bypass localtunnel warning page
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      const data = await safeParseJson(response, 'Failed to send OTP');
      logDebugEvent('auth.sendOtp.httpError', { status: response.status, response: data }, 'warn');
      throw new Error(data.error || 'Failed to send OTP');
    }
    logDebugEvent('auth.sendOtp.success', {});
  } catch (error) {
    logDebugEvent('auth.sendOtp.failed', { backendUrl: BACKEND_URL || 'missing', error }, 'error');
    console.error("Error sending Fast2SMS OTP", error);
    throw error;
  }
};

export const checkUsernameAvailable = async (username: string, excludeUid?: string): Promise<boolean> => {
  const response = await fetch(`${getBackendUrl()}/api/v1/auth/check-username`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: username.trim().toLowerCase(), excludeUid }),
  });

  if (!response.ok) {
    const data = await safeParseJson(response, 'Failed to check username');
    throw new Error(data.error || 'Failed to check username');
  }

  const data = await safeParseJson(response, 'Failed to check username');
  return data.available;
};

export const checkUserExists = async (phoneNumber: string): Promise<boolean> => {
  try {
    const cleanPhone = phoneNumber.replace(/\s+/g, '');
    const formattedPhone = cleanPhone.startsWith('+') ? cleanPhone : `+91${cleanPhone}`;
    logDebugEvent('auth.checkUser.start', { backendUrl: getBackendUrl() });
    
    const response = await fetch(`${getBackendUrl()}/api/v1/auth/check-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Bypass-Tunnel-Reminder': 'true'
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      const data = await safeParseJson(response, 'Failed to check user');
      logDebugEvent('auth.checkUser.httpError', { status: response.status, response: data }, 'warn');
      throw new Error(data.error || 'Failed to check user');
    }
    
    const data = await safeParseJson(response, 'Failed to check user');
    logDebugEvent('auth.checkUser.success', { exists: data.exists });
    return data.exists;
  } catch (error) {
    logDebugEvent('auth.checkUser.failed', { backendUrl: BACKEND_URL || 'missing', error }, 'error');
    console.error("Error checking user existence", error);
    throw error;
  }
};

export const verifyOTP = async (phoneNumber: string, code: string, authMode: 'signup' | 'login'): Promise<{user?: User, token?: string}> => {
  try {
    const cleanPhone = phoneNumber.replace(/\s+/g, '');
    const formattedPhone = cleanPhone.startsWith('+') ? cleanPhone : `+91${cleanPhone}`;
    logDebugEvent('auth.verifyOtp.start', { authMode, backendUrl: getBackendUrl() });

    const response = await fetch(`${getBackendUrl()}/api/v1/auth/verify-otp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Bypass-Tunnel-Reminder': 'true'
      },
      body: JSON.stringify({ otp: code }),
    });

    if (!response.ok) {
      const data = await safeParseJson(response, 'Invalid OTP');
      logDebugEvent('auth.verifyOtp.httpError', { authMode, status: response.status, response: data }, 'warn');
      throw new Error(data.error || 'Invalid OTP');
    }

    const data = await safeParseJson(response, 'Failed to verify OTP');
    const token = data.token;

    if (authMode === 'login') {
      const userCredential = await signInWithCustomToken(auth, token);
      setDebugContext({ userId: userCredential.user.uid });
      logDebugEvent('auth.verifyOtp.loginSuccess', { uid: userCredential.user.uid });
      return { user: userCredential.user };
    } else {
      // In signup mode, just return the token so we can login at the VERY end
      logDebugEvent('auth.verifyOtp.signupTokenSuccess', {});
      return { token };
    }
  } catch (error) {
    logDebugEvent('auth.verifyOtp.failed', { authMode, backendUrl: BACKEND_URL || 'missing', error }, 'error');
    console.error("Error verifying Fast2SMS OTP", error);
    throw error;
  }
};

export const loginWithPassword = async (phoneNumber: string, password: string, persistSession = true): Promise<{user?: User, token?: string}> => {
  try {
    const cleanPhone = phoneNumber.replace(/\s+/g, '');
    const formattedPhone = cleanPhone.startsWith('+') ? cleanPhone : `+91${cleanPhone}`;
    logDebugEvent('auth.loginPassword.start', { persistSession, backendUrl: getBackendUrl() });

    const response = await fetch(`${getBackendUrl()}/api/v1/auth/login-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Bypass-Tunnel-Reminder': 'true'
      },
      body: JSON.stringify({ password }),
    });

    if (!response.ok) {
      const data = await safeParseJson(response, 'Invalid credentials');
      logDebugEvent('auth.loginPassword.httpError', { status: response.status, response: data }, 'warn');
      throw new Error(data.error || 'Invalid credentials');
    }

    const data = await safeParseJson(response, 'Failed to login with password');
    const token = data.token;
    const userCredential = await signInWithCustomToken(auth, token);
    setDebugContext({ userId: userCredential.user.uid });
    if (persistSession) {
      await saveAuthSession(formattedPhone, password);
    }
    logDebugEvent('auth.loginPassword.success', { uid: userCredential.user.uid, persisted: persistSession });
    return { user: userCredential.user, token };
  } catch (error) {
    logDebugEvent('auth.loginPassword.failed', { persistSession, backendUrl: BACKEND_URL || 'missing', error }, 'error');
    console.error("Error logging in with password", error);
    throw error;
  }
};

export const setAccountPassword = async (password: string): Promise<void> => {
  const user = auth.currentUser;
  if (!user) throw new Error('You must be logged in to set a password.');

  const idToken = await user.getIdToken();
  const response = await fetch(`${getBackendUrl()}/api/v1/auth/set-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ password }),
  });

  if (!response.ok) {
    const data = await safeParseJson(response, 'Failed to set password');
    throw new Error(data.error || 'Failed to set password');
  }
};

/**
 * Deletes server-held account data (credentials, private profile, pending call
 * offers) that security rules keep out of the client's reach.
 */
/**
 * Deletes all server-held account data. Throws on failure — deliberately.
 *
 * This used to swallow its own error, so a failed purge was indistinguishable
 * from a successful one and the caller went on to delete the auth record
 * anyway, stranding the data with no owner left to remove it.
 */
export const purgeAccountData = async () => {
  await authedPost('/api/v1/auth/delete-account');
};

export const logout = async () => {
  try {
    logDebugEvent('auth.logout.start', {});
    await clearAuthSession();
    await auth.signOut();
    setDebugContext({ userId: null });
    logDebugEvent('auth.logout.success', {});
  } catch (error) {
    logDebugEvent('auth.logout.failed', { error }, 'error');
    console.error("Error logging out", error);
    throw error;
  }
};
