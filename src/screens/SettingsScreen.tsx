import { Alert } from '../components/CustomAlert';
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform, Modal, ScrollView, Linking } from 'react-native';
import Constants from 'expo-constants';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { auth } from '../config/firebase';
import { deleteUser } from 'firebase/auth';
import { doc, deleteDoc } from 'firebase/firestore';
import ScreenShell from '../components/ScreenShell';
import { useUser } from '../context/UserContext';
import GengalAvatar from '../components/GengalAvatar';
import { BACKEND_URL, clearAuthSession, logout, purgeAccountData } from '../services/authService';
import { checkIsAdmin } from '../services/adminService';
import { tap40 } from '../theme/touch';

type SettingsScreenProps = {
  navigate: (screen: string, params?: any) => void;
  goBack?: () => void;
};

type MenuItem = {
  key: string;
  label: string;
  icon: string;
  color: string;
  bg: string;
  screen?: string;
  params?: Record<string, any>;
  /** Opened outside the app instead of navigating. */
  url?: string;
};

export const SUPPORT_EMAIL = 'gengal.app@gmail.com';

const MENU_ITEMS: MenuItem[] = [
  { key: 'avatar', label: 'Edit Avatar & Profile', icon: 'face', color: '#9333EA', bg: '#F3E8FF', screen: 'FinalizeInvite', params: { isEditMode: true } },
  { key: 'language', label: 'App Language', icon: 'language', color: '#F97316', bg: '#FFEDD5', screen: 'Language', params: { isEditMode: true, returnTo: 'Settings' } },
  { key: 'coins', label: 'Buy Coins', icon: 'stars', color: '#D49A0B', bg: '#FFF8DD', screen: 'Coins' },
  { key: 'earnings', label: 'Earnings', icon: 'account-balance-wallet', color: '#16A34A', bg: '#DCFCE7', screen: 'Earnings' },
  { key: 'blocked', label: 'Blocked Users', icon: 'block', color: '#8B2E2E', bg: '#FDECEA', screen: 'BlockedUsers' },
];

// Served by the backend so they stay reachable from the Play Store listing too.
const INFO_ITEMS: MenuItem[] = [
  { key: 'support', label: 'Help & Support', icon: 'support-agent', color: '#0F766E', bg: '#CCFBF1', url: `mailto:${SUPPORT_EMAIL}?subject=GenGal%20support` },
  { key: 'privacy', label: 'Privacy Policy', icon: 'privacy-tip', color: '#475569', bg: '#E2E8F0', url: `${BACKEND_URL}/privacy` },
  { key: 'terms', label: 'Terms of Service', icon: 'gavel', color: '#475569', bg: '#E2E8F0', url: `${BACKEND_URL}/terms` },
];

// Shown only to accounts on the backend's administrator allowlist.
const ADMIN_MENU_ITEM: MenuItem = { key: 'admin', label: 'Admin Panel', icon: 'admin-panel-settings', color: '#0284C7', bg: '#E0F2FE', screen: 'AdminPanel' };

export default function SettingsScreen({ navigate, goBack }: SettingsScreenProps) {
  const { profile } = useUser();
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let active = true;
    checkIsAdmin().then(result => {
      if (active) setIsAdmin(result);
    });
    return () => { active = false; };
  }, []);

  const menuItems = [...MENU_ITEMS, ...(isAdmin ? [ADMIN_MENU_ITEM] : []), ...INFO_ITEMS];

  const openItem = (item: MenuItem) => {
    if (item.url) {
      Linking.openURL(item.url).catch(() =>
        Alert.alert('Could not open', item.key === 'support' ? `Email us at ${SUPPORT_EMAIL}` : 'Please try again later.'));
      return;
    }
    if (item.screen) navigate(item.screen, item.params);
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch (e) {
      Alert.alert('Error', 'Failed to log out.');
    }
  };

  const executeDelete = async () => {
    setShowDeleteModal(false);
    const user = auth.currentUser;
    if (!user) return;
    setIsDeleting(true);
    try {
      await clearAuthSession();
      // Purge server-side data first: deleteUser invalidates the credential, so
      // anything attempted afterwards is rejected (the old order silently left
      // the profile document behind).
      //
      // This throws if anything survived, which stops us deleting the auth
      // record. Losing the account while the data remains is the one outcome
      // there is no way back from — the rules only let the owner clean up, and
      // after deleteUser there is no owner. Better to fail and let them retry.
      await purgeAccountData();
      await deleteUser(user);
    } catch (error: any) {
      if (error.code === 'auth/requires-recent-login') {
        Alert.alert('Security Verification', 'Please log in again before deleting your account.');
        await logout();
      } else {
        Alert.alert(
          'Account not deleted',
          'We could not remove all of your data, so your account is untouched. Please check your connection and try again.',
        );
      }
      setIsDeleting(false);
    }
  };

  const tier = profile?.tier === 'VIP' ? 'VIP' : 'Standard';
  const tierColor = tier === 'VIP' ? '#9A1E8A' : '#B99916';

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
          <Text style={styles.headerTitle}>Settings</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Profile card */}
        {profile && (
          <TouchableOpacity style={styles.profileCard} activeOpacity={0.88} onPress={() => navigate('FinalizeInvite', { isEditMode: true, existingAvatarData: profile.avatarData, gender: profile.gender })}>
            <View style={styles.avatarWrap}>
              {profile.avatarData ? (
                <GengalAvatar data={profile.avatarData as any} size={56} />
              ) : (
                <View style={styles.avatarFallback}>
                  <MaterialIcons name="person" size={28} color="#9A7A05" />
                </View>
              )}
            </View>
            <View style={styles.profileInfo}>
              <Text style={styles.profileName}>{profile.nickname || profile.username || 'Your Name'}</Text>
              <View style={[styles.tierBadge, { backgroundColor: tierColor + '22', borderColor: tierColor + '55' }]}>
                <MaterialIcons name="diamond" size={10} color={tierColor} />
                <Text style={[styles.tierText, { color: tierColor }]}>{tier}</Text>
              </View>
            </View>
            <MaterialIcons name="chevron-right" size={22} color="#CCC" />
          </TouchableOpacity>
        )}

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {menuItems.map((item) => (
            <TouchableOpacity
              key={item.key}
              style={styles.menuItem}
              activeOpacity={0.75}
              onPress={() => openItem(item)}
            >
              <View style={styles.menuLeft}>
                <View style={[styles.iconBox, { backgroundColor: item.bg }]}>
                  <MaterialIcons name={item.icon as any} size={20} color={item.color} />
                </View>
                <Text style={styles.menuText}>{item.label}</Text>
              </View>
              <MaterialIcons name="chevron-right" size={22} color="#DDD" />
            </TouchableOpacity>
          ))}

          {/* Logout */}
          <TouchableOpacity style={styles.menuItem} activeOpacity={0.75} onPress={handleLogout}>
            <View style={styles.menuLeft}>
              <View style={[styles.iconBox, { backgroundColor: '#FEF3C7' }]}>
                <MaterialIcons name="logout" size={20} color="#D97706" />
              </View>
              <Text style={styles.menuText}>Logout</Text>
            </View>
            <MaterialIcons name="chevron-right" size={22} color="#DDD" />
          </TouchableOpacity>

          {/* Delete account */}
          <TouchableOpacity
            style={[styles.menuItem, { borderColor: '#FEE2E2' }]}
            activeOpacity={0.75}
            onPress={() => setShowDeleteModal(true)}
            disabled={isDeleting}
          >
            <View style={styles.menuLeft}>
              <View style={[styles.iconBox, { backgroundColor: '#FEE2E2' }]}>
                {isDeleting
                  ? <ActivityIndicator size="small" color="#DC2626" />
                  : <MaterialIcons name="delete-forever" size={20} color="#DC2626" />}
              </View>
              <Text style={[styles.menuText, { color: '#DC2626' }]}>Delete Account</Text>
            </View>
          </TouchableOpacity>

          <Text style={styles.versionText}>GenGal v{Constants.expoConfig?.version ?? '1.0.0'}</Text>
        </ScrollView>

        {/* Delete confirmation modal */}
        <Modal visible={showDeleteModal} transparent animationType="fade" onRequestClose={() => setShowDeleteModal(false)}>
          <View style={styles.overlay}>
            <View style={styles.modalCard}>
              <View style={styles.modalIconBox}>
                <MaterialIcons name="warning" size={32} color="#DC2626" />
              </View>
              <Text style={styles.modalTitle}>Delete Account?</Text>
              <Text style={styles.modalMsg}>
                This will permanently delete your account and all data. This cannot be undone.
              </Text>
              <View style={styles.modalActions}>
                <TouchableOpacity style={[styles.modalBtn, styles.cancelBtn]} onPress={() => setShowDeleteModal(false)}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.modalBtn, styles.deleteBtn]} onPress={executeDelete}>
                  <Text style={styles.deleteText}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
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

  profileCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    marginHorizontal: 16, marginTop: 16, marginBottom: 8,
    backgroundColor: '#FFFDF8', borderRadius: 18, padding: 16,
    borderWidth: 1, borderColor: '#EAD8A9',
    boxShadow: Platform.OS === 'web' ? '0 2px 8px rgba(68,44,21,0.06)' : undefined,
  },
  avatarWrap: {
    width: 56, height: 56, borderRadius: 28,
    borderWidth: 2, borderColor: '#D4B142', overflow: 'hidden',
  },
  avatarFallback: {
    flex: 1, backgroundColor: '#FFF8DD', alignItems: 'center', justifyContent: 'center',
  },
  profileInfo: { flex: 1 },
  profileName: { fontSize: 16, fontWeight: '900', color: '#4B0054', marginBottom: 4 },
  tierBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1, alignSelf: 'flex-start',
  },
  tierText: { fontSize: 9, fontWeight: '900', textTransform: 'uppercase' },

  content: { padding: 16, gap: 10, paddingBottom: 32 },
  versionText: { marginTop: 8, textAlign: 'center', color: '#B3A79C', fontSize: 12, fontWeight: '600' },
  menuItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#FFFFFF', padding: 14, borderRadius: 16,
    borderWidth: 1, borderColor: '#F0E9DF',
    boxShadow: Platform.OS === 'web' ? '0 1px 4px rgba(68,44,21,0.04)' : undefined,
  },
  menuLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBox: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  menuText: { fontSize: 15, fontWeight: '600', color: '#334155' },

  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  modalCard: {
    width: '100%', maxWidth: 320, backgroundColor: '#FFF',
    borderRadius: 24, padding: 24, alignItems: 'center',
    boxShadow: Platform.OS === 'web' ? '0 10px 25px rgba(0,0,0,0.15)' : undefined,
  },
  modalIconBox: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: '#FEE2E2', justifyContent: 'center', alignItems: 'center', marginBottom: 14,
  },
  modalTitle: { fontSize: 20, fontWeight: '800', color: '#1E293B', marginBottom: 10 },
  modalMsg: { fontSize: 13, color: '#64748B', textAlign: 'center', lineHeight: 20, marginBottom: 22 },
  modalActions: { flexDirection: 'row', gap: 10, width: '100%' },
  modalBtn: { flex: 1, height: 46, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  cancelBtn: { backgroundColor: '#F1F5F9' },
  deleteBtn: { backgroundColor: '#DC2626' },
  cancelText: { fontSize: 14, fontWeight: '700', color: '#475569' },
  deleteText: { fontSize: 14, fontWeight: '700', color: '#FFF' },
});
