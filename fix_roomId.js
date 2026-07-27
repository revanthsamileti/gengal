const fs = require('fs');
const path = require('path');

const dir = 'd:/GenGal/src/screens';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.tsx'));

for (const file of files) {
  const filePath = path.join(dir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  let changed = false;

  const regex = /navigate\('Call',\s*\{([^}]+)\}\)/g;
  content = content.replace(regex, (match, inner) => {
    if (!inner.includes('roomId')) {
      changed = true;
      return "navigate('Call', { roomId: Math.random().toString(36).substring(7), " + inner + " })";
    }
    return match;
  });

  if (changed) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Fixed ' + file);
  }
}
