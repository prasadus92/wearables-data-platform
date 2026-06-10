import Constants from 'expo-constants';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
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

import { api } from '../api/client';
import { Button } from '../components/Button';
import { Header } from '../components/Header';
import { deviceLogoUrl, ProviderLogo } from '../components/ProviderLogo';
import {
  SheetBody,
  SheetCaption,
  SheetModal,
  SheetTitle,
} from '../components/Sheet';
import { useApp } from '../lib/appContext';
import { PROVIDERS, providerName } from '../lib/catalog';
import { useDisplayName } from '../lib/displayName';
import { timeAgo } from '../lib/format';
import { tapLight } from '../lib/haptics';
import { enter } from '../lib/motion';
import { colors, fonts } from '../theme/tokens';

/** Springy reflow when device cards connect, disconnect or reorder. */
const reflow = LinearTransition.springify(300).reduceMotion(
  ReduceMotion.System,
);

/** Mono uppercase section caption: PROFILE INFO, DEVICES (4), SUPPORT. */
function SectionCaption({ label }: { label: string }) {
  return (
    <Text
      style={{ fontFamily: fonts.mono }}
      className="mb-2 text-[12px] uppercase tracking-[0.5px] text-sub"
    >
      {label}
    </Text>
  );
}

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
      className="flex-row rounded-full bg-grey p-1"
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

/** Small mono pill action on a device card: DISCONNECT or RECONNECT. */
function PillAction({
  label,
  dark,
  onPress,
}: {
  label: string;
  dark?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        tapLight();
        onPress();
      }}
      className={`items-center justify-center rounded-full px-4 py-2 active:opacity-70 ${
        dark ? 'bg-ink' : 'border border-ink bg-transparent'
      }`}
    >
      <Text
        style={{ fontFamily: fonts.mono }}
        className={`text-[11px] uppercase tracking-[0.5px] ${dark ? 'text-card' : 'text-ink'}`}
      >
        {label}
      </Text>
    </Pressable>
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
        marginBottom: 8,
        borderRadius: 16,
        backgroundColor: colors.card,
        paddingHorizontal: 16,
        paddingVertical: 14,
        flexDirection: 'row',
        alignItems: 'center',
      }}
    >
      <View className="mr-3">
        <ProviderLogo
          slug={device.provider}
          name={providerName(device.provider)}
          logoUrl={deviceLogoUrl(device.device_meta)}
          size={36}
        />
      </View>
      <View className="flex-1 gap-0.5 pr-3">
        <Text className="text-[16px] font-sans-medium leading-[22px] text-ink">
          {providerName(device.provider)}
        </Text>
        <Text
          style={{
            fontFamily: fonts.mono,
            color: expired ? colors.attention : colors.good,
          }}
          className="text-[10px] uppercase leading-[12px] tracking-[0.5px]"
        >
          {expired ? 'Connection expired' : 'Connected'}
        </Text>
        <Text className="text-[11px] font-sans text-faint">
          Last synced {timeAgo(device.last_data_at)}
        </Text>
      </View>
      <View className="flex-row gap-2">
        {expired ? <PillAction label="Reconnect" dark onPress={onReconnect} /> : null}
        <PillAction label="Disconnect" onPress={onDisconnect} />
      </View>
    </Animated.View>
  );
}

/** Lifecycle of the styled disconnect bottom sheet. */
type DisconnectPhase = 'confirm' | 'busy' | 'done' | 'error';
interface DisconnectState {
  device: Device;
  phase: DisconnectPhase;
}

export function DevicesScreen() {
  const { mode, switchMode, session, signOut, clerkSignOut, devices, refreshDevices, nav } =
    useApp();
  // Clerk-bootstrapped sessions end via a real sign-out that clears every
  // mode; anonymous ones just swap the per-mode identity.
  const clerkAuthed = session?.auth === 'clerk';
  const displayName = useDisplayName(session);
  const [refreshing, setRefreshing] = useState(false);
  const [disconnect, setDisconnect] = useState<DisconnectState | null>(null);

  // Revalidate on focus (this screen mounts per navigation). The shared
  // cache renders the last known list instantly while the refresh runs, and
  // a failed refresh keeps it rather than pretending the list is empty.
  useEffect(() => {
    refreshDevices();
  }, [refreshDevices]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshDevices();
    setRefreshing(false);
  }, [refreshDevices]);

  async function runDisconnect(device: Device) {
    if (!session) return;
    setDisconnect({ device, phase: 'busy' });
    try {
      await api.disconnectDevice(session.userId, device.provider);
      setDisconnect({ device, phase: 'done' });
    } catch {
      setDisconnect({ device, phase: 'error' });
    }
    await refreshDevices();
  }

  function reconnect(device: Device) {
    const provider = PROVIDERS.find((p) => p.slug === device.provider);
    if (provider) nav.push({ name: 'connectIntro', provider });
  }

  const active = (devices ?? []).filter((d) => d.status !== 'disconnected');
  const version = Constants.expoConfig?.version ?? '1.0.0';

  return (
    <View className="flex-1 bg-paper pt-14">
      <Header title="" onBack={nav.pop} />
      <ScrollView
        className="flex-1 px-4 pt-2"
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
            <SectionCaption label="Profile info" />
            <View className="mb-5 rounded-2xl bg-card px-4">
              <View className="flex-row items-center justify-between py-3.5">
                <View className="flex-1 pr-3">
                  <Text className="text-[15px] font-sans text-ink">
                    {displayName}
                  </Text>
                  <Text
                    style={{ fontFamily: fonts.mono }}
                    className="mt-0.5 text-[10px] uppercase tracking-[0.5px] text-faint"
                  >
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
              <View className="h-px bg-line" />
              <View className="flex-row items-center justify-between py-3.5">
                <View className="flex-1 pr-3">
                  <Text className="text-[15px] font-sans text-ink">
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
                <Text className="pb-3 text-[11px] font-sans text-faint">
                  Sign in to connect real devices
                </Text>
              ) : null}
            </View>
          </Animated.View>
        ) : null}

        <Animated.View entering={enter(1)}>
          <SectionCaption
            label={`Devices${devices === null ? '' : ` (${active.length})`}`}
          />
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
              <Text className="text-center text-[14px] font-sans leading-[20px] text-sub">
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
              onDisconnect={() => setDisconnect({ device: d, phase: 'confirm' })}
              onReconnect={() => reconnect(d)}
            />
          ))
        )}

        {session ? (
          <Animated.View
            entering={enter(2)}
            layout={reflow}
            style={{ marginTop: 8 }}
          >
            <Button
              label="Connect a device"
              onPress={() => nav.push({ name: 'connectMenu' })}
            />
            <Text
              style={{ fontFamily: fonts.mono }}
              className="mb-3 mt-8 text-center text-[11px] uppercase tracking-[0.5px] text-faint"
            >
              Version {version}
            </Text>
            <View style={{ marginBottom: 48 }}>
              <Button
                label="Logout"
                variant="outline"
                onPress={clerkAuthed ? clerkSignOut : signOut}
              />
            </View>
          </Animated.View>
        ) : null}
      </ScrollView>

      {/* Styled disconnect flow: confirm, then a result sheet per outcome. */}
      <SheetModal
        visible={disconnect !== null}
        onDismiss={
          disconnect?.phase === 'busy'
            ? undefined
            : () => setDisconnect(null)
        }
      >
        {disconnect?.phase === 'confirm' || disconnect?.phase === 'busy' ? (
          <View className="gap-6">
            <View className="gap-4">
              <View className="gap-2">
                <SheetCaption label="Attention" color={colors.attention} />
                <SheetTitle>
                  Are you sure you want to disconnect this device?
                </SheetTitle>
              </View>
              <SheetBody>
                Disconnecting will stop syncing new data from this device.
                Your past data will stay saved, but no new updates will appear
                until you reconnect.
              </SheetBody>
            </View>
            <View className="flex-row gap-2">
              <View className="flex-1">
                <Button
                  label="Cancel"
                  variant="outline"
                  onPress={() => setDisconnect(null)}
                  disabled={disconnect.phase === 'busy'}
                />
              </View>
              <View className="flex-1">
                <Button
                  label="Disconnect"
                  onPress={() => runDisconnect(disconnect.device)}
                  busy={disconnect.phase === 'busy'}
                />
              </View>
            </View>
          </View>
        ) : disconnect?.phase === 'done' ? (
          <View className="gap-6">
            <View className="gap-4">
              <SheetTitle>Your device is disconnected</SheetTitle>
              <SheetBody>
                You've disconnected {providerName(disconnect.device.provider)}.
                You can reconnect it anytime to keep your health data up to
                date.
              </SheetBody>
            </View>
            <Button
              label="OK"
              variant="outline"
              onPress={() => setDisconnect(null)}
            />
          </View>
        ) : disconnect?.phase === 'error' ? (
          <View className="gap-6">
            <View className="gap-4">
              <View className="gap-2">
                <SheetCaption label="Error" color={colors.danger} />
                <SheetTitle>Something went wrong</SheetTitle>
              </View>
              <SheetBody>
                We couldn't disconnect your device right now. Please try again
                in a few minutes.
              </SheetBody>
            </View>
            <View className="flex-row gap-2">
              <View className="flex-1">
                <Button
                  label="Cancel"
                  variant="outline"
                  onPress={() => setDisconnect(null)}
                />
              </View>
              <View className="flex-1">
                <Button
                  label="Retry"
                  onPress={() => runDisconnect(disconnect.device)}
                />
              </View>
            </View>
          </View>
        ) : null}
      </SheetModal>
    </View>
  );
}
