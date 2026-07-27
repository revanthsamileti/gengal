import sys

file_path = 'src/screens/ExpertRoomScreen.tsx'
with open(file_path, 'r', encoding='utf-8') as f:
    code = f.read()

def replace_between(start_str, end_str, replacement):
    global code
    start_idx = code.find(start_str)
    if start_idx == -1:
        print(f"Start string not found: {start_str[:30]}...")
        return
    end_idx = code.find(end_str, start_idx)
    if end_idx == -1:
        print(f"End string not found: {end_str[:30]}...")
        return
    
    end_idx += len(end_str)
    code = code[:start_idx] + replacement + code[end_idx:]

# 1. Replace the entire roomConsole
replace_between(
    '<View style={styles.roomConsole}>',
    '</View>\n\n            {/* Unified Matchmaking Stage: 3 Seats in Triangular Layout */}',
    ''
)

# 2. Replace the entire Host Queue, Guide Card, and Leaderboard
replace_between(
    '{/* Host Connect/Match guests action button */}',
    '</View>\n\n          {/* ───── ZONE 2: THE FEED (Absolute Overlay) ───── */}',
    '</View>\n\n          {/* ───── ZONE 2: THE FEED (Absolute Overlay) ───── */}'
)

# 3. Replace stageHeader
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

replace_between(
    '<View style={styles.stageHeader}>',
    '</View>\n\n            {/* Unified Matchmaking Stage: 3 Seats in Triangular Layout */}',
    header_replacement + '\n\n            {/* Unified Matchmaking Stage: 3 Seats in Triangular Layout */}'
)

# 4. Action Bar
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
          </View>'''

replace_between(
    '{/* ───── ZONE 3: ACTION BAR ───── */}',
    '</View>\n\n          {/* ── Shared Profile Review Modal (all room members see this) ── */}',
    action_bar_replacement + '\n\n          {/* ── Shared Profile Review Modal (all room members see this) ── */}'
)

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

code = code.replace('const styles = StyleSheet.create({', 'const styles = StyleSheet.create({' + new_styles)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(code)

print("UI successfully rewritten.")
