import re

with open('src/screens/CallScreen.tsx', 'r') as f:
    content = f.read()

old_code = "updateDoc(doc(db, 'rooms', roomId), { status: 'ended' })"
new_code = "import('firebase/firestore').then(({ setDoc }) => setDoc(doc(db, 'rooms', roomId), { status: 'ended' }, { merge: true }))"

content = content.replace(old_code, new_code)

with open('src/screens/CallScreen.tsx', 'w') as f:
    f.write(content)
print("Fixed end button setDoc")
