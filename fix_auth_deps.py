import re

with open('src/screens/CallScreen.tsx', 'r') as f:
    content = f.read()

# Add onAuthStateChanged import if not exists
if 'onAuthStateChanged' not in content:
    content = content.replace("import { getAuth } from 'firebase/auth';", "import { getAuth, onAuthStateChanged } from 'firebase/auth';")
    content = content.replace("import { auth, db } from '../config/firebase';", "import { auth, db } from '../config/firebase';\nimport { onAuthStateChanged } from 'firebase/auth';")

old_effect = '''  // 0. Fetch current user profile to determine gender/role
  React.useEffect(() => {
    let isMounted = true;
    let statusUnsub: (() => void) | null = null;
    const user = auth.currentUser;
    if (user) {
      import('../services/userService').then(({ getUserProfile }) => {
        getUserProfile(user.uid).then(p => {
          if (!isMounted) return;
          setCurrentUserProfile(p);
          if (p?.coins) setCallerLiveCoins(p.coins);
        });
      });
      
      if (isCaller && matchData?.uid) {
        import('../services/liveRoomService').then(({ createCallOffer }) => {
          const myName = user.displayName || 'Someone';
          const myAvatar = user.photoURL || null;
          const currentRoomId = roomId || \\_\\;
          createCallOffer(user.uid, matchData.uid, myName, myAvatar, mode as any, currentRoomId)
            .then(() => {
              if (!isMounted) return;
              statusUnsub = onSnapshot(doc(db, 'incoming_calls', matchData.uid), (snap) => {
                if (snap.exists()) {
                  const data = snap.data();
                  if (data.status === 'accepted') {
                    setIsConnecting(false);
                  } else if (data.status === 'rejected') {
                    alert("Call was declined.");
                    goBack();
                  }
                } else {
                  alert("Call ended or expired.");
                  goBack();
                }
              });
            })
            .catch(console.error);
        });
      }
    }
    
    return () => {
      isMounted = false;
      if (statusUnsub) statusUnsub();
    };
  }, [isCaller, matchData?.uid, roomId, mode]);'''

new_effect = '''  // 0. Fetch current user profile to determine gender/role
  React.useEffect(() => {
    let isMounted = true;
    let statusUnsub: (() => void) | null = null;
    let authUnsub: (() => void) | null = null;
    
    authUnsub = onAuthStateChanged(auth, (user) => {
      if (!user) return;
      
      import('../services/userService').then(({ getUserProfile }) => {
        getUserProfile(user.uid).then(p => {
          if (!isMounted) return;
          setCurrentUserProfile(p);
          if (p?.coins) setCallerLiveCoins(p.coins);
        });
      });
      
      if (isCaller && matchData?.uid) {
        import('../services/liveRoomService').then(({ createCallOffer }) => {
          const myName = user.displayName || 'Someone';
          const myAvatar = user.photoURL || null;
          const currentRoomId = roomId || \\_\\;
          createCallOffer(user.uid, matchData.uid, myName, myAvatar, mode as any, currentRoomId)
            .then(() => {
              if (!isMounted) return;
              statusUnsub = onSnapshot(doc(db, 'incoming_calls', matchData.uid), (snap) => {
                if (snap.exists()) {
                  const data = snap.data();
                  if (data.status === 'accepted') {
                    setIsConnecting(false);
                  } else if (data.status === 'rejected') {
                    alert("Call was declined.");
                    goBack();
                  }
                } else {
                  alert("Call ended or expired.");
                  goBack();
                }
              });
            })
            .catch(console.error);
        });
      }
    });
    
    return () => {
      isMounted = false;
      if (statusUnsub) statusUnsub();
      if (authUnsub) authUnsub();
    };
  }, [isCaller, matchData?.uid, roomId, mode]);'''

content = content.replace(old_effect, new_effect)

with open('src/screens/CallScreen.tsx', 'w') as f:
    f.write(content)
print("Fixed auth dependency")
