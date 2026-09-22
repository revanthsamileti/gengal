import { signInWithCustomToken, User } from 'firebase/auth';
import { auth } from '../config/firebase';
import { getBackendUrl } from './authService';
import { logDebugEvent, setDebugContext } from './debugLogger';

/**
 * Reverse-OTP sign-in: the user proves a number by sending a code FROM it, by
 * SMS (forwarded by the gateway phone) or WhatsApp (delivered by Meta). The
 * backend matches the message; this module only starts a session, polls it,
 * and exchanges the resulting custom token.
 */

export type SignInChannel = 'whatsapp' | 'sms';

export type SmsSession = {
  sessionId: string;
  code: string;
  /** Exactly what the user must text, e.g. "GENGAL 482913". */
  message: string;
  /** Where to text it. Empty when SMS is not on offer (or in local dev bypass). */
  gatewayNumber: string;
  /** Where to WhatsApp it. Empty when WhatsApp is not on offer. */
  whatsappNumber?: string;
  /** What the server can receive right now, best first. Absent from older servers. */
  channels?: SignInChannel[];
  expiresIn: number;
};

/** Why a session is still pending, when the server knows. */
export type SmsPendingHint = 'sender_mismatch' | 'share_number';

export type SmsPollResult =
  | { status: 'pending'; expiresIn: number; hint?: SmsPendingHint }
  | { status: 'expired' }
  | { status: 'verified'; token: string; isNewUser: boolean }
  /** Transient (network, throttle, 5xx): keep polling until the deadline. */
  | { status: 'retry' };

export class SmsAuthError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'SmsAuthError';
    this.code = code;
  }
}

const postJson = (path: string, body: Record<string, unknown>) =>
  fetch(`${getBackendUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const startErrorMessage = (status: number, code: string): string => {
  if (code === 'invalid_phone') return 'Enter a valid Indian mobile number.';
  if (code === 'rate_limited' || status === 429) return 'Too many attempts. Please try again in a few minutes.';
  if (code === 'sms_gateway_offline') return 'Sign-in is down for a few minutes. Please try again shortly.';
  return 'Sign-in is temporarily unavailable. Please try again.';
};

export const startSmsVerification = async (phone: string): Promise<SmsSession> => {
  let response: Response;
  try {
    response = await postJson('/api/v1/auth/sms/start', { phone });
  } catch {
    throw new SmsAuthError('Sign-in is temporarily unavailable. Check your connection.', 'network');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code: string = data?.code || `http_${response.status}`;
    logDebugEvent('auth.sms.start.failed', { status: response.status, code }, 'warn');
    throw new SmsAuthError(startErrorMessage(response.status, code), code);
  }
  logDebugEvent('auth.sms.start.ok', {});
  const session = data as SmsSession;
  // An older server sends no channel list: it only ever offered SMS.
  if (!Array.isArray(session.channels)) session.channels = session.gatewayNumber ? ['sms'] : [];
  return session;
};

/** Opens WhatsApp with the message typed, addressed to our business number. */
export const whatsappLink = (number: string, message: string) =>
  `https://wa.me/${number.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;

export const pollSmsVerification = async (sessionId: string): Promise<SmsPollResult> => {
  try {
    const response = await postJson('/api/v1/auth/sms/status', { sessionId });
    if (!response.ok) return { status: 'retry' };
    const data = await response.json();
    if (data?.status === 'verified' && typeof data.token === 'string') {
      return { status: 'verified', token: data.token, isNewUser: Boolean(data.isNewUser) };
    }
    if (data?.status === 'pending') {
      const hint = data.hint === 'sender_mismatch' || data.hint === 'share_number' ? data.hint : undefined;
      return { status: 'pending', expiresIn: Number(data.expiresIn) || 0, hint };
    }
    if (data?.status === 'expired') return { status: 'expired' };
    return { status: 'retry' };
  } catch {
    return { status: 'retry' };
  }
};

export const signInWithSmsToken = async (token: string): Promise<User> => {
  const credential = await signInWithCustomToken(auth, token);
  setDebugContext({ userId: credential.user.uid });
  logDebugEvent('auth.sms.signedIn', { uid: credential.user.uid });
  return credential.user;
};
