import re

file_path = 'src/screens/ExpertRoomScreen.tsx'
with open(file_path, 'r', encoding='utf-8') as f:
    code = f.read()

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

print("Styles appended successfully.")
