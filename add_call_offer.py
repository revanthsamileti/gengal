import re

with open('src/screens/CallScreen.tsx', 'r') as f:
    content = f.read()

old_effect = '''  // 0. Fetch current user profile to determine gender/role
  React.useEffect(() => {
    let isMounted = true;
    let statusUnsub: (() => void) | null = null;
    const user = auth.currentUser;
    if (user) {
      import('../services/userService').then(({ getUserProfile }) => {
        getUserProfile(user.uid).then(p => {
          setCurrentUserProfile(p);
          if (p?.coins) setCallerLiveCoins(p.coins);
        });
      });
    }
  }, []);'''

new_effect = '''  // 0. Fetch current user profile to determine gender/role
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

content = content.replace(old_effect, new_effect)

with open('src/screens/CallScreen.tsx', 'w') as f:
    f.write(content)
print("Injected createCallOffer")
