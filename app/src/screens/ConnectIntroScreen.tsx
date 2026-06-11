import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Rect,
  Stop,
} from 'react-native-svg';

import { api, ApiError } from '../api/client';
import { Button } from '../components/Button';
import {
  SheetBody,
  SheetHandle,
  SheetTitle,
  sheetIn,
} from '../components/Sheet';
import { useApp } from '../lib/appContext';
import { APPLE_SLUG, type ProviderInfo } from '../lib/catalog';
import { ConnectAppleScreen } from './ConnectAppleScreen';

const HERO_W = 337;
const HERO_H = 320;

/**
 * Stand-in for the design's device renders: a soft dark-to-light gradient
 * panel with a simple wearable silhouette. Rings get a torus, watches a
 * rounded face with strap stubs; no binary assets.
 */
function DeviceHero({ slug }: { slug: string }) {
  const isRing = slug === 'oura' || slug === 'whoop_v2';
  const cx = HERO_W / 2;
  const cy = HERO_H / 2;
  return (
    <View
      className="w-full items-center justify-center overflow-hidden rounded-3xl"
      style={{ height: HERO_H }}
    >
      <Svg width="100%" height="100%" viewBox={`0 0 ${HERO_W} ${HERO_H}`}>
        <Defs>
          <LinearGradient id="heroBg" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#9A9696" />
            <Stop offset="0.45" stopColor="#C7C4C4" />
            <Stop offset="1" stopColor="#F3F3F3" />
          </LinearGradient>
          <LinearGradient id="heroShade" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#1B1B1B" />
            <Stop offset="1" stopColor="#4A4846" />
          </LinearGradient>
        </Defs>
        <Rect width={HERO_W} height={HERO_H} fill="url(#heroBg)" />
        {isRing ? (
          <>
            <Circle cx={cx} cy={cy} r={92} fill="url(#heroShade)" />
            <Circle cx={cx - 6} cy={cy - 6} r={58} fill="#CFCCCA" />
            <Circle cx={cx - 6} cy={cy - 6} r={58} fillOpacity={0} stroke="#11111122" strokeWidth={2} />
          </>
        ) : (
          <>
            <Rect x={cx - 34} y={cy - 124} width={68} height={56} rx={16} fill="url(#heroShade)" />
            <Rect x={cx - 34} y={cy + 68} width={68} height={56} rx={16} fill="url(#heroShade)" />
            <Rect x={cx - 64} y={cy - 76} width={128} height={152} rx={40} fill="url(#heroShade)" />
            <Rect x={cx - 48} y={cy - 58} width={96} height={116} rx={28} fill="#11100F" />
          </>
        )}
      </Svg>
    </View>
  );
}

const POLL_ATTEMPTS = 4;
const POLL_DELAY_MS = 1500;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Props {
  provider: ProviderInfo;
}

export function ConnectIntroScreen({ provider }: Props) {
  const { mode, session, refreshDevices, nav } = useApp();
  const [busy, setBusy] = useState<'link' | 'demo' | null>(null);

  // Apple Watch never goes through hosted link OAuth. Entries that land
  // here with the apple provider (reconnect from devices, retry from the
  // result sheet) render the pairing flow instead.
  if (provider.slug === APPLE_SLUG) {
    return <ConnectAppleScreen />;
  }

  /** Webhook delivery can lag the OAuth redirect, so poll a few times. */
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

  /**
   * Snapshot of providers connected right now, taken BEFORE a connect flow
   * starts. Web-connected devices on the same account would otherwise make
   * a cancelled browser pass as success. Empty on fetch failure (best
   * effort: an unknown baseline must not block a genuine connect).
   */
  async function connectedBefore(userId: string): Promise<Set<string>> {
    try {
      const devices = await api.getDevices(userId);
      return new Set(
        devices
          .filter((d) => d.status === 'connected')
          .map((d) => d.provider),
      );
    } catch {
      return new Set();
    }
  }

  async function handleContinue() {
    if (!session) return;
    setBusy('link');
    try {
      const before = await connectedBefore(session.userId);
      if (before.has(provider.slug)) {
        // The menu should not have offered this provider; guard anyway.
        nav.replace({ name: 'connectResult', provider, ok: true, already: true });
        return;
      }
      const redirectUrl = Linking.createURL('connect/callback');
      const link = await api.createLink(
        session.userId,
        provider.slug,
        redirectUrl,
      );
      const result = await WebBrowser.openAuthSessionAsync(
        link.link_url,
        redirectUrl,
      );
      if (result.type === 'cancel' || result.type === 'dismiss') {
        // Closing the browser is never a success. Stay on this screen so
        // the user can retry or back out.
        return;
      }
      // Success means newly connected: it was not connected before the
      // browser opened and it is connected now (polling covers webhook lag).
      const ok = await providerConnected(session.userId);
      // Warm the shared device cache so home reflects the new connection
      // immediately instead of briefly trusting the pre-connect snapshot.
      if (ok) refreshDevices();
      nav.replace({
        name: 'connectResult',
        provider,
        ok,
        message: ok
          ? undefined
          : 'The connection was not confirmed. Please try again.',
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

  async function handleDemo() {
    if (!session) return;
    setBusy('demo');
    try {
      const before = await connectedBefore(session.userId);
      if (before.has(provider.slug)) {
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
          <DeviceHero slug={provider.slug} />
          <View className="mt-2.5">
            <SheetTitle>
              Connect your {provider.name} in a few steps
            </SheetTitle>
          </View>
          <View className="mt-2.5">
            <SheetBody>
              Select your device, log in securely, and confirm what data to
              share. You'll return here once setup is complete.
            </SheetBody>
          </View>
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
                label="Continue"
                onPress={handleContinue}
                busy={busy === 'link'}
                disabled={busy === 'demo'}
              />
            </View>
          </View>
          {provider.demo && mode === 'sandbox' ? (
            <Pressable
              onPress={handleDemo}
              disabled={busy !== null}
              className="mt-3 items-center py-2 active:opacity-60"
            >
              <Text className="text-[13px] font-sans-medium text-sub underline">
                {busy === 'demo' ? 'Connecting demo data...' : 'Use demo data'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </Animated.View>
    </View>
  );
}
