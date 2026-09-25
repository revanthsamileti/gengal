import { Linking, PermissionsAndroid, Platform } from 'react-native';
import { Alert } from '../components/CustomAlert';
import { getUserProfile, isUserAvailableNow, isUserInCall } from './userService';

/**
 * Up-front microphone/camera gating for outbound calls.
 *
 * The RTC adapter (useGengalVoice.connectAgora) also checks these, but that
 * runs only *after* the receiver accepts — so a caller who had never granted
 * the microphone would ring the other person, wait for them to pick up, and
 * only then see the OS dialog, with the call dying either way. Checking at the
 * moment the Call button is pressed keeps that failure entirely on the caller's
 * side, before anyone else's phone rings.
 */

/** Whether the caller may place the call right now. */
export type CallPermissionOutcome =
  /** Already held. Place the call. */
  | 'granted'
  /** The OS dialog was just shown. Do not place the call; let them tap again. */
  | 'requested'
  /** Permanently denied. A settings prompt was shown; tapping again is futile. */
  | 'blocked';

/**
 * The microphone is mandatory: there is no degraded call without it. The camera
 * is requested alongside it for video calls but is never blocking — CallScreen
 * already downgrades a camera-less video call to voice (and to the voice rate).
 */
export async function ensureCallPermissions(
  mode: 'call' | 'video'
): Promise<CallPermissionOutcome> {
  // iOS and web have no runtime-permission API here; the native SDK prompts on
  // join, and web is rejected outright by the adapter.
  if (Platform.OS !== 'android') return 'granted';

  const MIC = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
  const CAM = PermissionsAndroid.PERMISSIONS.CAMERA;

  const needsCamera = mode === 'video';

  const hasMic = await PermissionsAndroid.check(MIC);
  const hasCam = needsCamera ? await PermissionsAndroid.check(CAM) : true;

  // The common path once a user has called before: straight through, no dialog.
  if (hasMic && hasCam) return 'granted';

  const wanted = [
    ...(hasMic ? [] : [MIC]),
    ...(needsCamera && !hasCam ? [CAM] : []),
  ];

  const results = await PermissionsAndroid.requestMultiple(wanted);

  // Mic is the hard gate; camera denial must not block placing a call.
  const micOk = hasMic || results[MIC] === PermissionsAndroid.RESULTS.GRANTED;

  // NEVER_ASK_AGAIN returns without a dialog — prompting "try again" would loop.
  if (!micOk && results[MIC] === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
    Alert.alert(
      'Microphone blocked',
      'GenGal needs microphone access to place calls. Turn it on in Settings, then try again.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open settings', onPress: () => void Linking.openSettings() },
      ]
    );
    return 'blocked';
  }

  return micOk ? 'granted' : 'requested';
}

/**
 * Whether the person can be called right now, checked against their live
 * record rather than the list the caller happened to be looking at.
 *
 * Those lists are snapshots: someone can close the app seconds after their
 * card is drawn, and a card that is a minute old is enough to ring a phone
 * nobody is holding. The caller then pays the full ring timeout to find out.
 *
 * Only a definite "no" stops the call. If the record cannot be read at all --
 * offline, a permissions blip -- the call goes ahead: refusing to dial because
 * a lookup failed would be a worse bug than the one this prevents.
 */
async function isReachableNow(uid: string): Promise<{ ok: boolean; reason?: 'offline' | 'busy' }> {
  try {
    const peer = await getUserProfile(uid);
    if (!peer) return { ok: true };
    if (isUserAvailableNow(peer)) return { ok: true };
    return { ok: false, reason: isUserInCall(peer) ? 'busy' : 'offline' };
  } catch {
    return { ok: true };
  }
}

/**
 * The single entry point every Call/Video button goes through: gate on
 * permissions and on the other person being reachable, and only navigate into
 * CallScreen once both hold.
 *
 * When the permission dialog had to be shown, this deliberately does nothing
 * further — the user grants, then taps Call again, and that second tap goes
 * straight through the `granted` path above.
 */
export async function launchCall(
  navigate: (screen: string, params?: any) => void,
  params: { mode: 'call' | 'video'; [key: string]: any }
): Promise<void> {
  const outcome = await ensureCallPermissions(params.mode);
  if (outcome !== 'granted') return;

  const peerUid: string | undefined = params.matchData?.uid;
  const peerName: string = params.profileName || params.matchData?.name || 'They';
  if (peerUid) {
    const { ok, reason } = await isReachableNow(peerUid);
    if (!ok) {
      Alert.alert(
        reason === 'busy' ? `${peerName} is on another call` : `${peerName} is offline`,
        reason === 'busy'
          ? 'Try again in a few minutes.'
          : 'You can call them when they are back online. Send a message in the meantime.',
        [{ text: 'OK' }]
      );
      return;
    }
  }
  navigate('Call', params);
}
