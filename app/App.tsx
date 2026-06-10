import './global.css';

import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ReducedMotionConfig, ReduceMotion } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { JunctionEnv } from './src/api/types';
import { AppContext, type AppState, type Nav, type Route } from './src/lib/appContext';
import { storage, type Session } from './src/lib/storage';
import { ConnectIntroScreen } from './src/screens/ConnectIntroScreen';
import { ConnectMenuScreen } from './src/screens/ConnectMenuScreen';
import { ConnectResultScreen } from './src/screens/ConnectResultScreen';
import { DevicesScreen } from './src/screens/DevicesScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { WelcomeScreen } from './src/screens/WelcomeScreen';

// Completes pending auth sessions when the OAuth redirect returns (web only).
WebBrowser.maybeCompleteAuthSession();

export default function App() {
  // Brand typography: Book is the body face, Medium carries headings.
  const [fontsLoaded] = useFonts({
    PPNeueMontreal: require('./assets/fonts/PPNeueMontreal-Book.otf'),
    'PPNeueMontreal-Medium': require('./assets/fonts/PPNeueMontreal-Medium.otf'),
  });

  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<JunctionEnv>('sandbox');
  // One session per environment, so Demo and Live coexist and switching is
  // instant. Demo (sandbox) offers synthetic wearables; Live (production)
  // connects real devices over real provider OAuth.
  const [sessions, setSessions] = useState<Record<JunctionEnv, Session | null>>({
    sandbox: null,
    production: null,
  });
  const [skipped, setSkipped] = useState(false);
  const [connectCardDismissed, setConnectCardDismissed] = useState(false);
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }]);

  useEffect(() => {
    (async () => {
      const [savedMode, savedSessions, savedSkipped, savedDismissed] =
        await Promise.all([
          storage.loadMode(),
          storage.loadSessions(),
          storage.loadSkipped(),
          storage.loadConnectCardDismissed(),
        ]);
      setMode(savedMode);
      setSessions(savedSessions);
      setSkipped(savedSkipped);
      setConnectCardDismissed(savedDismissed);
      setReady(true);
    })();
  }, []);

  const nav: Nav = useMemo(
    () => ({
      push: (route) => setStack((s) => [...s, route]),
      pop: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
      reset: (route) => setStack([route]),
      replace: (route) => setStack((s) => [...s.slice(0, -1), route]),
    }),
    [],
  );

  const signIn = useCallback(
    (next: Session) => {
      setSessions((s) => ({ ...s, [mode]: next }));
      setSkipped(false);
      setStack([{ name: 'home' }]);
      storage.saveSession(mode, next);
    },
    [mode],
  );

  const skip = useCallback(() => {
    setSkipped(true);
    setStack([{ name: 'home' }]);
    storage.saveSkipped();
  }, []);

  const signOut = useCallback(() => {
    setSessions((s) => ({ ...s, [mode]: null }));
    setSkipped(false);
    setStack([{ name: 'home' }]);
    storage.clearSession(mode);
  }, [mode]);

  const switchMode = useCallback(
    (next: JunctionEnv) => {
      if (next === mode) return;
      setMode(next);
      setStack([{ name: 'home' }]);
      storage.saveMode(next);
      // A target environment without a session routes to Welcome in that
      // mode, so "Get started" creates the session where it belongs.
      if (!sessions[next]) {
        setSkipped(false);
        storage.clearSkipped();
      }
    },
    [mode, sessions],
  );

  const dismissConnectCard = useCallback(() => {
    setConnectCardDismissed(true);
    storage.saveConnectCardDismissed();
  }, []);

  const session = sessions[mode];

  const value: AppState = useMemo(
    () => ({
      mode,
      switchMode,
      session,
      skipped,
      connectCardDismissed,
      signIn,
      skip,
      signOut,
      dismissConnectCard,
      nav,
    }),
    [
      mode,
      switchMode,
      session,
      skipped,
      connectCardDismissed,
      signIn,
      skip,
      signOut,
      dismissConnectCard,
      nav,
    ],
  );

  // First paint waits for both stored state and the brand fonts, so no
  // screen ever flashes in the system face.
  if (!ready || !fontsLoaded) {
    return <View className="flex-1 bg-paper" />;
  }

  const top = stack[stack.length - 1];
  const showWelcome = !session && !skipped;

  let screen;
  if (showWelcome) {
    screen = <WelcomeScreen />;
  } else {
    switch (top.name) {
      case 'home':
        screen = <HomeScreen />;
        break;
      case 'devices':
        screen = <DevicesScreen />;
        break;
      case 'connectMenu':
        screen = <ConnectMenuScreen />;
        break;
      case 'connectIntro':
        screen = <ConnectIntroScreen provider={top.provider} />;
        break;
      case 'connectResult':
        screen = (
          <ConnectResultScreen
            provider={top.provider}
            ok={top.ok}
            message={top.message}
          />
        );
        break;
    }
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* Honor the OS reduce-motion setting for every animation. */}
      <ReducedMotionConfig mode={ReduceMotion.System} />
      <SafeAreaProvider>
        <AppContext.Provider value={value}>
          <View className="flex-1 bg-paper">
            <StatusBar style={showWelcome ? 'light' : 'dark'} />
            {screen}
          </View>
        </AppContext.Provider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
