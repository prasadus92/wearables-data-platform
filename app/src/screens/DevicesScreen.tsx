import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import Animated, {
  FadeOut,
  LinearTransition,
  ReduceMotion,
} from 'react-native-reanimated';

import type { Device, JunctionEnv } from '@youth/health-core';

import { api, ApiError } from '../api/client';
import { Button } from '../components/Button';
import { Header } from '../components/Header';
import { useApp } from '../lib/appContext';
import { PROVIDERS, providerName } from '../lib/catalog';
import { timeAgo } from '../lib/format';
import { tapLight } from '../lib/haptics';
import { enter } from '../lib/motion';
import { colors } from '../theme/tokens';

/** Springy reflow when device cards connect, disconnect or reorder. */
const reflow = LinearTransition.springify(300).reduceMotion(
  ReduceMotion.System,
);

/**
 * Segmented Demo/Live control. Each environment keeps its own session, so
 * flipping is instant; an environment without a session routes through the
 * Welcome screen in that mode.
 */
function ModeSwitch({
  mode,
  onChange,
  liveLocked,
}: {
  mode: JunctionEnv;
  onChange: (mode: JunctionEnv) => void;
  /** Live requires a signed-in account; locked taps acknowledge and stop. */
  liveLocked?: boolean;
}) {
  const segments: { value: JunctionEnv; label: string }[] = [
    { value: 'sandbox', label: 'Demo' },
    { value: 'production', label: 'Live' },
  ];
  return (
    <View
      accessibilityRole="tablist"
      className="flex-row rounded-full bg-paper p-1"
    >
      {segments.map((segment) => {
        const active = segment.value === mode;
        const locked = liveLocked && segment.value === 'production' && !active;
        return (
          <Pressable
            key={segment.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active, disabled: !!locked }}
            onPress={() => {
              if (active) return;
              tapLight();
              if (locked) return;
              onChange(segment.value);
            }}
            className={`rounded-full px-4 py-1.5 ${active ? 'bg-ink' : 'active:opacity-60'} ${locked ? 'opacity-40' : ''}`}
          >
            <Text
              className={`text-[12px] font-sans-medium ${active ? 'text-card' : 'text-sub'}`}
            >
              {segment.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function StatusDot({ status }: { status: 'connected' | 'expired' }) {
  return (
    <View
      className={`mr-1.5 h-2 w-2 rounded-full ${status === 'connected' ? 'bg-leaf' : 'bg-amber'}`}
    />
  );
}

function DeviceCard({
  device,
  onDisconnect,
  onReconnect,
}: {
  device: Device;
  onDisconnect: () => void;
  onReconnect: () => void;
}) {
  const expired = device.status === 'expired';
  return (
    <Animated.View
      entering={enter(0)}
      exiting={FadeOut.duration(180).reduceMotion(ReduceMotion.System)}
      layout={reflow}
      style={{
        marginBottom: 12,
        borderRadius: 16,
        backgroundColor: colors.card,
        padding: 16,
      }}
    >
      <View className="flex-row items-center">
        <View className="h-12 w-12 items-center justify-center rounded-full bg-paper">
          <Text className="text-[17px] font-sans-medium text-ink">
            {providerName(device.provider)[0]}
          </Text>
        </View>
        <View className="ml-3 flex-1">
          <Text className="text-[16px] font-sans-medium text-ink">
            {providerName(device.provider)}
          </Text>
          <View className="mt-1 flex-row items-center">
            <StatusDot status={expired ? 'expired' : 'connected'} />
            <Text
              className={`text-[13px] ${expired ? 'font-sans-medium text-amber' : 'font-sans text-leaf'}`}
            >
              {expired ? 'Connection expired' : 'Connected'}
            </Text>
          </View>
        </View>
        <Text className="text-[12px] font-sans text-faint">
          Last synced {timeAgo(device.last_data_at)}
        </Text>
      </View>
      <View className="mt-3 flex-row justify-end gap-4 border-t border-line pt-3">
        {expired ? (
          <Pressable onPress={onReconnect} className="active:opacity-60">
            <Text className="text-[14px] font-sans-medium text-ink">
              Reconnect
            </Text>
          </Pressable>
        ) : null}
        <Pressable onPress={onDisconnect} className="active:opacity-60">
          <Text className="text-[14px] font-sans-medium text-coral">
            Disconnect
          </Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

export function DevicesScreen() {
  const { mode, switchMode, session, signOut, clerkSignOut, nav } = useApp();
  // Clerk-bootstrapped sessions end via a real sign-out that clears every
  // mode; anonymous ones just swap the per-mode identity.
  const clerkAuthed = session?.auth === 'clerk';
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!session) {
      setDevices([]);
      return;
    }
    try {
      setDevices(await api.getDevices(session.userId));
    } catch {
      setDevices((prev) => prev ?? []);
    }
  }, [session]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  function confirmDisconnect(device: Device) {
    Alert.alert(
      `Disconnect ${providerName(device.provider)}?`,
      'We will stop receiving new data from this device. Your historical data is kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            if (!session) return;
            try {
              await api.disconnectDevice(session.userId, device.provider);
            } catch (err) {
              Alert.alert(
                'Could not disconnect',
                err instanceof ApiError ? err.message : 'Please try again.',
              );
            }
            await load();
          },
        },
      ],
    );
  }

  function reconnect(device: Device) {
    const provider = PROVIDERS.find((p) => p.slug === device.provider);
    if (provider) nav.push({ name: 'connectIntro', provider });
  }

  const active = (devices ?? []).filter((d) => d.status !== 'disconnected');

  return (
    <View className="flex-1 bg-paper pt-14">
      <Header title="Profile" onBack={nav.pop} />
      <ScrollView
        className="flex-1 px-5 pt-2"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.coral}
          />
        }
      >
        {session ? (
          <Animated.View entering={enter(0)}>
            <View className="mb-3 flex-row items-center rounded-2xl bg-card p-4">
              <View className="h-12 w-12 items-center justify-center rounded-full bg-ink">
                <Text className="text-[16px] font-sans-medium text-card">
                  {session.clientUserId[0]?.toUpperCase()}
                </Text>
              </View>
              <View className="ml-3 flex-1">
                <Text className="text-[16px] font-sans-medium text-ink">
                  {session.clientUserId}
                </Text>
                <Text className="mt-0.5 text-[12px] font-sans text-faint">
                  User id {session.userId.slice(0, 8)}
                </Text>
              </View>
              <Pressable
                onPress={clerkAuthed ? clerkSignOut : signOut}
                className="active:opacity-60"
              >
                <Text className="text-[13px] font-sans-medium text-sub">
                  {clerkAuthed ? 'Sign out' : 'Switch user'}
                </Text>
              </Pressable>
            </View>
          </Animated.View>
        ) : null}

        <Animated.View entering={enter(session ? 1 : 0)}>
          <View className="mb-5 rounded-2xl bg-card p-4">
            <View className="flex-row items-center">
              <View className="flex-1 pr-3">
                <Text className="text-[14px] font-sans-medium text-ink">
                  Data mode
                </Text>
                <Text className="mt-0.5 text-[12px] font-sans leading-[17px] text-faint">
                  {mode === 'sandbox'
                    ? 'Demo wearables with synthetic data'
                    : 'Real wearables over provider sign-in'}
                </Text>
              </View>
              <ModeSwitch
                mode={mode}
                onChange={switchMode}
                liveLocked={!clerkAuthed}
              />
            </View>
            {!clerkAuthed && mode === 'sandbox' ? (
              <Text className="mt-2 text-[11px] font-sans text-faint">
                Sign in to connect real devices
              </Text>
            ) : null}
          </View>
        </Animated.View>

        <Animated.View entering={enter(1)}>
          <Text className="mb-3 text-[18px] font-sans-medium text-ink">
            Your devices
          </Text>
        </Animated.View>

        {!session ? (
          <View className="items-center rounded-2xl bg-card px-6 py-12">
            <Text className="mb-5 text-center text-[14px] font-sans leading-[20px] text-sub">
              Create your profile to connect a wearable and start syncing your
              health data.
            </Text>
            <Button label="Get started" onPress={signOut} />
          </View>
        ) : devices === null ? (
          <View className="items-center py-16">
            <ActivityIndicator color={colors.sub} />
          </View>
        ) : active.length === 0 ? (
          <Animated.View entering={enter(2)} layout={reflow}>
            <View className="items-center rounded-2xl bg-card px-6 py-12">
              <Text className="mb-5 text-center text-[14px] font-sans leading-[20px] text-sub">
                No devices connected yet. Connect a wearable to start syncing
                your health data.
              </Text>
            </View>
          </Animated.View>
        ) : (
          active.map((d) => (
            <DeviceCard
              key={d.id}
              device={d}
              onDisconnect={() => confirmDisconnect(d)}
              onReconnect={() => reconnect(d)}
            />
          ))
        )}

        {session ? (
          <Animated.View
            entering={enter(2)}
            layout={reflow}
            style={{ marginBottom: 48, marginTop: 8 }}
          >
            <Button
              label="Connect a device"
              onPress={() => nav.push({ name: 'connectMenu' })}
            />
          </Animated.View>
        ) : null}
      </ScrollView>
    </View>
  );
}
