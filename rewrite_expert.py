import sys

file_path = 'src/screens/ExpertRoomScreen.tsx'
with open(file_path, 'r', encoding='utf-8') as f:
    code = f.read()

# Replace the stageHeader
start_header = '<View style={styles.stageHeader}>'
end_header = '</View>\n\n            <View style={styles.roomConsole}>'

header_replacement = '''<View style={styles.stageHeader}>
              <View style={styles.headerLeft}>
                <TouchableOpacity onPress={goBack} style={styles.iconBtnRound}>
                  <MaterialIcons name="arrow-back-ios" size={16} color="#FFFDF8" style={{marginLeft: 4}} />
                </TouchableOpacity>
              </View>
              <View style={styles.stageTopCenter}>
                <View style={[styles.langTag, { borderColor: tierColor }]}>
                  <Text style={[styles.langTagText, { color: tierColor }]}>{room.language}</Text>
                </View>
                <Text style={styles.stageTopicText} numberOfLines={1}>{room.topic}</Text>
              </View>
              <View style={styles.stageHeaderRight}>
                <TouchableOpacity onPress={handleShareLink} style={styles.iconBtnRound} activeOpacity={0.78}>
                  <MaterialIcons name="share" size={16} color="#FFFDF8" />
                </TouchableOpacity>
                <View style={styles.livePill}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveText}>LIVE</Text>
                  <Text style={styles.memberCount}>{room.activeMemberCount}</Text>
                  <MaterialIcons name="people" size={12} color="#FFFDF8" style={{marginLeft: 2}} />
                </View>
              </View>
            </View>'''

if start_header in code and end_header in code:
    code = code[:code.find(start_header)] + header_replacement + code[code.find(end_header) + len('</View>'):]
    print("Header replaced")
else:
    print("Header pattern not found")

# Remove roomConsole
start_console = '<View style={styles.roomConsole}>'
end_console = '</View>\n\n            {/* Unified Matchmaking Stage: 3 Seats in Triangular Layout */}'

if start_console in code and end_console in code:
    code = code[:code.find(start_console)] + code[code.find(end_console) + len('</View>\n\n'):]
    print("Console removed")
else:
    print("Console pattern not found")

# Remove extra stuff from Zone 1 to Zone 2
start_extra = '{/* Host Connect/Match guests action button */}'
end_extra = '{/* ───── ZONE 2: THE FEED (Absolute Overlay) ───── */}'

if start_extra in code and end_extra in code:
    code = code[:code.find(start_extra)] + code[code.find(end_extra):]
    print("Extra UI removed")
else:
    print("Extra pattern not found")

# Action bar replacement
start_action = '{/* ───── ZONE 3: ACTION BAR ───── */}'
end_action = '{/* ── Shared Profile Review Modal (all room members see this) ── */}'

action_bar_replacement = '''{/* ───── ZONE 3: ACTION BAR ───── */}
          <View style={styles.actionBar}>
            <View style={styles.chatInputWrap}>
              <TextInput
                style={styles.chatInput}
                placeholder="Say something..."
                placeholderTextColor="#A19891"
                value={chatText}
                onChangeText={setChatText}
                onSubmitEditing={handleSendChat}
                returnKeyType="send"
                maxLength={200}
              />
            </View>
            
            <TouchableOpacity
              style={[styles.actionIconRound, micMuted && styles.actionIconMuted]}
              onPress={toggleMic}
            >
              <MaterialIcons name={micMuted ? "mic-off" : "mic"} size={22} color={micMuted ? '#C9504B' : '#EADCA8'} />
            </TouchableOpacity>
            
            <TouchableOpacity
              style={styles.actionIconRound}
              onPress={() => {
                if (room) {
                  setGiftRecipient({ uid: room.hostUid, name: room.hostNickname });
                  setGiftModal(true);
                }
              }}
            >
              <MaterialIcons name="card-giftcard" size={20} color="#D1B23B" />
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.actionIconRound, styles.exitAction]} 
              onPress={isHost ? handleEndRoom : goBack}
            >
              <MaterialIcons name="meeting-room" size={20} color="#C9504B" />
            </TouchableOpacity>
          </View>\n\n          '''

if start_action in code and end_action in code:
    code = code[:code.find(start_action)] + action_bar_replacement + code[code.find(end_action):]
    print("Action bar replaced")
else:
    print("Action pattern not found")

new_styles = '''
  iconBtnRound: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,253,248,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerLeft: {
    flex: 1,
    alignItems: 'flex-start',
  },
  actionIconRound: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,253,248,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
'''

if 'iconBtnRound' not in code:
    code = code.replace('const styles = StyleSheet.create({', 'const styles = StyleSheet.create({' + new_styles)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(code)

print("Rewrite done")
