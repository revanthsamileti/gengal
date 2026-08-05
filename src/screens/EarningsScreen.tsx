import { Alert } from '../components/CustomAlert';
import React, { useEffect, useRef, useState } from 'react';
import { Platform, View, Text, StyleSheet, TouchableOpacity, ScrollView, Animated } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import ScreenShell from '../components/ScreenShell';
import { auth, db } from '../config/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { getGlobalSettings, GlobalSettings } from '../services/adminService';
import { requestWithdrawal } from '../services/withdrawalService';
import { useActionLock } from '../hooks/useActionLock';
import { tap40 } from '../theme/touch';

export default function EarningsScreen({ navigate, goBack }: any) {
  const [profile, setProfile] = useState<any>(null);
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const { locked: isSubmitting, run } = useActionLock();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start();

    const user = auth.currentUser;
    if (!user) return;
    const unsub = onSnapshot(doc(db, 'users', user.uid), (snap) => {
      if (snap.exists()) setProfile(snap.data());
    });
    getGlobalSettings().then(setSettings);
    return unsub;
  }, []);

  const hearts = profile?.hearts || 0;
  const rate = settings?.heartToInrRate || 3;
  const earnings = hearts * rate;
  const totalMinutes = Math.floor((profile?.totalReceivedCallSeconds || 0) / 60);
  const unrewarded = profile?.unrewardedCallSeconds || 0;
  const targetSeconds = (settings?.callDurationForHeart || 3) * 60;
  const progressPercent = Math.min((unrewarded / targetSeconds) * 100, 100);
  const canWithdraw = hearts >= 33;
  const minWithdraw = 33 * rate;

  const handleWithdraw = () =>
    run(async () => {
      try {
        await requestWithdrawal(hearts, earnings);
        Alert.alert(
          'Request submitted',
          `Your withdrawal request for ₹${earnings.toFixed(2)} has been recorded and is pending review. You'll be notified once it's processed.`,
          [{ text: 'OK' }]
        );
      } catch (e: any) {
        Alert.alert(
          'Could not submit request',
          e?.message || 'Something went wrong. Please try again.',
          [{ text: 'OK' }]
        );
      }
    });

  return (
    <ScreenShell tone="light">
      <View style={styles.phone}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} hitSlop={tap40} onPress={() => goBack ? goBack() : navigate('Home')}
            accessibilityRole="button"
            accessibilityLabel="Go back">
            <MaterialIcons name="arrow-back" size={22} color="#4B0054" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Earnings</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>

            {/* Balance Hero */}
            <LinearGradient colors={['#3B0044', '#7B0085']} style={styles.hero}>
              <Text style={styles.heroLabel}>TOTAL BALANCE</Text>
              <Text style={styles.heroAmount}>₹{earnings.toFixed(2)}</Text>
              <View style={styles.heroChipRow}>
                <View style={styles.heroChip}>
                  <MaterialIcons name="favorite" size={13} color="#C9504B" />
                  <Text style={styles.heroChipText}>{hearts} Hearts</Text>
                </View>
                <Text style={styles.heroRate}>× ₹{rate}/heart</Text>
              </View>
            </LinearGradient>

            {/* Stats row */}
            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <MaterialIcons name="timer" size={26} color="#D49A0B" />
                <Text style={styles.statValue}>{totalMinutes}m</Text>
                <Text style={styles.statLabel}>Talk Time</Text>
              </View>
              <View style={styles.statCard}>
                <MaterialIcons name="favorite" size={26} color="#C9504B" />
                <Text style={styles.statValue}>{hearts}</Text>
                <Text style={styles.statLabel}>Hearts</Text>
              </View>
              <View style={styles.statCard}>
                <MaterialIcons name="account-balance-wallet" size={26} color="#4B0054" />
                <Text style={styles.statValue}>₹{(hearts * rate).toFixed(0)}</Text>
                <Text style={styles.statLabel}>Earned</Text>
              </View>
            </View>

            {/* Heart Progress */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <MaterialIcons name="auto-awesome" size={18} color="#D49A0B" />
                <Text style={styles.cardTitle}>Next Heart Progress</Text>
              </View>
              <Text style={styles.cardSub}>
                {Math.round(unrewarded)}s of {targetSeconds}s spoken for next heart
              </Text>
              <View style={styles.progressBg}>
                <Animated.View style={[styles.progressFill, { width: `${progressPercent}%` as any }]} />
              </View>
              <Text style={styles.progressPct}>{Math.round(progressPercent)}%</Text>
            </View>

            {/* How it works */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <MaterialIcons name="info-outline" size={18} color="#4B0054" />
                <Text style={styles.cardTitle}>How Earnings Work</Text>
              </View>
              {[
                ['Every 3 min of received calls = 1 Heart', 'timer'],
                [`1 Heart = ₹${rate} in earnings`, 'favorite'],
                ['Minimum withdrawal: 33 Hearts (₹' + minWithdraw.toFixed(0) + ')', 'account-balance'],
                ['Paid to your UPI or bank within 24h', 'payments'],
              ].map(([text, icon]) => (
                <View key={text} style={styles.infoRow}>
                  <MaterialIcons name={icon as any} size={15} color="#9A7A05" />
                  <Text style={styles.infoText}>{text}</Text>
                </View>
              ))}
            </View>

            {/* Withdraw */}
            <View style={styles.withdrawCard}>
              <Text style={styles.withdrawTitle}>Withdraw Funds</Text>
              <Text style={styles.withdrawSub}>
                {canWithdraw
                  ? `₹${earnings.toFixed(2)} available to withdraw`
                  : `Need ${33 - hearts} more hearts to reach minimum (₹${minWithdraw.toFixed(0)})`}
              </Text>
              <TouchableOpacity
                style={[styles.withdrawBtn, (!canWithdraw || isSubmitting) && styles.withdrawBtnOff]}
                activeOpacity={0.82}
                onPress={handleWithdraw}
                disabled={!canWithdraw || isSubmitting}
                accessibilityRole="button"
                accessibilityLabel={`Withdraw ${earnings.toFixed(2)} rupees`}
                accessibilityState={{ disabled: !canWithdraw || isSubmitting }}
              >
                <MaterialIcons name="payments" size={18} color={canWithdraw && !isSubmitting ? '#FFFDF8' : '#C0B0C4'} />
                <Text style={[styles.withdrawBtnText, (!canWithdraw || isSubmitting) && { color: '#C0B0C4' }]}>
                  {isSubmitting ? 'Submitting…' : `Withdraw ₹${earnings.toFixed(2)}`}
                </Text>
              </TouchableOpacity>
            </View>

          </Animated.View>
        </ScrollView>
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  phone: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: 430 },
  header: {
    height: 60, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 16,
    backgroundColor: '#FFFDF8', borderBottomWidth: 1, borderBottomColor: '#EAD8A9',
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '900', color: '#4B0054', fontFamily: 'serif' },
  scroll: { padding: 16, paddingBottom: 60 },

  hero: {
    borderRadius: 22, padding: 28, alignItems: 'center', marginBottom: 16,
    boxShadow: Platform.OS === 'web' ? '0 8px 24px rgba(75,0,84,0.3)' : undefined,
  },
  heroLabel: { color: 'rgba(255,253,248,0.6)', fontSize: 10, fontWeight: '900', letterSpacing: 2, marginBottom: 8 },
  heroAmount: { color: '#FFFDF8', fontSize: 52, fontWeight: '900', letterSpacing: -1, marginBottom: 14 },
  heroChipRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heroChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(255,253,248,0.15)', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12,
  },
  heroChipText: { color: '#FFFDF8', fontSize: 13, fontWeight: '800' },
  heroRate: { color: 'rgba(255,253,248,0.55)', fontSize: 12, fontWeight: '600' },

  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  statCard: {
    flex: 1, backgroundColor: '#FFFDF8', borderRadius: 18, padding: 16, alignItems: 'center',
    borderWidth: 1, borderColor: '#EAD8A9',
    boxShadow: Platform.OS === 'web' ? '0 2px 8px rgba(68,44,21,0.06)' : undefined,
  },
  statValue: { fontSize: 22, fontWeight: '900', color: '#4B0054', marginTop: 6, marginBottom: 2 },
  statLabel: { fontSize: 11, color: '#9A8772', fontWeight: '700' },

  card: {
    backgroundColor: '#FFFDF8', borderRadius: 18, padding: 18, marginBottom: 14,
    borderWidth: 1, borderColor: '#EAD8A9',
    boxShadow: Platform.OS === 'web' ? '0 2px 8px rgba(68,44,21,0.06)' : undefined,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  cardTitle: { fontSize: 15, fontWeight: '800', color: '#4B0054' },
  cardSub: { fontSize: 12, color: '#8A7C70', fontWeight: '600', marginBottom: 12 },
  progressBg: { height: 10, backgroundColor: '#EEE4D8', borderRadius: 5, overflow: 'hidden', marginBottom: 6 },
  progressFill: { height: '100%', borderRadius: 5, backgroundColor: '#D49A0B' },
  progressPct: { fontSize: 11, fontWeight: '800', color: '#9A7A05', textAlign: 'right' },

  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  infoText: { fontSize: 13, color: '#5C3B23', fontWeight: '600', flex: 1 },

  withdrawCard: {
    backgroundColor: '#FFF7DD', borderRadius: 18, padding: 20, marginBottom: 14,
    borderWidth: 1, borderColor: '#EAD691',
    boxShadow: Platform.OS === 'web' ? '0 2px 8px rgba(68,44,21,0.06)' : undefined,
  },
  withdrawTitle: { fontSize: 18, fontWeight: '900', color: '#4B0054', fontFamily: 'serif', marginBottom: 6 },
  withdrawSub: { fontSize: 13, color: '#7A6808', fontWeight: '600', marginBottom: 18, lineHeight: 18 },
  withdrawBtn: {
    height: 52, borderRadius: 14, backgroundColor: '#4B0054',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    boxShadow: Platform.OS === 'web' ? '0 6px 14px rgba(75,0,84,0.25)' : undefined,
  },
  withdrawBtnOff: { backgroundColor: '#EDE8F0' },
  withdrawBtnText: { color: '#FFFDF8', fontSize: 15, fontWeight: '900' },
});
