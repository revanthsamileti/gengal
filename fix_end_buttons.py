import re

with open('src/screens/CallScreen.tsx', 'r') as f:
    content = f.read()

# Replace voice end button
old_voice_end = '''              <TouchableOpacity
                style={styles.voiceControlItem}
                activeOpacity={0.82}
                onPress={() => {
                  disconnectSeat();
                  goBack();
                }}
              >'''

new_voice_end = '''              <TouchableOpacity
                style={styles.voiceControlItem}
                activeOpacity={0.82}
                onPress={() => {
                  import('firebase/firestore').then(({ updateDoc, doc }) => {
                    updateDoc(doc(db, 'rooms', roomId), { status: 'ended' }).catch(()=>{});
                  });
                  disconnectSeat();
                  goBack();
                }}
              >'''

content = content.replace(old_voice_end, new_voice_end)

# Replace video end button
old_video_end = '''          <TouchableOpacity
            style={styles.videoControlItem}
            activeOpacity={0.82}
            onPress={() => goBack()}
          >
            <View style={styles.videoEndButton}>'''

new_video_end = '''          <TouchableOpacity
            style={styles.videoControlItem}
            activeOpacity={0.82}
            onPress={() => {
              import('firebase/firestore').then(({ updateDoc, doc }) => {
                updateDoc(doc(db, 'rooms', roomId), { status: 'ended' }).catch(()=>{});
              });
              disconnectSeat();
              goBack();
            }}
          >
            <View style={styles.videoEndButton}>'''

content = content.replace(old_video_end, new_video_end)

with open('src/screens/CallScreen.tsx', 'w') as f:
    f.write(content)

print("Fixed end buttons")
