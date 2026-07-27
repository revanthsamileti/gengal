import re

with open('src/screens/CallScreen.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. Update Props
code = code.replace(
    "  navigate: (screen: string, params?: { profileName?: string; mode?: 'call' | 'video'; roomId?: string; matchData?: any; isCaller?: boolean }) => void;\n  goBack: () => void;\n}",
    "  navigate: (screen: string, params?: { profileName?: string; mode?: 'call' | 'video'; roomId?: string; matchData?: any; isCaller?: boolean; isIncomingPending?: boolean }) => void;\n  goBack: () => void;\n  isIncomingPending?: boolean;\n}"
)

# 2. Update Component Definition
code = code.replace(
    "export default function CallScreen({ profileName, mode = 'call', roomId, matchData, isCaller, navigate, goBack }: CallScreenProps) {",
    "export default function CallScreen({ profileName, mode = 'call', roomId, matchData, isCaller, navigate, goBack, isIncomingPending }: CallScreenProps) {"
)

# 3. Add State
old_state = "  const [isCallAccepted, setIsCallAccepted] = useState(false);"
new_state = "  const [isCallAccepted, setIsCallAccepted] = useState(false);\n  const [isIncomingPendingState, setIsIncomingPendingState] = useState(!!isIncomingPending);"
if new_state not in code:
    code = code.replace(old_state, new_state)

# 4. Modify establishSecureCall to return if pending
old_establish = "    const establishSecureCall = async () => {\n      if (!roomId) return;"
new_establish = "    const establishSecureCall = async () => {\n      if (isIncomingPendingState) return;\n      if (!roomId) return;"
if new_establish not in code:
    code = code.replace(old_establish, new_establish)

# 5. Add UI for incoming call
render_connecting = '''  if (isConnecting) {
    return (
      <ConnectingOverlay 
        mode="private" 
        targetName={profile.name}
        onCancel={() => {
          disconnectSeat();
          goBack();
        }} 
      />
    );
  }'''

render_incoming = '''  if (isIncomingPendingState) {
    return (
      <ScreenShell>
        <LinearGradient
          colors={['#1A0815', '#4A0D3E', '#1A0815']}
          style={StyleSheet.absoluteFill}
        />
        
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Animated.View style={{ 
            width: 140, 
            height: 140, 
            borderRadius: 70, 
            borderWidth: 3, 
            borderColor: '#E8CA58', 
            justifyContent: 'center', 
            alignItems: 'center',
            marginBottom: 30,
            shadowColor: '#E8CA58',
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.8,
            shadowRadius: 20,
            elevation: 10
          }}>
            <Image source={{ uri: profile.uri }} style={{ width: 130, height: 130, borderRadius: 65 }} />
          </Animated.View>

          <Text style={{ color: '#FFF', fontSize: 32, fontWeight: '800', marginBottom: 10 }}>{profile.name}</Text>
          <Text style={{ color: '#E8CA58', fontSize: 18, marginBottom: 40 }}>Incoming {mode === 'video' ? 'Video ' : ''}Call...</Text>
          
          <View style={{ flexDirection: 'row', gap: 50, marginTop: 40 }}>
            {/* Decline Button */}
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

            {/* Accept Button */}
            <TouchableOpacity 
              activeOpacity={0.8} 
              style={{ width: 70, height: 70, borderRadius: 35, backgroundColor: '#34C759', justifyContent: 'center', alignItems: 'center', elevation: 5 }}
              onPress={async () => {
                const uid = auth.currentUser?.uid;
                if (uid) {
                  await acceptCallOffer(uid);
                }
                setIsIncomingPendingState(false);
                setIsCallAccepted(true);
                // The useEffect will now run establishSecureCall because state changed
              }}
            >
              <MaterialIcons name={isVideo ? "videocam" : "call"} size={32} color="#FFF" />
            </TouchableOpacity>
          </View>
        </View>
      </ScreenShell>
    );
  }'''

if render_incoming not in code:
    code = code.replace(render_connecting, render_incoming + "\n\n" + render_connecting)

# 6. Update useEffect dependencies for establishSecureCall
old_dep = "}, [roomId, currentProvider, isCaller, matchData?.uid]);"
new_dep = "}, [roomId, currentProvider, isCaller, matchData?.uid, isIncomingPendingState]);"
if new_dep not in code:
    code = code.replace(old_dep, new_dep)

with open('src/screens/CallScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

print("Incoming UI injected.")
