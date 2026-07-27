import re

with open('src/screens/CallScreen.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. Insert handleEndCall right after `const [hasReportedDuration, setHasReportedDuration] = React.useState(false);`
helper = """
  // --- Component Handlers ---
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
  };
"""
if "const handleEndCall" not in code:
    code = code.replace("const [hasReportedDuration, setHasReportedDuration] = React.useState(false);",
                        "const [hasReportedDuration, setHasReportedDuration] = React.useState(false);\n" + helper)

# 2. Add receiver listener right before `// 2. Automatically connect`
receiver_listener = """
  // 1.5. Listen for the incoming_calls document being deleted, which means the call ended.
  React.useEffect(() => {
    let unsub: any = null;
    const user = auth.currentUser;
    if (!isCaller && user && (isIncomingPendingState || isCallAccepted)) {
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
"""
if "1.5. Listen" not in code:
    code = code.replace("// 2. Automatically connect to the voice room",
                        receiver_listener + "\n  // 2. Automatically connect to the voice room")

# 3. Replace all remaining `disconnectSeat();\n              goBack();` patterns
code = re.sub(r'disconnectSeat\(\);\s*goBack\(\);', 'handleEndCall();', code)

with open('src/screens/CallScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

print("CallScreen patched via regex.")
