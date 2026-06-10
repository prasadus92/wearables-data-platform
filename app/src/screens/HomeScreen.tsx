import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type LayoutChangeEvent,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
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

import Svg, {
  Circle as SvgCircle,
  Defs,
  LinearGradient as SvgLinearGradient,
  Path as SvgPath,
  RadialGradient as SvgRadialGradient,
  Rect as SvgRect,
  Stop,
} from 'react-native-svg';

import {
  baseline,
  latestStatus,
  METRIC_META,
  metricSupported,
  weekDelta,
  type Device,
  type Timeseries,
} from '@youth/health-core';

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
import {
  formatNameList,
  isOlderThan,
  relativeAge,
  timeAgo,
} from '../lib/format';
import { heartbeat, tapLight } from '../lib/haptics';
import { enter, pressSpring } from '../lib/motion';
import { colors, fonts } from '../theme/tokens';

/**
 * Full-bleed warm dark backdrop, approximating the Figma home's blurred
 * ember imagery with a vertical fade plus a soft glow near the top.
 */
function HomeBackdrop() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <SvgLinearGradient id="homeBase" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.emberDeep} />
            <Stop offset="0.4" stopColor={colors.emberMid} />
            <Stop offset="1" stopColor={colors.night} />
          </SvgLinearGradient>
          <SvgRadialGradient id="homeGlow" cx="0.5" cy="0.16" r="0.62">
            <Stop offset="0" stopColor={colors.emberGlow} stopOpacity="0.5" />
            <Stop offset="0.6" stopColor={colors.emberGlow} stopOpacity="0.18" />
            <Stop offset="1" stopColor={colors.emberGlow} stopOpacity="0" />
          </SvgRadialGradient>
        </Defs>
        <SvgRect x="0" y="0" width="100%" height="100%" fill="url(#homeBase)" />
        <SvgRect x="0" y="0" width="100%" height="100%" fill="url(#homeGlow)" />
      </Svg>
    </View>
  );
}

/** Deep teal surface behind the biomarkers chart card, per the data screens. */
function TealCardBackdrop() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <SvgLinearGradient id="tealCard" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.tealTop} />
            <Stop offset="1" stopColor={colors.tealBottom} />
          </SvgLinearGradient>
        </Defs>
        <SvgRect x="0" y="0" width="100%" height="100%" fill="url(#tealCard)" />
      </Svg>
    </View>
  );
}

function InfoIcon() {
  const stroke = 'rgba(255, 255, 255, 0.6)';
  return (
    <Svg width={18} height={18} viewBox="0 0 18 18" fill="none">
      <SvgCircle cx={9} cy={9} r={7.25} stroke={stroke} strokeWidth={1.5} />
      <SvgPath
        d="M9 8.4V12.4"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      <SvgCircle cx={9} cy={5.7} r={0.95} fill={stroke} />
    </Svg>
  );
}

function CloseIcon() {
  const stroke = 'rgba(255, 255, 255, 0.7)';
  return (
    <Svg width={14} height={14} viewBox="0 0 14 14" fill="none">
      <SvgPath
        d="M2 2L12 12M12 2L2 12"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
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
          active
            ? flat
              ? ''
              : 'bg-card'
            : 'border border-[rgba(255,255,255,0.16)] bg-[rgba(255,255,255,0.08)]'
        }`}
      >
        <Text
          style={{ fontFamily: fonts.mono }}
          className={`text-[11px] uppercase tracking-[0.5px] ${
            active ? 'text-ink' : 'text-[rgba(255,255,255,0.72)]'
          }`}
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
              backgroundColor: colors.card,
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

/**
 * Figma connect card: translucent dark surface with a hairline border,
 * warm icon tile, and a full-width translucent mono button.
 */
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
    <View className="mb-4 rounded-[18px] border-[0.5px] border-[rgba(255,255,255,0.45)] bg-[rgba(27,27,27,0.3)] p-4">
      <View className="flex-row items-start">
        <View className="h-12 w-12 rounded-[20px] bg-[#F37953]" />
        <View className="ml-3 flex-1">
          <Text className="text-[18px] font-sans-medium tracking-[-0.3px] text-white">
            Connect your devices
          </Text>
          <Text className="mt-0.5 text-[14px] font-sans leading-[20px] text-[rgba(255,255,255,0.5)]">
            Unlock more insights by connecting your wearable devices
          </Text>
        </View>
        <Pressable
          accessibilityLabel="Dismiss"
          onPress={onDismiss}
          hitSlop={8}
          className="ml-2 h-8 w-8 items-center justify-center rounded-full active:opacity-60"
        >
          <CloseIcon />
        </Pressable>
      </View>
      <Pressable
        onPress={onConnect}
        className="mt-4 w-full items-center justify-center rounded-[9px] bg-[rgba(255,255,255,0.13)] py-3.5 active:opacity-80"
      >
        <Text
          style={{ fontFamily: fonts.mono }}
          className="text-[12px] uppercase tracking-[0.5px] text-white"
        >
          {hasSession ? 'Connect a device' : 'Get started'}
        </Text>
      </Pressable>
    </View>
  );
}

type Probe =
  | { state: 'idle' | 'pending' | 'empty' }
  | { state: 'found'; latestTs: string };

export function HomeScreen() {
  const {
    mode,
    session,
    connectCardDismissed,
    dismissConnectCard,
    signOut,
    nav,
  } = useApp();
  const displayName = useDisplayName(session);
  const [metric, setMetric] = useState(METRICS[0]);
  const [range, setRange] = useState(RANGES[1]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [series, setSeries] = useState<Timeseries | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoVisible, setInfoVisible] = useState(false);
  // Out-of-range probe: when the in-range query is empty but the user has
  // devices, one wide query (90d, day buckets) checks whether data exists
  // outside the window so the empty state can say so instead of going blank.
  const [probe, setProbe] = useState<Probe>({ state: 'idle' });

  const meta = METRIC_META[metric.key];
  const demoMode = mode === 'sandbox';

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
    const fetchOnce = () => {
      const end = new Date();
      const start = new Date(end.getTime() - range.hours * 3600 * 1000);
      return api.getTimeseries(session.userId, metric.key, {
        start,
        end,
        resolution: range.resolution,
      });
    };
    try {
      let next: Timeseries;
      try {
        next = await fetchOnce();
      } catch {
        // One quiet retry so a single transient failure never surfaces as
        // an error screen. An empty 200 lands in the empty states below.
        await new Promise((resolve) => setTimeout(resolve, 600));
        next = await fetchOnce();
      }
      setError(null);
      setSeries(next);
      return next;
    } catch {
      // Both attempts failed: a real request failure.
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
    setProbe({ state: 'idle' });
    const prevLatest = series?.points.at(-1)?.ts ?? null;
    const firstDataPending = !heartbeatPlayed.current.has(metric.key);
    try {
      if (session) {
        // Pull-to-refresh asks the backend to pull fresh provider data.
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

  const providerSlugs = active.map((d) => d.provider);
  const supported = metricSupported(metric.key, providerSlugs, {
    demo: demoMode,
  });
  const slugsKey = providerSlugs.slice().sort().join(',');

  const inRangeEmpty =
    !loading && !error && !!session && series != null
      ? series.points.length === 0
      : false;

  // The selected window may simply be too narrow; probe wide before
  // explaining the emptiness, so the copy never misleads.
  useEffect(() => {
    setProbe({ state: 'idle' });
  }, [metric.key, range.key, session?.userId, slugsKey]);

  useEffect(() => {
    if (!inRangeEmpty || !session || active.length === 0) return;
    if (probe.state !== 'idle') return;
    if (!supported) {
      // Nothing connected can produce this metric; skip the wide probe so
      // the capability empty state renders without a wasted round trip.
      setProbe({ state: 'empty' });
      return;
    }
    let cancelled = false;
    setProbe({ state: 'pending' });
    const end = new Date();
    const start = new Date(end.getTime() - 90 * 24 * 3600 * 1000);
    api
      .getTimeseries(session.userId, metric.key, {
        start,
        end,
        resolution: 'day',
      })
      .then((wide) => {
        if (cancelled) return;
        const last = wide.points.at(-1);
        setProbe(
          last ? { state: 'found', latestTs: last.ts } : { state: 'empty' },
        );
      })
      .catch(() => {
        // On probe failure fall back to the connected-but-waiting copy.
        if (!cancelled) setProbe({ state: 'empty' });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inRangeEmpty, active.length, probe.state, supported, session, metric.key]);

  // Hold the spinner while the probe decides which empty state applies, so
  // the explanation never flickers between copies.
  const probePending =
    inRangeEmpty &&
    active.length > 0 &&
    supported &&
    (probe.state === 'idle' || probe.state === 'pending');

  const friendly = meta.friendlyName.toLowerCase();
  const empty = useMemo(() => {
    if (active.length === 0) {
      return {
        title: `Your ${friendly} will live here`,
        message:
          'Connect a wearable once and your readings flow in automatically, day and night.',
        action: {
          label: 'Connect a device',
          onPress: () => nav.push({ name: 'connectMenu' }),
        },
      };
    }
    if (!supported) {
      if (demoMode) {
        return {
          title: `Demo wearables do not include ${friendly}`,
          message:
            'Demo data covers heart rate, heart rate variability, and blood oxygen. Real devices deliver the rest.',
          action: {
            label: 'See heart rate',
            onPress: () => setMetric(METRICS[0]),
          },
        };
      }
      return {
        title: `None of your devices measures ${friendly} yet`,
        message:
          metric.key === 'blood_pressure'
            ? 'Blood pressure usually comes from a smart cuff, or from readings logged in Apple Health on your phone.'
            : 'Connect a device that measures it and readings flow in automatically.',
        action: {
          label: 'Connect a device',
          onPress: () => nav.push({ name: 'connectMenu' }),
        },
      };
    }
    if (probe.state === 'found') {
      // Data exists outside the selected window: say so and offer the
      // narrowest range that contains the latest reading.
      const latestAge = Date.now() - new Date(probe.latestTs).getTime();
      const target = latestAge > 30 * 24 * 3600 * 1000 ? RANGES[3] : RANGES[2];
      return {
        title: `No readings in the last ${range.label}`,
        message: `Your latest data is from ${relativeAge(probe.latestTs)}.`,
        action: {
          label: `Show last ${target.label}`,
          onPress: () => setRange(target),
        },
      };
    }
    const names =
      formatNameList(active.map((d) => providerName(d.provider))) ||
      'Your device';
    return {
      title: `No ${friendly} here yet`,
      message: demoMode
        ? `${names} connected. The first readings are being generated and usually land within a couple of minutes; the chart fills in by itself.`
        : `${names} connected. We are waiting for the wearable to sync with its phone app; readings appear here automatically the moment it does.`,
      action: { label: 'Sync now', onPress: onRefresh },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    slugsKey,
    active.length,
    supported,
    demoMode,
    friendly,
    metric.key,
    probe,
    range.label,
    nav,
    onRefresh,
  ]);

  const lastTs = series?.points.at(-1)?.ts ?? null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.night }}>
      <HomeBackdrop />
      <Animated.ScrollView
        style={{ flex: 1 }}
        onScroll={onScroll}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#FFFFFF"
          />
        }
      >
        <View className="px-5 pb-28 pt-16">
          <Animated.View entering={enter(0)}>
            <View className="mb-5 flex-row items-center justify-between">
              <Animated.View style={headerStyle}>
                <Text
                  style={{ fontFamily: fonts.mono }}
                  className="text-[10px] uppercase tracking-[1px] text-white"
                >
                  {session ? 'Hello' : 'Welcome back,'}
                </Text>
                <Text className="mt-2 text-[18px] font-sans-medium tracking-[-0.3px] text-white">
                  {displayName}
                </Text>
              </Animated.View>
              <Pressable
                accessibilityLabel="Profile and devices"
                onPress={() => nav.push({ name: 'devices' })}
                className="h-10 w-10 items-center justify-center rounded-full border-[0.4px] border-white bg-[rgba(254,213,180,0.33)] active:opacity-80"
              >
                <Text className="text-[15px] font-sans-medium text-[#FFE2CE]">
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
              <Text className="text-[20px] font-sans-medium tracking-[-0.5px] text-white">
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
            <View className="overflow-hidden rounded-[24px]">
              <TealCardBackdrop />
              <View className="p-4">
                <View className="flex-row items-baseline justify-between">
                  <Text className="text-[16px] font-sans-medium text-white">
                    {metric.label}
                  </Text>
                  {metric.dual ? (
                    <View className="flex-row items-center">
                      <View className="mr-1.5 h-2 w-2 rounded-full bg-good" />
                      <Text className="mr-4 text-[12px] font-sans text-[rgba(255,255,255,0.65)]">
                        Systolic
                      </Text>
                      <View className="mr-1.5 h-2 w-2 rounded-full bg-[#F54EF0]" />
                      <Text className="text-[12px] font-sans text-[rgba(255,255,255,0.65)]">
                        Diastolic
                      </Text>
                    </View>
                  ) : lastTs ? (
                    <Text
                      style={{ fontFamily: fonts.mono }}
                      className="text-[10px] uppercase tracking-[1px] text-[rgba(255,255,255,0.55)]"
                    >
                      Updated {timeAgo(lastTs)}
                    </Text>
                  ) : null}
                </View>

                {error ? (
                  <View className="h-[220px] items-center justify-center px-6">
                    <Text className="text-center text-[13px] font-sans text-[rgba(255,255,255,0.65)]">
                      {error}
                    </Text>
                  </View>
                ) : !session ? (
                  <View className="h-[220px] items-center justify-center px-6">
                    <Text className="text-center text-[13px] font-sans leading-[19px] text-[rgba(255,255,255,0.65)]">
                      Create your profile and connect a wearable to see your
                      data here.
                    </Text>
                  </View>
                ) : (
                  <LineChart
                    points={series?.points ?? []}
                    unit={series?.unit ?? ''}
                    dual={metric.dual}
                    rangeHours={range.hours}
                    loading={loading || probePending}
                    dark
                    emptyTitle={empty.title}
                    emptyMessage={empty.message}
                    emptyAction={empty.action}
                    status={insights?.status}
                    weekDeltaPct={insights?.delta}
                    baselineBand={insights?.base}
                    clinicalBand={meta.clinicalBand ?? null}
                  />
                )}
              </View>
            </View>
          </Animated.View>

          <Animated.View entering={enter(4)}>
            <View className="mt-8 px-1">
              <Text
                style={{ fontFamily: fonts.mono }}
                className="text-[10px] uppercase tracking-[1px] text-[rgba(255,255,255,0.5)]"
              >
                Disclaimer
              </Text>
              <Text className="mt-2 text-[12px] font-sans leading-[17px] text-[rgba(255,255,255,0.5)]">
                These readings provide an overview, and they do not capture
                everything. Regular check-ups with health professionals are
                recommended.
              </Text>
              <Text className="mt-6 text-[20px] font-sans-medium text-white">
                YOU(th)
              </Text>
            </View>
          </Animated.View>
        </View>
      </Animated.ScrollView>

      <MetricInfoSheet
        meta={meta}
        visible={infoVisible}
        onClose={() => setInfoVisible(false)}
      />
    </View>
  );
}
