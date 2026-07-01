import './global.css';

import { ClerkProvider, useAuth, useClerk } from '@clerk/clerk-expo';
import { tokenCache } from '@clerk/clerk-expo/token-cache';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Text, useColorScheme, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ReducedMotionConfig, ReduceMotion } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { Device, AggregatorEnv } from '@wearables/health-core';

import { api, ApiError, setTokenProvider } from './src/api/client';
import { Button } from './src/components/Button';
import { AppContext, type AppState, type Nav, type Route } from './src/lib/appContext';
import { storage, type Session } from './src/lib/storage';
import { ConnectAppleScreen } from './src/screens/ConnectAppleScreen';
import { ConnectIntroScreen } from './src/screens/ConnectIntroScreen';
import { ConnectMenuScreen } from './src/screens/ConnectMenuScreen';
import { ConnectResultScreen } from './src/screens/ConnectResultScreen';
import { ConnectSyncScreen } from './src/screens/ConnectSyncScreen';
import { DevicesScreen } from './src/screens/DevicesScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { WelcomeScreen } from './src/screens/WelcomeScreen';
import {
  colors,
  type AppearancePref,
  type ResolvedTheme,
} from './src/theme/tokens';

// Completes pending auth sessions when the OAuth redirect returns (web only).
WebBrowser.maybeCompleteAuthSession();

const CLERK_PUBLISHABLE_KEY =
  process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';

export default function App() {
  return (
    <ClerkProvider
      publishableKey={CLERK_PUBLISHABLE_KEY}
      tokenCache={tokenCache}
    >
      <Root />
    </ClerkProvider>
  );
}

function Root() {
  // Brand typography: Book is the body face, Medium carries headings.
  const [fontsLoaded] = useFonts({
    PPNeueMontreal: require('./assets/fonts/PPNeueMontreal-Book.otf'),
    'PPNeueMontreal-Medium': require('./assets/fonts/PPNeueMontreal-Medium.otf'),
  });

  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<AggregatorEnv>('sandbox');
  // One session per environment, so Demo and Live coexist and switching is
  // instant. Demo (sandbox) offers synthetic wearables; Live (production)
  // connects real devices over real provider OAuth.
  const [sessions, setSessions] = useState<Record<AggregatorEnv, Session | null>>({
    sandbox: null,
    production: null,
  });
  const [skipped, setSkipped] = useState(false);
  const [connectCardDismissed, setConnectCardDismissed] = useState(false);
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }]);

  // Appearance preference for the home look: follow the OS, or force one.
  // The profile and connect screens stay light by design in either case.
  const [appearance, setAppearanceState] =
    useState<AppearancePref>('system');
  const systemScheme = useColorScheme();
  const theme: ResolvedTheme =
    appearance === 'system'
      ? systemScheme === 'light'
        ? 'light'
        : 'dark'
      : appearance;
  const setAppearance = useCallback((pref: AppearancePref) => {
    setAppearanceState(pref);
    storage.saveAppearance(pref);
  }, []);

  // Bridges Clerk session state into the API client. While signed in, every
  // request carries a fresh session JWT instead of the static API key.
  // `bridged` flips to true only AFTER the token provider is registered, so
  // no "signed in" request ever goes out with the API key. Mirrors web's
  // AuthBridge.
  const { isLoaded: clerkLoaded, isSignedIn, getToken } = useAuth();
  const clerk = useClerk();
  const [bridged, setBridged] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [bootAttempt, setBootAttempt] = useState(0);
  const wasSignedIn = useRef(false);

  useEffect(() => {
    if (clerkLoaded && isSignedIn) {
      setTokenProvider(() => getToken());
      setBridged(true);
    } else {
      setTokenProvider(null);
      setBridged(false);
    }
    return () => setTokenProvider(null);
  }, [clerkLoaded, isSignedIn, getToken]);

  useEffect(() => {
    (async () => {
      const [
        savedMode,
        savedSessions,
        savedSkipped,
        savedDismissed,
        savedAppearance,
      ] = await Promise.all([
        storage.loadMode(),
        storage.loadSessions(),
        storage.loadSkipped(),
        storage.loadConnectCardDismissed(),
        storage.loadAppearance(),
      ]);
      setMode(savedMode);
      setSessions(savedSessions);
      setSkipped(savedSkipped);
      setConnectCardDismissed(savedDismissed);
      setAppearanceState(savedAppearance);
      setReady(true);
    })();
  }, []);

  // Signed-in identities bootstrap through POST /v1/me per environment. The
  // result lands in the same per-mode slot, replacing any stored anonymous
  // session, so the rest of the app is identity-agnostic. Re-runs on mode
  // switch so Demo and Live each resolve their own user.
  useEffect(() => {
    if (!bridged || !ready) return;
    let cancelled = false;
    setBootError(null);
    api
      .me(mode)
      .then((me) => {
        if (cancelled) return;
        const next: Session = {
          userId: me.id,
          clientUserId: me.client_user_id,
          auth: 'clerk',
        };
        setSessions((s) => ({ ...s, [mode]: next }));
        storage.saveSession(mode, next);
      })
      .catch((err) => {
        if (cancelled) return;
        setBootError(
          err instanceof ApiError && err.status > 0
            ? err.message
            : 'Could not reach the server. Check your connection and try again.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [bridged, ready, mode, bootAttempt]);

  // Signing out of the Clerk identity clears both mode slots and returns to
  // onboarding, so signed-in sessions never linger as anonymous ones. Also
  // covers external session expiry, not just the in-app Sign out control.
  useEffect(() => {
    if (bridged) {
      wasSignedIn.current = true;
      return;
    }
    if (!wasSignedIn.current) return;
    wasSignedIn.current = false;
    setSessions({ sandbox: null, production: null });
    setSkipped(false);
    setStack([{ name: 'home' }]);
    setBootError(null);
    storage.clearAllSessions();
  }, [bridged]);

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

  const clerkSignOut = useCallback(() => {
    // The bridged watcher above clears local sessions once Clerk confirms.
    clerk.signOut().catch(() => {
      // Even if Clerk fails (offline), drop local state so the UI signs out.
      setSessions({ sandbox: null, production: null });
      setSkipped(false);
      setStack([{ name: 'home' }]);
      storage.clearAllSessions();
    });
  }, [clerk]);

  const switchMode = useCallback(
    (next: AggregatorEnv) => {
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

  // Once Clerk has resolved, only show sessions that match the auth state:
  // signed in ignores stored anonymous sessions (api.me replaces them), and
  // signed out ignores any leftover Clerk-bootstrapped session. While Clerk
  // is still loading, trust the stored slot to avoid an onboarding flash.
  const stored = sessions[mode];
  const storedIsClerk = stored?.auth === 'clerk';
  const session = clerkLoaded && storedIsClerk !== bridged ? null : stored;

  // Shared device list, keyed to the user it was fetched for so a mode or
  // identity switch never shows another account's devices. Null means
  // unknown; a failed fetch keeps the last known list instead of faking [].
  const [deviceCache, setDeviceCache] = useState<{
    userId: string;
    list: Device[];
  } | null>(null);
  const deviceFetchSeq = useRef(0);
  const devices =
    session && deviceCache?.userId === session.userId
      ? deviceCache.list
      : null;

  const refreshDevices = useCallback(async (): Promise<Device[] | null> => {
    if (!session) return null;
    // A Clerk-backed session cannot authenticate until the token bridge is
    // registered; a request now would 401 and read as "no devices".
    if (session.auth === 'clerk' && !bridged) return null;
    const { userId } = session;
    const seq = ++deviceFetchSeq.current;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const list = await api.getDevices(userId);
        // Only the newest in-flight fetch may write, so a slow stale
        // response never overwrites fresher data.
        if (deviceFetchSeq.current === seq) setDeviceCache({ userId, list });
        return list;
      } catch {
        if (attempt < 2) {
          await new Promise((resolve) =>
            setTimeout(resolve, 600 * (attempt + 1)),
          );
        }
      }
    }
    return null;
  }, [session, bridged]);

  // Fetch whenever the session identity or auth readiness changes: covers
  // cold start, sign in, mode switch, and the moment the Clerk token bridge
  // resolves after a stored session rendered the UI first.
  useEffect(() => {
    refreshDevices();
  }, [refreshDevices]);

  const value: AppState = useMemo(
    () => ({
      mode,
      switchMode,
      appearance,
      setAppearance,
      theme,
      session,
      skipped,
      connectCardDismissed,
      signIn,
      skip,
      signOut,
      clerkSignOut,
      dismissConnectCard,
      devices,
      refreshDevices,
      nav,
    }),
    [
      mode,
      switchMode,
      appearance,
      setAppearance,
      theme,
      session,
      skipped,
      connectCardDismissed,
      signIn,
      skip,
      signOut,
      clerkSignOut,
      dismissConnectCard,
      devices,
      refreshDevices,
      nav,
    ],
  );

  // First paint waits for both stored state and the brand fonts, so no
  // screen ever flashes in the system face.
  if (!ready || !fontsLoaded) {
    return <View className="flex-1 bg-paper" />;
  }

  const top = stack[stack.length - 1];
  const bootstrapping = bridged && !session;
  const showWelcome = !session && !skipped && !bootstrapping;

  let screen;
  if (bootstrapping) {
    // Signed in but the per-mode user has not resolved yet (or failed).
    screen = (
      <View className="flex-1 items-center justify-center bg-paper px-8">
        {bootError ? (
          <View className="w-full items-center">
            <Text className="mb-5 text-center text-[14px] font-sans leading-[20px] text-sub">
              {bootError}
            </Text>
            <Button
              label="Try again"
              onPress={() => setBootAttempt((n) => n + 1)}
            />
            <View className="mt-3">
              <Button label="Sign out" variant="ghost" onPress={clerkSignOut} />
            </View>
          </View>
        ) : (
          <ActivityIndicator color={colors.sub} />
        )}
      </View>
    );
  } else if (showWelcome) {
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
      case 'connectApple':
        screen = <ConnectAppleScreen />;
        break;
      case 'connectResult':
        screen = (
          <ConnectResultScreen
            provider={top.provider}
            ok={top.ok}
            already={top.already}
            message={top.message}
          />
        );
        break;
      case 'connectSync':
        screen = <ConnectSyncScreen provider={top.provider} />;
        break;
    }
  }

  // Connect-flow sheets sit on a dark scrim, and home sits on the dark
  // backdrop (when the resolved theme is dark), so their status bars flip
  // light. The light home keeps dark status bar content like the rest.
  const onScrim =
    !bootstrapping &&
    !showWelcome &&
    ((top.name === 'home' && theme === 'dark') ||
      top.name === 'connectMenu' ||
      top.name === 'connectIntro' ||
      top.name === 'connectApple' ||
      top.name === 'connectResult' ||
      top.name === 'connectSync');

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* Honor the OS reduce-motion setting for every animation. */}
      <ReducedMotionConfig mode={ReduceMotion.System} />
      <SafeAreaProvider>
        <AppContext.Provider value={value}>
          <View className="flex-1 bg-paper">
            <StatusBar style={showWelcome || onScrim ? 'light' : 'dark'} />
            {screen}
          </View>
        </AppContext.Provider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
