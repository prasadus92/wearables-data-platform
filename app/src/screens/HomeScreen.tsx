import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type LayoutChangeEvent,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import Svg, { Circle as SvgCircle, Path as SvgPath } from 'react-native-svg';

import {
  baseline,
  latestStatus,
  METRIC_META,
  weekDelta,
  type Device,
  type Timeseries,
} from '@examplehealth/health-core';

import { api } from '../api/client';
import { Banner } from '../components/Banner';
import { LineChart } from '../components/LineChart';
import { MetricInfoSheet } from '../components/MetricInfoSheet';
import { useApp } from '../lib/appContext';
import { useDisplayName } from '../lib/displayName';
import {
  METRICS,
  type MetricInfo,
  RANGES,
  type RangeInfo,
  providerName,
} from '../lib/catalog';
import { isOlderThan } from '../lib/format';
import { heartbeat, tapLight } from '../lib/haptics';
import { enter, pressSpring } from '../lib/motion';
import { colors, fonts } from '../theme/tokens';

function InfoIcon() {
  return (
    <Svg width={18} height={18} viewBox="0 0 18 18" fill="none">
      <SvgCircle cx={9} cy={9} r={7.25} stroke={colors.faint} strokeWidth={1.5} />
      <SvgPath
        d="M9 8.4V12.4"
        stroke={colors.faint}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      <SvgCircle cx={9} cy={5.7} r={0.95} fill={colors.faint} />
    </Svg>
  );
}

function Chip({
  label,
  active,
  flat,
  onPress,
  onLayout,
}: {
  label: string;
  active: boolean;
  /** Flat chips rely on a shared sliding indicator for their active pill. */
  flat?: boolean;
  onPress: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
}) {
  const scale = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View onLayout={onLayout} style={[{ marginRight: 8 }, pressStyle]}>
      <Pressable
        onPress={() => {
          if (!active) tapLight();
          onPress();
        }}
        onPressIn={() => {
          scale.value = withSpring(0.95, pressSpring);
        }}
        onPressOut={() => {
          scale.value = withSpring(1, pressSpring);
        }}
        className={`rounded-full px-4 py-2 ${
          active ? (flat ? '' : 'bg-ink') : 'bg-card border border-line'
        }`}
      >
        <Text
          className={`text-[13px] font-sans-medium ${active ? 'text-card' : 'text-sub'}`}
        >
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

/** Metric tabs with an active pill that springs between selections. */
function MetricTabs({
  active,
  onSelect,
}: {
  active: MetricInfo;
  onSelect: (metric: MetricInfo) => void;
}) {
  const reduced = useReducedMotion();
  const layouts = useRef(new Map<string, { x: number; width: number }>());
  const pillX = useSharedValue(0);
  const pillWidth = useSharedValue(0);
  const pillOpacity = useSharedValue(0);

  const placePill = useCallback(
    (key: string, animate: boolean) => {
      const layout = layouts.current.get(key);
      if (!layout) return;
      if (animate && !reduced && pillOpacity.value === 1) {
        pillX.value = withSpring(layout.x, pressSpring);
        pillWidth.value = withSpring(layout.width, pressSpring);
      } else {
        pillX.value = layout.x;
        pillWidth.value = layout.width;
        pillOpacity.value = 1;
      }
    },
    [reduced, pillX, pillWidth, pillOpacity],
  );

  useEffect(() => {
    placePill(active.key, true);
  }, [active.key, placePill]);

  const pillStyle = useAnimatedStyle(() => ({
    opacity: pillOpacity.value,
    width: pillWidth.value,
    transform: [{ translateX: pillX.value }],
  }));

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className="mb-3 -mx-5 px-5"
    >
      <View className="flex-row">
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: 0,
              bottom: 0,
              borderRadius: 999,
              backgroundColor: colors.ink,
            },
            pillStyle,
          ]}
        />
        {METRICS.map((m) => (
          <Chip
            key={m.key}
            label={m.label}
            active={m.key === active.key}
            flat
            onLayout={(event) => {
              const { x, width } = event.nativeEvent.layout;
              layouts.current.set(m.key, { x, width });
              if (m.key === active.key) placePill(m.key, false);
            }}
            onPress={() => onSelect(m)}
          />
        ))}
      </View>
    </ScrollView>
  );
}

function RangeTabs({
  active,
  onSelect,
}: {
  active: RangeInfo;
  onSelect: (range: RangeInfo) => void;
}) {
  return (
    <View className="mb-4 flex-row">
      {RANGES.map((r) => (
        <Chip
          key={r.key}
          label={r.label}
          active={r.key === active.key}
          onPress={() => onSelect(r)}
        />
      ))}
    </View>
  );
}

function ConnectCard({
  hasSession,
  onConnect,
  onDismiss,
}: {
  hasSession: boolean;
  onConnect: () => void;
  onDismiss: () => void;
}) {
  return (
    <View className="mb-4 rounded-2xl bg-ink p-5">
      <Pressable
        accessibilityLabel="Dismiss"
        onPress={onDismiss}
        className="absolute right-3 top-3 h-8 w-8 items-center justify-center rounded-full active:opacity-60"
      >
        <Text className="text-[16px] text-[#8E8C88]">✕</Text>
      </Pressable>
      <Text className="pr-8 text-[17px] font-sans-medium text-card">
        Connect your devices
      </Text>
      <Text className="mt-1.5 text-[13px] font-sans leading-[19px] text-[#B9B7B2]">
        Unlock more insights by connecting your wearable devices.
      </Text>
      <Pressable
        onPress={onConnect}
        className="mt-4 self-start rounded-xl bg-card px-5 py-2.5 active:opacity-80"
      >
        <Text
          style={{ fontFamily: fonts.mono }}
          className="text-[12px] uppercase tracking-[0.5px] text-ink"
        >
          {hasSession ? 'Connect a device' : 'Get started'}
        </Text>
      </Pressable>
    </View>
  );
}

export function HomeScreen() {
  const { session, connectCardDismissed, dismissConnectCard, signOut, nav } =
    useApp();
  const displayName = useDisplayName(session);
  const [metric, setMetric] = useState(METRICS[0]);
  const [range, setRange] = useState(RANGES[1]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [series, setSeries] = useState<Timeseries | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoVisible, setInfoVisible] = useState(false);

  const meta = METRIC_META[metric.key];

  // Plain-language insights derived from the full series for this range.
  const insights = useMemo(() => {
    const pts = series?.points ?? [];
    if (pts.length === 0) return null;
    const base = baseline(pts);
    return {
      base,
      status: latestStatus(pts, base, meta.goodDirection),
      delta: weekDelta(pts, new Date()),
    };
  }, [series, meta]);

  const reduced = useReducedMotion();
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });
  // Light condense effect: the title drifts up and shrinks slightly as the
  // list scrolls. Clamped so pull-to-refresh (negative offsets) is untouched.
  const headerStyle = useAnimatedStyle(() => {
    if (reduced) return {};
    return {
      transform: [
        {
          translateY: interpolate(
            scrollY.value,
            [0, 120],
            [0, -8],
            Extrapolation.CLAMP,
          ),
        },
        {
          scale: interpolate(
            scrollY.value,
            [0, 120],
            [1, 0.97],
            Extrapolation.CLAMP,
          ),
        },
      ],
    };
  });

  const loadDevices = useCallback(async () => {
    if (!session) return;
    try {
      setDevices(await api.getDevices(session.userId));
    } catch {
      // banner state is best effort, keep last known devices
    }
  }, [session]);

  const loadSeries = useCallback(async (): Promise<Timeseries | null> => {
    if (!session) {
      setSeries(null);
      return null;
    }
    setLoading(true);
    setError(null);
    try {
      const end = new Date();
      const start = new Date(end.getTime() - range.hours * 3600 * 1000);
      const next = await api.getTimeseries(session.userId, metric.key, {
        start,
        end,
        resolution: range.resolution,
      });
      setSeries(next);
      return next;
    } catch {
      setError('Could not load data. Pull to refresh to retry.');
      setSeries(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, [session, metric, range]);

  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  useEffect(() => {
    loadSeries();
  }, [loadSeries]);

  // Metrics that already played their first-data heartbeat this session.
  const heartbeatPlayed = useRef(new Set<string>());
  useEffect(() => {
    if (loading || (series?.points.length ?? 0) === 0) return;
    if (heartbeatPlayed.current.has(metric.key)) return;
    heartbeatPlayed.current.add(metric.key);
    // The chart is drawing its first points for this metric: lub-dub.
    heartbeat();
  }, [series, loading, metric.key]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    const prevLatest = series?.points.at(-1)?.ts ?? null;
    const firstDataPending = !heartbeatPlayed.current.has(metric.key);
    try {
      if (session) {
        // Pull-to-refresh asks the backend to pull fresh data from Aggregator.
        await api.syncUser(session.userId).catch(() => undefined);
      }
      const [, next] = await Promise.all([loadDevices(), loadSeries()]);
      const nextLatest = next?.points.at(-1)?.ts ?? null;
      const gotNewData =
        nextLatest !== null && (prevLatest === null || nextLatest > prevLatest);
      // First data is the heartbeat's moment; otherwise a light tap confirms
      // that the pull actually brought something new in.
      if (gotNewData && !firstDataPending) tapLight();
    } finally {
      setRefreshing(false);
    }
  }, [session, series, metric.key, loadDevices, loadSeries]);

  const active = devices.filter((d) => d.status !== 'disconnected');
  const expired = active.filter((d) => d.status === 'expired');
  // A device that never delivered data only counts as stale once it has
  // been connected for over a day; brand new connections get grace time.
  const stale = active.filter(
    (d) =>
      d.status === 'connected' &&
      isOlderThan(d.last_data_at ?? d.connected_at, 24),
  );
  const showConnectCard =
    !connectCardDismissed && (!session || active.length === 0);

  return (
    <Animated.ScrollView
      style={{ flex: 1, backgroundColor: colors.paper }}
      onScroll={onScroll}
      scrollEventThrottle={16}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.coral}
        />
      }
    >
      <View className="px-5 pb-28 pt-16">
        <Animated.View entering={enter(0)}>
          <View className="mb-5 flex-row items-center justify-between">
            <Animated.View style={headerStyle}>
              <Text
                style={{ fontFamily: fonts.mono }}
                className="text-[11px] uppercase tracking-[2px] text-faint"
              >
                Welcome back,
              </Text>
              <Text className="text-[24px] font-sans-medium text-ink">
                {displayName}
              </Text>
            </Animated.View>
            <Pressable
              accessibilityLabel="Profile and devices"
              onPress={() => nav.push({ name: 'devices' })}
              className="h-11 w-11 items-center justify-center rounded-full bg-ink active:opacity-80"
            >
              <Text className="text-[15px] font-sans-medium text-card">
                {displayName[0].toUpperCase()}
              </Text>
            </Pressable>
          </View>
        </Animated.View>

        {expired.length > 0 ? (
          <Animated.View entering={enter(1)}>
            <Banner
              kind="error"
              title="Connection expired"
              message={`${expired.map((d) => providerName(d.provider)).join(', ')} needs to be reconnected to keep syncing.`}
              actionLabel="Reconnect"
              onAction={() => nav.push({ name: 'devices' })}
            />
          </Animated.View>
        ) : null}

        {stale.length > 0 ? (
          <Animated.View entering={enter(1)}>
            <Banner
              kind="warning"
              title="Sync issues"
              message="We have not received data recently. Pull down to refresh or check the device's own app."
            />
          </Animated.View>
        ) : null}

        {showConnectCard ? (
          <Animated.View entering={enter(1)}>
            <ConnectCard
              hasSession={!!session}
              onConnect={() =>
                session ? nav.push({ name: 'connectMenu' }) : signOut()
              }
              onDismiss={dismissConnectCard}
            />
          </Animated.View>
        ) : null}

        <Animated.View entering={enter(2)}>
          <View className="mb-3 mt-2 flex-row items-center justify-between">
            <Text className="text-[18px] font-sans-medium text-ink">
              Biomarkers
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`What is ${meta.friendlyName}?`}
              onPress={() => setInfoVisible(true)}
              hitSlop={8}
              className="h-8 w-8 items-center justify-center rounded-full active:opacity-60"
            >
              <InfoIcon />
            </Pressable>
          </View>

          <MetricTabs active={metric} onSelect={setMetric} />
          <RangeTabs active={range} onSelect={setRange} />
        </Animated.View>

        <Animated.View entering={enter(3)}>
          <View className="rounded-2xl bg-card p-4">
            <View className="flex-row items-baseline justify-between">
              <Text className="text-[15px] font-sans-medium text-ink">
                {metric.label}
              </Text>
              {metric.dual ? (
                <View className="flex-row items-center">
                  <View className="mr-1.5 h-2 w-2 rounded-full bg-coral" />
                  <Text className="mr-4 text-[12px] font-sans text-sub">
                    Systolic
                  </Text>
                  <View className="mr-1.5 h-2 w-2 rounded-full bg-blue" />
                  <Text className="text-[12px] font-sans text-sub">
                    Diastolic
                  </Text>
                </View>
              ) : null}
            </View>

            {error ? (
              <View className="h-[220px] items-center justify-center px-6">
                <Text className="text-center text-[13px] font-sans text-sub">
                  {error}
                </Text>
              </View>
            ) : !session ? (
              <View className="h-[220px] items-center justify-center px-6">
                <Text className="text-center text-[13px] font-sans leading-[19px] text-sub">
                  Create your profile and connect a wearable to see your data
                  here.
                </Text>
              </View>
            ) : (
              <LineChart
                points={series?.points ?? []}
                unit={series?.unit ?? ''}
                dual={metric.dual}
                rangeHours={range.hours}
                loading={loading}
                emptyMessage={
                  active.length === 0
                    ? `Your ${metric.label.toLowerCase()} will live here. Connect a wearable once and readings flow in automatically.`
                    : 'Your device is connected. New readings usually arrive within a couple of minutes, or pull them in now.'
                }
                emptyAction={
                  active.length === 0
                    ? { label: 'Connect a device', onPress: () => nav.push({ name: 'connectMenu' }) }
                    : { label: 'Sync now', onPress: onRefresh }
                }
                status={insights?.status}
                weekDeltaPct={insights?.delta}
                baselineBand={insights?.base}
                clinicalBand={meta.clinicalBand ?? null}
              />
            )}
          </View>
        </Animated.View>
      </View>

      <MetricInfoSheet
        meta={meta}
        visible={infoVisible}
        onClose={() => setInfoVisible(false)}
      />
    </Animated.ScrollView>
  );
}
