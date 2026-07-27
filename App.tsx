// @ts-nocheck
import React, { useState, useEffect, useRef, Component, ErrorInfo, ReactNode } from 'react';
import { Platform, AppState } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, Text, Alert, Animated, Easing, Image } from 'react-native';
import { auth } from './src/config/firebase';
import { onAuthStateChanged, User, signOut } from 'firebase/auth';
import { useFonts } from 'expo-font';
import { SafeAreaProvider } from 'react-native-safe-area-context';
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
import ActivityScreen from './src/screens/ActivityScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import AdminPanelScreen from './src/screens/AdminPanelScreen';
import CoinsScreen from './src/screens/CoinsScreen';
import { ThemeProvider } from './src/theme/ThemeContext';
import { UserProvider } from './src/context/UserContext';
import { getUserProfile, updateUserStatus } from './src/services/userService';
import CreatePasswordScreen from './src/screens/CreatePasswordScreen';
import ForgotPasswordScreen from './src/screens/ForgotPasswordScreen';
import LoginPasswordScreen from './src/screens/LoginPasswordScreen';
import CelebsScreen from './src/screens/CelebsScreen';
import ChillScreen from './src/screens/ChillScreen';
import DumCharadesRoomScreen from './src/screens/DumCharadesRoomScreen';
import LudoScreen from './src/screens/LudoScreen';
import LudoBoardScreen from './src/screens/LudoBoardScreen';

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
type ScreenName = 'Home' | 'Club' | 'ExpertRoom' | 'Personal' | 'Profile' | 'Call' | 'Match' | 'Chat' | 'Language' | 'Phone' | 'Otp' | 'Avatar' | 'FinalizeInvite' | 'ProfileDetails' | 'ActiveConnects' | 'Activity'
  | 'Settings'
  | 'AdminPanel'
  | 'Coins'
  | 'Earnings'
  | 'CreatePassword'
  | 'ForgotPassword'
  | 'LoginPassword'
  | 'Celebs'
  | 'Chill'
  | 'DumCharadesRoom'
  | 'Ludo'
  | 'LudoBoard';

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

function SplashScreen() {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.7)).current;
  const dotAnim1 = useRef(new Animated.Value(0)).current;
  const dotAnim2 = useRef(new Animated.Value(0)).current;
  const dotAnim3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 800, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
      Animated.spring(scaleAnim, { toValue: 1, tension: 60, friction: 8, useNativeDriver: true }),
    ]).start();

    const pulse = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0.3, duration: 400, useNativeDriver: true }),
        ])
      ).start();

    pulse(dotAnim1, 0);
    pulse(dotAnim2, 200);
    pulse(dotAnim3, 400);
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: '#FFFDF8', alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{ opacity: fadeAnim, transform: [{ scale: scaleAnim }], alignItems: 'center' }}>
        {/* Logo */}
        <Animated.Image
          source={require('./assets/splash-icon.png')}
          style={{ width: 120, height: 120, borderRadius: 30, transform: [{ scale: scaleAnim }] }}
          resizeMode="contain"
        />

        <Text style={{ marginTop: 20, fontSize: 28, fontWeight: '700', color: '#1a1a1a', letterSpacing: 1 }}>
          GenGal
        </Text>
        <Text style={{ marginTop: 4, fontSize: 13, color: '#999', letterSpacing: 2 }}>
          CONNECT & VIBE
        </Text>

        {/* Animated dots */}
        <View style={{ flexDirection: 'row', marginTop: 36, columnGap: 8 }}>
          {[dotAnim1, dotAnim2, dotAnim3].map((dot, i) => (
            <Animated.View key={i} style={{
              width: 8, height: 8, borderRadius: 4, backgroundColor: '#D49A0B', opacity: dot,
            }} />
          ))}
        </View>
      </Animated.View>
    </View>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    ...MaterialIcons.font,
  });

  const [navStack, setNavStack] = useState<{name: ScreenName, params: NavigationParams}[]>([{ name: 'Language', params: {} }]);
  
  const currentRoute = navStack[navStack.length - 1];
  const screen = currentRoute.name;
  const params = currentRoute.params;

  const screenRef = useRef<ScreenName>(screen);
  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const resetTo = (next: ScreenName, params: NavigationParams = {}) => {
    setNavStack([{ name: next, params }]);
  };

  const navigate = (next: string, nextParams: NavigationParams = {}) => {
    if (
      next === 'Home' || next === 'Club' || next === 'ExpertRoom' || next === 'Personal' || next === 'Profile' || next === 'Call' || next === 'Match' || next === 'Chat' || next === 'Language' || next === 'Phone' || next === 'FinalizeInvite' || next === 'ProfileDetails' || next === 'ActiveConnects' || next === 'Activity' || next === 'Settings' || next === 'AdminPanel' || next === 'Coins' || next === 'Earnings' || next === 'CreatePassword' || next === 'ForgotPassword' || next === 'Otp' || next === 'Avatar' || next === 'LoginPassword' || next === 'Celebs' || next === 'Chill' || next === 'DumCharadesRoom' || next === 'Ludo' || next === 'LudoBoard'
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
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsLoading(false);
      
      if (currentUser) {
        resetTo('Home');
      } else {
        resetTo('Language');
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      if (nextState === 'active') {
        updateUserStatus(uid, true);
      } else if (nextState === 'background' || nextState === 'inactive') {
        updateUserStatus(uid, false);
      }
    });
    return () => subscription.remove();
  }, []);

  if (isLoading || !fontsLoaded) {
    return <SplashScreen />;
  }

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <UserProvider>
          <StatusBar style={screen === 'Call' && params.mode === 'video' ? 'light' : 'dark'} />
          {screen === 'Home' && <HomeScreen navigate={navigate} goBack={goBack} />}
          {screen === 'ExpertRoom' && <ExpertRoomScreen navigate={navigate} goBack={goBack} route={{ params }} />}
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
          {screen === 'Activity' && <ActivityScreen navigate={navigate} />}
          {screen === 'Settings' && <SettingsScreen navigate={navigate} goBack={goBack} />}
          {screen === 'AdminPanel' && <AdminPanelScreen navigate={navigate} goBack={goBack} />}
          {screen === 'Coins' && <CoinsScreen navigate={navigate} goBack={goBack} />}
          {screen === 'Earnings' && <EarningsScreen navigate={navigate} goBack={goBack} />}
          {screen === 'CreatePassword' && <CreatePasswordScreen navigate={navigate} goBack={goBack} route={{ params }} />}
          {screen === 'ForgotPassword' && <ForgotPasswordScreen navigate={navigate} goBack={goBack} route={{ params }} />}
          {screen === 'LoginPassword' && <LoginPasswordScreen navigate={navigate} goBack={goBack} route={{ params }} />}
          {screen === 'Celebs' && <CelebsScreen navigate={navigate} goBack={goBack} />}
          {screen === 'Chill' && <ChillScreen navigate={navigate} goBack={goBack} />}
          {screen === 'DumCharadesRoom' && <DumCharadesRoomScreen navigate={navigate} goBack={goBack} route={{ params }} />}
          {screen === 'Ludo' && <LudoScreen navigate={navigate} goBack={goBack} />}
          {screen === 'LudoBoard' && <LudoBoardScreen navigate={navigate} goBack={goBack} route={{ params }} />}
        </UserProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
