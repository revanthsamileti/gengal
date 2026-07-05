import React, { useState, useEffect } from 'react';
import {
  Platform, View, Text, StyleSheet, ScrollView,
  TouchableOpacity, TextInput, ActivityIndicator, Alert,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import ScreenShell from '../components/ScreenShell';
import {
  initializeGlobalSettings,
  getGlobalSettings,
  updateGlobalSettings,
  GlobalSettings,
} from '../services/adminService';

type Props = { navigate: (s: string, p?: any) => void; goBack?: () => void };

type FieldDef = {
  key: keyof GlobalSettings;
  label: string;
  hint: string;
  icon: string;
  suffix?: string;
  prefix?: string;
};

const FIELDS: FieldDef[] = [
  { key: 'voiceCallRatePerMin', label: 'Voice Call Rate', hint: 'Coins per minute', icon: 'phone', suffix: 'coins/min' },
  { key: 'videoCallRatePerMin', label: 'Video Call Rate', hint: 'Coins per minute', icon: 'videocam', suffix: 'coins/min' },
  { key: 'callDurationForHeart', label: 'Minutes per Heart', hint: 'Minutes of calls to earn 1 heart', icon: 'favorite', suffix: 'min' },
  { key: 'heartToInrRate', label: 'Heart → INR Rate', hint: 'INR value per heart', icon: 'currency-rupee', prefix: '₹', suffix: '/heart' },
  { key: 'minRechargeAmount', label: 'Min Recharge', hint: 'Minimum recharge in INR', icon: 'account-balance-wallet', prefix: '₹' },
  { key: 'inrToCoinRechargeRate', label: 'INR → Coins Rate', hint: 'Coins per ₹1 recharged', icon: 'swap-horiz', suffix: 'coins/₹' },
  { key: 'creatorSharePercentage', label: 'Creator Share %', hint: 'Percentage of call cost sent to creator', icon: 'pie-chart', suffix: '%' },
];

export default function AdminPanelScreen({ navigate, goBack }: Props) {
  const [settings, setSettings] = useState<Partial<GlobalSettings>>({});
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    initializeGlobalSettings().then(() =>
      getGlobalSettings().then((s) => {
        setSettings(s);
        const vals: Record<string, string> = {};
        FIELDS.forEach(f => { vals[f.key] = String((s as any)[f.key] ?? ''); });
        setEditValues(vals);
        setLoading(false);
      })
    );
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates: Partial<GlobalSettings> = {};
      FIELDS.forEach(f => {
        const val = parseFloat(editValues[f.key]);
        if (!isNaN(val)) (updates as any)[f.key] = val;
      });
      await updateGlobalSettings(updates);
      Alert.alert('Deployed', 'Global settings updated successfully.');
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScreenShell tone="light">
      <View style={styles.phone}>
        {/* Header */}
        <LinearGradient colors={['#1A0020', '#3B0044']} style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => goBack ? goBack() : navigate('Settings')}>
            <MaterialIcons name="arrow-back" size={22} color="#FFFDF8" />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <MaterialIcons name="admin-panel-settings" size={20} color="#D49A0B" />
            <Text style={styles.headerTitle}>Admin Panel</Text>
          </View>
          <View style={{ width: 40 }} />
        </LinearGradient>

        {loading ? (
          <View style={styles.loader}>
            <ActivityIndicator size="large" color="#4B0054" />
            <Text style={styles.loaderText}>Loading settings…</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <View style={styles.warningCard}>
              <MaterialIcons name="warning" size={16} color="#D97706" />
              <Text style={styles.warningText}>
                Changes apply globally to all users immediately.
              </Text>
            </View>

            {FIELDS.map((field) => (
              <View key={field.key} style={styles.fieldCard}>
                <View style={styles.fieldHeader}>
                  <View style={styles.fieldIconBox}>
                    <MaterialIcons name={field.icon as any} size={18} color="#4B0054" />
                  </View>
                  <View style={styles.fieldMeta}>
                    <Text style={styles.fieldLabel}>{field.label}</Text>
                    <Text style={styles.fieldHint}>{field.hint}</Text>
                  </View>
                </View>
                <View style={styles.inputRow}>
                  {field.prefix && <Text style={styles.inputAddon}>{field.prefix}</Text>}
                  <TextInput
                    style={styles.input}
                    keyboardType="decimal-pad"
                    value={editValues[field.key] ?? ''}
                    onChangeText={(v) => setEditValues(prev => ({ ...prev, [field.key]: v }))}
                    placeholder="0"
                    placeholderTextColor="#BBA0A0"
                  />
                  {field.suffix && <Text style={styles.inputAddon}>{field.suffix}</Text>}
                </View>
              </View>
            ))}

            <TouchableOpacity style={styles.saveBtn} activeOpacity={0.85} onPress={handleSave} disabled={saving}>
              <LinearGradient colors={['#4B0054', '#7B0085']} style={styles.saveBtnInner}>
                {saving
                  ? <ActivityIndicator color="#FFF" />
                  : <>
                    <MaterialIcons name="cloud-upload" size={18} color="#FFFDF8" />
                    <Text style={styles.saveBtnText}>Deploy Changes</Text>
                  </>}
              </LinearGradient>
            </TouchableOpacity>
          </ScrollView>
        )}
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  phone: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: 430 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 18, fontWeight: '900', color: '#FFFDF8' },

  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loaderText: { color: '#8A7C70', fontSize: 14, fontWeight: '600' },

  scroll: { padding: 16, paddingBottom: 60 },

  warningCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFFBEB', borderRadius: 12, padding: 12, marginBottom: 18,
    borderWidth: 1, borderColor: '#FDE68A',
  },
  warningText: { flex: 1, fontSize: 12, color: '#92400E', fontWeight: '600', lineHeight: 17 },

  fieldCard: {
    backgroundColor: '#FFFDF8', borderRadius: 16, padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: '#EEE4D8',
    boxShadow: Platform.OS === 'web' ? '0 1px 4px rgba(68,44,21,0.05)' : undefined,
  },
  fieldHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  fieldIconBox: {
    width: 38, height: 38, borderRadius: 10,
    backgroundColor: '#F3E8FF', alignItems: 'center', justifyContent: 'center',
  },
  fieldMeta: { flex: 1 },
  fieldLabel: { fontSize: 14, fontWeight: '800', color: '#4B0054' },
  fieldHint: { fontSize: 11, color: '#9A8772', fontWeight: '600', marginTop: 1 },

  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F8F5EF', borderRadius: 10, borderWidth: 1, borderColor: '#EEE4D8',
    paddingHorizontal: 12, height: 46,
  },
  inputAddon: { fontSize: 13, fontWeight: '700', color: '#7A6800', marginHorizontal: 4 },
  input: { flex: 1, fontSize: 18, fontWeight: '800', color: '#4B0054' },

  saveBtn: {
    marginTop: 8, borderRadius: 16, overflow: 'hidden',
    boxShadow: Platform.OS === 'web' ? '0 8px 20px rgba(75,0,84,0.28)' : undefined,
  },
  saveBtnInner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, paddingVertical: 16,
  },
  saveBtnText: { color: '#FFFDF8', fontSize: 15, fontWeight: '900', letterSpacing: 1 },
});
