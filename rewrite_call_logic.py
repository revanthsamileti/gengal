import re

with open('src/screens/CallScreen.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

# Make sure imports are there
if "import { createCallOffer" not in code:
    code = code.replace(
        "import { doc, onSnapshot, updateDoc } from 'firebase/firestore';",
        "import { doc, onSnapshot, updateDoc, setDoc, serverTimestamp } from 'firebase/firestore';\nimport { createCallOffer, acceptCallOffer, rejectCallOffer, cancelCallOffer } from '../services/liveRoomService';"
    )

old_establish = '''    const establishSecureCall = async () => {
      if (!roomId) return;
      
      let connectionToken = audioToken;
      let extraParam = auth.currentUser?.uid || '';
      const user = auth.currentUser;

      const connectionPromise = async () => {
        // Pre-fetch secure ephemeral key from Flask backend authority if Agora
        if (currentProvider === 'agora' && user) {
          console.log("[CallScreen] Requesting secure ephemeral key from token authority...");
          const response = await fetch(require('../services/authService').BACKEND_URL + '/api/v1/agora/generate-token', {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              roomId: roomId,
              uid: user.uid
            })
          });
          if (!response.ok) throw new Error("Failed to authenticate with token engine");
          const credentials = await response.json();
          connectionToken = credentials.token;
          extraParam = credentials.uid;
        } else if (currentProvider === 'zegocloud' && user) {
          console.log("[CallScreen] Resolving crypto credentials from Zego Token Authority...");
          const response = await fetch(require('../services/authService').BACKEND_URL + '/api/v1/zego/generate-token', {
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
      };'''

new_establish = '''    let statusUnsub: (() => void) | null = null;
    const establishSecureCall = async () => {
      if (!roomId) return;
      
      let connectionToken = audioToken;
      let extraParam = auth.currentUser?.uid || '';
      const user = auth.currentUser;

      const connectionPromise = async () => {
        if (currentProvider === 'agora' && user) {
          console.log("[CallScreen] Requesting secure ephemeral key from token authority...");
          const response = await fetch(require('../services/authService').BACKEND_URL + '/api/v1/agora/generate-token', {
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
          const response = await fetch(require('../services/authService').BACKEND_URL + '/api/v1/zego/generate-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ roomId: roomId, uid: user.uid })
          });
          if (!response.ok) throw new Error("Zego Authority server rejected proxy call.");
          const tokenPayload = await response.json();
          connectionToken = tokenPayload.token;
        }
        
        if (isMounted) {
          // If caller, send offer and wait for accept
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
      };'''

code = code.replace(old_establish, new_establish)

# Add isCallAccepted state
if "const [isCallAccepted, setIsCallAccepted] = useState(false);" not in code:
    code = code.replace(
        "const [callDurationSeconds, setCallDurationSeconds] = useState(0);",
        "const [callDurationSeconds, setCallDurationSeconds] = useState(0);\n  const [isCallAccepted, setIsCallAccepted] = useState(false);"
    )

# Fix cleanup
old_cleanup = '''    return () => {
      isMounted = false;
      disconnectSeat();
    };
  }, [roomId, currentProvider]);'''

new_cleanup = '''    return () => {
      isMounted = false;
      if (statusUnsub) statusUnsub();
      disconnectSeat();
    };
  }, [roomId, currentProvider, isCaller, matchData?.uid]);'''

code = code.replace(old_cleanup, new_cleanup)

# Fix timer
old_timer = '''      syncIntervalRef.current += 1;
      setCallDurationSeconds(prev => prev + 1);'''

new_timer = '''      if (!isCallAccepted) return;
      syncIntervalRef.current += 1;
      setCallDurationSeconds(prev => prev + 1);'''

code = code.replace(old_timer, new_timer)

with open('src/screens/CallScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

print("Call offer and timer fixed.")
