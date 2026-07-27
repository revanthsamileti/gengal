import re

with open('src/screens/CallScreen.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

target = "  if (!isVideo) {"

render_incoming = '''  if (isIncomingPendingState) {
    const profile = matchData ? {
      name: matchData.nickname || 'Unknown',
      uri: matchData.avatarUrl || 'https://via.placeholder.com/150',
      age: 21,
    } : { name: profileName || 'Unknown', uri: 'https://via.placeholder.com/150', age: 21 };

    return (
      <ScreenShell>
        <LinearGradient
          colors={['#1A0815', '#4A0D3E', '#1A0815']}
          style={StyleSheet.absoluteFill}
        />
        
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Animated.View style={{ 
            width: 140, 
            height: 140, 
            borderRadius: 70, 
            borderWidth: 3, 
            borderColor: '#E8CA58', 
            justifyContent: 'center', 
            alignItems: 'center',
            marginBottom: 30,
            shadowColor: '#E8CA58',
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.8,
            shadowRadius: 20,
            elevation: 10
          }}>
            <Image source={{ uri: profile.uri }} style={{ width: 130, height: 130, borderRadius: 65 }} />
          </Animated.View>

          <Text style={{ color: '#FFF', fontSize: 32, fontWeight: '800', marginBottom: 10 }}>{profile.name}</Text>
          <Text style={{ color: '#E8CA58', fontSize: 18, marginBottom: 40 }}>Incoming {mode === 'video' ? 'Video ' : ''}Call...</Text>
          
          <View style={{ flexDirection: 'row', gap: 50, marginTop: 40 }}>
            <TouchableOpacity 
              activeOpacity={0.8} 
              style={{ width: 70, height: 70, borderRadius: 35, backgroundColor: '#FF3B30', justifyContent: 'center', alignItems: 'center', elevation: 5 }}
              onPress={async () => {
                const uid = auth.currentUser?.uid;
                if (uid) {
                  await rejectCallOffer(uid);
                }
                setIsIncomingPendingState(false);
                goBack();
              }}
            >
              <MaterialIcons name="call-end" size={32} color="#FFF" />
            </TouchableOpacity>

            <TouchableOpacity 
              activeOpacity={0.8} 
              style={{ width: 70, height: 70, borderRadius: 35, backgroundColor: '#34C759', justifyContent: 'center', alignItems: 'center', elevation: 5 }}
              onPress={async () => {
                const uid = auth.currentUser?.uid;
                if (uid) {
                  await acceptCallOffer(uid);
                }
                setIsIncomingPendingState(false);
                setIsCallAccepted(true);
              }}
            >
              <MaterialIcons name={mode === 'video' ? "videocam" : "call"} size={32} color="#FFF" />
            </TouchableOpacity>
          </View>
        </View>
      </ScreenShell>
    );
  }

  if (!isVideo) {'''

if "if (isIncomingPendingState) {" not in code:
    code = code.replace(target, render_incoming)
    with open('src/screens/CallScreen.tsx', 'w', encoding='utf-8') as f:
        f.write(code)
    print("Injected early return for Incoming UI.")
else:
    print("Already injected.")
