import re

with open('src/screens/CallScreen.tsx', 'r') as f:
    content = f.read()

old_block = '''      import('../services/userService').then(({ getUserProfile }) => {
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
      }'''

new_block = '''      import('../services/userService').then(({ getUserProfile }) => {
        getUserProfile(user.uid).then(p => {
          if (!isMounted) return;
          setCurrentUserProfile(p);
          if (p?.coins) setCallerLiveCoins(p.coins);
          
          if (isCaller && matchData?.uid) {
            import('../services/liveRoomService').then(({ createCallOffer }) => {
              const myName = p?.nickname || p?.name || user.displayName || 'Someone';
              const myAvatar = p?.photoUrl || user.photoURL || null;
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
      });'''

if old_block in content:
    content = content.replace(old_block, new_block)
    with open('src/screens/CallScreen.tsx', 'w') as f:
        f.write(content)
    print("Fixed username bug")
else:
    print("Could not find block")
