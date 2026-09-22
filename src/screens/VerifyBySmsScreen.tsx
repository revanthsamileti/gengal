import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as SMS from 'expo-sms';
import ScreenShell from '../components/ScreenShell';
import { useActionLock } from '../hooks/useActionLock';
import {
  pollSmsVerification,
  signInWithSmsToken,
  SmsAuthError,
  SmsPendingHint,
  SmsSession,
  startSmsVerification,
  whatsappLink,
} from '../services/smsAuthService';

const POLL_INTERVAL_MS = 2000;
const PLUM = '#5A155A';
// WhatsApp's teal green: recognisable, and dark enough for white text.
const WHATSAPP_GREEN = '#128C7E';

type Phase = 'starting' | 'waiting' | 'expired' | 'error' | 'signingIn' | 'verified';

type Props = {
  navigate: (screen: string, params?: any) => void;
  goBack: () => void;
  // The index signature matches App.tsx's NavigationParams; without it TS
  // rejects the router's params as sharing no property with this type.
  route?: { params?: { phone?: string; [key: string]: unknown } };
};

const formatPhone = (p: string) => (p.length === 13 ? `${p.slice(0, 3)} ${p.slice(3, 8)} ${p.slice(8)}` : p);
const formatClock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

const hintText = (hint: SmsPendingHint, phone: string) =>
  hint === 'share_number'
    ? 'Almost done: tap “Share phone number” in WhatsApp.'
    : `That message came from a different number. Send it from the WhatsApp or SIM of ${formatPhone(phone)}.`;

export default function VerifyBySmsScreen({ navigate, goBack, route }: Props) {
  const phone = route?.params?.phone ?? '';
  const [phase, setPhase] = useState<Phase>('starting');
  const [session, setSession] = useState<SmsSession | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [notice, setNotice] = useState('');
  const [hint, setHint] = useState<SmsPendingHint | undefined>();
  const [smsAvailable, setSmsAvailable] = useState(false);
  const [copied, setCopied] = useState(false);
  const { locked, run } = useActionLock();

  const sessionRef = useRef<SmsSession | null>(null);
  const deadlineRef = useRef(0);
  const pollInFlight = useRef(false);
  const finished = useRef(false);
  const newUserToken = useRef<string | null>(null);

  useEffect(() => {
    SMS.isAvailableAsync().then(setSmsAvailable).catch(() => setSmsAvailable(false));
  }, []);

  const begin = useCallback(
    () =>
      run(async () => {
        finished.current = false;
        newUserToken.current = null;
        setErrorMsg('');
        setNotice('');
        setHint(undefined);
        setPhase('starting');
        try {
          const s = await startSmsVerification(phone);
          sessionRef.current = s;
          deadlineRef.current = Date.now() + s.expiresIn * 1000;
          setSession(s);
          setSecondsLeft(s.expiresIn);
          setPhase('waiting');
        } catch (e) {
          sessionRef.current = null;
          setSession(null);
          setErrorMsg(e instanceof SmsAuthError ? e.message : 'Sign-in is temporarily unavailable.');
          setPhase('error');
        }
      }),
    [phone, run]
  );

  useEffect(() => {
    begin();
    // Start exactly once on mount; Try again calls begin() itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pollOnce = useCallback(async () => {
    const s = sessionRef.current;
    if (!s || pollInFlight.current || finished.current) return;
    if (Date.now() >= deadlineRef.current) {
      sessionRef.current = null;
      setPhase('expired');
      return;
    }
    pollInFlight.current = true;
    try {
      const result = await pollSmsVerification(s.sessionId);
      if (sessionRef.current !== s || finished.current) return;
      if (result.status === 'pending') {
        setHint(result.hint);
      } else if (result.status === 'expired') {
        sessionRef.current = null;
        setPhase('expired');
      } else if (result.status === 'verified') {
        finished.current = true;
        sessionRef.current = null;
        if (result.isNewUser) {
          newUserToken.current = result.token;
          setPhase('verified');
          navigate('ProfileDetails', { phone, token: result.token });
        } else {
          setPhase('signingIn');
          try {
            // App.tsx's onAuthStateChanged resets the stack to Home.
            await signInWithSmsToken(result.token);
          } catch {
            finished.current = false;
            setErrorMsg('Could not finish signing in. Please try again.');
            setPhase('error');
          }
        }
      }
    } finally {
      pollInFlight.current = false;
    }
  }, [navigate, phone]);

  useEffect(() => {
    if (phase !== 'waiting') return;
    const poll = setInterval(pollOnce, POLL_INTERVAL_MS);
    const tick = setInterval(() => {
      setSecondsLeft(Math.max(0, Math.round((deadlineRef.current - Date.now()) / 1000)));
    }, 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [phase, pollOnce]);

  // The user leaves for WhatsApp or the SMS app mid-flow, and JS timers can be
  // suspended in the background. Check the moment they come back.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') pollOnce();
    });
    return () => sub.remove();
  }, [pollOnce]);

  const openWhatsApp = async () => {
    const s = sessionRef.current;
    if (!s?.whatsappNumber) return;
    setNotice('');
    try {
      await Linking.openURL(whatsappLink(s.whatsappNumber, s.message));
    } catch {
      setNotice(`Could not open WhatsApp. Send the message above to ${formatPhone(s.whatsappNumber)} yourself.`);
    }
  };

  const openComposer = async () => {
    const s = sessionRef.current;
    if (!s) return;
    try {
      const { result } = await SMS.sendSMSAsync([s.gatewayNumber], s.message);
      setNotice(result === 'cancelled' ? 'SMS not sent. Tap Send SMS to try again.' : '');
      pollOnce();
    } catch {
      setNotice('Could not open your SMS app. Send the text above yourself.');
    }
  };

  const copyMessage = async () => {
    if (!session) return;
    await Clipboard.setStringAsync(session.message);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const channels = session?.channels ?? [];
  const onWhatsApp = channels.includes('whatsapp') && Boolean(session?.whatsappNumber);
  const bySms = channels.includes('sms') && Boolean(session?.gatewayNumber);
  const sameNumber = onWhatsApp && bySms && session?.whatsappNumber === session?.gatewayNumber;
  const finePrint =
    onWhatsApp && bySms
      ? 'WhatsApp is free on data. SMS may cost your operator’s standard rate.'
      : bySms
        ? 'Your operator’s standard SMS charge may apply.'
        : 'Uses WhatsApp over your mobile data or Wi‑Fi.';

  return (
    <ScreenShell tone="light">
      <View style={styles.container}>
        <Pressable onPress={goBack} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Go back">
          <MaterialIcons name="arrow-back" size={24} color={PLUM} />
        </Pressable>

        <Text style={styles.title}>Verify your number</Text>
        <Text style={styles.subtitle}>
          Send one message from {formatPhone(phone)} to confirm it's yours.
        </Text>

        {phase === 'starting' && <ActivityIndicator color={PLUM} style={styles.spinner} />}

        {phase === 'waiting' && session && (
          <View>
            <View style={styles.card}>
              <Text style={styles.label}>Send this</Text>
              <View style={styles.codeRow}>
                <Text style={styles.code} selectable accessibilityLabel={`Message ${session.message}`}>
                  {session.message}
                </Text>
                <Pressable onPress={copyMessage} accessibilityRole="button" accessibilityLabel="Copy message">
                  <MaterialIcons name={copied ? 'check' : 'content-copy'} size={22} color={PLUM} />
                </Pressable>
              </View>
              {sameNumber ? (
                <>
                  <Text style={styles.label}>To</Text>
                  <Text style={styles.to} selectable>{formatPhone(session.gatewayNumber)}</Text>
                </>
              ) : (
                <>
                  {onWhatsApp && (
                    <>
                      <Text style={styles.label}>On WhatsApp</Text>
                      <Text style={styles.to} selectable>{formatPhone(session.whatsappNumber ?? '')}</Text>
                    </>
                  )}
                  {bySms && (
                    <>
                      <Text style={styles.label}>By SMS</Text>
                      <Text style={styles.to} selectable>{formatPhone(session.gatewayNumber)}</Text>
                    </>
                  )}
                </>
              )}
            </View>

            {onWhatsApp && (
              <Pressable onPress={openWhatsApp} style={[styles.primaryBtn, styles.whatsappBtn]} accessibilityRole="button">
                <MaterialCommunityIcons name="whatsapp" size={22} color="#fff" />
                <Text style={styles.primaryText}>Send on WhatsApp</Text>
              </Pressable>
            )}

            {bySms &&
              (smsAvailable ? (
                <Pressable
                  onPress={openComposer}
                  style={onWhatsApp ? styles.secondaryBtn : styles.primaryBtn}
                  accessibilityRole="button"
                >
                  <MaterialIcons name="sms" size={20} color={onWhatsApp ? PLUM : '#fff'} />
                  <Text style={onWhatsApp ? styles.secondaryText : styles.primaryText}>Send SMS</Text>
                </Pressable>
              ) : (
                <Text style={styles.hint}>
                  {onWhatsApp ? 'Or, from' : 'From'} the phone with this SIM, text the message above to{' '}
                  {formatPhone(session.gatewayNumber)}.
                </Text>
              ))}

            {hint ? <Text style={styles.notice}>{hintText(hint, phone)}</Text> : null}
            {notice ? <Text style={styles.notice}>{notice}</Text> : null}

            <View style={styles.waitRow}>
              <ActivityIndicator color={PLUM} />
              <Text style={styles.waitText}>Waiting for your message… {formatClock(secondsLeft)}</Text>
            </View>
            <Text style={styles.fine}>{finePrint}</Text>
          </View>
        )}

        {phase === 'signingIn' && (
          <View style={styles.waitRow}>
            <ActivityIndicator color={PLUM} />
            <Text style={styles.waitText}>Signing you in…</Text>
          </View>
        )}

        {phase === 'verified' && (
          <Pressable
            onPress={() => navigate('ProfileDetails', { phone, token: newUserToken.current })}
            style={styles.primaryBtn}
            accessibilityRole="button"
          >
            <MaterialIcons name="check-circle" size={20} color="#fff" />
            <Text style={styles.primaryText}>Number verified — Continue</Text>
          </Pressable>
        )}

        {(phase === 'expired' || phase === 'error') && (
          <View>
            <Text style={styles.error}>
              {phase === 'expired' ? 'That code expired before your message arrived.' : errorMsg}
            </Text>
            <Pressable onPress={begin} disabled={locked} style={[styles.primaryBtn, locked && styles.disabled]} accessibilityRole="button">
              <Text style={styles.primaryText}>Try again</Text>
            </Pressable>
          </View>
        )}

        <Pressable onPress={goBack} accessibilityRole="button">
          <Text style={styles.link}>Wrong number? Change it</Text>
        </Pressable>
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24, paddingTop: 16 },
  backBtn: { width: 44, height: 44, justifyContent: 'center' },
  title: { fontSize: 26, fontWeight: '800', color: PLUM, marginTop: 8 },
  subtitle: { fontSize: 15, color: '#4B3B4B', marginTop: 6, marginBottom: 20 },
  spinner: { marginTop: 32 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 18, marginBottom: 16, borderWidth: 1, borderColor: '#EADCEA' },
  label: { fontSize: 12, fontWeight: '700', color: '#8A6F8A', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 6 },
  codeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 6 },
  code: { fontSize: 28, fontWeight: '800', color: PLUM, letterSpacing: 2 },
  to: { fontSize: 18, fontWeight: '600', color: '#2B1B2B', marginTop: 4 },
  primaryBtn: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: PLUM, borderRadius: 14, paddingVertical: 14, marginTop: 8 },
  whatsappBtn: { backgroundColor: WHATSAPP_GREEN },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  secondaryBtn: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 14, paddingVertical: 13, marginTop: 10, borderWidth: 1.5, borderColor: PLUM },
  secondaryText: { color: PLUM, fontSize: 16, fontWeight: '700' },
  disabled: { opacity: 0.6 },
  hint: { fontSize: 14, color: '#4B3B4B', marginTop: 10 },
  notice: { fontSize: 13, color: '#B45309', marginTop: 10, textAlign: 'center' },
  waitRow: { flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center', marginTop: 22 },
  waitText: { fontSize: 15, color: '#4B3B4B' },
  fine: { fontSize: 12, color: '#8A6F8A', textAlign: 'center', marginTop: 10 },
  error: { fontSize: 15, color: '#DC2626', marginBottom: 8, textAlign: 'center' },
  link: { fontSize: 14, color: PLUM, textAlign: 'center', marginTop: 24, textDecorationLine: 'underline' },
});
