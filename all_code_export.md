

# app.json
```json
{
  "expo": {
    "name": "GenGal",
    "slug": "GenGal",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/icon.png",
    "userInterfaceStyle": "light",
    "ios": {
      "supportsTablet": true
    },
    "android": {
      "adaptiveIcon": {
        "backgroundColor": "#E6F4FE",
        "foregroundImage": "./assets/android-icon-foreground.png",
        "backgroundImage": "./assets/android-icon-background.png",
        "monochromeImage": "./assets/android-icon-monochrome.png"
      },
      "predictiveBackGestureEnabled": false,
      "package": "com.revanth_fk.x.GenGal",
      "permissions": [
        "android.permission.CAMERA",
        "android.permission.RECORD_AUDIO",
        "android.permission.MODIFY_AUDIO_SETTINGS",
        "android.permission.ACCESS_NETWORK_STATE",
        "android.permission.BLUETOOTH",
        "android.permission.INTERNET"
      ]
    },
    "web": {
      "favicon": "./assets/favicon.png"
    },
    "plugins": [
      "expo-font",
      [
        "expo-audio",
        {
          "microphonePermission": "Allow $(PRODUCT_NAME) to access your microphone."
        }
      ],
      [
        "expo-image-picker",
        {
          "photosPermission": "The app accesses your photos to let you share them with your friends."
        }
      ]
    ],
    "extra": {
      "eas": {
        "projectId": "5dad5e21-3524-4aff-98e7-d1c6bc12a2ef"
      }
    }
  }
}

```


# App.tsx
```tsx
// @ts-nocheck
import React, { useState, useEffect, Component, ErrorInfo, ReactNode } from 'react';
import { Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, Text, Alert } from 'react-native';
import { auth } from './src/config/firebase';
import { onAuthStateChanged, User, signOut } from 'firebase/auth';
import { useFonts } from 'expo-font';
import { MaterialIcons } from '@expo/vector-icons';
import HomeScreen from './src/screens/HomeScreen';
import ExpertRoomScreen from './src/screens/ExpertRoomScreen';
import ClubScreen from './src/screens/ClubScreen';
import PersonalScreen from './src/screens/PersonalScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import CallScreen from './src/screens/CallScreen';
import MatchScreen from './src/screens/MatchScreen';
import ChatScreen from './src/screens/ChatScreen';
import LanguageScreen from './src/screens/LanguageScreen';
import PhoneScreen from './src/screens/PhoneScreen';
import OtpScreen from './src/screens/OtpScreen';
import AvatarScreen from './src/screens/AvatarScreen';
import FinalizeInviteScreen from './src/screens/FinalizeInviteScreen';
import ProfileDetailsScreen from './src/screens/ProfileDetailsScreen';
import EarningsScreen from './src/screens/EarningsScreen';
import ActiveConnectsScreen from './src/screens/ActiveConnectsScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import AdminPanelScreen from './src/screens/AdminPanelScreen';
import CoinsScreen from './src/screens/CoinsScreen';
import { ThemeProvider } from './src/theme/ThemeContext';
import { UserProvider } from './src/context/UserContext';
import { getUserProfile } from './src/services/userService';
import { globalAuthMode } from './src/screens/PhoneScreen';
import CreatePasswordScreen from './src/screens/CreatePasswordScreen';
import ForgotPasswordScreen from './src/screens/ForgotPasswordScreen';
import LoginPasswordScreen from './src/screens/LoginPasswordScreen';

// --- REMOTE LOGGER ---
if (Platform.OS === 'web') {
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  
  console.log = (...args) => {
    originalConsoleLog(...args);
  };
  
  console.error = (...args) => {
    originalConsoleError(...args);
  };

  // Ensure the web app fills the entire viewport properly (fixes mobile view in F12 devtools)
  try {
    const style = document.createElement('style');
    style.textContent = `
      html, body, #root {
        height: 100%;
        width: 100%;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
      }
      #root > div {
        flex: 1;
        width: 100%;
        height: 100%;
      }
    `;
    document.head.appendChild(style);
  } catch (e) {}
}
// ----------------------
type ScreenName = 'Home' | 'Club' | 'ExpertRoom' | 'Personal' | 'Profile' | 'Call' | 'Match' | 'Chat' | 'Language' | 'Phone' | 'FinalizeInvite' | 'ProfileDetails'  | 'ActiveConnects'
  | 'Settings'
  | 'AdminPanel'
  | 'Coins'
  | 'Earnings'
  | 'CreatePassword';

type NavigationParams = {
  profileName?: string;
  mode?: 'call' | 'video';
  avatarData?: any;
  roomId?: string;
  matchData?: any;
  isCaller?: boolean;
  [key: string]: any;
};

class ErrorBoundary extends Component<{children: ReactNode}, {hasError: boolean, error: Error | null}> {
  constructor(props: {children: ReactNode}) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <Text style={{ color: 'red', fontSize: 18, marginBottom: 10 }}>Something went wrong.</Text>
          <Text style={{ color: 'black' }}>{this.state.error?.toString()}</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [fontsLoaded] = useFonts({
    ...MaterialIcons.font,
  });

  const [navStack, setNavStack] = useState<{name: ScreenName, params: NavigationParams}[]>([{ name: 'Language', params: {} }]);
  
  const currentRoute = navStack[navStack.length - 1];
  const screen = currentRoute.name;
  const params = currentRoute.params;

  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const resetTo = (next: ScreenName, params: NavigationParams = {}) => {
    setNavStack([{ name: next, params }]);
  };

  const navigate = (next: string, nextParams: NavigationParams = {}) => {
    if (
      next === 'Home' || next === 'Club' || next === 'ExpertRoom' || next === 'Personal' || next === 'Profile' || next === 'Call' || next === 'Match' || next === 'Chat' || next === 'Language' || next === 'Phone' || next === 'FinalizeInvite' || next === 'ProfileDetails' || next === 'ActiveConnects' || next === 'Settings' || next === 'AdminPanel' || next === 'Coins' || next === 'Earnings' || next === 'CreatePassword' || next === 'ForgotPassword' || next === 'Otp' || next === 'Avatar' || next === 'LoginPassword'
    ) {
      setNavStack(prev => [...prev, { name: next as ScreenName, params: nextParams }]);
    }
  };

  const goBack = () => {
    setNavStack(prev => prev.length > 1 ? prev.slice(0, -1) : prev);
  };

  useEffect(() => {
    if (Platform.OS !== 'web') {
      const { BackHandler } = require('react-native');
      const backAction = () => {
        if (navStack.length > 1) {
          goBack();
          return true; // handled
        }
        return false; // exit app
      };
      const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
      return () => backHandler.remove();
    }
  }, [navStack.length]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        try {
          const profile = await getUserProfile(currentUser.uid);
          const isComplete = Boolean(profile && profile.username && profile.nickname && profile.age && profile.gender && (profile.avatar3dUrl || profile.avatarData || profile.avatarUrl));
          
          if (isComplete) {
            if (['Language', 'Phone', 'Otp', 'FinalizeInvite', 'ProfileDetails', 'Avatar', 'CreatePassword', 'LoginPassword'].includes(screen)) {
              resetTo('Home');
            }
          } else {
            resetTo('ProfileDetails');
          }
        } catch (e) {
          resetTo('ProfileDetails');
        }
      } else {
        resetTo('Language');
      }
      setIsLoading(false);
    });

    return unsubscribe;
  }, []);

  if (isLoading || !fontsLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: '#FFFDF8', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color="#D49A0B" />
      </View>
    );
  }

  return (
    <ErrorBoundary>
      <UserProvider>
        <StatusBar style={screen === 'Call' && params.mode === 'video' ? 'light' : 'dark'} />
        {screen === 'Home' && <HomeScreen navigate={navigate} goBack={goBack} />}
        {screen === 'ExpertRoom' && <ExpertRoomScreen navigate={navigate} goBack={goBack} />}
        {screen === 'Club' && <ClubScreen navigate={navigate} goBack={goBack} />}
        {screen === 'Personal' && <PersonalScreen navigate={navigate} goBack={goBack} />}
        {screen === 'Profile' && (
          <ProfileScreen profileName={params.profileName} navigate={navigate} goBack={goBack} route={{ params }} />
        )}
        {screen === 'Call' && (
          <CallScreen profileName={params.profileName} mode={params.mode} roomId={params.roomId} matchData={params.matchData} isCaller={params.isCaller} navigate={navigate} goBack={goBack} />
        )}
        {screen === 'Match' && (
          <MatchScreen profileName={params.profileName} matchData={params.matchData} roomId={params.roomId} navigate={navigate} goBack={goBack} />
        )}
        {screen === 'Chat' && (
          <ChatScreen profileName={params.profileName} navigate={navigate} goBack={goBack} route={{ params }} />
        )}
        {screen === 'Language' && <LanguageScreen navigate={navigate} goBack={goBack} route={{ params }} />}
        {screen === 'Phone' && <PhoneScreen navigate={navigate} goBack={goBack} route={{ params }} />}
        {screen === 'Otp' && <OtpScreen navigate={navigate} goBack={goBack} route={{ params }} />}
        {screen === 'Avatar' && <AvatarScreen navigate={navigate} goBack={goBack} route={{ params }} />}
        {screen === 'FinalizeInvite' && <FinalizeInviteScreen navigate={navigate} goBack={goBack} route={{ params }} />}
        {screen === 'ProfileDetails' && (
          <ProfileDetailsScreen navigate={navigate} goBack={goBack} route={{ params }} />
        )}
        {screen === 'ActiveConnects' && <ActiveConnectsScreen navigate={navigate} goBack={goBack} />}
        {screen === 'Settings' && <SettingsScreen navigate={navigate} goBack={goBack} />}
        {screen === 'AdminPanel' && <AdminPanelScreen navigate={navigate} goBack={goBack} />}
        {screen === 'Coins' && <CoinsScreen navigate={navigate} goBack={goBack} />}
        {screen === 'Earnings' && <EarningsScreen navigate={navigate} goBack={goBack} />}
        {screen === 'CreatePassword' && <CreatePasswordScreen navigate={navigate} goBack={goBack} route={{ params }} />}
        {screen === 'ForgotPassword' && <ForgotPasswordScreen navigate={navigate} goBack={goBack} route={{ params }} />}
        {screen === 'LoginPassword' && <LoginPasswordScreen navigate={navigate} goBack={goBack} route={{ params }} />}
      </UserProvider>
    </ErrorBoundary>
  );
}

```


# eas.json
```json
{
  "cli": {
    "version": ">= 7.0.0"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      }
    },
    "preview": {
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      }
    },
    "production": {}
  },
  "submit": {
    "production": {}
  }
}

```


# export_code.py
```py
import os

# Define the root directories you want to scan
project_root = 'd:/GenGal'
output_file = 'd:/GenGal/all_code_export.md'

# Directories to ignore
ignore_dirs = {
    'node_modules', '.git', '.expo', 'dist', 'android', 'ios', 
    'venv', '__pycache__', '.idea', '.cursor', 'temp_media'
}

# File extensions to include
include_exts = {'.ts', '.tsx', '.js', '.jsx', '.py', '.json', '.css'}

# Files to ignore (e.g. package-lock.json)
ignore_files = {'package-lock.json'}

with open(output_file, 'w', encoding='utf-8') as out:
    for root, dirs, files in os.walk(project_root):
        # Modify dirs in-place to skip ignored directories
        dirs[:] = [d for d in dirs if d not in ignore_dirs]
        
        for file in files:
            if file in ignore_files:
                continue
            
            ext = os.path.splitext(file)[1].lower()
            if ext in include_exts:
                file_path = os.path.join(root, file)
                rel_path = os.path.relpath(file_path, project_root)
                
                out.write(f"\n\n# {rel_path}\n")
                out.write(f"```{ext[1:]}\n")
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        out.write(f.read())
                except Exception as e:
                    out.write(f"// Error reading file: {e}\n")
                out.write("\n```\n")

print(f"Code successfully exported to {output_file}")

```


# index.ts
```ts
import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

```


# package.json
```json
{
  "name": "gengal",
  "version": "1.0.0",
  "main": "index.ts",
  "dependencies": {
    "@dicebear/collection": "^9.4.2",
    "@dicebear/core": "^9.4.2",
    "@expo/metro-runtime": "~56.0.15",
    "@expo/vector-icons": "^15.0.2",
    "expo": "~56.0.12",
    "expo-audio": "~56.0.12",
    "expo-blur": "~56.0.3",
    "expo-dev-client": "~56.0.20",
    "expo-font": "~56.0.7",
    "expo-image-picker": "~56.0.18",
    "expo-linear-gradient": "~56.0.4",
    "expo-status-bar": "~56.0.4",
    "firebase": "^12.15.0",
    "react": "19.2.3",
    "react-dom": "19.2.3",
    "react-native": "0.85.3",
    "react-native-agora": "^4.5.4",
    "react-native-avataaars": "^1.0.2",
    "react-native-safe-area-context": "~5.7.0",
    "react-native-svg": "15.15.4",
    "react-native-web": "^0.21.2",
    "react-native-web-webview": "^1.0.2",
    "react-native-webview": "13.16.1"
  },
  "devDependencies": {
    "@types/react": "~19.2.2",
    "typescript": "~6.0.3"
  },
  "scripts": {
    "start": "expo start",
    "expo-start": "expo start",
    "android": "expo run:android",
    "ios": "expo run:ios",
    "web": "expo start --web"
  },
  "private": true
}

```


# test_db.py
```py
import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate("backend/serviceAccountKey.json")
firebase_admin.initialize_app(cred)
db = firestore.client()

doc = db.collection('users').document('fast2sms:+919441488911').get()
if doc.exists:
    print(f"User exists. Password: {doc.to_dict().get('password')}")
else:
    print("User does not exist")

```


# test_login.py
```py
import requests

url = "http://127.0.0.1:5000/api/v1/auth/login-password"
payload = {
    "phone": "+919441488911",
    "password": "@Revanth7672"
}
response = requests.post(url, json=payload)
print(response.status_code)
print(response.json())

```


# tsconfig.json
```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true
  }
}

```


# .claude\settings.json
```json
{
  "enabledPlugins": {
    "expo@claude-plugins-official": true
  }
}

```


# .claude\settings.local.json
```json
{
  "permissions": {
    "allow": [
      "Skill(deep-research)",
      "Workflow(deep-research)"
    ]
  }
}

```


# backend\app.py
```py
from flask import Flask, request, jsonify
from flask_cors import CORS
import cv2
import numpy as np
import os
import hashlib
import time
import sys
import random
import requests
from datetime import datetime, timedelta
import firebase_admin
from firebase_admin import credentials, auth, firestore
from agora_token_builder import RtcTokenBuilder

app = Flask(__name__)

# Initialize Firebase Admin
try:
    cred = credentials.Certificate("serviceAccountKey.json")
    firebase_admin.initialize_app(cred)
    print("Firebase Admin initialized successfully.")
except Exception as e:
    print(f"Warning: Could not initialize Firebase Admin: {e}")

# Fast2SMS Global config
FAST2SMS_API_KEY = os.environ.get("FAST2SMS_API_KEY", "h8nuf5QxcDNkayBWY9XsPHKIq0EAT1woiZFRGtdmUCj74vlV2SOgTH6iYxJ4eWD5olj1kVGvympIc3nq")
otp_store = {} # simple dictionary mapping { phone: { "otp": "123456", "expires": datetime } }

# Securely extract your credentials from the environment variables
AGORA_APP_ID = "d463dbabe1ee41ef8c4fa19c09464708"  # Kept securely on the server
AGORA_APP_CERTIFICATE = "92533415a358494fb615e8294951d37f"  # Kept safely server-side
DAILY_API_KEY = os.environ.get("DAILY_API_KEY", "930d9272d97f5c9a6163ba81cbf5de0a8eed4e42ac77ce0810e28d5b3fa3aae4")
DAILY_API_URL = "https://api.daily.co/v1/rooms"
STREAM_API_KEY = os.environ.get("STREAM_API_KEY", "ndymgdzukye2")
STREAM_SECRET = os.environ.get("STREAM_SECRET", "avb6uatvf5r44f6j22ejpxtuqwnpefzsctnp7tse7urrgz2ajq5bva32e25sauec")
# Secure server-side isolation of Red5 licensing variables
RED5_SDK_LICENSE = os.environ.get("RED5_SDK_LICENSE", "H1AH-6RJK-WNTK-EDE5")
# Change this configurable placeholder once your production cloud node spins up
RED5_SERVER_HOST = os.environ.get("RED5_SERVER_HOST", "YOUR_DEV_RED5_SERVER_IP_OR_DOMAIN")
DYTE_ORG_ID = os.environ.get("DYTE_ORG_ID", "3d496d09-de80-42f7-88ee-499869870e09")
DYTE_API_KEY = os.environ.get("DYTE_API_KEY", "cfk_DcMs13r3yvsNsm2Sqd7bxXxAv631GnhpFcdDLrLfa02d8fdc")
# Secure server-side isolation of Zego credentials
ZEGO_APP_ID = 2010051429
ZEGO_SERVER_SECRET = "591334531bcc2f495748d3d17aa9fc70"

CORS(app)

TEMP_DIR = "temp_media"
os.makedirs(TEMP_DIR, exist_ok=True)

# Load Free Pre-trained Caffe Models for High-Accuracy Gender Classification
GENDER_MODEL = "gender_net.caffemodel"
GENDER_PROTO = "gender_deploy.prototxt"

try:
    gender_net = cv2.dnn.readNetFromCaffe(GENDER_PROTO, GENDER_MODEL)
    gender_net_loaded = True
except Exception as e:
    print(f"Warning: Could not load gender model: {e}")
    gender_net_loaded = False

GENDER_LIST = ['Male', 'Female']
MODEL_MEAN_VALUES = (78.4263377603, 87.7689143744, 114.895847746)

def analyze_face_dna(img_path):
    img = cv2.imread(img_path)
    if img is None:
        return None

    h, w, _ = img.shape
    # Default Avatar DNA fallback structure
    dna = {
        "topType": "ShortHairShortWaved",
        "hairColor": "Black",
        "clotheType": "CrewNeck",
        "skinColor": "Light"
    }

    # 1. Run Gender Classification via OpenCV DNN Layer
    if gender_net_loaded:
        try:
            blob = cv2.dnn.blobFromImage(img, 1.0, (227, 227), MODEL_MEAN_VALUES, swapRB=False)
            gender_net.setInput(blob)
            gender_preds = gender_net.forward()
            gender = GENDER_LIST[gender_preds[0].argmax()]

            if gender == 'Female':
                dna["topType"] = "LongHairStraight"
                dna["clotheType"] = "CollarSweater"
            else:
                dna["topType"] = "ShortHairShortWaved"
                dna["clotheType"] = "GraphicShirt"
        except Exception as e:
            print(f"DNN Error: {e}")
            
    # 2. Basic Color Sample Analysis (Skin / Hair Detection Zones)
    # Convert to HSV color space to easily isolate lighting-independent skin/hair tones
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    
    # Sample center area for approximate skin complexion metrics
    center_tile = hsv[int(h*0.4):int(h*0.6), int(w*0.4):int(w*0.6)]
    if center_tile.size > 0:
        avg_brightness = np.mean(center_tile[:, :, 2])

        if avg_brightness < 100:
            dna["skinColor"] = "Black"
        elif avg_brightness < 160:
            dna["skinColor"] = "Brown"
        else:
            dna["skinColor"] = "Light"

    return dna

@app.route('/analyze-selfie', methods=['POST', 'OPTIONS'])
def analyze_selfie():
    if request.method == 'OPTIONS':
        return '', 200
        
    try:
        if 'photo' not in request.files:
            return jsonify({"status": "error", "message": "No file received"}), 400
            
        file = request.files['photo']
        filename = f"selfie_{int(time.time())}.jpg"
        path = os.path.join(TEMP_DIR, filename)
        file.save(path)
        
        avatar_dna = analyze_face_dna(path)
        os.remove(path) # Free up disk space immediately
        
        if avatar_dna:
            return jsonify({"status": "success", "avatarDNA": avatar_dna})
        else:
            return jsonify({"status": "error", "message": "Failed to analyze image"}), 400
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

# Proxy endpoint for frontend console logs
@app.route('/log', methods=['POST', 'OPTIONS'])
def handle_log():
    if request.method == 'OPTIONS':
        return '', 200
    data = request.json
    if data:
        level = data.get('level', 'log')
        message = data.get('message', '')
        print(f"[MOBILE BROWSER {level.upper()}]: {message}", flush=True)
    return '', 200

@app.route('/api/v1/agora/generate-token', methods=['POST', 'OPTIONS'])
def generate_agora_token():
    if request.method == 'OPTIONS':
        return '', 200
        
    try:
        data = request.json or {}
        room_id = data.get('roomId')
        user_uid = data.get('uid') # Numeric mapping or string representation

        if not room_id or not user_uid:
            return jsonify({"error": "Missing mandatory roomId or uid parameters"}), 400

        # Configuration setups
        # Role 1 is for RTC_ROLE_PUBLISHER (allows talking and listening)
        role = 1 
        expiration_time_in_seconds = 7200 # 2 Hours safe call limit
        current_timestamp = int(time.time())
        privilege_expired_ts = current_timestamp + expiration_time_in_seconds

        # Resolve an integer representation for the Agora user channel track
        # If uid is a string (like Firebase UID), use a hash or an integer map
        numeric_uid = int(user_uid) if str(user_uid).isdigit() else hash(user_uid) & 0x7FFFFFFF

        # Generate the cryptographic token
        token = RtcTokenBuilder.buildTokenWithUid(
            AGORA_APP_ID, 
            AGORA_APP_CERTIFICATE, 
            room_id, 
            numeric_uid, 
            role, 
            privilege_expired_ts
        )

        return jsonify({
            "token": token,
            "uid": numeric_uid,
            "expiresIn": expiration_time_in_seconds
        }), 200

    except Exception as e:
        print(f"[Agora Token Generation Error]: {str(e)}")
        return jsonify({"error": "Internal Token Server Exception"}), 500

@app.route('/api/v1/daily/create-room', methods=['POST', 'OPTIONS'])
def create_daily_room():
    if request.method == 'OPTIONS':
        return '', 200
        
    try:
        data = request.json or {}
        room_id = data.get('roomId')

        if not room_id:
            return jsonify({"error": "Missing mandatory roomId parameter"}), 400

        headers = {
            "Authorization": f"Bearer {DAILY_API_KEY}",
            "Content-Type": "application/json"
        }

        # Configure room parameters with a 2-hour automatic hard-stop expiration
        payload = {
            "name": room_id,
            "privacy": "public",  # Use public to avoid needing meeting tokens right now for simplicity
            "properties": {
                "exp": int(time.time()) + 7200, # 2 hours lifetime boundary
                "enable_chat": False,
                "start_audio_off": False,
                "start_video_off": True, # Strictly force audio-only configurations
            }
        }

        import requests
        # Step 1A: Attempt to create a new session room
        response = requests.post(DAILY_API_URL, json=payload, headers=headers)

        if response.status_code == 200:
            room_data = response.json()
            return jsonify({"roomUrl": room_data.get("url")}), 200

        # Step 1B: Handle conflict gracefully if room already exists (User 2 joining)
        elif response.status_code == 400 and "already exists" in response.text:
            get_url = f"{DAILY_API_URL}/{room_id}"
            get_response = requests.get(get_url, headers=headers)
            
            if get_response.status_code == 200:
                room_data = get_response.json()
                return jsonify({"roomUrl": room_data.get("url")}), 200
            
            return jsonify({"error": "Failed to pull existing room session details"}), get_response.status_code

        return jsonify({"error": "Daily API processing rejection"}), response.status_code

    except Exception as e:
        print(f"[Daily Room Proxy Exception]: {str(e)}")
        return jsonify({"error": "Internal Server Exception"}), 500

@app.route('/api/v1/stream/generate-token', methods=['POST', 'OPTIONS'])
def generate_stream_token():
    if request.method == 'OPTIONS':
        return '', 200
        
    try:
        import jwt
        data = request.json or {}
        user_uid = data.get('uid')

        if not user_uid:
            return jsonify({"error": "Missing mandatory user uid parameter"}), 400

        current_time = int(time.time())
        
        # Stream's official JWT Payload Requirement specifications
        payload = {
            "user_id": str(user_uid),
            "issued_at": current_time,
            "iat": current_time,
            "exp": current_time + 7200 # Automatically expires in 2 hours
        }

        # Crypto-sign the token locally using HS256 algorithm via PyJWT
        token = jwt.encode(payload, STREAM_SECRET, algorithm='HS256')

        return jsonify({
            "token": token,
            "apiKey": STREAM_API_KEY,
            "userId": str(user_uid)
        }), 200

    except Exception as e:
        print(f"[Stream JWT Generation Exception]: {str(e)}")
        return jsonify({"error": "Internal Token Server Exception"}), 500

@app.route('/api/v1/red5/config', methods=['GET'])
def get_red5_config():
    try:
        # Prevent open processing faults if server properties aren't ready
        if not RED5_SERVER_HOST or RED5_SERVER_HOST == "YOUR_DEV_RED5_SERVER_IP_OR_DOMAIN":
            return jsonify({"warning": "Red5 server cluster address is using a development placeholder"}), 200

        return jsonify({
            "sdkLicense": RED5_SDK_LICENSE,
            "host": RED5_SERVER_HOST,
            "port": "8554" # Default low-latency streaming proxy port layout
        }), 200

    except Exception as e:
        print(f"[Red5 Configuration Extraction Error]: {str(e)}")
        return jsonify({"error": "Internal Registry Exception"}), 500

@app.route('/api/v1/dyte/create-room', methods=['POST', 'OPTIONS'])
def create_dyte_room():
    if request.method == 'OPTIONS':
        return '', 200
        
    try:
        data = request.json or {}
        room_id = data.get('roomId')
        uid = data.get('uid')

        if not room_id or not uid:
            return jsonify({"error": "Missing mandatory parameters"}), 400

        import requests
        import base64
        
        auth_string = f"{DYTE_ORG_ID}:{DYTE_API_KEY}"
        auth_bytes = auth_string.encode('utf-8')
        base64_auth = base64.b64encode(auth_bytes).decode('utf-8')
        
        headers = {
            "Authorization": f"Basic {base64_auth}",
            "Content-Type": "application/json"
        }

        # Step 1: Create or fetch the meeting
        meeting_id = None
        
        # Try to find an existing meeting by title (room_id)
        # Dyte doesn't have an exact title search in v2 that works perfectly for idempotency,
        # but we can try to just create it. If it fails due to conflict, or we can just always create a new one?
        # Actually, if we just create a meeting, both users need to be in the SAME meeting.
        # So we MUST search for existing meetings or use a deterministic custom_participant_id strategy? No, meeting needs to be shared.
        # Let's search if a meeting exists.
        search_res = requests.get(f"https://api.dyte.io/v2/meetings", headers=headers)
        if search_res.status_code == 200:
            meetings = search_res.json().get('data', [])
            for m in meetings:
                if m.get('title') == room_id and m.get('status') == 'ACTIVE':
                    meeting_id = m.get('id')
                    break
        
        # If not found, create it
        if not meeting_id:
            payload = {
                "title": room_id,
                "preferred_region": "ap-south-1",
                "record_on_start": False
            }
            create_res = requests.post("https://api.dyte.io/v2/meetings", headers=headers, json=payload)
            if create_res.status_code == 201 or create_res.status_code == 200:
                meeting_id = create_res.json().get('data', {}).get('id')
            else:
                return jsonify({"error": "Failed to provision Dyte meeting"}), create_res.status_code
        
        if not meeting_id:
            return jsonify({"error": "Failed to resolve meeting ID"}), 500

        # Step 2: Add participant to the meeting
        participant_payload = {
            "name": uid,
            "preset_name": "group_call_participant",
            "custom_participant_id": uid
        }
        
        part_res = requests.post(f"https://api.dyte.io/v2/meetings/{meeting_id}/participants", headers=headers, json=participant_payload)
        
        if part_res.status_code == 201 or part_res.status_code == 200:
            auth_token = part_res.json().get('data', {}).get('token')
            return jsonify({"authToken": auth_token}), 200
            
        return jsonify({"error": "Failed to add participant to Dyte meeting"}), part_res.status_code

    except Exception as e:
        print(f"[Dyte Meeting Proxy Exception]: {str(e)}")
        return jsonify({"error": "Internal Server Exception"}), 500

def make_zego_token(app_id, server_secret, user_id, expiry_seconds=7200):
    """Generates an explicit, low-latency client access token for Zego Express rooms."""
    create_time = int(time.time())
    expire_time = create_time + expiry_seconds
    
    # Structure payload elements matching Zego's signature token requirements
    payload = {
        'app_id': app_id,
        'user_id': str(user_id),
        'provided_timestamp': create_time,
        'expire_time': expire_time,
        'nonce': int(time.time() * 1000)
    }
    
    # Pack data structure using hmac-sha256 signing algorithms
    json_payload = json.dumps(payload)
    import hmac
    import hashlib
    signature = hmac.new(
        server_secret.encode('utf-8'), 
        json_payload.encode('utf-8'), 
        hashlib.sha256
    ).hexdigest()
    
    # Final format serialization
    token_bytes = json.dumps({
        'ver': 1,
        'body': json_payload,
        'hash': signature
    })
    import base64
    return base64.b64encode(token_bytes.encode('utf-8')).decode('utf-8')

@app.route('/api/v1/zego/generate-token', methods=['POST'])
def generate_zego_token():
    try:
        data = request.json or {}
        room_id = data.get('roomId')
        user_uid = data.get('uid')

        if not room_id or not user_uid:
            return jsonify({"error": "Missing mandatory roomId or uid fields"}), 400

        # Calculate a valid dynamic token string locked strictly to this user session
        generated_token = make_zego_token(ZEGO_APP_ID, ZEGO_SERVER_SECRET, user_uid)

        return jsonify({
            "token": generated_token,
            "appId": ZEGO_APP_ID,
            "userId": str(user_uid)
        }), 200

    except Exception as e:
        print(f"[Zego Token Authority Fault]: {str(e)}")
        return jsonify({"error": "Internal Token Server Exception"}), 500

@app.route('/api/v1/host/upload-intro', methods=['POST'])
def upload_intro():
    try:
        if 'audio' not in request.files:
            return jsonify({"error": "No audio file provided"}), 400

        audio_file = request.files['audio']
        if audio_file.filename == '':
            return jsonify({"error": "No selected file"}), 400

        # Create uploads directory if it doesn't exist
        uploads_dir = os.path.join(os.path.dirname(__file__), 'uploads')
        if not os.path.exists(uploads_dir):
            os.makedirs(uploads_dir)

        # In a real app, use a UUID for the filename to prevent collisions, but for now we keep it simple
        filename = f"intro_{int(time.time())}.m4a"
        file_path = os.path.join(uploads_dir, filename)
        
        audio_file.save(file_path)
        
        # Return a simulated public URL that the mobile app can reference
        # In production this would be an S3 or Firebase Storage URL
        public_url = f"https://batboy-glider-sanitary.ngrok-free.dev/uploads/{filename}"

        return jsonify({
            "message": "Upload successful",
            "url": public_url
        }), 200

    except Exception as e:
        print(f"[Upload Server Fault]: {str(e)}")
        return jsonify({"error": "Internal Upload Exception"}), 500

# Optional: Add a simple static file route so the frontend can playback the audio
from flask import send_from_directory
import firebase_admin
from firebase_admin import credentials, auth, firestore
from datetime import datetime, timedelta
import random

cred = credentials.Certificate("serviceAccountKey.json")
# Removed duplicate firebase_admin initialization
otp_store = {}

@app.route('/uploads/<path:filename>')
def serve_upload(filename):
    return send_from_directory(os.path.join(os.path.dirname(__file__), 'uploads'), filename)

# ==========================================
# AUTHENTICATION ROUTES (FAST2SMS)
# ==========================================

# Simple memory stores for OTP rate limiting and abuse tracking
otp_store = {}
abuse_store = {}

@app.route('/api/v1/auth/send-otp', methods=['POST'])
def send_otp():
    data = request.json
    phone = data.get('phone')
    if not phone:
        return jsonify({"error": "Phone number is required"}), 400
        
    # Clean phone
    phone = phone.replace(" ", "")
    
    now = datetime.now()
    
    # Check if user is blocked
    abuse_record = abuse_store.get(phone, {"blocked_until": None, "consecutive_failed_requests": 0, "last_requested_at": None})
    if abuse_record["blocked_until"] and now < abuse_record["blocked_until"]:
        delta = abuse_record["blocked_until"] - now
        minutes_left = int(delta.total_seconds() / 60)
        return jsonify({"error": f"Too many failed attempts. Try again in {minutes_left} minutes."}), 429
        
    # Enforce 90-second cooldown
    if abuse_record["last_requested_at"]:
        seconds_since_last = (now - abuse_record["last_requested_at"]).total_seconds()
        if seconds_since_last < 90:
            return jsonify({"error": f"Please wait {int(90 - seconds_since_last)} seconds before requesting another OTP."}), 429
            
    abuse_record["last_requested_at"] = now
    abuse_store[phone] = abuse_record
        
    # Generate 6-digit OTP
    otp = str(random.randint(100000, 999999))
    
    # Store OTP with a 5-minute expiration
    otp_store[phone] = {
        "otp": otp,
        "expires": now + timedelta(minutes=5),
        "incorrect_guesses": 0
    }
    
    # Send via Twilio
    TWILIO_ACCOUNT_SID = "AC83dd49cefbb35e00393dd5bfd3a31763"
    TWILIO_AUTH_TOKEN = "9394884dca33f9fac4932cb1ea87b807"
    TWILIO_PHONE_NUMBER = "+14589999941"

    url = f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_ACCOUNT_SID}/Messages.json"
    dest_phone = phone if phone.startswith('+') else f"+{phone}"
        
    payload = {
        "To": dest_phone,
        "From": TWILIO_PHONE_NUMBER,
        "Body": f"Your GenGal Verification Code is: {otp}"
    }
    
    print(f"[AUTH] Sending OTP {otp} to {dest_phone} via Twilio...")
    import sys; sys.stdout.flush()
    
    try:
        response = requests.post(url, data=payload, auth=(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN))
        print(f"[AUTH] Twilio Response: {response.text}")
        sys.stdout.flush()
        return jsonify({"status": "success", "message": "OTP sent"})
    except Exception as e:
        print(f"[AUTH] Twilio Error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/v1/auth/verify-otp', methods=['POST'])
def verify_otp():
    data = request.json
    phone = data.get('phone')
    user_otp = data.get('otp')
    
    if not phone or not user_otp:
        return jsonify({"error": "Phone and OTP are required"}), 400
        
    phone = phone.replace(" ", "")
    now = datetime.now()
    
    # Check if user is blocked
    abuse_record = abuse_store.get(phone, {"blocked_until": None, "consecutive_failed_requests": 0, "last_requested_at": None})
    if abuse_record["blocked_until"] and now < abuse_record["blocked_until"]:
        delta = abuse_record["blocked_until"] - now
        minutes_left = int(delta.total_seconds() / 60)
        return jsonify({"error": f"Too many failed attempts. Try again in {minutes_left} minutes."}), 429
    
    record = otp_store.get(phone)
    if not record:
        return jsonify({"error": "No active OTP found. Please request a new one."}), 400
        
    if now > record['expires']:
        del otp_store[phone]
        return jsonify({"error": "OTP expired. Please request a new one."}), 400
        
    if record['otp'] != user_otp:
        # Incorrect guess
        record['incorrect_guesses'] += 1
        otp_store[phone] = record
        
        # 3 incorrect guesses on a single request = 5 min block (or 1hr if 3rd consecutive failed request)
        if record['incorrect_guesses'] >= 3:
            del otp_store[phone]
            abuse_record['consecutive_failed_requests'] += 1
            
            if abuse_record['consecutive_failed_requests'] >= 3:
                # 3 sequential failed requests -> 1 hr block
                abuse_record['blocked_until'] = now + timedelta(hours=1)
                abuse_store[phone] = abuse_record
                return jsonify({"error": "You have failed too many times. You are blocked for 1 hour."}), 429
            else:
                # 1 failed request (3 guesses) -> 5 min block
                abuse_record['blocked_until'] = now + timedelta(minutes=5)
                abuse_store[phone] = abuse_record
                return jsonify({"error": "You entered the wrong code 3 times. Please try again in 5 minutes."}), 429
                
        return jsonify({"error": f"Invalid OTP. {3 - record['incorrect_guesses']} attempts remaining."}), 400
        
    # OTP is correct! Clear stores.
    if phone in otp_store:
        del otp_store[phone]
    if phone in abuse_store:
        # Reset consecutive failed requests on success
        abuse_store[phone]['consecutive_failed_requests'] = 0
        abuse_store[phone]['blocked_until'] = None
    
    uid = f"fast2sms:{phone}"
    print(f"[AUTH] OTP verified for {phone}. Minting custom token for uid: {uid}")
    
    try:
        custom_token = auth.create_custom_token(uid)
        return jsonify({
            "status": "success",
            "token": custom_token.decode('utf-8') if isinstance(custom_token, bytes) else custom_token
        })
    except Exception as e:
        print(f"[AUTH] Token minting error: {e}")
        return jsonify({"error": "Failed to generate auth token"}), 500

@app.route('/api/v1/auth/login-password', methods=['POST'])
def login_password():
    data = request.json
    phone = data.get('phone')
    password = data.get('password')
    
    if not phone or not password:
        return jsonify({"error": "Phone and password are required"}), 400
        
    phone = phone.replace(" ", "")
    uid = f"fast2sms:{phone}"
    print(f"[AUTH] Verifying password for uid: {uid}")
    
    try:
        db = firestore.client()
        user_ref = db.collection('users').document(uid)
        user_doc = user_ref.get()
        
        if not user_doc.exists:
            return jsonify({"error": "User not found"}), 404
            
        stored_password = user_doc.to_dict().get('password')
        print(f"[AUTH] Provided: '{password}', Stored: '{stored_password}'")
        if not stored_password or stored_password != password:
            return jsonify({"error": "Invalid password"}), 401
            
        print(f"[AUTH] Password verified for uid: {uid}. Minting custom token.")
        custom_token = auth.create_custom_token(uid)
        return jsonify({
            "status": "success",
            "token": custom_token.decode('utf-8') if isinstance(custom_token, bytes) else custom_token
        }), 200
    except Exception as e:
        print(f"[AUTH] Error in login_password: {e}")
        return jsonify({"error": "Internal server error"}), 500

@app.route('/api/v1/auth/check-user', methods=['POST'])
def check_user():
    data = request.json
    phone = data.get('phone')
    
    if not phone:
        return jsonify({"error": "Phone is required"}), 400
        
    phone = phone.replace(" ", "")
    
    try:
        db = firestore.client()
        users_ref = db.collection('users')
        query = users_ref.where('phoneNumber', '==', phone).limit(1)
        results = query.stream()
        user_exists = any(True for _ in results)
        return jsonify({"exists": user_exists}), 200
    except Exception as e:
        print(f"[AUTH] Check user error: {e}")
        return jsonify({"error": "Failed to check user"}), 500

if __name__ == '__main__':
    # Start the server on port 5000
    app.run(host='0.0.0.0', port=5000, debug=True)

```


# backend\serviceAccountKey.json
```json
{
  "type": "service_account",
  "project_id": "gengal-38003",
  "private_key_id": "9f652b5441a6c5e10de8c74e98aa95638e00e0e1",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC4S5rktYT2m8Yi\nlgkXFRbPtD6fAEUL4mIgPn3n+yT646oGuiuz6XA/aHalzPdUpY/z8xlfrGYN4B7R\nUS7aHlDxZR9xTu1dm9WZRC+zYVl/L14dqU1yiSz6HzXhZzXVrkxf3VCicmagfAtc\ncAeBbQ79x0SU6F3FYCVc6JVKsm7JcOHLyWdx/XFzAvNWonvg9IK5YrO48b0wsYq8\nou6vYqjEsglqJIuUbp0cN+XRHceDCxky9uQgYCB7vgxDwO+yo9DGwWHae5mvtRbD\nVjWYkPZKdbC9qHnbVrPEuvPb7NuwfnrygRIOf4SCGb+FIr+kDHzhJBoP2gMR1Lwc\nntCGSeRlAgMBAAECggEACbcMlYFfHrvj9DdKB+I391+GTI3wVdnLd+0raHL0BljB\nggTG4H9OCD2qwX8+S4NFxSObwxAcuh8GKN0ZdeySskL1Jx00xJI+LovqYs+fLuXx\nlWkzGLZT/WRvS/BLpXXAd248fa+/qraXR7ptHty/pU+flSTxqoGwvobRNeSVk/9N\nHVgfKPYoOjDu2y5mV444JG107dVZ1YfFeh2fLhgyTyVyn6++wNPS8GFVWgWJAvB0\nYoY0OgEWNKgU+vpiWUy1+lE7G+xZVCjkal8KI0AEAHX8+A5M42Pnmfa+qEcSWjO1\n+csWRxK5TnpcAqYfObzNFmETzWpDYf9Rfu4dVFRkeQKBgQDtxA1D83RZSonO2pu7\nD8bsqnCqPl79NBibxr8/mWUoMsq9btazZkPZQcEf6xxj4aWxN9MpQGi1via7DTjB\npYpkwxUuzT/fLTEDYY16RIAv49vSA009akniNfGfKslRc0HckbmAY/rsUUdVKjM0\n7UGfC8hrPizHXPNWNL8hzyuFTQKBgQDGbcqWh5ufxiEk661sQLbAMT8vyTXoXKlP\nJtzc/m9wgG8Hk5wP+RFr3KqzWNCJJVqQPOXDWA+O67wPpdds0cuwJeRMmuYWGQ3S\n242/Lb53oh+SXR4Wp5ENXe2mWXXku69sv6k863xcFHdPLZg95n4vYviiNDUcto0l\nWHF+Z9nveQKBgDdmJMkeYo+jhHSEDyEIzgq6s8GXAr7wcoNpTYpeDWnOW9rDhpcK\nTujCH2N2fojvPJIMNdE4xq0B/zg6Hm1QSuyrX7Yl8Knpd7AX/MTuTQfbiY5nYona\nyBhDBWdWqs2lk0T3V0eJBCAn1/0J9iBw34dVUX9bX0ecar49UANqp/NJAoGAR7AQ\nufOCMOYGwWz3+Z0jqSnhlyUNecZIUNVMg/bUUgPEmSsl/ctRFPPjI+pZZML/Bg9K\nPxnIfS0Dg2+59ZGSEjCOW3K235LroJs7ia9AGb6Tw3Aq16pwSDEAE9JMOnfoN9TC\nksTM6ANo200wrGRigEI0a32LFrWJJs3eKvngDZkCgYEAjmKusB1m0EZ/b/kGuFe9\ntSUEzBYSXapsQswjk5sxTDBbTb9hgrNVUe8elHdRFmpNKyqEKW3DA7jFVJxryj0A\nk3KC7CcfXlhRrcX6sAYFNxkp1//mLRvmvSoji0Y+URMdJpKrpgWbIIsv8gSieGfg\n8749CS4Gap/KkTqkVtDuEXE=\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-fbsvc@gengal-38003.iam.gserviceaccount.com",
  "client_id": "113837163692311367352",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40gengal-38003.iam.gserviceaccount.com",
  "universe_domain": "googleapis.com"
}

```


# src\components\BottomNav.tsx
```tsx
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { skeuoGradients } from '../theme/skeuomorphic';

type TabId = 'Home' | 'Club' | 'Personal' | 'Activity' | 'Chill';

const TABS: { id: TabId; label: string; icon: keyof typeof MaterialIcons.glyphMap; screen?: string }[] = [
  { id: 'Home', label: 'Home', icon: 'home', screen: 'Home' },
  { id: 'Club', label: 'Club', icon: 'castle', screen: 'Club' },
  { id: 'Personal', label: 'Personal', icon: 'person-pin', screen: 'Personal' },
  { id: 'Activity', label: 'Activity', icon: 'notifications-none', screen: 'Activity' },
  { id: 'Chill', label: 'Show', icon: 'auto-awesome', screen: 'Chill' },
];

type BottomNavProps = {
  active: TabId;
  navigate: (screen: string) => void;
};

export default function BottomNav({ active, navigate }: BottomNavProps) {
  return (
    <View style={styles.container}>
      <View style={[styles.bar, Platform.OS === 'web' && styles.barWeb]}>
        {TABS.map((tab) => {
          const isActive = tab.id === active;
          return (
            <TouchableOpacity
              key={tab.id}
              style={[styles.tab, isActive && styles.tabActive]}
              activeOpacity={0.75}
              onPress={() => tab.screen && navigate(tab.screen)}
            >
              {isActive ? (
                <LinearGradient colors={[...skeuoGradients.gold]} style={styles.activePlate} />
              ) : null}
              <MaterialIcons
                name={tab.icon}
                size={20}
                color={isActive ? '#9C8223' : '#AAA298'}
              />
              <Text style={[styles.label, isActive && styles.labelActive]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  bar: {
    flexDirection: 'row',
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 24 : 12,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: '#FFFFFF',
    backgroundColor: '#FFFDF8',
  },
  barWeb: {
    boxShadow: Platform.OS === 'web' ? '0 -10px 22px rgba(62, 46, 31, 0.13), inset 0 1px 0 rgba(255,255,255,0.9)' : undefined,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    minHeight: 54,
    borderRadius: 13,
    overflow: 'hidden',
  },
  tabActive: {
    backgroundColor: '#FFE899',
    borderWidth: 1,
    borderColor: '#F8E5A3',
    boxShadow: Platform.OS === 'web' ? '0 8px 16px rgba(156, 130, 35, 0.22), inset 0 1px 0 rgba(255,255,255,0.8)' : undefined,
  },
  activePlate: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    opacity: 0.5,
  },
  label: {
    fontSize: 10,
    fontWeight: '700',
    color: '#AAA298',
  },
  labelActive: {
    color: '#9C8223',
  },
});

```


# src\components\CallPriceTag.tsx
```tsx
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { subscribeToGlobalSettings, GlobalSettings } from '../services/adminService';

type CallPriceTagProps = {
  mode: 'call' | 'video';
};

export default function CallPriceTag({ mode }: CallPriceTagProps) {
  const [settings, setSettings] = useState<GlobalSettings | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToGlobalSettings((data) => {
      setSettings(data);
    });
    return unsubscribe;
  }, []);

  const isVideo = mode === 'video';
  // Fallbacks based on user request if settings aren't loaded yet
  const defaultPrice = isVideo ? 50 : 15;
  const currentPrice = settings ? (isVideo ? settings.videoCallRatePerMin : settings.voiceCallRatePerMin) : defaultPrice;

  return (
    <View style={styles.tag}>
      <Text style={styles.text}>{currentPrice}</Text>
      <MaterialIcons name="star" size={10} color="#F4D9A0" />
      <Text style={styles.text}>/m</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginLeft: 4,
    backgroundColor: 'rgba(0,0,0,0.05)',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 8,
  },
  text: {
    fontSize: 9,
    fontWeight: '800',
    color: '#FFF7FF',
  },
  textVideo: {
    color: '#FFE8FF',
  }
});

```


# src\components\ConnectingOverlay.tsx
```tsx
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Easing, Dimensions, Platform } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { skeuoGradients } from '../theme/skeuomorphic';

type ConnectingOverlayProps = {
  mode: 'random' | 'private';
  targetName?: string;
  onCancel: () => void;
};

const { width, height } = Dimensions.get('window');

function FloatingHeart({ index, delay }: { index: number, delay: number }) {
  const translateY = useRef(new Animated.Value(height / 3)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(translateY, {
            toValue: -height / 4,
            duration: 4000,
            easing: Easing.out(Easing.linear),
            useNativeDriver: true,
          }),
          Animated.sequence([
            Animated.timing(opacity, {
              toValue: 0.6,
              duration: 500,
              useNativeDriver: true,
            }),
            Animated.timing(opacity, {
              toValue: 0.6,
              duration: 2500,
              useNativeDriver: true,
            }),
            Animated.timing(opacity, {
              toValue: 0,
              duration: 1000,
              useNativeDriver: true,
            }),
          ]),
          Animated.timing(scale, {
            toValue: 1.2,
            duration: 4000,
            useNativeDriver: true,
          }),
        ])
      ])
    ).start();
  }, [delay, opacity, scale, translateY]);

  // Scatter hearts horizontally
  const left = 40 + (index * 45) % (width - 80);
  const size = 15 + (index % 3) * 10;

  return (
    <Animated.View style={[styles.floatingHeart, { left, transform: [{ translateY }, { scale }], opacity }]}>
      <MaterialIcons name="favorite" size={size} color="#E8CA58" />
    </Animated.View>
  );
}

export default function ConnectingOverlay({ mode, targetName, onCancel }: ConnectingOverlayProps) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Pulse animation for the central heart
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.15,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        })
      ])
    ).start();

    // Progress bar animation (simulating connection progress)
    Animated.timing(progressAnim, {
      toValue: 1,
      duration: 10000, // 10s simulated connect
      easing: Easing.out(Easing.ease),
      useNativeDriver: false,
    }).start();
  }, [pulseAnim, progressAnim]);

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%']
  });

  return (
    <View style={styles.container}>
      {mode === 'private' && (
        <>
          {/* Header specific to Private mode */}
          <View style={styles.privateHeader}>
            <Text style={styles.logoText}>Gengal</Text>
            <View style={styles.privatePill}>
              <MaterialIcons name="lock" size={12} color="#8D6E18" />
              <Text style={styles.privatePillText}>Private Session</Text>
            </View>
          </View>
          
          {/* Floating Hearts background */}
          {[...Array(6)].map((_, i) => (
            <FloatingHeart key={`heart-${i}`} index={i} delay={i * 600} />
          ))}
        </>
      )}

      {/* Central Visual */}
      <View style={styles.centerVisual}>
        <View style={styles.outerRing}>
          <View style={styles.innerCircle}>
            {mode === 'random' ? (
              <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                <MaterialIcons name="favorite" size={64} color="#E8CA58" />
              </Animated.View>
            ) : null /* Private mode has empty circle with hearts floating up through it */}
          </View>
        </View>
      </View>

      {/* Text Content */}
      <View style={styles.textContent}>
        <Text style={styles.title}>
          {mode === 'random' ? 'Finding a random connection...' : 'Finding your connection...'}
        </Text>
        
        {mode === 'random' ? (
          <Text style={styles.subtitle}>Your destiny is being chosen</Text>
        ) : (
          <Text style={styles.subtitle}>
            Connecting you with <Text style={styles.targetName}>{targetName}</Text> for an exclusive private conversation.
          </Text>
        )}
      </View>

      {/* Progress & Cancel */}
      <View style={styles.bottomSection}>
        <View style={styles.progressContainer}>
          {mode === 'random' ? (
            <View style={styles.progressTrackRandom}>
              <Animated.View style={[styles.progressBarRandom, { width: progressWidth }]} />
            </View>
          ) : (
            <View style={styles.progressTrackPrivateBg}>
              <Animated.View style={{ height: '100%', width: progressWidth, overflow: 'hidden', borderRadius: 3 }}>
                <LinearGradient
                  colors={['#E8CA58', '#B68D1C']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={{ width: '100%', height: '100%', minWidth: 200 }} // Ensure gradient stretches correctly
                />
              </Animated.View>
            </View>
          )}
        </View>

        {mode === 'random' ? (
          <TouchableOpacity style={styles.cancelPill} onPress={onCancel} activeOpacity={0.8}>
            <MaterialIcons name="close" size={16} color="#B30005" />
            <Text style={styles.cancelPillText}>CANCEL</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.cancelTextBtn} onPress={onCancel} activeOpacity={0.8}>
            <Text style={styles.cancelTextBtnLabel}>CANCEL REQUEST</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#FFFDF8',
    zIndex: 9999,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 60,
  },
  privateHeader: {
    position: 'absolute',
    top: 50,
    left: 24,
    right: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 10,
  },
  logoText: {
    fontFamily: 'serif',
    fontSize: 28,
    fontWeight: '700',
    color: '#4B0054',
    fontStyle: 'italic',
  },
  privatePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    ...Platform.select({
      ios: {
        shadowColor: '#4B0054',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
      },
      android: {
        elevation: 4,
      },
      web: {
        boxShadow: '0 4px 12px rgba(75,0,84,0.1)',
      }
    }),
  },
  privatePillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4B0054',
    marginLeft: 4,
  },
  centerVisual: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 60,
  },
  outerRing: {
    width: 280,
    height: 280,
    borderRadius: 140,
    borderWidth: 1,
    borderColor: 'rgba(232, 202, 88, 0.2)',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  innerCircle: {
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#E8CA58',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.2,
        shadowRadius: 40,
      },
      android: {
        elevation: 10,
      },
      web: {
        boxShadow: '0 0 40px rgba(232,202,88,0.2)',
      }
    }),
  },
  floatingHeart: {
    position: 'absolute',
    zIndex: 5,
  },
  textContent: {
    alignItems: 'center',
    paddingHorizontal: 32,
    marginBottom: 60,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#4B0054',
    textAlign: 'center',
    marginBottom: 12,
    fontFamily: 'serif',
  },
  subtitle: {
    fontSize: 15,
    color: '#666',
    textAlign: 'center',
    fontStyle: 'italic',
    lineHeight: 22,
  },
  targetName: {
    fontWeight: '700',
    color: '#B68D1C',
    fontStyle: 'normal',
  },
  bottomSection: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingBottom: 20,
  },
  progressContainer: {
    width: '80%',
    height: 6,
    marginBottom: 30,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressTrackRandom: {
    width: '100%',
    height: '100%',
    backgroundColor: '#F3EFE9',
    borderRadius: 3,
  },
  progressBarRandom: {
    height: '100%',
    backgroundColor: '#F7D673',
    borderRadius: 3,
  },
  progressTrackPrivateBg: {
    width: '100%',
    height: '100%',
    backgroundColor: '#F3EFE9', // Subtle background for the private track
    borderRadius: 3,
  },
  cancelPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    ...Platform.select({
      ios: {
        shadowColor: '#4B0054',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.05,
        shadowRadius: 10,
      },
      android: {
        elevation: 2,
      },
      web: {
        boxShadow: '0 4px 10px rgba(75,0,84,0.05)',
      }
    }),
  },
  cancelPillText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#666',
    marginLeft: 8,
    letterSpacing: 1,
  },
  cancelTextBtn: {
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  cancelTextBtnLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#999',
    letterSpacing: 1,
  },
});

```


# src\components\DiamondBadge.tsx
```tsx
import React from 'react';
import { Platform, Text, StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { skeuoGradients } from '../theme/skeuomorphic';
import { useUser } from '../context/UserContext';

type DiamondBadgeProps = {
  amount?: number | string;
  compact?: boolean;
};

export default function DiamondBadge({ amount, compact }: DiamondBadgeProps) {
  const { profile } = useUser();

  const displayAmount = (profile?.coins !== undefined && profile?.coins !== null) 
    ? profile.coins.toLocaleString() 
    : (amount ?? 0);

  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]}>
      <LinearGradient colors={[...skeuoGradients.raised]} style={styles.inner}>
        <View style={[styles.coinCup, compact && styles.coinCupCompact]}>
          <MaterialIcons name="star" size={compact ? 13 : 16} color="#FFFFFF" />
        </View>
        <Text style={[styles.text, compact && styles.textCompact]}>{displayAmount} Coins</Text>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    minWidth: 118,
    height: 42,
    borderRadius: 21,
    padding: 2,
    backgroundColor: '#F4E6CF',
    borderWidth: 1,
    borderColor: '#FFFFFF',
    boxShadow: Platform.OS === 'web' ? '0 9px 18px rgba(83, 58, 29, 0.18), inset 0 1px 0 rgba(255,255,255,0.95)' : undefined,
  },
  wrapCompact: {
    minWidth: 104,
    height: 38,
    borderRadius: 19,
    paddingHorizontal: 13,
    gap: 4,
  },
  inner: {
    flex: 1,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.72)',
  },
  coinCup: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#C99B22',
    boxShadow: Platform.OS === 'web' ? 'inset 0 1px 0 rgba(255,255,255,0.65), 0 3px 7px rgba(154,122,5,0.26)' : undefined,
  },
  coinCupCompact: {
    width: 21,
    height: 21,
    borderRadius: 11,
  },
  text: {
    color: '#7F6808',
    fontWeight: '900',
    fontSize: 15,
  },
  textCompact: {
    fontSize: 13,
  },
});

```


# src\components\GengalAvatar.tsx
```tsx
import React, { useMemo } from 'react';
import { View, StyleSheet, Platform, Image } from 'react-native';
import { createAvatar } from '@dicebear/core';
import { avataaars } from '@dicebear/collection';
import { SvgXml } from 'react-native-svg';

export interface AvatarData {
  topType: string;
  hairColor: string;
  clotheType: string;
  clotheColor?: string;
  skinColor: string;
  facialHairType?: string;
  facialHairColor?: string;
  accessoriesType?: string;
  mouthType?: string;
  eyeType?: string;
  eyebrowType?: string;
  isPremiumConfig?: boolean;
  bgColor?: string;
  backgroundColor?: string;
}

export const DEFAULT_AVATAR_DNA: AvatarData = {
  topType: "shortHairShortWaved",
  hairColor: "black",
  clotheType: "crewNeck",
  skinColor: "light",
  bgColor: "#E2E8F0"
};

const mapTop: Record<string, string> = {
  shortHairShortWaved: 'shortWaved',
  longHairBun: 'bun',
  longHairStraight: 'straight01',
  shortHairDreads01: 'dreads',
  shortHairShortCurly: 'shortCurly'
};

const mapHairColor: Record<string, string> = {
  black: '2c1b18',
  brownDark: '4a3123',
  blonde: 'd6b370',
  red: 'ca4420',
  silverGray: 'e8e8e8'
};

const mapClothing: Record<string, string> = {
  crewNeck: 'shirtCrewNeck',
  graphicShirt: 'graphicShirt',
  collarSweater: 'blazerAndShirt',
  blazerShirt: 'blazerAndSweater',
  hoodie: 'hoodie'
};

const mapSkinColor: Record<string, string> = {
  light: 'edb98a',
  tanned: 'd08b5b',
  brown: 'ae5d29',
  dark: '614335',
  black: '2d1e16'
};

const mapClothingColor: Record<string, string> = {
  black: '262e33',
  gray01: 'e6e6e6',
  blue02: '3c4f5c',
  pastelBlue: 'b1e2ff',
  pastelGreen: 'a7ffc4',
  pastelRed: 'ffafb9',
  pink: 'ff488e'
};

const mapFacialHair: Record<string, string> = {
  none: '',
  stubble: 'beardLight',
  fullBeard: 'beardMajestic',
  anchorMustache: 'moustacheFancy'
};

const mapAccessories: Record<string, string> = {
  none: '',
  designerEyewear: 'wayfarers',
  goldHoops: 'round',
  pearlChoker: 'kurt' // Closest approximation
};

export default function GengalAvatar({ data, size = 150 }: { data?: AvatarData; size?: number }) {
  const avatarDNA = data || DEFAULT_AVATAR_DNA;

  const svgString = useMemo(() => {
    try {
      const avatarOpts: any = {
        top: [(mapTop[avatarDNA.topType] || avatarDNA.topType || 'shortWaved')],
        hairColor: [(mapHairColor[avatarDNA.hairColor] || avatarDNA.hairColor || '2c1b18')],
        clothing: [(mapClothing[avatarDNA.clotheType] || avatarDNA.clotheType || 'shirtCrewNeck')],
        clothesColor: [(mapClothingColor[avatarDNA.clotheColor || ''] || avatarDNA.clotheColor || '262e33')],
        skinColor: [(mapSkinColor[avatarDNA.skinColor] || avatarDNA.skinColor || 'edb98a')],
        eyes: [avatarDNA.eyeType || "default"],
        eyebrows: [avatarDNA.eyebrowType || "defaultNatural"],
        mouth: [avatarDNA.mouthType || "smile"],
        backgroundColor: ["transparent"],
        radius: 50,
        scale: 75,
      };

      if (avatarDNA.facialHairType && avatarDNA.facialHairType !== 'none') {
        avatarOpts.facialHair = [mapFacialHair[avatarDNA.facialHairType] || avatarDNA.facialHairType];
        avatarOpts.facialHairColor = [(mapHairColor[avatarDNA.facialHairColor || avatarDNA.hairColor] || avatarDNA.facialHairColor || avatarDNA.hairColor || '2c1b18')];
        avatarOpts.facialHairProbability = 100;
      } else {
        avatarOpts.facialHairProbability = 0;
      }

      if (avatarDNA.accessoriesType && avatarDNA.accessoriesType !== 'none') {
        avatarOpts.accessories = [mapAccessories[avatarDNA.accessoriesType] || avatarDNA.accessoriesType];
        avatarOpts.accessoriesProbability = 100;
      } else {
        avatarOpts.accessoriesProbability = 0;
      }

      let rawSvg = createAvatar(avataaars, avatarOpts).toString();
      
      // react-native-svg on Android has a well-known bug where rx/ry in masks cuts the SVG exactly in half!
      // We remove the mask completely and rely on the React Native View's borderRadius instead.
      rawSvg = rawSvg.replace(/<mask id="viewboxMask">.*?<\/mask>/g, '');
      rawSvg = rawSvg.replace(/mask="url\(#viewboxMask\)"/g, '');

      return rawSvg;
    } catch (e) {
      console.warn("Avatar generation failed", e);
      return '';
    }
  }, [avatarDNA]);

  return (
    <View style={[styles.frame, { width: size, height: size, borderRadius: size / 2, backgroundColor: avatarDNA.bgColor || '#E2E8F0' }]}>
      {svgString ? (
        Platform.OS === 'web' ? (
          <Image 
            source={{ uri: `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgString)))}` }} 
            style={{ width: '100%', height: '100%' }} 
          />
        ) : (
          <SvgXml xml={svgString} width={size} height={size} />
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: '#FFFDF8',
  },
});

```


# src\components\ScreenShell.tsx
```tsx
import React from 'react';
import { View, StyleSheet, SafeAreaView, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, gradients } from '../theme/colors';
import { skeuo, skeuoGradients } from '../theme/skeuomorphic';

type ScreenShellProps = {
  children: React.ReactNode;
  tone?: 'dark' | 'light';
};

import Svg, { Path } from 'react-native-svg';

export default function ScreenShell({ children, tone = 'dark' }: ScreenShellProps) {
  if (tone === 'light') {
    return (
      <View style={[styles.root, styles.lightRoot]}>
        <LinearGradient colors={[...skeuoGradients.page]} style={StyleSheet.absoluteFill} />
        <View style={styles.lightGrainTop} />
        <View style={styles.lightGrainBottom} />
        <SafeAreaView style={styles.safe}>{children}</SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <LinearGradient colors={[...gradients.page]} style={StyleSheet.absoluteFill} />
      {/* Ambient gold glow top-right */}
      <LinearGradient
        colors={['rgba(201,168,76,0.08)', 'transparent']}
        style={styles.ambientTop}
        start={{ x: 1, y: 0 }}
        end={{ x: 0, y: 1 }}
      />
      {/* Ambient plum glow bottom-left */}
      <LinearGradient
        colors={['rgba(107,45,110,0.12)', 'transparent']}
        style={styles.ambientBottom}
        start={{ x: 0, y: 1 }}
        end={{ x: 1, y: 0 }}
      />
      <SafeAreaView style={styles.safe}>{children}</SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { 
    flex: 1, 
    backgroundColor: colors.background,
    width: '100%',
    maxWidth: Platform.OS === 'web' ? 480 : undefined,
    alignSelf: 'center',
    boxShadow: Platform.OS === 'web' ? '0px 0px 20px rgba(0,0,0,0.1)' : undefined,
  },
  lightRoot: { backgroundColor: skeuo.surface },
  safe: { flex: 1, paddingTop: Platform.OS === 'android' ? 8 : 0 },
  lightGrainTop: {
    position: 'absolute',
    top: -90,
    right: -50,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(255, 255, 255, 0.62)',
    boxShadow: Platform.OS === 'web' ? '0 18px 60px rgba(255, 255, 255, 0.65)' : undefined,
  },
  lightGrainBottom: {
    position: 'absolute',
    left: -80,
    bottom: 90,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: 'rgba(203, 167, 47, 0.08)',
  },
  ambientTop: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 280,
    height: 280,
    borderRadius: 140,
  },
  ambientBottom: {
    position: 'absolute',
    bottom: 80,
    left: -60,
    width: 240,
    height: 240,
    borderRadius: 120,
  },
});

```


# src\components\TopBar.tsx
```tsx
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import GengalAvatar from './GengalAvatar';
import DiamondBadge from './DiamondBadge';
import { useUser } from '../context/UserContext';

type TopBarProps = {
  navigate: (screen: string, params?: any) => void;
  title?: string;
  subtitle?: string;
};

export default function TopBar({ navigate, title = 'Gengal', subtitle }: TopBarProps) {
  const { profile: myProfile } = useUser();

  return (
    <View style={styles.header}>
      <TouchableOpacity
        style={styles.avatarShadow}
        activeOpacity={0.85}
        onPress={() => navigate('Profile', { profileName: myProfile?.nickname || myProfile?.username || 'User' })}
      >
        {myProfile?.avatarData ? (
          <GengalAvatar data={myProfile.avatarData} size={38} />
        ) : myProfile ? (
          <Image
            source={{ uri: myProfile.avatarUrl || 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?q=80&w=200&auto=format&fit=crop' }}
            style={styles.avatar}
          />
        ) : (
          <View style={[styles.avatar, { backgroundColor: '#E2E8F0' }]} />
        )}
      </TouchableOpacity>

      <View style={styles.centerTitle}>
        <Text style={styles.brand} numberOfLines={1} adjustsFontSizeToFit>{title}</Text>
        {subtitle ? (
          <Text style={styles.headerSub}>{subtitle}</Text>
        ) : null}
      </View>

      <TouchableOpacity activeOpacity={0.85} onPress={() => navigate('Coins')}>
        <DiamondBadge amount={myProfile ? (myProfile.coins ?? 0) : 0} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 15,
    backgroundColor: '#FFFDF8',
    borderBottomWidth: 1,
    borderBottomColor: '#F5E6E6',
    zIndex: 10,
  },
  avatarShadow: {
    shadowColor: '#C4A000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 6,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    borderColor: '#FBE9B6',
  },
  centerTitle: {
    alignItems: 'center',
    flexDirection: 'column',
  },
  brand: {
    fontFamily: 'Outfit_700Bold',
    fontSize: 24,
    color: '#836A07',
    letterSpacing: -0.5,
  },
  headerSub: {
    fontFamily: 'Outfit_600SemiBold',
    fontSize: 10,
    color: '#D4B84D',
    letterSpacing: 1.2,
    marginTop: -2,
  },
});

```


# src\components\VoiceIntroRecorder.tsx
```tsx
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import {
  useAudioRecorder,
  RecordingPresets,
  useAudioPlayer,
  useAudioPlayerStatus,
  requestRecordingPermissionsAsync,
  setAudioModeAsync
} from 'expo-audio';
import { FontAwesome5, Ionicons } from '@expo/vector-icons';

type RecorderState = 'idle' | 'recording' | 'reviewing';

export const VoiceIntroRecorder = ({ onUploadSuccess }: { onUploadSuccess?: (audioUrl: string) => void }) => {
  const [recorderState, setRecorderState] = useState<RecorderState>('idle');
  const [durationMillis, setDurationMillis] = useState(0);

  const MAX_DURATION_MS = 15000; // 15 seconds

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY, (status: any) => {
    setDurationMillis(status.durationMillis || status.currentTime || 0);
    if ((status.durationMillis || status.currentTime || 0) >= MAX_DURATION_MS && recorderState === 'recording') {
      stopRecording();
    }
  });

  const [audioUri, setAudioUri] = useState<string | null>(null);
  const player = useAudioPlayer(audioUri);
  const playerStatus = useAudioPlayerStatus(player);
  const isPlaying = playerStatus.playing;
  const playbackPosition = playerStatus.currentTime * 1000;

  const startRecording = async () => {
    try {
      console.log('Requesting permissions..');
      await requestRecordingPermissionsAsync();
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });

      console.log('Starting recording..');
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecorderState('recording');
      setDurationMillis(0);
    } catch (err) {
      console.error('Failed to start recording', err);
    }
  };

  const stopRecording = async () => {
    if (recorderState !== 'recording') return;
    console.log('Stopping recording..');
    
    setRecorderState('reviewing');
    await recorder.stop();
    await setAudioModeAsync({
      allowsRecording: false,
    });
    
    const uri = recorder.uri;
    console.log('Recording stopped and stored at', uri);
    
    if (uri) {
      setAudioUri(uri);
    }
  };

  const togglePlayback = () => {
    if (isPlaying) {
      player.pause();
    } else {
      if (playerStatus.currentTime >= playerStatus.duration) {
        player.seekTo(0);
      }
      player.play();
    }
  };

  const resetRecording = () => {
    setAudioUri(null);
    setRecorderState('idle');
    setDurationMillis(0);
  };

  const uploadRecording = async () => {
    if (!audioUri) return;

    try {
      console.log('Uploading audio intro...');
      // To be wired to backend/app.py /api/v1/host/upload-intro
      const formData = new FormData();
      formData.append('audio', {
        uri: audioUri,
        name: 'intro.m4a',
        type: 'audio/m4a',
      } as any);

      const response = await fetch('https://batboy-glider-sanitary.ngrok-free.dev/api/v1/host/upload-intro', {
        method: 'POST',
        body: formData,
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      const result = await response.json();
      console.log('Upload success:', result);
      if (onUploadSuccess) {
        onUploadSuccess(result.url);
      }
    } catch (error) {
      console.error('Error uploading intro:', error);
      alert('Failed to upload intro. Please try again.');
    }
  };

  const formatTime = (millis: number) => {
    const totalSeconds = Math.floor(millis / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Voice Intro</Text>
      
      {recorderState === 'idle' && (
        <View style={styles.stateContainer}>
          <Text style={styles.prompt}>Tap mic to record your 15-second intro.</Text>
          <TouchableOpacity style={styles.micButton} onPress={startRecording}>
            <FontAwesome5 name="microphone" size={32} color="#fff" />
          </TouchableOpacity>
        </View>
      )}

      {recorderState === 'recording' && (
        <View style={styles.stateContainer}>
          <Text style={styles.timer}>{formatTime(durationMillis)} / 0:15</Text>
          <View style={styles.pulsingRing}>
            <TouchableOpacity style={styles.stopButton} onPress={stopRecording}>
              <View style={styles.stopIcon} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {recorderState === 'reviewing' && (
        <View style={styles.stateContainer}>
          <View style={styles.scrubberContainer}>
            <TouchableOpacity onPress={togglePlayback} style={styles.playButton}>
              <Ionicons name={isPlaying ? "pause" : "play"} size={24} color="#fff" />
            </TouchableOpacity>
            <View style={styles.progressBarBackground}>
              <View 
                style={[
                  styles.progressBarFill, 
                  { width: `${durationMillis > 0 ? (playbackPosition / durationMillis) * 100 : 0}%` }
                ]} 
              />
            </View>
            <Text style={styles.timeText}>{formatTime(playbackPosition)}</Text>
          </View>
          
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.secondaryButton} onPress={resetRecording}>
              <Text style={styles.secondaryButtonText}>Re-record</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryButton} onPress={uploadRecording}>
              <Text style={styles.primaryButtonText}>Confirm & Upload</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1E1E1E',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  stateContainer: {
    alignItems: 'center',
    width: '100%',
  },
  prompt: {
    color: '#A0A0A0',
    fontSize: 16,
    marginBottom: 24,
    textAlign: 'center',
  },
  micButton: {
    backgroundColor: '#FF3B30',
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#FF3B30',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 15,
    elevation: 8,
  },
  stopButton: {
    backgroundColor: '#FF3B30',
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stopIcon: {
    backgroundColor: '#fff',
    width: 24,
    height: 24,
    borderRadius: 4,
  },
  pulsingRing: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(255, 59, 48, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  timer: {
    color: '#FF3B30',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    fontVariant: ['tabular-nums'],
  },
  scrubberContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    backgroundColor: '#2A2A2A',
    borderRadius: 12,
    padding: 12,
    marginBottom: 24,
  },
  playButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  progressBarBackground: {
    flex: 1,
    height: 6,
    backgroundColor: '#404040',
    borderRadius: 3,
    marginRight: 12,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#007AFF',
  },
  timeText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontVariant: ['tabular-nums'],
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  secondaryButton: {
    flex: 1,
    paddingVertical: 12,
    backgroundColor: '#333333',
    borderRadius: 8,
    marginRight: 8,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 16,
  },
  primaryButton: {
    flex: 1,
    paddingVertical: 12,
    backgroundColor: '#007AFF',
    borderRadius: 8,
    marginLeft: 8,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 16,
  },
});

```


# src\config\firebase.ts
```ts
import { initializeApp, getApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

export const firebaseConfig = {
  apiKey: "AIzaSyDf20OS0bDrX76sRiVyPI-D6t8iLOlXpkQ",
  authDomain: "gengal-38003.firebaseapp.com",
  projectId: "gengal-38003",
  storageBucket: "gengal-38003.firebasestorage.app",
  messagingSenderId: "564095466372",
  appId: "1:564095466372:web:6a7faf45eb986307113bd1",
  measurementId: "G-EZ63X75QBW"
};

// Initialize Firebase only if it hasn't been initialized yet
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);
auth.settings.appVerificationDisabledForTesting = true;
export const db = getFirestore(app);

```


# src\context\UserContext.tsx
```tsx
import React, { createContext, useContext, useState, useEffect } from 'react';
import { auth } from '../config/firebase';
import { subscribeToUserProfile, UserProfile as FirebaseUser } from '../services/userService';

type UserContextType = {
  profile: FirebaseUser | null;
};

const UserContext = createContext<UserContextType>({ profile: null });

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<FirebaseUser | null>(null);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    const unsubAuth = auth.onAuthStateChanged((user) => {
      if (unsub) {
        unsub();
        unsub = undefined;
      }
      if (user) {
        unsub = subscribeToUserProfile(user.uid, (data) => {
          setProfile(data);
        });
      } else {
        setProfile(null);
      }
    });

    return () => {
      unsubAuth();
      if (unsub) unsub();
    };
  }, []);

  return (
    <UserContext.Provider value={{ profile }}>
      {children}
    </UserContext.Provider>
  );
}

export const useUser = () => useContext(UserContext);

```


# src\hooks\NativeEngines.ts
```ts
export const getAgoraEngine = () => require('react-native-agora');

```


# src\hooks\NativeEngines.web.ts
```ts
export const getRed5Engine = () => null;
export const getZegoEngine = () => null;
export const getAgoraEngine = () => null;
export const getDyteEngine = () => null;

```


# src\hooks\useGengalVoice.ts
```ts
import { useState, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { getAgoraEngine } from './NativeEngines';

export type FreeProvider = 'agora' | 'dyte' | 'daily' | 'zegocloud' | 'videosdk' | 'stream';

interface GengalVoiceInterface {
  connectSeat: (roomId: string, tokenOrUrl: string, userId?: string) => Promise<any>;
  disconnectSeat: () => Promise<void>;
  toggleMic: () => void;
  micMuted: boolean;
  toggleSpeaker: () => void;
  speakerOn: boolean;
}

export function useGengalVoice(provider: FreeProvider): GengalVoiceInterface {
  const [micMuted, setMicMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(false);
  
  // Safe ref for Agora engine so it doesn't crash the web bundler
  const agoraEngineRef = useRef<any>(null);
  
  // Safe ref for Daily.co Call Object
  const dailyClientRef = useRef<any>(null);

  // Safe refs for Stream.io Call Objects
  const streamClientRef = useRef<any>(null);
  const streamCallRef = useRef<any>(null);

  // Safe ref for Red5 Pro native engine
  const red5PublisherRef = useRef<any>(null);

  // Safe ref for Dyte native engine
  const dyteClientRef = useRef<any>(null);

  const isZegoInitialized = useRef(false);

  useEffect(() => {
    // We only initialize Agora if we are not on web (react-native-agora is native only)
    if (provider === 'agora' && Platform.OS !== 'web') {
      try {
        const { createAgoraRtcEngine } = getAgoraEngine();
        agoraEngineRef.current = createAgoraRtcEngine();
        agoraEngineRef.current.initialize({ appId: 'd463dbabe1ee41ef8c4fa19c09464708' });
        console.log(`[Agora Node] Engine initialized.`);
      } catch (e) {
        console.log(`[Agora Node] Failed to initialize native engine.`);
      }
    }
    
    return () => {
      // Automatic native tracking cleanup
      if (provider === 'agora' && agoraEngineRef.current) {
        try {
          agoraEngineRef.current.release();
        } catch(e) {}
      }
    };
  }, [provider]);

  const connectAgora = async (roomId: string, token: string) => {
    if (Platform.OS === 'web') {
      console.warn(`[Agora Guard] Agora Native is not supported on web. Use Daily.co for web testing.`);
      return;
    }
    console.log(`[Agora Node] Joining channel: ${roomId}`);
    if (agoraEngineRef.current) {
      agoraEngineRef.current.joinChannel(token, roomId, 0, {
         clientRoleType: 1, // Broadcaster
         channelProfile: 1, // Live Broadcasting
      });
    }
    return agoraEngineRef.current;
  };

  const connectSeat = async (roomId: string, tokenOrUrl: string, userId?: string) => {
    if (provider === 'agora') {
      return await connectAgora(roomId, tokenOrUrl);
    }
    console.error(`Unknown communication provider layout: ${provider}`);
  };

  const disconnectSeat = async () => {
    if (provider === 'agora' && agoraEngineRef.current) {
      agoraEngineRef.current.leaveChannel();
    }

    console.log(`[Voice Adapter] Safe native channel teardown for: ${provider}`);
  };

  const toggleMic = async () => {
    const newMutedState = !micMuted;
    setMicMuted(newMutedState);
    if (provider === 'agora' && agoraEngineRef.current) {
      agoraEngineRef.current.muteLocalAudioStream(newMutedState);
    }

    console.log(`[Audio Layer] Local microphone mute state: ${newMutedState}`);
  };

  const toggleSpeaker = async () => {
    const newSpeakerState = !speakerOn;
    setSpeakerOn(newSpeakerState);
    if (provider === 'agora' && agoraEngineRef.current) {
      agoraEngineRef.current.setEnableSpeakerphone(newSpeakerState);
    }
    console.log(`[Audio Layer] Speaker state: ${newSpeakerState}`);
  };

  return { connectSeat, disconnectSeat, toggleMic, micMuted, toggleSpeaker, speakerOn };
}

```


# src\screens\ActiveConnectsScreen.tsx
```tsx
import React, { useState } from 'react';
import { Platform, View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  TextInput, } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import ScreenShell from '../components/ScreenShell';
import TopBar from '../components/TopBar';
import GengalAvatar from '../components/GengalAvatar';
import DiamondBadge from '../components/DiamondBadge';
import { skeuo } from '../theme/skeuomorphic';


import { subscribeToOnlineUsers, UserProfile as FirebaseUser } from '../services/userService';
import { auth } from '../config/firebase';
import { useUser } from '../context/UserContext';

type ActiveConnectsScreenProps = {
  navigate: (screen: string, params?: any) => void;
};

export default function ActiveConnectsScreen({ navigate }: ActiveConnectsScreenProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const { profile: myProfile } = useUser();

  const [firebaseUsers, setFirebaseUsers] = React.useState<FirebaseUser[]>([]);

  React.useEffect(() => {
    const unsubscribe = subscribeToOnlineUsers((users) => {
      setFirebaseUsers(users);
    }, auth.currentUser?.uid);
    return () => {
      unsubscribe();
    };
  }, []);

  const displayProfiles = firebaseUsers.map(u => ({
    name: u.nickname || u.username || 'User',
    age: (typeof u.age === 'number' ? u.age : parseInt(u.age || '20', 10)),
    uri: u.avatarUrl || 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?q=80&w=200&auto=format&fit=crop',
    avatarData: u.avatarData,
    tier: (u.tier as 'Elite' | 'VIP') || 'Elite',
    lang: u.language || 'EN',
    modes: ['call', 'video'] as Array<'call' | 'video'>,
    isOnline: true,
  }));

  const filteredProfiles = displayProfiles.filter(profile => 
    profile.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <ScreenShell tone="light">
      <View style={styles.phone}>
        <TopBar navigate={navigate} />

        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Connections</Text>
            <Text style={styles.onlineText}>{displayProfiles.length} TOTAL</Text>
          </View>

          <View style={styles.searchContainer}>
            <MaterialIcons name="search" size={22} color="#A79386" style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search by username..."
              placeholderTextColor="#A79386"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>

          <View style={styles.list}>
            {filteredProfiles.map((profile, i) => {
              const isOnline = profile.isOnline !== false;
              
              return (
                <TouchableOpacity
                  key={profile.name + i}
                  style={styles.card}
                  activeOpacity={0.85}
                  onPress={() => navigate('Profile', { profileName: profile.name, matchData: profile })}
                >
                  <View style={styles.cardTop}>
                    <View style={styles.profileRing}>
                      {profile.avatarData ? (
                        <GengalAvatar data={profile.avatarData} size={48} />
                      ) : (
                        <Image source={{ uri: profile.uri }} style={styles.profilePhoto} />
                      )}
                      {isOnline && <View style={styles.onlineDot} />}
                    </View>

                    <View style={styles.cardInfo}>
                      <View style={styles.nameRow}>
                        <Text style={styles.profileName}>{profile.name}, {profile.age}</Text>
                        <Text style={[styles.activeStatusText, !isOnline && styles.offlineStatusText]}>
                          {isOnline ? '● Online' : '○ Offline'}
                        </Text>
                      </View>

                      <View style={styles.detailRow}>
                        <MaterialIcons name="language" size={14} color="#887006" />
                        <Text style={styles.detailText}>{profile.lang}</Text>
                      </View>

                      <View style={styles.detailRow}>
                        <MaterialIcons 
                          name={profile.modes.includes('video') ? "videocam" : "call"} 
                          size={14} 
                          color="#887006" 
                        />
                        <Text style={styles.detailText}>
                          {profile.modes.includes('video') ? 'Video Call' : 'Voice Call'}
                        </Text>
                      </View>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  phone: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 430,
    backgroundColor: '#FFFDF8',
  },
  header: {
    height: 72,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#F0E9DF',
    backgroundColor: '#FFFCF7',
    boxShadow: Platform.OS === 'web' ? '0 6px 22px rgba(88, 61, 27, 0.06)' : undefined,
  },
  avatarShadow: {
    width: 44,
    height: 44,
    borderRadius: 22,
    padding: 3,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DFC260',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  avatar: {
    width: '100%',
    height: '100%',
    borderRadius: 18,
  },
  brand: {
    flex: 1,
    textAlign: 'center',
    paddingHorizontal: 8,
    color: '#4B0054',
    fontFamily: 'serif',
    fontSize: 28,
    fontWeight: '900',
  },
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 40,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F0E9DF',
    paddingHorizontal: 16,
    height: 48,
    marginBottom: 24,
    boxShadow: Platform.OS === 'web' ? '0 2px 4px rgba(0,0,0,0.1)' : undefined,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#4B0054',
    paddingVertical: 8,
  },
  sectionTitle: {
    color: '#5C3B23',
    fontFamily: 'serif',
    fontSize: 16,
    fontWeight: '800',
  },
  onlineText: {
    color: '#A79386',
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  list: {
    gap: 16,
  },
  card: {
    borderRadius: 16,
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F3ECE1',
    boxShadow: Platform.OS === 'web' ? `${skeuo.raisedShadow}` : undefined,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  profileRing: {
    width: 68,
    height: 68,
    borderRadius: 34,
    padding: 2,
    borderWidth: 2,
    borderColor: '#D4B142',
    marginRight: 16,
  },
  profilePhoto: {
    width: '100%',
    height: '100%',
    borderRadius: 30,
  },
  onlineDot: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#1ECA4E',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  cardInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  profileName: {
    color: '#4A0049',
    fontFamily: 'serif',
    fontSize: 18,
    fontWeight: '800',
  },
  activeStatusText: {
    color: '#1ECA4E',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  offlineStatusText: {
    color: '#A79386',
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  detailText: {
    color: '#5C3B23',
    fontSize: 12,
    fontWeight: '600',
  },
});

```


# src\screens\AdminPanelScreen.tsx
```tsx
import React, { useState, useEffect } from 'react';
import { Platform, View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, ScrollView } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import ScreenShell from '../components/ScreenShell';
import { getGlobalSettings, updateGlobalSettings, initializeGlobalSettings, GlobalSettings } from '../services/adminService';
import { skeuo } from '../theme/skeuomorphic';

export default function AdminPanelScreen({ navigate }: { navigate: (screen: string) => void }) {
  const [settings, setSettings] = useState<GlobalSettings>({
    voiceCallRatePerMin: 15,
    videoCallRatePerMin: 30,
    creatorSharePercentage: 70,
    femaleExpertHeartsThreshold: 50,
    maleExpertRespectThreshold: 30,
    callDurationForHeart: 3,
    heartToInrRate: 3,
    minRechargeAmount: 49,
    inrToCoinRechargeRate: 1.12
  });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      await initializeGlobalSettings();
      const current = await getGlobalSettings();
      setSettings(current);
    };
    load();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateGlobalSettings({
        voiceCallRatePerMin: Number(settings.voiceCallRatePerMin),
        videoCallRatePerMin: Number(settings.videoCallRatePerMin),
        creatorSharePercentage: Number(settings.creatorSharePercentage),
        femaleExpertHeartsThreshold: Number(settings.femaleExpertHeartsThreshold),
        maleExpertRespectThreshold: Number(settings.maleExpertRespectThreshold),
        callDurationForHeart: Number(settings.callDurationForHeart),
        heartToInrRate: Number(settings.heartToInrRate),
        minRechargeAmount: Number(settings.minRechargeAmount),
        inrToCoinRechargeRate: Number(settings.inrToCoinRechargeRate)
      });
      Alert.alert('Success', 'Global pricing updated! Changes will sync to all active calls instantly.');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
    setIsSaving(false);
  };

  return (
    <ScreenShell tone="light">
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => navigate('Settings')}>
            <MaterialIcons name="arrow-back" size={24} color="#4A0049" />
          </TouchableOpacity>
          <Text style={styles.title}>Admin Panel</Text>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.sectionTitle}>Global Pricing Engine</Text>
          <Text style={styles.description}>
            Adjust the per-minute billing rates. These changes are broadcast via WebSocket and take effect immediately on all active calls globally.
          </Text>

          <View style={styles.card}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Voice Call Rate (G / min)</Text>
              <TextInput
                style={styles.input}
                value={settings.voiceCallRatePerMin.toString()}
                keyboardType="numeric"
                onChangeText={(v) => setSettings({ ...settings, voiceCallRatePerMin: parseInt(v) || 0 })}
              />
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Video Call Rate (G / min)</Text>
              <TextInput
                style={styles.input}
                value={settings.videoCallRatePerMin.toString()}
                keyboardType="numeric"
                onChangeText={(v) => setSettings({ ...settings, videoCallRatePerMin: parseInt(v) || 0 })}
              />
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Call Duration for Heart (Minutes)</Text>
              <TextInput
                style={styles.input}
                value={String(settings.callDurationForHeart)}
                keyboardType="numeric"
                onChangeText={(text) => setSettings({ ...settings, callDurationForHeart: Number(text) })}
              />
              <Text style={styles.hint}>Cumulative minutes required to earn 1 heart.</Text>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Heart to INR Rate (₹)</Text>
              <TextInput
                style={styles.input}
                value={String(settings.heartToInrRate)}
                keyboardType="numeric"
                onChangeText={(text) => setSettings({ ...settings, heartToInrRate: Number(text) })}
              />
              <Text style={styles.hint}>Value of 1 Heart in Rupees.</Text>
            </View>
          </View>

          <Text style={styles.sectionTitle}>Recharge Settings</Text>
          <View style={styles.card}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Min Custom Recharge Amount (₹)</Text>
              <TextInput
                style={styles.input}
                value={String(settings.minRechargeAmount)}
                keyboardType="numeric"
                onChangeText={(text) => setSettings({ ...settings, minRechargeAmount: Number(text) })}
              />
              <Text style={styles.hint}>The minimum ₹ amount a user can enter for custom recharges.</Text>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>₹ to Coin Conversion Rate</Text>
              <TextInput
                style={styles.input}
                value={String(settings.inrToCoinRechargeRate)}
                keyboardType="numeric"
                onChangeText={(text) => setSettings({ ...settings, inrToCoinRechargeRate: Number(text) })}
              />
              <Text style={styles.hint}>How many coins a user gets per ₹1 on custom recharges.</Text>
            </View>
          </View>

          <Text style={styles.sectionTitle}>Revenue Distribution</Text>
          <Text style={styles.description}>
            Set the percentage of the coin drain that is credited to the receiver. The remaining percentage acts as the platform margin.
          </Text>

          <View style={styles.card}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Creator Share (%)</Text>
              <TextInput
                style={styles.input}
                value={settings.creatorSharePercentage.toString()}
                keyboardType="numeric"
                onChangeText={(v) => {
                  let val = parseInt(v) || 0;
                  if (val > 100) val = 100;
                  if (val < 0) val = 0;
                  setSettings({ ...settings, creatorSharePercentage: val });
                }}
              />
            </View>
          </View>

          <TouchableOpacity style={styles.saveButton} onPress={handleSave} disabled={isSaving}>
            <Text style={styles.saveButtonText}>{isSaving ? 'Saving...' : 'Deploy Global Changes'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFDF8', width: '100%', maxWidth: 430, alignSelf: 'center' },
  header: { height: 72, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#EAD8A9' },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '900', color: '#4A0049', marginLeft: 8 },
  content: { padding: 24, paddingBottom: 60 },
  sectionTitle: { fontSize: 18, fontWeight: '900', color: '#4A0049', marginBottom: 8, marginTop: 12 },
  description: { fontSize: 13, color: '#8F8491', marginBottom: 16, lineHeight: 20 },
  card: { backgroundColor: '#FFF', borderRadius: 16, padding: 20, marginBottom: 24, borderWidth: 1, borderColor: '#EAD8A9', boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined },
  inputGroup: { marginBottom: 16, paddingBottom: 10 },
  label: { fontSize: 14, fontWeight: '800', color: '#5B1A62', marginBottom: 8 },
  input: { height: 50, backgroundColor: '#F8F5F0', borderRadius: 10, paddingHorizontal: 16, fontSize: 18, fontWeight: '700', color: '#4A0049', borderWidth: 1, borderColor: '#EAD8A9' },
  hint: { fontSize: 12, color: '#8A7C70', marginTop: 6, fontWeight: '500' },
  saveButton: { height: 56, backgroundColor: '#D3B742', borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 12, boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined },
  saveButtonText: { color: '#FFFDF8', fontSize: 16, fontWeight: '900' }
});

```


# src\screens\AvatarScreen.tsx
```tsx
import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Platform,
  ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import ScreenShell from '../components/ScreenShell';
import { skeuo, skeuoGradients } from '../theme/skeuomorphic';
import GengalAvatar, { AvatarData, DEFAULT_AVATAR_DNA } from '../components/GengalAvatar';

type AvatarScreenProps = {
  navigate: (screen: string, params?: any) => void;
  goBack: () => void;
  route: any;
};

const RANDOM_COLORS = ['#E2E8F0', '#FDE68A', '#FECACA', '#BFDBFE', '#A7F3D0', '#DDD6FE'];
const TOP_TYPES = ['shortHairShortWaved', 'longHairBun', 'longHairStraight', 'shortHairDreads01', 'shortHairShortCurly'];
const HAIR_COLORS = ['black', 'brownDark', 'blonde', 'red', 'silverGray'];
const CLOTHE_TYPES = ['crewNeck', 'graphicShirt', 'collarSweater', 'blazerShirt', 'hoodie'];

export default function AvatarScreen({ navigate, goBack, route }: AvatarScreenProps) {
  const [avatarData, setAvatarData] = useState<AvatarData>(DEFAULT_AVATAR_DNA);

  const randomizeAvatar = () => {
    setAvatarData({
      ...DEFAULT_AVATAR_DNA,
      topType: TOP_TYPES[Math.floor(Math.random() * TOP_TYPES.length)],
      hairColor: HAIR_COLORS[Math.floor(Math.random() * HAIR_COLORS.length)],
      clotheType: CLOTHE_TYPES[Math.floor(Math.random() * CLOTHE_TYPES.length)],
      bgColor: RANDOM_COLORS[Math.floor(Math.random() * RANDOM_COLORS.length)],
    });
  };

  const handleContinue = () => {
    // Pass everything collected so far to CreatePasswordScreen
    navigate('CreatePassword', {
      ...route?.params,
      avatar: avatarData
    });
  };

  return (
    <ScreenShell tone="light">
      <ScrollView 
        contentContainerStyle={[styles.container, { flexGrow: 1 }]} 
        bounces={false} 
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack} style={styles.backBtn}>
            <MaterialIcons name="arrow-back" size={24} color="#5A155A" />
          </TouchableOpacity>
          <Text style={styles.brand}>Gengal</Text>
          <View style={{ width: 44 }} />
        </View>

        <View style={styles.titleSection}>
          <Text style={styles.title}>Choose Your Avatar</Text>
          <Text style={styles.subtitle}>
            This is how others will see you in the lounge.
          </Text>
        </View>

        <View style={styles.avatarWrapper}>
          <GengalAvatar data={avatarData} size={200} />
          
          <TouchableOpacity style={styles.randomizeBtn} onPress={randomizeAvatar} activeOpacity={0.8}>
            <MaterialIcons name="shuffle" size={20} color="#FFF" />
            <Text style={styles.randomizeText}>Randomize</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <TouchableOpacity onPress={handleContinue} activeOpacity={0.8}>
            <View style={styles.continueButtonWrapper}>
              <LinearGradient
                colors={[...skeuoGradients.gold]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.continueButton}
              >
                <Text style={styles.continueText}>Looks Good, Continue</Text>
                <MaterialIcons name="arrow-forward" size={18} color="#422006" />
              </LinearGradient>
            </View>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 40,
    paddingHorizontal: 30,
    backgroundColor: skeuo.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FAF5EE',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  brand: {
    color: skeuo.plum,
    fontFamily: 'serif',
    fontSize: 28,
    fontWeight: '900',
  },
  titleSection: {
    alignItems: 'center',
    marginBottom: 40,
  },
  title: {
    fontFamily: 'serif',
    fontSize: 24,
    fontWeight: '700',
    color: skeuo.plum,
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 20,
  },
  avatarWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 40,
  },
  randomizeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: skeuo.plum,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    marginTop: 30,
    gap: 8,
    boxShadow: Platform.OS === 'web' ? skeuo.deepShadow : undefined,
    elevation: 4,
  },
  randomizeText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  footer: {
    marginTop: 'auto',
    marginBottom: 20,
  },
  continueButtonWrapper: {
    borderRadius: 16,
    backgroundColor: '#D0A92E',
    boxShadow: Platform.OS === 'web' ? skeuo.deepShadow : undefined,
    elevation: 8,
    shadowColor: '#533A1D',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
  },
  continueButton: {
    flexDirection: 'row',
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    overflow: 'hidden',
  },
  continueText: {
    color: '#422006',
    fontSize: 15,
    fontWeight: '700',
  },
});

```


# src\screens\CallScreen.tsx
```tsx
import React, { useState } from 'react';
import { Platform, Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View, } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import ScreenShell from '../components/ScreenShell';
import GengalAvatar from '../components/GengalAvatar';

import { skeuo } from '../theme/skeuomorphic';
import { useGengalVoice, FreeProvider } from '../hooks/useGengalVoice';
import { auth, db } from '../config/firebase';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { transferCoins, processCallBilling } from '../services/coinService';
import { subscribeToGlobalSettings, GlobalSettings } from '../services/adminService';
import ConnectingOverlay from '../components/ConnectingOverlay';

const WATERFALL: FreeProvider[] = ['agora', 'zegocloud'];

type CallScreenProps = {
  profileName?: string;
  mode?: 'call' | 'video';
  roomId?: string;
  matchData?: any;
  isCaller?: boolean;
  navigate: (screen: string, params?: { profileName?: string; mode?: 'call' | 'video'; roomId?: string; matchData?: any; isCaller?: boolean }) => void;
  goBack: () => void;
};

export default function CallScreen({ profileName, mode = 'call', roomId, matchData, isCaller, navigate, goBack }: CallScreenProps) {
  const profile = matchData ? {
    name: matchData.nickname || matchData.name,
    uri: matchData.uri || matchData.avatarUrl || '',
    age: matchData.age || '24', // Default for now
    avatarData: matchData.avatarData
  } : { name: profileName || 'User', uri: '', age: '24' };

  const isVideo = mode === 'video';
  const [areCamerasOn, setAreCamerasOn] = useState(true);
  const [isGifting, setIsGifting] = useState(false);
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings | null>(null);
  const [currentUserProfile, setCurrentUserProfile] = useState<any>(null);
  const [isConnecting, setIsConnecting] = useState(true);

  const [callDurationSeconds, setCallDurationSeconds] = useState(0);
  const [callerLiveCoins, setCallerLiveCoins] = useState(0);

  // 0. Fetch current user profile to determine gender/role
  React.useEffect(() => {
    const user = auth.currentUser;
    if (user) {
      import('../services/userService').then(({ getUserProfile }) => {
        getUserProfile(user.uid).then(p => {
          setCurrentUserProfile(p);
          if (p?.coins) setCallerLiveCoins(p.coins);
        });
      });
    }
  }, []);

  // 1. Initialize the 40K Multi-Adapter
  const initialProvider = (matchData?.audioProvider || 'agora') as FreeProvider;
  const audioToken = matchData?.audioTokenOrUrl || 'TEST_TOKEN';
  const [currentProvider, setCurrentProvider] = useState<FreeProvider>(initialProvider);
  const { connectSeat, disconnectSeat, toggleMic, micMuted, toggleSpeaker, speakerOn } = useGengalVoice(currentProvider);

  // Firestore listener for room provider updates (so both users stay in sync on fallbacks)
  React.useEffect(() => {
    if (!roomId) return;
    const unsub = onSnapshot(doc(db, 'rooms', roomId), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.audioProvider && data.audioProvider !== currentProvider) {
          console.log(`[Waterfall] Room provider changed by peer to ${data.audioProvider}. Connecting...`);
          setCurrentProvider(data.audioProvider as FreeProvider);
        }
      }
    });
    return unsub;
  }, [roomId, currentProvider]);

  // 2. Automatically connect to the voice room when the screen mounts or provider changes
  React.useEffect(() => {
    let isMounted = true;
    
    const establishSecureCall = async () => {
      if (!roomId) return;
      
      let connectionToken = audioToken;
      let extraParam = auth.currentUser?.uid || '';
      const user = auth.currentUser;

      const connectionPromise = async () => {
        // Pre-fetch secure ephemeral key from Flask backend authority if Agora
        if (currentProvider === 'agora' && user) {
          console.log("[CallScreen] Requesting secure ephemeral key from token authority...");
          const response = await fetch('https://batboy-glider-sanitary.ngrok-free.dev/api/v1/agora/generate-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ roomId: roomId, uid: user.uid })
          });
          if (!response.ok) throw new Error("Failed to authenticate with token engine");
          const credentials = await response.json();
          connectionToken = credentials.token;
        } else if (currentProvider === 'zegocloud' && user) {
          console.log("[CallScreen] Resolving crypto credentials from Zego Token Authority...");
          const response = await fetch('https://batboy-glider-sanitary.ngrok-free.dev/api/v1/zego/generate-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ roomId: roomId, uid: user.uid })
          });
          if (!response.ok) throw new Error("Zego Authority server rejected proxy call.");
          const tokenPayload = await response.json();
          connectionToken = tokenPayload.token;
        }
        
        if (isMounted) {
          await connectSeat(roomId, connectionToken, extraParam);
          if (isMounted) setIsConnecting(false);
        }
      };

      try {
        // Enforce a strict 7-second timeout for the provider to connect
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Connection Timeout")), 7000));
        await Promise.race([connectionPromise(), timeoutPromise]);
      } catch (error) {
        console.error(`[Waterfall] Provider ${currentProvider} failed:`, error);
        
        // Trigger Waterfall Fallback
        const currentIndex = WATERFALL.indexOf(currentProvider);
        if (currentIndex !== -1 && currentIndex + 1 < WATERFALL.length) {
          const nextProvider = WATERFALL[currentIndex + 1];
          console.warn(`[Waterfall] Falling back to next adapter: ${nextProvider}`);
          try {
            await updateDoc(doc(db, 'rooms', roomId), { audioProvider: nextProvider });
            // The onSnapshot listener will detect this and update currentProvider automatically
          } catch (e) {
            console.error("[Waterfall] Failed to update room with new provider", e);
          }
        } else {
          alert("All secure video connection routes failed. Please try again later.");
          goBack();
        }
      }
    };

    establishSecureCall();

    return () => {
      isMounted = false;
      disconnectSeat();
    };
  }, [roomId, currentProvider]);

  // 3. Fetch global billing settings
  React.useEffect(() => {
    const unsub = subscribeToGlobalSettings((settings) => {
      setGlobalSettings(settings);
    });
    return unsub;
  }, []);

  // 4. Background Billing Loop (Per-Second Batched)
  const accumulatedCostRef = React.useRef(0);
  const syncIntervalRef = React.useRef(0);

  React.useEffect(() => {
    if (!roomId || !matchData?.uid || !globalSettings || !currentUserProfile) return;

    // Caller-pays billing logic
    // We do NOT halt here if they aren't the caller, because both users need to track their cumulative time for rewards.

    const billingRatePerMin = isVideo ? globalSettings.videoCallRatePerMin : globalSettings.voiceCallRatePerMin;
    const sharePercentage = globalSettings.creatorSharePercentage;
    const billingRatePerSec = billingRatePerMin / 60;

    const billingInterval = setInterval(async () => {
      const user = auth.currentUser;
      if (!user) return;

      // Accumulate local cost only for the caller
      if (isCaller) {
        accumulatedCostRef.current += billingRatePerSec;
        setCallerLiveCoins(prev => Math.max(0, prev - billingRatePerSec));
      }
      
      syncIntervalRef.current += 1;
      setCallDurationSeconds(prev => prev + 1);

      // Sync to Firestore every 15 seconds
      if (syncIntervalRef.current >= 15) {
        syncIntervalRef.current = 0;

        if (isCaller) {
          const costToSync = accumulatedCostRef.current;
          accumulatedCostRef.current = 0; // Reset immediately to prevent double-charging on next tick

          try {
            const result = await processCallBilling(user.uid, matchData.uid, costToSync, sharePercentage);
            console.log(`[Billing Engine] Synced ${costToSync.toFixed(2)}G to Firestore.`);
            
            if (result.hasInsufficientFunds) {
              console.warn(`[Billing Engine] Call disconnected: User ran out of coins.`);
              alert("You have run out of coins. 💎");
              disconnectSeat();
              goBack();
            }
          } catch (error: any) {
            console.warn(`[Billing Engine] Error syncing billing: ${error.message}`);
            // If transaction completely fails, restore the accumulated cost
            accumulatedCostRef.current += costToSync;
          }
        }

        // Sync Cumulative Time & Rewards for BOTH users
        try {
          const { updateCallRewards } = await import('../services/coinService');
          await updateCallRewards(user.uid, 15, globalSettings.callDurationForHeart, !isCaller);
          console.log(`[Rewards Engine] Synced 15 seconds of call time for rewards.`);
        } catch (e) {
          console.warn("[Rewards Engine] Failed to update call rewards", e);
        }
      }
    }, 1000); // Execute every 1 second

    return () => {
      clearInterval(billingInterval);
      
      // Flush any remaining unbilled seconds to Firestore when the component unmounts (call ends)
      const remainingSeconds = syncIntervalRef.current;
      
      if (isCaller && accumulatedCostRef.current > 0) {
        const user = auth.currentUser;
        if (user) {
          const finalCost = accumulatedCostRef.current;
          processCallBilling(user.uid, matchData.uid, finalCost, sharePercentage)
             .then(() => console.log(`[Billing Engine] Flushed final ${finalCost.toFixed(2)}G to Firestore.`))
             .catch((e) => console.warn(`[Billing Engine] Final flush failed:`, e));
        }
      }

      if (remainingSeconds > 0) {
        const user = auth.currentUser;
        if (user) {
          import('../services/coinService').then(({ updateCallRewards }) => {
            updateCallRewards(user.uid, remainingSeconds, globalSettings.callDurationForHeart, !isCaller)
              .catch(e => console.warn("[Rewards Engine] Final flush failed", e));
          });
        }
      }
    };
  }, [roomId, matchData?.uid, globalSettings, currentUserProfile, isCaller, isVideo]);

  const formatTimer = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleGift = async (amount: number) => {
    const user = auth.currentUser;
    if (!user || !matchData?.uid) return;
    
    setIsGifting(true);
    try {
      await transferCoins(user.uid, matchData.uid, amount);
      alert(`Sent a ${amount}G gift! 🎉`);
    } catch (error: any) {
      alert(error.message);
    }
    setIsGifting(false);
  };

  if (!isVideo) {
    return (
      <ScreenShell tone="light">
        {isConnecting && (
          <ConnectingOverlay 
            mode="private" 
            targetName={profile.name}
            onCancel={() => {
              disconnectSeat();
              goBack();
            }} 
          />
        )}
        <View style={styles.voicePhone}>
          <View style={styles.voiceContent}>
            <View style={styles.voiceAvatarShadow}>
              <LinearGradient
                colors={['#FFFFFF', '#F2E7DD']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.voiceAvatarOuter}
              >
                <View style={styles.voiceAvatarInner}>
                  {(profile as any).avatarData ? (
                    <GengalAvatar data={(profile as any).avatarData} size={200} />
                  ) : (
                    <Image source={{ uri: profile.uri }} style={styles.voiceAvatar} />
                  )}
                </View>
              </LinearGradient>
            </View>

            <Text style={styles.voiceName}>{profile.name}, {profile.age}</Text>
            <Text style={styles.voiceStatus}>Talking...</Text>
            <Text style={{ fontSize: 24, fontWeight: '700', color: '#4B0054', marginTop: 12 }}>{formatTimer(callDurationSeconds)}</Text>
            
            {isCaller && (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 16, backgroundColor: '#FFFDF8', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, boxShadow: Platform.OS === 'web' ? '0 4px 12px rgba(68, 44, 21, 0.05)' : undefined }}>
                <MaterialIcons name="account-balance-wallet" size={20} color="#D49A0B" />
                <Text style={{ fontSize: 16, fontWeight: '800', color: '#4B0054', marginLeft: 6 }}>
                  {Math.floor(callerLiveCoins)} G
                </Text>
              </View>
            )}
          </View>

          <View style={styles.voiceControlsBar}>
            <View style={styles.voiceControls}>
              <TouchableOpacity style={styles.voiceControlItem} activeOpacity={0.82} onPress={toggleMic}>
                <View style={[styles.voiceControlButton, micMuted && styles.voiceControlButtonActive]}>
                  <MaterialIcons name={micMuted ? "mic-off" : "mic"} size={21} color={micMuted ? "#B30005" : "#4B0054"} />
                </View>
                <Text style={styles.voiceControlLabel}>{micMuted ? "Muted" : "Mute"}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.voiceControlItem} activeOpacity={0.82} onPress={toggleSpeaker}>
                <View style={[styles.voiceControlButton, speakerOn && styles.voiceControlButtonActive]}>
                  <MaterialIcons name={speakerOn ? "volume-up" : "volume-off"} size={21} color={speakerOn ? "#4B0054" : "#9A856E"} />
                </View>
                <Text style={styles.voiceControlLabel}>{speakerOn ? "Speaker" : "Earpiece"}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.voiceControlItem}
                activeOpacity={0.82}
                onPress={() => handleGift(100)} // Send 100G Rose
                disabled={isGifting}
              >
                <View style={[styles.voiceControlButton, { borderColor: '#E8CA58', borderWidth: 2 }]}>
                  <MaterialIcons name="card-giftcard" size={21} color="#E8CA58" />
                </View>
                <Text style={styles.voiceControlLabel}>{isGifting ? "Sending..." : "100G Rose"}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.voiceControlItem}
                activeOpacity={0.82}
                onPress={() => {
                  disconnectSeat();
                  goBack();
                }}
              >
                <View style={styles.voiceEndButton}>
                  <MaterialIcons name="call-end" size={23} color="#FFFFFF" />
                </View>
                <Text style={styles.voiceEndLabel}>End</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell tone="dark">
      {isConnecting && (
        <ConnectingOverlay 
          mode="private" 
          targetName={profile.name}
          onCancel={() => {
            disconnectSeat();
            goBack();
          }} 
        />
      )}
      <View style={styles.videoPhone}>
        {areCamerasOn ? (
          <Image source={{ uri: profile.uri }} style={styles.videoRemoteImage} />
        ) : (
          <LinearGradient
            colors={['#1B0718', '#4B0054', '#11040F']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.videoOffBackdrop}
          >
            <View style={styles.videoOffHalo}>
              <LinearGradient
                colors={['#FFF8DF', '#B19622', '#F6D96B']}
                style={styles.videoOffAvatarRing}
              >
                <View style={styles.videoOffAvatarInner}>
                  <Image source={{ uri: profile.uri }} style={styles.videoOffAvatar} />
                </View>
              </LinearGradient>
              <View style={styles.videoOffIcon}>
                <MaterialIcons name="videocam-off" size={25} color="#4B0054" />
              </View>
            </View>
            <Text style={styles.videoOffName}>{profile.name}, {profile.age}</Text>
            <Text style={styles.videoOffStatus}>Both cameras are off</Text>
          </LinearGradient>
        )}
        <LinearGradient
          colors={areCamerasOn
            ? ['rgba(18, 6, 12, 0.62)', 'rgba(18, 6, 12, 0.04)', 'rgba(18, 6, 12, 0.32)']
            : ['rgba(18, 6, 12, 0.34)', 'rgba(18, 6, 12, 0.02)', 'rgba(18, 6, 12, 0.22)']}
          locations={[0, 0.42, 1]}
          style={styles.videoShade}
        />

        <View style={styles.videoTopBar}>
          <TouchableOpacity style={styles.videoCircleButton} activeOpacity={0.82} onPress={() => goBack()}>
            <MaterialIcons name="arrow-back" size={23} color="#4B0054" />
          </TouchableOpacity>
          <View style={styles.videoTitleBlock}>
            <Text style={styles.videoName}>{profile.name}</Text>
            <Text style={styles.videoSubtitle}>PREMIUM CONNECTION</Text>
          </View>
          <View style={styles.videoTimerPill}>
            <Text style={styles.videoTimer}>{formatTimer(callDurationSeconds)}</Text>
          </View>
          {isCaller && (
            <View style={{ marginLeft: 8, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 }}>
              <MaterialIcons name="account-balance-wallet" size={16} color="#D49A0B" />
              <Text style={{ fontSize: 14, fontWeight: '800', color: '#FFF', marginLeft: 4 }}>
                {Math.floor(callerLiveCoins)} G
              </Text>
            </View>
          )}
          <TouchableOpacity style={styles.videoCircleButton} activeOpacity={0.82}>
            <MaterialIcons name="more-vert" size={23} color="#4B0054" />
          </TouchableOpacity>
        </View>

        <View style={[styles.selfPreview, !areCamerasOn && styles.selfPreviewOff]}>
          {areCamerasOn ? (
            <Image source={{ uri: currentUserProfile?.avatarUrl || ''  }} style={styles.selfPreviewImage} />
          ) : (
            <View style={styles.selfPreviewOffContent}>
              <Image source={{ uri: currentUserProfile?.avatarUrl || ''  }} style={styles.selfPreviewAvatar} />
              <View style={styles.selfPreviewOffBadge}>
                <MaterialIcons name="videocam-off" size={15} color="#FFFDF8" />
              </View>
            </View>
          )}
        </View>

        <View style={styles.videoControlsTray}>
          <TouchableOpacity style={styles.videoControlItem} activeOpacity={0.82}>
            <View style={styles.videoControlButton}>
              <MaterialIcons name="mic-off" size={22} color="#756A62" />
            </View>
            <Text style={styles.videoControlLabel}>Mute</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.videoControlItem}
            activeOpacity={0.82}
            onPress={() => setAreCamerasOn((current) => !current)}
          >
            <View style={[styles.videoControlButton, !areCamerasOn && styles.videoControlButtonActive]}>
              <MaterialIcons name={areCamerasOn ? 'videocam-off' : 'videocam'} size={22} color={areCamerasOn ? '#756A62' : '#4B0054'} />
            </View>
            <Text style={styles.videoControlLabel}>Camera</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.videoControlItem} activeOpacity={0.82}>
            <View style={styles.videoControlButton}>
              <MaterialIcons name="flip-camera-ios" size={22} color="#756A62" />
            </View>
            <Text style={styles.videoControlLabel}>Flip</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.videoControlItem}
            activeOpacity={0.82}
            onPress={() => goBack()}
          >
            <View style={styles.videoEndButton}>
              <MaterialIcons name="call-end" size={25} color="#FFFFFF" />
            </View>
            <Text style={styles.videoEndLabel}>End</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  voicePhone: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 430,
    backgroundColor: '#FFFCF7',
  },
  voiceContent: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 34,
    backgroundColor: '#FFFCF7',
  },
  voiceAvatarShadow: {
    width: 212,
    height: 212,
    borderRadius: 106,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    boxShadow: Platform.OS === 'web' ? '0 12px 28px rgba(72, 54, 42, 0.22)' : undefined,
  },
  voiceAvatarOuter: {
    width: 202,
    height: 202,
    borderRadius: 101,
    padding: 5,
  },
  voiceAvatarInner: {
    flex: 1,
    borderRadius: 96,
    padding: 5,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  voiceAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: 91,
  },
  voiceName: {
    marginTop: 62,
    color: '#4B0054',
    fontFamily: 'serif',
    fontSize: 33,
    fontWeight: '900',
  },
  voiceStatus: {
    marginTop: 4,
    color: '#9A7A08',
    fontFamily: 'serif',
    fontSize: 21,
    fontStyle: 'italic',
    fontWeight: '700',
  },
  voiceControlsBar: {
    minHeight: 154,
    paddingHorizontal: 22,
    paddingTop: 26,
    paddingBottom: 26,
    backgroundColor: '#F9F5EF',
    borderTopWidth: 1,
    borderTopColor: '#EFE8DD',
    boxShadow: Platform.OS === 'web' ? '0 -12px 28px rgba(80, 55, 36, 0.10)' : undefined,
  },
  voiceControls: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  voiceControlItem: {
    width: 78,
    alignItems: 'center',
    gap: 10,
  },
  voiceControlButton: {
    width: 66,
    height: 66,
    borderRadius: 33,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1ECE4',
    borderWidth: 1,
    borderColor: '#FFFFFF',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  voiceControlButtonActive: {
    backgroundColor: '#EADCD0',
    boxShadow: Platform.OS === 'web' ? '0 2px 4px rgba(0,0,0,0.1)' : undefined,
  },
  voiceEndButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#B30005',
    borderWidth: 1,
    borderColor: '#C53A3A',
    boxShadow: Platform.OS === 'web' ? '0 11px 20px rgba(179, 0, 5, 0.28)' : undefined,
  },
  voiceControlLabel: {
    color: '#3E3440',
    fontSize: 13,
    fontWeight: '800',
  },
  voiceEndLabel: {
    color: '#B30005',
    fontSize: 13,
    fontWeight: '900',
  },
  videoPhone: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 430,
    overflow: 'hidden',
    backgroundColor: '#12060F',
  },
  videoRemoteImage: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  videoShade: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  videoOffBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  videoOffHalo: {
    width: 188,
    height: 188,
    borderRadius: 94,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 253, 248, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 248, 222, 0.18)',
    boxShadow: Platform.OS === 'web' ? '0 20px 44px rgba(0, 0, 0, 0.36)' : undefined,
  },
  videoOffAvatarRing: {
    width: 152,
    height: 152,
    borderRadius: 76,
    padding: 4,
  },
  videoOffAvatarInner: {
    flex: 1,
    borderRadius: 72,
    padding: 4,
    backgroundColor: '#FFFDF8',
    overflow: 'hidden',
  },
  videoOffAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: 68,
  },
  videoOffIcon: {
    position: 'absolute',
    right: 17,
    bottom: 19,
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFDF8',
    borderWidth: 2,
    borderColor: '#CFB13D',
    boxShadow: Platform.OS === 'web' ? '0 10px 18px rgba(0, 0, 0, 0.24)' : undefined,
  },
  videoOffName: {
    marginTop: 28,
    color: '#FFF7EA',
    fontFamily: 'serif',
    fontSize: 31,
    fontWeight: '900',
    textAlign: 'center',
  },
  videoOffStatus: {
    marginTop: 7,
    color: '#E9D79D',
    fontSize: 13,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  videoTopBar: {
    position: 'absolute',
    top: 16,
    left: 18,
    right: 18,
    height: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  videoCircleButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 247, 244, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255, 247, 244, 0.42)',
    boxShadow: Platform.OS === 'web' ? '0 8px 20px rgba(23, 5, 18, 0.32)' : undefined,
  },
  videoTitleBlock: {
    flex: 1,
    justifyContent: 'center',
  },
  videoName: {
    color: '#FFF7EA',
    fontFamily: 'serif',
    fontSize: 21,
    fontWeight: '900',
    ...(Platform.OS === 'web' ? { textShadow: '0px 2px 8px rgba(0, 0, 0, 0.42)' } : {
      textShadowColor: 'rgba(0, 0, 0, 0.42)',
      textShadowOffset: { width: 0, height: 2 },
      textShadowRadius: 8,
    }) as any,
  },
  videoSubtitle: {
    marginTop: -1,
    color: '#FFF7EA',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0,
  },
  videoTimerPill: {
    minWidth: 62,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 247, 244, 0.75)',
    borderWidth: 1,
    borderColor: 'rgba(255, 247, 244, 0.46)',
  },
  videoTimer: {
    color: '#755D56',
    fontSize: 11,
    fontWeight: '900',
  },
  selfPreview: {
    position: 'absolute',
    top: 106,
    right: 26,
    width: 128,
    height: 162,
    borderRadius: 9,
    padding: 2,
    backgroundColor: 'rgba(255, 252, 247, 0.82)',
    boxShadow: Platform.OS === 'web' ? '0 12px 24px rgba(18, 6, 15, 0.36)' : undefined,
  },
  selfPreviewImage: {
    width: '100%',
    height: '100%',
    borderRadius: 7,
    resizeMode: 'cover',
  },
  selfPreviewOff: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 252, 247, 0.88)',
  },
  selfPreviewOffContent: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selfPreviewAvatar: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 3,
    borderColor: '#D3B742',
  },
  selfPreviewOffBadge: {
    position: 'absolute',
    right: 12,
    bottom: 13,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4B0054',
    borderWidth: 2,
    borderColor: '#FFFDF8',
  },
  videoControlsTray: {
    position: 'absolute',
    left: 30,
    right: 30,
    bottom: 38,
    minHeight: 116,
    borderRadius: 36,
    paddingHorizontal: 14,
    paddingTop: 16,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 249, 242, 0.78)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.34)',
    boxShadow: Platform.OS === 'web' ? '0 14px 30px rgba(18, 6, 15, 0.28)' : undefined,
  },
  videoControlItem: {
    width: 68,
    alignItems: 'center',
    gap: 8,
  },
  videoControlButton: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1ECE4',
    borderWidth: 1,
    borderColor: '#FFFFFF',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  videoControlButtonActive: {
    backgroundColor: '#FFF1C2',
    borderWidth: 1,
    borderColor: '#D3B742',
  },
  videoEndButton: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#C90812',
    boxShadow: Platform.OS === 'web' ? '0 12px 22px rgba(201, 8, 18, 0.3)' : undefined,
  },
  videoControlLabel: {
    color: '#3E3440',
    fontSize: 13,
    fontWeight: '900',
    ...(Platform.OS === 'web' ? { textShadow: '0px 1px 4px rgba(255, 255, 255, 0.3)' } : {
      textShadowColor: 'rgba(255, 255, 255, 0.3)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 4,
    }) as any,
  },
  videoEndLabel: {
    color: '#B30005',
    fontSize: 13,
    fontWeight: '900',
  },
  phone: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 430,
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 34,
  },
  header: {
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 253, 248, 0.2)',
  },
  headerButtonGhost: {
    width: 42,
    height: 42,
  },
  headerText: {
    color: '#5A075F',
    fontSize: 15,
    fontWeight: '900',
  },
  headerTextLight: {
    color: '#FFF7FF',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarRing: {
    width: 174,
    height: 174,
    borderRadius: 87,
    padding: 4,
    boxShadow: Platform.OS === 'web' ? '0 18px 36px rgba(76, 0, 84, 0.18)' : undefined,
  },
  avatarRingVideo: {
    boxShadow: Platform.OS === 'web' ? '0 18px 42px rgba(255, 220, 130, 0.28)' : undefined,
  },
  avatarInner: {
    flex: 1,
    borderRadius: 83,
    padding: 3,
    overflow: 'hidden',
    backgroundColor: '#FFFDF8',
  },
  avatar: {
    width: '100%',
    height: '100%',
    borderRadius: 80,
  },
  name: {
    marginTop: 26,
    color: '#4B0054',
    fontFamily: 'serif',
    fontSize: 36,
    fontWeight: '900',
  },
  nameLight: {
    color: '#FFF7FF',
  },
  status: {
    marginTop: 8,
    color: '#927F74',
    fontSize: 14,
    fontWeight: '800',
  },
  statusLight: {
    color: '#E4D2E7',
  },
  pulse: {
    marginTop: 34,
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 253, 248, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(217, 185, 86, 0.6)',
  },
  controls: {
    height: 86,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 28,
  },
  controlButton: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFDF8',
  },
  endButton: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#D83749',
    boxShadow: Platform.OS === 'web' ? '0 12px 22px rgba(216, 55, 73, 0.28)' : undefined,
  },
});

```


# src\screens\ChatScreen.tsx
```tsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import { skeuo } from '../theme/skeuomorphic';

import CallPriceTag from '../components/CallPriceTag';
import ScreenShell from '../components/ScreenShell';
import { getChatId, sendMessage, subscribeToMessages } from '../services/chatService';
import { auth } from '../config/firebase';

type ChatScreenProps = {
  profileName?: string;
  navigate: (screen: string, params?: any) => void;
  route?: any;
};

type Message = {
  id: number;
  from: 'me' | 'them';
  text: string;
  time: string;
};


function makeInitialMessages(name: string): Message[] {
  return [
    {
      id: 1,
      from: 'them',
      text: `Hi, I am glad we matched. Your profile felt warm.`,
      time: 'Now',
    },
    {
      id: 2,
      from: 'me',
      text: `Hi ${name}, nice to meet you.`,
      time: 'Now',
    },
    {
      id: 3,
      from: 'them',
      text: 'Would you like to start with a short chat or a private call?',
      time: 'Now',
    },
  ];
}

export default function ChatScreen({ profileName, navigate, route }: ChatScreenProps) {
  const matchData = route?.params?.matchData;
  const profile = matchData ? {
    name: matchData.nickname || matchData.name,
    uri: matchData.uri || matchData.avatarUrl || '',
  } : { name: profileName || 'User', uri: '' };
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const quickReplies = useMemo(
    () => ['Start softly', 'Voice call?', 'Tell me about you'],
    [],
  );

  const currentUid = auth.currentUser?.uid;
  const targetUid = matchData?.uid || profile.name; // prefer real UID from matchData, fall back to name for demo
  const chatId = currentUid ? getChatId(currentUid, targetUid) : '';

  useEffect(() => {
    if (!chatId) {
      setMessages(makeInitialMessages(profile.name));
      return;
    }
    
    const unsubscribe = subscribeToMessages(chatId, (fetchedMessages) => {
      if (fetchedMessages.length === 0) {
        setMessages(makeInitialMessages(profile.name));
        return;
      }
      
      const formatted: Message[] = fetchedMessages.map(m => ({
        id: m.id as any,
        from: m.senderId === currentUid ? 'me' : 'them',
        text: m.text,
        time: m.timestamp?.toDate ? m.timestamp.toDate().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'Now'
      }));
      setMessages(formatted);
    });
    return unsubscribe;
  }, [chatId, currentUid, profile.name]);

  const handleSend = async (text = draft) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    
    setDraft('');
    
    if (chatId && currentUid) {
      try {
        await sendMessage(chatId, currentUid, trimmed);
      } catch (e) {
        console.error("Failed to send message", e);
      }
    } else {
      // Fallback if not authenticated
      const nextId = messages.length + 1;
      setMessages((current) => [
        ...current,
        { id: nextId, from: 'me', text: trimmed, time: 'Now' },
        { id: nextId + 1, from: 'them', text: 'Please sign in to send messages.', time: 'Now' }
      ]);
    }
  };

  return (
    <ScreenShell tone="light">
      <KeyboardAvoidingView
        style={styles.phone}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <TouchableOpacity style={styles.headerButton} activeOpacity={0.78} onPress={() => navigate('Profile', { profileName: profile.name })}>
            <MaterialIcons name="arrow-back" size={22} color="#5A075F" />
          </TouchableOpacity>
          <View style={styles.headerProfile}>
            <Image source={{ uri: profile.uri }} style={styles.avatar} />
            <View style={styles.headerCopy}>
              <Text style={styles.name}>{profile.name}</Text>
              <View style={styles.statusRow}>
                <View style={styles.onlineDot} />
                <Text style={styles.statusText}>Online now</Text>
              </View>
            </View>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.headerAction}
              activeOpacity={0.8}
              onPress={() => navigate('Call', { profileName: profile.name, mode: 'call', isCaller: true })}
            >
              <MaterialIcons name="phone" size={16} color="#806806" />
              <CallPriceTag mode="call" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.headerAction, styles.headerActionDark]}
              activeOpacity={0.8}
              onPress={() => navigate('Call', { profileName: profile.name, mode: 'video', isCaller: true })}
            >
              <MaterialIcons name="videocam" size={16} color="#FFF7FF" />
              <CallPriceTag mode="video" />
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.messages}
        >
          <LinearGradient
            colors={['#FFFDF8', '#F7EEDF']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.matchBanner}
          >
            <MaterialIcons name="favorite" size={17} color="#7E6507" />
            <Text style={styles.matchText}>Private match connected</Text>
          </LinearGradient>

          {messages.map((message) => {
            const mine = message.from === 'me';
            return (
              <View key={message.id} style={[styles.messageRow, mine && styles.messageRowMine]}>
                {!mine ? <Image source={{ uri: profile.uri }} style={styles.messageAvatar} /> : null}
                <View style={[styles.bubble, mine ? styles.myBubble : styles.theirBubble]}>
                  <Text style={[styles.bubbleText, mine && styles.myBubbleText]}>{message.text}</Text>
                  <Text style={[styles.messageTime, mine && styles.myMessageTime]}>{message.time}</Text>
                </View>
              </View>
            );
          })}
        </ScrollView>

        <View style={styles.quickRow}>
          {quickReplies.map((reply) => (
            <TouchableOpacity key={reply} style={styles.quickPill} onPress={() => handleSend(reply)}>
              <Text style={styles.quickText}>{reply}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.composer}>
          <TouchableOpacity style={styles.composerIcon} activeOpacity={0.8}>
            <MaterialIcons name="add" size={20} color="#8C7A70" />
          </TouchableOpacity>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Write a private message"
            placeholderTextColor="#A59A91"
            style={styles.input}
            onSubmitEditing={() => handleSend(draft)}
          />
          <TouchableOpacity
            style={[styles.sendButton, draft.trim() ? styles.sendButtonActive : null]}
            activeOpacity={0.84}
            onPress={() => handleSend(draft)}
          >
            <MaterialIcons name="send" size={18} color="#FFF7FF" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  phone: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 430,
    backgroundColor: '#FFFCF7',
  },
  header: {
    minHeight: 76,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F0E7DA',
    backgroundColor: '#FFFCF7',
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF8EA',
  },
  headerProfile: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: '#D8BD57',
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    color: '#4B0054',
    fontFamily: 'serif',
    fontSize: 22,
    fontWeight: '900',
  },
  statusRow: {
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  onlineDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#73BB58',
  },
  statusText: {
    color: '#7D8B70',
    fontSize: 10,
    fontWeight: '900',
  },
  headerActions: {
    flexDirection: 'column',
    gap: 7,
  },
  headerAction: {
    height: 38,
    minWidth: 38,
    paddingHorizontal: 10,
    borderRadius: 19,
    flexDirection: 'row',
    gap: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8F1E5',
    borderWidth: 1,
    borderColor: '#E8DFCD',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  headerActionDark: {
    backgroundColor: '#4B0054',
    borderColor: '#4B0054',
  },
  messages: {
    padding: 16,
    paddingBottom: 20,
    gap: 13,
  },
  matchBanner: {
    alignSelf: 'center',
    minHeight: 38,
    paddingHorizontal: 14,
    borderRadius: 19,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderWidth: 1,
    borderColor: '#EAD8A9',
  },
  matchText: {
    color: '#6B5B24',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  messageRowMine: {
    justifyContent: 'flex-end',
  },
  messageAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
  },
  bubble: {
    maxWidth: '76%',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 5,
  },
  theirBubble: {
    borderBottomLeftRadius: 6,
    backgroundColor: '#FFFDF8',
    borderWidth: 1,
    borderColor: '#EFE4D3',
  },
  myBubble: {
    borderBottomRightRadius: 6,
    backgroundColor: '#4B0054',
    boxShadow: Platform.OS === 'web' ? '0 8px 16px rgba(75, 0, 84, 0.16)' : undefined,
  },
  bubbleText: {
    color: '#6B5F57',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  myBubbleText: {
    color: '#FFF7FF',
  },
  messageTime: {
    color: '#AAA098',
    fontSize: 9,
    fontWeight: '800',
  },
  myMessageTime: {
    color: '#D8C7DC',
  },
  quickRow: {
    paddingHorizontal: 14,
    paddingBottom: 10,
    flexDirection: 'row',
    gap: 8,
  },
  quickPill: {
    flex: 1,
    minHeight: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    backgroundColor: '#FFF5D8',
    borderWidth: 1,
    borderColor: '#E1C460',
  },
  quickText: {
    color: '#806806',
    fontSize: 10,
    fontWeight: '900',
  },
  composer: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#F0E7DA',
    backgroundColor: '#FFFCF7',
  },
  composerIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5EEE5',
  },
  input: {
    flex: 1,
    height: 42,
    borderRadius: 21,
    paddingHorizontal: 15,
    color: '#4B0054',
    fontSize: 13,
    fontWeight: '800',
    backgroundColor: '#FFFDF8',
    borderWidth: 1,
    borderColor: '#EFE4D3',
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#BCA9BF',
  },
  sendButtonActive: {
    backgroundColor: '#4B0054',
  },
});

```


# src\screens\ClubScreen.tsx
```tsx
import React, { useState } from 'react';
import { Platform, Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Modal, } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons, Ionicons } from '@expo/vector-icons';
import ScreenShell from '../components/ScreenShell';
import TopBar from '../components/TopBar';
import BottomNav from '../components/BottomNav';
import DiamondBadge from '../components/DiamondBadge';
import { skeuo } from '../theme/skeuomorphic';
import { auth, db } from '../config/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { getGlobalSettings } from '../services/adminService';
import { UserProfile } from '../services/userService';

import { subscribeToOnlineUsers } from '../services/userService';

export default function ClubScreen({ navigate }: { navigate: (screen: string) => void }) {
  const [modalVisible, setModalVisible] = useState(false);
  const [modalTitle, setModalTitle] = useState('');
  const [modalMessage, setModalMessage] = useState('');
  const [firebaseUsers, setFirebaseUsers] = useState<UserProfile[]>([]);

  React.useEffect(() => {
    const unsubscribe = subscribeToOnlineUsers((users) => {
      setFirebaseUsers(users.filter(u => (u.tier as string) === 'Elite' || u.tier === 'VIP'));
    }, auth.currentUser?.uid);
    return () => {
      unsubscribe();
    };
  }, []);

  const FILTERS = ['Live', 'VIP', 'Voice', 'Private'];

  const ROOMS = firebaseUsers.slice(0, 5).map((user, index) => ({
    id: user.uid || index,
    image: 'https://images.unsplash.com/photo-1517457373958-b7bdd4587205?auto=format&fit=crop&w=760&q=88',
    host: user.avatarUrl || 'https://via.placeholder.com/50',
    avatarData: user.avatarData,
    title: `${user.nickname || user.username}'s Lounge`,
    subtitle: 'Premium live table',
    members: `${Math.floor(Math.random() * 500) + 50} online`,
    price: (user.tier as string) === 'Elite' ? 80 : 120,
    tier: (user.tier as string) || 'Elite',
  }));

  const showModal = (title: string, message: string) => {
    setModalTitle(title);
    setModalMessage(message);
    setModalVisible(true);
  };

  const handleCreateExpertRoom = async () => {
    if (!auth.currentUser?.uid) {
      showModal('Not Logged In', 'Please sign in to create an expert room.');
      return;
    }

    try {
      const userRef = doc(db, 'users', auth.currentUser.uid);
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) {
        showModal('Error', 'User profile not found.');
        return;
      }
      
      const userProfile = userSnap.data() as UserProfile;
      const settings = await getGlobalSettings();

      if (!userProfile.gender) {
        showModal('Gender Required', 'Please set your gender in your profile to create a room.');
        return;
      }

      if (userProfile.gender === 'Feminine') {
        const hearts = userProfile.hearts || 0;
        if (hearts < settings.femaleExpertHeartsThreshold) {
          showModal('Eligibility Not Met', `You need ${settings.femaleExpertHeartsThreshold} hearts to become an expert! You currently have ${hearts}.`);
          return;
        }
      } else if (userProfile.gender === 'Masculine') {
        const badges = userProfile.respectBadges || 0;
        if (badges < settings.maleExpertRespectThreshold) {
          showModal('Eligibility Not Met', `You need ${settings.maleExpertRespectThreshold} respect badges to become an expert! You currently have ${badges}.`);
          return;
        }
      } else {
        showModal('Invalid Gender', 'Your profile gender is invalid.');
        return;
      }

      navigate('ExpertRoom');
    } catch (e) {
      showModal('Error', 'Could not verify eligibility.');
    }
  };

  return (
    <ScreenShell tone="light">
      <View style={styles.phone}>
        <TopBar navigate={navigate} subtitle="PRIVATE CLUB" />

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <TouchableOpacity activeOpacity={0.92} style={styles.hero} onPress={() => navigate('ExpertRoom')}>
            <Image
              source={{ uri: 'https://images.unsplash.com/photo-1519671482749-fd09be7ccebf?auto=format&fit=crop&w=900&q=90' }}
              style={styles.heroImage}
            />
            <LinearGradient
              colors={['rgba(18, 4, 14, 0.12)', 'rgba(18, 4, 14, 0.86)']}
              style={styles.heroShade}
            />
            <View style={styles.heroTop}>
              <View style={styles.livePill}>
                <View style={styles.liveDot} />
                <Text style={styles.livePillText}>LIVE NOW</Text>
              </View>
              <View style={styles.heroPrice}>
                <MaterialIcons name="diamond" size={13} color="#806606" />
                <Text style={styles.heroPriceText}>80</Text>
              </View>
            </View>
            <View style={styles.heroCopy}>
              <Text style={styles.heroLabel}>TONIGHT'S FEATURED ROOM</Text>
              <Text style={styles.heroTitle}>Velvet Lounge</Text>
              <Text style={styles.heroText}>Join premium members in a curated private room.</Text>
            </View>
          </TouchableOpacity>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
            {FILTERS.map((filter, index) => (
              <TouchableOpacity
                key={filter}
                activeOpacity={0.8}
                style={[styles.filterChip, index === 0 && styles.filterChipActive]}
              >
                <Text style={[styles.filterText, index === 0 && styles.filterTextActive]}>{filter}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={styles.sectionRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={styles.sectionTitle}>Rooms</Text>
              <Text style={styles.sectionMeta}>24 live</Text>
            </View>
            <TouchableOpacity style={styles.createBtn} onPress={handleCreateExpertRoom}>
              <MaterialIcons name="add" size={16} color="#FFF7FF" />
              <Text style={styles.createBtnText}>Create</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.roomList}>
            {ROOMS.map((room) => (
              <TouchableOpacity
                key={room.id}
                activeOpacity={0.9}
                style={styles.roomCard}
                onPress={() => navigate('ExpertRoom')}
              >
                <Image source={{ uri: room.image }} style={styles.roomImage} />
                <LinearGradient
                  colors={['rgba(18, 4, 14, 0)', 'rgba(18, 4, 14, 0.74)']}
                  style={styles.roomShade}
                />

                <View style={styles.roomTop}>
                  <View style={styles.hostRing}>
                    <Image source={{ uri: room.host }} style={styles.hostAvatar} />
                    <View style={styles.hostDot} />
                  </View>
                  <View style={styles.tierPill}>
                    <MaterialIcons name="diamond" size={11} color="#806606" />
                    <Text style={styles.tierText}>{room.tier}</Text>
                  </View>
                </View>

                <View style={styles.roomBottom}>
                  <View style={styles.roomCopy}>
                    <Text style={styles.roomTitle}>{room.title}</Text>
                    <Text style={styles.roomSubtitle}>{room.subtitle} • {room.members}</Text>
                  </View>
                  <View style={styles.joinButton}>
                    <Text style={styles.joinPrice}>{room.price}</Text>
                    <MaterialIcons name="arrow-forward" size={18} color="#FFFFFF" />
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.accessCard}>
            <View style={styles.accessIcon}>
              <MaterialIcons name="workspace-premium" size={22} color="#806606" />
            </View>
            <View style={styles.accessCopy}>
              <Text style={styles.accessTitle}>VIP entry enabled</Text>
              <Text style={styles.accessText}>Get priority room access and quieter premium tables.</Text>
            </View>
          </View>

          <View style={styles.spacer} />
        </ScrollView>

        <BottomNav active="Club" navigate={navigate} />

        <Modal
          visible={modalVisible}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalIconBox}>
                <MaterialIcons name="error-outline" size={28} color="#D1B23B" />
              </View>
              <Text style={styles.modalTitle}>{modalTitle}</Text>
              <Text style={styles.modalText}>{modalMessage}</Text>
              <TouchableOpacity style={styles.modalBtn} onPress={() => setModalVisible(false)}>
                <Text style={styles.modalBtnText}>Got it</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  phone: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 430,
    backgroundColor: 'transparent',
  },
  header: {
    height: 86,
    paddingHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#EEE4D7',
    backgroundColor: '#FFFCF7',
  },
  avatarShell: {
    width: 50,
    height: 50,
    borderRadius: 25,
    padding: 3,
    backgroundColor: '#D1B23B',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  avatar: {
    width: '100%',
    height: '100%',
    borderRadius: 22,
    borderWidth: 2,
    borderColor: '#FFFDF8',
  },
  headerTitle: {
    flex: 1,
    alignItems: 'flex-start',
    marginLeft: 12,
  },
  brand: {
    color: '#4B0054',
    fontFamily: 'serif',
    fontSize: 31,
    fontWeight: '900',
  },
  headerSub: {
    marginTop: -2,
    color: '#8A7008',
    fontSize: 9,
    fontWeight: '900',
  },
  scroll: {
    paddingTop: 18,
  },
  hero: {
    height: 238,
    marginHorizontal: 22,
    borderRadius: 26,
    overflow: 'hidden',
    backgroundColor: '#1A0716',
    borderWidth: 1,
    borderColor: '#FFFFFF',
    boxShadow: Platform.OS === 'web' ? skeuo.deepShadow : undefined,
  },
  heroImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  heroShade: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  heroTop: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  livePill: {
    height: 32,
    borderRadius: 16,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 253, 248, 0.9)',
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#5EBB62',
  },
  livePillText: {
    color: '#4B0054',
    fontSize: 10,
    fontWeight: '900',
  },
  heroPrice: {
    height: 32,
    borderRadius: 16,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFF4CB',
  },
  heroPriceText: {
    color: '#806606',
    fontSize: 12,
    fontWeight: '900',
  },
  heroCopy: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 22,
  },
  heroLabel: {
    color: '#EADCA8',
    fontSize: 10,
    fontWeight: '900',
  },
  heroTitle: {
    marginTop: 3,
    color: '#FFFDF8',
    fontFamily: 'serif',
    fontSize: 32,
    fontWeight: '900',
  },
  heroText: {
    marginTop: 5,
    width: '82%',
    color: '#F4EDE3',
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
  },
  filters: {
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 18,
    gap: 10,
  },
  filterChip: {
    height: 38,
    minWidth: 78,
    borderRadius: 19,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFDF8',
    borderWidth: 1,
    borderColor: '#EADFCF',
    boxShadow: Platform.OS === 'web' ? skeuo.insetShadow : undefined,
  },
  filterChipActive: {
    backgroundColor: '#4B0054',
    borderColor: '#4B0054',
    boxShadow: Platform.OS === 'web' ? '0 9px 18px rgba(75, 0, 84, 0.18)' : undefined,
  },
  filterText: {
    color: '#8A7C70',
    fontSize: 12,
    fontWeight: '900',
  },
  filterTextActive: {
    color: '#FFFFFF',
  },
  sectionRow: {
    paddingHorizontal: 22,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: '#4B0054',
    fontFamily: 'serif',
    fontSize: 24,
    fontWeight: '900',
  },
  sectionMeta: {
    color: '#9A7A05',
    fontSize: 12,
    fontWeight: '900',
  },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#4B0054',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    gap: 4,
  },
  createBtnText: {
    color: '#FFF7FF',
    fontSize: 12,
    fontWeight: '700',
  },
  roomList: {
    paddingHorizontal: 22,
    gap: 14,
  },
  roomCard: {
    height: 156,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#1A0716',
    borderWidth: 1,
    borderColor: '#FFFFFF',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  roomImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  roomShade: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  roomTop: {
    position: 'absolute',
    top: 13,
    left: 13,
    right: 13,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  hostRing: {
    width: 50,
    height: 50,
    borderRadius: 25,
    padding: 3,
    backgroundColor: '#D1B23B',
  },
  hostAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: 22,
    borderWidth: 2,
    borderColor: '#FFFDF8',
  },
  hostDot: {
    position: 'absolute',
    right: 4,
    bottom: 5,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#5EBB62',
    borderWidth: 2,
    borderColor: '#FFFDF8',
  },
  tierPill: {
    height: 27,
    borderRadius: 14,
    paddingHorizontal: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 244, 203, 0.94)',
  },
  tierText: {
    color: '#806606',
    fontSize: 9,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  roomBottom: {
    position: 'absolute',
    left: 16,
    right: 14,
    bottom: 14,
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  roomCopy: {
    flex: 1,
    paddingRight: 12,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(26, 7, 22, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: '#FFFCF7',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    boxShadow: Platform.OS === 'web' ? '0 20px 40px rgba(0,0,0,0.4)' : undefined,
  },
  modalIconBox: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(209, 178, 59, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    color: '#4B0054',
    fontFamily: 'serif',
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 8,
  },
  modalText: {
    color: '#8A7C70',
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  modalBtn: {
    width: '100%',
    height: 48,
    borderRadius: 24,
    backgroundColor: '#4B0054',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBtnText: {
    color: '#FFFDF8',
    fontSize: 15,
    fontWeight: '700',
  },
  roomTitle: {
    color: '#FFFDF8',
    fontFamily: 'serif',
    fontSize: 24,
    fontWeight: '900',
  },
  roomSubtitle: {
    marginTop: 3,
    color: '#EFE6DA',
    fontSize: 12,
    fontWeight: '800',
  },
  joinButton: {
    width: 62,
    height: 42,
    borderRadius: 21,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#4B0054',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    boxShadow: Platform.OS === 'web' ? '0 8px 14px rgba(75,0,84,0.22)' : undefined,
  },
  joinPrice: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  accessCard: {
    marginHorizontal: 22,
    marginTop: 18,
    minHeight: 76,
    borderRadius: 22,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF7DD',
    borderWidth: 1,
    borderColor: '#EAD691',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  accessIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFDF8',
  },
  accessCopy: {
    flex: 1,
    marginLeft: 12,
  },
  accessTitle: {
    color: '#4B0054',
    fontSize: 14,
    fontWeight: '900',
  },
  accessText: {
    marginTop: 3,
    color: '#7C7067',
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 15,
  },
  spacer: {
    height: 116,
  },
});

```


# src\screens\CoinsScreen.tsx
```tsx
import React, { useEffect, useState } from 'react';
import { Platform, ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { auth } from '../config/firebase';
import { getUserProfile, saveUserProfile } from '../services/userService';
import { getGlobalSettings, GlobalSettings } from '../services/adminService';
import { skeuo, skeuoGradients } from '../theme/skeuomorphic';
import { TextInput } from 'react-native';

type CoinsScreenProps = {
  navigation?: any;
  navigate?: (screen: string, params?: any) => void;
};

const COIN_PACKAGES = [
  { id: '1', coins: 100, price: '₹89', name: 'Handful of Coins', icon: 'monetization-on' },
  { id: '2', coins: 500, price: '₹449', name: 'Pouch of Coins', icon: 'account-balance-wallet' },
  { id: '3', coins: 1200, price: '₹899', name: 'Chest of Coins', icon: 'cases' },
  { id: '4', coins: 3000, price: '₹1799', name: 'Vault of Coins', icon: 'account-balance' },
];

export default function CoinsScreen({ navigation, navigate: directNavigate }: CoinsScreenProps) {
  const navigate = directNavigate || navigation?.navigate || (() => {});
  // Use a fallback inset if safe-area-context is missing
  const insets = { top: 40 }; 
  const [balance, setBalance] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isPurchasing, setIsPurchasing] = useState<string | null>(null);
  const [customAmount, setCustomAmount] = useState<string>('');
  const [settings, setSettings] = useState<GlobalSettings | null>(null);

  useEffect(() => {
    fetchBalance();
    getGlobalSettings().then(setSettings);
  }, []);

  const fetchBalance = async () => {
    if (!auth.currentUser) return;
    try {
      const profile = await getUserProfile(auth.currentUser.uid);
      if (profile && profile.coins !== undefined) {
        setBalance(profile.coins);
      }
    } catch (e) {
      console.warn('Could not fetch coin balance', e);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePurchase = async (pkg: typeof COIN_PACKAGES[0]) => {
    if (!auth.currentUser) return;
    setIsPurchasing(pkg.id);
    
    // Simulate network delay for purchase processing
    setTimeout(async () => {
      try {
        const profile = await getUserProfile(auth.currentUser!.uid);
        const currentBalance = profile?.coins || 0;
        const newBalance = currentBalance + pkg.coins;
        
        await saveUserProfile(auth.currentUser!.uid, { coins: newBalance });
        setBalance(newBalance);
        Alert.alert('Purchase Successful!', `You have received ${pkg.coins} coins.`);
      } catch (e) {
        Alert.alert('Purchase Failed', 'There was an error processing your transaction.');
      } finally {
        setIsPurchasing(null);
      }
    }, 1200);
  };

  const handleCustomPurchase = async () => {
    if (!auth.currentUser || !settings) return;
    
    const amountInr = Number(customAmount);
    const minAmount = settings.minRechargeAmount || 49;
    
    if (isNaN(amountInr) || amountInr < minAmount) {
      Alert.alert('Invalid Amount', `The minimum recharge amount is ₹${minAmount}.`);
      return;
    }

    setIsPurchasing('custom');
    const coinsToReceive = Math.floor(amountInr * (settings.inrToCoinRechargeRate || 1.12));

    setTimeout(async () => {
      try {
        const profile = await getUserProfile(auth.currentUser!.uid);
        const currentBalance = profile?.coins || 0;
        const newBalance = currentBalance + coinsToReceive;
        
        await saveUserProfile(auth.currentUser!.uid, { coins: newBalance });
        setBalance(newBalance);
        setCustomAmount('');
        Alert.alert('Purchase Successful!', `You have received ${coinsToReceive} coins.`);
      } catch (e) {
        Alert.alert('Purchase Failed', 'There was an error processing your transaction.');
      } finally {
        setIsPurchasing(null);
      }
    }, 1200);
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: 50 }]}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigate('Profile')}>
          <MaterialIcons name="arrow-back" size={24} color={skeuo.plum} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Store</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        
        {/* Balance Display */}
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>CURRENT BALANCE</Text>
          <View style={styles.balanceRow}>
            <View style={styles.largeCoin}>
              <LinearGradient colors={[...skeuoGradients.gold]} style={styles.largeCoinInner}>
                <MaterialIcons name="star" size={28} color="#FFFAEA" style={{ opacity: 0.8 }} />
              </LinearGradient>
            </View>
            {isLoading ? (
              <ActivityIndicator color={skeuo.gold} style={{ marginLeft: 16 }} />
            ) : (
              <Text style={styles.balanceAmount}>{balance.toLocaleString()}</Text>
            )}
          </View>
          <View style={styles.conversionBadge}>
            <MaterialIcons name="favorite" size={14} color="#D45D79" />
            <Text style={styles.conversionText}>1 Heart = 45 Coins</Text>
          </View>
        </View>

        {settings && (
          <View style={styles.customRechargeCard}>
            <Text style={styles.sectionTitle}>Custom Recharge</Text>
            <Text style={styles.customHint}>Minimum amount: ₹{settings.minRechargeAmount}</Text>
            <View style={styles.customRow}>
              <View style={styles.customInputWrapper}>
                <Text style={styles.currencySymbol}>₹</Text>
                <TextInput
                  style={styles.customInput}
                  placeholder="Enter amount"
                  keyboardType="numeric"
                  value={customAmount}
                  onChangeText={setCustomAmount}
                />
              </View>
              <TouchableOpacity 
                style={[styles.customBuyBtn, isPurchasing === 'custom' && { opacity: 0.7 }]}
                activeOpacity={0.8}
                onPress={handleCustomPurchase}
                disabled={isPurchasing !== null}
              >
                {isPurchasing === 'custom' ? (
                  <ActivityIndicator color={skeuo.plum} size="small" />
                ) : (
                  <Text style={styles.customBuyText}>Recharge</Text>
                )}
              </TouchableOpacity>
            </View>
            {Number(customAmount) > 0 && (
              <Text style={styles.customOutput}>
                You will get roughly <Text style={{fontWeight: '800', color: '#D49A0B'}}>{Math.floor(Number(customAmount) * (settings.inrToCoinRechargeRate || 1.12))} Coins</Text>
              </Text>
            )}
          </View>
        )}

        <Text style={styles.sectionTitle}>Coin Packages</Text>

        {/* Packages Grid */}
        <View style={styles.packagesContainer}>
          {COIN_PACKAGES.map((pkg) => (
            <TouchableOpacity 
              key={pkg.id} 
              style={styles.packageCard} 
              activeOpacity={0.8}
              onPress={() => handlePurchase(pkg)}
              disabled={isPurchasing !== null}
            >
              <View style={styles.packageIconFrame}>
                <MaterialIcons name={pkg.icon as any} size={32} color={skeuo.gold} />
              </View>
              <View style={styles.packageInfo}>
                <Text style={styles.packageCoins}>{pkg.coins.toLocaleString()} Coins</Text>
                <Text style={styles.packageName}>{pkg.name}</Text>
              </View>
              <View style={styles.priceButton}>
                {isPurchasing === pkg.id ? (
                  <ActivityIndicator color={skeuo.plum} size="small" />
                ) : (
                  <Text style={styles.priceText}>{pkg.price}</Text>
                )}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: skeuo.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: skeuo.surfaceRaised,
    borderBottomWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
    zIndex: 10,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: skeuo.surfaceRaised,
    borderWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '900',
    fontFamily: 'serif',
    color: skeuo.plum,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 30,
    paddingBottom: 60,
  },
  balanceCard: {
    backgroundColor: skeuo.surfaceRaised,
    borderRadius: 32,
    padding: 30,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? skeuo.deepShadow : undefined,
    marginBottom: 40,
  },
  balanceLabel: {
    color: '#9A8772',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 2,
    marginBottom: 20,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  largeCoin: {
    width: 64,
    height: 64,
    borderRadius: 32,
    padding: 3,
    backgroundColor: '#FFE699',
    boxShadow: Platform.OS === 'web' ? skeuo.goldShadow : undefined,
    marginRight: 16,
  },
  largeCoinInner: {
    flex: 1,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFAEA',
  },
  balanceAmount: {
    fontSize: 54,
    fontWeight: '900',
    color: skeuo.plum,
    fontVariant: ['tabular-nums'],
    letterSpacing: -1,
  },
  conversionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF5F7',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F9E1E6',
    gap: 6,
  },
  conversionText: {
    color: '#B0415D',
    fontSize: 12,
    fontWeight: '800',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: skeuo.plum,
    marginLeft: 4,
    marginBottom: 16,
    fontFamily: 'serif'
  },
  customRechargeCard: {
    marginBottom: 24,
    backgroundColor: '#FFF',
    padding: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#EAD8A9',
    boxShadow: Platform.OS === 'web' ? '0 4px 12px rgba(68, 44, 21, 0.05)' : undefined,
  },
  customHint: { fontSize: 13, color: '#8F8491', fontWeight: '600', marginBottom: 12 },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  customInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8F5F0',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D4C9BD',
    paddingHorizontal: 16,
    height: 52,
  },
  currencySymbol: { fontSize: 18, fontWeight: '700', color: '#4B0054', marginRight: 8 },
  customInput: { flex: 1, fontSize: 18, fontWeight: '700', color: '#4B0054' },
  customBuyBtn: {
    backgroundColor: '#EAD8A9',
    height: 52,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#C3A042',
  },
  customBuyText: { fontSize: 16, fontWeight: '800', color: '#4B0054' },
  customOutput: { fontSize: 14, color: '#4B0054', marginTop: 12, fontWeight: '600' },
  packagesContainer: {
    gap: 16,
  },
  packageCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: skeuo.surfaceRaised,
    borderRadius: 24,
    padding: 16,
    borderWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  packageIconFrame: {
    width: 60,
    height: 60,
    borderRadius: 20,
    backgroundColor: '#F0E5D4',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? skeuo.insetShadow : undefined,
  },
  packageInfo: {
    flex: 1,
    marginLeft: 16,
    justifyContent: 'center',
  },
  packageCoins: {
    fontSize: 18,
    fontWeight: '900',
    color: skeuo.plum,
    marginBottom: 4,
  },
  packageName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9A8772',
  },
  priceButton: {
    backgroundColor: '#F0E5D4',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
    minWidth: 80,
    alignItems: 'center',
  },
  priceText: {
    color: skeuo.plum,
    fontWeight: '900',
    fontSize: 14,
  },
});

```


# src\screens\CreatePasswordScreen.tsx
```tsx
import React, { useState } from 'react';
import { Platform, View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import ScreenShell from '../components/ScreenShell';
import { skeuo } from '../theme/skeuomorphic';
import { auth, db } from '../config/firebase';
import { signInWithCustomToken } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';

export default function CreatePasswordScreen({ navigate, goBack, route }: any) {
  const { params } = route || {};
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleSignUp = async () => {
    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match');
      return;
    }

    setIsLoading(true);
    setErrorMsg('');

    try {
      // 1. Log the user in with the custom token we generated earlier
      const userCredential = await signInWithCustomToken(auth, params.token);
      const user = userCredential.user;

      // 2. Create the Firestore user document
      const userRef = doc(db, 'users', user.uid);
      await setDoc(userRef, {
        phoneNumber: params.phone,
        username: params.name,
        nickname: params.nickname || params.name,
        age: params.dob,
        gender: params.gender,
        country: params.country || '',
        state: params.state || '',
        city: params.city || '',
        language: params.language || '',
        avatar3dUrl: 'CUSTOM_BUILDER_AVATAR',
        avatarData: params.avatar,
        password: password, // Note: In a real app, hash this or use proper providers.
        coins: 0,
        createdAt: new Date().toISOString(),
      });

      // App.tsx onAuthStateChanged will detect the login and route to Home!
    } catch (error: any) {
      setErrorMsg(error.message || 'Failed to create account');
      setIsLoading(false);
    }
  };

  return (
    <ScreenShell tone="light">
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={goBack} style={styles.backBtn}>
            <MaterialIcons name="arrow-back" size={24} color="#5A155A" />
          </TouchableOpacity>
        </View>

        <Text style={styles.title}>Secure Your Account</Text>
        <Text style={styles.subtitle}>Create a password to access your GenGal account later.</Text>

        <View style={[styles.inputContainer, { flexDirection: 'row', alignItems: 'center' }]}>
          <TextInput
            style={[styles.input, { flex: 1, marginBottom: 0 }]}
            placeholder="Enter Password"
            placeholderTextColor="#A0A0A0"
            secureTextEntry={!isPasswordVisible}
            value={password}
            onChangeText={setPassword}
          />
          <TouchableOpacity onPress={() => setIsPasswordVisible(!isPasswordVisible)} style={{ position: 'absolute', right: 15 }}>
            <MaterialIcons name={isPasswordVisible ? "visibility" : "visibility-off"} size={22} color="#A0A0A0" />
          </TouchableOpacity>
        </View>
        <View style={[styles.inputContainer, { flexDirection: 'row', alignItems: 'center' }]}>
          <TextInput
            style={[styles.input, { flex: 1, marginBottom: 0 }]}
            placeholder="Confirm Password"
            placeholderTextColor="#A0A0A0"
            secureTextEntry={!isPasswordVisible}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
          />
        </View>

        {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}

        <TouchableOpacity 
          style={[styles.signupBtn, isLoading && { opacity: 0.7 }]} 
          onPress={handleSignUp}
          disabled={isLoading}
        >
          <LinearGradient
            colors={['#5A155A', '#2D0A2D']}
            style={styles.btnGradient}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.signupText}>Complete Sign Up</Text>
            )}
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 60,
  },
  headerRow: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FAF5EE',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#5A155A',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#5A155A',
    opacity: 0.8,
    marginBottom: 30,
  },
  inputContainer: {
    backgroundColor: '#FAF5EE',
    borderRadius: 16,
    marginBottom: 16,
    paddingHorizontal: 16,
    height: 56,
    justifyContent: 'center',
    boxShadow: Platform.OS === 'web' ? skeuo.insetShadow : undefined,
  },
  input: {
    fontSize: 16,
    color: '#5A155A',
    height: '100%',
  },
  errorText: {
    color: '#ef4444',
    marginBottom: 16,
    textAlign: 'center',
  },
  signupBtn: {
    borderRadius: 16,
    overflow: 'hidden',
    marginTop: 20,
  },
  btnGradient: {
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
  },
  signupText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
});

```


# src\screens\EarningsScreen.tsx
```tsx
import React, { useEffect, useState } from 'react';
import { Platform, View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import ScreenShell from '../components/ScreenShell';
import { skeuo } from '../theme/skeuomorphic';
import { auth, db } from '../config/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { getGlobalSettings, GlobalSettings } from '../services/adminService';
import { LinearGradient } from 'expo-linear-gradient';

export default function EarningsScreen({ navigate }: any) {
  const [profile, setProfile] = useState<any>(null);
  const [settings, setSettings] = useState<GlobalSettings | null>(null);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;

    // Listen to profile
    const unsub = onSnapshot(doc(db, 'users', user.uid), (doc) => {
      if (doc.exists()) {
        setProfile(doc.data());
      }
    });

    getGlobalSettings().then(setSettings);

    return unsub;
  }, []);

  const handleWithdraw = () => {
    Alert.alert('Success', 'Withdrawal request sent to admin! It will be processed within 24 hours.');
  };

  const hearts = profile?.hearts || 0;
  const rate = settings?.heartToInrRate || 3;
  const earnings = hearts * rate;
  
  const totalSeconds = profile?.totalReceivedCallSeconds || 0;
  const totalMinutes = Math.floor(totalSeconds / 60);

  const unrewarded = profile?.unrewardedCallSeconds || 0;
  const targetSeconds = (settings?.callDurationForHeart || 3) * 60;
  const progressPercent = Math.min((unrewarded / targetSeconds) * 100, 100);

  const canWithdraw = hearts >= 33;

  return (
    <ScreenShell>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => navigate('Profile')}>
            <MaterialIcons name="arrow-back" size={24} color="#4B0054" />
          </TouchableOpacity>
          <Text style={styles.title}>Earnings Dashboard</Text>
          <View style={{ width: 44 }} />
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          
          <View style={styles.heroCard}>
            <LinearGradient
              colors={['#E5C558', '#C39A26']}
              style={[StyleSheet.absoluteFill, { borderRadius: 16 }]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            />
            <Text style={styles.heroLabel}>Total Balance</Text>
            <Text style={styles.heroAmount}>₹{earnings.toFixed(2)}</Text>
            <View style={styles.heroRow}>
              <View style={styles.heroChip}>
                <MaterialIcons name="favorite" size={16} color="#4B0054" />
                <Text style={styles.heroChipText}>{hearts} Hearts</Text>
              </View>
              <Text style={styles.heroRate}>(1 Heart = ₹{rate})</Text>
            </View>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <MaterialIcons name="timer" size={28} color="#C39A26" />
              <Text style={styles.statValue}>{totalMinutes}m</Text>
              <Text style={styles.statLabel}>Talk Time</Text>
            </View>
            <View style={styles.statBox}>
              <MaterialIcons name="call-received" size={28} color="#C39A26" />
              <Text style={styles.statValue}>-</Text>
              <Text style={styles.statLabel}>Received</Text>
            </View>
          </View>

          <View style={styles.progressCard}>
            <View style={styles.progressHeader}>
              <MaterialIcons name="auto-awesome" size={20} color="#4B0054" />
              <Text style={styles.progressTitle}>Next Heart Progress</Text>
            </View>
            <Text style={styles.progressText}>
              You have spoken for {unrewarded} out of {targetSeconds} seconds required for your next Heart!
            </Text>
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { width: `${progressPercent}%` }]} />
            </View>
            <Text style={styles.progressPercent}>{Math.round(progressPercent)}%</Text>
          </View>

          <View style={styles.withdrawCard}>
            <Text style={styles.withdrawTitle}>Withdraw Funds</Text>
            <Text style={styles.withdrawDesc}>Minimum withdrawal amount is ₹99 (33 Hearts). Funds are transferred directly to your UPI ID or Bank Account.</Text>
            
            <TouchableOpacity 
              style={[styles.withdrawBtn, !canWithdraw && styles.withdrawBtnDisabled]} 
              activeOpacity={0.8}
              onPress={handleWithdraw}
              disabled={!canWithdraw}
            >
              <Text style={styles.withdrawBtnText}>Withdraw ₹{earnings.toFixed(2)}</Text>
            </TouchableOpacity>

            {!canWithdraw && (
              <Text style={styles.shortfallText}>You need {33 - hearts} more hearts to withdraw.</Text>
            )}
          </View>

        </ScrollView>
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFDF8', width: '100%', maxWidth: 430, alignSelf: 'center' },
  header: { height: 72, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#EAD8A9' },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '900', color: '#4A0049' },
  content: { padding: 24, paddingBottom: 60 },
  
  heroCard: {
    padding: 24,
    borderRadius: 16,
    marginBottom: 20,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
    alignItems: 'center',
    position: 'relative'
  },
  heroLabel: { fontSize: 16, color: '#4B0054', fontWeight: '700', marginBottom: 8, opacity: 0.8 },
  heroAmount: { fontSize: 48, fontWeight: '900', color: '#4B0054', marginBottom: 16, letterSpacing: -1 },
  heroRow: { flexDirection: 'row', alignItems: 'center' },
  heroChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFDF8', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  heroChipText: { fontSize: 14, fontWeight: '800', color: '#4B0054', marginLeft: 4 },
  heroRate: { fontSize: 13, color: '#4B0054', fontWeight: '600', marginLeft: 12, opacity: 0.8 },

  statsRow: { flexDirection: 'row', gap: 16, marginBottom: 20 },
  statBox: { flex: 1, backgroundColor: '#FFF', borderRadius: 16, padding: 20, alignItems: 'center', borderWidth: 1, borderColor: '#EAD8A9', boxShadow: Platform.OS === 'web' ? '0 4px 12px rgba(68, 44, 21, 0.05)' : undefined },
  statValue: { fontSize: 24, fontWeight: '900', color: '#4B0054', marginTop: 8, marginBottom: 4 },
  statLabel: { fontSize: 13, color: '#8F8491', fontWeight: '600' },

  progressCard: {
    backgroundColor: '#FFF', borderRadius: 16, padding: 20, marginBottom: 20, borderWidth: 1, borderColor: '#EAD8A9', boxShadow: Platform.OS === 'web' ? '0 4px 12px rgba(68, 44, 21, 0.05)' : undefined
  },
  progressHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  progressTitle: { fontSize: 16, fontWeight: '800', color: '#4A0049', marginLeft: 8 },
  progressText: { fontSize: 14, color: '#8F8491', lineHeight: 20, marginBottom: 16 },
  progressBarBg: { height: 12, backgroundColor: '#F0EAD6', borderRadius: 6, overflow: 'hidden', marginBottom: 8 },
  progressBarFill: { height: '100%', backgroundColor: '#D3B742', borderRadius: 6 },
  progressPercent: { fontSize: 12, fontWeight: '700', color: '#4B0054', textAlign: 'right' },

  withdrawCard: {
    backgroundColor: '#F8F5F0', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#EAD8A9'
  },
  withdrawTitle: { fontSize: 18, fontWeight: '900', color: '#4A0049', marginBottom: 8 },
  withdrawDesc: { fontSize: 14, color: '#8A7C70', lineHeight: 20, marginBottom: 20 },
  withdrawBtn: { height: 56, backgroundColor: '#4B0054', borderRadius: 12, alignItems: 'center', justifyContent: 'center', boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined },
  withdrawBtnDisabled: { backgroundColor: '#A692A8', boxShadow: undefined, opacity: 0.8 },
  withdrawBtnText: { color: '#FFFDF8', fontSize: 16, fontWeight: '900' },
  shortfallText: { fontSize: 13, color: '#B3261E', textAlign: 'center', marginTop: 12, fontWeight: '600' }
});

```


# src\screens\ExpertRoomScreen.tsx
```tsx
import React from 'react';
import { Platform, Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View, } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { MaterialIcons } from '@expo/vector-icons';
import ScreenShell from '../components/ScreenShell';
import TopBar from '../components/TopBar';
import BottomNav from '../components/BottomNav';
import DiamondBadge from '../components/DiamondBadge';
import { skeuo } from '../theme/skeuomorphic';

const WAITERS = [
  {
    name: 'Maya',
    message: 'sent a Golden Heart',
    avatar: 'https://images.unsplash.com/photo-1531123897727-8f129e1688ce?auto=format&fit=crop&crop=faces&w=140&h=140&q=90',
    gift: require('../../assets/heart.png'),
  },
  {
    name: 'Arun',
    message: 'joined waitlist',
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&crop=faces&w=140&h=140&q=90',
  },
  {
    name: 'Leah',
    message: 'sent Rare Essence',
    avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&crop=faces&w=140&h=140&q=90',
    gift: require('../../assets/perfume.png'),
  },
];

const GIFTS = [
  { icon: 'view-module' as const, name: 'Sticker 1', price: 50 },
  { icon: 'diamond' as const, name: 'Sticker 2', price: 100 },
  { icon: 'celebration' as const, name: 'Sticker 3', price: 500 },
];

export default function ExpertRoomScreen({ navigate }: { navigate: (screen: string) => void }) {
  return (
    <ScreenShell tone="light">
      <View style={styles.phone}>
        <TopBar navigate={navigate} subtitle="EXPERT ROOM" />

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.expertBlock}>
            <View style={styles.expertRing}>
              <Image
                source={{ uri: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&crop=faces&w=180&h=180&q=90' }}
                style={styles.expertImage}
              />
              <View style={styles.hostBadge}>
                <Text style={styles.hostBadgeText}>HOST</Text>
              </View>
            </View>
          </View>

          <View style={styles.matchRow}>
            <View style={styles.matchPerson}>
              <View style={styles.activeRing}>
                <Image
                  source={{ uri: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&crop=faces&w=220&h=220&q=90' }}
                  style={styles.matchImage}
                />
                <View style={styles.onlineDot} />
              </View>
              <Text style={styles.activeName}>Sophia</Text>
              <Text style={styles.activeStatus}>Matching...</Text>
            </View>

            <View style={styles.centerHeart}>
              <MaterialIcons name="favorite" size={19} color="#806606" />
            </View>

            <View style={styles.matchPerson}>
              <View style={styles.nextRing}>
                <Image
                  source={{ uri: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&crop=faces&w=220&h=220&q=90' }}
                  style={[styles.matchImage, styles.nextImage]}
                />
              </View>
              <Text style={styles.nextName}>Julian</Text>
              <Text style={styles.nextStatus}>Next in line</Text>
            </View>
          </View>

          <View style={styles.middleRow}>
            <View style={styles.waitlist}>
              <Text style={styles.waitTitle}>WAITERS</Text>
              {WAITERS.map((waiter) => (
                <View key={waiter.name} style={styles.commentRow}>
                  <Image source={{ uri: waiter.avatar }} style={styles.commentAvatar} />
                  <View style={styles.commentBubble}>
                    <Text style={styles.commentName}>{waiter.name}</Text>
                    <Text style={styles.commentText}>{waiter.message}</Text>
                  </View>
                  {waiter.gift ? (
                    <View style={styles.commentGift}>
                      <Image source={waiter.gift} style={styles.commentGiftImage} />
                    </View>
                  ) : (
                    <View style={styles.commentCoin}>
                      <MaterialIcons name="monetization-on" size={12} color="#FFFFFF" />
                    </View>
                  )}
                </View>
              ))}
            </View>

            <View style={styles.actions}>
              <TouchableOpacity activeOpacity={0.86} style={styles.directJoin}>
                <Text style={styles.directText}>DIRECT JOIN</Text>
                <View style={styles.directSubRow}>
                  <Text style={styles.directSub}>60</Text>
                  <MaterialIcons name="monetization-on" size={11} color="#9A7604" />
                  <Text style={styles.directSub}>/min</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity activeOpacity={0.82} style={styles.waitButton}>
                <Text style={styles.waitButtonText}>JOIN WAITLIST</Text>
              </TouchableOpacity>
            </View>
          </View>

          <Text style={styles.giftsLabel}>SEND PREMIUM GIFTS</Text>
          <View style={styles.giftsRow}>
            {GIFTS.map((gift) => (
              <TouchableOpacity key={gift.name} activeOpacity={0.85} style={styles.giftTile}>
                <MaterialIcons name={gift.icon} size={36} color="#4B0054" />
                <Text style={styles.giftName}>{gift.name}</Text>
                <View style={styles.giftPrice}>
                  <MaterialIcons name="account-balance" size={16} color="#F4A23A" />
                  <Text style={styles.giftPriceText}>{gift.price}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.spacer} />
        </ScrollView>

        <BottomNav active="Club" navigate={navigate} />
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  phone: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 430,
    backgroundColor: 'transparent',
  },
  header: {
    height: 64,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFCF7',
    borderBottomWidth: 1,
    borderBottomColor: '#EEE5DA',
    boxShadow: Platform.OS === 'web' ? '0 8px 18px rgba(83, 58, 29, 0.08)' : undefined,
  },
  profileMini: {
    width: 36,
    height: 36,
    borderRadius: 18,
    padding: 2,
    backgroundColor: '#D1B23B',
  },
  profileMiniImage: {
    width: '100%',
    height: '100%',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#FFFDF8',
  },
  headerCopy: {
    flex: 1,
    paddingLeft: 12,
  },
  headerKicker: {
    color: '#8A7008',
    fontSize: 8.5,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  headerBrand: {
    marginTop: -1,
    color: '#4B0054',
    fontFamily: 'serif',
    fontSize: 23,
    fontWeight: '900',
  },
  coinPill: {
    height: 42,
    minWidth: 94,
    borderRadius: 21,
    paddingHorizontal: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFFDF8',
    borderWidth: 1,
    borderColor: '#FFFFFF',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  coinAmount: {
    color: '#7F6808',
    fontSize: 14,
    fontWeight: '900',
  },
  coinIcon: {
    width: 21,
    height: 21,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F2A13A',
  },
  scroll: {
    paddingHorizontal: 26,
    paddingTop: 9,
  },
  expertBlock: {
    alignItems: 'center',
  },
  expertRing: {
    width: 68,
    height: 68,
    borderRadius: 34,
    padding: 3,
    backgroundColor: '#D1B23B',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  expertImage: {
    width: '100%',
    height: '100%',
    borderRadius: 31,
    borderWidth: 2,
    borderColor: '#FFFDF8',
  },
  hostBadge: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: -7,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4B0054',
  },
  hostBadgeText: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: '900',
  },
  matchRow: {
    marginTop: 10,
    minHeight: 132,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: 24,
  },
  matchPerson: {
    width: 98,
    alignItems: 'center',
  },
  activeRing: {
    width: 86,
    height: 86,
    borderRadius: 43,
    padding: 4,
    backgroundColor: '#D1B23B',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  nextRing: {
    width: 82,
    height: 82,
    borderRadius: 41,
    padding: 4,
    backgroundColor: '#DDD7CF',
  },
  matchImage: {
    width: '100%',
    height: '100%',
    borderRadius: 39,
    borderWidth: 2,
    borderColor: '#FFFDF8',
  },
  nextImage: {
    opacity: 0.55,
  },
  onlineDot: {
    position: 'absolute',
    top: 7,
    right: 4,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#39BE69',
    borderWidth: 2,
    borderColor: '#FFFDF8',
  },
  centerHeart: {
    width: 26,
    height: 26,
    marginTop: 31,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF4CB',
    borderWidth: 1,
    borderColor: '#E2C75C',
    boxShadow: Platform.OS === 'web' ? '0 6px 12px rgba(128, 102, 6, 0.16)' : undefined,
  },
  activeName: {
    marginTop: 5,
    color: '#4B0054',
    fontFamily: 'serif',
    fontSize: 19,
    fontWeight: '900',
    lineHeight: 23,
  },
  activeStatus: {
    marginTop: -3,
    color: '#4B0054',
    fontSize: 10,
    fontWeight: '800',
  },
  nextName: {
    marginTop: 5,
    color: '#A19891',
    fontFamily: 'serif',
    fontSize: 19,
    fontWeight: '900',
    lineHeight: 23,
  },
  nextStatus: {
    marginTop: -3,
    color: '#A19891',
    fontSize: 10,
    fontWeight: '800',
  },
  middleRow: {
    marginTop: -2,
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  waitlist: {
    width: 146,
    minHeight: 132,
    borderRadius: 16,
    paddingHorizontal: 9,
    paddingVertical: 9,
    backgroundColor: 'rgba(255, 253, 248, 0.56)',
    borderWidth: 1,
    borderColor: 'rgba(234, 223, 207, 0.72)',
    boxShadow: Platform.OS === 'web' ? skeuo.insetShadow : undefined,
  },
  waitTitle: {
    marginBottom: 7,
    color: '#7F7068',
    fontSize: 8.5,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  commentRow: {
    minHeight: 34,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  commentAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#FFFDF8',
  },
  commentBubble: {
    flex: 1,
    marginLeft: 6,
  },
  commentName: {
    color: '#4B0054',
    fontSize: 10.5,
    fontWeight: '900',
    lineHeight: 13,
  },
  commentText: {
    color: '#8D8179',
    fontSize: 7.5,
    fontWeight: '700',
    lineHeight: 10,
  },
  commentGift: {
    width: 17,
    height: 17,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF4CB',
  },
  commentGiftImage: {
    width: 12,
    height: 12,
  },
  commentCoin: {
    width: 17,
    height: 17,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3B13E',
  },
  actions: {
    flex: 1,
    gap: 14,
    justifyContent: 'center',
  },
  directJoin: {
    height: 58,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#B99916',
    boxShadow: Platform.OS === 'web' ? skeuo.goldShadow : undefined,
  },
  directText: {
    color: '#765F04',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 4,
    lineHeight: 18,
  },
  directSubRow: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  directSub: {
    color: '#7E6908',
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 15,
  },
  waitButton: {
    height: 50,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8F5EF',
    borderWidth: 1,
    borderColor: '#EEE4D8',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  waitButtonText: {
    color: '#4B0054',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 3.6,
  },
  giftsLabel: {
    marginTop: 16,
    marginBottom: 10,
    color: '#4B0054',
    fontSize: 9.5,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  giftsRow: {
    flexDirection: 'row',
    gap: 14,
  },
  giftTile: {
    flex: 1,
    height: 132,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFDF8',
    borderWidth: 1,
    borderColor: '#EEE4D8',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  giftName: {
    marginTop: 24,
    color: '#3D3441',
    fontSize: 17,
    fontWeight: '400',
    lineHeight: 21,
  },
  giftPrice: {
    marginTop: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  giftPriceText: {
    color: '#806806',
    fontSize: 23,
    fontWeight: '900',
    lineHeight: 27,
  },
  spacer: {
    height: 132,
  },
});

```


# src\screens\FinalizeInviteScreen.tsx
```tsx
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
  StatusBar,
  Pressable,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { collection, getDocs, query, where } from 'firebase/firestore';
import DiamondBadge from '../components/DiamondBadge';
import GengalAvatar, { AvatarData, DEFAULT_AVATAR_DNA } from '../components/GengalAvatar';
import { auth, db } from '../config/firebase';
import { getUserProfile, saveUserProfile } from '../services/userService';
import { skeuo, skeuoGradients } from '../theme/skeuomorphic';

type FinalizeInviteScreenProps = {
  navigation?: any;
  navigate?: (screen: string, params?: any) => void;
};

type BuilderCategory = 'hair' | 'face' | 'style' | 'accessory';

const HAIR_MEN: Partial<AvatarData>[] = [
  { topType: 'shortWaved' },
  { topType: 'shortCurly' },
  { topType: 'shortFlat' },
  { topType: 'shortRound' },
  { topType: 'sides' },
  { topType: 'dreads01' },
  { topType: 'dreads02' },
  { topType: 'frizzle' },
  { topType: 'shaggy' },
  { topType: 'shaggyMullet' },
  { topType: 'shavedHead' },
];
const HAIR_WOMEN: Partial<AvatarData>[] = [
  { topType: 'longButNotTooLong' },
  { topType: 'straight02' },
  { topType: 'curly' },
  { topType: 'bun' },
  { topType: 'straightAndStrand' },
  { topType: 'straight01' },
  { topType: 'bigHair' },
  { topType: 'bob' },
  { topType: 'curvy' },
  { topType: 'dreads' },
  { topType: 'frida' },
  { topType: 'fro' },
  { topType: 'froBand' },
  { topType: 'miaWallace' },
];

const FACE_MEN: Partial<AvatarData>[] = [
  { facialHairType: 'beardMedium', mouthType: 'serious', eyebrowType: 'default', eyeType: 'default' },
  { facialHairType: 'beardLight', mouthType: 'smile', eyebrowType: 'raisedExcited', eyeType: 'happy' },
  { facialHairType: 'beardMajestic', mouthType: 'twinkle', eyebrowType: 'defaultNatural', eyeType: 'wink' },
  { facialHairType: 'moustaceFancy', mouthType: 'smile', eyebrowType: 'default', eyeType: 'side' },
  { facialHairType: 'moustacheMagnum', mouthType: 'serious', eyebrowType: 'flatNatural', eyeType: 'squint' },
  { facialHairType: 'none', mouthType: 'smirk', eyebrowType: 'upDown', eyeType: 'winkWacky' },
  { facialHairType: 'beardLight', mouthType: 'grimace', eyebrowType: 'angry', eyeType: 'eyeRoll' },
  { facialHairType: 'none', mouthType: 'eating', eyebrowType: 'default', eyeType: 'surprised' },
  { facialHairType: 'beardMedium', mouthType: 'sad', eyebrowType: 'sadConcerned', eyeType: 'cry' },
];
const FACE_WOMEN: Partial<AvatarData>[] = [
  { facialHairType: 'none', mouthType: 'smile', eyeType: 'happy', eyebrowType: 'defaultNatural' },
  { facialHairType: 'none', mouthType: 'twinkle', eyeType: 'wink', eyebrowType: 'raisedExcited' },
  { facialHairType: 'none', mouthType: 'eating', eyeType: 'squint', eyebrowType: 'default' },
  { facialHairType: 'none', mouthType: 'tongue', eyeType: 'surprised', eyebrowType: 'raisedExcitedNatural' },
  { facialHairType: 'none', mouthType: 'serious', eyeType: 'default', eyebrowType: 'flatNatural' },
  { facialHairType: 'none', mouthType: 'smirk', eyeType: 'side', eyebrowType: 'upDownNatural' },
  { facialHairType: 'none', mouthType: 'screamOpen', eyeType: 'dizzy', eyebrowType: 'angryNatural' },
  { facialHairType: 'none', mouthType: 'disbelief', eyeType: 'eyeRoll', eyebrowType: 'frownNatural' },
  { facialHairType: 'none', mouthType: 'default', eyeType: 'hearts', eyebrowType: 'defaultNatural' },
];

const CLOTHING_MEN: Partial<AvatarData>[] = [
  { clotheType: 'blazerAndShirt' },
  { clotheType: 'shirtCrewNeck' },
  { clotheType: 'shirtVNeck' },
  { clotheType: 'shirtScoopNeck' },
  { clotheType: 'hoodie' },
  { clotheType: 'overall' },
];
const CLOTHING_WOMEN: Partial<AvatarData>[] = [
  { clotheType: 'blazerAndSweater' },
  { clotheType: 'shirtScoopNeck' },
  { clotheType: 'shirtVNeck' },
  { clotheType: 'shirtCrewNeck' },
  { clotheType: 'hoodie' },
  { clotheType: 'overall' },
];

const EXTRAS_EYEWEAR: Partial<AvatarData>[] = [
  { accessoriesType: 'none' },
  { accessoriesType: 'sunglasses' },
  { accessoriesType: 'prescription01' },
  { accessoriesType: 'prescription02' },
  { accessoriesType: 'round' },
  { accessoriesType: 'wayfarers' },
  { accessoriesType: 'kurt' },
  { accessoriesType: 'eyepatch' },
];

const HEADWEAR_MEN: Partial<AvatarData>[] = [
  { topType: 'hat' },
  { topType: 'turban' },
  { topType: 'winterHat1' },
];

const HEADWEAR_WOMEN: Partial<AvatarData>[] = [
  { topType: 'hat' },
  { topType: 'hijab' },
  { topType: 'winterHat1' },
];

const SKIN_OPTIONS = ['light', 'tanned', 'brown', 'dark', 'black'];
const HAIR_COLOR_OPTIONS = ['black', 'brownDark', 'blonde', 'red', 'silverGray'];
const CLOTHING_COLOR_OPTIONS = ['black', 'gray01', 'blue02', 'pastelBlue', 'pastelGreen', 'pastelRed', 'pink'];
const BG_COLOR_OPTIONS = ['#E2E8F0', '#FFD1DC', '#FFDFBA', '#FFFFBA', '#BAFFC9', '#BAE1FF', '#E6B3FF', '#FFE4E1'];

const getSkinHex = (color: string) => {
  const map: any = { light: '#edb98a', tanned: '#d08b5b', brown: '#ae5d29', dark: '#614335', black: '#2d1e16' };
  return map[color] || '#edb98a';
};
const getHairHex = (color: string) => {
  const map: any = { black: '#2c1b18', brownDark: '#4a3123', blonde: '#d6b370', red: '#ca4420', silverGray: '#e8e8e8' };
  return map[color] || '#2c1b18';
};
const getClothingHex = (color: string) => {
  const map: any = { black: '#262e33', gray01: '#e6e6e6', blue02: '#3c4f5c', pastelBlue: '#b1e2ff', pastelGreen: '#a7ffc4', pastelRed: '#ffafb9', pink: '#ff488e' };
  return map[color] || '#262e33';
};

const CATEGORY_LABELS: Record<BuilderCategory, string> = {
  hair: 'Hair',
  face: 'Face',
  style: 'Clothing',
  accessory: 'Accessories',
};

function BuilderTab({
  icon,
  label,
  active,
  onPress,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.builderTab} activeOpacity={0.82} onPress={onPress}>
      <MaterialIcons name={icon} size={25} color={active ? skeuo.plum : '#9A8772'} />
      <Text style={[styles.builderTabLabel, active && styles.builderTabLabelActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function AvatarOption({
  data,
  selected,
  onPress,
}: {
  data: AvatarData;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.avatarOption, selected && styles.avatarOptionActive]} onPress={onPress}>
      {({ pressed }) => (
        <View style={[styles.avatarOptionInnerContainer, pressed && { transform: [{ translateY: 2 }], boxShadow: 'none' }]}>
          <GengalAvatar data={data} size={86} />
        </View>
      )}
    </Pressable>
  );
}

export default function FinalizeInviteScreen({ navigation, navigate: directNavigate, route }: any) {
  const { height } = useWindowDimensions();
  const navigate = directNavigate || navigation?.navigate || (() => {});
  const { params } = route || {};
  const [builderCategory, setBuilderCategory] = useState<BuilderCategory>('hair');
  
  const [effectiveGender, setEffectiveGender] = useState<'Masculine' | 'Feminine'>(() => {
    if (params?.gender) {
      if (Platform.OS === 'web') {
        try { sessionStorage.setItem('draft_gender', params.gender); } catch (e) {}
      }
      return params.gender;
    }
    if (Platform.OS === 'web') {
      try { return (sessionStorage.getItem('draft_gender') as any) || 'Masculine'; } catch (e) {}
    }
    return 'Masculine';
  });

  useEffect(() => {
    if (params?.gender && params.gender !== effectiveGender) {
      setEffectiveGender(params.gender);
      if (Platform.OS === 'web') {
        try { sessionStorage.setItem('draft_gender', params.gender); } catch (e) {}
      }
    }
  }, [params?.gender]);
  
  const isFem = effectiveGender === 'Feminine';
  const isMasc = !isFem;

  const getInitialAvatar = (masc: boolean): AvatarData => {
    if (params?.isEditMode && params?.existingAvatarData) {
      return params.existingAvatarData;
    }
    return masc 
      ? { ...DEFAULT_AVATAR_DNA, topType: 'shortWaved', clotheType: 'shirtCrewNeck', facialHairType: 'beardLight', isPremiumConfig: true }
      : { ...DEFAULT_AVATAR_DNA, topType: 'longButNotTooLong', clotheType: 'shirtScoopNeck', facialHairType: 'none', isPremiumConfig: true };
  };

  const [avatarData, setAvatarData] = useState<AvatarData>(getInitialAvatar(isMasc));

  useEffect(() => {
    setAvatarData(getInitialAvatar(effectiveGender === 'Masculine'));
  }, [effectiveGender]);
  const isExpandedRef = useRef(false);
  const EXPAND_OFFSET = 240;
  const sheetTranslateY = useRef(new Animated.Value(EXPAND_OFFSET)).current;

  const sheetPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_, gestureState) => {
        let newY = isExpandedRef.current ? gestureState.dy : EXPAND_OFFSET + gestureState.dy;
        if (newY < 0) newY = 0;
        if (newY > EXPAND_OFFSET) newY = EXPAND_OFFSET;
        sheetTranslateY.setValue(newY);
      },
      onPanResponderRelease: (_, gestureState) => {
        if (Math.abs(gestureState.dy) < 8) {
          toggleSheet(!isExpandedRef.current);
          return;
        }
        if (gestureState.vy > 0.5 || gestureState.dy > EXPAND_OFFSET / 2) {
          toggleSheet(false);
        } else {
          toggleSheet(true);
        }
      },
    })
  ).current;

  const toggleSheet = (expand: boolean) => {
    isExpandedRef.current = expand;
    Animated.spring(sheetTranslateY, {
      toValue: expand ? 0 : EXPAND_OFFSET,
      useNativeDriver: false,
      bounciness: 4,
    }).start();
  };

  const updateAvatar = (patch: Partial<AvatarData>) => {
    setAvatarData((current) => ({ ...current, ...patch, isPremiumConfig: true }));
  };

  const isOptionSelected = (option: Partial<AvatarData>) => {
    return Object.keys(option).every((key) => (avatarData as any)[key] === (option as any)[key]);
  };

  const renderOptionSection = (title: string, options: Partial<AvatarData>[]) => (
    <View style={styles.optionSection}>
      <Text style={styles.optionSectionTitle}>{title}</Text>
      <View style={styles.optionGrid}>
        {options.map((option, idx) => (
          <AvatarOption key={idx} data={{ ...avatarData, ...option }} selected={isOptionSelected(option)} onPress={() => updateAvatar(option)} />
        ))}
      </View>
    </View>
  );

  const renderOptionGrid = () => {
    if (builderCategory === 'hair') {
      return (
        <View style={styles.sectionsContainer}>
          {isMasc ? renderOptionSection('MENS', HAIR_MEN) : null}
          {isFem ? renderOptionSection('WOMENS', HAIR_WOMEN) : null}
        </View>
      );
    }

    if (builderCategory === 'face') {
      return (
        <View style={styles.sectionsContainer}>
          {isMasc ? renderOptionSection('MENS', FACE_MEN) : null}
          {isFem ? renderOptionSection('WOMENS', FACE_WOMEN) : null}
        </View>
      );
    }

    if (builderCategory === 'style') {
      return (
        <View style={styles.sectionsContainer}>
          {isMasc ? renderOptionSection('MENS', CLOTHING_MEN) : null}
          {isFem ? renderOptionSection('WOMENS', CLOTHING_WOMEN) : null}
        </View>
      );
    }

    return (
      <View style={styles.sectionsContainer}>
        {renderOptionSection('EYEWEAR', EXTRAS_EYEWEAR)}
        {isMasc ? renderOptionSection('HEADWEAR', HEADWEAR_MEN) : null}
        {isFem ? renderOptionSection('HEADWEAR', HEADWEAR_WOMEN) : null}
      </View>
    );
  };

  const renderStudio = () => (
    <View style={styles.builder}>
      <View style={[styles.builderTopActions, { top: Math.max((Platform.OS === 'android' ? StatusBar.currentHeight || 24 : 44) + 10, 50) }]}>
        <Pressable onPress={() => navigate('ProfileDetails', { ...params, gender: effectiveGender })}>
          {({ pressed }) => (
            <View style={[styles.builderCircleBtn, pressed && { transform: [{ translateY: 2 }], boxShadow: 'none' }]}>
              <MaterialIcons name="arrow-back" size={26} color={skeuo.plum} />
            </View>
          )}
        </Pressable>
        <View style={styles.topRightActions}>
          <Pressable onPress={() => {
            setAvatarData(getInitialAvatar(effectiveGender === 'Masculine'));
          }}>
            {({ pressed }) => (
              <View style={[styles.pillButton, pressed && { transform: [{ translateY: 2 }], boxShadow: 'none' }]}>
                <MaterialIcons name="undo" size={20} color={skeuo.plum} />
                <Text style={styles.pillText}>Revert</Text>
              </View>
            )}
          </Pressable>
          <Pressable onPress={async () => {
            if (params?.isEditMode) {
              if (auth.currentUser) {
                await saveUserProfile(auth.currentUser.uid, {
                  avatarData
                });
                Alert.alert('Success', 'Avatar updated successfully!');
                navigate(params?.returnTo || 'Settings');
              }
            } else {
              navigate('CreatePassword', { ...params, avatar: avatarData });
            }
          }}>
            {({ pressed }) => (
              <View style={[styles.pillButton, styles.pillButtonPrimary, pressed && { transform: [{ translateY: 2 }], boxShadow: 'none' }]}>
                <MaterialIcons name="check" size={20} color="#1E1E1E" />
                <Text style={styles.pillTextPrimary}>{params?.isEditMode ? 'Save Avatar' : 'Continue'}</Text>
              </View>
            )}
          </Pressable>
        </View>
      </View>

      <View style={[styles.avatarStage, { paddingBottom: height < 750 ? 120 : 240 }]}>
        <View style={[styles.previewGlow, { width: Math.min(260, height * 0.35), height: Math.min(260, height * 0.35), borderRadius: Math.min(260, height * 0.35) / 2 }]} />
        <GengalAvatar data={avatarData} size={Math.min(300, height * 0.4)} />
      </View>

      <Animated.View style={[
        styles.builderSheet, 
        { transform: [{ translateY: sheetTranslateY }] }
      ]}>
        <View style={styles.sheetInner}>
          <View style={styles.sheetHandleWrapper} {...sheetPanResponder.panHandlers}>
            <View style={styles.sheetHandle} />
          </View>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{CATEGORY_LABELS[builderCategory]}</Text>
          </View>

          <View style={{ flexGrow: 0 }}>
            <View style={styles.swatchRow}>
              
              {builderCategory === 'face' ? (
                <View style={styles.swatchGroup}>
                  <Text style={styles.swatchGroupLabel}>SKIN</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.swatchList}>
                    {SKIN_OPTIONS.map((skinColor) => (
                      <Pressable
                        key={skinColor}
                        style={[styles.swatch, avatarData.skinColor === skinColor && styles.swatchActive]}
                        onPress={() => updateAvatar({ skinColor })}
                      >
                        {({ pressed }) => (
                          <View style={[styles.swatchInner, pressed && { transform: [{ translateY: 2 }], boxShadow: 'none' }]}>
                            <View style={[styles.swatchColorFill, { backgroundColor: getSkinHex(skinColor) }]} />
                          </View>
                        )}
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              ) : null}
                  
              {builderCategory === 'hair' ? (
                <View style={styles.swatchGroup}>
                  <Text style={styles.swatchGroupLabel}>HAIR COLOR</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.swatchList}>
                    {HAIR_COLOR_OPTIONS.map((hairColor) => (
                      <Pressable
                        key={hairColor}
                        style={[styles.swatch, avatarData.hairColor === hairColor && styles.swatchActive]}
                        onPress={() => updateAvatar({ hairColor, facialHairColor: hairColor })}
                      >
                        {({ pressed }) => (
                          <View style={[styles.swatchInner, pressed && { transform: [{ translateY: 2 }], boxShadow: 'none' }]}>
                            <View style={[styles.swatchColorFill, { backgroundColor: getHairHex(hairColor) }]} />
                          </View>
                        )}
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              ) : null}

              {builderCategory === 'style' ? (
                <View style={styles.swatchGroup}>
                  <Text style={styles.swatchGroupLabel}>CLOTHING COLOR</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.swatchList}>
                    {CLOTHING_COLOR_OPTIONS.map((clotheColor) => (
                      <Pressable
                        key={clotheColor}
                        style={[styles.swatch, avatarData.clotheColor === clotheColor && styles.swatchActive]}
                        onPress={() => updateAvatar({ clotheColor })}
                      >
                        {({ pressed }) => (
                          <View style={[styles.swatchInner, pressed && { transform: [{ translateY: 2 }], boxShadow: 'none' }]}>
                            <View style={[styles.swatchColorFill, { backgroundColor: getClothingHex(clotheColor) }]} />
                          </View>
                        )}
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              ) : null}

              {builderCategory === 'accessory' ? (
                <View style={styles.swatchGroup}>
                  <Text style={styles.swatchGroupLabel}>BACKGROUND COLOR</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.swatchList}>
                    {BG_COLOR_OPTIONS.map((bgColor) => (
                      <Pressable
                        key={bgColor}
                        style={[styles.swatch, avatarData.backgroundColor === bgColor && styles.swatchActive]}
                        onPress={() => updateAvatar({ backgroundColor: bgColor })}
                      >
                        {({ pressed }) => (
                          <View style={[styles.swatchInner, pressed && { transform: [{ translateY: 2 }], boxShadow: 'none' }]}>
                            <View style={[styles.swatchColorFill, { backgroundColor: bgColor }]} />
                          </View>
                        )}
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              ) : null}

            </View>
          </View>

          <ScrollView style={styles.optionScroll} contentContainerStyle={styles.optionScrollContent} showsVerticalScrollIndicator={false}>
            {renderOptionGrid()}
          </ScrollView>
        </View>
      </Animated.View>

      <View style={styles.builderCategoryBar}>
        <BuilderTab icon="face-retouching-natural" label="Hair" active={builderCategory === 'hair'} onPress={() => setBuilderCategory('hair')} />
        <BuilderTab icon="mood" label="Face" active={builderCategory === 'face'} onPress={() => setBuilderCategory('face')} />
        <BuilderTab icon="checkroom" label="Clothing" active={builderCategory === 'style'} onPress={() => setBuilderCategory('style')} />
        <BuilderTab icon="visibility" label="Extras" active={builderCategory === 'accessory'} onPress={() => setBuilderCategory('accessory')} />
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.contentArea}>
        {renderStudio()}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: skeuo.surface },
  builder: { flex: 1, backgroundColor: '#F0E5D4' },
  builderTopActions: {
    position: 'absolute',
    left: 10,
    right: 10,
    zIndex: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  builderCircleBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: skeuo.surfaceRaised,
    borderWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
    elevation: 4,
    shadowColor: '#533A1D',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  topRightActions: {
    flexDirection: 'row',
    gap: 6,
    flexShrink: 1,
  },
  pillButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: skeuo.surfaceRaised,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 4,
    borderWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
    elevation: 4,
    shadowColor: '#533A1D',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  pillButtonPrimary: {
    backgroundColor: '#ffd700',
    borderColor: '#CBA72F',
  },
  pillText: { color: skeuo.plum, fontSize: 13, fontWeight: '800' },
  pillTextPrimary: { color: '#1E1E1E', fontSize: 13, fontWeight: '900' },
  avatarStage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 40,
    paddingBottom: 240,
  },
  previewGlow: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: '#FFFFFF',
    opacity: 0.4,
    boxShadow: Platform.OS === 'web' ? '0 10px 40px rgba(255,255,255,0.8)' : undefined,
  },
  builderSheet: {
    position: 'absolute',
    bottom: 92,
    left: 16,
    right: 16,
    height: 480,
    backgroundColor: 'transparent',
    boxShadow: Platform.OS === 'web' ? skeuo.deepShadow : undefined,
    elevation: 20,
    shadowColor: '#3A2000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
  },
  sheetInner: {
    flex: 1,
    backgroundColor: skeuo.surfaceRaised,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: skeuo.border,
  },
  sheetHandleWrapper: {
    width: '100%',
    paddingVertical: 18,
    alignItems: 'center',
  },
  sheetHandle: {
    width: 64,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#D9C58B',
  },
  sheetHeader: {
    paddingHorizontal: 38,
    paddingTop: 8,
    paddingBottom: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetTitle: { color: skeuo.plum, fontSize: 32, fontWeight: '900', fontFamily: 'serif' },
  swatchRow: { paddingHorizontal: 22, paddingBottom: 16, alignItems: 'flex-start', flexDirection: 'column', gap: 20 },
  swatchGroup: { gap: 10, width: '100%' },
  swatchGroupLabel: { color: '#9A8772', fontSize: 11, fontWeight: '900', letterSpacing: 1.1 },
  swatchList: { flexDirection: 'row', gap: 14, paddingRight: 40 },
  swatch: { 
    width: 44, 
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  swatchActive: { borderColor: '#EAB308' },
  swatchInner: {
    width: '100%',
    height: '100%',
    borderRadius: 22,
    backgroundColor: skeuo.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
    elevation: 5,
    shadowColor: '#533A1D',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
  },
  swatchColorFill: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  optionScroll: { flex: 1 },
  optionScrollContent: {
    paddingBottom: 20,
  },
  sectionsContainer: {
    gap: 30,
    paddingTop: 10,
  },
  optionSection: {
    width: '100%',
  },
  optionSectionTitle: {
    color: '#8A6715',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.2,
    marginLeft: 22,
    marginBottom: 16,
  },
  optionGrid: {
    paddingHorizontal: 20,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    gap: 10,
    rowGap: 17,
  },
  avatarOption: {
    width: '31%',
    aspectRatio: 1,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  avatarOptionActive: { borderColor: '#EAB308' },
  avatarOptionInnerContainer: {
    width: '100%',
    height: '100%',
    borderRadius: 14,
    backgroundColor: skeuo.surfaceRaised,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
    elevation: 5,
    shadowColor: '#533A1D',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    padding: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarOptionDarkSquare: {
    flex: 1,
    backgroundColor: '#1E1E24',
    borderRadius: 10,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  builderCategoryBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 92,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: skeuo.surfaceRaised,
    paddingHorizontal: 20,
    zIndex: 20,
    borderTopWidth: 1,
    borderColor: skeuo.border,
  },
  builderTab: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  builderTabLabel: {
    color: '#9A8772',
    fontSize: 11,
    fontWeight: '800',
  },
  builderTabLabelActive: {
    color: skeuo.plum,
  },
  stageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 14,
    backgroundColor: skeuo.surfaceRaised,
    borderBottomWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? '0 8px 18px rgba(83, 58, 29, 0.10)' : undefined,
  },
  brand: { color: skeuo.plum, fontFamily: 'serif', fontSize: 28, fontWeight: '900' },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: skeuo.surfaceRaised,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  contentArea: { flex: 1 },
  infoContainer: { paddingHorizontal: 24, paddingTop: 28, paddingBottom: 112 },
  infoTitle: { color: skeuo.plum, fontFamily: 'serif', fontSize: 30, fontWeight: '900', marginBottom: 22 },
  successBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F8EA',
    padding: 12,
    borderRadius: 16,
    marginBottom: 22,
    gap: 8,
    borderWidth: 1,
    borderColor: '#D7EDC8',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  successText: { color: '#4F8B36', fontSize: 13, fontWeight: '800' },
  formGroup: { marginBottom: 18 },
  label: { fontSize: 11, fontWeight: '900', color: '#9A8772', marginBottom: 8, letterSpacing: 1.1 },
  input: {
    backgroundColor: '#FFFDF8',
    borderRadius: 18,
    height: 54,
    paddingHorizontal: 17,
    color: skeuo.plum,
    fontSize: 16,
    fontWeight: '700',
    borderWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? skeuo.insetShadow : undefined,
  },
  genderToggleFrame: {
    flexDirection: 'row',
    backgroundColor: '#F0E5D4',
    padding: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? skeuo.insetShadow : undefined,
  },
  toggleBtn: { flex: 1, height: 42, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  activeMasculine: { backgroundColor: '#FFFDF8', borderWidth: 1, borderColor: '#D9C58B', boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined },
  activeFeminine: { backgroundColor: '#FFFDF8', borderWidth: 1, borderColor: '#D9C58B', boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined },
  toggleBtnText: { fontSize: 12, fontWeight: '900', color: '#9A8772', letterSpacing: 1 },
  textActive: { color: skeuo.plum },
  saveActionBtn: { width: '100%', height: 58, borderRadius: 29, marginTop: 30, overflow: 'hidden', boxShadow: Platform.OS === 'web' ? skeuo.goldShadow : undefined },
  saveGradient: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  saveActionText: { color: '#563F00', fontWeight: '900', fontSize: 14, letterSpacing: 1.6 },
  footerTabBar: {
    backgroundColor: skeuo.surfaceRaised,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: 12,
    paddingBottom: Platform.OS === 'ios' ? 24 : 12,
    borderTopWidth: 1,
    borderColor: skeuo.border,
  },
  tabBtn: { marginHorizontal: 18, borderRadius: 18, padding: 10, alignItems: 'center', justifyContent: 'center', flex: 1 },
  tabLabel: { fontSize: 13, color: '#9A8772', fontWeight: '900', marginTop: 4, letterSpacing: 0.5 },
  activeTabLabel: { color: skeuo.plum },
});

```


# src\screens\ForgotPasswordScreen.tsx
```tsx
import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  TextInput,
  Platform,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import ScreenShell from '../components/ScreenShell';
import { skeuo, skeuoGradients } from '../theme/skeuomorphic';
import { sendOTP, verifyOTP } from '../services/authService';
import { collection, query, where, getDocs, updateDoc, doc } from 'firebase/firestore';
import { db, auth } from '../config/firebase';
import { signInWithCustomToken } from 'firebase/auth';

type Props = {
  navigate: (screen: string, params?: any) => void;
  route?: any;
};

const NUMPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'backspace'];

export default function ForgotPasswordScreen({ navigate, route }: Props) {
  const phone = route?.params?.phone || '';
  
  const [step, setStep] = useState<'otp' | 'new_password'>('otp');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [resendTimer, setResendTimer] = useState(90);
  const [verifiedToken, setVerifiedToken] = useState('');

  useEffect(() => {
    let interval: any;
    if (resendTimer > 0) {
      interval = setInterval(() => {
        setResendTimer((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [resendTimer]);

  useEffect(() => {
    // Send OTP automatically when user lands on this screen
    if (phone) {
      sendOTP(phone).catch(err => console.error('Failed to auto-send OTP:', err));
    }
  }, [phone]);

  const handlePress = (val: string) => {
    if (val === '') return;
    if (step === 'otp') {
      if (val === 'backspace') {
        setOtp((o) => o.slice(0, -1));
      } else {
        if (otp.length < 6) setOtp((o) => o + val);
      }
    }
  };

  const formatOtp = (o: string) => {
    return o.padEnd(6, '-').split('').join(' ');
  };

  const handleContinue = async () => {
    if (step === 'otp') {
      if (otp.length === 6) {
        setIsLoading(true);
        setErrorMsg('');
        try {
          const result = await verifyOTP(phone, otp, 'signup'); // Use signup to just get token
          if (result.token) {
            setVerifiedToken(result.token);
            setStep('new_password');
          } else {
            throw new Error("Failed to verify OTP");
          }
        } catch (error: any) {
          setErrorMsg(error.message || "Invalid OTP code");
        } finally {
          setIsLoading(false);
        }
      }
    } else if (step === 'new_password') {
      if (newPassword.length >= 6) {
        setIsLoading(true);
        setErrorMsg('');
        try {
          // Find user by phone and update password
          const usersRef = collection(db, 'users');
          const q = query(usersRef, where('phoneNumber', '==', phone));
          const snapshot = await getDocs(q);
          
          if (!snapshot.empty) {
            const userDoc = snapshot.docs[0];
            await updateDoc(doc(db, 'users', userDoc.id), {
              password: newPassword
            });
          }
          
          // Log in with the custom token
          await signInWithCustomToken(auth, verifiedToken);
          // App.tsx onAuthStateChanged will detect login and automatically navigate
        } catch (error: any) {
          setErrorMsg(error.message || "Failed to reset password");
        } finally {
          setIsLoading(false);
        }
      }
    }
  };

  return (
    <ScreenShell tone="light">
      <ScrollView 
        contentContainerStyle={[styles.container, { flexGrow: 1 }]} 
        bounces={false} 
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigate('Phone', { step: 'password' })} style={styles.backBtn}>
            <MaterialIcons name="arrow-back" size={24} color="#5A155A" />
          </TouchableOpacity>
        </View>

        <View style={styles.titleSection}>
          <Text style={styles.title}>
            {step === 'otp' ? 'Reset Password' : 'New Password'}
          </Text>
          <Text style={styles.subtitle}>
            {step === 'otp'
              ? `Enter the 6-digit code sent to ${phone}`
              : 'Enter a new password for your account'}
          </Text>
          {errorMsg ? <Text style={{color: '#ef4444', marginTop: 8, fontSize: 13, textAlign: 'center'}}>{errorMsg}</Text> : null}
        </View>

        {step === 'otp' ? (
          <>
            <View style={styles.inputWrapper}>
              <View style={styles.inputBox}>
                <Text 
                  style={[styles.inputTextCenter, !otp && styles.placeholderText, { flex: 1 }, Platform.OS === 'web' && { outlineStyle: 'none' } as any]}
                >
                  {formatOtp(otp)}
                </Text>
              </View>
            </View>

            <View style={styles.numpadContainer}>
              {NUMPAD.map((key, i) => {
                if (key === '') {
                  return <View key={i} style={styles.numpadKey} />;
                }
                return (
                  <TouchableOpacity
                    key={i}
                    style={[styles.numpadKey, key !== 'backspace' && styles.numpadKeyElevated]}
                    activeOpacity={0.7}
                    onPress={() => handlePress(key)}
                  >
                    {key === 'backspace' ? (
                      <MaterialIcons name="backspace" size={28} color="#4B5563" />
                    ) : (
                      <Text style={styles.numpadText}>{key}</Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        ) : (
          <View style={[styles.inputContainer, { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 16, borderRadius: 12, marginTop: 20 }]}>
            <TextInput
              style={{ flex: 1, fontSize: 18, color: '#1A1A1A' }}
              placeholder="Enter New Password"
              placeholderTextColor="#A0A0A0"
              secureTextEntry={!isPasswordVisible}
              value={newPassword}
              onChangeText={setNewPassword}
              autoFocus
            />
            <TouchableOpacity onPress={() => setIsPasswordVisible(!isPasswordVisible)} style={{ position: 'absolute', right: 15 }}>
              <MaterialIcons name={isPasswordVisible ? "visibility" : "visibility-off"} size={22} color="#A0A0A0" />
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.footer}>
          <Pressable
            disabled={(step === 'otp' && otp.length < 6) || (step === 'new_password' && newPassword.length < 6) || isLoading}
            onPress={handleContinue}
          >
            {({ pressed }) => (
              <View style={[
                styles.continueButtonWrapper,
                ((step === 'otp' && otp.length < 6) || (step === 'new_password' && newPassword.length < 6)) && styles.disabledWrapper,
                pressed && { elevation: 0, shadowOpacity: 0, boxShadow: 'none' }
              ]}>
                <LinearGradient
                  colors={[...skeuoGradients.gold]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[styles.continueButton, pressed && { transform: [{ translateY: 2 }] }]}
                >
                  {isLoading ? (
                    <ActivityIndicator color="#422006" />
                  ) : (
                    <>
                      <Text style={styles.continueText}>
                        {step === 'otp' ? 'Verify Code' : 'Save & Log In'}
                      </Text>
                      <MaterialIcons name="arrow-forward" size={18} color="#422006" />
                    </>
                  )}
                </LinearGradient>
              </View>
            )}
          </Pressable>

          {step === 'otp' && (
            <View style={{ alignItems: 'center' }}>
              <TouchableOpacity 
                activeOpacity={resendTimer > 0 ? 1 : 0.7} 
                style={{ marginTop: 20 }}
                onPress={async () => {
                  if (resendTimer === 0) {
                    setIsLoading(true);
                    setErrorMsg('');
                    try {
                      await sendOTP(phone);
                      setResendTimer(90);
                    } catch (error: any) {
                      setErrorMsg(error.message || "Failed to resend OTP");
                    } finally {
                      setIsLoading(false);
                    }
                  }
                }}
              >
                <Text style={[{ color: '#5A155A', fontWeight: '600', fontSize: 15 }, resendTimer > 0 && { opacity: 0.5 }]}>
                  {resendTimer > 0 ? `Resend OTP in ${resendTimer}s` : 'Resend OTP'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 40,
    paddingHorizontal: 30,
    backgroundColor: skeuo.surface,
  },
  header: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FAF5EE',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  titleSection: {
    marginBottom: 30,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#321151',
    marginBottom: 8,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    color: '#6B7280',
    lineHeight: 22,
  },
  inputWrapper: {
    marginBottom: 30,
  },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    minHeight: 64,
    borderWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? skeuo.insetShadow : undefined,
    elevation: 2,
    shadowColor: '#533A1D',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  inputTextCenter: {
    fontSize: 26,
    fontWeight: '600',
    color: '#1A1A1A',
    letterSpacing: 8,
    textAlign: 'center',
  },
  placeholderText: {
    color: '#D1D5DB',
  },
  inputContainer: {
    borderWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? skeuo.insetShadow : undefined,
    elevation: 2,
    shadowColor: '#533A1D',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  numpadContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 15,
    width: '100%',
    marginBottom: 20,
  },
  numpadKey: {
    width: '28%',
    aspectRatio: 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  numpadKeyElevated: {
    backgroundColor: skeuo.surfaceRaised,
    borderWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
    elevation: 5,
    shadowColor: '#533A1D',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
  },
  numpadText: {
    fontFamily: 'serif',
    fontSize: 24,
    fontWeight: '700',
    color: '#321151',
  },
  footer: {
    marginTop: 'auto',
    marginBottom: 20,
  },
  continueButtonWrapper: {
    borderRadius: 16,
    backgroundColor: '#D0A92E',
    boxShadow: Platform.OS === 'web' ? skeuo.deepShadow : undefined,
    elevation: 8,
    shadowColor: '#533A1D',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
  },
  disabledWrapper: {
    opacity: 0.5,
  },
  continueButton: {
    flexDirection: 'row',
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    overflow: 'hidden',
  },
  continueText: {
    color: '#422006',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});

```


# src\screens\HomeScreen.tsx
```tsx
import React, { useState, useEffect } from 'react';
import { Platform, View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  useWindowDimensions,
  ActivityIndicator,
  Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import ScreenShell from '../components/ScreenShell';
import BottomNav from '../components/BottomNav';
import TopBar from '../components/TopBar';
import DiamondBadge from '../components/DiamondBadge';
import GengalAvatar from '../components/GengalAvatar';
import { skeuo, skeuoGradients } from '../theme/skeuomorphic';

import { subscribeToOnlineUsers, UserProfile as FirebaseUser } from '../services/userService';
import { findMatch } from '../services/matchService';
import { auth } from '../config/firebase';
import CallPriceTag from '../components/CallPriceTag';
import { useUser } from '../context/UserContext';
import ConnectingOverlay from '../components/ConnectingOverlay';

type HomeScreenProps = {
  navigate: (screen: string, params?: any) => void;
};

function ModeButton({
  mode,
  profile,
  navigate,
}: {
  mode: 'call' | 'video';
  profile: any;
  navigate: HomeScreenProps['navigate'];
}) {
  const isVideo = mode === 'video';

  return (
    <TouchableOpacity
      activeOpacity={0.82}
      style={[styles.modeButton, isVideo && styles.modeButtonVideo]}
      onPress={() => {
        navigate('Call', { profileName: profile.name, mode, isCaller: true, matchData: profile });
      }}
    >
      <MaterialIcons
        name={isVideo ? 'videocam' : 'phone'}
        size={13}
        color={isVideo ? '#FFF7FF' : '#765F06'}
      />
      <Text style={[styles.modeText, isVideo && styles.modeTextVideo]}>
        {isVideo ? 'Video' : 'Call'}
      </Text>
      <CallPriceTag mode={mode} />
    </TouchableOpacity>
  );
}

export default function HomeScreen({ navigate }: HomeScreenProps) {
  const { height } = useWindowDimensions();
  const isSmall = height < 850;

  const [firebaseUsers, setFirebaseUsers] = useState<FirebaseUser[]>([]);
  const { profile: myProfile } = useUser();
  const [isSearching, setIsSearching] = useState(false);
  const [searchCleanup, setSearchCleanup] = useState<(() => void) | null>(null);

  const handleExploreMatches = async () => {
    if (!myProfile) {
      Alert.alert('Profile not loaded', 'Please wait for your profile to load.');
      return;
    }

    if (isSearching) {
      if (searchCleanup) searchCleanup();
      setIsSearching(false);
      setSearchCleanup(null);
      return;
    }

    setIsSearching(true);
    try {
      const cleanup = await findMatch(myProfile, (roomId, matchData) => {
        setIsSearching(false);
        setSearchCleanup(null);
        navigate('Match', { profileName: matchData.nickname, matchData, roomId } as any);
      });
      setSearchCleanup(() => cleanup);
    } catch (e) {
      Alert.alert('Error', 'Could not start matchmaking.');
      setIsSearching(false);
    }
  };

  useEffect(() => {
    const unsubscribe = subscribeToOnlineUsers((users) => {
      setFirebaseUsers(users);
    }, auth.currentUser?.uid);
    
    return () => {
      unsubscribe();
    };
  }, []);

  // Only map the real firebase users
  const displayProfiles = firebaseUsers.map(u => ({
    uid: u.uid,
    name: u.nickname || u.username || 'User',
    age: (typeof u.age === 'number' ? u.age : parseInt(u.age || '20', 10)),
    uri: u.avatarUrl || 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?q=80&w=200&auto=format&fit=crop',
    avatarData: u.avatarData,
    tier: (u.tier as 'Elite' | 'VIP') || 'Elite',
    lang: u.language || 'EN',
    modes: ['call', 'video'] as Array<'call' | 'video'>,
    followers: '0',
    following: '0',
    bio: ''
  }));

  return (
    <ScreenShell tone="light">
      <View style={styles.phone}>
        {isSearching && (
          <ConnectingOverlay 
            mode="random" 
            onCancel={() => {
              if (searchCleanup) searchCleanup();
              setIsSearching(false);
              setSearchCleanup(null);
            }} 
          />
        )}
        <TopBar navigate={navigate} />

        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={[styles.scroll, isSmall && styles.scrollSmall]}
          showsVerticalScrollIndicator={false}
        >
          <TouchableOpacity
            activeOpacity={0.93}
            style={[styles.heroShell, isSmall && styles.heroShellSmall]}
            onPress={() => navigate('Personal')}
          >
            <LinearGradient
              colors={[...skeuoGradients.raised]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.hero, isSmall && styles.heroSmall]}
            >
              <View style={styles.heroWash} />
              <View style={[styles.heroMoon, isSmall && styles.heroMoonSmall]} />

              <View style={[styles.heartOrb, isSmall && styles.heartOrbSmall]}>
                <MaterialIcons name="favorite" size={34} color="#4A0049" />
              </View>

              <View style={[styles.heroCopy, isSmall && styles.heroCopySmall]}>
                <View style={styles.heroTitleRow}>
                  <Text style={styles.heroTitle}>Private Connect</Text>
                  <View style={styles.premiumBadge}>
                    <Text style={styles.premiumText}>PREMIUM</Text>
                  </View>
                </View>
                <Text style={styles.heroSub}>
                  Find your perfect match in curated, high-value environment
                </Text>
              </View>

              <TouchableOpacity 
                style={[styles.heroButton, isSmall && styles.heroButtonSmall, isSearching && { opacity: 0.8 }]} 
                activeOpacity={0.8}
                onPress={handleExploreMatches}
              >
                {isSearching ? (
                  <ActivityIndicator color="#FFF7F2" size="small" style={{ marginRight: 8 }} />
                ) : null}
                <Text style={styles.heroButtonText}>{isSearching ? 'Cancel Search...' : 'Explore Matches'}</Text>
                {!isSearching && <MaterialIcons name="arrow-forward" size={14} color="#FFF7F2" />}
              </TouchableOpacity>
            </LinearGradient>
          </TouchableOpacity>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Online Now</Text>
            <TouchableOpacity activeOpacity={0.75} onPress={() => navigate('Personal')}>
              <Text style={styles.viewAll}>View all</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentInsetAdjustmentBehavior="automatic"
            style={[styles.profileScroller, isSmall && styles.profileScrollerSmall]}
            contentContainerStyle={styles.profileRow}
          >
            {displayProfiles.map((profile, i) => (
              <View
                key={profile.name + i}
                style={styles.profileCard}
              >
                <TouchableOpacity
                  activeOpacity={0.85}
                  style={styles.profileTap}
                  onPress={() => {
                    navigate('Profile', { profileName: profile.name, matchData: profile });
                  }}
                >
                  <LinearGradient
                    colors={['#F8EFCB', '#B89628', '#FFF8DB']}
                    start={{ x: 0.1, y: 0 }}
                    end={{ x: 0.9, y: 1 }}
                    style={styles.profileRing}
                  >
                    <View style={styles.profilePhotoWrap}>
                      {profile.avatarData ? (
                        <GengalAvatar data={profile.avatarData as any} size={70} />
                      ) : (
                        <Image source={{ uri: profile.uri }} style={styles.profilePhoto} />
                      )}
                      <LinearGradient
                        colors={['transparent', 'rgba(50, 16, 36, 0.28)']}
                        style={styles.profileVignette}
                      />
                      <View style={styles.onlineDot} />
                    </View>
                  </LinearGradient>
                  <View style={styles.tierPill}>
                    <MaterialIcons name="diamond" size={7} color="#B68D1C" />
                    <Text style={styles.tierText}>{profile.tier}</Text>
                  </View>
                  <Text style={styles.profileName}>{profile.name}, {profile.age}</Text>
                  <View style={styles.langRow}>
                    <MaterialIcons name="language" size={8} color="#B88A2E" />
                    <Text style={styles.profileLang}>{profile.lang}</Text>
                  </View>
                </TouchableOpacity>
                <View style={styles.modeRow}>
                  {profile.modes.map((mode) => (
                    <ModeButton key={mode} mode={mode} profile={profile} navigate={navigate} />
                  ))}
                </View>
              </View>
            ))}
          </ScrollView>

          <View style={styles.tileGrid}>
            <TouchableOpacity style={[styles.tile, isSmall && styles.tileSmall]} activeOpacity={0.9} onPress={() => navigate('Club')}>
              <View style={styles.tileIconGold}>
                <MaterialIcons name="castle" size={30} color="#A78312" />
              </View>
              <Text style={styles.tileTitle}>Club</Text>
              <Text style={styles.tileSub}>Expert Rooms</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.tile, isSmall && styles.tileSmall]} activeOpacity={0.9} onPress={() => navigate('Personal')}>
              <View style={styles.tileIconPink}>
                <MaterialIcons name="coffee" size={30} color="#D16CBF" />
              </View>
              <Text style={[styles.tileTitle, styles.tileTitleMuted]}>Chill</Text>
              <Text style={styles.tileSub}>Intimate Vibes</Text>
            </TouchableOpacity>
          </View>

        </ScrollView>

        <BottomNav active="Home" navigate={navigate} />
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  phone: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 430,
    backgroundColor: 'transparent',
  },
  header: {
    height: 72,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    backgroundColor: '#FFFDF8',
    borderBottomWidth: 1,
    borderBottomColor: '#EFE3D2',
  },
  avatarShadow: {
    width: 44,
    height: 44,
    borderRadius: 22,
    padding: 3,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DFC260',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  avatar: {
    width: '100%',
    height: '100%',
    borderRadius: 18,
  },
  centerTitle: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  brand: {
    color: '#5A155A',
    fontFamily: 'serif',
    fontSize: 28,
    fontWeight: '900',
  },
  scroll: {
    paddingHorizontal: 26,
    paddingTop: 20,
    paddingBottom: 110,
  },
  scrollSmall: {
    paddingBottom: 90,
  },
  heroShell: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#EAD8A9',
    backgroundColor: '#FFFDF8',
    boxShadow: Platform.OS === 'web' ? skeuo.deepShadow : undefined,
    marginBottom: 28,
  },
  heroShellSmall: {
    marginBottom: 18,
  },
  hero: {
    minHeight: 310,
    borderRadius: 23,
    overflow: 'hidden',
    paddingHorizontal: 24,
    paddingTop: 52,
    paddingBottom: 22,
    justifyContent: 'flex-end',
  },
  heroSmall: {
    minHeight: 240,
    paddingTop: 36,
  },
  heroWash: {
    position: 'absolute',
    top: -10,
    right: -18,
    width: 230,
    height: 226,
    borderRadius: 115,
    backgroundColor: '#E9E0E2',
  },
  heroMoon: {
    position: 'absolute',
    top: 60,
    left: '50%',
    width: 112,
    height: 112,
    marginLeft: -56,
    borderRadius: 56,
    backgroundColor: '#FDF7E8',
  },
  heroMoonSmall: {
    top: 40,
  },
  heartOrb: {
    position: 'absolute',
    top: 93,
    left: '50%',
    width: 62,
    height: 62,
    marginLeft: -31,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF9EA',
    borderWidth: 1,
    borderColor: '#FFFFFF',
    boxShadow: Platform.OS === 'web' ? '0 2px 4px rgba(0,0,0,0.1)' : undefined,
  },
  heartOrbSmall: {
    top: 70,
  },
  heroCopy: {
    gap: 9,
    marginBottom: 22,
  },
  heroCopySmall: {
    marginBottom: 16,
  },
  heroTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  heroTitle: {
    color: '#5B1A62',
    fontFamily: 'serif',
    fontSize: 19,
    fontWeight: '700',
  },
  premiumBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: '#F7DA55',
  },
  premiumText: {
    color: '#AA7C00',
    fontSize: 7,
    fontWeight: '900',
  },
  heroSub: {
    color: '#8F8491',
    fontSize: 13,
    lineHeight: 20,
    maxWidth: 260,
    fontWeight: '600',
  },
  heroButton: {
    height: 52,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#4B0054',
    borderWidth: 1,
    borderColor: '#7B2B82',
    boxShadow: Platform.OS === 'web' ? '0 9px 16px rgba(75, 0, 84, 0.28)' : undefined,
  },
  heroButtonSmall: {
    height: 48,
  },
  heroButtonText: {
    color: '#FFF7F2',
    fontSize: 14,
    fontWeight: '800',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 15,
  },
  sectionTitle: {
    color: '#5C3B23',
    fontFamily: 'serif',
    fontSize: 15,
    fontWeight: '800',
  },
  viewAll: {
    color: '#B78F22',
    fontSize: 12,
    fontWeight: '800',
  },
  profileScroller: {
    marginHorizontal: -26,
    marginBottom: 32,
  },
  profileScrollerSmall: {
    marginBottom: 20,
  },
  profileRow: {
    paddingHorizontal: 26,
    gap: 16,
  },
  profileCard: {
    width: 116,
    alignItems: 'center',
  },
  profileTap: {
    alignItems: 'center',
  },
  profileRing: {
    width: 78,
    height: 78,
    borderRadius: 39,
    padding: 3,
    marginBottom: 5,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  profilePhotoWrap: {
    flex: 1,
    borderRadius: 36,
    padding: 2,
    overflow: 'hidden',
    backgroundColor: '#FFFDF8',
  },
  profilePhoto: {
    width: '100%',
    height: '100%',
    borderRadius: 34,
  },
  profileVignette: {
    ...StyleSheet.absoluteFill,
    borderRadius: 34,
  },
  onlineDot: {
    position: 'absolute',
    right: 3,
    bottom: 9,
    width: 12,
    height: 12,
    borderRadius: 7,
    backgroundColor: '#74B95B',
    borderWidth: 2,
    borderColor: '#FFFDF8',
  },
  tierPill: {
    height: 15,
    minWidth: 38,
    paddingHorizontal: 6,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    backgroundColor: '#FFF8DD',
    borderWidth: 1,
    borderColor: '#E9D383',
    marginTop: -13,
    marginBottom: 5,
    boxShadow: Platform.OS === 'web' ? '0 4px 8px rgba(96, 65, 20, 0.12)' : undefined,
  },
  tierText: {
    color: '#8F6920',
    fontSize: 7,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  profileName: {
    color: '#7A256D',
    fontSize: 11.5,
    fontWeight: '900',
    marginBottom: 2,
  },
  langRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  profileLang: {
    color: '#A79386',
    fontSize: 8,
    fontWeight: '800',
  },
  modeRow: {
    marginTop: 8,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  modeButton: {
    height: 26,
    minWidth: 52,
    borderRadius: 13,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#FFF7DF',
    borderWidth: 1,
    borderColor: '#E5CB70',
    boxShadow: Platform.OS === 'web' ? '0 6px 12px rgba(87, 61, 21, 0.15)' : undefined,
  },
  modeButtonVideo: {
    backgroundColor: '#5A075F',
    borderColor: '#5A075F',
    boxShadow: Platform.OS === 'web' ? '0 7px 12px rgba(75, 0, 84, 0.2)' : undefined,
  },
  modeText: {
    color: '#765F06',
    fontSize: 9,
    fontWeight: '900',
  },
  modeTextVideo: {
    color: '#FFF7FF',
  },
  tileGrid: {
    flexDirection: 'row',
    gap: 14,
  },
  tile: {
    flex: 1,
    minHeight: 172,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#FFFDF8',
    borderWidth: 1,
    borderColor: '#FFFFFF',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  tileSmall: {
    minHeight: 140,
  },
  tileIconGold: {
    width: 58,
    height: 58,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF1A7',
  },
  tileIconPink: {
    width: 58,
    height: 58,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF0FA',
  },
  tileTitle: {
    color: '#5C3763',
    fontFamily: 'serif',
    fontSize: 15,
    fontWeight: '800',
  },
  tileTitleMuted: {
    color: '#8E6A8C',
  },
  tileSub: {
    color: '#B3A9A4',
    fontSize: 12,
    fontWeight: '700',
  },
});

```


# src\screens\LanguageScreen.tsx
```tsx
import React, { useState } from 'react';
import { Platform, Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View, } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import ScreenShell from '../components/ScreenShell';
import { useUser } from '../context/UserContext';
import GengalAvatar from '../components/GengalAvatar';
import { skeuo } from '../theme/skeuomorphic';

type LanguageScreenProps = {
  navigate: (screen: string, params?: any) => void;
  route?: any;
};

const LANGUAGES = [
  { id: 'en', name: 'English', sub: 'English' },
  { id: 'es', name: 'Español', sub: 'Spanish' },
  { id: 'hi', name: 'हिन्दी', sub: 'Hindi' },
  { id: 'fr', name: 'Français', sub: 'French' },
  { id: 'it', name: 'Italiano', sub: 'Italian' },
  { id: 'de', name: 'Deutsch', sub: 'German' },
];

export default function LanguageScreen({ navigate, route }: LanguageScreenProps) {
  const { profile: myProfile } = useUser();
  const [selectedLang, setSelectedLang] = useState('en');
  
  const isEditMode = route?.params?.isEditMode || false;
  const returnTo = route?.params?.returnTo || 'Settings';

  return (
    <ScreenShell tone="light">
      <View style={styles.phone}>
        {/* Header */}
        <View style={styles.header}>
          {isEditMode ? (
            <TouchableOpacity
              style={styles.backButton}
              activeOpacity={0.78}
              onPress={() => navigate(returnTo)}
            >
              <MaterialIcons name="arrow-back" size={22} color="#5A075F" />
            </TouchableOpacity>
          ) : (
            <View style={{ width: 44, height: 44 }} />
          )}
          <View style={styles.centerTitle}>
            <Text style={styles.brand}>Gengal</Text>
          </View>
          {isEditMode ? (
            <TouchableOpacity
              style={styles.avatarShadow}
              activeOpacity={0.85}
              onPress={() => navigate('Profile')}
            >
              {myProfile?.avatarData ? (
                <GengalAvatar data={myProfile.avatarData as any} size={36} />
              ) : (
                <Image
                  source={{ uri: myProfile?.avatarUrl || 'https://via.placeholder.com/36' }}
                  style={styles.avatar}
                />
              )}
            </TouchableOpacity>
          ) : (
            <View style={{ width: 44, height: 44 }} />
          )}
        </View>

        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.titleSection}>
            <Text style={styles.pageTitle}>Select Language</Text>
            <Text style={styles.pageSubtitle}>
              Choose your preferred tongue for a bespoke experience.
            </Text>
          </View>

          <View style={styles.langList}>
            {LANGUAGES.map((lang) => {
              const isSelected = selectedLang === lang.id;
              return (
                <TouchableOpacity
                  key={lang.id}
                  activeOpacity={0.8}
                  style={[
                    styles.langCard,
                    isSelected && styles.langCardSelected,
                  ]}
                  onPress={() => setSelectedLang(lang.id)}
                >
                  <View>
                    <Text style={[styles.langName, isSelected && styles.langNameSelected]}>
                      {lang.name}
                    </Text>
                    <Text style={styles.langSub}>{lang.sub}</Text>
                  </View>
                  {isSelected && (
                    <MaterialIcons name="check-circle" size={20} color="#9D8216" />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity activeOpacity={0.85} onPress={() => {
            if (isEditMode) {
              navigate(returnTo);
            } else {
              navigate('Phone');
            }
          }}>
            <LinearGradient
              colors={['#FDE68A', '#EAB308', '#CA8A04']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.saveButton}
            >
              <Text style={styles.saveButtonText}>SAVE PREFERENCES</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  phone: {
    flex: 1,
    backgroundColor: '#FFFDF8',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 15,
    backgroundColor: '#FFFDF8',
    borderBottomWidth: 1,
    borderBottomColor: '#F5E6E6',
    zIndex: 10,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: '#FFFDF8',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  centerTitle: {
    flex: 1,
    alignItems: 'center',
  },
  brand: {
    color: '#321151',
    fontFamily: 'serif',
    fontSize: 26,
    fontWeight: '900',
  },
  avatarShadow: {
    borderRadius: 18,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#FFFDF8',
  },
  scroll: {
    paddingHorizontal: 26,
    paddingTop: 30,
    paddingBottom: 100, // Make room for footer
  },
  titleSection: {
    alignItems: 'center',
    marginBottom: 40,
  },
  pageTitle: {
    color: '#0D2040',
    fontFamily: 'serif',
    fontSize: 32,
    fontWeight: '800',
    marginBottom: 10,
    textShadowColor: 'rgba(234, 179, 8, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  pageSubtitle: {
    color: '#64748B',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 10,
  },
  langList: {
    gap: 16,
  },
  langCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFDF8',
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: '#F1F1F1',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  langCardSelected: {
    borderColor: '#EAB308',
    backgroundColor: '#FFFDF0',
  },
  langName: {
    fontFamily: 'serif',
    fontSize: 20,
    fontWeight: '700',
    color: '#0D2040',
    marginBottom: 4,
  },
  langNameSelected: {
    color: '#321151',
  },
  langSub: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '500',
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 26,
    backgroundColor: 'rgba(255, 253, 248, 0.9)',
  },
  saveButton: {
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: Platform.OS === 'web' ? skeuo.deepShadow : undefined,
  },
  saveButtonText: {
    color: '#422006',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
});

```


# src\screens\LoginPasswordScreen.tsx
```tsx
import React, { useState } from 'react';
import { Platform, View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import ScreenShell from '../components/ScreenShell';
import { skeuo } from '../theme/skeuomorphic';
import { loginWithPassword } from '../services/authService';

export default function LoginPasswordScreen({ navigate, goBack, route }: any) {
  const { params } = route || {};
  const phone = params?.phone || '';

  const [password, setPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleLogin = async () => {
    if (!password) {
      setErrorMsg('Please enter your password');
      return;
    }

    setIsLoading(true);
    setErrorMsg('');

    try {
      await loginWithPassword(phone, password);
      // App.tsx onAuthStateChanged will detect the login and route to Home automatically!
    } catch (error: any) {
      setErrorMsg(error.message || 'Invalid password or account');
      setIsLoading(false);
    }
  };

  return (
    <ScreenShell tone="light">
      <View style={styles.phone}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            activeOpacity={0.78}
            onPress={() => goBack ? goBack() : navigate('Phone')}
          >
            <MaterialIcons name="arrow-back" size={22} color="#5A075F" />
          </TouchableOpacity>
        </View>

        <View style={styles.content}>
          <View style={styles.iconWrapper}>
            <MaterialIcons name="lock-outline" size={42} color="#D49A0B" />
          </View>
          
          <Text style={styles.title}>Enter Password</Text>
          <Text style={styles.subtitle}>
            Welcome back! Please enter your password for {phone}.
          </Text>

          <View style={styles.inputContainer}>
            <View style={[styles.inputWrapper, { boxShadow: Platform.OS === 'web' ? skeuo.insetShadow : undefined }]}>
              <MaterialIcons name="vpn-key" size={20} color="#B68D1C" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Password"
                placeholderTextColor="#A89F91"
                secureTextEntry={!isPasswordVisible}
                value={password}
                onChangeText={setPassword}
                autoCapitalize="none"
              />
              <TouchableOpacity
                onPress={() => setIsPasswordVisible(!isPasswordVisible)}
                style={styles.eyeButton}
              >
                <MaterialIcons
                  name={isPasswordVisible ? 'visibility-off' : 'visibility'}
                  size={20}
                  color="#A89F91"
                />
              </TouchableOpacity>
            </View>
          </View>

          {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}

          <TouchableOpacity style={styles.forgotPasswordButton} onPress={() => navigate('ForgotPassword', { phone })}>
            <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
          </TouchableOpacity>

          <View style={{ flex: 1 }} />

          <TouchableOpacity
            style={[styles.continueButton, !password && { opacity: 0.5 }]}
            activeOpacity={0.85}
            onPress={handleLogin}
            disabled={!password || isLoading}
          >
            <LinearGradient
              colors={['#F3DA79', '#D49A0B']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.continueGradient}
            >
              {isLoading ? (
                <ActivityIndicator color="#5A075F" />
              ) : (
                <Text style={styles.continueButtonText}>Login</Text>
              )}
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  phone: {
    flex: 1,
    backgroundColor: '#FFFDF8',
  },
  header: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 10 : 0,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F8F0E5',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  content: {
    flex: 1,
    paddingHorizontal: 32,
    paddingTop: 20,
    paddingBottom: 40,
  },
  iconWrapper: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FFF',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 24,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
    borderWidth: 1,
    borderColor: 'rgba(212,154,11,0.2)',
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#342D26',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: '#756A62',
    lineHeight: 22,
    marginBottom: 32,
    textAlign: 'center',
  },
  inputContainer: {
    marginBottom: 16,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8F0E5',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EFE5D5',
    height: 56,
    paddingHorizontal: 16,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#342D26',
    fontWeight: '500',
    ...Platform.select({
      web: { outlineStyle: 'none' } as any
    }),
  },
  eyeButton: {
    padding: 8,
  },
  errorText: {
    color: '#D32F2F',
    fontSize: 14,
    marginBottom: 16,
    textAlign: 'center',
  },
  forgotPasswordButton: {
    alignSelf: 'center',
    padding: 8,
  },
  forgotPasswordText: {
    color: '#D49A0B',
    fontSize: 14,
    fontWeight: '600',
  },
  continueButton: {
    height: 56,
    borderRadius: 28,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
    marginTop: 20,
  },
  continueGradient: {
    flex: 1,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueButtonText: {
    fontSize: 17,
    fontWeight: '800',
    color: '#5A075F',
  },
});

```


# src\screens\MatchScreen.tsx
```tsx
import React from 'react';
import { Platform, Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View, } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import ScreenShell from '../components/ScreenShell';
import GengalAvatar from '../components/GengalAvatar';
import CallPriceTag from '../components/CallPriceTag';

type MatchScreenProps = {
  profileName?: string;
  matchData?: any;
  roomId?: string;
  navigate: (screen: string, params?: any) => void;
};

function DottedBackground() {
  return (
    <View pointerEvents="none" style={styles.dots}>
      {Array.from({ length: 230 }).map((_, index) => (
        <View
          key={index}
          style={[
            styles.dot,
            {
              left: (index % 18) * 24 + 5,
              top: Math.floor(index / 18) * 24 + 6,
              opacity: index % 5 === 0 ? 0.28 : 0.16,
            },
          ]}
        />
      ))}
    </View>
  );
}

export default function MatchScreen({ profileName, matchData, roomId, navigate }: MatchScreenProps) {
  // Use matchData if available, fallback to mock profile
  const profile = matchData ? {
    name: matchData.nickname || matchData.name,
    uri: matchData.uri || matchData.avatarUrl || '',
    tier: matchData.tier || 'VIP',
    avatarData: matchData.avatarData
  } : { name: profileName || 'User', uri: '', tier: 'VIP' };

  return (
    <ScreenShell tone="dark">
      <View style={styles.phone}>
        <DottedBackground />
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.headerIcon}
            activeOpacity={0.78}
            onPress={() => navigate('Personal')}
          >
            <MaterialIcons name="close" size={22} color="#F9F2EC" />
          </TouchableOpacity>
          <Text style={styles.headerText} numberOfLines={1}>
            Private Connect - Match Success
          </Text>
        </View>

        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
        >
          <LinearGradient
            colors={['#FFFDF8', '#FAF2E7']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.card}
          >
            <Text style={styles.title}>It's a Match!</Text>
            <Text style={styles.subtitle}>A PRIVATE CONNECTION AWAITS</Text>

            <View style={styles.stackStage}>
              <View style={styles.backCard} />
              <View style={styles.frontCard}>
                <View style={styles.miniHeart}>
                  <MaterialIcons name="favorite" size={15} color="#7E5206" />
                </View>
                {(profile as any).avatarData ? (
                  <GengalAvatar data={(profile as any).avatarData} size={220} />
                ) : (
                  <Image source={{ uri: profile.uri }} style={styles.matchPhoto} />
                )}
                <View style={styles.heartSeal}>
                  <MaterialIcons name="favorite" size={28} color="#7E6507" />
                </View>
              </View>
            </View>

            <View style={styles.namesRow}>
              <Text style={styles.matchName}>{profile.name}</Text>
              <Text style={styles.youName}>You</Text>
            </View>

            <TouchableOpacity
              activeOpacity={0.86}
              style={styles.primaryAction}
              onPress={() => navigate('Chat', { profileName: profile.name })}
            >
              <MaterialIcons name="chat-bubble-outline" size={16} color="#7E6507" />
              <Text style={styles.primaryActionText}>START CONVERSATION</Text>
            </TouchableOpacity>

            <View style={styles.callRow}>
              <TouchableOpacity
                activeOpacity={0.86}
                style={styles.smallAction}
                onPress={() => navigate('Call', { profileName: profile.name, mode: 'call', roomId, matchData, isCaller: true })}
              >
                <MaterialIcons name="phone" size={15} color="#7E6507" />
                <Text style={styles.smallActionText}>VOICE CALL</Text>
                <CallPriceTag mode="call" />
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.86}
                style={styles.smallAction}
                onPress={() => navigate('Call', { profileName: profile.name, mode: 'video', roomId, matchData, isCaller: true })}
              >
                <MaterialIcons name="videocam" size={15} color="#7E6507" />
                <Text style={styles.smallActionText}>VIDEO CALL</Text>
                <CallPriceTag mode="video" />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              activeOpacity={0.86}
              style={styles.outlineAction}
              onPress={() => navigate('Personal')}
            >
              <MaterialIcons name="explore" size={16} color="#7E6507" />
              <Text style={styles.outlineActionText}>CONTINUE DISCOVERING</Text>
            </TouchableOpacity>

            <View style={styles.sharedHint}>
              <View style={styles.hintIcon}>
                <MaterialIcons name="auto-awesome" size={18} color="#D6C99F" />
              </View>
              <Text style={styles.hintText}>
                You both enjoy {profile.tier} matches and private conversations.
              </Text>
            </View>
          </LinearGradient>
        </ScrollView>
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  phone: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 430,
    backgroundColor: '#1E2224',
    overflow: 'hidden',
  },
  dots: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  dot: {
    position: 'absolute',
    width: 2,
    height: 2,
    borderRadius: 1,
    backgroundColor: '#FFF7EA',
  },
  header: {
    height: 48,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 247, 234, 0.34)',
  },
  headerText: {
    flex: 1,
    color: '#FFF7EA',
    fontSize: 14,
    fontWeight: '800',
  },
  scroll: {
    paddingHorizontal: 16,
    paddingBottom: 36,
  },
  card: {
    minHeight: 610,
    borderRadius: 8,
    paddingHorizontal: 34,
    paddingTop: 12,
    paddingBottom: 30,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E8DCCB',
  },
  title: {
    color: '#9B7C10',
    fontFamily: 'serif',
    fontSize: 32,
    fontStyle: 'italic',
    fontWeight: '900',
  },
  subtitle: {
    marginTop: 2,
    color: '#755E66',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.3,
  },
  stackStage: {
    width: 220,
    height: 210,
    marginTop: 48,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  backCard: {
    position: 'absolute',
    left: 72,
    top: 40,
    width: 118,
    height: 132,
    borderRadius: 24,
    backgroundColor: '#FFFDF8',
    borderWidth: 1,
    borderColor: '#EFE8DE',
    boxShadow: Platform.OS === 'web' ? '0 12px 20px rgba(76, 0, 84, 0.12)' : undefined,
  },
  frontCard: {
    width: 138,
    height: 150,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFDF8',
    boxShadow: Platform.OS === 'web' ? '0 16px 26px rgba(76, 0, 84, 0.18)' : undefined,
  },
  miniHeart: {
    position: 'absolute',
    top: 15,
    left: 15,
  },
  matchPhoto: {
    width: 86,
    height: 86,
    borderRadius: 43,
    opacity: 1.0,
  },
  heartSeal: {
    position: 'absolute',
    right: -8,
    bottom: 30,
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFDF8',
    borderWidth: 1,
    borderColor: '#9E7F12',
  },
  namesRow: {
    width: 150,
    marginTop: -6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  matchName: {
    color: '#4B0054',
    fontFamily: 'serif',
    fontSize: 17,
    fontWeight: '900',
  },
  youName: {
    color: '#4B0054',
    fontFamily: 'serif',
    fontSize: 17,
    fontWeight: '900',
  },
  primaryAction: {
    width: '100%',
    height: 42,
    marginTop: 45,
    borderRadius: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#FFFDF8',
    boxShadow: Platform.OS === 'web' ? '0 8px 14px rgba(75, 0, 84, 0.14)' : undefined,
  },
  primaryActionText: {
    color: '#4B0054',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  callRow: {
    width: '100%',
    marginTop: 16,
    flexDirection: 'column',
    gap: 12,
  },
  smallAction: {
    flex: 1,
    height: 40,
    borderRadius: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#FFFDF8',
    boxShadow: Platform.OS === 'web' ? '0 8px 14px rgba(75, 0, 84, 0.12)' : undefined,
  },
  smallActionText: {
    color: '#4B0054',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  outlineAction: {
    width: '100%',
    height: 42,
    marginTop: 16,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    backgroundColor: '#FFFDF8',
    borderWidth: 1,
    borderColor: '#E6DAC1',
  },
  outlineActionText: {
    color: '#4B0054',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.4,
  },
  sharedHint: {
    width: '100%',
    marginTop: 44,
    minHeight: 54,
    borderRadius: 9,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#EEE4D3',
    backgroundColor: 'rgba(255, 253, 248, 0.62)',
  },
  hintIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF6DA',
  },
  hintText: {
    flex: 1,
    color: '#C0B7AA',
    fontSize: 10,
    lineHeight: 15,
    fontWeight: '800',
  },
});

```


# src\screens\OtpScreen.tsx
```tsx
import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Platform,
  ScrollView,
  Pressable,
  ActivityIndicator
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import ScreenShell from '../components/ScreenShell';
import { skeuo, skeuoGradients } from '../theme/skeuomorphic';
import { verifyOTP, sendOTP } from '../services/authService';

type OtpScreenProps = {
  navigate: (screen: string, params?: any) => void;
  goBack: () => void;
  route: any;
};

const NUMPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'backspace'];

// Module-level variables for OTP rate limiting rules
let otpRequestTime: number = Date.now();
let singleRequestErrors: number = 0;
let sequentialErrors: number = 0;
let blockUntil: number = 0;

export default function OtpScreen({ navigate, goBack, route }: OtpScreenProps) {
  const phone = route?.params?.phone || '';
  const authMode = route?.params?.authMode || 'signup';

  const [otp, setOtp] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [resendTimer, setResendTimer] = useState(90);
  const [blockRemaining, setBlockRemaining] = useState(0);

  useEffect(() => {
    // Reset timers when mounted
    otpRequestTime = Date.now();
    singleRequestErrors = 0;
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      if (blockUntil > now) {
        setBlockRemaining(Math.ceil((blockUntil - now) / 1000));
      } else {
        setBlockRemaining(0);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let interval: any;
    if (resendTimer > 0) {
      interval = setInterval(() => {
        setResendTimer((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [resendTimer]);

  const handlePress = (val: string) => {
    if (val === '') return;
    if (val === 'backspace') {
      setOtp((o) => o.slice(0, -1));
    } else {
      if (otp.length < 6) setOtp((o) => o + val);
    }
  };

  const handleContinue = async () => {
    if (blockRemaining > 0) {
      setErrorMsg(`Too many incorrect attempts. Please try again in ${Math.ceil(blockRemaining / 60)} minutes.`);
      return;
    }

    if (otp.length === 6) {
      if (Date.now() - otpRequestTime > 5 * 60 * 1000) {
        setErrorMsg("OTP expired. Please request a new one.");
        return;
      }

      setIsLoading(true);
      setErrorMsg('');
      try {
        const result = await verifyOTP(phone, otp, authMode);
        
        singleRequestErrors = 0;
        sequentialErrors = 0;

        if (authMode === 'signup') {
          navigate('ProfileDetails', { phone: phone, token: result.token });
        } else {
          // App.tsx onAuthStateChanged will detect login and automatically navigate
        }
      } catch (error: any) {
        singleRequestErrors++;
        sequentialErrors++;

        if (sequentialErrors >= 3) {
          blockUntil = Date.now() + 60 * 60 * 1000; // 1 hour
          setErrorMsg("You have entered an incorrect OTP too many times. Blocked for 1 hour.");
          setBlockRemaining(60 * 60);
        } else if (singleRequestErrors >= 3) {
          blockUntil = Date.now() + 5 * 60 * 1000; // 5 mins
          setErrorMsg("Too many incorrect attempts for this OTP. Blocked for 5 minutes.");
          setBlockRemaining(5 * 60);
        } else {
          setErrorMsg(error.message || "Invalid OTP code");
        }
      } finally {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isLoading) return;
      if (e.key >= '0' && e.key <= '9') {
        handlePress(e.key);
      } else if (e.key === 'Backspace') {
        handlePress('backspace');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (otp.length === 6) {
          handleContinue();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [otp, isLoading]);

  const formatOtp = (o: string) => {
    return o.padEnd(6, '-').split('').join(' ');
  };

  return (
    <ScreenShell tone="light">
      <ScrollView 
        contentContainerStyle={[styles.container, { flexGrow: 1 }]} 
        bounces={false} 
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack} style={styles.backBtn}>
            <MaterialIcons name="arrow-back" size={24} color="#5A155A" />
          </TouchableOpacity>
          <Text style={styles.brand}>Gengal</Text>
          <View style={{ width: 44 }} />
        </View>

        <View style={styles.titleSection}>
          <Text style={styles.title}>Verify Identity</Text>
          <Text style={styles.subtitle}>
            Enter the 6-digit code sent to {phone}
          </Text>
          {errorMsg ? <Text style={{color: '#ef4444', marginTop: 8, fontSize: 13, textAlign: 'center'}}>{errorMsg}</Text> : null}
        </View>

        <View style={styles.inputWrapper}>
          <View style={styles.inputBox}>
            <Text 
              style={[styles.inputTextCenter, !otp && styles.placeholderText, { flex: 1 }, Platform.OS === 'web' && { outlineStyle: 'none' } as any]}
            >
              {formatOtp(otp)}
            </Text>
          </View>
        </View>

        <View style={styles.numpadContainer}>
          {NUMPAD.map((key, i) => {
            if (key === '') {
              return <View key={i} style={styles.numpadKey} />;
            }
            return (
              <Pressable
                key={i}
                onPress={() => handlePress(key)}
                style={({ pressed }) => [
                  styles.numpadKey, 
                  styles.numpadKeyElevated,
                  pressed && { transform: [{ translateY: 2 }], boxShadow: 'none' }
                ]}
              >
                {key === 'backspace' ? (
                  <MaterialIcons name="backspace" size={20} color="#3A0D3A" />
                ) : (
                  <Text style={styles.numpadText}>{key}</Text>
                )}
              </Pressable>
            );
          })}
        </View>

        <View style={styles.footer}>
          <Pressable
            disabled={otp.length < 6 || isLoading}
            onPress={handleContinue}
          >
            {({ pressed }) => (
              <View style={[
                styles.continueButtonWrapper,
                (otp.length < 6 || isLoading) && styles.disabledWrapper,
                pressed && { elevation: 0, shadowOpacity: 0, boxShadow: 'none' }
              ]}>
                <LinearGradient
                  colors={[...skeuoGradients.gold]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[styles.continueButton, pressed && { transform: [{ translateY: 2 }] }]}
                >
                  {isLoading ? (
                    <ActivityIndicator color="#422006" />
                  ) : (
                    <>
                      <Text style={styles.continueText}>Verify & Proceed</Text>
                      <MaterialIcons name="arrow-forward" size={18} color="#422006" />
                    </>
                  )}
                </LinearGradient>
              </View>
            )}
          </Pressable>

          <View style={{ alignItems: 'center' }}>
            <TouchableOpacity 
              activeOpacity={resendTimer > 0 ? 1 : 0.7} 
              style={[styles.toggleAuthModeBtn, { marginTop: 10 }]}
              onPress={async () => {
                if (resendTimer === 0) {
                  setIsLoading(true);
                  setErrorMsg('');
                  try {
                    await sendOTP(phone);
                    setResendTimer(90);
                    otpRequestTime = Date.now();
                    singleRequestErrors = 0;
                  } catch (error: any) {
                    setErrorMsg(error.message || "Failed to resend OTP");
                  } finally {
                    setIsLoading(false);
                  }
                }
              }}
            >
              <Text style={[styles.toggleAuthModeText, resendTimer > 0 && { opacity: 0.5 }]}>
                {resendTimer > 0 ? `Resend OTP in ${resendTimer}s` : 'Resend OTP'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 40,
    paddingHorizontal: 30,
    backgroundColor: skeuo.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FAF5EE',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  brand: {
    color: skeuo.plum,
    fontFamily: 'serif',
    fontSize: 28,
    fontWeight: '900',
  },
  titleSection: {
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontFamily: 'serif',
    fontSize: 24,
    fontWeight: '700',
    color: skeuo.plum,
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 20,
  },
  inputWrapper: {
    alignItems: 'center',
    marginBottom: 20,
  },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: skeuo.surfaceInset,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: skeuo.border,
    paddingVertical: 20,
    paddingHorizontal: 20,
    width: '100%',
    boxShadow: Platform.OS === 'web' ? skeuo.insetShadow : undefined,
    elevation: 2,
    shadowColor: '#533A1D',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  inputTextCenter: {
    fontSize: 26,
    fontWeight: '600',
    color: '#1A1A1A',
    letterSpacing: 8,
    textAlign: 'center',
  },
  placeholderText: {
    color: '#D1D5DB',
  },
  numpadContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 15,
    width: '100%',
    marginBottom: 20,
  },
  numpadKey: {
    width: '28%',
    aspectRatio: 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  numpadKeyElevated: {
    backgroundColor: skeuo.surfaceRaised,
    borderWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
    elevation: 5,
    shadowColor: '#533A1D',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
  },
  numpadText: {
    fontFamily: 'serif',
    fontSize: 24,
    fontWeight: '700',
    color: '#321151',
  },
  footer: {
    marginTop: 'auto',
    marginBottom: 20,
  },
  continueButtonWrapper: {
    borderRadius: 16,
    backgroundColor: '#D0A92E',
    boxShadow: Platform.OS === 'web' ? skeuo.deepShadow : undefined,
    elevation: 8,
    shadowColor: '#533A1D',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
  },
  disabledWrapper: {
    opacity: 0.5,
  },
  continueButton: {
    flexDirection: 'row',
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    overflow: 'hidden',
  },
  continueText: {
    color: '#422006',
    fontSize: 15,
    fontWeight: '700',
  },
  toggleAuthModeBtn: {
    marginTop: 12,
    alignItems: 'center',
    paddingVertical: 10,
  },
  toggleAuthModeText: {
    color: '#5A155A',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
});

```


# src\screens\PersonalScreen.tsx
```tsx
import React, { useMemo, useState, useEffect } from 'react';
import { Platform, Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View, } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import Svg, { Circle, Path, G } from 'react-native-svg';
import ScreenShell from '../components/ScreenShell';
import TopBar from '../components/TopBar';
import BottomNav from '../components/BottomNav';
import DiamondBadge from '../components/DiamondBadge';
import GengalAvatar from '../components/GengalAvatar';
import { skeuo } from '../theme/skeuomorphic';

import CallPriceTag from '../components/CallPriceTag';
import { subscribeToOnlineUsers, UserProfile as FirebaseUser } from '../services/userService';
import { findMatch } from '../services/matchService';
import { auth } from '../config/firebase';
import { useUser } from '../context/UserContext';
import ConnectingOverlay from '../components/ConnectingOverlay';

type MatchNode = {
  uid?: string;
  name: string;
  age: number;
  language: string;
  tier: 'Elite' | 'VIP';
  side: 'left' | 'right';
  image: string;
  avatarData?: any;
  modes: Array<'call' | 'video'>;
};

type PersonalScreenProps = {
  navigate: (screen: string, params?: any) => void;
};

// Moved constants inside component to make them reactive

// PROFILE_PATH_POINTS removed because paths are generated dynamically
function heartPath(x: number, y: number, scale = 1) {
  return [
    `M ${x} ${y + 58 * scale}`,
    `C ${x - 12 * scale} ${y + 45 * scale}, ${x - 78 * scale} ${y + 5 * scale}, ${x - 78 * scale} ${y - 40 * scale}`,
    `C ${x - 78 * scale} ${y - 86 * scale}, ${x - 22 * scale} ${y - 99 * scale}, ${x} ${y - 58 * scale}`,
    `C ${x + 22 * scale} ${y - 99 * scale}, ${x + 78 * scale} ${y - 86 * scale}, ${x + 78 * scale} ${y - 40 * scale}`,
    `C ${x + 78 * scale} ${y + 5 * scale}, ${x + 12 * scale} ${y + 45 * scale}, ${x} ${y + 58 * scale}`,
    'Z',
  ].join(' ');
}

function PathBackground({ matchCount, isEndRight }: { matchCount: number; isEndRight: boolean }) {
  if (matchCount === 0) return null;

  const points = Array.from({ length: matchCount }).map((_, i) => ({
    x: i % 2 === 0 ? 79 : 351,
    y: 250 + i * 200
  }));

  const cardBottomY = 244 + (matchCount - 1) * 200;
  const buttonCenterY = cardBottomY + 113;
  const endY = buttonCenterY;
  const endX = isEndRight ? 360 : 70;
  const lastPoint = points[points.length - 1];

  let d = `M 215 55 C 160 120, 79 160, 79 250`;
  
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    d += ` C ${prev.x} ${prev.y + 90}, ${curr.x} ${curr.y - 100}, ${curr.x} ${curr.y}`;
  }

  // The '...' button is horizontally between the last card and the random button.
  // We can just curve the line to pass perfectly through the center of the elements.
  const moreButtonX = isEndRight ? 260 : 170; // rough guess based on flex-end/flex-start and gaps
  
  // Curve from last point down to the more button, then to the random button
  d += ` C ${lastPoint.x} ${lastPoint.y + 60}, ${moreButtonX} ${endY}, ${endX} ${endY}`;

  const svgHeight = endY + 100;
  
  const junctions = [];
  for (let y = 350; y < points[points.length - 1].y; y += 200) {
    junctions.push({
      y,
      x: ((y - 350) / 200) % 2 === 0 ? 215 : 210
    });
  }

  return (
    <Svg
      pointerEvents="none"
      width="100%"
      height={svgHeight}
      viewBox={`0 0 430 ${svgHeight}`}
      preserveAspectRatio="none"
      style={styles.pathLayer}
    >
      <Path
        d={d}
        fill="none"
        stroke="rgba(166, 132, 35, 0.48)"
        strokeWidth={2.2}
        strokeDasharray="5 8"
        strokeLinecap="round"
      />

      {points.map((point, index) => {
        const rotation = index % 2 === 0 ? 15 : -15;
        return (
          <G key={`heart-${point.y}`} transform={`rotate(${rotation}, ${point.x}, ${point.y})`}>
            <Path
              d={heartPath(point.x, point.y, index % 2 === 0 ? 1 : 0.96)}
              fill="rgba(255, 237, 241, 0.12)"
              stroke="rgba(195, 156, 169, 0.42)"
              strokeWidth={1.8}
              strokeDasharray="4 7"
              strokeLinecap="round"
            />
          </G>
        );
      })}

      {junctions.map((j) => (
        <Path
          key={`junction-${j.y}`}
          d={heartPath(j.x, j.y, 0.12)}
          fill="#F4A2B4"
          stroke="#FFFCF7"
          strokeWidth={3}
        />
      ))}

      <Circle cx={215} cy={55} r={4} fill="#C5A444" />
      <Circle cx={endX} cy={endY} r={4} fill="#C5A444" />
    </Svg>
  );
}

function ModeButton({
  mode,
  node,
  navigate,
}: {
  mode: 'call' | 'video';
  node: MatchNode;
  navigate: PersonalScreenProps['navigate'];
}) {
  const isVideo = mode === 'video';

  return (
    <TouchableOpacity
      activeOpacity={0.84}
      style={styles.modeButton}
      onPress={() => navigate('Call', { profileName: node.name, mode, isCaller: true, matchData: node })}
    >
      <MaterialIcons
        name={isVideo ? 'videocam' : 'phone'}
        size={17}
        color="#FFF7FF"
      />
      <Text style={styles.modeText}>
        {isVideo ? 'Video' : 'Call'}
      </Text>
      <CallPriceTag mode={mode} />
    </TouchableOpacity>
  );
}

function AvatarNode({
  node,
  navigate,
}: {
  node: MatchNode;
  navigate: PersonalScreenProps['navigate'];
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.86}
      style={[styles.avatarNode, node.side === 'right' && styles.avatarNodeRight]}
      onPress={() => navigate('Profile', { profileName: node.name, matchData: node })}
    >
      <LinearGradient
        colors={['#FFF4CA', '#9C8215', '#EAD06F']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.matchRing}
      >
        <View style={styles.matchPhotoInner}>
          {node.avatarData ? (
            <GengalAvatar data={node.avatarData} size={86} />
          ) : (
            <Image source={{ uri: node.image }} style={styles.matchPhoto} />
          )}
        </View>
      </LinearGradient>

      <TouchableOpacity style={styles.likeBubble} activeOpacity={0.8}>
        <MaterialIcons name="favorite-border" size={22} color="#897006" />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

function InfoCard({
  node,
  navigate,
}: {
  node: MatchNode;
  navigate: PersonalScreenProps['navigate'];
}) {
  return (
    <View style={[styles.infoCard, node.side === 'right' && styles.infoCardLeft]}>
      <TouchableOpacity
        activeOpacity={0.78}
        style={styles.infoTap}
        onPress={() => navigate('Profile', { profileName: node.name, matchData: node })}
      >
        <View style={styles.memberBadge}>
          <MaterialIcons name="diamond" size={9} color="#B68D1C" />
          <Text style={styles.memberBadgeText}>{node.tier}</Text>
        </View>
        <View style={styles.nameRow}>
          {node.side === 'right' ? <Text style={styles.age}>{node.age}</Text> : null}
          <Text style={styles.matchName} numberOfLines={1} adjustsFontSizeToFit>
            {node.name}
          </Text>
          {node.side === 'left' ? <Text style={styles.age}>{node.age}</Text> : null}
        </View>
        <View style={styles.profileLanguageRow}>
          <MaterialIcons name="language" size={12} color="#B18A20" />
          <Text style={styles.profileLanguage}>{node.language}</Text>
        </View>
      </TouchableOpacity>
      <View style={styles.modeRow}>
        {node.modes.map((mode) => (
          <ModeButton key={mode} mode={mode} node={node} navigate={navigate} />
        ))}
      </View>
    </View>
  );
}

function LanguageFilter({
  selected,
  onSelect,
  languages,
  navigate,
}: {
  selected: string;
  onSelect: (lang: string) => void;
  languages: string[];
  navigate: PersonalScreenProps['navigate'];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedLabel = selected === 'ALL'
    ? 'All languages'
    : selected.charAt(0) + selected.slice(1).toLowerCase();

  const selectLanguage = (language: string) => {
    onSelect(language);
    setIsOpen(false);
  };

  return (
    <View style={[styles.languageFilter, { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }]}>
      <TouchableOpacity
        activeOpacity={0.8}
        style={styles.languageSelect}
        onPress={() => setIsOpen(true)}
      >
        <View style={styles.languageSelectIcon}>
          <MaterialIcons name="translate" size={15} color="#8C7209" />
        </View>
        <Text style={styles.languageSelectText}>{selectedLabel}</Text>
        <MaterialIcons name="keyboard-arrow-down" size={20} color="#8E8379" />
      </TouchableOpacity>



      <Modal
        visible={isOpen}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setIsOpen(false)}
      >
        <View style={styles.languageModal}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setIsOpen(false)} />
          <View style={styles.languageSheet}>
            <View style={styles.languageSheetHeader}>
              <View style={styles.languageSheetTitleRow}>
                <MaterialIcons name="translate" size={18} color="#8C7209" />
                <Text style={styles.languageSheetTitle}>Choose language</Text>
              </View>
              <TouchableOpacity style={styles.languageClose} onPress={() => setIsOpen(false)}>
                <MaterialIcons name="close" size={20} color="#746A62" />
              </TouchableOpacity>
            </View>

            <View style={styles.languageList}>
              {languages.map((language) => {
                const isSelected = language === selected;
                const label = language === 'ALL'
                  ? 'All languages'
                  : language.charAt(0) + language.slice(1).toLowerCase();
                return (
                  <TouchableOpacity
                    key={language}
                    activeOpacity={0.76}
                    style={[styles.languageOption, isSelected && styles.languageOptionSelected]}
                    onPress={() => selectLanguage(language)}
                  >
                    <Text style={[styles.languageOptionText, isSelected && styles.languageOptionTextSelected]}>
                      {label}
                    </Text>
                    {isSelected ? (
                      <MaterialIcons name="check-circle" size={20} color="#5A075F" />
                    ) : (
                      <View style={styles.languageOptionCircle} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function MatchRow({
  node,
  index,
  navigate,
}: {
  node: MatchNode;
  index: number;
  navigate: PersonalScreenProps['navigate'];
}) {
  const isLeft = node.side === 'left';

  return (
    <View style={[styles.matchRow, index === 0 && styles.firstRow, isLeft ? styles.matchRowLeft : styles.matchRowRight]}>
        {isLeft ? (
          <>
            <AvatarNode node={node} navigate={navigate} />
            <InfoCard node={node} navigate={navigate} />
          </>
        ) : (
          <>
            <InfoCard node={node} navigate={navigate} />
            <AvatarNode node={node} navigate={navigate} />
          </>
        )}
    </View>
  );
}

export default function PersonalScreen({ navigate }: PersonalScreenProps) {
  const [selectedLanguage, setSelectedLanguage] = useState('ALL');
  const [firebaseUsers, setFirebaseUsers] = useState<FirebaseUser[]>([]);
  const { profile: myProfile } = useUser();
  const [isSearching, setIsSearching] = useState(false);
  const [searchCleanup, setSearchCleanup] = useState<(() => void) | null>(null);

  const handleRandomMatch = async () => {
    if (!myProfile) return;
    if (isSearching) {
      if (searchCleanup) searchCleanup();
      setIsSearching(false);
      setSearchCleanup(null);
      return;
    }
    setIsSearching(true);
    try {
      const cleanup = await findMatch(myProfile, (roomId, matchData) => {
        setIsSearching(false);
        setSearchCleanup(null);
        navigate('Match', { profileName: matchData.nickname, matchData, roomId } as any);
      });
      setSearchCleanup(() => cleanup);
    } catch {
      setIsSearching(false);
    }
  };

  useEffect(() => {
    const unsubscribe = subscribeToOnlineUsers((users) => {
      setFirebaseUsers(users);
    }, auth.currentUser?.uid);
    return () => {
      unsubscribe();
    };
  }, []);

  const combinedProfiles = useMemo(() => {
    return firebaseUsers.map(u => ({
      uid: u.uid,
      name: u.nickname || u.username || 'User',
      age: u.age || 20,
      lang: u.language || 'EN',
      tier: u.tier || 'Elite',
      uri: u.avatarUrl || 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?q=80&w=200&auto=format&fit=crop',
      avatarData: u.avatarData,
      modes: ['call', 'video'] as Array<'call' | 'video'>
    }));
  }, [firebaseUsers]);

  const MATCHES: MatchNode[] = useMemo(() => {
    return combinedProfiles.map((profile, index) => ({
      uid: profile.uid,
      name: profile.name,
      age: profile.age as number,
      language: profile.lang,
      tier: profile.tier as any,
      side: index % 2 === 0 ? 'left' : 'right',
      image: profile.uri,
      avatarData: (profile as any).avatarData,
      modes: profile.modes,
    }));
  }, [combinedProfiles]);

  const LANGUAGES = useMemo(() => ['ALL', ...Array.from(new Set(combinedProfiles.map(p => p.lang)))], [combinedProfiles]);

  const sortedMatches = useMemo(() => {
    const ordered = selectedLanguage === 'ALL'
      ? MATCHES
      : [
          ...MATCHES.filter((match) => match.language === selectedLanguage),
          ...MATCHES.filter((match) => match.language !== selectedLanguage),
        ];

    return ordered.map((match, index) => ({
      ...match,
      side: (index % 2 === 0 ? 'left' : 'right') as MatchNode['side'],
    }));
  }, [selectedLanguage, MATCHES]);

  const isEndRight = sortedMatches.length % 2 !== 0;

  return (
    <ScreenShell tone="light">
      <View style={styles.phone}>
        {isSearching && (
          <ConnectingOverlay
            mode="random"
            onCancel={() => {
              if (searchCleanup) searchCleanup();
              setIsSearching(false);
              setSearchCleanup(null);
            }}
          />
        )}
        <TopBar navigate={navigate} />

        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
        >
          <PathBackground matchCount={sortedMatches.length} isEndRight={isEndRight} />



          <LanguageFilter selected={selectedLanguage} onSelect={setSelectedLanguage} languages={LANGUAGES} navigate={navigate} />

          <View style={styles.matchList}>
            {sortedMatches.map((node, index) => (
              <MatchRow key={node.name} node={node} index={index} navigate={navigate} />
            ))}
          </View>

          <View style={[
            styles.randomWrap,
            !isEndRight ? { justifyContent: 'flex-start', paddingLeft: 28, paddingRight: 0 } : {}
          ]}>
            {!isEndRight && (
              <View>
                <TouchableOpacity activeOpacity={0.85} style={styles.randomButton} onPress={handleRandomMatch}>
                  <MaterialIcons name={isSearching ? 'close' : 'favorite-border'} size={38} color="#887006" />
                </TouchableOpacity>
                <Text style={styles.randomLabel}>{isSearching ? 'Cancel' : 'Random Match'}</Text>
              </View>
            )}

            <TouchableOpacity 
              activeOpacity={0.85} 
              style={styles.moreButton}
              onPress={() => navigate('ActiveConnects')}
            >
              <MaterialIcons name="more-horiz" size={32} color="#887006" />
            </TouchableOpacity>

            {isEndRight && (
              <View>
                <TouchableOpacity activeOpacity={0.85} style={styles.randomButton} onPress={handleRandomMatch}>
                  <MaterialIcons name={isSearching ? 'close' : 'favorite-border'} size={38} color="#887006" />
                </TouchableOpacity>
                <Text style={styles.randomLabel}>{isSearching ? 'Cancel' : 'Random Match'}</Text>
              </View>
            )}
          </View>
        </ScrollView>

        <BottomNav active="Personal" navigate={navigate} />
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  phone: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 430,
    backgroundColor: 'transparent',
  },
  header: {
    height: 72,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#F0E9DF',
    backgroundColor: '#FFFCF7',
    boxShadow: Platform.OS === 'web' ? '0 6px 22px rgba(88, 61, 27, 0.06)' : undefined,
  },
  avatarRing: {
    width: 44,
    height: 44,
    borderRadius: 22,
    padding: 2,
    borderWidth: 2,
    borderColor: '#D4B142',
    backgroundColor: '#FFFDF8',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  headerAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: 19,
  },
  brand: {
    flex: 1,
    textAlign: 'center',
    paddingHorizontal: 8,
    color: '#4B0054',
    fontFamily: 'serif',
    fontSize: 28,
    fontWeight: '900',
  },
  scroll: {
    flexGrow: 1,
    paddingTop: 34,
    paddingBottom: 126,
  },
  heroTitle: {
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 24,
    marginBottom: 20,
  },
  title: {
    width: '100%',
    textAlign: 'center',
    color: '#4B0054',
    fontFamily: 'serif',
    fontSize: 30,
    fontWeight: '900',
  },
  subtitle: {
    width: '100%',
    textAlign: 'center',
    color: '#9D9798',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  languageFilter: {
    alignItems: 'center',
    marginBottom: 34,
  },
  languageSelect: {
    width: 176,
    height: 40,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    gap: 8,
    backgroundColor: 'rgba(255, 253, 248, 0.94)',
    borderWidth: 1,
    borderColor: '#E6DAC1',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  languageSelectIcon: {
    width: 27,
    height: 27,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF2C7',
  },
  languageSelectText: {
    flex: 1,
    color: '#5D3E50',
    fontSize: 12,
    fontWeight: '900',
  },
  languageModal: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(45, 21, 40, 0.26)',
  },
  languageSheet: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 430,
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 28,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    backgroundColor: '#FFFCF7',
    boxShadow: Platform.OS === 'web' ? '0 -14px 32px rgba(57, 34, 48, 0.16)' : undefined,
  },
  languageSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 14,
  },
  languageSheetTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  languageSheetTitle: {
    color: '#4F174F',
    fontFamily: 'serif',
    fontSize: 19,
    fontWeight: '800',
  },
  languageClose: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F4EEE5',
  },
  languageList: {
    gap: 5,
  },
  languageOption: {
    height: 43,
    borderRadius: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  languageOptionSelected: {
    backgroundColor: '#F9ECF8',
  },
  languageOptionText: {
    color: '#786E67',
    fontSize: 13,
    fontWeight: '800',
  },
  languageOptionTextSelected: {
    color: '#5A075F',
  },
  languageOptionCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#D9CEC0',
  },
  matchList: {
    gap: 64,
  },
  matchRow: {
    minHeight: 136,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 22,
    gap: 10,
    width: '100%',
  },
  matchRowLeft: {
    justifyContent: 'flex-start',
  },
  matchRowRight: {
    justifyContent: 'flex-end',
  },
  firstRow: {
    marginTop: 6,
  },
  avatarNode: {
    width: 114,
    alignItems: 'center',
  },
  avatarNodeRight: {
    marginTop: -10,
  },
  matchRing: {
    width: 96,
    height: 96,
    borderRadius: 48,
    padding: 3,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  matchPhotoInner: {
    flex: 1,
    borderRadius: 45,
    padding: 2,
    backgroundColor: '#FFFDF8',
    overflow: 'hidden',
  },
  matchPhoto: {
    width: '100%',
    height: '100%',
    borderRadius: 43,
  },
  likeBubble: {
    position: 'absolute',
    right: 2,
    bottom: 28,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFDF8',
    borderWidth: 2,
    borderColor: '#D9BB56',
    boxShadow: Platform.OS === 'web' ? '0 7px 14px rgba(74, 0, 78, 0.16)' : undefined,
  },
  infoCard: {
    minWidth: 140,
    alignItems: 'flex-end',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 253, 248, 0.9)',
    borderWidth: 1,
    borderColor: '#EEE4D3',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  infoCardLeft: {
    alignItems: 'flex-start',
  },
  infoTap: {
    width: '100%',
    gap: 5,
  },
  memberBadge: {
    alignSelf: 'flex-start',
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#FFF4CF',
    borderWidth: 1,
    borderColor: '#E3C867',
  },
  memberBadgeText: {
    color: '#8A6715',
    fontSize: 8,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  matchName: {
    flexShrink: 1,
    color: '#56105C',
    fontFamily: 'serif',
    fontSize: 20,
    fontWeight: '800',
  },
  age: {
    color: '#A8A2A3',
    fontSize: 13,
    lineHeight: 23,
    fontWeight: '700',
  },
  profileLanguageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  profileLanguage: {
    color: '#9A856E',
    fontSize: 9,
    fontWeight: '900',
  },
  modeRow: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
  },
  modeButton: {
    height: 30,
    minWidth: 58,
    borderRadius: 15,
    paddingHorizontal: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#4B0054',
    borderWidth: 1,
    borderColor: '#4B0054',
    boxShadow: Platform.OS === 'web' ? '0 8px 14px rgba(75, 0, 84, 0.22)' : undefined,
  },
  modeText: {
    color: '#FFF7FF',
    fontSize: 10,
    fontWeight: '900',
  },
  randomWrap: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingRight: 28,
    marginTop: 72,
    gap: 16,
  },
  moreButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFDF8',
    borderWidth: 2,
    borderColor: '#D2B243',
    boxShadow: Platform.OS === 'web' ? skeuo.deepShadow : undefined,
  },
  randomButton: {
    width: 82,
    height: 82,
    borderRadius: 41,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFDF8',
    borderWidth: 3,
    borderColor: '#D2B243',
    boxShadow: Platform.OS === 'web' ? skeuo.deepShadow : undefined,
  },
  randomLabel: {
    position: 'absolute',
    bottom: -24,
    width: 120,
    textAlign: 'center',
    left: '50%',
    marginLeft: -60,
    color: '#A2871A',
    fontFamily: 'serif',
    fontSize: 13,
    fontWeight: '800',
  },
  pathLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
});

```


# src\screens\PhoneScreen.tsx
```tsx
import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  TextInput,
  Platform,
  ScrollView,
  Pressable,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import ScreenShell from '../components/ScreenShell';
import { skeuo, skeuoGradients } from '../theme/skeuomorphic';
import { sendOTP, verifyOTP, loginWithPassword, checkUserExists } from '../services/authService';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../config/firebase';
import { ActivityIndicator } from 'react-native';

type PhoneScreenProps = {
  navigate: (screen: string, params?: any) => void;
  goBack?: () => void;
  route?: any;
};

const NUMPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'backspace'];

export let globalAuthMode: 'signup' | 'login' = 'signup';

export default function PhoneScreen({ navigate, goBack, route }: PhoneScreenProps) {
  const [authMode, setAuthMode] = useState<'signup' | 'login'>('signup');
  const [phone, setPhone] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [countryCode, setCountryCode] = useState('+1');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (route?.params?.phone) {
      const p = route.params.phone;
      if (p.startsWith('+')) {
        const spaceIdx = p.indexOf(' ') !== -1 ? p.indexOf(' ') : (p.length > 10 ? p.length - 10 : 2);
        setCountryCode(p.substring(0, spaceIdx));
        setPhone(p.substring(spaceIdx).trim());
      } else {
        setPhone(p);
      }
    }
  }, [route?.params?.phone]);

  const cycleCountryCode = () => {
    const codes = ['+1', '+91', '+44', '+61', '+33', '+49'];
    const currentIndex = codes.indexOf(countryCode);
    const nextIndex = (currentIndex + 1) % codes.length;
    setCountryCode(codes[nextIndex]);
  };

  useEffect(() => {
    globalAuthMode = authMode;
  }, [authMode]);

  useEffect(() => {
    fetch('https://ipwho.is/')
      .then((res) => res.json())
      .then((data) => {
        if (data?.calling_code) {
          setCountryCode('+' + data.calling_code);
        } else {
          throw new Error('Fallback');
        }
      })
      .catch(() => {
        try {
          const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
          if (tz.includes('Kolkata') || tz.includes('Calcutta')) setCountryCode('+91');
          else if (tz.includes('London')) setCountryCode('+44');
          else if (tz.includes('Sydney') || tz.includes('Melbourne')) setCountryCode('+61');
          else if (tz.includes('Paris')) setCountryCode('+33');
          else if (tz.includes('Berlin')) setCountryCode('+49');
        } catch (err) {
          console.log(err);
        }
      });
  }, []);

  const handlePress = (val: string) => {
    if (val === '') return;
    if (val === 'backspace') {
      setPhone((p) => p.slice(0, -1));
    } else {
      if (phone.length < 10) setPhone((p) => p + val);
    }
  };

  const handleContinue = async () => {
    if (phone.length === 10) {
      setIsLoading(true);
      setErrorMsg('');
      try {
        const fullPhone = countryCode + phone;

        try {
          const userExists = await checkUserExists(fullPhone);

          if (userExists) {
            navigate('LoginPassword', { phone: fullPhone, authMode: 'login' });
          } else {
            await sendOTP(fullPhone);
            navigate('Otp', { phone: fullPhone, authMode: 'signup' });
          }
        } catch (dbError: any) {
          throw dbError;
        }
      } catch (error: any) {
        setErrorMsg(error.message || "Failed to proceed");
      } finally {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isLoading) return;
      
      if (e.key >= '0' && e.key <= '9') {
        handlePress(e.key);
      } else if (e.key === 'Backspace') {
        handlePress('backspace');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (phone.length === 10) {
          handleContinue();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [phone, isLoading, authMode, countryCode]);

  const formatPhone = (p: string) => {
    if (!p) return '0000000000';
    return p;
  };

  return (
    <ScreenShell tone="light">
      <ScrollView 
        contentContainerStyle={[styles.phoneContainer, { flexGrow: 1 }]} 
        bounces={false} 
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.brand}>Gengal</Text>
        </View>

        <View style={styles.titleSection}>
          <Text style={styles.title}>
            Enter Phone Number
          </Text>
          <Text style={styles.subtitle}>
            Enter your mobile number to continue
          </Text>
          {errorMsg ? <Text style={{color: '#ef4444', marginTop: 8, fontSize: 13, textAlign: 'center'}}>{errorMsg}</Text> : null}
        </View>

        <View style={styles.inputWrapper}>
          <View style={styles.inputBox}>
            <TouchableOpacity 
              style={styles.flagContainer} 
              activeOpacity={0.7} 
              onPress={cycleCountryCode}
            >
              <MaterialIcons name="flag" size={16} color="#5A155A" />
              <Text style={styles.countryCode}>{countryCode}</Text>
              <View style={styles.divider} />
            </TouchableOpacity>
            <Text 
              style={[styles.inputText, !phone && styles.placeholderText, { flex: 1 }, Platform.OS === 'web' && { outlineStyle: 'none' } as any]}
            >
              {phone ? formatPhone(phone) : '0000000000'}
            </Text>
          </View>
        </View>

        <View style={styles.numpadContainer}>
          {NUMPAD.map((key, i) => {
            if (key === '') {
              return <View key={i} style={styles.numpadKey} />;
            }
            return (
              <Pressable
                key={i}
                onPress={() => handlePress(key)}
                style={({ pressed }) => [
                  styles.numpadKey, 
                  styles.numpadKeyElevated,
                  pressed && { transform: [{ translateY: 2 }], boxShadow: 'none' }
                ]}
              >
                {key === 'backspace' ? (
                  <MaterialIcons name="backspace" size={20} color="#3A0D3A" />
                ) : (
                  <Text style={styles.numpadText}>{key}</Text>
                )}
              </Pressable>
            );
          })}
        </View>
        
        <View style={styles.footer}>
          <Pressable
            disabled={phone.length < 10 || isLoading}
            onPress={handleContinue}
          >
            {({ pressed }) => (
              <View style={[
                styles.continueButtonWrapper,
                (phone.length < 10) && styles.disabledWrapper,
                pressed && { elevation: 0, shadowOpacity: 0, boxShadow: 'none' }
              ]}>
                <LinearGradient
                  colors={[...skeuoGradients.gold]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[styles.continueButton, pressed && { transform: [{ translateY: 2 }] }]}
                >
                  {isLoading ? (
                    <ActivityIndicator color="#422006" />
                  ) : (
                    <>
                      <Text style={styles.continueText}>
                        Continue
                      </Text>
                      <MaterialIcons name="arrow-forward" size={18} color="#422006" />
                    </>
                  )}
                </LinearGradient>
              </View>
            )}
          </Pressable>

        </View>
      </ScrollView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  phoneContainer: {
    paddingTop: 40,
    paddingHorizontal: 30,
    backgroundColor: skeuo.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FAF5EE',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  brand: {
    color: skeuo.plum,
    fontFamily: 'serif',
    fontSize: 28,
    fontWeight: '900',
  },
  titleSection: {
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontFamily: 'serif',
    fontSize: 24,
    fontWeight: '700',
    color: skeuo.plum,
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 20,
  },
  inputWrapper: {
    alignItems: 'center',
    marginBottom: 20,
  },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: skeuo.surfaceInset,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: skeuo.border,
    paddingVertical: 20,
    paddingHorizontal: 20,
    width: '100%',
    boxShadow: Platform.OS === 'web' ? skeuo.insetShadow : undefined,
    elevation: 2,
    shadowColor: '#533A1D',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  flagContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 15,
  },
  countryCode: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1A1A',
    marginLeft: 6,
  },
  divider: {
    width: 1,
    height: 20,
    backgroundColor: '#E5E7EB',
    marginLeft: 15,
  },
  inputText: {
    flex: 1,
    fontSize: 22,
    fontWeight: '600',
    color: '#1A1A1A',
    letterSpacing: 2,
  },
  placeholderText: {
    color: '#D1D5DB',
  },
  numpadContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 15,
    width: '100%',
    marginBottom: 20,
  },
  numpadKey: {
    width: '28%',
    aspectRatio: 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  numpadKeyElevated: {
    backgroundColor: skeuo.surfaceRaised,
    borderWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
    elevation: 5,
    shadowColor: '#533A1D',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
  },
  numpadText: {
    fontFamily: 'serif',
    fontSize: 24,
    fontWeight: '700',
    color: '#321151',
  },
  footer: {
    marginTop: 'auto',
    marginBottom: 20,
  },
  continueButtonWrapper: {
    borderRadius: 16,
    backgroundColor: '#D0A92E',
    boxShadow: Platform.OS === 'web' ? skeuo.deepShadow : undefined,
    elevation: 8,
    shadowColor: '#533A1D',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
  },
  disabledWrapper: {
    opacity: 0.5,
  },
  continueButton: {
    flexDirection: 'row',
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    overflow: 'hidden',
  },
  continueText: {
    color: '#422006',
    fontSize: 15,
    fontWeight: '700',
  },
  toggleAuthModeBtn: {
    marginTop: 12,
    alignItems: 'center',
    paddingVertical: 10,
  },
  toggleAuthModeText: {
    color: '#5A155A',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
});

```


# src\screens\ProfileDetailsScreen.tsx
```tsx
import React, { useEffect, useState } from 'react';
import { Platform, ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Modal,
  Pressable
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { collection, getDocs, query, where } from 'firebase/firestore';
import DiamondBadge from '../components/DiamondBadge';
import { AvatarData, DEFAULT_AVATAR_DNA } from '../components/GengalAvatar';
import { auth, db } from '../config/firebase';
import { getUserProfile, saveUserProfile } from '../services/userService';
import { skeuo, skeuoGradients } from '../theme/skeuomorphic';

const COUNTRY_LANGUAGE_MAP: Record<string, string[]> = {
  'United States': ['English', 'Spanish'],
  'India': ['Hindi', 'English', 'Bengali', 'Telugu', 'Marathi', 'Tamil', 'Urdu', 'Gujarati', 'Kannada', 'Odia', 'Malayalam'],
  'United Kingdom': ['English', 'Welsh', 'Scottish Gaelic'],
  'Canada': ['English', 'French'],
  'Australia': ['English'],
  'Germany': ['German', 'English'],
  'France': ['French', 'English'],
  'Japan': ['Japanese', 'English'],
  'Brazil': ['Portuguese', 'Spanish', 'English'],
  'Mexico': ['Spanish', 'English'],
  'South Africa': ['Zulu', 'Xhosa', 'Afrikaans', 'English'],
  'China': ['Mandarin', 'Cantonese', 'English'],
};
const COUNTRIES = Object.keys(COUNTRY_LANGUAGE_MAP).sort();

type ProfileDetailsScreenProps = {
  navigate: (screen: string, params?: any) => void;
  route: any;
};

export default function ProfileDetailsScreen({ navigate, route }: ProfileDetailsScreenProps) {
  const isEditMode = route?.params?.isEditMode || false;
  const returnTo = route?.params?.returnTo || 'Settings';
  const [nickname, setNickname] = useState(route?.params?.nickname || '');
  const [username, setUsername] = useState(route?.params?.name || '');
  const [age, setAge] = useState(route?.params?.dob ? String(route.params.dob) : '');
  const [gender, setGender] = useState<'Masculine' | 'Feminine' | ''>(route?.params?.gender || '');
  const [country, setCountry] = useState(route?.params?.country || '');
  const [stateText, setStateText] = useState(route?.params?.state || '');
  const [city, setCity] = useState(route?.params?.city || '');
  const [language, setLanguage] = useState(route?.params?.language || '');
  const [bio, setBio] = useState(route?.params?.bio || '');
  const [isLoading, setIsLoading] = useState(false);
  const [usernameError, setUsernameError] = useState(false);
  const [ageError, setAgeError] = useState(false);
  
  const [isCountryModalVisible, setIsCountryModalVisible] = useState(false);
  const [isLanguageModalVisible, setIsLanguageModalVisible] = useState(false);

  const handleUsernameChange = (val: string) => {
    setUsername(val);
    const usernameRegex = /^[a-z0-9_]*$/;
    if (!usernameRegex.test(val)) {
      setUsernameError(true);
    } else {
      setUsernameError(false);
    }
  };

  const handleAgeChange = (val: string) => {
    setAge(val);
    if (val && parseInt(val, 10) < 18) {
      setAgeError(true);
    } else {
      setAgeError(false);
    }
  };
  const avatarData = route?.params?.avatarData || { ...DEFAULT_AVATAR_DNA, isPremiumConfig: true };

  useEffect(() => {
    const fetchProfile = async () => {
      if (!auth.currentUser) return;
      try {
        const profile = await getUserProfile(auth.currentUser.uid);
        if (!profile) return;
        // Only override if we don't already have draft values from params
        if (profile.nickname && !route?.params?.nickname) setNickname(profile.nickname);
        if (profile.username && !route?.params?.name) setUsername(profile.username);
        if (profile.age && !route?.params?.dob) setAge(profile.age.toString());
        if (profile.gender && !route?.params?.gender) setGender(profile.gender as any);
        if (profile.country && !route?.params?.country) setCountry(profile.country);
        if (profile.state && !route?.params?.state) setStateText(profile.state);
        if (profile.city && !route?.params?.city) setCity(profile.city);
        if (profile.language && !route?.params?.language) setLanguage(profile.language);
        if (profile.bio && !route?.params?.bio) setBio(profile.bio);
      } catch (e) {
        console.warn('Could not fetch existing profile', e);
      }
    };
    fetchProfile();
  }, [route?.params]);

  const handleBack = () => {
    if (isEditMode) {
      navigate(returnTo);
    } else {
      navigate('Phone', { step: 'phone', reset: true });
    }
  };

  const handleComplete = async () => {
    if (!nickname || !username || !age || !gender || !country || !language) {
      Alert.alert('Missing Fields', 'Please fill in all mandatory fields (Nickname, Username, Age, Gender, Country, Language).');
      return;
    }

    const usernameRegex = /^[a-z0-9_]+$/;
    if (!usernameRegex.test(username) || usernameError) {
      Alert.alert('Invalid Username', 'Username can only contain lowercase letters, numbers, and underscores.');
      return;
    }

    if (parseInt(age, 10) < 18 || ageError) {
      Alert.alert('Invalid Age', 'You must be 18 or older to join.');
      return;
    }

    setIsLoading(true);
    try {
      const cleanUsername = username.trim().toLowerCase();
      const usersRef = collection(db, 'users');
      const q = query(usersRef, where('username', '==', cleanUsername));
      const querySnapshot = await getDocs(q);
      let isUnique = true;

      // Ensure username is globally unique across all users
      if (!querySnapshot.empty) {
        querySnapshot.forEach((docSnap) => {
          if (docSnap.id !== auth.currentUser?.uid) {
            isUnique = false;
          }
        });
      }

      if (!isUnique) {
        Alert.alert('Username Taken', 'This username is already in use. Please choose another one.');
        setIsLoading(false);
        return;
      }

      if (isEditMode) {
        if (auth.currentUser) {
          await saveUserProfile(auth.currentUser.uid, {
            nickname: nickname.trim(),
            username: cleanUsername,
            age: parseInt(age, 10) || age,
            gender,
            country,
            state: stateText,
            city,
            language,
            bio: bio.trim()
          });
          Alert.alert('Success', 'Profile updated successfully!');
          navigate(returnTo);
        }
      } else {
        navigate('Avatar', {
          phone: route?.params?.phone,
          token: route?.params?.token,
          name: cleanUsername,
          nickname: nickname.trim(),
          dob: parseInt(age, 10) || age,
          gender,
          country,
          state: stateText,
          city,
          language,
          bio: bio.trim()
        });
      }

    } catch (error) {
      console.error('Failed to verify username:', error);
      Alert.alert('Error', 'Could not verify username. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.stageHeader}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <MaterialIcons name="arrow-back" size={23} color={skeuo.plum} />
        </TouchableOpacity>
        <Text style={styles.brand}>Gengal</Text>
        <DiamondBadge compact />
      </View>

      <View style={styles.contentArea}>
        <ScrollView contentContainerStyle={styles.infoContainer}>
          <Text style={styles.infoTitle}>Profile Details</Text>

          <View style={styles.formGroup}>
            <Text style={styles.label}>NICKNAME</Text>
            <TextInput style={styles.input} value={nickname} onChangeText={setNickname} />
            <Text style={styles.hintText}>Your public display name</Text>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>BIO (Optional)</Text>
            <TextInput style={[styles.input, { height: 80, paddingTop: 14 }]} value={bio} onChangeText={setBio} multiline numberOfLines={3} placeholder="Tell us about yourself..." placeholderTextColor="#A0A0A0" />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>USERNAME</Text>
            <TextInput style={[styles.input, usernameError && styles.inputError]} value={username} onChangeText={handleUsernameChange} autoCapitalize="none" />
            <Text style={[styles.hintText, usernameError && styles.hintError]}>Only lowercase letters, numbers, and underscores</Text>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>AGE</Text>
            <TextInput style={[styles.input, ageError && styles.inputError]} value={age} onChangeText={handleAgeChange} keyboardType="numeric" />
            <Text style={[styles.hintText, ageError && styles.hintError]}>Must be 18 or older to join</Text>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>COUNTRY (Required)</Text>
            <TouchableOpacity 
              style={[styles.input, { justifyContent: 'center' }]} 
              activeOpacity={0.8}
              onPress={() => setIsCountryModalVisible(true)}
            >
              <Text style={{ color: country ? skeuo.plum : '#A0A0A0', fontSize: 16, fontWeight: '700' }}>
                {country || 'Select a country...'}
              </Text>
              <MaterialIcons name="arrow-drop-down" size={24} color={skeuo.plum} style={{ position: 'absolute', right: 12 }} />
            </TouchableOpacity>
          </View>

          {country ? (
            <View style={styles.formGroup}>
              <Text style={styles.label}>LANGUAGE (Required)</Text>
              <TouchableOpacity 
                style={[styles.input, { justifyContent: 'center' }]} 
                activeOpacity={0.8}
                onPress={() => setIsLanguageModalVisible(true)}
              >
                <Text style={{ color: language ? skeuo.plum : '#A0A0A0', fontSize: 16, fontWeight: '700' }}>
                  {language || 'Select your primary language...'}
                </Text>
                <MaterialIcons name="arrow-drop-down" size={24} color={skeuo.plum} style={{ position: 'absolute', right: 12 }} />
              </TouchableOpacity>
            </View>
          ) : null}

          <View style={styles.formGroup}>
            <Text style={styles.label}>STATE / REGION (Optional)</Text>
            <TextInput style={styles.input} value={stateText} onChangeText={setStateText} placeholder="e.g. California" placeholderTextColor="#A0A0A0" />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>CITY (Optional)</Text>
            <TextInput style={styles.input} value={city} onChangeText={setCity} placeholder="e.g. Los Angeles" placeholderTextColor="#A0A0A0" />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>IDENTITY</Text>
            <View style={styles.genderToggleFrame}>
              <TouchableOpacity style={[styles.toggleBtn, gender === 'Masculine' && styles.activeMasculine]} onPress={() => setGender('Masculine')}>
                <Text style={[styles.toggleBtnText, gender === 'Masculine' && styles.textActive]}>MASCULINE</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.toggleBtn, gender === 'Feminine' && styles.activeFeminine]} onPress={() => setGender('Feminine')}>
                <Text style={[styles.toggleBtnText, gender === 'Feminine' && styles.textActive]}>FEMININE</Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity style={styles.saveActionBtn} onPress={handleComplete} disabled={isLoading} activeOpacity={0.86}>
            <LinearGradient colors={[...skeuoGradients.gold]} style={styles.saveGradient}>
              {isLoading ? <ActivityIndicator color="#4A3600" /> : <Text style={styles.saveActionText}>SAVE PROFILE</Text>}
            </LinearGradient>
          </TouchableOpacity>
        </ScrollView>
      </View>

      <Modal visible={isCountryModalVisible} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setIsCountryModalVisible(false)}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Select Country</Text>
            <ScrollView>
              {COUNTRIES.map((c) => (
                <TouchableOpacity 
                  key={c} 
                  style={[styles.modalItem, country === c && styles.modalItemActive]}
                  onPress={() => {
                    setCountry(c);
                    setLanguage('');
                    setIsCountryModalVisible(false);
                  }}
                >
                  <Text style={[styles.modalItemText, country === c && styles.modalItemTextActive]}>{c}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={isLanguageModalVisible} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setIsLanguageModalVisible(false)}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Select Language</Text>
            <ScrollView>
              {country && COUNTRY_LANGUAGE_MAP[country]?.map((l) => (
                <TouchableOpacity 
                  key={l} 
                  style={[styles.modalItem, language === l && styles.modalItemActive]}
                  onPress={() => {
                    setLanguage(l);
                    setIsLanguageModalVisible(false);
                  }}
                >
                  <Text style={[styles.modalItemText, language === l && styles.modalItemTextActive]}>{l}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: skeuo.surface },
  stageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 14,
    backgroundColor: skeuo.surfaceRaised,
    borderBottomWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? '0 8px 18px rgba(83, 58, 29, 0.10)' : undefined,
  },
  brand: { color: skeuo.plum, fontFamily: 'serif', fontSize: 28, fontWeight: '900' },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: skeuo.surfaceRaised,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  contentArea: { flex: 1 },
  infoContainer: { paddingHorizontal: 24, paddingTop: 28, paddingBottom: 112 },
  infoTitle: { color: skeuo.plum, fontFamily: 'serif', fontSize: 30, fontWeight: '900', marginBottom: 22 },
  successBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F8EA',
    padding: 12,
    borderRadius: 16,
    marginBottom: 22,
    gap: 8,
    borderWidth: 1,
    borderColor: '#D7EDC8',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  successText: { color: '#4F8B36', fontSize: 13, fontWeight: '800' },
  formGroup: { marginBottom: 18 },
  label: { fontSize: 11, fontWeight: '900', color: '#9A8772', marginBottom: 8, letterSpacing: 1.1 },
  input: {
    backgroundColor: skeuo.surfaceInset,
    borderRadius: 18,
    height: 54,
    paddingHorizontal: 17,
    color: skeuo.plum,
    fontSize: 16,
    fontWeight: '700',
    borderWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? skeuo.insetShadow : undefined,
  },
  pickerContainer: {
    backgroundColor: skeuo.surfaceInset,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? skeuo.insetShadow : undefined,
    overflow: 'hidden',
  },
  picker: {
    height: 54,
    color: skeuo.plum,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxHeight: '70%',
    backgroundColor: skeuo.surfaceInset,
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
    elevation: 10,
    shadowColor: '#533A1D',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: skeuo.plum,
    marginBottom: 16,
    textAlign: 'center',
  },
  modalItem: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(217, 197, 139, 0.3)',
  },
  modalItemActive: {
    backgroundColor: 'rgba(212, 154, 11, 0.15)',
    borderRadius: 12,
    borderBottomWidth: 0,
  },
  modalItemText: {
    fontSize: 16,
    color: skeuo.plum,
    fontWeight: '600',
  },
  modalItemTextActive: {
    color: '#D49A0B',
    fontWeight: '800',
  },
  hintText: {
    fontSize: 11,
    color: '#9A8772',
    marginTop: 6,
    marginLeft: 4,
    fontStyle: 'italic',
  },
  inputError: {
    borderColor: '#D32F2F',
    backgroundColor: '#FFEBEE',
  },
  hintError: {
    color: '#D32F2F',
    fontWeight: '700',
  },
  genderToggleFrame: {
    flexDirection: 'row',
    backgroundColor: skeuo.surfaceInset,
    padding: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? skeuo.insetShadow : undefined,
  },
  toggleBtn: { flex: 1, height: 42, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  activeMasculine: { backgroundColor: skeuo.surfaceRaised, borderWidth: 1, borderColor: skeuo.border, boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined },
  activeFeminine: { backgroundColor: skeuo.surfaceRaised, borderWidth: 1, borderColor: skeuo.border, boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined },
  toggleBtnText: { fontSize: 12, fontWeight: '900', color: '#9A8772', letterSpacing: 1 },
  textActive: { color: skeuo.plum },
  saveActionBtn: { width: '100%', height: 58, borderRadius: 29, marginTop: 30, overflow: 'hidden', boxShadow: Platform.OS === 'web' ? skeuo.goldShadow : undefined },
  saveGradient: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  saveActionText: { color: '#563F00', fontWeight: '900', fontSize: 14, letterSpacing: 1.6 },
});

```


# src\screens\ProfileScreen.tsx
```tsx
import React, { useState, useEffect } from 'react';
import { ActivityIndicator, Platform, Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View, } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import ScreenShell from '../components/ScreenShell';
import BottomNav from '../components/BottomNav';

import { useUser } from '../context/UserContext';
import { subscribeToOnlineUsers, saveUserProfile, followUser, unfollowUser, UserProfile as FirebaseUser } from '../services/userService';
import GengalAvatar from '../components/GengalAvatar';
import CallPriceTag from '../components/CallPriceTag';
import { auth } from '../config/firebase';

type ProfileScreenProps = {
  profileName?: string;
  navigate: (screen: string, params?: any) => void;
  route?: any;
};

function ModeButton({
  mode,
  profile,
  navigate,
}: {
  mode: 'call' | 'video';
  profile: any;
  navigate: ProfileScreenProps['navigate'];
}) {
  const isVideo = mode === 'video';

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      style={[styles.modeButton, isVideo && styles.modeButtonVideo]}
      onPress={() => navigate('Call', { profileName: (profile as any).name || (profile as any).nickname || (profile as any).username, mode, isCaller: true })}
    >
      <MaterialIcons
        name={isVideo ? 'videocam' : 'phone'}
        size={19}
        color={isVideo ? '#FFF7FF' : '#836A07'}
      />
      <Text style={[styles.modeText, isVideo && styles.modeTextVideo]}>
        {isVideo ? 'Video' : 'Call'}
      </Text>
      <CallPriceTag mode={mode} />
    </TouchableOpacity>
  );
}

export default function ProfileScreen({ profileName, navigate, route }: ProfileScreenProps) {
  const [firebaseUsers, setFirebaseUsers] = useState<FirebaseUser[]>([]);
  const { profile: myProfile } = useUser();
  
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editForm, setEditForm] = useState({
    nickname: '',
    age: '',
    language: '',
    avatarUrl: ''
  });

  useEffect(() => {
    const unsubscribeUsers = subscribeToOnlineUsers((users) => {
      setFirebaseUsers(users);
    }, auth.currentUser?.uid);
    
    return () => {
      unsubscribeUsers();
    };
  }, []);

  const allProfiles = [
    ...firebaseUsers.map(u => ({
      name: u.nickname || u.username || 'User',
      age: u.age || 20,
      lang: u.language || 'EN',
      tier: u.tier || 'Elite',
      uri: u.avatarUrl || 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?q=80&w=200&auto=format&fit=crop',
      avatarData: u.avatarData,
      bio: u.bio || '',
      followers: Array.isArray(u.followers) ? u.followers.length.toString() : (u.followers?.toString() || '0'),
      following: Array.isArray(u.following) ? u.following.length.toString() : (u.following?.toString() || '0'),
      modes: ['call', 'video'] as Array<'call' | 'video'>
    })),
    ...(myProfile ? [{
      name: myProfile.nickname || myProfile.username || 'User',
      age: myProfile.age || 20,
      lang: myProfile.language || 'EN',
      tier: myProfile.tier || 'Elite',
      uri: myProfile.avatarUrl || 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?q=80&w=200&auto=format&fit=crop',
      avatarData: myProfile.avatarData,
      bio: myProfile.bio || '',
      followers: Array.isArray(myProfile.followers) ? myProfile.followers.length.toString() : (myProfile.followers?.toString() || '0'),
      following: Array.isArray(myProfile.following) ? myProfile.following.length.toString() : (myProfile.following?.toString() || '0'),
      modes: ['call', 'video'] as Array<'call' | 'video'>
    }] : [])
  ];

  const matchData = route?.params?.matchData;
  let profile = matchData ? {
    name: matchData.name || matchData.nickname || 'User',
    age: matchData.age || 20,
    lang: matchData.lang || matchData.language || 'EN',
    tier: matchData.tier || 'Elite',
    uri: matchData.uri || matchData.avatarUrl || 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?q=80&w=200&auto=format&fit=crop',
    avatarData: matchData.avatarData,
    bio: matchData.bio || '',
    followers: matchData.followers?.toString() || '0',
    following: matchData.following?.toString() || '0',
    modes: matchData.modes || ['call', 'video']
  } : allProfiles.find((p) => p.name === profileName) ?? allProfiles[allProfiles.length - 1];

  if (!profile && myProfile) {
    profile = allProfiles[allProfiles.length - 1];
  }

  const isCurrentUser = !profileName || profile?.name === (myProfile?.nickname || myProfile?.username || 'User');

  const targetUid = route?.params?.matchData?.uid || route?.params?.uid;
  const myFollowing: string[] = Array.isArray(myProfile?.following) ? (myProfile!.following as string[]) : [];
  const [isFollowing, setIsFollowing] = useState(() => targetUid ? myFollowing.includes(targetUid) : false);
  const [isBlocked, setIsBlocked] = useState(false);

  useEffect(() => {
    if (targetUid) {
      const updatedFollowing: string[] = Array.isArray(myProfile?.following) ? (myProfile!.following as string[]) : [];
      setIsFollowing(updatedFollowing.includes(targetUid));
    }
  }, [myProfile?.following, targetUid]);

  if (!profile) {
    return (
      <ScreenShell tone="light">
        <View style={[styles.phone, { justifyContent: 'center', alignItems: 'center', flex: 1 }]}>
          <ActivityIndicator size="large" color="#5A075F" />
        </View>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell tone="light">
      <View style={styles.phone}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} activeOpacity={0.78} onPress={() => navigate('Home')}>
            <MaterialIcons name="arrow-back" size={22} color="#5A075F" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{isCurrentUser ? 'My Profile' : 'Profile'}</Text>
          <TouchableOpacity 
            style={styles.headerIcon} 
            activeOpacity={0.8}
            onPress={() => isCurrentUser && navigate('Settings')}
          >
            <MaterialIcons name={isCurrentUser ? 'settings' : 'favorite-border'} size={22} color="#92750B" />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
        >
          <LinearGradient
            colors={['#FFFDF8', '#F8F0E5']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.heroCard}
          >
            <LinearGradient
              colors={['#FFF0C7', '#9D8216', '#F3DA79']}
              start={{ x: 0.1, y: 0 }}
              end={{ x: 0.9, y: 1 }}
              style={styles.avatarRing}
            >
              <View style={styles.avatarInner}>
                {(profile as any).avatarData ? (
                  <GengalAvatar data={(profile as any).avatarData} size={118} />
                ) : (
                  <Image source={{ uri: profile.uri }} style={styles.avatar} />
                )}
              </View>
            </LinearGradient>

            <View style={styles.tierPill}>
              <MaterialIcons name="diamond" size={12} color="#B68D1C" />
              <Text style={styles.tierText}>{profile.tier}</Text>
            </View>

            <Text style={styles.name}>{profile.name}, {profile.age}</Text>
            <View style={styles.languageRow}>
              <MaterialIcons name="language" size={15} color="#B68D1C" />
              <Text style={styles.language}>{profile.lang}</Text>
            </View>

            <View style={styles.statusRow}>
              <View style={styles.onlineDot} />
              <Text style={styles.statusText}>Online now</Text>
            </View>

            <View style={styles.statsRow}>
              <TouchableOpacity style={styles.statItem} activeOpacity={0.78}>
                <Text style={styles.statValue}>{profile.followers}</Text>
                <Text style={styles.statLabel}>Followers</Text>
              </TouchableOpacity>
              <View style={styles.statDivider} />
              <TouchableOpacity style={styles.statItem} activeOpacity={0.78}>
                <Text style={styles.statValue}>{profile.following}</Text>
                <Text style={styles.statLabel}>Following</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.bio}>{profile.bio}</Text>
          </LinearGradient>

          <View style={styles.actionPanel}>
            {isCurrentUser ? (
              <>
                <Text style={styles.panelTitle}>Your profile</Text>
                <View style={styles.ownerActions}>
                  <TouchableOpacity 
                    style={styles.ownerButton} 
                    activeOpacity={0.82}
                    onPress={() => {
                      navigate('ProfileDetails', {
                        isEditMode: true,
                        returnTo: 'Profile',
                        name: myProfile?.username || '',
                        nickname: myProfile?.nickname || '',
                        dob: myProfile?.age || '',
                        gender: myProfile?.gender || '',
                        country: myProfile?.country || '',
                        state: myProfile?.state || '',
                        city: myProfile?.city || '',
                        language: myProfile?.language || '',
                        bio: myProfile?.bio || '',
                      });
                    }}
                  >
                    <MaterialIcons name="edit" size={18} color="#836A07" />
                    <Text style={styles.ownerButtonText}>Edit Profile</Text>
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={styles.ownerButton} 
                    activeOpacity={0.82}
                    onPress={() => {
                      navigate('FinalizeInvite', {
                        isEditMode: true,
                        returnTo: 'Profile',
                        gender: myProfile?.gender || '',
                        existingAvatarData: myProfile?.avatarData
                      });
                    }}
                  >
                    <MaterialIcons name="face-retouching-natural" size={18} color="#836A07" />
                    <Text style={styles.ownerButtonText}>Edit Avatar</Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity 
                    style={styles.ownerButton} 
                    activeOpacity={0.82}
                    onPress={() => navigate('Earnings')}
                  >
                    <MaterialIcons name="account-balance-wallet" size={18} color="#836A07" />
                    <Text style={styles.ownerButtonText}>Earnings</Text>
                  </TouchableOpacity>


                </View>
              </>
            ) : (
              <>
                <View style={styles.panelHeaderRow}>
                  <Text style={styles.panelTitle}>Available now</Text>
                  <TouchableOpacity
                    activeOpacity={0.82}
                    style={[styles.followButton, isFollowing && styles.followingButton]}
                    onPress={async () => {
                      const myUid = auth.currentUser?.uid;
                      if (!myUid || !targetUid) {
                        setIsFollowing(true);
                        return;
                      }
                      try {
                        if (isFollowing) {
                          setIsFollowing(false);
                          await unfollowUser(myUid, targetUid);
                        } else {
                          setIsFollowing(true);
                          await followUser(myUid, targetUid);
                        }
                      } catch (e) {
                        setIsFollowing((prev) => !prev);
                      }
                    }}
                  >
                    <MaterialIcons
                      name={isFollowing ? 'check' : 'person-add-alt-1'}
                      size={16}
                      color={isFollowing ? '#806806' : '#FFF7FF'}
                    />
                    <Text style={[styles.followButtonText, isFollowing && styles.followingButtonText]}>
                      {isFollowing ? 'Following' : 'Follow'}
                    </Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.modeRow}>
                  {profile.modes.map((mode: any) => (
                    <ModeButton key={mode} mode={mode} profile={profile as any} navigate={navigate} />
                  ))}
                </View>
                <View style={styles.secondaryActions}>
                  <TouchableOpacity
                    activeOpacity={0.84}
                    style={styles.chatButton}
                    onPress={() => navigate('Chat', { profileName: profile.name })}
                  >
                    <MaterialIcons name="chat-bubble-outline" size={18} color="#4B0054" />
                    <Text style={styles.chatButtonText}>Chat</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    activeOpacity={0.84}
                    style={[styles.blockButton, isBlocked && styles.blockButtonActive]}
                    onPress={() => setIsBlocked((value) => !value)}
                  >
                    <MaterialIcons
                      name={isBlocked ? 'block' : 'person-off'}
                      size={18}
                      color={isBlocked ? '#FFFFFF' : '#8B2E2E'}
                    />
                    <Text style={[styles.blockButtonText, isBlocked && styles.blockButtonTextActive]}>
                      {isBlocked ? 'Blocked' : 'Block'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>

          <View style={styles.infoPanel}>
            <View style={styles.infoItem}>
              <MaterialIcons name="verified" size={20} color="#92750B" />
              <Text style={styles.infoText}>
                {isCurrentUser ? 'Your profile is premium verified' : 'Premium verified member'}
              </Text>
            </View>
            <View style={styles.infoItem}>
              <MaterialIcons name="schedule" size={20} color="#92750B" />
              <Text style={styles.infoText}>
                {isCurrentUser ? 'Manage followers and following here' : 'Usually responds quickly'}
              </Text>
            </View>
          </View>
        </ScrollView>

        <BottomNav active="Home" navigate={navigate} />
      </View>

      {isEditModalVisible && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Profile</Text>
              <TouchableOpacity onPress={() => setIsEditModalVisible(false)}>
                <MaterialIcons name="close" size={24} color="#5A155A" />
              </TouchableOpacity>
            </View>
            
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Name (Nickname)</Text>
              <TextInput
                style={styles.htmlInput as any}
                value={editForm.nickname}
                onChangeText={(text) => setEditForm(f => ({ ...f, nickname: text }))}
                placeholder="Enter your name"
                placeholderTextColor="#A8998C"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Age</Text>
              <TextInput
                style={styles.htmlInput as any}
                value={editForm.age}
                onChangeText={(text) => setEditForm(f => ({ ...f, age: text }))}
                placeholder="Enter your age"
                placeholderTextColor="#A8998C"
                keyboardType="numeric"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Language</Text>
              <TextInput
                style={styles.htmlInput as any}
                value={editForm.language}
                onChangeText={(text) => setEditForm(f => ({ ...f, language: text }))}
                placeholder="e.g. English, French"
                placeholderTextColor="#A8998C"
                autoCapitalize="words"
              />
            </View>
            
            <Text style={styles.modalHint}>Note: Username cannot be changed.</Text>

            <TouchableOpacity 
              style={[styles.saveButton, isSaving && { opacity: 0.7 }]} 
              activeOpacity={0.8}
              onPress={async () => {
                if (!auth.currentUser) return;
                setIsSaving(true);
                try {
                  const formattedLang = editForm.language
                    .trim()
                    .split(/\s+/)
                    .map(word => word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : '')
                    .join(' ');

                  await saveUserProfile(auth.currentUser.uid, {
                    nickname: editForm.nickname,
                    age: parseInt(editForm.age) || editForm.age,
                    language: formattedLang,
                    avatarUrl: myProfile?.avatarUrl || '' // Preserve existing or default
                  });
                  setIsEditModalVisible(false);
                } catch (e) {
                  console.error('Save failed', e);
                } finally {
                  setIsSaving(false);
                }
              }}
            >
              <Text style={styles.saveButtonText}>{isSaving ? 'Saving...' : 'Save Changes'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  phone: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 430,
    backgroundColor: '#FFFCF7',
  },
  header: {
    height: 70,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#F0E7DA',
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF8EA',
  },
  headerTitle: {
    color: '#4B0054',
    fontFamily: 'serif',
    fontSize: 28,
    fontWeight: '900',
  },
  headerIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF8EA',
  },
  scroll: {
    padding: 18,
    paddingBottom: 128,
    gap: 14,
  },
  heroCard: {
    minHeight: 300,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 20,
    borderWidth: 1,
    borderColor: '#EAD9AE',
    boxShadow: Platform.OS === 'web' ? '0 10px 22px rgba(68, 44, 21, 0.11)' : undefined,
  },
  avatarRing: {
    width: 128,
    height: 128,
    borderRadius: 64,
    padding: 4,
    boxShadow: Platform.OS === 'web' ? '0 12px 22px rgba(75, 0, 84, 0.16)' : undefined,
  },
  avatarInner: {
    flex: 1,
    borderRadius: 60,
    padding: 3,
    overflow: 'hidden',
    backgroundColor: '#FFFDF8',
  },
  avatar: {
    width: '100%',
    height: '100%',
    borderRadius: 57,
  },
  tierPill: {
    marginTop: -10,
    height: 26,
    paddingHorizontal: 12,
    borderRadius: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FFF8DD',
    borderWidth: 1,
    borderColor: '#E9D383',
  },
  tierText: {
    color: '#8F6920',
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  name: {
    marginTop: 12,
    color: '#4B0054',
    fontFamily: 'serif',
    fontSize: 28,
    fontWeight: '900',
  },
  languageRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  language: {
    color: '#9A856E',
    fontSize: 12,
    fontWeight: '900',
  },
  statusRow: {
    marginTop: 12,
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#F3FAED',
  },
  onlineDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#73BB58',
  },
  statusText: {
    color: '#5E8D48',
    fontSize: 12,
    fontWeight: '900',
  },
  statsRow: {
    width: '100%',
    marginTop: 14,
    borderRadius: 16,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 253, 248, 0.72)',
    borderWidth: 1,
    borderColor: '#EFE2C8',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  statValue: {
    color: '#4B0054',
    fontSize: 18,
    fontWeight: '900',
  },
  statLabel: {
    color: '#9A856E',
    fontSize: 10,
    fontWeight: '900',
  },
  statDivider: {
    width: 1,
    height: 30,
    backgroundColor: '#E8DCCB',
  },
  bio: {
    marginTop: 12,
    color: '#766A62',
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    fontWeight: '700',
  },
  actionPanel: {
    padding: 18,
    borderRadius: 18,
    backgroundColor: '#FFFDF8',
    borderWidth: 1,
    borderColor: '#EFE4D3',
    gap: 14,
    boxShadow: Platform.OS === 'web' ? '0 10px 22px rgba(70, 47, 27, 0.1)' : undefined,
  },
  panelTitle: {
    color: '#5C3B23',
    fontFamily: 'serif',
    fontSize: 18,
    fontWeight: '900',
  },
  panelHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  followButton: {
    height: 34,
    borderRadius: 17,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: '#4B0054',
  },
  followingButton: {
    backgroundColor: '#FFF5D8',
    borderWidth: 1,
    borderColor: '#E1C460',
  },
  followButtonText: {
    color: '#FFF7FF',
    fontSize: 11,
    fontWeight: '900',
  },
  followingButtonText: {
    color: '#806806',
  },
  ownerActions: {
    flexDirection: 'row',
    gap: 10,
  },
  ownerButton: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: '#FFF5D8',
    borderWidth: 1,
    borderColor: '#E1C460',
  },
  ownerButtonDark: {
    backgroundColor: '#4B0054',
    borderColor: '#4B0054',
  },
  ownerButtonText: {
    color: '#836A07',
    fontSize: 12,
    fontWeight: '900',
  },
  ownerButtonTextLight: {
    color: '#FFF7FF',
  },
  modeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  modeButton: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: '#FFF5D8',
    borderWidth: 1,
    borderColor: '#E1C460',
  },
  modeButtonVideo: {
    backgroundColor: '#4B0054',
    borderColor: '#4B0054',
  },
  modeText: {
    color: '#836A07',
    fontSize: 13,
    fontWeight: '900',
  },
  modeTextVideo: {
    color: '#FFF7FF',
  },
  secondaryActions: {
    flexDirection: 'row',
    gap: 10,
  },
  chatButton: {
    flex: 1,
    height: 42,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: '#FFFDF8',
    borderWidth: 1,
    borderColor: '#DCC7E1',
  },
  chatButtonText: {
    color: '#4B0054',
    fontSize: 12,
    fontWeight: '900',
  },
  blockButton: {
    flex: 1,
    height: 42,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: '#FFF6F1',
    borderWidth: 1,
    borderColor: '#E7B7A8',
  },
  blockButtonActive: {
    backgroundColor: '#8B2E2E',
    borderColor: '#8B2E2E',
  },
  blockButtonText: {
    color: '#8B2E2E',
    fontSize: 12,
    fontWeight: '900',
  },
  blockButtonTextActive: {
    color: '#FFFFFF',
  },
  infoPanel: {
    padding: 18,
    borderRadius: 18,
    backgroundColor: '#FFFDF8',
    borderWidth: 1,
    borderColor: '#EFE4D3',
    gap: 12,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  infoText: {
    color: '#74685F',
    fontSize: 13,
    fontWeight: '800',
  },
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(50, 16, 36, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modalContent: {
    width: '90%',
    maxWidth: 360,
    backgroundColor: '#FFFDF8',
    borderRadius: 20,
    padding: 24,
    boxShadow: Platform.OS === 'web' ? '0 20px 40px rgba(0,0,0,0.2)' : undefined,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    color: '#4B0054',
    fontFamily: 'serif',
    fontSize: 22,
    fontWeight: '900',
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    color: '#8A6715',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  htmlInput: {
    width: '100%',
    height: 44,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EFE4D3',
    backgroundColor: '#FFF',
    color: '#4B0054',
    fontSize: 15,
    fontWeight: '600',
  },
  modalHint: {
    color: '#A8998C',
    fontSize: 12,
    fontStyle: 'italic',
    marginBottom: 24,
    textAlign: 'center',
  },
  saveButton: {
    height: 48,
    borderRadius: 14,
    backgroundColor: '#4B0054',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: {
    color: '#FFF7FF',
    fontSize: 15,
    fontWeight: '800',
  },
});

```


# src\screens\SettingsScreen.tsx
```tsx
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, Platform, Modal } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { auth, db } from '../config/firebase';
import { deleteUser, signOut } from 'firebase/auth';
import { doc, deleteDoc } from 'firebase/firestore';
import ScreenShell from '../components/ScreenShell';

type SettingsScreenProps = {
  navigate: (screen: string, params?: any) => void;
};

export default function SettingsScreen({ navigate }: SettingsScreenProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      // App.tsx auth state listener should handle routing to Landing
    } catch (e) {
      Alert.alert('Error', 'Failed to log out.');
    }
  };

  const executeDelete = async () => {
    setShowDeleteModal(false);
    const user = auth.currentUser;
    if (!user) return;
    
    setIsDeleting(true);
    try {
      // Delete firestore document
      await deleteDoc(doc(db, 'users', user.uid));
      // Delete auth user
      await deleteUser(user);
      // Will automatically route to Landing via auth listener
    } catch (error: any) {
      console.error('Error deleting account', error);
      if (error.code === 'auth/requires-recent-login') {
        const msg = 'For security reasons, please log in again to verify your identity before deleting your account.';
        Platform.OS === 'web' ? window.alert('Security Verification: ' + msg) : Alert.alert('Security Verification', msg);
        await signOut(auth);
      } else {
        const msg = 'Could not delete account. Please try again.';
        Platform.OS === 'web' ? window.alert('Error: ' + msg) : Alert.alert('Error', msg);
      }
      setIsDeleting(false);
    }
  };

  const handleDeleteAccount = () => {
    setShowDeleteModal(true);
  };

  return (
    <ScreenShell tone="light">
      <View style={styles.phone}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} activeOpacity={0.78} onPress={() => navigate('Profile')}>
            <MaterialIcons name="arrow-back" size={22} color="#5A075F" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Settings</Text>
          <View style={{ width: 22 }} />
        </View>

        <View style={styles.content}>
          <TouchableOpacity style={styles.menuItem} activeOpacity={0.7} onPress={() => navigate('FinalizeInvite')}>
            <View style={styles.menuItemLeft}>
              <View style={[styles.iconBox, { backgroundColor: '#F3E8FF' }]}>
                <MaterialIcons name="face" size={20} color="#9333EA" />
              </View>
              <Text style={styles.menuItemText}>Edit Avatar & Profile</Text>
            </View>
            <MaterialIcons name="chevron-right" size={24} color="#CBD5E1" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem} activeOpacity={0.7} onPress={() => navigate('Language', { isEditMode: true, returnTo: 'Settings' })}>
            <View style={styles.menuItemLeft}>
              <View style={[styles.iconBox, { backgroundColor: '#FFEDD5' }]}>
                <MaterialIcons name="language" size={20} color="#F97316" />
              </View>
              <Text style={styles.menuItemText}>App Language</Text>
            </View>
            <MaterialIcons name="chevron-right" size={24} color="#CBD5E1" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem} activeOpacity={0.7} onPress={() => navigate('AdminPanel')}>
            <View style={styles.menuItemLeft}>
              <View style={[styles.iconBox, { backgroundColor: '#E0F2FE' }]}>
                <MaterialIcons name="admin-panel-settings" size={20} color="#0284C7" />
              </View>
              <Text style={styles.menuItemText}>Admin Panel</Text>
            </View>
            <MaterialIcons name="chevron-right" size={24} color="#CBD5E1" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem} activeOpacity={0.7} onPress={handleLogout}>
            <View style={styles.menuItemLeft}>
              <View style={[styles.iconBox, { backgroundColor: '#FEF3C7' }]}>
                <MaterialIcons name="logout" size={20} color="#D97706" />
              </View>
              <Text style={styles.menuItemText}>Logout</Text>
            </View>
            <MaterialIcons name="chevron-right" size={24} color="#CBD5E1" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem} activeOpacity={0.7} onPress={handleDeleteAccount} disabled={isDeleting}>
            <View style={styles.menuItemLeft}>
              <View style={[styles.iconBox, { backgroundColor: '#FEE2E2' }]}>
                {isDeleting ? (
                   <ActivityIndicator size="small" color="#DC2626" />
                ) : (
                   <MaterialIcons name="delete-forever" size={20} color="#DC2626" />
                )}
              </View>
              <Text style={[styles.menuItemText, { color: '#DC2626' }]}>Delete Account</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Custom Delete Confirmation Modal */}
        <Modal
          visible={showDeleteModal}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setShowDeleteModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalIconBox}>
                <MaterialIcons name="warning" size={32} color="#DC2626" />
              </View>
              <Text style={styles.modalTitle}>Delete Account?</Text>
              <Text style={styles.modalMessage}>
                Are you sure you want to permanently delete your account and all data? This action cannot be undone.
              </Text>
              
              <View style={styles.modalActions}>
                <TouchableOpacity 
                  style={[styles.modalBtn, styles.modalBtnCancel]} 
                  activeOpacity={0.7}
                  onPress={() => setShowDeleteModal(false)}
                >
                  <Text style={styles.modalBtnTextCancel}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.modalBtn, styles.modalBtnDelete]} 
                  activeOpacity={0.7}
                  onPress={executeDelete}
                >
                  <Text style={styles.modalBtnTextDelete}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  phone: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
    backgroundColor: '#FFFDF8',
    borderBottomWidth: 1,
    borderBottomColor: '#F1E9D2',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#422006',
    letterSpacing: -0.3,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F9F2EC',
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
    padding: 20,
    gap: 12,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuItemText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#334155',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
    boxShadow: Platform.OS === 'web' ? '0 10px 25px -5px rgba(0, 0, 0, 0.1)' : undefined,
  },
  modalIconBox: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FEE2E2',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1E293B',
    marginBottom: 12,
  },
  modalMessage: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  modalBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBtnCancel: {
    backgroundColor: '#F1F5F9',
  },
  modalBtnDelete: {
    backgroundColor: '#DC2626',
  },
  modalBtnTextCancel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#475569',
  },
  modalBtnTextDelete: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});

```


# src\services\adminService.ts
```ts
import { db } from '../config/firebase';
import { doc, getDoc, setDoc, updateDoc, onSnapshot } from 'firebase/firestore';

export interface GlobalSettings {
  voiceCallRatePerMin: number;
  videoCallRatePerMin: number;
  creatorSharePercentage: number; // 0 to 100
  femaleExpertHeartsThreshold: number;
  maleExpertRespectThreshold: number;
  callDurationForHeart: number; // in minutes
  heartToInrRate: number; // e.g., 3 Rs per Heart
  minRechargeAmount: number; // e.g., 49 Rs
  inrToCoinRechargeRate: number; // e.g., 1.1 Coins per Rs
}

const SETTINGS_DOC_ID = 'pricing';

/**
 * Ensures the global settings document exists with default values.
 */
export const initializeGlobalSettings = async () => {
  const settingsRef = doc(db, 'settings', SETTINGS_DOC_ID);
  const snap = await getDoc(settingsRef);
  if (!snap.exists()) {
    await setDoc(settingsRef, {
      voiceCallRatePerMin: 15,
      videoCallRatePerMin: 30,
      creatorSharePercentage: 70,
      femaleExpertHeartsThreshold: 50,
      maleExpertRespectThreshold: 30,
      callDurationForHeart: 3,
      heartToInrRate: 3,
      minRechargeAmount: 49,
      inrToCoinRechargeRate: 1.12
    });
  }
};

/**
 * Fetches the current global settings once.
 */
export const getGlobalSettings = async (): Promise<GlobalSettings> => {
  const settingsRef = doc(db, 'settings', SETTINGS_DOC_ID);
  const snap = await getDoc(settingsRef);
  if (snap.exists()) {
    return snap.data() as GlobalSettings;
  }
  return {
    voiceCallRatePerMin: 15,
    videoCallRatePerMin: 30,
    creatorSharePercentage: 70,
    femaleExpertHeartsThreshold: 50,
    maleExpertRespectThreshold: 30,
    callDurationForHeart: 3,
    heartToInrRate: 3,
    minRechargeAmount: 49,
    inrToCoinRechargeRate: 1.12
  };
};

/**
 * Subscribes to the global settings in real-time.
 */
export const subscribeToGlobalSettings = (callback: (settings: GlobalSettings) => void) => {
  const settingsRef = doc(db, 'settings', SETTINGS_DOC_ID);
  return onSnapshot(settingsRef, (snap) => {
    if (snap.exists()) {
      callback(snap.data() as GlobalSettings);
    } else {
      callback({
        voiceCallRatePerMin: 15,
        videoCallRatePerMin: 30,
        creatorSharePercentage: 70,
        femaleExpertHeartsThreshold: 50,
        maleExpertRespectThreshold: 30,
        callDurationForHeart: 3,
        heartToInrRate: 3,
        minRechargeAmount: 49,
        inrToCoinRechargeRate: 1.12
      });
    }
  });
};

/**
 * Updates the global settings. Requires admin privileges via security rules.
 */
export const updateGlobalSettings = async (newSettings: Partial<GlobalSettings>) => {
  const settingsRef = doc(db, 'settings', SETTINGS_DOC_ID);
  await updateDoc(settingsRef, newSettings);
};

```


# src\services\authService.ts
```ts
import { auth } from '../config/firebase';
import { 
  signInWithCustomToken,
  User,
} from 'firebase/auth';

import { Platform } from 'react-native';

const BACKEND_URL = Platform.OS === 'web' ? 'http://localhost:5000' : 'http://192.168.29.228:5000'; // Local backend URL

export const sendOTP = async (phoneNumber: string): Promise<void> => {
  try {
    const cleanPhone = phoneNumber.replace(/\s+/g, '');
    const formattedPhone = cleanPhone.startsWith('+') ? cleanPhone : `+1${cleanPhone}`;
    
    const response = await fetch(`${BACKEND_URL}/api/v1/auth/send-otp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Bypass-Tunnel-Reminder': 'true' // Bypass localtunnel warning page
      },
      body: JSON.stringify({ phone: formattedPhone }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to send OTP');
    }
  } catch (error) {
    console.error("Error sending Fast2SMS OTP", error);
    throw error;
  }
};

export const checkUserExists = async (phoneNumber: string): Promise<boolean> => {
  try {
    const cleanPhone = phoneNumber.replace(/\s+/g, '');
    const formattedPhone = cleanPhone.startsWith('+') ? cleanPhone : `+1${cleanPhone}`;
    
    const response = await fetch(`${BACKEND_URL}/api/v1/auth/check-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Bypass-Tunnel-Reminder': 'true'
      },
      body: JSON.stringify({ phone: formattedPhone }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to check user');
    }
    
    const data = await response.json();
    return data.exists;
  } catch (error) {
    console.error("Error checking user existence", error);
    throw error;
  }
};

export const verifyOTP = async (phoneNumber: string, code: string, authMode: 'signup' | 'login'): Promise<{user?: User, token?: string}> => {
  try {
    const cleanPhone = phoneNumber.replace(/\s+/g, '');
    const formattedPhone = cleanPhone.startsWith('+') ? cleanPhone : `+1${cleanPhone}`;

    const response = await fetch(`${BACKEND_URL}/api/v1/auth/verify-otp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Bypass-Tunnel-Reminder': 'true'
      },
      body: JSON.stringify({ phone: formattedPhone, otp: code }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Invalid OTP');
    }

    const data = await response.json();
    const token = data.token;

    if (authMode === 'login') {
      const userCredential = await signInWithCustomToken(auth, token);
      return { user: userCredential.user };
    } else {
      // In signup mode, just return the token so we can login at the VERY end
      return { token };
    }
  } catch (error) {
    console.error("Error verifying Fast2SMS OTP", error);
    throw error;
  }
};

export const loginWithPassword = async (phoneNumber: string, password: string): Promise<{user?: User, token?: string}> => {
  try {
    const cleanPhone = phoneNumber.replace(/\s+/g, '');
    const formattedPhone = cleanPhone.startsWith('+') ? cleanPhone : `+1${cleanPhone}`;

    const response = await fetch(`${BACKEND_URL}/api/v1/auth/login-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Bypass-Tunnel-Reminder': 'true'
      },
      body: JSON.stringify({ phone: formattedPhone, password }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Invalid credentials');
    }

    const data = await response.json();
    const token = data.token;
    const userCredential = await signInWithCustomToken(auth, token);
    return { user: userCredential.user, token };
  } catch (error) {
    console.error("Error logging in with password", error);
    throw error;
  }
};

export const logout = async () => {
  try {
    await auth.signOut();
  } catch (error) {
    console.error("Error logging out", error);
    throw error;
  }
};

```


# src\services\chatService.ts
```ts
import { db } from '../config/firebase';
import { 
  collection, 
  addDoc, 
  query, 
  orderBy, 
  onSnapshot,
  serverTimestamp,
  doc,
  setDoc
} from 'firebase/firestore';

export interface ChatMessage {
  id?: string;
  senderId: string;
  text: string;
  timestamp: any;
  isRead: boolean;
}

// Generate a unique, consistent chat ID for two users
export const getChatId = (uid1: string, uid2: string) => {
  return uid1 < uid2 ? `${uid1}_${uid2}` : `${uid2}_${uid1}`;
};

export const sendMessage = async (chatId: string, senderId: string, text: string) => {
  try {
    const chatRef = doc(db, 'chats', chatId);
    
    // Ensure the chat document exists
    await setDoc(chatRef, {
      lastMessage: text,
      lastUpdatedAt: serverTimestamp(),
      participants: chatId.split('_')
    }, { merge: true });

    // Add the message to the subcollection
    const messagesRef = collection(chatRef, 'messages');
    await addDoc(messagesRef, {
      senderId,
      text,
      timestamp: serverTimestamp(),
      isRead: false
    });
  } catch (error) {
    console.error("Error sending message:", error);
    throw error;
  }
};

export const subscribeToMessages = (chatId: string, callback: (messages: ChatMessage[]) => void) => {
  const messagesRef = collection(db, 'chats', chatId, 'messages');
  const q = query(messagesRef, orderBy('timestamp', 'asc'));

  return onSnapshot(q, (snapshot) => {
    const messages: ChatMessage[] = [];
    snapshot.forEach((doc) => {
      messages.push({ id: doc.id, ...doc.data() } as ChatMessage);
    });
    callback(messages);
  }, (error) => {
    console.error("Error subscribing to messages:", error);
  });
};

```


# src\services\coinService.ts
```ts
import { db } from '../config/firebase';
import { doc, runTransaction, getDoc, updateDoc } from 'firebase/firestore';

/**
 * Deducts coins safely using an atomic transaction.
 * Use this when a user purchases an item or service.
 */
export const deductUserCoins = async (userId: string, amount: number) => {
  if (amount <= 0) throw new Error("Amount must be positive");

  const userRef = doc(db, 'users', userId);
  return runTransaction(db, async (transaction) => {
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists()) {
      throw new Error("User does not exist!");
    }

    const currentBalance = userDoc.data()?.coins || 0;
    if (currentBalance < amount) {
      throw new Error("Insufficient Gengal balance");
    }

    transaction.update(userRef, { coins: currentBalance - amount });
    return currentBalance - amount; // Return the new balance
  });
};

/**
 * Credits coins safely.
 * Use this when a user receives a gift, refund, or top-up.
 */
export const creditUserCoins = async (userId: string, amount: number) => {
  if (amount <= 0) throw new Error("Amount must be positive");

  const userRef = doc(db, 'users', userId);
  return runTransaction(db, async (transaction) => {
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists()) {
      throw new Error("User does not exist!");
    }

    const currentBalance = userDoc.data()?.coins || 0;
    transaction.update(userRef, { coins: currentBalance + amount });
    return currentBalance + amount; // Return the new balance
  });
};

/**
 * Safely transfers coins between two users in a single atomic transaction.
 * This guarantees that either BOTH operations succeed, or NEITHER do.
 */
export const transferCoins = async (senderId: string, receiverId: string, amount: number) => {
  if (amount <= 0) throw new Error("Amount must be positive");
  if (senderId === receiverId) throw new Error("Cannot send gifts to yourself");

  const senderRef = doc(db, 'users', senderId);
  const receiverRef = doc(db, 'users', receiverId);

  return runTransaction(db, async (transaction) => {
    // 1. Read BOTH documents first (Firestore transactions require all reads before any writes)
    const senderDoc = await transaction.get(senderRef);
    const receiverDoc = await transaction.get(receiverRef);

    if (!senderDoc.exists() || !receiverDoc.exists()) {
      throw new Error("Sender or receiver does not exist.");
    }

    const senderBalance = senderDoc.data()?.coins || 0;
    const receiverBalance = receiverDoc.data()?.coins || 0;

    if (senderBalance < amount) {
      throw new Error("Insufficient Gengal balance for transfer");
    }

    // 2. Perform BOTH writes
    transaction.update(senderRef, { coins: senderBalance - amount });
    transaction.update(receiverRef, { coins: receiverBalance + amount });

    return {
      success: true,
      senderNewBalance: senderBalance - amount,
      receiverNewBalance: receiverBalance + amount
    };
  });
};

/**
 * Processes per-minute call billing.
 * Deducts the total amount from the payer, and credits the specified share percentage to the receiver.
 * The remaining amount is effectively kept by the platform (admin).
 */
export const processCallBilling = async (payerId: string, receiverId: string, totalAmount: number, creatorSharePercentage: number) => {
  if (totalAmount <= 0) throw new Error("Amount must be positive");
  if (creatorSharePercentage < 0 || creatorSharePercentage > 100) throw new Error("Invalid share percentage");
  if (payerId === receiverId) return { success: true, hasInsufficientFunds: false }; // No billing for self-testing

  const payerRef = doc(db, 'users', payerId);
  const receiverRef = doc(db, 'users', receiverId);

  return runTransaction(db, async (transaction) => {
    const payerDoc = await transaction.get(payerRef);
    const receiverDoc = await transaction.get(receiverRef);

    if (!payerDoc.exists() || !receiverDoc.exists()) {
      throw new Error("Payer or receiver does not exist.");
    }

    const payerBalance = payerDoc.data()?.coins || 0;
    const receiverBalance = receiverDoc.data()?.coins || 0;

    let actualDeduction = totalAmount;
    let hasInsufficientFunds = false;

    if (payerBalance < totalAmount) {
      actualDeduction = payerBalance;
      hasInsufficientFunds = true;
    }

    // Dynamic fractional share for the receiver based on the global percentage
    const receiverShare = actualDeduction * (creatorSharePercentage / 100);

    transaction.update(payerRef, { coins: payerBalance - actualDeduction });
    transaction.update(receiverRef, { coins: receiverBalance + receiverShare });

    return {
      success: true,
      hasInsufficientFunds,
      payerNewBalance: payerBalance - actualDeduction,
      receiverNewBalance: receiverBalance + receiverShare
    };
  });
};

/**
 * Updates a user's cumulative call time and awards hearts if they cross the threshold.
 */
export const updateCallRewards = async (userId: string, secondsToAdd: number, thresholdMinutes: number, isReceiver: boolean = false) => {
  const userRef = doc(db, 'users', userId);
  return runTransaction(db, async (transaction) => {
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists()) return;

    const data = userDoc.data();
    let currentSeconds = data.unrewardedCallSeconds || 0;
    let currentHearts = data.hearts || 0;
    let totalReceived = data.totalReceivedCallSeconds || 0;

    if (isReceiver) {
      totalReceived += secondsToAdd;
    }

    currentSeconds += secondsToAdd;
    const thresholdSeconds = thresholdMinutes * 60;

    let newHearts = currentHearts;
    if (thresholdSeconds > 0 && currentSeconds >= thresholdSeconds) {
      const heartsToAward = Math.floor(currentSeconds / thresholdSeconds);
      newHearts += heartsToAward;
      currentSeconds = currentSeconds % thresholdSeconds;
    }

    transaction.update(userRef, {
      unrewardedCallSeconds: currentSeconds,
      hearts: newHearts,
      ...(isReceiver ? { totalReceivedCallSeconds: totalReceived } : {})
    });
  });
};

```


# src\services\matchService.ts
```ts
import { db } from '../config/firebase';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  setDoc, 
  doc, 
  updateDoc,
  serverTimestamp,
  onSnapshot,
  runTransaction,
  getDoc
} from 'firebase/firestore';
import { UserProfile } from './userService';

export interface MatchRoom {
  id?: string;
  status: 'active' | 'closed';
  host: {
    uid: string;
    nickname: string;
    avatarData: any;
  };
  guest: {
    uid: string;
    nickname: string;
    avatarData: any;
  };
  createdAt: any;
}

export const findMatch = async (
  currentUser: UserProfile, 
  onMatchFound: (roomId: string, matchData: any) => void
) => {
  const poolRef = collection(db, 'matchmaking_pool');
  const roomsRef = collection(db, 'rooms');

  try {
    // 1. Try to find someone currently searching
    const q = query(poolRef, where('status', '==', 'searching'));
    const snapshot = await getDocs(q);
    
    let opponentDoc = null;
    for (const d of snapshot.docs) {
      // Temporarily allowing self-matching so the user can test with one phone number across two tabs!
      // if (d.id !== currentUser.uid) { 
        opponentDoc = d;
        break;
      // }
    }

    if (opponentDoc) {
      // 2a. Found someone! Perform a transaction to safely pair them up
      const opponentData = opponentDoc.data();
      
      const roomId = opponentDoc.id + '_' + currentUser.uid;
      const newRoomRef = doc(roomsRef, roomId);
      
      await runTransaction(db, async (transaction) => {
        // Read opponent again to ensure they haven't been matched
        const oppSnapshot = await transaction.get(opponentDoc.ref);
        if (!oppSnapshot.exists() || oppSnapshot.data().status !== 'searching') {
          throw new Error("Opponent already matched");
        }

        // Create the room
        transaction.set(newRoomRef, {
          status: 'active',
          audioProvider: 'agora', // Defaulting to Agora as the primary engine per the 40K architecture
          audioTokenOrUrl: 'TEST_TOKEN', // Placeholder for actual token generation
          host: {
            uid: opponentDoc.id,
            nickname: opponentData.nickname || 'Host',
            avatarData: opponentData.avatarData || null
          },
          guest: {
            uid: currentUser.uid!,
            nickname: currentUser.nickname || 'Guest',
            avatarData: currentUser.avatarData || null
          },
          createdAt: serverTimestamp()
        });

        // Update opponent's pool status so they get notified
        transaction.update(opponentDoc.ref, {
          status: 'matched',
          matchedRoomId: roomId
        });
      });

      // Notify the caller immediately
      onMatchFound(roomId, {
        uid: opponentDoc.id,
        nickname: opponentData.nickname || 'Host',
        avatarData: opponentData.avatarData || null,
        audioProvider: 'agora',
        audioTokenOrUrl: 'TEST_TOKEN'
      });

      return () => {}; // Cleanup function (none needed for guest)

    } else {
      // 2b. Nobody is searching. Join the pool and wait!
      const myPoolRef = doc(poolRef, currentUser.uid!);
      await setDoc(myPoolRef, {
        uid: currentUser.uid,
        nickname: currentUser.nickname || 'User',
        avatarData: currentUser.avatarData || null,
        status: 'searching',
        matchedRoomId: null,
        joinedAt: serverTimestamp()
      });

      // Listen for when someone matches with US
      const unsubscribe = onSnapshot(myPoolRef, async (docSnap) => {
        const data = docSnap.data();
        if (data && data.status === 'matched' && data.matchedRoomId) {
          unsubscribe(); // Stop listening
          
          // Fetch the room to get the guest's (opponent's) data
          const roomRef = doc(roomsRef, data.matchedRoomId);
          const roomSnap = await getDoc(roomRef);
          const roomData = roomSnap.data();
          
          if (roomData && roomData.guest) {
            onMatchFound(data.matchedRoomId, {
              ...roomData.guest,
              audioProvider: roomData.audioProvider || 'agora',
              audioTokenOrUrl: roomData.audioTokenOrUrl || 'TEST_TOKEN'
            });
          }
          
          // Clean up our pool entry since we are now in a room
          await updateDoc(myPoolRef, { status: 'in_room' });
        }
      });

      // Return a cleanup function in case the user cancels searching early
      return () => {
        unsubscribe();
        updateDoc(myPoolRef, { status: 'cancelled' }).catch(() => {});
      };
    }
  } catch (err) {
    console.error("Matchmaking error:", err);
    throw err;
  }
};


```


# src\services\userService.ts
```ts
import { db } from '../config/firebase';
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  collection,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  arrayUnion,
  arrayRemove
} from 'firebase/firestore';

export interface UserProfile {
  uid?: string;
  phoneNumber?: string;
  language?: string;
  country?: string;
  state?: string;
  city?: string;
  nickname?: string;
  username?: string;
  age?: string | number;
  gender?: string;
  isVip?: boolean;
  coins?: number;
  hearts?: number;
  respectBadges?: number;
  unrewardedCallSeconds?: number;
  totalReceivedCallSeconds?: number;
  createdAt?: any;
  lastActive?: any;
  avatarUrl?: string; // Legacy
  avatar3dUrl?: string; // Ready Player Me GLB string
  avatarData?: {
    topType: string;
    hairColor: string;
    clotheType: string;
    skinColor: string;
    facialHairType?: string;
    accessoriesType?: string;
    isPremiumConfig?: boolean;
  };
  isOnline?: boolean;
  tier?: 'VIP' | 'Premium' | 'Standard'; // To match our existing mock data fields
  bio?: string;
  followers?: number | string[];
  following?: number | string[];
}

export const saveUserProfile = async (uid: string, profileData: Partial<UserProfile>) => {
  try {
    const userRef = doc(db, 'users', uid);
    
    // Check if user exists first to decide whether to set or update
    const userSnap = await getDoc(userRef);
    
    if (userSnap.exists()) {
      await updateDoc(userRef, {
        ...profileData,
        lastActive: serverTimestamp()
      });
    } else {
      await setDoc(userRef, {
        ...profileData,
        uid,
        coins: 5000, // Initial signup bonus from UI
        hearts: 0,
        respectBadges: 0,
        unrewardedCallSeconds: 0,
        totalReceivedCallSeconds: 0,
        tier: profileData.isVip ? 'VIP' : 'Standard',
        createdAt: serverTimestamp(),
        lastActive: serverTimestamp()
      });
    }
  } catch (error) {
    console.error("Error saving user profile:", error);
    throw error;
  }
};

export const getUserProfile = async (uid: string): Promise<UserProfile | null> => {
  try {
    const userRef = doc(db, 'users', uid);
    const userSnap = await getDoc(userRef);
    
    if (userSnap.exists()) {
      return userSnap.data() as UserProfile;
    }
    return null;
  } catch (error) {
    console.error("Error fetching user profile:", error);
    throw error;
  }
};

const MOCK_TOPS = ["ShortHairShortWaved", "LongHairBun", "LongHairStraight", "ShortHairDreads01", "ShortHairShortCurly"];
const MOCK_CLOTHES = ["GraphicShirt", "CollarSweater", "BlazerShirt", "Hoodie", "ShirtCrewNeck"];
const MOCK_SKINS = ["Light", "Brown", "Black", "DarkBrown", "Yellow"];

export const subscribeToOnlineUsers = (callback: (users: UserProfile[]) => void, currentUid?: string) => {
  const usersRef = collection(db, 'users');
  
  // In a real app we would query where('isOnline', '==', true)
  // For now, let's just fetch all users except the current user to populate the feed
  const q = currentUid ? query(usersRef, where('uid', '!=', currentUid)) : query(usersRef);

  return onSnapshot(q, (querySnapshot) => {
    const users: UserProfile[] = [];
    querySnapshot.forEach((doc) => {
      const data = doc.data() as UserProfile;
      // Inject some mock data if missing to keep the UI looking good
      users.push({
        ...data,
        avatarData: data.avatarData || {
          topType: MOCK_TOPS[Math.floor(Math.random() * MOCK_TOPS.length)],
          hairColor: "Black",
          clotheType: MOCK_CLOTHES[Math.floor(Math.random() * MOCK_CLOTHES.length)],
          skinColor: MOCK_SKINS[Math.floor(Math.random() * MOCK_SKINS.length)]
        },
        tier: data.tier || 'Standard'
      });
    });
    callback(users);
  }, (error) => {
    console.error("Error subscribing to online users:", error);
  });
};

export const subscribeToUserProfile = (uid: string, callback: (user: UserProfile | null) => void) => {
  const userRef = doc(db, 'users', uid);
  return onSnapshot(userRef, (docSnap) => {
    if (docSnap.exists()) {
      callback(docSnap.data() as UserProfile);
    } else {
      callback(null);
    }
  }, (error) => {
    console.error("Error subscribing to user profile:", error);
  });
};

export const followUser = async (currentUid: string, targetUid: string) => {
  const currentRef = doc(db, 'users', currentUid);
  const targetRef = doc(db, 'users', targetUid);
  await Promise.all([
    updateDoc(currentRef, { following: arrayUnion(targetUid) }),
    updateDoc(targetRef, { followers: arrayUnion(currentUid) }),
  ]);
};

export const unfollowUser = async (currentUid: string, targetUid: string) => {
  const currentRef = doc(db, 'users', currentUid);
  const targetRef = doc(db, 'users', targetUid);
  await Promise.all([
    updateDoc(currentRef, { following: arrayRemove(targetUid) }),
    updateDoc(targetRef, { followers: arrayRemove(currentUid) }),
  ]);
};

export const updateUserStatus = async (uid: string, isOnline: boolean) => {
  try {
    const userRef = doc(db, 'users', uid);
    await updateDoc(userRef, {
      isOnline,
      lastActive: serverTimestamp()
    });
  } catch (error) {
    console.error("Error updating user status:", error);
  }
};

```


# src\theme\colors.ts
```ts
export const colors = {
  // Base — deep luxury
  background: '#080408',
  backgroundElevated: '#110810',
  backgroundCard: '#160818',
  backgroundCardHover: '#1E0A22',

  // Brand
  primary: '#2A0128',
  primaryDark: '#0A0509',
  primaryLight: '#4A1A52',
  plum: '#6B2D6E',
  plumMuted: '#3D1A40',

  // Gold metallics
  gold: '#C9A84C',
  goldLight: '#E8D5A3',
  goldPale: '#F5E6C8',
  goldDark: '#8B6914',
  goldGradientStart: '#F5E6C8',
  goldGradientMid: '#C9A84C',
  goldGradientEnd: '#8B6914',

  // Text
  textPrimary: '#FAF7F2',
  textSecondary: '#C4B8BE',
  textMuted: '#7A6E74',
  textGold: '#E8D5A3',

  // Accents
  rose: '#D4A0A0',
  roseMuted: '#8B5A5A',
  live: '#E85D75',
  success: '#5CB88A',
  white: '#FFFFFF',

  // Borders & glass
  borderGold: 'rgba(201, 168, 76, 0.28)',
  borderGoldStrong: 'rgba(201, 168, 76, 0.55)',
  borderSubtle: 'rgba(255, 255, 255, 0.06)',
  glass: 'rgba(22, 8, 24, 0.82)',
  glassLight: 'rgba(255, 255, 255, 0.04)',
  overlay: 'rgba(8, 4, 8, 0.75)',
  overlayLight: 'rgba(8, 4, 8, 0.45)',

  // Legacy aliases (screens may reference)
  onSurface: '#FAF7F2',
  onSurfaceVariant: '#C4B8BE',
  onSurfaceMuted: '#7A6E74',
  secondary: '#C9A84C',
  secondaryBright: '#E8D5A3',
  secondaryContainer: '#C9A84C',
  accentGold: '#C9A84C',
  surfaceContainer: '#160818',
  onTertiaryContainer: '#D4A0A0',
};

export const gradients = {
  page: ['#080408', '#110810', '#0A0509'] as const,
  hero: ['#2A0128', '#160818', '#0A0509'] as const,
  heroOverlay: ['transparent', 'rgba(8, 4, 8, 0.3)', 'rgba(8, 4, 8, 0.92)'] as const,
  gold: [colors.goldGradientStart, colors.goldGradientMid, colors.goldGradientEnd] as const,
  goldButton: ['#F5E6C8', '#C9A84C', '#A08030'] as const,
  goldCTA: ['#E8D5A3', '#C9A84C', '#8B6914'] as const,
  goldBorder: ['rgba(201,168,76,0.6)', 'rgba(201,168,76,0.15)', 'rgba(201,168,76,0.5)'] as const,
  card: ['rgba(30,10,34,0.95)', 'rgba(16,8,24,0.98)'] as const,
  spotlight: ['rgba(201,168,76,0.18)', 'transparent'] as const,
};

```


# src\theme\skeuomorphic.ts
```ts
import { Platform } from 'react-native';

export const skeuo = {
  surface: '#FFFCF7',
  surfaceRaised: '#FFFDF8',
  surfaceInset: '#F3EBDD',
  creamTop: '#FFFFFF',
  creamBottom: '#F5EBDD',
  goldTop: '#F9E8AE',
  goldMid: '#CBA72F',
  goldBottom: '#967407',
  plum: '#4B0054',
  gold: '#9A7A05',
  border: '#E9D9BE',
  borderLight: '#FFFFFF',
  raisedShadow: Platform.OS === 'web' ? '0 10px 22px rgba(83, 58, 29, 0.15)' : '0 10px 22px rgba(83, 58, 29, 0.15)',
  deepShadow: Platform.OS === 'web' ? '0 16px 32px rgba(83, 58, 29, 0.2)' : '0 16px 32px rgba(83, 58, 29, 0.2)',
  insetShadow: Platform.OS === 'web' ? 'inset 0 2px 5px rgba(83, 58, 29, 0.10), inset 0 -2px 4px rgba(255, 255, 255, 0.75)' : '0 2px 5px rgba(83, 58, 29, 0.10)',
  goldShadow: Platform.OS === 'web' ? '0 10px 18px rgba(154, 122, 5, 0.24)' : '0 10px 18px rgba(154, 122, 5, 0.24)',
};

export const skeuoGradients = {
  page: ['#FFFDF8', '#F8F0E3', '#FFFCF7'] as const,
  raised: ['#FFFFFF', '#FFF8EA', '#F2E6D4'] as const,
  inset: ['#EDE1D0', '#FFF9EF'] as const,
  gold: ['#FFF1BB', '#D0A92E', '#8F6D05'] as const,
  plumButton: ['#6E0875', '#4B0054', '#2B0030'] as const,
};

```
