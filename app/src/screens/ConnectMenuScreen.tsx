import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { api } from '../api/client';
import type { Device } from '../api/types';
import { AnimatedPressable } from '../components/AnimatedPressable';
import { Header } from '../components/Header';
import { useApp } from '../lib/appContext';
import { PROVIDERS, type ProviderInfo } from '../lib/catalog';
import { enter } from '../lib/motion';
import { colors } from '../theme/tokens';

function Chevron() {
  return (
    <Svg width={16} height={16} viewBox="0 0 16 16" fill="none">
      <Path
        d="M6 3.5L10.5 8L6 12.5"
        stroke={colors.faint}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function ProviderRow({
  provider,
  status,
  index,
  onPress,
}: {
  provider: ProviderInfo;
  status: 'none' | 'expired';
  index: number;
  onPress: () => void;
}) {
  return (
    <AnimatedPressable
      entering={enter(index)}
      onPress={onPress}
      className="mb-3 flex-row items-center rounded-2xl bg-card p-4"
    >
      <View className="h-12 w-12 items-center justify-center rounded-full bg-paper">
        <Text className="text-[17px] font-sans-medium text-ink">
          {provider.name[0]}
        </Text>
      </View>
      <View className="ml-3 flex-1">
        <Text className="text-[16px] font-sans-medium text-ink">
          {provider.name}
        </Text>
        <Text
          className={`mt-0.5 text-[13px] ${status === 'expired' ? 'font-sans-medium text-amber' : 'font-sans text-sub'}`}
        >
          {status === 'expired' ? 'Connection expired' : 'Not connected'}
        </Text>
      </View>
      <Chevron />
    </AnimatedPressable>
  );
}

export function ConnectMenuScreen() {
  const { session, nav } = useApp();
  const [devices, setDevices] = useState<Device[] | null>(null);

  const load = useCallback(async () => {
    if (!session) {
      setDevices([]);
      return;
    }
    try {
      setDevices(await api.getDevices(session.userId));
    } catch {
      setDevices([]);
    }
  }, [session]);

  useEffect(() => {
    load();
  }, [load]);

  const statusFor = (slug: string): 'connected' | 'expired' | 'none' => {
    const device = devices?.find(
      (d) => d.provider === slug && d.status !== 'disconnected',
    );
    if (!device) return 'none';
    return device.status === 'expired' ? 'expired' : 'connected';
  };

  // Already-connected providers are managed from the devices screen instead.
  const available = PROVIDERS.filter((p) => statusFor(p.slug) !== 'connected');

  return (
    <View className="flex-1 bg-paper pt-14">
      <Header title="Connect a device" onBack={nav.pop} />
      <ScrollView className="flex-1 px-5 pt-2">
        <Animated.View entering={enter(0)}>
          <Text className="mb-4 text-[14px] font-sans leading-[20px] text-sub">
            Choose your wearable. You will sign in to the brand's own account
            to authorize data sharing.
          </Text>
        </Animated.View>
        {devices === null ? (
          <View className="items-center py-16">
            <ActivityIndicator color={colors.sub} />
          </View>
        ) : available.length === 0 ? (
          <View className="items-center rounded-2xl bg-card px-6 py-12">
            <Text className="text-center text-[14px] font-sans text-sub">
              All supported devices are already connected.
            </Text>
          </View>
        ) : (
          available.map((p, i) => (
            <ProviderRow
              key={p.slug}
              provider={p}
              status={statusFor(p.slug) === 'expired' ? 'expired' : 'none'}
              index={i + 1}
              onPress={() => nav.push({ name: 'connectIntro', provider: p })}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}
