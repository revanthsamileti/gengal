import sys

with open('src/screens/CallScreen.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. Add remoteUids destructuring
hook_target = "const { connectSeat, disconnectSeat, toggleMic, micMuted, toggleSpeaker, speakerOn } = useGengalVoice(currentProvider);"
hook_replacement = "const { connectSeat, disconnectSeat, toggleMic, micMuted, toggleSpeaker, speakerOn, remoteUids } = useGengalVoice(currentProvider);"

if hook_target in code:
    code = code.replace(hook_target, hook_replacement)
    print("Fixed remoteUids destructuring.")

# 2. Fix p.name to p.username
name_target = "myName = p.name || p.nickname || myName;"
name_replacement = "myName = p.username || p.nickname || myName;"

if name_target in code:
    code = code.replace(name_target, name_replacement)
    print("Fixed p.name to p.username.")

with open('src/screens/CallScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

print("TS fixes applied.")
