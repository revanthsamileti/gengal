import React, { useState, useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Platform,
  TouchableWithoutFeedback,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

interface AlertButton {
  text?: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
}

interface AlertState {
  visible: boolean;
  title: string;
  message?: string;
  buttons?: AlertButton[];
  options?: any; // e.g., cancelable
}

let customAlertRef: any = null;

export const CustomAlert = () => {
  const [state, setState] = useState<AlertState>({
    visible: false,
    title: '',
  });

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    // Expose the imperative method
    customAlertRef = {
      alert: (title: string, message?: string, buttons?: AlertButton[], options?: any) => {
        setState({
          visible: true,
          title: String(title || ''),
          message: message ? String(message) : undefined,
          buttons: buttons || [{ text: 'OK', onPress: () => {} }],
          options,
        });
      },
    };
    return () => {
      customAlertRef = null;
    };
  }, []);

  useEffect(() => {
    if (state.visible) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 7,
          tension: 100,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 0.9,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [state.visible]);

  const handleClose = (onPress?: () => void) => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 0.9,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setState(prev => ({ ...prev, visible: false }));
      if (onPress) onPress();
    });
  };

  const handleBackdropPress = () => {
    if (state.options?.cancelable !== false) {
      handleClose();
    }
  };

  // Safe wrapper for React Native Animated interpolation issues
  const overlayOpacity = fadeAnim;
  
  if (!state.visible && (fadeAnim as any)._value === 0) return null;

  return (
    <Modal
      transparent
      visible={state.visible || (fadeAnim as any)._value > 0}
      animationType="none"
      onRequestClose={handleBackdropPress}
    >
      <TouchableWithoutFeedback onPress={handleBackdropPress}>
        <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
          <TouchableWithoutFeedback>
            <Animated.View style={[styles.alertContainer, { transform: [{ scale: scaleAnim }] }]}>
              <LinearGradient
                colors={['#2A082F', '#18031A', '#0D010F']}
                style={styles.gradientBg}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <Text style={styles.title}>{state.title}</Text>
                {!!state.message && <Text style={styles.message}>{state.message}</Text>}

                <View style={styles.buttonContainer}>
                  {state.buttons?.map((btn, index) => {
                    const isDestructive = btn.style === 'destructive';
                    const isCancel = btn.style === 'cancel';
                    
                    return (
                      <TouchableOpacity
                        key={index}
                        activeOpacity={0.8}
                        onPress={() => handleClose(btn.onPress)}
                        style={[
                          styles.button,
                          isCancel && styles.buttonCancel,
                          isDestructive && styles.buttonDestructive,
                        ]}
                      >
                        {!isCancel && !isDestructive ? (
                          <LinearGradient
                            colors={['#D49A0B', '#B17A00', '#F6D96B']}
                            style={styles.buttonGradient}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 0 }}
                          >
                            <Text style={styles.buttonText}>{btn.text || 'OK'}</Text>
                          </LinearGradient>
                        ) : (
                          <Text style={[
                            styles.buttonText, 
                            isCancel && styles.buttonTextCancel,
                            isDestructive && styles.buttonTextDestructive
                          ]}>
                            {btn.text || 'Cancel'}
                          </Text>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </LinearGradient>
            </Animated.View>
          </TouchableWithoutFeedback>
        </Animated.View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

// Export the imperative API
export const Alert = {
  alert: (title: string, message?: string, buttons?: AlertButton[], options?: any) => {
    if (customAlertRef && customAlertRef.alert) {
      customAlertRef.alert(title, message, buttons, options);
    } else {
      // Fallback if not mounted yet (should rarely happen)
      console.warn('CustomAlert not mounted, falling back to console');
      console.log(`Alert: ${title} - ${message}`);
      if (buttons && buttons.length > 0) {
          buttons[0].onPress && buttons[0].onPress();
      }
    }
  },
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  alertContainer: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    boxShadow: Platform.OS === 'web' ? '0 20px 40px rgba(0,0,0,0.6)' : undefined,
    elevation: 20,
  },
  gradientBg: {
    padding: 24,
    alignItems: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFF',
    marginBottom: 8,
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  message: {
    fontSize: 15,
    color: 'rgba(255, 255, 255, 0.75)',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    width: '100%',
    gap: 12,
  },
  button: {
    minWidth: 110,
    height: 48,
    borderRadius: 24,
    overflow: 'hidden',
    flex: 1,
  },
  buttonCancel: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonDestructive: {
    backgroundColor: 'rgba(235, 87, 87, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(235, 87, 87, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonGradient: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#341505',
  },
  buttonTextCancel: {
    color: '#FFF',
    fontWeight: '700',
  },
  buttonTextDestructive: {
    color: '#FF6B6B',
    fontWeight: '700',
  },
});
