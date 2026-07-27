import sys

with open('src/screens/CallScreen.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. Add expo-av import
import_target = "import { MaterialIcons } from '@expo/vector-icons';"
import_replacement = "import { MaterialIcons } from '@expo/vector-icons';\nimport { Audio } from 'expo-av';"
if import_target in code:
    code = code.replace(import_target, import_replacement)
    print("Added expo-av import.")

# 2. Replace Vibration useEffect with Vibration + Ringtone
vibe_target = """  // Vibrate for incoming calls
  React.useEffect(() => {
    if (isIncomingPendingState) {
      Vibration.vibrate([0, 1000, 1000], true);
    } else {
      Vibration.cancel();
    }
    return () => {
      Vibration.cancel();
    };
  }, [isIncomingPendingState]);"""

vibe_replacement = """  const soundRef = React.useRef<Audio.Sound | null>(null);

  // Vibrate and Ring for incoming calls
  React.useEffect(() => {
    const playRingtone = async () => {
      try {
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
        const { sound } = await Audio.Sound.createAsync(
           require('../../assets/sounds/ring.wav'),
           { isLooping: true }
        );
        soundRef.current = sound;
        if (isIncomingPendingState) {
          await sound.playAsync();
        } else {
          await sound.unloadAsync();
        }
      } catch (e) {
        console.warn("Could not play ringtone", e);
      }
    };

    if (isIncomingPendingState) {
      Vibration.vibrate([0, 1000, 1000], true);
      playRingtone();
    } else {
      Vibration.cancel();
      if (soundRef.current) {
        soundRef.current.stopAsync().then(() => soundRef.current?.unloadAsync());
      }
    }
    return () => {
      Vibration.cancel();
      if (soundRef.current) {
        soundRef.current.stopAsync().then(() => soundRef.current?.unloadAsync());
      }
    };
  }, [isIncomingPendingState]);"""

if vibe_target in code:
    code = code.replace(vibe_target, vibe_replacement)
    print("Replaced Vibration with Ringtone.")

with open('src/screens/CallScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

print("CallScreen.tsx updated for ringtone.")
