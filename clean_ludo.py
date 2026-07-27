import re

with open('src/screens/LudoBoardScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Remove duplicate injected imports
content = re.sub(r"import Svg.*?from '\./LudoConstants';", "", content, flags=re.DOTALL)

# Add it once after LinearGradient
imports = """import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Polygon, Circle } from 'react-native-svg';
import { PATH, PLAYERS, PLAYER_NAMES, START_INDEX, STAR_CELLS, HOME_COLUMN, BASE_ORIGIN, BASE_PADS, HOME_REST, HOME_PROGRESS, cellForProgress, PlayerColor, Cell } from './LudoConstants';"""
content = content.replace("import { LinearGradient } from 'expo-linear-gradient';", imports)

# 2. Fix absoluteFillObject
content = content.replace("StyleSheet.absoluteFillObject", "StyleSheet.absoluteFill")

# 3. Fix styles.loading
content = content.replace("styles.loading", "{ flex: 1, alignItems: 'center', justifyContent: 'center' }")

# 4. Remove duplicate BOARD_SIZE declaration
content = re.sub(r"const BOARD_SIZE = Math\.floor\(Math\.min\(Dimensions\.get\('window'\)\.width, 400\) \* 0\.9\);", "", content)

with open('src/screens/LudoBoardScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
