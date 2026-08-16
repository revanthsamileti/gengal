import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
  Alert as RNAlert,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

/**
 * The app-wide dialog. Screens import `Alert` from here instead of from
 * react-native so every confirmation and error lands in the app's own cream
 * skeuomorphic language (plum serif headings, gold CTAs, warm parchment card)
 * rather than the stark OS dialog, which reads as another app entirely.
 *
 * The imperative signature deliberately mirrors RN's `Alert.alert`, so call
 * sites need no ceremony and can be switched over by changing the import.
 */

/**
 * There is no native animated module on web, so asking for the native driver
 * there only earns a console warning before RN falls back to JS anyway. Ask
 * for it on the platforms that actually have it.
 */
const USE_NATIVE_DRIVER = Platform.OS !== 'web';

export type AlertVariant = 'info' | 'success' | 'warning' | 'danger';

interface AlertButton {
  text?: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
}

interface AlertOptions {
  /** Tapping the scrim or pressing back dismisses. Defaults to true. */
  cancelable?: boolean;
  /** Icon + tint. Inferred as 'danger' when a destructive button is present. */
  variant?: AlertVariant;
}

interface AlertItem {
  id: number;
  title: string;
  message?: string;
  buttons: AlertButton[];
  options?: AlertOptions;
}

let customAlertRef: { alert: (item: Omit<AlertItem, 'id'>) => void } | null = null;
let nextId = 1;

/** Icon and tint per variant, all drawn from the palette already in the app. */
const VARIANTS: Record<AlertVariant, { icon: keyof typeof MaterialIcons.glyphMap; fg: string; bg: string }> = {
  info: { icon: 'info-outline', fg: '#4B0054', bg: '#F6ECF7' },
  success: { icon: 'check-circle-outline', fg: '#2E7D5B', bg: '#E9F5ED' },
  warning: { icon: 'error-outline', fg: '#9A7A05', bg: '#FDF3DC' },
  danger: { icon: 'warning-amber', fg: '#B23B36', bg: '#FBEAE7' },
};

/**
 * Only shown when the intent is unambiguous: an explicit variant, or a
 * destructive button. Guessing from title wording would risk stamping a
 * reassuring icon on a message about money that did not go through.
 */
function resolveVariant(item: AlertItem): AlertVariant | null {
  if (item.options?.variant) return item.options.variant;
  if (item.buttons.some((b) => b.style === 'destructive')) return 'danger';
  return null;
}

/** Two short labels sit side by side; anything longer gets its own row. */
function shouldStack(buttons: AlertButton[]): boolean {
  if (buttons.length > 2) return true;
  return buttons.some((b) => (b.text || 'OK').length > 12);
}

export const CustomAlert = () => {
  // A queue, not a single slot: two failures in a row used to overwrite each
  // other, so the first error was never read. Each waits its turn instead.
  const [queue, setQueue] = useState<AlertItem[]>([]);
  const [reduceMotion, setReduceMotion] = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.92)).current;
  const isClosing = useRef(false);

  const current = queue[0];

  useEffect(() => {
    customAlertRef = {
      alert: (item) => setQueue((q) => [...q, { ...item, id: nextId++ }]),
    };
    return () => {
      customAlertRef = null;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (alive) setReduceMotion(enabled);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  // Animate in whenever a different alert reaches the front of the queue.
  useEffect(() => {
    if (!current) return;
    isClosing.current = false;
    fadeAnim.setValue(0);
    scaleAnim.setValue(reduceMotion ? 1 : 0.92);
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: reduceMotion ? 0 : 200,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 8,
        tension: 90,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
    ]).start();
  }, [current?.id, reduceMotion]);

  const close = useCallback(
    (onPress?: () => void) => {
      // Guards a double tap, and a tap that lands during the exit animation,
      // from running an action twice or dropping the next queued alert.
      if (isClosing.current) return;
      isClosing.current = true;

      const finish = () => {
        setQueue((q) => q.slice(1));
        if (onPress) onPress();
      };

      if (reduceMotion) {
        finish();
        return;
      }

      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 0, duration: 160, useNativeDriver: USE_NATIVE_DRIVER }),
        Animated.timing(scaleAnim, { toValue: 0.94, duration: 160, useNativeDriver: USE_NATIVE_DRIVER }),
      ]).start(finish);
    },
    [reduceMotion]
  );

  /**
   * Scrim tap and Android back. Runs the cancel button's handler when there is
   * one, so a caller that resets state in `cancel` is not left half-open just
   * because the dialog was dismissed from outside.
   */
  const handleDismiss = useCallback(() => {
    if (!current) return;
    if (current.options?.cancelable === false) return;
    const cancelBtn = current.buttons.find((b) => b.style === 'cancel');
    close(cancelBtn?.onPress);
  }, [current, close]);

  if (!current) return null;

  const variant = resolveVariant(current);
  const badge = variant ? VARIANTS[variant] : null;
  const stacked = shouldStack(current.buttons);

  return (
    <Modal
      transparent
      visible
      animationType="none"
      statusBarTranslucent
      onRequestClose={handleDismiss}
    >
      <TouchableWithoutFeedback onPress={handleDismiss} accessible={false}>
        <Animated.View style={[styles.scrim, { opacity: fadeAnim }]}>
          <TouchableWithoutFeedback accessible={false}>
            <Animated.View
              accessibilityViewIsModal
              style={[styles.card, { transform: [{ scale: scaleAnim }] }]}
            >
              <LinearGradient
                colors={['#FFFFFF', '#FFF9EE', '#F7EDDD']}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0.5, y: 1 }}
                style={styles.cardBody}
              >
                {/* The lit top edge that every raised surface in the app has. */}
                <View pointerEvents="none" style={styles.bevel} />

                {badge && (
                  <View style={[styles.badge, { backgroundColor: badge.bg }]}>
                    <MaterialIcons name={badge.icon} size={30} color={badge.fg} />
                  </View>
                )}

                <Text style={styles.title} accessibilityRole="header">
                  {current.title}
                </Text>

                {!!current.message && (
                  <ScrollView
                    style={styles.messageScroll}
                    contentContainerStyle={styles.messageContent}
                    showsVerticalScrollIndicator={false}
                    bounces={false}
                  >
                    <Text style={styles.message}>{current.message}</Text>
                  </ScrollView>
                )}

                <View style={[styles.actions, stacked && styles.actionsStacked]}>
                  {current.buttons.map((btn, index) => {
                    const isDestructive = btn.style === 'destructive';
                    const isCancel = btn.style === 'cancel';
                    const label = btn.text || (isCancel ? 'Cancel' : 'OK');

                    return (
                      <TouchableOpacity
                        key={index}
                        activeOpacity={0.85}
                        accessibilityRole="button"
                        accessibilityLabel={label}
                        onPress={() => close(btn.onPress)}
                        style={[styles.button, stacked ? styles.buttonFull : styles.buttonFlex]}
                      >
                        {isCancel ? (
                          <View style={[styles.buttonFill, styles.buttonCancel]}>
                            <Text style={[styles.buttonLabel, styles.labelCancel]} numberOfLines={1}>
                              {label}
                            </Text>
                          </View>
                        ) : (
                          <LinearGradient
                            colors={
                              isDestructive
                                ? ['#D2635C', '#B23B36']
                                : ['#FFF1BB', '#D0A92E', '#8F6D05']
                            }
                            start={{ x: 0.5, y: 0 }}
                            end={{ x: 0.5, y: 1 }}
                            style={styles.buttonFill}
                          >
                            <Text
                              style={[
                                styles.buttonLabel,
                                isDestructive ? styles.labelDestructive : styles.labelPrimary,
                              ]}
                              numberOfLines={1}
                            >
                              {label}
                            </Text>
                          </LinearGradient>
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

/** Drop-in replacement for RN's `Alert.alert`. */
export const Alert = {
  alert: (title: string, message?: string, buttons?: AlertButton[], options?: AlertOptions) => {
    const item = {
      title: String(title || ''),
      message: message ? String(message) : undefined,
      buttons: buttons?.length ? buttons : [{ text: 'OK' }],
      options,
    };

    if (customAlertRef) {
      customAlertRef.alert(item);
    } else {
      // Only reachable if an alert fires before the root <CustomAlert /> mounts.
      // Fall through to the platform dialog rather than auto-invoking the first
      // button, which would run an action the user never actually confirmed.
      RNAlert.alert(title, message, buttons as any, options as any);
    }
  },
};

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    // Warm plum rather than neutral black: a grey scrim over a cream app reads
    // as a dead screen, this reads as the app dimmed.
    backgroundColor: 'rgba(43, 22, 40, 0.52)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 26,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E9D9BE',
    boxShadow: Platform.OS === 'web' ? '0 18px 40px rgba(83, 58, 29, 0.28)' : undefined,
    elevation: 24,
  },
  cardBody: {
    paddingHorizontal: 24,
    paddingTop: 26,
    paddingBottom: 22,
    alignItems: 'center',
  },
  bevel: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
  },
  badge: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  title: {
    fontSize: 20,
    fontWeight: '900',
    color: '#4B0054',
    fontFamily: 'serif',
    textAlign: 'center',
  },
  messageScroll: {
    maxHeight: 220,
    marginTop: 10,
    alignSelf: 'stretch',
  },
  messageContent: {
    paddingHorizontal: 2,
  },
  message: {
    fontSize: 14.5,
    color: '#8A7C70',
    textAlign: 'center',
    lineHeight: 21,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    marginTop: 22,
    gap: 10,
  },
  actionsStacked: {
    flexDirection: 'column-reverse',
    gap: 10,
  },
  button: {
    height: 50,
    borderRadius: 25,
    overflow: 'hidden',
  },
  buttonFlex: {
    flex: 1,
  },
  buttonFull: {
    alignSelf: 'stretch',
  },
  buttonFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  buttonCancel: {
    backgroundColor: '#F3EBDD',
    borderWidth: 1,
    borderColor: '#E4D5BC',
    borderRadius: 25,
  },
  buttonLabel: {
    fontSize: 15,
    fontWeight: '800',
  },
  labelPrimary: {
    color: '#422006',
  },
  labelCancel: {
    color: '#4B0054',
  },
  labelDestructive: {
    color: '#FFFFFF',
  },
});
