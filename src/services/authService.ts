import { auth } from '../config/firebase';
import { 
  signInWithCustomToken,
  User,
} from 'firebase/auth';

import { Platform } from 'react-native';

const BACKEND_URL = Platform.OS === 'web' ? 'http://localhost:5000' : 'http://192.168.29.228:5000'; // Local backend URL

export const sendOTP = async (phoneNumber: string): Promise<void> => {
  try {
    const cleanPhone = phoneNumber.replace(/\s+/g, '');
    const formattedPhone = cleanPhone.startsWith('+') ? cleanPhone : `+1${cleanPhone}`;
    
    const response = await fetch(`${BACKEND_URL}/api/v1/auth/send-otp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Bypass-Tunnel-Reminder': 'true' // Bypass localtunnel warning page
      },
      body: JSON.stringify({ phone: formattedPhone }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to send OTP');
    }
  } catch (error) {
    console.error("Error sending Fast2SMS OTP", error);
    throw error;
  }
};

export const checkUserExists = async (phoneNumber: string): Promise<boolean> => {
  try {
    const cleanPhone = phoneNumber.replace(/\s+/g, '');
    const formattedPhone = cleanPhone.startsWith('+') ? cleanPhone : `+1${cleanPhone}`;
    
    const response = await fetch(`${BACKEND_URL}/api/v1/auth/check-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Bypass-Tunnel-Reminder': 'true'
      },
      body: JSON.stringify({ phone: formattedPhone }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to check user');
    }
    
    const data = await response.json();
    return data.exists;
  } catch (error) {
    console.error("Error checking user existence", error);
    throw error;
  }
};

export const verifyOTP = async (phoneNumber: string, code: string, authMode: 'signup' | 'login'): Promise<{user?: User, token?: string}> => {
  try {
    const cleanPhone = phoneNumber.replace(/\s+/g, '');
    const formattedPhone = cleanPhone.startsWith('+') ? cleanPhone : `+1${cleanPhone}`;

    const response = await fetch(`${BACKEND_URL}/api/v1/auth/verify-otp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Bypass-Tunnel-Reminder': 'true'
      },
      body: JSON.stringify({ phone: formattedPhone, otp: code }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Invalid OTP');
    }

    const data = await response.json();
    const token = data.token;

    if (authMode === 'login') {
      const userCredential = await signInWithCustomToken(auth, token);
      return { user: userCredential.user };
    } else {
      // In signup mode, just return the token so we can login at the VERY end
      return { token };
    }
  } catch (error) {
    console.error("Error verifying Fast2SMS OTP", error);
    throw error;
  }
};

export const loginWithPassword = async (phoneNumber: string, password: string): Promise<{user?: User, token?: string}> => {
  try {
    const cleanPhone = phoneNumber.replace(/\s+/g, '');
    const formattedPhone = cleanPhone.startsWith('+') ? cleanPhone : `+1${cleanPhone}`;

    const response = await fetch(`${BACKEND_URL}/api/v1/auth/login-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Bypass-Tunnel-Reminder': 'true'
      },
      body: JSON.stringify({ phone: formattedPhone, password }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Invalid credentials');
    }

    const data = await response.json();
    const token = data.token;
    const userCredential = await signInWithCustomToken(auth, token);
    return { user: userCredential.user, token };
  } catch (error) {
    console.error("Error logging in with password", error);
    throw error;
  }
};

export const logout = async () => {
  try {
    await auth.signOut();
  } catch (error) {
    console.error("Error logging out", error);
    throw error;
  }
};
