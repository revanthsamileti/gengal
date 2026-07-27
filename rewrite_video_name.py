import sys

with open('src/screens/CallScreen.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. Add RtcSurfaceView import
import_target = "import ConnectingOverlay from '../components/ConnectingOverlay';"
import_replacement = "import ConnectingOverlay from '../components/ConnectingOverlay';\n\nlet RtcSurfaceView: any = null;\nif (Platform.OS !== 'web') {\n  try {\n    RtcSurfaceView = require('react-native-agora').RtcSurfaceView;\n  } catch (e) {}\n}"

if import_target in code:
    code = code.replace(import_target, import_replacement)
    print("Added RtcSurfaceView.")

# 2. Fix createCallOffer username
offer_target = """          if (isCaller && matchData?.uid && user) {
            const myName = currentUserProfile?.name || currentUserProfile?.nickname || user.displayName || 'Someone';
            const myAvatar = currentUserProfile?.avatarUrl || user.photoURL || null;
            await createCallOffer(user.uid, matchData.uid, myName, myAvatar, mode as any, roomId);"""

offer_replacement = """          if (isCaller && matchData?.uid && user) {
            let myName = currentUserProfile?.name || currentUserProfile?.nickname || user.displayName;
            let myAvatar = currentUserProfile?.avatarUrl || user.photoURL;

            if (!myName || !myAvatar) {
              try {
                const { getUserProfile } = await import('../services/userService');
                const p = await getUserProfile(user.uid);
                if (p) {
                  myName = p.name || p.nickname || myName;
                  myAvatar = p.avatarUrl || myAvatar;
                }
              } catch (e) {
                console.warn("[CallScreen] Could not fetch profile for offer", e);
              }
            }
            myName = myName || 'Someone';

            await createCallOffer(user.uid, matchData.uid, myName, myAvatar || null, mode as any, roomId);"""

if offer_target in code:
    code = code.replace(offer_target, offer_replacement)
    print("Fixed createCallOffer.")

# 3. Fix remote video render
remote_video_target = """        {areCamerasOn ? (
          <Image source={{ uri: profile.uri }} style={styles.videoRemoteImage} />
        ) : ("""

remote_video_replacement = """        {areCamerasOn ? (
          (RtcSurfaceView && currentProvider === 'agora' && remoteUids.length > 0) ? (
            <RtcSurfaceView canvas={{ uid: remoteUids[0] }} style={styles.videoRemoteImage} />
          ) : (
            <Image source={{ uri: profile.uri }} style={styles.videoRemoteImage} />
          )
        ) : ("""

if remote_video_target in code:
    code = code.replace(remote_video_target, remote_video_replacement)
    print("Fixed remote video render.")

# 4. Fix self preview video render
self_video_target = """        <View style={[styles.selfPreview, !areCamerasOn && styles.selfPreviewOff]}>
          {areCamerasOn ? (
            <Image source={{ uri: currentUserProfile?.avatarUrl || ''  }} style={styles.selfPreviewImage} />
          ) : ("""

self_video_replacement = """        <View style={[styles.selfPreview, !areCamerasOn && styles.selfPreviewOff]}>
          {areCamerasOn ? (
            (RtcSurfaceView && currentProvider === 'agora') ? (
              <RtcSurfaceView canvas={{ uid: 0 }} style={styles.selfPreviewImage} />
            ) : (
              <Image source={{ uri: currentUserProfile?.avatarUrl || ''  }} style={styles.selfPreviewImage} />
            )
          ) : ("""

if self_video_target in code:
    code = code.replace(self_video_target, self_video_replacement)
    print("Fixed self preview video render.")

with open('src/screens/CallScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

print("Finished!")
