import re

with open('src/screens/CallScreen.tsx', 'r') as f:
    content = f.read()

# Fix 1: Add ngrok-skip-browser-warning to headers
old_agora_fetch = '''            const response = await fetch('https://batboy-glider-sanitary.ngrok-free.dev/api/v1/agora/generate-token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ roomId: roomId, uid: user.uid })
            });'''
new_agora_fetch = '''            const response = await fetch('https://batboy-glider-sanitary.ngrok-free.dev/api/v1/agora/generate-token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
              body: JSON.stringify({ roomId: roomId, uid: user.uid })
            });'''
content = content.replace(old_agora_fetch, new_agora_fetch)

old_zego_fetch = '''            const response = await fetch('https://batboy-glider-sanitary.ngrok-free.dev/api/v1/zego/generate-token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ roomId: roomId, uid: user.uid })
            });'''
new_zego_fetch = '''            const response = await fetch('https://batboy-glider-sanitary.ngrok-free.dev/api/v1/zego/generate-token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
              body: JSON.stringify({ roomId: roomId, uid: user.uid })
            });'''
content = content.replace(old_zego_fetch, new_zego_fetch)

# Fix 2: updateDoc -> setDoc with merge: true for fallback
old_fallback = '''                try {
                  await updateDoc(doc(db, 'rooms', roomId), { audioProvider: nextProvider });
                } catch (updateErr) {'''

# Need to ensure setDoc is imported. Let's just import it dynamically or assume it's imported?
# Let's import it dynamically to be safe, or just use updateDoc with a catch that does setDoc.
new_fallback = '''                try {
                  const { setDoc } = await import('firebase/firestore');
                  await setDoc(doc(db, 'rooms', roomId), { audioProvider: nextProvider }, { merge: true });
                } catch (updateErr) {'''
content = content.replace(old_fallback, new_fallback)

with open('src/screens/CallScreen.tsx', 'w') as f:
    f.write(content)
print("Fixed network issues")
