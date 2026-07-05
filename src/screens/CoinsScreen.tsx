import React, { useEffect, useState } from 'react';
import { Platform, ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { auth } from '../config/firebase';
import { getUserProfile, saveUserProfile } from '../services/userService';
import { getGlobalSettings, GlobalSettings } from '../services/adminService';
import { skeuo, skeuoGradients } from '../theme/skeuomorphic';
import { TextInput } from 'react-native';

type CoinsScreenProps = {
  navigation?: any;
  navigate?: (screen: string, params?: any) => void;
};

const COIN_PACKAGES = [
  { id: '1', coins: 100, price: '₹89', name: 'Handful of Coins', icon: 'monetization-on' },
  { id: '2', coins: 500, price: '₹449', name: 'Pouch of Coins', icon: 'account-balance-wallet' },
  { id: '3', coins: 1200, price: '₹899', name: 'Chest of Coins', icon: 'cases' },
  { id: '4', coins: 3000, price: '₹1799', name: 'Vault of Coins', icon: 'account-balance' },
];

export default function CoinsScreen({ navigation, navigate: directNavigate, goBack }: CoinsScreenProps & { goBack?: () => void }) {
  const navigate = directNavigate || navigation?.navigate || (() => {});
  // Use a fallback inset if safe-area-context is missing
  const insets = { top: 40 }; 
  const [balance, setBalance] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isPurchasing, setIsPurchasing] = useState<string | null>(null);
  const [customAmount, setCustomAmount] = useState<string>('');
  const [settings, setSettings] = useState<GlobalSettings | null>(null);

  useEffect(() => {
    fetchBalance();
    getGlobalSettings().then(setSettings);
  }, []);

  const fetchBalance = async () => {
    if (!auth.currentUser) return;
    try {
      const profile = await getUserProfile(auth.currentUser.uid);
      if (profile && profile.coins !== undefined) {
        setBalance(profile.coins);
      }
    } catch (e) {
      console.warn('Could not fetch coin balance', e);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePurchase = async (pkg: typeof COIN_PACKAGES[0]) => {
    if (!auth.currentUser) return;
    setIsPurchasing(pkg.id);
    
    // Simulate network delay for purchase processing
    setTimeout(async () => {
      try {
        const profile = await getUserProfile(auth.currentUser!.uid);
        const currentBalance = profile?.coins || 0;
        const newBalance = currentBalance + pkg.coins;
        
        await saveUserProfile(auth.currentUser!.uid, { coins: newBalance });
        setBalance(newBalance);
        Alert.alert('Purchase Successful!', `You have received ${pkg.coins} coins.`);
      } catch (e) {
        Alert.alert('Purchase Failed', 'There was an error processing your transaction.');
      } finally {
        setIsPurchasing(null);
      }
    }, 1200);
  };

  const handleCustomPurchase = async () => {
    if (!auth.currentUser || !settings) return;
    
    const amountInr = Number(customAmount);
    const minAmount = settings.minRechargeAmount || 49;
    
    if (isNaN(amountInr) || amountInr < minAmount) {
      Alert.alert('Invalid Amount', `The minimum recharge amount is ₹${minAmount}.`);
      return;
    }

    setIsPurchasing('custom');
    const coinsToReceive = Math.floor(amountInr * (settings.inrToCoinRechargeRate || 1.12));

    setTimeout(async () => {
      try {
        const profile = await getUserProfile(auth.currentUser!.uid);
        const currentBalance = profile?.coins || 0;
        const newBalance = currentBalance + coinsToReceive;
        
        await saveUserProfile(auth.currentUser!.uid, { coins: newBalance });
        setBalance(newBalance);
        setCustomAmount('');
        Alert.alert('Purchase Successful!', `You have received ${coinsToReceive} coins.`);
      } catch (e) {
        Alert.alert('Purchase Failed', 'There was an error processing your transaction.');
      } finally {
        setIsPurchasing(null);
      }
    }, 1200);
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: 50 }]}>
        <TouchableOpacity style={styles.backButton} onPress={() => goBack ? goBack() : navigate('Home')}>
          <MaterialIcons name="arrow-back" size={24} color={skeuo.plum} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Store</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        
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
          <View style={styles.conversionBadge}>
            <MaterialIcons name="favorite" size={14} color="#D45D79" />
            <Text style={styles.conversionText}>1 Heart = 45 Coins</Text>
          </View>
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
              disabled={isPurchasing !== null}
            >
              <View style={styles.packageIconFrame}>
                <MaterialIcons name={pkg.icon as any} size={32} color={skeuo.gold} />
              </View>
              <View style={styles.packageInfo}>
                <Text style={styles.packageCoins}>{pkg.coins.toLocaleString()} Coins</Text>
                <Text style={styles.packageName}>{pkg.name}</Text>
              </View>
              <View style={styles.priceButton}>
                {isPurchasing === pkg.id ? (
                  <ActivityIndicator color={skeuo.plum} size="small" />
                ) : (
                  <Text style={styles.priceText}>{pkg.price}</Text>
                )}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
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
