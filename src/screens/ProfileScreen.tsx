import React, { useState, useEffect } from 'react';
import { tap34, tap42 } from '../theme/touch';
import { ActivityIndicator, Platform, Image,
  KeyboardAvoidingView,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View, } from 'react-native';
import { Alert } from '../components/CustomAlert';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import ScreenShell from '../components/ScreenShell';
import BottomNav from '../components/BottomNav';
import { useActionLock } from '../hooks/useActionLock';
import { launchCall } from '../services/callPermissionService';

import { useUser } from '../context/UserContext';
import { subscribeToOnlineUsers, saveUserProfile, followUser, unfollowUser, getFollowerCount, UserProfile as FirebaseUser } from '../services/userService';
import GengalAvatar from '../components/GengalAvatar';
import CallPriceTag from '../components/CallPriceTag';
import { auth } from '../config/firebase';

type ProfileScreenProps = {
  profileName?: string;
  navigate: (screen: string, params?: any) => void;
  goBack?: () => void;
  route?: any;
};

function ModeButton({
  mode,
  profile,
  navigate,
}: {
  mode: 'call' | 'video';
  profile: any;
  navigate: ProfileScreenProps['navigate'];
}) {
  const isVideo = mode === 'video';
  const { locked, run } = useActionLock();
  const peerName = (profile as any).name || (profile as any).nickname || (profile as any).username;
  // A uid is what CallScreen bills against, so anything without one must not
  // offer a call button. The extra `isSampleProfile` exclusion that used to sit
  // here is gone with the seeded profiles themselves — every profile reaching
  // this screen now comes from a real Firestore account.
  const canCall = !!(profile as any)?.uid;

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      style={[styles.modeButton, isVideo && styles.modeButtonVideo, (!canCall || locked) && { opacity: 0.5 }]}
      disabled={!canCall || locked}
      accessibilityRole="button"
      accessibilityLabel={isVideo ? `Video call ${peerName}` : `Call ${peerName}`}
      accessibilityState={{ disabled: !canCall || locked }}
      onPress={() =>
        run(() =>
          // matchData carries the uid CallScreen needs to create the offer.
          // Omitting it previously made every call from this screen fail.
          launchCall(navigate, { profileName: peerName, mode, isCaller: true, matchData: profile })
        )
      }
    >
      <MaterialIcons
        name={isVideo ? 'videocam' : 'phone'}
        size={19}
        color={isVideo ? '#FFF' : '#FFF'}
      />
      <Text style={[styles.modeText, isVideo && styles.modeTextVideo]}>
        {isVideo ? 'Video' : 'Call'}
      </Text>
      <CallPriceTag mode={mode} />
    </TouchableOpacity>
  );
}

export default function ProfileScreen({ profileName, navigate, route }: ProfileScreenProps) {
  const [firebaseUsers, setFirebaseUsers] = useState<FirebaseUser[]>([]);
  const { profile: myProfile } = useUser();
  
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editForm, setEditForm] = useState({
    nickname: '',
    age: '',
    language: '',
    avatarUrl: ''
  });

  useEffect(() => {
    const unsubscribeUsers = subscribeToOnlineUsers((users) => {
      setFirebaseUsers(users);
    }, auth.currentUser?.uid);
    
    return () => {
      unsubscribeUsers();
    };
  }, []);

  const allProfiles = [
    ...firebaseUsers.map(u => ({
      uid: u.uid,
      name: u.nickname || u.username || 'User',
      age: u.age || undefined,
      lang: u.language || 'EN',
      tier: u.tier,
      uri: u.avatarUrl || '',
      avatarData: u.avatarData,
      bio: u.bio || '',
      followers: Array.isArray(u.followers) ? u.followers.length.toString() : (u.followers?.toString() || '0'),
      following: Array.isArray(u.following) ? u.following.length.toString() : (u.following?.toString() || '0'),
      modes: ['call', 'video'] as Array<'call' | 'video'>
    })),
    ...(myProfile ? [{
      uid: myProfile.uid,
      name: myProfile.nickname || myProfile.username || 'User',
      age: myProfile.age || undefined,
      lang: myProfile.language || 'EN',
      tier: myProfile.tier,
      uri: myProfile.avatarUrl || '',
      avatarData: myProfile.avatarData,
      bio: myProfile.bio || '',
      followers: Array.isArray(myProfile.followers) ? myProfile.followers.length.toString() : (myProfile.followers?.toString() || '0'),
      following: Array.isArray(myProfile.following) ? myProfile.following.length.toString() : (myProfile.following?.toString() || '0'),
      modes: ['call', 'video'] as Array<'call' | 'video'>
    }] : [])
  ];

  const matchData = route?.params?.matchData;
  let profile = matchData ? {
    uid: matchData.uid,
    name: matchData.name || matchData.nickname || 'User',
    age: matchData.age || undefined,
    lang: matchData.lang || matchData.language || 'EN',
    tier: matchData.tier,
    uri: matchData.uri || matchData.avatarUrl || '',
    avatarData: matchData.avatarData,
    bio: matchData.bio || '',
    followers: matchData.followers?.toString() || '0',
    following: matchData.following?.toString() || '0',
    modes: matchData.modes || ['call', 'video']
  } : allProfiles.find((p) => p.name === profileName) ?? allProfiles[allProfiles.length - 1];

  if (!profile && myProfile) {
    profile = allProfiles[allProfiles.length - 1];
  }

  const isCurrentUser = !profileName || profile?.name === (myProfile?.nickname || myProfile?.username || 'User');

  const targetUid = route?.params?.matchData?.uid || route?.params?.uid;
  const myFollowing: string[] = Array.isArray(myProfile?.following) ? (myProfile!.following as string[]) : [];
  const [isFollowing, setIsFollowing] = useState(() => targetUid ? myFollowing.includes(targetUid) : false);
  const [isBlocked, setIsBlocked] = useState(false);

  // Followers are a subcollection now, so the count comes from an aggregate query
  // rather than the length of an array on the profile document.
  const [followerCount, setFollowerCount] = useState<number | null>(null);
  const countedUid = targetUid || (isCurrentUser ? myProfile?.uid : undefined);
  useEffect(() => {
    if (!countedUid) {
      setFollowerCount(null);
      return;
    }
    let active = true;
    getFollowerCount(countedUid).then(count => {
      if (active) setFollowerCount(count);
    });
    return () => { active = false; };
  }, [countedUid, isFollowing]);

  useEffect(() => {
    if (targetUid) {
      const updatedFollowing: string[] = Array.isArray(myProfile?.following) ? (myProfile!.following as string[]) : [];
      setIsFollowing(updatedFollowing.includes(targetUid));
    }
  }, [myProfile?.following, targetUid]);

  if (!profile) {
    return (
      <ScreenShell tone="light">
        <View style={[styles.phone, { justifyContent: 'center', alignItems: 'center', flex: 1 }]}>
          <ActivityIndicator size="large" color="#5A075F" />
        </View>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell tone="light">
      <View style={styles.phone}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            hitSlop={tap42}
            activeOpacity={0.78}
            onPress={() => navigate('Home')}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <MaterialIcons name="arrow-back" size={22} color="#5A075F" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{isCurrentUser ? 'My Profile' : 'Profile'}</Text>
          {/* Only the owner has an action here. The heart icon shown to other
              viewers was a button whose handler did nothing. */}
          {isCurrentUser ? (
            <View style={styles.headerActions}>
              <TouchableOpacity
                style={styles.headerIcon}
                hitSlop={tap42}
                activeOpacity={0.8}
                onPress={() => {
                  setEditForm({
                    nickname: myProfile?.nickname || myProfile?.username || '',
                    age: myProfile?.age != null ? String(myProfile.age) : '',
                    language: myProfile?.language || '',
                    avatarUrl: myProfile?.avatarUrl || '',
                  });
                  setIsEditModalVisible(true);
                }}
                accessibilityRole="button"
                accessibilityLabel="Edit profile"
              >
                <MaterialIcons name="edit" size={22} color="#92750B" />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.headerIcon}
                hitSlop={tap42}
                activeOpacity={0.8}
                onPress={() => navigate('Settings')}
                accessibilityRole="button"
                accessibilityLabel="Settings"
              >
                <MaterialIcons name="settings" size={22} color="#92750B" />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.headerIcon} />
          )}
        </View>

        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
        >
          <LinearGradient
            colors={['#FFFDF8', '#F8F0E5']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.heroCard}
          >
            <LinearGradient
              colors={['#FFF0C7', '#9D8216', '#F3DA79']}
              start={{ x: 0.1, y: 0 }}
              end={{ x: 0.9, y: 1 }}
              style={styles.avatarRing}
            >
              <View style={styles.avatarInner}>
                {(profile as any).avatarData ? (
                  <GengalAvatar data={(profile as any).avatarData} size={118} />
                ) : profile.uri ? (
                  <Image source={{ uri: profile.uri }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarEmpty]}>
                    <MaterialIcons name="person" size={56} color="#C9BDB2" />
                  </View>
                )}
              </View>
            </LinearGradient>

            {profile.tier === 'VIP' ? (
              <View style={styles.tierPill}>
                <MaterialIcons name="diamond" size={12} color="#B68D1C" />
                <Text style={styles.tierText}>VIP</Text>
              </View>
            ) : null}

            <Text style={styles.name}>
              {profile.age ? `${profile.name}, ${profile.age}` : profile.name}
            </Text>
            <View style={styles.languageRow}>
              <MaterialIcons name="language" size={15} color="#B68D1C" />
              <Text style={styles.language}>{profile.lang}</Text>
            </View>

            <View style={styles.statusRow}>
              <View style={styles.onlineDot} />
              <Text style={styles.statusText}>Online now</Text>
            </View>

            <View style={styles.statsRow}>
              {/* Plain Views: there is no followers/following list to open,
                  and a Touchable that does nothing reads as a broken button. */}
              <View style={styles.statItem}>
                <Text style={styles.statValue}>
                  {followerCount !== null ? followerCount.toString() : profile.followers}
                </Text>
                <Text style={styles.statLabel}>Followers</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{profile.following}</Text>
                <Text style={styles.statLabel}>Following</Text>
              </View>
            </View>

            <Text style={styles.bio}>{profile.bio}</Text>
          </LinearGradient>

          <View style={styles.actionPanel}>
            {isCurrentUser ? (
              <>
                <Text style={styles.panelTitle}>Your profile</Text>
                <View style={styles.ownerActions}>
                  <TouchableOpacity 
                    style={styles.ownerButton} 
                    activeOpacity={0.82}
                    onPress={() => {
                      navigate('FinalizeInvite', {
                        isEditMode: true,
                        returnTo: 'Profile',
                        gender: myProfile?.gender || '',
                        existingAvatarData: myProfile?.avatarData
                      });
                    }}
                  >
                    <MaterialIcons name="face-retouching-natural" size={18} color="#836A07" />
                    <Text style={styles.ownerButtonText}>Edit Avatar</Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity 
                    style={styles.ownerButton} 
                    activeOpacity={0.82}
                    onPress={() => navigate('Earnings')}
                  >
                    <MaterialIcons name="account-balance-wallet" size={18} color="#836A07" />
                    <Text style={styles.ownerButtonText}>Earnings</Text>
                  </TouchableOpacity>


                </View>
              </>
            ) : (
              <>
                <View style={styles.panelHeaderRow}>
                  <Text style={styles.panelTitle}>Available now</Text>
                  <TouchableOpacity
                    activeOpacity={0.82}
                    style={[styles.followButton, isFollowing && styles.followingButton]}
                    hitSlop={tap34}
                    onPress={async () => {
                      const myUid = auth.currentUser?.uid;
                      if (!myUid || !targetUid) {
                        setIsFollowing(true);
                        return;
                      }
                      try {
                        if (isFollowing) {
                          setIsFollowing(false);
                          await unfollowUser(myUid, targetUid);
                        } else {
                          setIsFollowing(true);
                          await followUser(myUid, targetUid);
                        }
                      } catch (e) {
                        setIsFollowing((prev) => !prev);
                      }
                    }}
                  >
                    <MaterialIcons
                      name={isFollowing ? 'check' : 'person-add-alt-1'}
                      size={16}
                      color={isFollowing ? '#806806' : '#FFF7FF'}
                    />
                    <Text style={[styles.followButtonText, isFollowing && styles.followingButtonText]}>
                      {isFollowing ? 'Following' : 'Follow'}
                    </Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.modeRow}>
                  {profile.modes.map((mode: any) => (
                    <ModeButton key={mode} mode={mode} profile={profile as any} navigate={navigate} />
                  ))}
                </View>
                <View style={styles.secondaryActions}>
                  <TouchableOpacity
                    activeOpacity={0.84}
                    style={styles.chatButton}
                    hitSlop={tap42}
                    onPress={() => navigate('Chat', { profileName: profile.name })}
                  >
                    <MaterialIcons name="chat-bubble-outline" size={18} color="#4B0054" />
                    <Text style={styles.chatButtonText}>Chat</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    activeOpacity={0.84}
                    style={[styles.blockButton, isBlocked && styles.blockButtonActive]}
                    hitSlop={tap42}
                    onPress={() => setIsBlocked((value) => !value)}
                  >
                    <MaterialIcons
                      name={isBlocked ? 'block' : 'person-off'}
                      size={18}
                      color={isBlocked ? '#FFFFFF' : '#8B2E2E'}
                    />
                    <Text style={[styles.blockButtonText, isBlocked && styles.blockButtonTextActive]}>
                      {isBlocked ? 'Blocked' : 'Block'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>

          <View style={styles.infoPanel}>
            <View style={styles.infoItem}>
              <MaterialIcons name="verified" size={20} color="#92750B" />
              <Text style={styles.infoText}>
                {isCurrentUser ? 'Your profile is premium verified' : 'Premium verified member'}
              </Text>
            </View>
            <View style={styles.infoItem}>
              <MaterialIcons name="schedule" size={20} color="#92750B" />
              <Text style={styles.infoText}>
                {isCurrentUser ? 'Manage followers and following here' : 'Usually responds quickly'}
              </Text>
            </View>
          </View>
        </ScrollView>

        <BottomNav active="Home" navigate={navigate} />
      </View>

      {/* A native Modal, not a plain absolutely-positioned View: on Android
          zIndex only affects paint order, so an overlay declared as a sibling
          loses touch dispatch to the content behind it. */}
      <Modal
        visible={isEditModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsEditModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Profile</Text>
              <TouchableOpacity onPress={() => setIsEditModalVisible(false)}
                accessibilityRole="button"
                accessibilityLabel="Close">
                <MaterialIcons name="close" size={24} color="#5A155A" />
              </TouchableOpacity>
            </View>
            
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Name (Nickname)</Text>
              <TextInput
                style={styles.htmlInput as any}
                value={editForm.nickname}
                onChangeText={(text) => setEditForm(f => ({ ...f, nickname: text }))}
                placeholder="Enter your name"
                placeholderTextColor="#A8998C"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Age</Text>
              <TextInput
                style={styles.htmlInput as any}
                value={editForm.age}
                onChangeText={(text) => setEditForm(f => ({ ...f, age: text }))}
                placeholder="Enter your age"
                placeholderTextColor="#A8998C"
                keyboardType="numeric"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Language</Text>
              <TextInput
                style={styles.htmlInput as any}
                value={editForm.language}
                onChangeText={(text) => setEditForm(f => ({ ...f, language: text }))}
                placeholder="e.g. English, French"
                placeholderTextColor="#A8998C"
                autoCapitalize="words"
              />
            </View>
            
            <Text style={styles.modalHint}>Note: Username cannot be changed.</Text>

            <TouchableOpacity 
              style={[styles.saveButton, isSaving && { opacity: 0.7 }]} 
              activeOpacity={0.8}
              disabled={isSaving}
              onPress={async () => {
                if (!auth.currentUser || isSaving) return;

                const nickname = editForm.nickname.trim();
                if (!nickname) {
                  Alert.alert('Name required', 'Please enter a name to display.');
                  return;
                }
                // Age drives who can see and call this profile, so it has to be
                // a real number rather than whatever the field happens to hold.
                const age = parseInt(editForm.age, 10);
                if (editForm.age.trim() && (Number.isNaN(age) || age < 18 || age > 120)) {
                  Alert.alert('Check your age', 'Please enter an age between 18 and 120.');
                  return;
                }

                setIsSaving(true);
                try {
                  const formattedLang = editForm.language
                    .trim()
                    .split(/\s+/)
                    .map(word => word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : '')
                    .join(' ');

                  await saveUserProfile(auth.currentUser.uid, {
                    nickname,
                    ...(editForm.age.trim() ? { age } : {}),
                    language: formattedLang,
                    avatarUrl: myProfile?.avatarUrl || '' // Preserve existing or default
                  });
                  setIsEditModalVisible(false);
                } catch (e) {
                  console.error('Save failed', e);
                  Alert.alert('Could not save', 'Your changes were not saved. Please try again.');
                } finally {
                  setIsSaving(false);
                }
              }}
            >
              <Text style={styles.saveButtonText}>{isSaving ? 'Saving...' : 'Save Changes'}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  phone: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 430,
    backgroundColor: '#FFFCF7',
  },
  header: {
    height: 70,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#F0E7DA',
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF8EA',
  },
  headerTitle: {
    color: '#4B0054',
    fontFamily: 'serif',
    fontSize: 28,
    fontWeight: '900',
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  headerIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF8EA',
  },
  scroll: {
    padding: 18,
    paddingBottom: 128,
    gap: 14,
  },
  heroCard: {
    minHeight: 300,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 20,
    borderWidth: 1,
    borderColor: '#EAD9AE',
    boxShadow: Platform.OS === 'web' ? '0 10px 22px rgba(68, 44, 21, 0.11)' : undefined,
  },
  avatarRing: {
    width: 128,
    height: 128,
    borderRadius: 64,
    padding: 4,
    boxShadow: Platform.OS === 'web' ? '0 12px 22px rgba(75, 0, 84, 0.16)' : undefined,
  },
  avatarInner: {
    flex: 1,
    borderRadius: 60,
    padding: 3,
    overflow: 'hidden',
    backgroundColor: '#FFFDF8',
  },
  avatar: {
    width: '100%',
    height: '100%',
    borderRadius: 57,
  },
  avatarEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F2ECE4',
  },
  tierPill: {
    marginTop: -10,
    height: 26,
    paddingHorizontal: 12,
    borderRadius: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FFF8DD',
    borderWidth: 1,
    borderColor: '#E9D383',
  },
  tierText: {
    color: '#8F6920',
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  name: {
    marginTop: 12,
    color: '#4B0054',
    fontFamily: 'serif',
    fontSize: 28,
    fontWeight: '900',
  },
  languageRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  language: {
    color: '#9A856E',
    fontSize: 12,
    fontWeight: '900',
  },
  statusRow: {
    marginTop: 12,
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#F3FAED',
  },
  onlineDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#73BB58',
  },
  statusText: {
    color: '#5E8D48',
    fontSize: 12,
    fontWeight: '900',
  },
  statsRow: {
    width: '100%',
    marginTop: 14,
    borderRadius: 16,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 253, 248, 0.72)',
    borderWidth: 1,
    borderColor: '#EFE2C8',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  statValue: {
    color: '#4B0054',
    fontSize: 18,
    fontWeight: '900',
  },
  statLabel: {
    color: '#9A856E',
    fontSize: 10,
    fontWeight: '900',
  },
  statDivider: {
    width: 1,
    height: 30,
    backgroundColor: '#E8DCCB',
  },
  bio: {
    marginTop: 12,
    color: '#766A62',
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    fontWeight: '700',
  },
  actionPanel: {
    padding: 18,
    borderRadius: 18,
    backgroundColor: '#FFFDF8',
    borderWidth: 1,
    borderColor: '#EFE4D3',
    gap: 14,
    boxShadow: Platform.OS === 'web' ? '0 10px 22px rgba(70, 47, 27, 0.1)' : undefined,
  },
  panelTitle: {
    color: '#5C3B23',
    fontFamily: 'serif',
    fontSize: 18,
    fontWeight: '900',
  },
  panelHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  followButton: {
    height: 34,
    borderRadius: 17,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: '#4B0054',
  },
  followingButton: {
    backgroundColor: '#FFF5D8',
    borderWidth: 1,
    borderColor: '#E1C460',
  },
  followButtonText: {
    color: '#FFF7FF',
    fontSize: 11,
    fontWeight: '900',
  },
  followingButtonText: {
    color: '#806806',
  },
  ownerActions: {
    flexDirection: 'row',
    gap: 10,
  },
  ownerButton: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: '#FFF5D8',
    borderWidth: 1,
    borderColor: '#E1C460',
  },
  ownerButtonText: {
    color: '#836A07',
    fontSize: 12,
    fontWeight: '900',
  },
  modeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  modeButton: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: '#7A256D',
    borderWidth: 1,
    borderColor: '#7A256D',
  },
  modeButtonVideo: {},
  modeText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '900',
  },
  modeTextVideo: {},
  secondaryActions: {
    flexDirection: 'row',
    gap: 10,
  },
  chatButton: {
    flex: 1,
    height: 42,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: '#FFFDF8',
    borderWidth: 1,
    borderColor: '#DCC7E1',
  },
  chatButtonText: {
    color: '#4B0054',
    fontSize: 12,
    fontWeight: '900',
  },
  blockButton: {
    flex: 1,
    height: 42,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: '#FFF6F1',
    borderWidth: 1,
    borderColor: '#E7B7A8',
  },
  blockButtonActive: {
    backgroundColor: '#8B2E2E',
    borderColor: '#8B2E2E',
  },
  blockButtonText: {
    color: '#8B2E2E',
    fontSize: 12,
    fontWeight: '900',
  },
  blockButtonTextActive: {
    color: '#FFFFFF',
  },
  infoPanel: {
    padding: 18,
    borderRadius: 18,
    backgroundColor: '#FFFDF8',
    borderWidth: 1,
    borderColor: '#EFE4D3',
    gap: 12,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  infoText: {
    color: '#74685F',
    fontSize: 13,
    fontWeight: '800',
  },
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(50, 16, 36, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modalContent: {
    width: '90%',
    maxWidth: 360,
    backgroundColor: '#FFFDF8',
    borderRadius: 20,
    padding: 24,
    boxShadow: Platform.OS === 'web' ? '0 20px 40px rgba(0,0,0,0.2)' : undefined,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    color: '#4B0054',
    fontFamily: 'serif',
    fontSize: 22,
    fontWeight: '900',
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    color: '#8A6715',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  htmlInput: {
    width: '100%',
    height: 44,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EFE4D3',
    backgroundColor: '#FFF',
    color: '#4B0054',
    fontSize: 15,
    fontWeight: '600',
  },
  modalHint: {
    color: '#A8998C',
    fontSize: 12,
    fontStyle: 'italic',
    marginBottom: 24,
    textAlign: 'center',
  },
  saveButton: {
    height: 48,
    borderRadius: 14,
    backgroundColor: '#4B0054',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: {
    color: '#FFF7FF',
    fontSize: 15,
    fontWeight: '800',
  },
});
