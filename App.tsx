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
          <CallScreen profileName={params.profileName} mode={params.mode} navigate={navigate} goBack={goBack} />
        )}
        {screen === 'Match' && (
          <MatchScreen profileName={params.profileName} navigate={navigate} goBack={goBack} />
        )}
        {screen === 'Chat' && (
          <ChatScreen profileName={params.profileName} navigate={navigate} goBack={goBack} />
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
