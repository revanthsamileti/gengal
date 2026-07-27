const fs = require('fs');
const path = require('path');
const dirs = ['src/screens', 'src/services', 'src/components'];

function processDir(directory) {
  if (!fs.existsSync(directory)) return;
  const files = fs.readdirSync(directory);
  for (const file of files) {
    const fullPath = path.join(directory, file);
    if (fs.statSync(fullPath).isDirectory()) {
      processDir(fullPath);
    } else if (fullPath.endsWith('.tsx') || fullPath.endsWith('.ts')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      if (content.includes('Alert.alert') || content.includes('import { Alert')) {
        // Find import { ..., Alert, ... } from 'react-native'
        const reactNativeImportRegex = /import\s+({[^}]*?})\s+from\s+['"]react-native['"];?/;
        const match = content.match(reactNativeImportRegex);
        if (match) {
          let importBody = match[1];
          if (importBody.includes('Alert')) {
            importBody = importBody.replace(/\bAlert\b\s*,?\s*/g, '');
            // clean up
            importBody = importBody.replace(/,\s*,/g, ',');
            importBody = importBody.replace(/{\s*,/g, '{ ');
            importBody = importBody.replace(/,\s*}/g, ' }');
            
            if (importBody.trim() === '{}') {
              content = content.replace(match[0], '');
            } else {
              content = content.replace(match[1], importBody);
            }
          }
        }
        
        // Add custom import if it has Alert.alert
        if (content.includes('Alert.alert') && !content.includes('import { Alert } from ')) {
          content = "import { Alert } from '../components/CustomAlert';\n" + content;
        }
        
        fs.writeFileSync(fullPath, content);
        console.log('Updated: ' + fullPath);
      }
    }
  }
}

for (const dir of dirs) {
  processDir(dir);
}
