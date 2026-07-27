import re

with open('src/screens/CallScreen.tsx', 'r') as f:
    content = f.read()

# 1. Update setIsConnecting logic
# Find: await connectSeat(roomId, connectionToken, extraParam);
#       if (isMounted) setIsConnecting(false);
# Replace with logic that handles isCaller correctly

old_connect_logic = '''          if (isMounted) {
            await connectSeat(roomId, connectionToken, extraParam);
            if (isMounted) setIsConnecting(false);
          }'''

new_connect_logic = '''          if (isMounted) {
            await connectSeat(roomId, connectionToken, extraParam);
            if (isMounted && !isCaller) {
              setIsConnecting(false); // Receiver connects immediately
            }
          }'''

content = content.replace(old_connect_logic, new_connect_logic)

# 2. Add listener for incoming_calls if isCaller
# Find where createCallOffer is called, and add onSnapshot for it.

old_create_offer = '''        if (isCaller && matchData?.uid) {
          import('../services/liveRoomService').then(({ createCallOffer }) => {
            const myName = user.displayName || 'Someone';
            const myAvatar = user.photoURL || null;
            const currentRoomId = roomId || \\_\\;
            createCallOffer(user.uid, matchData.uid, myName, myAvatar, mode as any, currentRoomId).catch(console.error);
          });
        }'''

new_create_offer = '''        if (isCaller && matchData?.uid) {
          import('../services/liveRoomService').then(({ createCallOffer }) => {
            const myName = user.displayName || 'Someone';
            const myAvatar = user.photoURL || null;
            const currentRoomId = roomId || \\_\\;
            createCallOffer(user.uid, matchData.uid, myName, myAvatar, mode as any, currentRoomId)
              .then(() => {
                // Listen for acceptance or rejection
                if (!isMounted) return;
                statusUnsub = onSnapshot(doc(db, 'incoming_calls', matchData.uid), (snap) => {
                  if (snap.exists()) {
                    const data = snap.data();
                    if (data.status === 'accepted') {
                      setIsConnecting(false); // Call was accepted!
                    } else if (data.status === 'rejected') {
                      alert("Call was declined.");
                      goBack();
                    }
                  } else {
                    // Document deleted = rejected or expired
                    alert("Call ended or expired.");
                    goBack();
                  }
                });
              })
              .catch(console.error);
          });
        }'''

content = content.replace(old_create_offer, new_create_offer)

# 3. Ensure statusUnsub is defined in the useEffect
old_use_effect_top = '''  // 0. Fetch current user profile to determine gender/role
  React.useEffect(() => {
    const user = auth.currentUser;
    if (user) {'''

new_use_effect_top = '''  // 0. Fetch current user profile to determine gender/role
  React.useEffect(() => {
    let isMounted = true;
    let statusUnsub: (() => void) | null = null;
    const user = auth.currentUser;
    if (user) {'''

content = content.replace(old_use_effect_top, new_use_effect_top)

# 4. Clean up statusUnsub on unmount
old_use_effect_bottom = '''      }
    }, [isCaller, matchData?.uid, roomId, mode]);'''

new_use_effect_bottom = '''      }
      return () => {
        isMounted = false;
        if (statusUnsub) statusUnsub();
      };
    }, [isCaller, matchData?.uid, roomId, mode]);'''

content = content.replace(old_use_effect_bottom, new_use_effect_bottom)

with open('src/screens/CallScreen.tsx', 'w') as f:
    f.write(content)
print("Updated CallScreen.tsx logic")
