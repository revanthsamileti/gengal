import React, { useState, useEffect, useRef, Component, ErrorInfo, ReactNode } from 'react';
import { Platform, AppState } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { View, Text, Animated, Easing } from 'react-native';
import { auth } from './src/config/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { useFonts } from 'expo-font';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { DancingScript_700Bold } from '@expo-google-fonts/dancing-script';
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
import VerifyBySmsScreen from './src/screens/VerifyBySmsScreen';
import AvatarScreen from './src/screens/AvatarScreen';
import FinalizeInviteScreen from './src/screens/FinalizeInviteScreen';
import ProfileDetailsScreen from './src/screens/ProfileDetailsScreen';
import EarningsScreen from './src/screens/EarningsScreen';
import ActiveConnectsScreen from './src/screens/ActiveConnectsScreen';
import ActivityScreen from './src/screens/ActivityScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import BlockedUsersScreen from './src/screens/BlockedUsersScreen';
import AdminPanelScreen from './src/screens/AdminPanelScreen';
import CoinsScreen from './src/screens/CoinsScreen';
import { UserProvider } from './src/context/UserContext';
import { updateUserStatus, touchLastActive, USER_HEARTBEAT_MS } from './src/services/userService';
import { useIncomingCallWatcher } from './src/hooks/useIncomingCallWatcher';
import { useMessageNotificationTaps } from './src/hooks/useMessageNotificationTaps';
import { rejectCallOffer } from './src/services/liveRoomService';
import { isBlocked, startBlockListSync } from './src/services/safetyService';
import CelebsScreen from './src/screens/CelebsScreen';
import ChillScreen from './src/screens/ChillScreen';
import DumCharadesRoomScreen from './src/screens/DumCharadesRoomScreen';
import LudoScreen from './src/screens/LudoScreen';
import LudoBoardScreen from './src/screens/LudoBoardScreen';
import { CustomAlert } from './src/components/CustomAlert';

/**
 * Global unhandled-rejection / error handler.
 *
 * A `TypeError: Cannot read property 'reload' of undefined` fires 1-2 s after
 * every Agora state transition (joinChannel success, remote user joined, remote
 * offline, teardown). Root cause: react-native-agora's native bridge calls an
 * internal JS method on a stub whose hosting object has already been GC-ed or
 * reset between transitions. The error is non-fatal and carries no actionable
 * JS stack (the frame is inside the native bridge glue). Installing a handler
 * here:
 *   1. Logs the real message + stack before it is swallowed by the redbox, so
 *      future investigation has actual evidence rather than a context-free toast.
 *   2. Stops the redbox from interrupting an active call (ErrorUtils is the
 *      last stop before the redbox, so wrapping it prevents the UI intrusion
 *      without hiding the log).
 *
 * This is NOT a silent suppression — the warning is always printed. We just
 * prevent a non-fatal bridge artefact from interrupting the user's call.
 */
if (Platform.OS !== 'web') {
  try {
    // `globalThis` rather than React Native's `global`: the latter is only
    // typed when @types/react-native's global.d.ts is in scope, and this file
    // does not pull it in, so `global` fails to compile. `globalThis` is
    // standard, is present in Hermes, and needs no ambient declaration.
    const EU = (globalThis as any).ErrorUtils;
    if (EU?.setGlobalHandler) {
      const prev: ((error: any, isFatal: boolean) => void) | null =
        EU.getGlobalHandler?.() ?? null;

      EU.setGlobalHandler((error: any, isFatal: boolean) => {
        // Always log so the developer console has the real stack.
        console.warn(
          '[App] Global error handler caught:',
          error?.message,
          '\nStack:',
          error?.stack ?? '(no stack)'
        );

        // The Agora 'reload' TypeError is non-fatal (isFatal === false) and
        // originates in native bridge glue, not app code. Forwarding it to
        // the original handler causes a redbox during an active call, which
        // covers the controls and confuses users. We swallow it here after
        // logging. Any genuinely fatal error still reaches the original handler.
        if (isFatal) {
          prev?.(error, isFatal);
        }
        // Non-fatal errors are logged above but not forwarded, preventing the
        // redbox while preserving the audit trail in the console.
      });
    }
  } catch {
    // If ErrorUtils is unavailable (Expo Go, very old RN) this is a no-op.
  }
}

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
      // Set by the Answer button on the notification. Forgetting it here is
      // invisible: the param is set, the prop defaults to false, and the call
      // simply asks to be accepted a second time on a screen the user already
      // accepted it from.
      autoAnswer={params.autoAnswer}
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
  VerifyBySms: ({ navigate, goBack, params }: ScreenContext) => <VerifyBySmsScreen navigate={navigate} goBack={goBack} route={{ params }} />,
  Avatar: ({ navigate, goBack, params }: ScreenContext) => <AvatarScreen navigate={navigate} goBack={goBack} route={{ params }} />,
  FinalizeInvite: ({ navigate, goBack, params }: ScreenContext) => <FinalizeInviteScreen navigate={navigate} goBack={goBack} route={{ params }} />,
  ProfileDetails: ({ navigate, goBack, params }: ScreenContext) => <ProfileDetailsScreen navigate={navigate} goBack={goBack} route={{ params }} />,
  ActiveConnects: ({ navigate, goBack }: ScreenContext) => <ActiveConnectsScreen navigate={navigate} goBack={goBack} />,
  Activity: ({ navigate }: ScreenContext) => <ActivityScreen navigate={navigate} />,
  Settings: ({ navigate, goBack }: ScreenContext) => <SettingsScreen navigate={navigate} goBack={goBack} />,
  BlockedUsers: ({ navigate, goBack }: ScreenContext) => <BlockedUsersScreen navigate={navigate} goBack={goBack} />,
  AdminPanel: ({ navigate, goBack }: ScreenContext) => <AdminPanelScreen navigate={navigate} goBack={goBack} />,
  Coins: ({ navigate, goBack }: ScreenContext) => <CoinsScreen navigate={navigate} goBack={goBack} />,
  Earnings: ({ navigate, goBack }: ScreenContext) => <EarningsScreen navigate={navigate} goBack={goBack} />,
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
    /* Same paper colour as the native splash, so the hand-off between them is
       invisible rather than a flash of a different background. */
    <View style={{ flex: 1, backgroundColor: '#F9F2E2', alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{ opacity: fadeAnim, transform: [{ scale: scaleAnim }], alignItems: 'center' }}>
        {/* The logo already carries the name and the line under it, so nothing
            is repeated below it. */}
        {/* splash-logo, not splash-icon: the latter now carries a wide
            transparent margin so Android 12's circular mask cannot clip the
            native splash. Nothing masks this one, so it uses the full-bleed
            artwork and stays the size it was. */}
        <Animated.Image
          source={require('./assets/splash-logo.png')}
          style={{ width: 264, height: 264, transform: [{ scale: scaleAnim }] }}
          resizeMode="contain"
        />

        {/* Animated dots */}
        <View style={{ flexDirection: 'row', marginTop: 24, columnGap: 8 }}>
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
    // The "GenGal" wordmark in TopBar.
    DancingScript_700Bold,
  });

  /**
   * Identity for a stack entry, so a screen can only ever pop *itself*.
   *
   * `goBack` used to pop whatever was on top, which is wrong for any screen
   * that is replaced rather than popped. The glare path does exactly that: the
   * device that yields swaps its outbound call screen for the inbound one, and
   * the outbound screen's teardown -- which runs after it has already been
   * unmounted -- then called goBack() and took the replacement down with it.
   * The yielding side landed back on Home while the other side rang on at a
   * call nobody would ever see.
   */
  const navKeyRef = useRef(0);
  const nextNavKey = () => ++navKeyRef.current;

  const [navStack, setNavStack] = useState<{name: ScreenName, params: NavigationParams, key: number}[]>(
    [{ name: 'Language', params: {}, key: 0 }]
  );
  
  const currentRoute = navStack[navStack.length - 1];
  const screen = currentRoute.name;
  const params = currentRoute.params;

  const screenRef = useRef<ScreenName>(screen);
  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  // Who the call screen currently on top is for, and in which direction. The
  // inbound-call handler needs this to tell "a stranger is ringing while I am
  // busy" from "the person I am dialling is dialling me back".
  const currentCallRef = useRef<{ peerUid?: string; isCaller?: boolean }>({});
  useEffect(() => {
    currentCallRef.current = screen === 'Call'
      ? { peerUid: params?.matchData?.uid, isCaller: !!params?.isCaller }
      : {};
  }, [screen, params]);

  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const resetTo = (next: ScreenName, params: NavigationParams = {}) => {
    setNavStack([{ name: next, params, key: nextNavKey() }]);
  };

  const navigate = (next: string, nextParams: NavigationParams = {}) => {
    if (!isScreenName(next)) {
      // Previously an unknown name was dropped in silence, so a typo or a
      // screen missing from the registry looked like a dead button.
      console.error(`[Navigation] Unknown screen "${next}" — check the SCREENS registry in App.tsx.`);
      return;
    }

    if (TAB_SCREENS.has(next)) {
      // Re-selecting the tab you are already on keeps that entry's identity.
      // Now that entries are keyed, a fresh key would remount the screen --
      // dropping its scroll position and refetching everything -- so tapping
      // the current tab would silently become a reload.
      const key = currentRoute.name === next ? currentRoute.key : nextNavKey();

      // Rebase rather than push: Home stays underneath so hardware back still
      // leads out of a tab, but hopping between tabs can't grow the stack.
      setNavStack(next === 'Home'
        ? [{ name: 'Home', params: nextParams, key }]
        : [{ name: 'Home', params: {}, key: nextNavKey() }, { name: next, params: nextParams, key }]);
      return;
    }

    setNavStack(prev => [...prev, { name: next, params: nextParams, key: nextNavKey() }]);
  };

  /**
   * Pop the stack.
   *
   * `fromKey` identifies the entry asking to be dismissed. A screen that has
   * already been replaced is no longer on top, and popping on its behalf would
   * remove whatever took its place -- so those calls are dropped. Passing no
   * key keeps the old unconditional behaviour, which is what the hardware back
   * button wants.
   */
  const goBack = (fromKey?: number) => {
    setNavStack(prev => {
      if (prev.length <= 1) return prev;
      if (fromKey !== undefined && prev[prev.length - 1].key !== fromKey) return prev;
      return prev.slice(0, -1);
    });
  };

  /**
   * What screens actually receive. Bound to the entry rendering it, so a
   * screen's late teardown cannot dismiss a different screen -- screens call
   * `goBack()` with no arguments and get self-dismissal for free.
   */
  const screenGoBack = React.useCallback(
    () => goBack(currentRoute.key),
    [currentRoute.key]
  );

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

  // A tapped message notification opens that conversation.
  useMessageNotificationTaps(user, (message) => {
    navigate('Chat', {
      profileName: message.senderName,
      matchData: { uid: message.senderUid, name: message.senderName },
    });
  });

  // Inbound calls push a Call screen with the offer already attached.
  useIncomingCallWatcher(user, (call, options) => {
    const inboundCallEntry = {
      name: 'Call' as ScreenName,
      params: {
        profileName: call.callerName,
        mode: call.mode,
        roomId: call.roomId,
        isCaller: false,
        isIncomingPending: true,
        // Answer pressed on the notification: open the call already answering.
        autoAnswer: !!options?.autoAnswer,
        matchData: {
          uid: call.callerUid,
          nickname: call.callerName,
          avatarUrl: call.callerAvatarUrl,
          avatarData: call.callerAvatarData,
        },
      },
    };

    /**
     * Both people pressing Call at the same moment.
     *
     * This is not an exotic race: MatchScreen shows both halves of a new match
     * the same "call now" screen at the same instant, so it happens whenever
     * two eager people are matched. Each one's phone then sees an inbound call
     * while it is placing an outbound one, each declines the other as busy, and
     * a match that both sides wanted produced two "Line busy" dialogs and no
     * call at all.
     *
     * Both devices decide it the same way -- lower uid keeps its outbound call,
     * higher uid drops its own and answers instead -- so exactly one of the two
     * calls survives, with no extra round-trip to agree on which.
     */
    const uid = auth.currentUser?.uid;
    // Someone this user blocked: decline without ringing. Their side sees an
    // ordinary declined call, so the block itself is never revealed.
    if (isBlocked(call.callerUid)) {
      if (uid) {
        rejectCallOffer(uid, { callerUid: call.callerUid, roomId: call.roomId }, 'declined').catch((e) =>
          console.warn('[App] Auto-decline blocked caller failed:', e)
        );
      }
      return;
    }
    const active = currentCallRef.current;
    const dialingEachOther =
      screenRef.current === 'Call' && active.isCaller && active.peerUid === call.callerUid;

    if (dialingEachOther) {
      // Higher UID yields to the peer's inbound offer. Lower UID keeps its
      // outbound call and must not fall through to the busy reject — that
      // raced the yield and produced mutual "Line busy" with no surviving call.
      if (uid && uid > call.callerUid) {
        setNavStack(prev => [...prev.slice(0, -1), { ...inboundCallEntry, key: nextNavKey() }]);
      }
      return;
    }

    if (screenRef.current === 'Call') {
      // Already on a call — auto-decline with 'rejected' so the caller's
      // subscribeToOutboundCallStatus listener fires and ends their side
      // cleanly. Without this the caller's 45-second ring timeout is the
      // only thing that ends their call, and the offer document stays alive
      // blocking any subsequent call to this user for that entire window.
      //
      // Aimed at this specific offer. Declining "whatever is in the ring slot"
      // is how a stranger's unanswered call used to hang up the conversation
      // already in progress: the rejection landed on the shared document that
      // the live call was still reading its own state from, and both
      // participants took it as the other one hanging up.
      if (uid) {
        rejectCallOffer(uid, { callerUid: call.callerUid, roomId: call.roomId }, 'busy').catch((e) =>
          console.warn('[App] Auto-decline busy call failed:', e)
        );
      }
      return;
    }
    setNavStack(prev => [...prev, { ...inboundCallEntry, key: nextNavKey() }]);
  });

  // The block list gates listings, chats and inbound calls, so it follows the
  // signed-in account rather than any one screen.
  const signedInUid = user?.uid;
  useEffect(() => {
    if (!signedInUid) return;
    return startBlockListSync(signedInUid);
  }, [signedInUid]);

  useEffect(() => {
    if (!signedInUid) return;
    const uid = signedInUid;

    // `lastActive` used to be written only when the app came to the foreground,
    // but the directory hides anyone whose lastActive is older than
    // ONLINE_FRESHNESS_MS. Sitting on a screen without backgrounding the app
    // therefore made you disappear from everyone's "Online Now" and nobody
    // could call you. This beats well inside that window so an open app stays
    // listed.
    //
    // The interval comes from userService rather than a copy here: this file
    // used to hold its own 2-minute constant, which is precisely the drift the
    // exported one exists to prevent, and it would have silently outlived the
    // window it is supposed to fit inside.
    let timer: ReturnType<typeof setInterval> | null = null;

    const startBeating = () => {
      if (timer) return;
      timer = setInterval(() => touchLastActive(uid), USER_HEARTBEAT_MS);
    };

    const stopBeating = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    // Opening the app says "I'm here" -- on a cold start too. It used to be
    // said only on a background-to-foreground *change*, which a cold start
    // never fires: after swiping GenGal away, the offline flag written on the
    // way out stuck, and reopening the app left you invisible with the switch
    // still showing on. updateUserStatus keeps isOnline in step with the
    // switch, so this never turns on someone who switched it off.
    if (AppState.currentState === 'active') {
      updateUserStatus(uid, true);
      startBeating();
    }

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        updateUserStatus(uid, true);
        startBeating();
      } else if (nextState === 'background' || nextState === 'inactive') {
        stopBeating();
        // Leaving the app takes you out of Online Now straight away. Staying
        // listed because a push could still reach the phone left people
        // showing as online for hours after they had swiped the app away.
        // The "Show me as online" switch is untouched by this -- it stays on,
        // and it is still what decides whether a call notification reaches
        // you while you are away.
        updateUserStatus(uid, false);
      }
    });
    return () => {
      stopBeating();
      subscription.remove();
    };
  }, [signedInUid]);

  if (isLoading || !fontsLoaded) {
    return <SplashScreen />;
  }

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <UserProvider>
          <StatusBar style={screen === 'Call' && params.mode === 'video' ? 'light' : 'dark'} />
          {/* Keyed on the entry, so replacing one Call screen with another
              genuinely remounts it. Without a key React sees the same element
              type in the same position and reconciles, which kept the previous
              call's state alive: `roomId` and `isPending` come from useState
              initializers that run once per instance, and `endedRef` from a
              ref. A yielded outbound call therefore handed the incoming call
              its room id and an already-tripped `endedRef`, so the screen could
              never end itself -- it sat on "Talking..." while its heartbeat
              re-triggered the ended-record listener every five seconds.

              This is also what makes the key check in goBack safe: a screen's
              closures can no longer outlive its own stack entry, so a rejected
              pop always means the caller is genuinely gone. */}
          <React.Fragment key={currentRoute.key}>
            {/* goBack is bound to the entry that is rendering it, so a screen
                that has since been replaced cannot pop its own replacement. */}
            {SCREENS[screen]({ params, navigate, goBack: screenGoBack })}
          </React.Fragment>
          {/* Mounted last so its Modal renders above every screen. Without this
              the imperative Alert API silently no-ops (see CustomAlert.tsx). */}
          <CustomAlert />
        </UserProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
