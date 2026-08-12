import { Alert } from '../components/CustomAlert';
import React, { useEffect, useState } from 'react';
import { Platform, ActivityIndicator, KeyboardAvoidingView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { auth } from '../config/firebase';
import { useUser } from '../context/UserContext';
import { useActionLock } from '../hooks/useActionLock';
import { createCoinOrder, purchaseCoins, RazorpayResult } from '../services/coinService';
import CheckoutModal from '../components/CheckoutModal';
import { getGlobalSettings, GlobalSettings } from '../services/adminService';
import { skeuo, skeuoGradients } from '../theme/skeuomorphic';
import { TextInput } from 'react-native';

type CoinsScreenProps = {
  navigation?: any;
  navigate?: (screen: string, params?: any) => void;
};

/**
 * Price points only. The coin yield is computed from the server's
 * `inrToCoinRechargeRate` rather than baked in, for two reasons: the packages
 * used to quote a better rate than the custom-amount box for the same money
 * (₹89 promised 100 coins, custom gave 99), and changing the rate needed an app
 * release, so an admin edit in the pricing panel silently applied to custom
 * top-ups only.
 */
const COIN_PACKAGES = [
  { id: '1', priceInr: 89, name: 'Handful of Coins', icon: 'monetization-on' },
  { id: '2', priceInr: 449, name: 'Pouch of Coins', icon: 'account-balance-wallet' },
  { id: '3', priceInr: 899, name: 'Chest of Coins', icon: 'cases' },
  { id: '4', priceInr: 1799, name: 'Vault of Coins', icon: 'account-balance' },
];

export default function CoinsScreen({ navigation, navigate: directNavigate, goBack }: CoinsScreenProps & { goBack?: () => void }) {
  const navigate = directNavigate || navigation?.navigate || (() => {});
  // Use a fallback inset if safe-area-context is missing
  const insets = { top: 40 };

  // Live balance from the app-wide UserContext snapshot. The server debits
  // the caller every 15 s during a call, so a one-shot getUserProfile() call
  // here would show a stale (too-high) balance while coins drain underneath
  // it. UserContext already holds an onSnapshot on the same document, so
  // reading from it costs no extra listener.
  const { profile } = useUser();
  const balance = profile?.coins ?? 0;
  // Show a spinner until the first snapshot arrives (profile is null while
  // Firebase initialises). Once set it is always live; no further fetches.
  const isLoading = profile === null;

  const [isPurchasing, setIsPurchasing] = useState<string | null>(null);
  const [customAmount, setCustomAmount] = useState<string>('');
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);

  // Synchronous double-tap guard. `isPurchasing` (useState) disables buttons
  // after the first re-render, but two taps landing in the same frame both
  // see the pre-render state, so both can enter runPurchase and fire two
  // concurrent createCoinOrder requests. The inFlight ref inside useActionLock
  // is set synchronously on the first tap, closing that window.
  const { run: runPurchaseSafe } = useActionLock();

  useEffect(() => {
    getGlobalSettings().then(setSettings);
  }, []);

  /**
   * Opens an order, runs Razorpay checkout in a WebView, then asks the backend
   * to verify the result. Coins are credited by the server against the order it
   * opened — the previous flow wrote the new balance straight from the client
   * with no payment step at all.
   */
  const runPurchase = async (key: string, packageId: string, amountInr: number) => {
    if (!auth.currentUser) return;
    setIsPurchasing(key);
    try {
      const order = await createCoinOrder(packageId, amountInr);
      setCheckoutUrl(order.checkoutUrl);
    } catch (e: any) {
      setIsPurchasing(null);
      if (e?.code === 'payments_not_configured' || e?.code === 'payments_not_implemented') {
        Alert.alert(
          'Coming Soon',
          'Coin purchases are not available yet. Payments are still being set up.'
        );
      } else {
        Alert.alert('Purchase Failed', e?.message || 'There was an error starting your payment.');
      }
    }
  };

  /**
   * Runs after checkout succeeds. A failure here means money moved but the
   * balance did not, so it says so plainly rather than a generic error — the
   * order is already paid server-side and re-confirming it credits once, not
   * twice, which is why retrying is safe advice.
   */
  const handleCheckoutSuccess = async (result: RazorpayResult) => {
    setCheckoutUrl(null);
    try {
      const confirmed = await purchaseCoins(result);
      // Do NOT setBalance here — the balance is now driven by the live
      // UserContext snapshot. The server writes the new value and the snapshot
      // propagates it automatically, usually within a second. A local override
      // would create two sources of truth that can diverge on retry.
      setCustomAmount('');
      Alert.alert('Purchase Successful!', `${confirmed.coinsCredited} coins have been added.`);
    } catch (e: any) {
      Alert.alert(
        'Payment received, coins pending',
        `${e?.message || 'We could not confirm your payment.'}\n\nYour money is safe. Reopen the Store in a moment and the coins will be added — you will not be charged again.`
      );
    } finally {
      setIsPurchasing(null);
    }
  };

  const coinsFor = (priceInr: number) =>
    Math.floor(priceInr * (settings?.inrToCoinRechargeRate ?? 0));

  // Both handlers route through runPurchaseSafe so the synchronous inFlight
  // ref is set before the first await, which closes the double-tap window that
  // useState alone cannot close (state is async; a second tap can land before
  // the first re-render propagates the disabled prop to the button).
  const handlePurchase = (pkg: typeof COIN_PACKAGES[0]) => {
    void runPurchaseSafe(() => runPurchase(pkg.id, pkg.id, pkg.priceInr));
  };

  const handleCustomPurchase = () => {
    if (!auth.currentUser || !settings) return;

    const amountInr = Number(customAmount);
    const minAmount = settings.minRechargeAmount || 49;

    // Validate before acquiring the lock so a bad amount does not consume
    // the cooldown and delay a valid retry.
    if (isNaN(amountInr) || amountInr < minAmount) {
      Alert.alert('Invalid Amount', `The minimum recharge amount is ₹${minAmount}.`);
      return;
    }

    void runPurchaseSafe(() => runPurchase('custom', 'custom', amountInr));
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: 50 }]}>
        <TouchableOpacity style={styles.backButton} onPress={() => goBack ? goBack() : navigate('Home')}
          accessibilityRole="button"
          accessibilityLabel="Go back">
          <MaterialIcons name="arrow-back" size={24} color={skeuo.plum} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Store</Text>
        <View style={{ width: 44 }} />
      </View>

      {/* The custom-amount field sits low on this screen; without this the
          keyboard covered it and the Recharge button entirely. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >

        {/* Balance Display */}
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>CURRENT BALANCE</Text>
          <View style={styles.balanceRow}>
            <View style={styles.largeCoin}>
              <LinearGradient colors={[...skeuoGradients.gold]} style={styles.largeCoinInner}>
                <MaterialIcons name="star" size={28} color="#FFD700" style={{ opacity: 0.8 }} />
              </LinearGradient>
            </View>
            {isLoading ? (
              <ActivityIndicator color={skeuo.gold} style={{ marginLeft: 16 }} />
            ) : (
              <Text style={styles.balanceAmount}>{balance.toLocaleString()}</Text>
            )}
          </View>
          {/* Was "1 Heart = 45 Coins" — a rate that exists nowhere in the app
              or the backend. Replaced with the recharge rate the server
              actually applies. */}
          {settings ? (
            <View style={styles.conversionBadge}>
              <MaterialIcons name="star" size={14} color="#D9A404" />
              <Text style={styles.conversionText}>
                ₹1 = {settings.inrToCoinRechargeRate} Coins
              </Text>
            </View>
          ) : null}
        </View>

        {settings && (
          <View style={styles.customRechargeCard}>
            <Text style={styles.sectionTitle}>Custom Recharge</Text>
            <Text style={styles.customHint}>Minimum amount: ₹{settings.minRechargeAmount}</Text>
            <View style={styles.customRow}>
              <View style={styles.customInputWrapper}>
                <Text style={styles.currencySymbol}>₹</Text>
                <TextInput
                  style={styles.customInput}
                  placeholder="Enter amount"
                  keyboardType="numeric"
                  value={customAmount}
                  onChangeText={setCustomAmount}
                />
              </View>
              <TouchableOpacity
                style={[styles.customBuyBtn, isPurchasing === 'custom' && { opacity: 0.7 }]}
                activeOpacity={0.8}
                onPress={handleCustomPurchase}
                disabled={isPurchasing !== null}
              >
                {isPurchasing === 'custom' ? (
                  <ActivityIndicator color={skeuo.plum} size="small" />
                ) : (
                  <Text style={styles.customBuyText}>Recharge</Text>
                )}
              </TouchableOpacity>
            </View>
            {Number(customAmount) > 0 && (
              <Text style={styles.customOutput}>
                You will get roughly <Text style={{fontWeight: '800', color: '#D49A0B'}}>{Math.floor(Number(customAmount) * (settings.inrToCoinRechargeRate || 1.12))} Coins</Text>
              </Text>
            )}
          </View>
        )}

        <Text style={styles.sectionTitle}>Coin Packages</Text>

        {/* Packages Grid */}
        <View style={styles.packagesContainer}>
          {COIN_PACKAGES.map((pkg) => (
            <TouchableOpacity
              key={pkg.id}
              style={styles.packageCard}
              activeOpacity={0.8}
              onPress={() => handlePurchase(pkg)}
              disabled={isPurchasing !== null || !settings}
              accessibilityRole="button"
              accessibilityLabel={`Buy ${pkg.name} for ${pkg.priceInr} rupees`}
            >
              <View style={styles.packageIconFrame}>
                <MaterialIcons name={pkg.icon as any} size={32} color={skeuo.gold} />
              </View>
              <View style={styles.packageInfo}>
                <Text style={styles.packageCoins}>
                  {settings ? `${coinsFor(pkg.priceInr).toLocaleString()} Coins` : '—'}
                </Text>
                <Text style={styles.packageName}>{pkg.name}</Text>
              </View>
              <View style={styles.priceButton}>
                {isPurchasing === pkg.id ? (
                  <ActivityIndicator color={skeuo.plum} size="small" />
                ) : (
                  <Text style={styles.priceText}>{`₹${pkg.priceInr}`}</Text>
                )}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
      </KeyboardAvoidingView>

      <CheckoutModal
        url={checkoutUrl}
        onSuccess={handleCheckoutSuccess}
        onCancel={() => {
          setCheckoutUrl(null);
          setIsPurchasing(null);
        }}
        onFailure={(message) => {
          setCheckoutUrl(null);
          setIsPurchasing(null);
          Alert.alert('Payment Failed', `${message}\n\nYou have not been charged.`);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: skeuo.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: skeuo.surfaceRaised,
    borderBottomWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
    zIndex: 10,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: skeuo.surfaceRaised,
    borderWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '900',
    fontFamily: 'serif',
    color: skeuo.plum,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 30,
    paddingBottom: 60,
  },
  balanceCard: {
    backgroundColor: skeuo.surfaceRaised,
    borderRadius: 32,
    padding: 30,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? skeuo.deepShadow : undefined,
    marginBottom: 40,
  },
  balanceLabel: {
    color: '#9A8772',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 2,
    marginBottom: 20,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  largeCoin: {
    width: 64,
    height: 64,
    borderRadius: 32,
    padding: 3,
    backgroundColor: '#FFE699',
    boxShadow: Platform.OS === 'web' ? skeuo.goldShadow : undefined,
    marginRight: 16,
  },
  largeCoinInner: {
    flex: 1,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFAEA',
  },
  balanceAmount: {
    fontSize: 54,
    fontWeight: '900',
    color: skeuo.plum,
    fontVariant: ['tabular-nums'],
    letterSpacing: -1,
  },
  conversionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF5F7',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F9E1E6',
    gap: 6,
  },
  conversionText: {
    color: '#B0415D',
    fontSize: 12,
    fontWeight: '800',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: skeuo.plum,
    marginLeft: 4,
    marginBottom: 16,
    fontFamily: 'serif'
  },
  customRechargeCard: {
    marginBottom: 24,
    backgroundColor: '#FFF',
    padding: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#EAD8A9',
    boxShadow: Platform.OS === 'web' ? '0 4px 12px rgba(68, 44, 21, 0.05)' : undefined,
  },
  customHint: { fontSize: 13, color: '#8F8491', fontWeight: '600', marginBottom: 12 },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  customInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8F5F0',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D4C9BD',
    paddingHorizontal: 16,
    height: 52,
  },
  currencySymbol: { fontSize: 18, fontWeight: '700', color: '#4B0054', marginRight: 8 },
  customInput: { flex: 1, fontSize: 18, fontWeight: '700', color: '#4B0054' },
  customBuyBtn: {
    backgroundColor: '#EAD8A9',
    height: 52,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#C3A042',
  },
  customBuyText: { fontSize: 16, fontWeight: '800', color: '#4B0054' },
  customOutput: { fontSize: 14, color: '#4B0054', marginTop: 12, fontWeight: '600' },
  packagesContainer: {
    gap: 16,
  },
  packageCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: skeuo.surfaceRaised,
    borderRadius: 24,
    padding: 16,
    borderWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  packageIconFrame: {
    width: 60,
    height: 60,
    borderRadius: 20,
    backgroundColor: '#F0E5D4',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? skeuo.insetShadow : undefined,
  },
  packageInfo: {
    flex: 1,
    marginLeft: 16,
    justifyContent: 'center',
  },
  packageCoins: {
    fontSize: 18,
    fontWeight: '900',
    color: skeuo.plum,
    marginBottom: 4,
  },
  packageName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9A8772',
  },
  priceButton: {
    backgroundColor: '#F0E5D4',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
    minWidth: 80,
    alignItems: 'center',
  },
  priceText: {
    color: skeuo.plum,
    fontWeight: '900',
    fontSize: 14,
  },
});
