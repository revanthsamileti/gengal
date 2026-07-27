import re
import sys

file_path = 'src/screens/ExpertRoomScreen.tsx'
with open(file_path, 'r', encoding='utf-8') as f:
    code = f.read()

# 1. Remove roomConsole
code = re.sub(
    r'<View style=\{styles\.roomConsole\}>.*?</View>\s*</View>\s*<View style=\{styles\.triangularStage\}>',
    '<View style={styles.triangularStage}>',
    code,
    flags=re.DOTALL
)

# 2. Remove all host queues and guide cards
code = re.sub(
    r'\{/\* Host Connect/Match guests action button \*/\}.*?\{/\* ───── ZONE 2: THE FEED \(Absolute Overlay\) ───── \*/\}',
    '{/* ───── ZONE 2: THE FEED (Absolute Overlay) ───── */}',
    code,
    flags=re.DOTALL
)

# 3. Clean up the Header layout to match phone1_screen.png
# We want just: back btn, lang tag, topic text, share btn, live pill + count
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

code = re.sub(
    r'<View style=\{styles\.stageHeader\}>.*?</View>\s*</View>\s*</View>',
    header_replacement,
    code,
    flags=re.DOTALL
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

code = re.sub(
    r'\{/\* ───── ZONE 3: ACTION BAR ───── \*/\}.*?</View>\s*\{/\* ── Shared Profile Review Modal \(all room members see this\) ── \*/\}',
    action_bar_replacement + '\n\n          {/* ── Shared Profile Review Modal (all room members see this) ── */}',
    code,
    flags=re.DOTALL
)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(code)

print("UI successfully rewritten.")
