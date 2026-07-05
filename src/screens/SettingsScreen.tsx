import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, Platform, Modal } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { auth, db } from '../config/firebase';
import { deleteUser, signOut } from 'firebase/auth';
import { doc, deleteDoc } from 'firebase/firestore';
import ScreenShell from '../components/ScreenShell';
import { useUser } from '../context/UserContext';
import GengalAvatar from '../components/GengalAvatar';

type SettingsScreenProps = {
  navigate: (screen: string, params?: any) => void;
  goBack?: () => void;
};

const MENU_ITEMS = [
  { key: 'avatar', label: 'Edit Avatar & Profile', icon: 'face', color: '#9333EA', bg: '#F3E8FF', screen: 'FinalizeInvite' },
  { key: 'language', label: 'App Language', icon: 'language', color: '#F97316', bg: '#FFEDD5', screen: 'Language', params: { isEditMode: true, returnTo: 'Settings' } },
  { key: 'coins', label: 'Buy Coins', icon: 'monetization-on', color: '#D49A0B', bg: '#FFF8DD', screen: 'Coins' },
  { key: 'earnings', label: 'Earnings', icon: 'account-balance-wallet', color: '#16A34A', bg: '#DCFCE7', screen: 'Earnings' },
  { key: 'admin', label: 'Admin Panel', icon: 'admin-panel-settings', color: '#0284C7', bg: '#E0F2FE', screen: 'AdminPanel' },
];

export default function SettingsScreen({ navigate, goBack }: SettingsScreenProps) {
  const { profile } = useUser();
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const handleLogout = async () => {
    try {
      await signOut(auth);
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
      await deleteDoc(doc(db, 'users', user.uid));
      await deleteUser(user);
    } catch (error: any) {
      if (error.code === 'auth/requires-recent-login') {
        Alert.alert('Security Verification', 'Please log in again before deleting your account.');
        await signOut(auth);
      } else {
        Alert.alert('Error', 'Could not delete account. Please try again.');
      }
      setIsDeleting(false);
    }
  };

  const tier = profile?.avatarUrl ? 'VIP' : 'Elite';
  const tierColor = tier === 'VIP' ? '#9A1E8A' : '#B99916';

  return (
    <ScreenShell tone="light">
      <View style={styles.phone}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => goBack ? goBack() : navigate('Home')}>
            <MaterialIcons name="arrow-back" size={22} color="#4B0054" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Settings</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Profile card */}
        {profile && (
          <TouchableOpacity style={styles.profileCard} activeOpacity={0.88} onPress={() => navigate('FinalizeInvite')}>
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

        <View style={styles.content}>
          {MENU_ITEMS.map((item) => (
            <TouchableOpacity
              key={item.key}
              style={styles.menuItem}
              activeOpacity={0.75}
              onPress={() => navigate(item.screen, item.params)}
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
        </View>

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

  content: { padding: 16, gap: 10 },
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
