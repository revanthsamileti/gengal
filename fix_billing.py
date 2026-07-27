import re

with open('src/screens/CallScreen.tsx', 'r') as f:
    content = f.read()

# Modify the billing loop to check !isConnecting
old_billing = '''    const billingInterval = setInterval(async () => {
      const user = auth.currentUser;
      if (!user) return;'''

new_billing = '''    const billingInterval = setInterval(async () => {
      if (isConnecting) return; // Do not bill while waiting for answer
      const user = auth.currentUser;
      if (!user) return;'''

content = content.replace(old_billing, new_billing)

# Also ensure the useEffect has isConnecting in its dependency array
old_billing_deps = '''    }, [roomId, matchData?.uid, globalSettings, currentUserProfile]);'''
new_billing_deps = '''    }, [roomId, matchData?.uid, globalSettings, currentUserProfile, isConnecting]);'''

content = content.replace(old_billing_deps, new_billing_deps)

with open('src/screens/CallScreen.tsx', 'w') as f:
    f.write(content)
print("Fixed billing")
