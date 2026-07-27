import re
import os

filepath = 'src/screens/LudoBoardScreen.tsx'

with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add Imports
if "import TopBar from '../components/TopBar';" not in content:
    content = content.replace("import ScreenShell from '../components/ScreenShell';",
"""import TopBar from '../components/TopBar';
import ScreenShell from '../components/ScreenShell';
import { useGengalVoice } from '../hooks/useGengalVoice';
import { colors } from '../theme/colors';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'react-native'; // just for simple usage, actually Clipboard is in react-native""")

# 2. PlayerPanel changes
panel_def = "function PlayerPanel({ player, color, tokens, isActive, rank }: { player: LudoPlayer | null, color: TokenColor, tokens: Token[], isActive: boolean, rank: number | null }) {"
new_panel_def = "function PlayerPanel({ player, color, tokens, isActive, rank, onPress }: { player: LudoPlayer | null, color: TokenColor, tokens: Token[], isActive: boolean, rank: number | null, onPress?: () => void }) {"

if new_panel_def not in content:
    content = content.replace(panel_def, new_panel_def)

panel_return = """    <Animated.View style={[panelStyles.container, { transform: [{ scale: pulse }], borderColor: isActive ? COLOR_BG[color] : 'rgba(255,255,255,0.1)' }]}>"""
new_panel_return = """    <TouchableOpacity activeOpacity={0.8} onPress={onPress} style={{flex: 1}}>
      <Animated.View style={[panelStyles.container, { transform: [{ scale: pulse }], borderColor: isActive ? COLOR_BG[color] : 'rgba(255,255,255,0.1)' }]}>"""
content = content.replace(panel_return, new_panel_return)

panel_close = """    </Animated.View>
  );
}"""
new_panel_close = """      </Animated.View>
    </TouchableOpacity>
  );
}"""
content = content.replace(panel_close, new_panel_close)

# 3. Component state
state_injection = """  const [secondsLeft, setSecondsLeft] = useState(15);
  const captureAnim = useRef(new Animated.Value(0)).current;"""

new_state_injection = """  const [secondsLeft, setSecondsLeft] = useState(15);
  const captureAnim = useRef(new Animated.Value(0)).current;

  const [giftTarget, setGiftTarget] = useState<string | null>(null);

  const { connectSeat, disconnectSeat, toggleMic, micMuted, toggleSpeaker, speakerOn } = useGengalVoice('agora');
  
  useEffect(() => {
    if (roomId && myUid) {
      connectSeat(roomId, "ludo_" + roomId, myUid);
    }
    return () => disconnectSeat();
  }, [roomId, myUid]);"""
if "setGiftTarget" not in content:
    content = content.replace(state_injection, new_state_injection)

# 4. Header Replacement
old_header = """          {/* Header */}
          <View style={newStyles.header}>
            <View>
              <Text style={newStyles.royal}>ROYAL</Text>
              <Text style={newStyles.ludoTitle}>Ludo</Text>
            </View>
            <TouchableOpacity onPress={() => startGame(roomId)} style={newStyles.newGameBtn}>
              <MaterialIcons name="refresh" size={16} color="rgba(255,255,255,0.6)" />
              <Text style={newStyles.newGameText}>New Game</Text>
            </TouchableOpacity>
          </View>"""

new_header = """          {/* Header & Actions */}
          <TopBar navigate={navigate} title="LUDO ARENA" subtitle={`Room: ${roomId}`} />
          <View style={newStyles.actionBar}>
            <TouchableOpacity onPress={handleLeave} style={newStyles.actionBtnError}>
              <MaterialIcons name="exit-to-app" size={16} color="#FFF" />
              <Text style={newStyles.actionText}>Leave</Text>
            </TouchableOpacity>

            <View style={{flexDirection: 'row', gap: 10}}>
              <TouchableOpacity onPress={toggleMic} style={[newStyles.actionBtn, micMuted && newStyles.actionBtnError]}>
                <Ionicons name={micMuted ? "mic-off" : "mic"} size={18} color="#FFF" />
              </TouchableOpacity>
              <TouchableOpacity onPress={toggleSpeaker} style={[newStyles.actionBtn, !speakerOn && newStyles.actionBtnError]}>
                <Ionicons name={speakerOn ? "volume-high" : "volume-mute"} size={18} color="#FFF" />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => startGame(roomId)} style={newStyles.actionBtn}>
                <MaterialIcons name="refresh" size={18} color="#FFF" />
              </TouchableOpacity>
            </View>
          </View>"""
content = content.replace(old_header, new_header)

# 5. Gift Modal and PlayerPanel bindings
# We need to bind PlayerPanel onPress to setGiftTarget
content = content.replace(
    """<PlayerPanel player={room.players.find(p => p.color === 'red') || null} color="red" tokens={room.tokens} isActive={room.currentTurn === 'red'} rank={room.winnersOrder.indexOf(room.players.find(p => p.color === 'red')?.uid || '') > -1 ? room.winnersOrder.indexOf(room.players.find(p => p.color === 'red')?.uid || '') + 1 : null} />""",
    """<PlayerPanel player={room.players.find(p => p.color === 'red') || null} color="red" tokens={room.tokens} isActive={room.currentTurn === 'red'} rank={room.winnersOrder.indexOf(room.players.find(p => p.color === 'red')?.uid || '') > -1 ? room.winnersOrder.indexOf(room.players.find(p => p.color === 'red')?.uid || '') + 1 : null} onPress={() => { const p = room.players.find(x => x.color === 'red'); if(p && p.uid !== myUid) setGiftTarget(p.uid); }} />"""
)
content = content.replace(
    """<PlayerPanel player={room.players.find(p => p.color === 'green') || null} color="green" tokens={room.tokens} isActive={room.currentTurn === 'green'} rank={room.winnersOrder.indexOf(room.players.find(p => p.color === 'green')?.uid || '') > -1 ? room.winnersOrder.indexOf(room.players.find(p => p.color === 'green')?.uid || '') + 1 : null} />""",
    """<PlayerPanel player={room.players.find(p => p.color === 'green') || null} color="green" tokens={room.tokens} isActive={room.currentTurn === 'green'} rank={room.winnersOrder.indexOf(room.players.find(p => p.color === 'green')?.uid || '') > -1 ? room.winnersOrder.indexOf(room.players.find(p => p.color === 'green')?.uid || '') + 1 : null} onPress={() => { const p = room.players.find(x => x.color === 'green'); if(p && p.uid !== myUid) setGiftTarget(p.uid); }} />"""
)
content = content.replace(
    """<PlayerPanel player={room.players.find(p => p.color === 'blue') || null} color="blue" tokens={room.tokens} isActive={room.currentTurn === 'blue'} rank={room.winnersOrder.indexOf(room.players.find(p => p.color === 'blue')?.uid || '') > -1 ? room.winnersOrder.indexOf(room.players.find(p => p.color === 'blue')?.uid || '') + 1 : null} />""",
    """<PlayerPanel player={room.players.find(p => p.color === 'blue') || null} color="blue" tokens={room.tokens} isActive={room.currentTurn === 'blue'} rank={room.winnersOrder.indexOf(room.players.find(p => p.color === 'blue')?.uid || '') > -1 ? room.winnersOrder.indexOf(room.players.find(p => p.color === 'blue')?.uid || '') + 1 : null} onPress={() => { const p = room.players.find(x => x.color === 'blue'); if(p && p.uid !== myUid) setGiftTarget(p.uid); }} />"""
)
content = content.replace(
    """<PlayerPanel player={room.players.find(p => p.color === 'yellow') || null} color="yellow" tokens={room.tokens} isActive={room.currentTurn === 'yellow'} rank={room.winnersOrder.indexOf(room.players.find(p => p.color === 'yellow')?.uid || '') > -1 ? room.winnersOrder.indexOf(room.players.find(p => p.color === 'yellow')?.uid || '') + 1 : null} />""",
    """<PlayerPanel player={room.players.find(p => p.color === 'yellow') || null} color="yellow" tokens={room.tokens} isActive={room.currentTurn === 'yellow'} rank={room.winnersOrder.indexOf(room.players.find(p => p.color === 'yellow')?.uid || '') > -1 ? room.winnersOrder.indexOf(room.players.find(p => p.color === 'yellow')?.uid || '') + 1 : null} onPress={() => { const p = room.players.find(x => x.color === 'yellow'); if(p && p.uid !== myUid) setGiftTarget(p.uid); }} />"""
)

# 6. Gift Modal Injection
modal_injection = """      {room.phase === 'finished' && (
        <WinModal room={room} myUid={myUid} onClose={handleLeave} />
      )}
      
      <Modal visible={!!giftTarget} transparent animationType="fade" onRequestClose={() => setGiftTarget(null)}>
        <TouchableOpacity style={newStyles.modalOverlay} activeOpacity={1} onPress={() => setGiftTarget(null)}>
          <View style={newStyles.giftModal} onStartShouldSetResponder={() => true}>
            <Text style={newStyles.giftTitle}>Send a Gift</Text>
            <View style={newStyles.giftList}>
              {LUDO_GIFTS.map(g => (
                <TouchableOpacity key={g.id} style={newStyles.giftBtn} onPress={() => { 
                    handleGift(g); 
                    setGiftTarget(null);
                    ToastAndroid?.show?.(`Sent ${g.emoji} to player!`, ToastAndroid.SHORT);
                }}>
                  <Text style={{fontSize: 32}}>{g.emoji}</Text>
                  <Text style={{color:'#FFF', fontSize: 12, fontWeight: 'bold'}}>{g.name}</Text>
                  <Text style={{color:colors.gold, fontSize: 10}}>{g.cost} 💎</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </ScreenShell>"""
if "<Modal visible={!!giftTarget}" not in content:
    content = content.replace("""      {room.phase === 'finished' && (
        <WinModal room={room} myUid={myUid} onClose={handleLeave} />
      )}
    </ScreenShell>""", modal_injection)

# 7. Theme Updates (Styles)
content = content.replace("container: { flex: 1, backgroundColor: '#0B1121' }", "container: { flex: 1, backgroundColor: colors.backgroundCard }")
content = content.replace("chatContainer: { flex: 1, marginHorizontal: 20, marginBottom: 10, backgroundColor: 'rgba(15,23,42,0.5)', borderRadius: 16, padding: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' }", "chatContainer: { flex: 1, marginHorizontal: 20, marginBottom: 10, backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 16, padding: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' }")
content = content.replace("panelStyles = StyleSheet.create({", "panelStyles = StyleSheet.create({")
content = content.replace("backgroundColor: 'rgba(15,23,42,0.8)'", "backgroundColor: 'rgba(255,255,255,0.05)'")

# Action bar styles
if "actionBar:" not in content:
    content = content.replace("});", """  actionBar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 10 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.plumMuted, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  actionBtnError: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(220,38,38,0.8)', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  actionText: { fontSize: 12, fontWeight: 'bold', color: '#FFF' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  giftModal: { backgroundColor: colors.backgroundElevated, borderRadius: 20, padding: 20, width: '85%', alignItems: 'center', borderWidth: 1, borderColor: colors.gold },
  giftTitle: { color: colors.textPrimary, fontSize: 20, fontWeight: 'bold', marginBottom: 15 },
  giftList: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10 },
  giftBtn: { backgroundColor: 'rgba(255,255,255,0.05)', padding: 10, borderRadius: 12, alignItems: 'center', width: 70, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }
});""")

# Update chat bubble text color to be more readable
content = content.replace("color: 'rgba(255,255,255,0.7)', fontSize: 12", "color: colors.textPrimary, fontSize: 13, flexShrink: 1")
content = content.replace("ToastAndroid,", "ToastAndroid, Clipboard,")


with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print("Updated LudoBoardScreen.tsx")
