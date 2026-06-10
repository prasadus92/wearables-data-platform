import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { api, ApiError } from '../api/client';
import { Button } from '../components/Button';
import { Header } from '../components/Header';
import { useApp } from '../lib/appContext';
import { DATA_WE_READ, type ProviderInfo } from '../lib/catalog';
import { enter } from '../lib/motion';
import { colors, fonts } from '../theme/tokens';

function CheckIcon() {
  return (
    <Svg width={16} height={16} viewBox="0 0 16 16" fill="none">
      <Path
        d="M3 8.5L6.5 12L13 4.5"
        stroke={colors.leaf}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
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
  const { mode, session, nav } = useApp();
  const [busy, setBusy] = useState<'link' | 'demo' | null>(null);

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

  async function handleContinue() {
    if (!session) return;
    setBusy('link');
    try {
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
        // The user may still have finished the OAuth before closing.
        const ok = await providerConnected(session.userId);
        if (ok) {
          nav.replace({ name: 'connectResult', provider, ok: true });
        }
        return;
      }
      const ok = await providerConnected(session.userId);
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
      await api.connectDemo(session.userId, provider.slug);
      const ok = await providerConnected(session.userId);
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
    <View className="flex-1 bg-paper pt-14">
      <Header title={provider.name} onBack={nav.pop} />
      <ScrollView className="flex-1 px-5 pt-2">
        <Animated.View entering={enter(0)}>
          <View className="rounded-2xl bg-card p-5">
            <View className="h-14 w-14 items-center justify-center rounded-full bg-paper">
              <Text className="text-[20px] font-sans-medium text-ink">
                {provider.name[0]}
              </Text>
            </View>
            <Text className="mt-4 text-[20px] font-sans-medium text-ink">
              Connect your {provider.name}
            </Text>
            <Text className="mt-1.5 text-[14px] font-sans leading-[20px] text-sub">
              {provider.blurb}
            </Text>

            <Text
              style={{ fontFamily: fonts.mono }}
              className="mb-2 mt-5 text-[12px] uppercase tracking-[1.5px] text-faint"
            >
              Data we read
            </Text>
            {DATA_WE_READ.map((item) => (
              <View key={item} className="mb-2 flex-row items-center">
                <CheckIcon />
                <Text className="ml-2.5 text-[14px] font-sans text-ink">
                  {item}
                </Text>
              </View>
            ))}

            <Text className="mt-3 text-[12px] font-sans leading-[17px] text-faint">
              We never see your {provider.name} password. You can disconnect at
              any time and your historical data stays yours.
            </Text>
          </View>
        </Animated.View>
      </ScrollView>

      <Animated.View
        entering={enter(1)}
        style={{ paddingHorizontal: 20, paddingBottom: 40, paddingTop: 12 }}
      >
        <Button
          label="Continue"
          onPress={handleContinue}
          busy={busy === 'link'}
          disabled={busy === 'demo'}
        />
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
      </Animated.View>
    </View>
  );
}
