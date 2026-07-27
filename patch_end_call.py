import re

with open('src/screens/CallScreen.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. Remove alerts from Caller's snapshot listener
caller_listener_target = """            statusUnsub = onSnapshot(doc(db, 'incoming_calls', matchData.uid), (snap) => {
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
            });"""

caller_listener_replacement = """            statusUnsub = onSnapshot(doc(db, 'incoming_calls', matchData.uid), (snap) => {
              if (!isMounted) return;
              if (snap.exists()) {
                const data = snap.data();
                if (data.status === 'accepted') {
                  setIsCallAccepted(true);
                  setIsConnecting(false);
                } else if (data.status === 'rejected') {
                  goBack();
                }
              } else {
                goBack();
              }
            });"""

if caller_listener_target in code:
    code = code.replace(caller_listener_target, caller_listener_replacement)
else:
    print("Caller listener not found, maybe already replaced.")

# 2. Add Receiver snapshot listener to auto-end call if caller hangs up (document deleted)
receiver_listener_target = """  // 1. Establish Secure Voice/Video Connection"""
receiver_listener_replacement = """  // Listen for the incoming_calls document being deleted, which means the call ended.
  React.useEffect(() => {
    let unsub: any = null;
    const user = auth.currentUser;
    // Receiver needs to listen if the caller hangs up
    if (!isCaller && user && isIncomingPendingState) {
      unsub = onSnapshot(doc(db, 'incoming_calls', user.uid), (snap) => {
        if (!snap.exists()) {
          disconnectSeat();
          goBack();
        }
      });
    } else if (!isCaller && user && isCallAccepted) {
      // If call is accepted, still listen to see if the other party ends it
      unsub = onSnapshot(doc(db, 'incoming_calls', user.uid), (snap) => {
        if (!snap.exists()) {
          disconnectSeat();
          goBack();
        }
      });
    }
    return () => {
      if (unsub) unsub();
    };
  }, [isCaller, isIncomingPendingState, isCallAccepted]);

  // 1. Establish Secure Voice/Video Connection"""

if receiver_listener_target in code:
    code = code.replace(receiver_listener_target, receiver_listener_replacement)
else:
    print("Receiver listener target not found.")

# 3. Create handleEndCall helper and replace all disconnectSeat(); goBack(); combinations
# Let's insert the helper function near the top of the component
helper_target = """  // --- Component Mount & Handlers ---"""
helper_replacement = """  // --- Component Mount & Handlers ---
  const handleEndCall = async () => {
    disconnectSeat();
    const user = auth.currentUser;
    const incomingCallDocId = isCaller ? matchData?.uid : user?.uid;
    if (incomingCallDocId) {
      try {
        const { clearCallOffer } = await import('../services/liveRoomService');
        await clearCallOffer(incomingCallDocId);
      } catch (e) {
        console.warn("Failed to clear call offer on end call", e);
      }
    }
    goBack();
  };"""

if helper_target in code:
    code = code.replace(helper_target, helper_replacement)
else:
    print("Helper target not found.")

# Replace manual end call inside ConnectingOverlay onCancel
connecting_overlay_cancel_target = """          <ConnectingOverlay 
            mode="private" 
            targetName={profile.name}
            onCancel={() => {
              disconnectSeat();
              goBack();
            }} 
          />"""
connecting_overlay_cancel_replacement = """          <ConnectingOverlay 
            mode="private" 
            targetName={profile.name}
            onCancel={handleEndCall} 
          />"""
if connecting_overlay_cancel_target in code:
    code = code.replace(connecting_overlay_cancel_target, connecting_overlay_cancel_replacement)

# Replace manual end call on video end button
video_end_target = """          <TouchableOpacity style={styles.videoControlItem} activeOpacity={0.82} onPress={() => {
            disconnectSeat();
            goBack();
          }}>"""
video_end_replacement = """          <TouchableOpacity style={styles.videoControlItem} activeOpacity={0.82} onPress={handleEndCall}>"""
if video_end_target in code:
    code = code.replace(video_end_target, video_end_replacement)

# Replace manual end call on voice end button
voice_end_target = """            <TouchableOpacity style={[styles.controlButton, styles.endCallBtn]} activeOpacity={0.85} onPress={() => {
              disconnectSeat();
              goBack();
            }}>"""
voice_end_replacement = """            <TouchableOpacity style={[styles.controlButton, styles.endCallBtn]} activeOpacity={0.85} onPress={handleEndCall}>"""
if voice_end_target in code:
    code = code.replace(voice_end_target, voice_end_replacement)

# Replace manual end call when receiver declines
receiver_decline_target = """          <TouchableOpacity 
            style={[styles.actionBtn, styles.declineBtn]}
            onPress={async () => {
              try {
                const { rejectCallOffer } = await import('../services/liveRoomService');
                if (auth.currentUser) {
                  await rejectCallOffer(auth.currentUser.uid);
                }
              } catch (e) { }
              disconnectSeat();
              goBack();
            }}
          >"""
receiver_decline_replacement = """          <TouchableOpacity 
            style={[styles.actionBtn, styles.declineBtn]}
            onPress={async () => {
              try {
                const { rejectCallOffer } = await import('../services/liveRoomService');
                if (auth.currentUser) {
                  await rejectCallOffer(auth.currentUser.uid);
                }
              } catch (e) { }
              handleEndCall();
            }}
          >"""
if receiver_decline_target in code:
    code = code.replace(receiver_decline_target, receiver_decline_replacement)

# Write back
with open('src/screens/CallScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

print("CallScreen.tsx patched successfully!")
