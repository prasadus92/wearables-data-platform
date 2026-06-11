import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { AnimatedPressable } from '../components/AnimatedPressable';
import { ProviderLogo } from '../components/ProviderLogo';
import { SheetHandle, SheetTitle, sheetIn } from '../components/Sheet';
import { useApp } from '../lib/appContext';
import { APPLE_SLUG, PROVIDERS, type ProviderInfo } from '../lib/catalog';
import { colors, fonts } from '../theme/tokens';

function Chevron() {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
      <Path
        d="M9.5 6.5L15 12L9.5 17.5"
        stroke={colors.ink}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function ProviderRow({
  provider,
  status,
  onPress,
}: {
  provider: ProviderInfo;
  status: 'none' | 'expired';
  onPress: () => void;
}) {
  return (
    <AnimatedPressable
      onPress={onPress}
      className="mb-2 w-full flex-row items-center gap-1.5 rounded-2xl bg-grey px-5 py-3.5"
    >
      <View className="flex-1 flex-row items-start gap-1.5">
        <ProviderLogo slug={provider.slug} name={provider.name} size={20} />
        <View className="gap-0.5">
          <Text className="text-[16px] font-sans-medium leading-[22px] text-ink">
            {provider.name}
          </Text>
          <Text
            style={{
              fontFamily: fonts.mono,
              color: status === 'expired' ? colors.attention : colors.mute,
            }}
            className="text-[10px] uppercase leading-[12px] tracking-[0.5px]"
          >
            {status === 'expired' ? 'Connection expired' : 'Not connected'}
          </Text>
        </View>
      </View>
      <Chevron />
    </AnimatedPressable>
  );
}

/**
 * Placeholder row while the device list loads, so already-connected
 * providers never flash in the menu. A simple opacity pulse; static under
 * Reduce Motion.
 */
function SkeletonRow() {
  const pulse = useSharedValue(0.45);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 650 }),
      -1,
      true,
      undefined,
      ReduceMotion.System,
    );
  }, [pulse]);

  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      style={[
        {
          marginBottom: 8,
          flexDirection: 'row',
          alignItems: 'center',
          borderRadius: 16,
          backgroundColor: colors.grey,
          paddingHorizontal: 20,
          paddingVertical: 14,
        },
        style,
      ]}
    >
      <View className="h-5 w-5 rounded-full bg-card" />
      <View className="ml-1.5 gap-1.5">
        <View className="h-4 w-24 rounded-full bg-card" />
        <View className="h-2.5 w-32 rounded-full bg-card" />
      </View>
    </Animated.View>
  );
}

function Disclaimer() {
  return (
    <View className="mt-2 w-full flex-row gap-4 py-1">
      <View className="h-[56px] w-[5px] rounded-[20px] bg-grey" />
      <View className="flex-1 gap-1">
        <Text
          style={{ fontFamily: fonts.mono, color: 'rgba(27, 27, 27, 0.5)' }}
          className="text-[12px] uppercase leading-[16px]"
        >
          Disclaimer
        </Text>
        <Text className="text-[14px] font-sans leading-[20px] text-ink">
          Connecting imports your recent history automatically and new
          readings keep flowing in. Disconnect any time.
        </Text>
      </View>
    </View>
  );
}

export function ConnectMenuScreen() {
  const { session, devices, refreshDevices, nav } = useApp();

  // The shared cache usually knows the list already; revalidate quietly so
  // a provider connected elsewhere does not get offered again. When every
  // fetch attempt fails and no cache exists, the menu offers the full
  // provider list rather than pulsing skeletons forever; the connect flow
  // re-checks connected providers before linking, so the worst case is an
  // honest "already connected" result.
  const [fetchSettled, setFetchSettled] = useState(false);
  useEffect(() => {
    let stale = false;
    refreshDevices().then(() => {
      if (!stale) setFetchSettled(true);
    });
    return () => {
      stale = true;
    };
  }, [refreshDevices]);

  // Without a session there is nothing connected; with one, null means the
  // list is still unknown and the skeleton rows hold the menu.
  const list = session ? (devices ?? (fetchSettled ? [] : null)) : [];

  const statusFor = (slug: string): 'connected' | 'expired' | 'none' => {
    const device = list?.find(
      (d) => d.provider === slug && d.status !== 'disconnected',
    );
    if (!device) return 'none';
    return device.status === 'expired' ? 'expired' : 'connected';
  };

  // Already-connected providers are managed from the devices screen instead.
  const available = PROVIDERS.filter((p) => statusFor(p.slug) !== 'connected');

  return (
    <View className="flex-1 bg-scrim">
      {/* The dimmed area above the sheet dismisses it, like the design. */}
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
        <View className="rounded-[29px] border border-mist bg-card p-5">
          <View className="mb-4">
            <SheetTitle>Select a device</SheetTitle>
          </View>
          {list === null ? (
            // The connected set is unknown until the fetch lands;
            // placeholder rows keep the menu from offering providers it
            // should hide.
            <>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </>
          ) : available.length === 0 ? (
            <View className="items-center rounded-2xl bg-grey px-6 py-10">
              <Text className="text-center text-[14px] font-sans text-sub">
                All supported devices are already connected.
              </Text>
            </View>
          ) : (
            available.map((p) => (
              <ProviderRow
                key={p.slug}
                provider={p}
                status={statusFor(p.slug) === 'expired' ? 'expired' : 'none'}
                onPress={() =>
                  nav.push(
                    p.slug === APPLE_SLUG
                      ? { name: 'connectApple' }
                      : { name: 'connectIntro', provider: p },
                  )
                }
              />
            ))
          )}
          <Disclaimer />
        </View>
      </Animated.View>
    </View>
  );
}
