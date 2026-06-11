import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { api, ApiError } from '../api/client';
import { Button } from '../components/Button';
import {
  SheetBody,
  SheetCaption,
  SheetHandle,
  SheetTitle,
  sheetIn,
} from '../components/Sheet';
import { useApp } from '../lib/appContext';
import { APPLE_SLUG, PROVIDERS, type ProviderInfo } from '../lib/catalog';
import { enter } from '../lib/motion';
import { colors, fonts } from '../theme/tokens';

const HERO_W = 337;
const HERO_H = 340;

const POLL_ATTEMPTS = 4;
const POLL_DELAY_MS = 1500;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const APPLE_PROVIDER: ProviderInfo = PROVIDERS.find(
  (p) => p.slug === APPLE_SLUG,
) ?? {
  slug: APPLE_SLUG,
  name: 'Apple Watch',
  blurb: 'Watch for activity, heart health and sleep.',
  demo: true,
};

function Heart({ size = 22 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
        fill="#FF3B30"
      />
    </Svg>
  );
}

/** Tiny green iOS-style toggle for the mock permission rows. */
function Toggle() {
  return (
    <View
      style={{
        width: 34,
        height: 20,
        borderRadius: 10,
        backgroundColor: colors.good,
        justifyContent: 'center',
        alignItems: 'flex-end',
        paddingHorizontal: 2,
      }}
    >
      <View
        style={{
          width: 16,
          height: 16,
          borderRadius: 8,
          backgroundColor: colors.card,
        }}
      />
    </View>
  );
}

function AccessRow({ label }: { label: string }) {
  return (
    <View className="w-full flex-row items-center justify-between rounded-xl bg-grey px-3 py-2.5">
      <View className="flex-row items-center gap-2">
        <Heart size={12} />
        <Text className="text-[12px] font-sans text-ink">{label}</Text>
      </View>
      <Toggle />
    </View>
  );
}

/**
 * Stand-in for the design's screenshot of the iOS Health access prompt: a
 * soft gradient panel with a white permission card, matching the other
 * provider heroes (ConnectIntroScreen renders the same way); no binary
 * assets.
 */
function AppleHero() {
  return (
    <View
      className="w-full items-center justify-center overflow-hidden rounded-3xl"
      style={{ height: HERO_H }}
    >
      <Svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${HERO_W} ${HERO_H}`}
        style={{ position: 'absolute' }}
      >
        <Defs>
          <LinearGradient id="appleHeroBg" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#9A9696" />
            <Stop offset="0.45" stopColor="#C7C4C4" />
            <Stop offset="1" stopColor="#F3F3F3" />
          </LinearGradient>
        </Defs>
        <Rect width={HERO_W} height={HERO_H} fill="url(#appleHeroBg)" />
      </Svg>
      <View className="w-[230px] items-center rounded-2xl bg-card px-4 py-4">
        <Text className="text-[12px] font-sans-medium text-ink">
          Health Access
        </Text>
        <View className="mt-3 h-12 w-12 items-center justify-center rounded-xl bg-grey">
          <Heart size={24} />
        </View>
        <Text className="mt-2 text-[18px] font-sans-medium text-ink">
          Health
        </Text>
        <Text className="mt-1 text-center text-[11px] font-sans leading-[15px] text-mute">
          Allow access to read your health data.
        </Text>
        <View className="mt-3 w-full gap-1.5">
          <AccessRow label="Heart Rate" />
          <AccessRow label="Heart Rate Variability" />
        </View>
      </View>
    </View>
  );
}

/** Numbered step row for the pairing instructions. */
function Step({ n, text }: { n: number; text: string }) {
  return (
    <View className="flex-row items-start gap-3">
      <View className="h-6 w-6 items-center justify-center rounded-full border border-ink">
        <Text className="text-[12px] font-sans-medium leading-[14px] text-ink">
          {n}
        </Text>
      </View>
      <Text className="flex-1 text-[14px] font-sans leading-[20px] text-mute">
        {text}
      </Text>
    </View>
  );
}

function expiresHint(expiresAt: string | null): string | null {
  if (!expiresAt) return null;
  const ts = Date.parse(expiresAt);
  if (Number.isNaN(ts)) return null;
  const mins = Math.round((ts - Date.now()) / 60000);
  if (mins <= 0) return 'This code has expired. Get a new one below.';
  return `Expires in about ${mins} minute${mins === 1 ? '' : 's'}.`;
}

type Phase =
  | { name: 'intro' }
  | { name: 'code'; code: string; expiresAt: string | null }
  | { name: 'error'; message: string };

/**
 * Apple Watch connect flow. HealthKit data leaves an iPhone only through an
 * app with HealthKit entitlements, so Live skips hosted OAuth: the user
 * mints a pairing code here, enters it in the Aggregator Connect bridge app, and
 * grants Health access there. Demo attaches the provider instantly through
 * the same demo endpoint as the other providers and rides the existing
 * success and sync story.
 */
export function ConnectAppleScreen() {
  const { mode, session, refreshDevices, nav } = useApp();
  const provider = APPLE_PROVIDER;
  const [phase, setPhase] = useState<Phase>({ name: 'intro' });
  const [busy, setBusy] = useState<'code' | 'demo' | null>(null);

  /** Webhook delivery can lag the connect call, so poll a few times. */
  async function providerConnected(userId: string): Promise<boolean> {
    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
      if (attempt > 0) await sleep(POLL_DELAY_MS);
      try {
        const devices = await api.getDevices(userId);
        if (
          devices.some(
            (d) => d.provider === provider.slug && d.status === 'connected',
          )
        ) {
          return true;
        }
      } catch {
        // transient fetch error, retry
      }
    }
    return false;
  }

  async function alreadyConnected(userId: string): Promise<boolean> {
    try {
      const devices = await api.getDevices(userId);
      return devices.some(
        (d) => d.provider === provider.slug && d.status === 'connected',
      );
    } catch {
      // Unknown baseline must not block a genuine connect.
      return false;
    }
  }

  async function handleGetCode() {
    if (!session) return;
    setBusy('code');
    try {
      const out = await api.createApplePairingCode(session.userId);
      if (!out.code) {
        setPhase({
          name: 'error',
          message: 'No pairing code came back. Please try again.',
        });
        return;
      }
      setPhase({
        name: 'code',
        code: out.code,
        expiresAt: out.expires_at ?? null,
      });
    } catch (err) {
      setPhase({
        name: 'error',
        message:
          err instanceof ApiError && err.status > 0
            ? err.message
            : 'Could not reach the server. Check your connection and try again.',
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleDemo() {
    if (!session) return;
    setBusy('demo');
    try {
      if (await alreadyConnected(session.userId)) {
        nav.replace({ name: 'connectResult', provider, ok: true, already: true });
        return;
      }
      await api.connectDemo(session.userId, provider.slug);
      const ok = await providerConnected(session.userId);
      if (ok) refreshDevices();
      nav.replace({
        name: 'connectResult',
        provider,
        ok,
        message: ok ? undefined : 'Demo connect did not complete.',
      });
    } catch (err) {
      nav.replace({
        name: 'connectResult',
        provider,
        ok: false,
        message:
          err instanceof ApiError && err.status > 0
            ? err.message
            : 'Could not reach the server. Check your connection and try again.',
      });
    } finally {
      setBusy(null);
    }
  }

  function goDevices() {
    // The pairing finishes in the Aggregator Connect app, so there is no success
    // event to wait for here. Warm the device list and land on devices,
    // where the new connection appears once data starts flowing.
    refreshDevices();
    nav.reset({ name: 'home' });
    nav.push({ name: 'devices' });
  }

  const demoMode = mode === 'sandbox';

  return (
    <View className="flex-1 bg-scrim">
      {/* The dimmed area above the sheet backs out, like the design. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={nav.pop}
        className="flex-1"
      />
      <Animated.View
        entering={sheetIn}
        style={{ paddingHorizontal: 8, paddingBottom: 8 }}
      >
        <SheetHandle />
        <View className="rounded-[29px] bg-card p-5">
          {phase.name === 'intro' ? (
            <>
              <AppleHero />
              <View className="mt-2.5">
                <SheetTitle>
                  Connect your Apple Watch in a few steps
                </SheetTitle>
              </View>
              <View className="mt-2.5">
                <SheetBody>
                  {demoMode
                    ? 'Connect a demo Apple Watch with sample health data. It attaches instantly so you can explore right away.'
                    : 'Your watch shares data through the Health app on your iPhone. Get a pairing code, enter it in the Aggregator Connect app, and grant Health access.'}
                </SheetBody>
              </View>
              {demoMode ? (
                <View className="mt-6 flex-row gap-2">
                  <View className="flex-1">
                    <Button
                      label="Cancel"
                      variant="outline"
                      onPress={nav.pop}
                      disabled={busy !== null}
                    />
                  </View>
                  <View className="flex-1">
                    <Button
                      label="Connect"
                      onPress={handleDemo}
                      busy={busy === 'demo'}
                    />
                  </View>
                </View>
              ) : (
                <View className="mt-6 gap-2">
                  <Button
                    label="Get pairing code"
                    onPress={handleGetCode}
                    busy={busy === 'code'}
                  />
                  <Button
                    label="Cancel"
                    variant="outline"
                    onPress={nav.pop}
                    disabled={busy !== null}
                  />
                </View>
              )}
            </>
          ) : phase.name === 'code' ? (
            <Animated.View entering={enter(0)}>
              <SheetCaption label="Pairing code" />
              <View className="mt-2.5">
                <SheetTitle>Enter this code in Aggregator Connect</SheetTitle>
              </View>
              <View className="mt-4 items-center rounded-2xl bg-grey px-4 py-6">
                <Text
                  selectable
                  accessibilityLabel={`Pairing code ${phase.code}`}
                  style={{
                    fontFamily: fonts.mono,
                    fontSize: 40,
                    lineHeight: 48,
                    letterSpacing: 6,
                    color: colors.ink,
                  }}
                >
                  {phase.code}
                </Text>
                {expiresHint(phase.expiresAt) ? (
                  <Text className="mt-2 text-[12px] font-sans text-faint">
                    {expiresHint(phase.expiresAt)}
                  </Text>
                ) : null}
              </View>
              <View className="mt-5 gap-3">
                <Step
                  n={1}
                  text="Install the Aggregator Connect app from the App Store."
                />
                <Step n={2} text="Open it and enter this code." />
                <Step
                  n={3}
                  text="Grant Health access when prompted. Your data starts syncing shortly after."
                />
              </View>
              <View className="mt-6">
                <Button label="Done" onPress={goDevices} />
              </View>
              <Pressable
                onPress={handleGetCode}
                disabled={busy !== null}
                className="mt-3 items-center py-2 active:opacity-60"
              >
                <Text className="text-[13px] font-sans-medium text-sub underline">
                  {busy === 'code' ? 'Getting a new code...' : 'Get a new code'}
                </Text>
              </Pressable>
            </Animated.View>
          ) : (
            <Animated.View entering={enter(0)}>
              <SheetCaption label="Error" color={colors.danger} />
              <View className="mt-2.5">
                <SheetTitle>Could not get a pairing code</SheetTitle>
              </View>
              <View className="mt-4">
                <SheetBody>{phase.message}</SheetBody>
              </View>
              <View className="mt-6 flex-row gap-2">
                <View className="flex-1">
                  <Button label="Cancel" variant="outline" onPress={nav.pop} />
                </View>
                <View className="flex-1">
                  <Button
                    label="Retry"
                    onPress={handleGetCode}
                    busy={busy === 'code'}
                  />
                </View>
              </View>
            </Animated.View>
          )}
        </View>
      </Animated.View>
    </View>
  );
}
