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
import { colors, gradients } from '../theme/colors';
import { skeuo, skeuoGradients } from '../theme/skeuomorphic';
import { getActiveTone, Tone } from '../theme/activeTone';

/**
 * The app-wide dialog. Screens import `Alert` from here instead of from
 * react-native so every confirmation and error lands in the app's own language
 * rather than the stark OS dialog, which reads as another app entirely.
 *
 * It comes in both of the app's tones and picks the one matching whichever
 * shell is on screen when the alert fires, so a dialog raised over an in-call
 * screen is not a slab of cream dropped onto black.
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
  /**
   * Scrim / back dismissal. Defaults to true only when a cancel button exists,
   * so forced confirmations cannot be dismissed by tapping outside.
   */
  cancelable?: boolean;
  /** Icon + tint. Inferred as 'danger' when a destructive button is present. */
  variant?: AlertVariant;
  /** Overrides the on-screen shell's tone. Only needed by screens that paint
   *  their own backdrop instead of using ScreenShell. */
  tone?: Tone;
}

interface AlertItem {
  id: number;
  title: string;
  message?: string;
  buttons: AlertButton[];
  tone: Tone;
  options?: AlertOptions;
}

let customAlertRef: { alert: (item: Omit<AlertItem, 'id'>) => void } | null = null;
let nextId = 1;

interface Palette {
  scrim: string;
  card: readonly [string, string, string];
  border: string;
  bevel: string;
  title: string;
  message: string;
  primary: readonly [string, string, string];
  primaryLabel: string;
  cancelBg: string;
  cancelBorder: string;
  cancelLabel: string;
  destructive: readonly [string, string];
  destructiveLabel: string;
  badge: Record<AlertVariant, { fg: string; bg: string }>;
}

/**
 * Both palettes are built from the tokens their own shell already uses, so the
 * dialog moves with the theme rather than carrying a private copy of it.
 */
const PALETTES: Record<Tone, Palette> = {
  light: {
    // Warm plum rather than neutral black: a grey scrim over a cream app reads
    // as a dead screen, this reads as the app dimmed.
    scrim: 'rgba(43, 22, 40, 0.52)',
    card: skeuoGradients.raised,
    border: skeuo.border,
    bevel: 'rgba(255, 255, 255, 0.9)',
    title: skeuo.plum,
    message: '#8A7C70',
    primary: skeuoGradients.gold,
    primaryLabel: '#422006',
    cancelBg: skeuo.surfaceInset,
    cancelBorder: '#E4D5BC',
    cancelLabel: skeuo.plum,
    destructive: ['#D2635C', '#B23B36'],
    destructiveLabel: '#FFFFFF',
    badge: {
      info: { fg: skeuo.plum, bg: '#F6ECF7' },
      success: { fg: '#2E7D5B', bg: '#E9F5ED' },
      warning: { fg: skeuo.gold, bg: '#FDF3DC' },
      danger: { fg: '#B23B36', bg: '#FBEAE7' },
    },
  },
  dark: {
    scrim: 'rgba(4, 2, 6, 0.72)',
    card: [colors.backgroundCardHover, colors.backgroundCard, colors.primaryDark],
    border: colors.borderGold,
    bevel: 'rgba(255, 255, 255, 0.08)',
    title: colors.textPrimary,
    message: colors.textSecondary,
    primary: gradients.goldCTA,
    primaryLabel: '#2A1A05',
    cancelBg: 'rgba(255, 255, 255, 0.07)',
    cancelBorder: 'rgba(255, 255, 255, 0.14)',
    cancelLabel: colors.goldLight,
    destructive: ['#C25752', '#8E2B27'],
    destructiveLabel: '#FFFFFF',
    badge: {
      info: { fg: colors.goldLight, bg: 'rgba(201, 168, 76, 0.14)' },
      success: { fg: colors.success, bg: 'rgba(92, 184, 138, 0.14)' },
      warning: { fg: colors.gold, bg: 'rgba(201, 168, 76, 0.16)' },
      danger: { fg: '#FF8A80', bg: 'rgba(232, 93, 117, 0.16)' },
    },
  },
};

const VARIANT_ICONS: Record<AlertVariant, keyof typeof MaterialIcons.glyphMap> = {
  info: 'info-outline',
  success: 'check-circle-outline',
  warning: 'error-outline',
  danger: 'warning-amber',
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
    const cancelBtn = current.buttons.find((b) => b.style === 'cancel');
    const cancelable = current.options?.cancelable ?? Boolean(cancelBtn);
    if (!cancelable) return;
    close(cancelBtn?.onPress);
  }, [current, close]);

  if (!current) return null;

  const palette = PALETTES[current.tone];
  const variant = resolveVariant(current);
  const badge = variant ? palette.badge[variant] : null;
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
        <Animated.View
          style={[styles.scrim, { backgroundColor: palette.scrim, opacity: fadeAnim }]}
        >
          <TouchableWithoutFeedback accessible={false}>
            <Animated.View
              accessibilityViewIsModal
              style={[
                styles.card,
                { borderColor: palette.border, transform: [{ scale: scaleAnim }] },
              ]}
            >
              <LinearGradient
                colors={[...palette.card]}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0.5, y: 1 }}
                style={styles.cardBody}
              >
                {/* The lit top edge that every raised surface in the app has. */}
                <View pointerEvents="none" style={[styles.bevel, { backgroundColor: palette.bevel }]} />

                {badge && variant && (
                  <View style={[styles.badge, { backgroundColor: badge.bg }]}>
                    <MaterialIcons name={VARIANT_ICONS[variant]} size={30} color={badge.fg} />
                  </View>
                )}

                <Text style={[styles.title, { color: palette.title }]} accessibilityRole="header">
                  {current.title}
                </Text>

                {!!current.message && (
                  <ScrollView
                    style={styles.messageScroll}
                    contentContainerStyle={styles.messageContent}
                    showsVerticalScrollIndicator={false}
                    bounces={false}
                  >
                    <Text style={[styles.message, { color: palette.message }]}>
                      {current.message}
                    </Text>
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
                          <View
                            style={[
                              styles.buttonFill,
                              styles.buttonCancel,
                              { backgroundColor: palette.cancelBg, borderColor: palette.cancelBorder },
                            ]}
                          >
                            <Text
                              style={[styles.buttonLabel, { color: palette.cancelLabel }]}
                              numberOfLines={1}
                            >
                              {label}
                            </Text>
                          </View>
                        ) : (
                          <LinearGradient
                            colors={
                              isDestructive ? [...palette.destructive] : [...palette.primary]
                            }
                            start={{ x: 0.5, y: 0 }}
                            end={{ x: 0.5, y: 1 }}
                            style={styles.buttonFill}
                          >
                            <Text
                              style={[
                                styles.buttonLabel,
                                {
                                  color: isDestructive
                                    ? palette.destructiveLabel
                                    : palette.primaryLabel,
                                },
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
      // Read now rather than at render time: an alert raised just before a
      // navigation would otherwise recolour itself mid-display when the next
      // screen's shell takes over.
      tone: options?.tone ?? getActiveTone(),
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
    borderWidth: 1,
    borderRadius: 25,
  },
  buttonLabel: {
    fontSize: 15,
    fontWeight: '800',
  },
});
