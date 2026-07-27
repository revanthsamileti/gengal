import re

with open('src/screens/CallScreen.tsx', 'r') as f:
    content = f.read()

# Fix 1: p?.name -> p?.username, p?.photoUrl -> p?.avatarUrl
old_name = "const myName = p?.nickname || p?.name || user.displayName || 'Someone';"
new_name = "const myName = p?.nickname || p?.username || user.displayName || 'Someone';"
content = content.replace(old_name, new_name)

old_avatar = "const myAvatar = p?.photoUrl || user.photoURL || null;"
new_avatar = "const myAvatar = p?.avatarUrl || user.photoURL || null;"
content = content.replace(old_avatar, new_avatar)

# Fix 2: roomId in end buttons
old_end = "setDoc(doc(db, 'rooms', roomId), { status: 'ended' }"
new_end = "setDoc(doc(db, 'rooms', roomId || 'fallback'), { status: 'ended' }"
content = content.replace(old_end, new_end)

with open('src/screens/CallScreen.tsx', 'w') as f:
    f.write(content)
print("Fixed TS errors")
