import { Platform, Vibration } from 'react-native';

/**
 * Ringtone / ringback playback for the call screens.
 *
 * `assets/ringtone.wav` and `assets/sounds/ring.wav` have been committed since
 * the first import but were referenced nowhere, so an inbound call arrived in
 * total silence: the only audible cue was whatever the OS did with the push
 * notification, and that never fires while the app is already in the
 * foreground. A ringing phone that makes no noise is a missed call.
 *
 * expo-audio is loaded lazily because it has no web implementation and is
 * absent from Expo Go, and a ringtone must never be the reason a call screen
 * fails to mount.
 */
let Audio: any = null;
try {
  Audio = require('expo-audio');
} catch (e) {
  console.warn('[Ringtone] expo-audio is unavailable in this build:', e);
}

export type RingtoneKind = 'incoming' | 'outgoing';

const SOURCES: Record<RingtoneKind, any> = {
  incoming: require('../../assets/ringtone.wav'),
  outgoing: require('../../assets/sounds/ring.wav'),
};

// Roughly "ring ... pause ... ring", repeated. Android reads the first entry as
// an initial delay; iOS ignores the durations and just buzzes per entry.
const VIBRATION_PATTERN = [0, 700, 900];

let player: any = null;
let activeKind: RingtoneKind | null = null;
let audioModeApplied = false;

const applyAudioMode = async () => {
  if (audioModeApplied || !Audio?.setAudioModeAsync) return;
  audioModeApplied = true;
  try {
    // A call is exactly the case where playing through the silent switch is the
    // expected behaviour. `interruptionMode` is deliberately left alone: the
    // RTC engine owns the audio session once the call connects, and forcing a
    // mode here has been enough to leave the session in a bad state on Android.
    await Audio.setAudioModeAsync({ playsInSilentMode: true });
  } catch (e) {
    console.warn('[Ringtone] Could not set audio mode:', e);
  }
};

/**
 * Starts looping the given tone. Calling it again with the same kind is a
 * no-op, so it is safe to drive straight from render/effect state.
 */
export const startRingtone = async (kind: RingtoneKind, vibrate = kind === 'incoming') => {
  if (activeKind === kind) return;
  stopRingtone();

  activeKind = kind;

  if (vibrate && Platform.OS !== 'web') {
    try {
      Vibration.vibrate(VIBRATION_PATTERN, true);
    } catch (e) {
      console.warn('[Ringtone] Vibration failed:', e);
    }
  }

  if (!Audio?.createAudioPlayer) return;

  try {
    await applyAudioMode();
    // The call may have been answered while the audio mode was being applied.
    if (activeKind !== kind) return;

    const p = Audio.createAudioPlayer(SOURCES[kind]);
    p.loop = true;
    p.play();
    player = p;
  } catch (e) {
    console.warn('[Ringtone] Playback failed:', e);
  }
};

/**
 * Stops whatever is ringing and releases the player. `createAudioPlayer` does
 * not auto-release, so skipping `remove()` leaks a native player per call.
 */
export const stopRingtone = () => {
  activeKind = null;

  if (Platform.OS !== 'web') {
    try {
      Vibration.cancel();
    } catch {
      /* no vibrator on this device */
    }
  }

  if (!player) return;
  const p = player;
  player = null;
  try {
    p.pause();
  } catch {
    /* already torn down */
  }
  try {
    p.remove();
  } catch {
    /* already released */
  }
};
