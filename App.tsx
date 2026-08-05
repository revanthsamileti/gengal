import React, { useState, useEffect, useRef, Component, ErrorInfo, ReactNode } from 'react';
import { Platform, AppState } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { View, Text, Animated, Easing } from 'react-native';
import { auth } from './src/config/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
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
import { UserProvider } from './src/context/UserContext';
import { updateUserStatus } from './src/services/userService';
import { useIncomingCallWatcher } from './src/hooks/useIncomingCallWatcher';
import CreatePasswordScreen from './src/screens/CreatePasswordScreen';
import ForgotPasswordScreen from './src/screens/ForgotPasswordScreen';
import LoginPasswordScreen from './src/screens/LoginPasswordScreen';
import CelebsScreen from './src/screens/CelebsScreen';
import ChillScreen from './src/screens/ChillScreen';
import DumCharadesRoomScreen from './src/screens/DumCharadesRoomScreen';
import LudoScreen from './src/screens/LudoScreen';
import LudoBoardScreen from './src/screens/LudoBoardScreen';
import { CustomAlert } from './src/components/CustomAlert';

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
type NavigationParams = {
  profileName?: string;
  mode?: 'call' | 'video';
  avatarData?: any;
  roomId?: string;
  matchData?: any;
  isCaller?: boolean;
  isIncomingPending?: boolean;
  [key: string]: any;
};

type ScreenContext = {
  params: NavigationParams;
  navigate: (next: string, params?: NavigationParams) => void;
  goBack: () => void;
};

/**
 * The single source of truth for what screens exist and how each is rendered.
 *
 * This used to live in three hand-maintained places — a `ScreenName` union, a
 * long `next === 'X' || next === 'Y'` guard inside `navigate`, and an if-chain
 * in the render. Miss any one of them and `navigate('NewScreen')` silently did
 * nothing, which is exactly the kind of bug that only shows up on a device.
 * Now the union, the guard and the render all derive from this object.
 */
const SCREENS = {
  Home: ({ navigate, goBack }: ScreenContext) => <HomeScreen navigate={navigate} goBack={goBack} />,
  ExpertRoom: ({ navigate, goBack, params }: ScreenContext) => <ExpertRoomScreen navigate={navigate} goBack={goBack} route={{ params }} />,
  Club: ({ navigate, goBack }: ScreenContext) => <ClubScreen navigate={navigate} goBack={goBack} />,
  Personal: ({ navigate, goBack }: ScreenContext) => <PersonalScreen navigate={navigate} goBack={goBack} />,
  Profile: ({ navigate, goBack, params }: ScreenContext) => (
    <ProfileScreen profileName={params.profileName} navigate={navigate} goBack={goBack} route={{ params }} />
  ),
  Call: ({ navigate, goBack, params }: ScreenContext) => (
    <CallScreen
      profileName={params.profileName}
      mode={params.mode}
      roomId={params.roomId}
      matchData={params.matchData}
      isCaller={params.isCaller}
      isIncomingPending={params.isIncomingPending}
      navigate={navigate}
      goBack={goBack}
    />
  ),
  Match: ({ navigate, goBack, params }: ScreenContext) => (
    <MatchScreen profileName={params.profileName} matchData={params.matchData} roomId={params.roomId} navigate={navigate} goBack={goBack} />
  ),
  Chat: ({ navigate, goBack, params }: ScreenContext) => (
    <ChatScreen profileName={params.profileName} navigate={navigate} goBack={goBack} route={{ params }} />
  ),
  Language: ({ navigate, goBack, params }: ScreenContext) => <LanguageScreen navigate={navigate} goBack={goBack} route={{ params }} />,
  Phone: ({ navigate, goBack, params }: ScreenContext) => <PhoneScreen navigate={navigate} goBack={goBack} route={{ params }} />,
  Otp: ({ navigate, goBack, params }: ScreenContext) => <OtpScreen navigate={navigate} goBack={goBack} route={{ params }} />,
  Avatar: ({ navigate, goBack, params }: ScreenContext) => <AvatarScreen navigate={navigate} goBack={goBack} route={{ params }} />,
  FinalizeInvite: ({ navigate, goBack, params }: ScreenContext) => <FinalizeInviteScreen navigate={navigate} goBack={goBack} route={{ params }} />,
  ProfileDetails: ({ navigate, goBack, params }: ScreenContext) => <ProfileDetailsScreen navigate={navigate} goBack={goBack} route={{ params }} />,
  ActiveConnects: ({ navigate, goBack }: ScreenContext) => <ActiveConnectsScreen navigate={navigate} goBack={goBack} />,
  Activity: ({ navigate }: ScreenContext) => <ActivityScreen navigate={navigate} />,
  Settings: ({ navigate, goBack }: ScreenContext) => <SettingsScreen navigate={navigate} goBack={goBack} />,
  AdminPanel: ({ navigate, goBack }: ScreenContext) => <AdminPanelScreen navigate={navigate} goBack={goBack} />,
  Coins: ({ navigate, goBack }: ScreenContext) => <CoinsScreen navigate={navigate} goBack={goBack} />,
  Earnings: ({ navigate, goBack }: ScreenContext) => <EarningsScreen navigate={navigate} goBack={goBack} />,
  CreatePassword: ({ navigate, goBack, params }: ScreenContext) => <CreatePasswordScreen navigate={navigate} goBack={goBack} route={{ params }} />,
  ForgotPassword: ({ navigate, goBack, params }: ScreenContext) => <ForgotPasswordScreen navigate={navigate} goBack={goBack} route={{ params }} />,
  LoginPassword: ({ navigate, goBack, params }: ScreenContext) => <LoginPasswordScreen navigate={navigate} goBack={goBack} route={{ params }} />,
  Celebs: ({ navigate, goBack }: ScreenContext) => <CelebsScreen navigate={navigate} goBack={goBack} />,
  Chill: ({ navigate, goBack }: ScreenContext) => <ChillScreen navigate={navigate} goBack={goBack} />,
  DumCharadesRoom: ({ navigate, goBack, params }: ScreenContext) => <DumCharadesRoomScreen navigate={navigate} goBack={goBack} route={{ params }} />,
  Ludo: ({ navigate, goBack }: ScreenContext) => <LudoScreen navigate={navigate} goBack={goBack} />,
  LudoBoard: ({ navigate, goBack, params }: ScreenContext) => <LudoBoardScreen navigate={navigate} goBack={goBack} route={{ params }} />,
} as const;

type ScreenName = keyof typeof SCREENS;

const isScreenName = (value: string): value is ScreenName =>
  Object.prototype.hasOwnProperty.call(SCREENS, value);

/**
 * Bottom-nav destinations. Tapping one replaces the stack instead of pushing,
 * so hopping between tabs doesn't build an unbounded history that the hardware
 * back button then has to walk back through one entry at a time.
 */
const TAB_SCREENS: ReadonlySet<string> = new Set<ScreenName>([
  'Home', 'Club', 'Celebs', 'Chill', 'Activity', 'Personal',
]);

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
    if (!isScreenName(next)) {
      // Previously an unknown name was dropped in silence, so a typo or a
      // screen missing from the registry looked like a dead button.
      console.error(`[Navigation] Unknown screen "${next}" — check the SCREENS registry in App.tsx.`);
      return;
    }

    if (TAB_SCREENS.has(next)) {
      // Rebase rather than push: Home stays underneath so hardware back still
      // leads out of a tab, but hopping between tabs can't grow the stack.
      setNavStack(next === 'Home'
        ? [{ name: 'Home', params: nextParams }]
        : [{ name: 'Home', params: {} }, { name: next, params: nextParams }]);
      return;
    }

    setNavStack(prev => [...prev, { name: next, params: nextParams }]);
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

  // Inbound calls push a Call screen with the offer already attached. Guard
  // against interrupting a call that is already on screen.
  useIncomingCallWatcher(user, (call) => {
    if (screenRef.current === 'Call') return;
    setNavStack(prev => [...prev, {
      name: 'Call',
      params: {
        profileName: call.callerName,
        mode: call.mode,
        roomId: call.roomId,
        isCaller: false,
        isIncomingPending: true,
        matchData: {
          uid: call.callerUid,
          nickname: call.callerName,
          avatarUrl: call.callerAvatarUrl,
          avatarData: call.callerAvatarData,
        },
      },
    }]);
  });

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
          {SCREENS[screen]({ params, navigate, goBack })}
          {/* Mounted last so its Modal renders above every screen. Without this
              the imperative Alert API silently no-ops (see CustomAlert.tsx). */}
          <CustomAlert />
        </UserProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
