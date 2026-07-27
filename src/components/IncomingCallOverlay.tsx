import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, Animated, Easing, Dimensions, Platform, Image } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { IncomingCall, acceptCallOffer, rejectCallOffer } from '../services/liveRoomService';
import GengalAvatar from './GengalAvatar';
import { LinearGradient } from 'expo-linear-gradient';

interface Props {
  call: IncomingCall | null;
  onAccept: (call: IncomingCall) => void;
  onReject: () => void;
  receiverUid: string;
}

const { width } = Dimensions.get('window');
const SCREEN_WIDTH = Math.min(width, 430);

export default function IncomingCallOverlay({ call, onAccept, onReject, receiverUid }: Props) {
  const slideAnim = useRef(new Animated.Value(-200)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (call) {
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 60,
        friction: 8,
        useNativeDriver: false,
      }).start();

      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.1,
            duration: 800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          })
        ])
      ).start();
    } else {
      slideAnim.setValue(-200);
      pulseAnim.setValue(1);
    }
  }, [call]);

  if (!call) return null;

  const handleAccept = async () => {
    try {
      await acceptCallOffer(receiverUid);
      onAccept(call);
    } catch (e) {
      console.warn('Failed to accept call:', e);
    }
  };

  const handleReject = async () => {
    try {
      await rejectCallOffer(receiverUid);
      onReject();
    } catch (e) {
      console.warn('Failed to reject call:', e);
    }
  };

  const isVideo = call.mode === 'video';

  return (
    <View style={styles.overlayContainer} pointerEvents="box-none">
      <Animated.View style={[styles.banner, { transform: [{ translateY: slideAnim }] }]}>
        <LinearGradient
          colors={isVideo ? ['#61237A', '#3C1352'] : ['#228B22', '#006400']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.bannerBackground}
        >
          <View style={styles.callerInfo}>
            {call.callerAvatarUrl ? (
              <Image source={{ uri: call.callerAvatarUrl }} style={{ width: 48, height: 48, borderRadius: 24 }} />
            ) : (
              <View style={[styles.fallbackAvatar, isVideo ? { backgroundColor: '#8B1E8A' } : { backgroundColor: '#32CD32' }]}>
                <MaterialIcons name="person" size={24} color="#FFF" />
              </View>
            )}
            <View style={styles.textContainer}>
              <Text style={styles.callerName}>{call.callerName}</Text>
              <Text style={styles.callType}>Incoming {isVideo ? 'Video' : 'Voice'} Call...</Text>
            </View>
          </View>
          
          <View style={styles.actionRow}>
            <TouchableOpacity 
              activeOpacity={0.8} 
              style={[styles.actionBtn, styles.rejectBtn]}
              onPress={handleReject}
            >
              <MaterialIcons name="call-end" size={24} color="#FFF" />
            </TouchableOpacity>

            <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
              <TouchableOpacity 
                activeOpacity={0.8} 
                style={[styles.actionBtn, styles.acceptBtn]}
                onPress={handleAccept}
              >
                <MaterialIcons name={isVideo ? "videocam" : "call"} size={24} color="#FFF" />
              </TouchableOpacity>
            </Animated.View>
          </View>
        </LinearGradient>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlayContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 99999,
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 50 : 20,
  },
  banner: {
    width: SCREEN_WIDTH - 32,
    borderRadius: 20,
    overflow: 'hidden',
    boxShadow: Platform.OS === 'web' ? '0px 10px 30px rgba(0,0,0,0.3)' : undefined,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
  },
  bannerBackground: {
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  callerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  fallbackAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  textContainer: {
    marginLeft: 12,
    flex: 1,
  },
  callerName: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '700',
  },
  callType: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
    marginTop: 2,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  actionBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rejectBtn: {
    backgroundColor: '#FF3B30',
  },
  acceptBtn: {
    backgroundColor: '#34C759',
  }
});
