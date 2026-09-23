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
  const [manualOpen, setManualOpen] = useState(false);
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

  const steps = [
    onWhatsApp ? 'Tap Send on WhatsApp' : 'Tap Send SMS',
    'Send the message that opens — it is already written for you',
    'You are signed in automatically, with no code to type',
  ];

  return (
    <ScreenShell tone="light">
      <View style={styles.container}>
        <Pressable onPress={goBack} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Go back">
          <MaterialIcons name="arrow-back" size={24} color={PLUM} />
        </Pressable>

        <Text style={styles.title}>Verify your number</Text>
        <View style={styles.phoneRow}>
          <Text style={styles.phone}>{formatPhone(phone)}</Text>
          <Pressable onPress={goBack} accessibilityRole="button" hitSlop={10}>
            <Text style={styles.change}>Change</Text>
          </Pressable>
        </View>

        {phase === 'starting' && (
          <View style={styles.centered}>
            <ActivityIndicator color={PLUM} />
            <Text style={styles.waitText}>Getting your code…</Text>
          </View>
        )}

        {phase === 'waiting' && session && (
          <View>
            {/* Signing in by sending a message is unfamiliar enough that the
                screen has to say what will happen before it shows a code or a
                number. Those moved below, under "Send it yourself instead". */}
            <View style={styles.steps}>
              {steps.map((text, i) => (
                <View key={i} style={styles.stepRow}>
                  <View style={styles.stepDot}>
                    <Text style={styles.stepNum}>{i + 1}</Text>
                  </View>
                  <Text style={styles.stepText}>{text}</Text>
                </View>
              ))}
            </View>

            {onWhatsApp && (
              <Pressable
                onPress={openWhatsApp}
                style={({ pressed }) => [styles.primaryBtn, styles.whatsappBtn, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Send the verification message on WhatsApp"
              >
                <MaterialCommunityIcons name="whatsapp" size={24} color="#fff" />
                <Text style={styles.primaryText}>Send on WhatsApp</Text>
              </Pressable>
            )}

            {bySms && smsAvailable ? (
              <Pressable
                onPress={openComposer}
                style={({ pressed }) => [
                  onWhatsApp ? styles.secondaryBtn : styles.primaryBtn,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Send the verification message by SMS"
              >
                <MaterialIcons name="sms" size={20} color={onWhatsApp ? PLUM : '#fff'} />
                <Text style={onWhatsApp ? styles.secondaryText : styles.primaryText}>Send SMS</Text>
              </Pressable>
            ) : null}

            <View style={styles.waitRow}>
              <ActivityIndicator color={PLUM} size="small" />
              <Text style={styles.waitText}>Waiting for your message</Text>
              <Text style={styles.clock}>{formatClock(secondsLeft)}</Text>
            </View>

            {hint ? <Text style={styles.notice}>{hintText(hint, phone)}</Text> : null}
            {notice ? <Text style={styles.notice}>{notice}</Text> : null}

            {/* Still reachable for a phone without WhatsApp, a dual-SIM
                handset, or someone typing it on another device. */}
            <Pressable
              onPress={() => setManualOpen((v) => !v)}
              style={styles.manualToggle}
              accessibilityRole="button"
              accessibilityState={{ expanded: manualOpen }}
            >
              <Text style={styles.manualToggleText}>Send it yourself instead</Text>
              <MaterialIcons name={manualOpen ? 'expand-less' : 'expand-more'} size={20} color={PLUM} />
            </Pressable>

            {manualOpen && (
              <View style={styles.card}>
                <Text style={styles.label}>Message</Text>
                <View style={styles.codeRow}>
                  <Text style={styles.code} selectable accessibilityLabel={`Message ${session.message}`}>
                    {session.message}
                  </Text>
                  <Pressable onPress={copyMessage} accessibilityRole="button" accessibilityLabel="Copy message" hitSlop={10}>
                    <MaterialIcons name={copied ? 'check' : 'content-copy'} size={22} color={copied ? '#15803D' : PLUM} />
                  </Pressable>
                </View>
                {sameNumber ? (
                  <>
                    <Text style={styles.label}>Send to</Text>
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
                <Text style={styles.fine}>
                  Send it from {formatPhone(phone)}, the number you are verifying. {finePrint}
                </Text>
              </View>
            )}
          </View>
        )}

        {phase === 'signingIn' && (
          <View style={styles.centered}>
            <ActivityIndicator color={PLUM} />
            <Text style={styles.waitText}>Signing you in…</Text>
          </View>
        )}

        {phase === 'verified' && (
          <View style={styles.centered}>
            <View style={styles.tick}>
              <MaterialIcons name="check" size={34} color="#fff" />
            </View>
            <Text style={styles.verified}>Number verified</Text>
            <Pressable
              onPress={() => navigate('ProfileDetails', { phone, token: newUserToken.current })}
              style={({ pressed }) => [styles.primaryBtn, styles.wide, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.primaryText}>Continue</Text>
            </Pressable>
          </View>
        )}

        {(phase === 'expired' || phase === 'error') && (
          <View>
            <Text style={styles.error}>
              {phase === 'expired'
                ? 'That code expired before your message arrived. A new one lasts ten minutes.'
                : errorMsg}
            </Text>
            <Pressable
              onPress={begin}
              disabled={locked}
              style={({ pressed }) => [styles.primaryBtn, locked && styles.disabled, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.primaryText}>Get a new code</Text>
            </Pressable>
          </View>
        )}
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  backBtn: { width: 44, height: 44, justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '800', color: PLUM, fontFamily: 'serif', marginTop: 4 },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6, marginBottom: 26 },
  phone: { fontSize: 16, fontWeight: '700', color: '#2B1B2B' },
  change: { fontSize: 14, color: PLUM, textDecorationLine: 'underline' },

  steps: { gap: 14, marginBottom: 26 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  stepDot: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: '#F3E4F3',
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  stepNum: { fontSize: 13, fontWeight: '800', color: PLUM },
  stepText: { flex: 1, fontSize: 15, lineHeight: 21, color: '#3B2B3B' },

  primaryBtn: {
    flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: PLUM, borderRadius: 16, paddingVertical: 16, marginTop: 10,
  },
  whatsappBtn: { backgroundColor: WHATSAPP_GREEN },
  primaryText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  secondaryBtn: {
    flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center',
    borderRadius: 16, paddingVertical: 15, marginTop: 12, borderWidth: 1.5, borderColor: PLUM,
  },
  secondaryText: { color: PLUM, fontSize: 17, fontWeight: '700' },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.6 },
  wide: { alignSelf: 'stretch' },

  waitRow: { flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center', marginTop: 24 },
  waitText: { fontSize: 15, color: '#4B3B4B' },
  clock: {
    fontSize: 13, fontWeight: '700', color: '#8A6F8A',
    backgroundColor: '#F6EEF6', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2,
  },
  notice: { fontSize: 13, color: '#B45309', marginTop: 12, textAlign: 'center', lineHeight: 18 },

  manualToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    marginTop: 26, paddingVertical: 10,
  },
  manualToggleText: { fontSize: 14, fontWeight: '600', color: PLUM },
  card: {
    backgroundColor: '#FFFFFF', borderRadius: 16, padding: 18,
    borderWidth: 1, borderColor: '#EADCEA',
  },
  label: {
    fontSize: 12, fontWeight: '700', color: '#8A6F8A',
    textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 10,
  },
  codeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 6 },
  code: { fontSize: 24, fontWeight: '800', color: PLUM, letterSpacing: 1.5 },
  to: { fontSize: 17, fontWeight: '600', color: '#2B1B2B', marginTop: 4 },
  fine: { fontSize: 12, color: '#8A6F8A', marginTop: 14, lineHeight: 17 },

  centered: { alignItems: 'center', gap: 14, marginTop: 40 },
  tick: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: '#15803D',
    alignItems: 'center', justifyContent: 'center',
  },
  verified: { fontSize: 20, fontWeight: '800', color: PLUM, fontFamily: 'serif' },
  error: { fontSize: 15, color: '#DC2626', marginTop: 30, marginBottom: 10, textAlign: 'center', lineHeight: 21 },
});
