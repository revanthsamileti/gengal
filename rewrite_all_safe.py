import sys

with open('src/screens/CallScreen.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. IMPORTS
import_target = "import { useGengalVoice, FreeProvider } from '../hooks/useGengalVoice';"
import_replacement = "import { useGengalVoice, FreeProvider, WATERFALL } from '../hooks/useGengalVoice';\nimport { createCallOffer, acceptCallOffer, rejectCallOffer } from '../services/liveRoomService';\nimport { BACKEND_URL } from '../services/authService';\nimport { Animated } from 'react-native';"
if import_target in code:
    code = code.replace(import_target, import_replacement)
    print("Imports replaced.")
else:
    print("Error: Imports target not found.")

waterfall_target = "const WATERFALL: FreeProvider[] = ['agora', 'zegocloud'];"
if waterfall_target in code:
    code = code.replace(waterfall_target, "")
    print("WATERFALL target removed.")

# 2. PROPS
props_target = "  navigate: (screen: string, params?: { profileName?: string; mode?: 'call' | 'video'; roomId?: string; matchData?: any; isCaller?: boolean }) => void;\n  goBack: () => void;\n};"
props_replacement = "  navigate: (screen: string, params?: { profileName?: string; mode?: 'call' | 'video'; roomId?: string; matchData?: any; isCaller?: boolean; isIncomingPending?: boolean }) => void;\n  goBack: () => void;\n  isIncomingPending?: boolean;\n};"
if props_target in code:
    code = code.replace(props_target, props_replacement)
    print("Props replaced.")
else:
    print("Error: Props target not found.")

# 3. COMPONENT DEFINITION & STATE
comp_target = "export default function CallScreen({ profileName, mode = 'call', roomId, matchData, isCaller, navigate, goBack }: CallScreenProps) {\n  const profile = matchData ? {\n    name: matchData.nickname || matchData.name,\n    uri: matchData.uri || matchData.avatarUrl || '',\n    age: matchData.age || 21,\n  } : { name: profileName || 'Unknown', uri: '', age: 21 };\n\n  const isVideo = mode === 'video';\n  const [areCamerasOn, setAreCamerasOn] = useState(true);\n  const [isGifting, setIsGifting] = useState(false);\n  const [globalSettings, setGlobalSettings] = useState<GlobalSettings | null>(null);\n  const [currentUserProfile, setCurrentUserProfile] = useState<any>(null);\n  const [isConnecting, setIsConnecting] = useState(true);\n  const [isIncomingPendingState, setIsIncomingPendingState] = useState(!!isIncomingPending);\n  const [isCallAccepted, setIsCallAccepted] = useState(false);\n  const [activeRoomId] = useState(() => roomId || (auth.currentUser && matchData?.uid ? `${auth.currentUser.uid}_${matchData.uid}` : ''));"
comp_target2 = "export default function CallScreen({ profileName, mode = 'call', roomId, matchData, isCaller, navigate, goBack }: CallScreenProps) {\n  const profile = matchData ? {\n    name: matchData.nickname || matchData.name,\n    uri: matchData.uri || matchData.avatarUrl || '',\n    age: matchData.age || 21,\n  } : { name: profileName || 'Unknown', uri: '', age: 21 };\n\n  const isVideo = mode === 'video';\n  const [areCamerasOn, setAreCamerasOn] = useState(true);\n  const [isGifting, setIsGifting] = useState(false);\n  const [globalSettings, setGlobalSettings] = useState<GlobalSettings | null>(null);\n  const [currentUserProfile, setCurrentUserProfile] = useState<any>(null);\n  const [isConnecting, setIsConnecting] = useState(true);\n\n  const [callDurationSeconds, setCallDurationSeconds] = useState(0);"

comp_replacement = "export default function CallScreen({ profileName, mode = 'call', roomId, matchData, isCaller, navigate, goBack, isIncomingPending }: CallScreenProps) {\n  const profile = matchData ? {\n    name: matchData.nickname || matchData.name,\n    uri: matchData.uri || matchData.avatarUrl || '',\n    age: matchData.age || 21,\n  } : { name: profileName || 'Unknown', uri: '', age: 21 };\n\n  const isVideo = mode === 'video';\n  const [areCamerasOn, setAreCamerasOn] = useState(true);\n  const [isGifting, setIsGifting] = useState(false);\n  const [globalSettings, setGlobalSettings] = useState<GlobalSettings | null>(null);\n  const [currentUserProfile, setCurrentUserProfile] = useState<any>(null);\n  const [isConnecting, setIsConnecting] = useState(true);\n  const [isIncomingPendingState, setIsIncomingPendingState] = useState(!!isIncomingPending);\n  const [isCallAccepted, setIsCallAccepted] = useState(false);\n\n  const [callDurationSeconds, setCallDurationSeconds] = useState(0);"
if comp_target2 in code:
    code = code.replace(comp_target2, comp_replacement)
    print("Component and State replaced.")
else:
    print("Error: Component target not found.")

# 4. ESTABLISH SECURE CALL
est_target = """  // 2. Automatically connect to the voice room when the screen mounts or provider changes
  React.useEffect(() => {
    let isMounted = true;
    
    const establishSecureCall = async () => {
      if (!roomId) return;
      
      let connectionToken = audioToken;
      let extraParam = auth.currentUser?.uid || '';
      const user = auth.currentUser;

      const connectionPromise = async () => {
        // Pre-fetch secure ephemeral key from Flask backend authority if Agora
        if (currentProvider === 'agora' && user) {
          console.log("[CallScreen] Requesting secure ephemeral key from token authority...");
          const response = await fetch('https://batboy-glider-sanitary.ngrok-free.dev/api/v1/agora/generate-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ roomId: roomId, uid: user.uid })
          });
          if (!response.ok) throw new Error("Failed to authenticate with token engine");
          const credentials = await response.json();
          connectionToken = credentials.token;
        } else if (currentProvider === 'zegocloud' && user) {
          console.log("[CallScreen] Resolving crypto credentials from Zego Token Authority...");
          const response = await fetch('https://batboy-glider-sanitary.ngrok-free.dev/api/v1/zego/generate-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ roomId: roomId, uid: user.uid })
          });
          if (!response.ok) throw new Error("Zego Authority server rejected proxy call.");
          const tokenPayload = await response.json();
          connectionToken = tokenPayload.token;
        }
        
        if (isMounted) {
          await connectSeat(roomId, connectionToken, extraParam);
          if (isMounted) setIsConnecting(false);
        }
      };

      try {
        // Enforce a strict 7-second timeout for the provider to connect
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Connection Timeout")), 7000));
        await Promise.race([connectionPromise(), timeoutPromise]);
      } catch (error) {
        console.error(`[Waterfall] Provider ${currentProvider} failed:`, error);
        
        // Trigger Waterfall Fallback
        const currentIndex = WATERFALL.indexOf(currentProvider);
        if (currentIndex !== -1 && currentIndex + 1 < WATERFALL.length) {
          const nextProvider = WATERFALL[currentIndex + 1];
          console.warn(`[Waterfall] Falling back to next adapter: ${nextProvider}`);
          try {
            await updateDoc(doc(db, 'rooms', roomId), { audioProvider: nextProvider });
            // The onSnapshot listener will detect this and update currentProvider automatically
          } catch (e) {
            console.error("[Waterfall] Failed to update room with new provider", e);
          }
        } else {
          alert("All secure video connection routes failed. Please try again later.");
          goBack();
        }
      }
    };

    establishSecureCall();

    return () => {
      isMounted = false;
      disconnectSeat();
    };
  }, [roomId, currentProvider]);"""

est_replacement = """  // 2. Automatically connect to the voice room when the screen mounts or provider changes
  React.useEffect(() => {
    let isMounted = true;
    let statusUnsub: (() => void) | null = null;
    
    const establishSecureCall = async () => {
      if (isIncomingPendingState) return;
      if (!roomId) return;
      
      let connectionToken = audioToken;
      let extraParam = auth.currentUser?.uid || '';
      const user = auth.currentUser;

      const connectionPromise = async () => {
        if (currentProvider === 'agora' && user) {
          console.log("[CallScreen] Requesting secure ephemeral key from token authority...");
          const response = await fetch(`${BACKEND_URL}/api/v1/agora/generate-token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ roomId: roomId, uid: user.uid })
          });
          if (!response.ok) throw new Error("Failed to authenticate with token engine");
          const credentials = await response.json();
          connectionToken = credentials.token;
          extraParam = credentials.uid;
        } else if (currentProvider === 'zegocloud' && user) {
          console.log("[CallScreen] Resolving crypto credentials from Zego Token Authority...");
          const response = await fetch(`${BACKEND_URL}/api/v1/zego/generate-token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ roomId: roomId, uid: user.uid })
          });
          if (!response.ok) throw new Error("Zego Authority server rejected proxy call.");
          const tokenPayload = await response.json();
          connectionToken = tokenPayload.token;
        }
        
        if (isMounted) {
          if (isCaller && matchData?.uid && user) {
            const myName = user.displayName || 'Someone';
            const myAvatar = user.photoURL || null;
            await createCallOffer(user.uid, matchData.uid, myName, myAvatar, mode as any, roomId);
            
            statusUnsub = onSnapshot(doc(db, 'incoming_calls', matchData.uid), (snap) => {
              if (!isMounted) return;
              if (snap.exists()) {
                const data = snap.data();
                if (data.status === 'accepted') {
                  setIsCallAccepted(true);
                  setIsConnecting(false);
                } else if (data.status === 'rejected') {
                  alert("Call declined.");
                  goBack();
                }
              } else {
                alert("Call ended.");
                goBack();
              }
            });
          }
          
          await connectSeat(roomId, connectionToken, extraParam);
          if (isMounted && !isCaller) {
            setIsCallAccepted(true);
            setIsConnecting(false);
          }
        }
      };

      try {
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Connection Timeout")), 7000));
        await Promise.race([connectionPromise(), timeoutPromise]);
      } catch (error) {
        console.error(`[Waterfall] Provider ${currentProvider} failed:`, error);
        const currentIndex = WATERFALL.indexOf(currentProvider);
        if (currentIndex !== -1 && currentIndex + 1 < WATERFALL.length) {
          const nextProvider = WATERFALL[currentIndex + 1];
          try {
            await updateDoc(doc(db, 'rooms', roomId), { audioProvider: nextProvider });
          } catch (e) {
            console.error("[Waterfall] Failed to update room with new provider", e);
          }
        } else {
          alert("All secure video connection routes failed. Please try again later.");
          goBack();
        }
      }
    };

    establishSecureCall();

    return () => {
      isMounted = false;
      if (statusUnsub) statusUnsub();
      disconnectSeat();
    };
  }, [roomId, currentProvider, isCaller, matchData?.uid, isIncomingPendingState]);"""

if est_target in code:
    code = code.replace(est_target, est_replacement)
    print("Establish Secure Call replaced.")
else:
    print("Error: Establish Secure Call target not found.")

# 5. TIMER UPDATE
timer_target = """      syncIntervalRef.current += 1;
      setCallDurationSeconds(prev => prev + 1);"""
timer_replacement = """      if (!isCallAccepted) return;
      syncIntervalRef.current += 1;
      setCallDurationSeconds(prev => prev + 1);"""
if timer_target in code:
    code = code.replace(timer_target, timer_replacement)
    print("Timer replaced.")
else:
    print("Error: Timer target not found.")

# 6. INCOMING UI RENDER
render_target = "  if (!isVideo) {"
render_replacement = """  if (isIncomingPendingState) {
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
                setIsCallAccepted(true);
              }}
            >
              <MaterialIcons name={mode === 'video' ? "videocam" : "call"} size={32} color="#FFF" />
            </TouchableOpacity>
          </View>
        </View>
      </ScreenShell>
    );
  }

  if (!isVideo) {"""
if render_target in code:
    code = code.replace(render_target, render_replacement)
    print("Incoming UI Render replaced.")
else:
    print("Error: Incoming UI Render target not found.")

with open('src/screens/CallScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

print("CallScreen rewrites finished.")
