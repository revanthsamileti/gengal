import sys

with open('src/screens/CallScreen.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. Imports
code = code.replace(
    "import { cancelCallOffer, clearCallOffer, createCallOffer } from '../services/liveRoomService';",
    "import { cancelCallOffer, clearCallOffer, createCallOffer, acceptCallOffer, rejectCallOffer } from '../services/liveRoomService';\nimport { useAudioPlayer } from 'expo-audio';"
)

# 2. CallScreenProps
code = code.replace(
    "  navigate: (screen: string, params?: { profileName?: string; mode?: 'call' | 'video'; roomId?: string; matchData?: any; isCaller?: boolean }) => void;\n  goBack: () => void;\n};",
    "  navigate: (screen: string, params?: { profileName?: string; mode?: 'call' | 'video'; roomId?: string; matchData?: any; isCaller?: boolean; isIncomingPending?: boolean }) => void;\n  goBack: () => void;\n  isIncomingPending?: boolean;\n};"
)

# 3. Component Definition
code = code.replace(
    "export default function CallScreen({ profileName, mode = 'call', roomId, matchData, isCaller, navigate, goBack }: CallScreenProps) {",
    "export default function CallScreen({ profileName, mode = 'call', roomId, matchData, isCaller, navigate, goBack, isIncomingPending }: CallScreenProps) {"
)

# 4. State
code = code.replace(
    "  const [isConnecting, setIsConnecting] = useState(true);\n  const [activeRoomId] = useState(() => roomId || (auth.currentUser && matchData?.uid ? ${auth.currentUser.uid}__ : ''));\n\n  const [callDurationSeconds, setCallDurationSeconds] = useState(0);",
    "  const [isConnecting, setIsConnecting] = useState(true);\n  const [isIncomingPendingState, setIsIncomingPendingState] = useState(!!isIncomingPending);\n  const [activeRoomId] = useState(() => roomId || (auth.currentUser && matchData?.uid ? ${auth.currentUser.uid}__ : ''));\n\n  const [callDurationSeconds, setCallDurationSeconds] = useState(0);\n\n  const ringtonePlayer = useAudioPlayer(require('../../assets/ringtone.wav'));\n\n  React.useEffect(() => {\n    if (isIncomingPendingState) {\n      ringtonePlayer.loop = true;\n      ringtonePlayer.play();\n    } else {\n      ringtonePlayer.pause();\n    }\n  }, [isIncomingPendingState, ringtonePlayer]);"
)

# 5. establishSecureCall Early Return
code = code.replace(
    "    const establishSecureCall = async () => {\n      if (!activeRoomId) {",
    "    const establishSecureCall = async () => {\n      if (isIncomingPendingState) return;\n      \n      if (!activeRoomId) {"
)

# 6. Caller Timer Fix in establishSecureCall
code = code.replace(
    "          await connectSeat(activeRoomId, connectionToken, extraParam);\n          logDebugEvent('call.provider.join.success', {\n            roomId: activeRoomId,\n            provider: currentProvider,\n            uid: extraParam,\n          });\n          if (isMounted) setIsConnecting(false);\n        }",
    "          await connectSeat(activeRoomId, connectionToken, extraParam);\n          logDebugEvent('call.provider.join.success', {\n            roomId: activeRoomId,\n            provider: currentProvider,\n            uid: extraParam,\n          });\n          if (isMounted && !isCaller) {\n            setIsConnecting(false);\n          }\n        }"
)

# 7. Update establishSecureCall dependencies
code = code.replace(
    "      isMounted = false;\n      disconnectSeat();\n    };\n  }, [activeRoomId, currentProvider, isCaller, matchData?.uid]);",
    "      isMounted = false;\n      disconnectSeat();\n    };\n  }, [activeRoomId, currentProvider, isCaller, matchData?.uid, isIncomingPendingState]);"
)

# 8. Render full-page incoming call UI
render_connecting = '''  if (isConnecting) {
    return (
      <ConnectingOverlay
        mode={mode}
        peerName={profile.name}
        peerAvatarUrl={profile.uri}
        onCancel={() => {
          if (isCaller) handleEndCall();
          else goBack();
        }}
      />
    );
  }'''

render_incoming = '''  if (isIncomingPendingState) {
    return (
      <ScreenShell>
        <LinearGradient
          colors={isVideo ? ['#61237A', '#3C1352'] : ['#228B22', '#006400']}
          style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}
        >
          <GengalAvatar url={profile.uri} size={150} />
          <Text style={{ color: '#FFF', fontSize: 32, fontWeight: '700', marginTop: 30 }}>
            {profile.name}
          </Text>
          <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 18, marginTop: 10 }}>
            Incoming {isVideo ? 'Video' : 'Voice'} Call...
          </Text>

          <View style={{ flexDirection: 'row', position: 'absolute', bottom: 100, gap: 50 }}>
            <TouchableOpacity 
              activeOpacity={0.8} 
              style={{ width: 70, height: 70, borderRadius: 35, backgroundColor: '#FF3B30', justifyContent: 'center', alignItems: 'center', elevation: 5 }}
              onPress={async () => {
                const uid = auth.currentUser?.uid;
                if (uid) {
                  await rejectCallOffer(uid);
                }
                setIsIncomingPendingState(false);
                goBack();
              }}
            >
              <MaterialIcons name="call-end" size={32} color="#FFF" />
            </TouchableOpacity>

            <TouchableOpacity 
              activeOpacity={0.8} 
              style={{ width: 70, height: 70, borderRadius: 35, backgroundColor: '#34C759', justifyContent: 'center', alignItems: 'center', elevation: 5 }}
              onPress={async () => {
                const uid = auth.currentUser?.uid;
                if (uid) {
                  await acceptCallOffer(uid);
                }
                setIsIncomingPendingState(false);
              }}
            >
              <MaterialIcons name={isVideo ? "videocam" : "call"} size={32} color="#FFF" />
            </TouchableOpacity>
          </View>
        </LinearGradient>
      </ScreenShell>
    );
  }'''

code = code.replace(render_connecting, render_incoming + "\n\n" + render_connecting)

with open('src/screens/CallScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

print("CallScreen.tsx updated successfully.")
