import './global.css';

import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

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
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [skipped, setSkipped] = useState(false);
  const [connectCardDismissed, setConnectCardDismissed] = useState(false);
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }]);

  useEffect(() => {
    (async () => {
      const [savedSession, savedSkipped, savedDismissed] = await Promise.all([
        storage.loadSession(),
        storage.loadSkipped(),
        storage.loadConnectCardDismissed(),
      ]);
      setSession(savedSession);
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
      setSession(next);
      setSkipped(false);
      setStack([{ name: 'home' }]);
      storage.saveSession(next);
    },
    [],
  );

  const skip = useCallback(() => {
    setSkipped(true);
    setStack([{ name: 'home' }]);
    storage.saveSkipped();
  }, []);

  const signOut = useCallback(() => {
    setSession(null);
    setSkipped(false);
    setStack([{ name: 'home' }]);
    storage.clearSession();
  }, []);

  const dismissConnectCard = useCallback(() => {
    setConnectCardDismissed(true);
    storage.saveConnectCardDismissed();
  }, []);

  const value: AppState = useMemo(
    () => ({
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

  if (!ready) {
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
    <SafeAreaProvider>
      <AppContext.Provider value={value}>
        <View className="flex-1 bg-paper">
          <StatusBar style={showWelcome ? 'light' : 'dark'} />
          {screen}
        </View>
      </AppContext.Provider>
    </SafeAreaProvider>
  );
}
