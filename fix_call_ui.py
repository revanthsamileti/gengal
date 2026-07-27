import re

with open('src/screens/CallScreen.tsx', 'r') as f:
    content = f.read()

# Fix voice branch
content = re.sub(
    r'(\{isConnecting && \(\s*<ConnectingOverlay.*?/>\s*\)\})\s*<View style=\{styles\.voicePhone\}>',
    r'{isConnecting ? (\n          <ConnectingOverlay \n            mode="private" \n            targetName={profile.name}\n            onCancel={() => {\n              disconnectSeat();\n              goBack();\n            }} \n          />\n        ) : (\n          <View style={styles.voicePhone}>',
    content,
    flags=re.DOTALL
)

# Close voice branch ternary
content = re.sub(
    r'(\s*</View>\s*</View>\s*)(\s*</ScreenShell>)',
    r'\1        )}\2',
    content,
    count=1
)

# Fix video branch
content = re.sub(
    r'(\{isConnecting && \(\s*<ConnectingOverlay.*?/>\s*\)\})\s*<View style=\{styles\.videoPhone\}>',
    r'{isConnecting ? (\n        <ConnectingOverlay \n          mode="private" \n          targetName={profile.name}\n          onCancel={() => {\n            disconnectSeat();\n            goBack();\n          }} \n        />\n      ) : (\n        <View style={styles.videoPhone}>',
    content,
    flags=re.DOTALL
)

# Close video branch ternary
content = re.sub(
    r'(\s*</View>\s*)(\s*</ScreenShell>)',
    r'\1      )}\2',
    content,
    count=1
)

with open('src/screens/CallScreen.tsx', 'w') as f:
    f.write(content)
print("Done")
