import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  type LayoutChangeEvent,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  ReduceMotion,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
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
  type Device,
  latestStatus,
  METRIC_META,
  metricSupported,
  weekDelta,
  type Timeseries,
} from '@youth/health-core';

import { api } from '../api/client';
import { Banner } from '../components/Banner';
import { CHART_CONTENT_MIN_HEIGHT, LineChart } from '../components/LineChart';
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
import { storage } from '../lib/storage';
import {
  formatNameList,
  isOlderThan,
  relativeAge,
  timeAgo,
} from '../lib/format';
import { heartbeat, tapLight } from '../lib/haptics';
import { enter, pressSpring } from '../lib/motion';
import {
  colors,
  fonts,
  homePalette,
  type HomePalette,
} from '../theme/tokens';

// Blurred warm raster lifted from the Figma home backdrop; it already fades
// to transparent at its lower edge so it melts into the night background.
const backdropRaster = require('../../assets/home-backdrop.png');
const BACKDROP_ASPECT = 393 / 470;

/**
 * Full-bleed warm dark backdrop. The blurred ember raster from the Figma
 * home covers the top of the screen, with the original gradient overlaid
 * at reduced opacity so text contrast holds. If the raster ever fails to
 * load, the gradient returns to full strength as the whole backdrop.
 */
function HomeBackdrop() {
  const [rasterFailed, setRasterFailed] = useState(false);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {rasterFailed ? null : (
        <Image
          source={backdropRaster}
          resizeMode="cover"
          onError={() => setRasterFailed(true)}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            aspectRatio: BACKDROP_ASPECT,
          }}
        />
      )}
      <Svg
        width="100%"
        height="100%"
        preserveAspectRatio="none"
        style={{ opacity: rasterFailed ? 1 : 0.55 }}
      >
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

function InfoIcon({ stroke }: { stroke: string }) {
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

function CloseIcon({ stroke }: { stroke: string }) {
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
  pal,
  onPress,
  onLayout,
}: {
  label: string;
  active: boolean;
  /** Flat chips rely on a shared sliding indicator for their active pill. */
  flat?: boolean;
  pal: HomePalette;
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
        style={
          active
            ? flat
              ? undefined
              : { backgroundColor: pal.chipActiveBg }
            : {
                borderWidth: 1,
                borderColor: pal.chipInactiveBorder,
                backgroundColor: pal.chipInactiveBg,
              }
        }
        className="rounded-full px-4 py-2"
      >
        <Text
          style={{
            fontFamily: fonts.mono,
            color: active ? pal.chipActiveText : pal.chipInactiveText,
          }}
          className="text-[11px] uppercase tracking-[0.5px]"
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
  pal,
  onSelect,
}: {
  active: MetricInfo;
  pal: HomePalette;
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
              backgroundColor: pal.chipActiveBg,
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
            pal={pal}
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
  pal,
  onSelect,
}: {
  active: RangeInfo;
  pal: HomePalette;
  onSelect: (range: RangeInfo) => void;
}) {
  return (
    <View className="mb-4 flex-row">
      {RANGES.map((r) => (
        <Chip
          key={r.key}
          label={r.label}
          active={r.key === active.key}
          pal={pal}
          onPress={() => onSelect(r)}
        />
      ))}
    </View>
  );
}

/**
 * Device filter chips, shown only when more than one device is active.
 * "All devices" blends every connection as before; a provider chip
 * restricts the chart to that one wearable. Per-session state, mirroring
 * the web timeline's device filter.
 */
function DeviceTabs({
  devices,
  activeProvider,
  pal,
  onSelect,
}: {
  devices: Device[];
  activeProvider: string | null;
  pal: HomePalette;
  onSelect: (provider: string | null) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className="mb-4 -mx-5 px-5"
    >
      <View className="flex-row">
        <Chip
          label="All devices"
          active={activeProvider === null}
          pal={pal}
          onPress={() => onSelect(null)}
        />
        {devices.map((d) => (
          <Chip
            key={d.provider}
            label={providerName(d.provider)}
            active={activeProvider === d.provider}
            pal={pal}
            onPress={() => onSelect(d.provider)}
          />
        ))}
      </View>
    </ScrollView>
  );
}

/**
 * Figma connect card: translucent dark surface with a hairline border,
 * warm icon tile, and a full-width translucent mono button.
 */
function ConnectCard({
  hasSession,
  pal,
  onConnect,
  onDismiss,
}: {
  hasSession: boolean;
  pal: HomePalette;
  onConnect: () => void;
  onDismiss: () => void;
}) {
  return (
    <View
      style={{ borderColor: pal.cardBorder, backgroundColor: pal.cardBg }}
      className="mb-4 rounded-[18px] border-[0.5px] p-4"
    >
      <View className="flex-row items-start">
        <View className="h-12 w-12 rounded-[20px] bg-[#F37953]" />
        <View className="ml-3 flex-1">
          <Text
            style={{ color: pal.text }}
            className="text-[18px] font-sans-medium tracking-[-0.3px]"
          >
            Connect your devices
          </Text>
          <Text
            style={{ color: pal.cardBody }}
            className="mt-0.5 text-[14px] font-sans leading-[20px]"
          >
            Unlock more insights by connecting your wearable devices
          </Text>
        </View>
        <Pressable
          accessibilityLabel="Dismiss"
          onPress={onDismiss}
          hitSlop={8}
          className="ml-2 h-8 w-8 items-center justify-center rounded-full active:opacity-60"
        >
          <CloseIcon stroke={pal.closeIcon} />
        </Pressable>
      </View>
      <Pressable
        onPress={onConnect}
        style={{ backgroundColor: pal.cardButtonBg }}
        className="mt-4 w-full items-center justify-center rounded-[9px] py-3.5 active:opacity-80"
      >
        <Text
          style={{ fontFamily: fonts.mono, color: pal.cardButtonText }}
          className="text-[12px] uppercase tracking-[0.5px]"
        >
          {hasSession ? 'Connect a device' : 'Get started'}
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * Slim connect prompt for the notification slot, per the Figma home
 * design (Home->Notification): with zero devices connected there is
 * nothing to sync, so the notification area pitches connecting instead of
 * warning about syncing. It only appears after the larger connect card
 * has been dismissed, so the pitch never shows twice on one screen.
 */
function ConnectBanner({
  pal,
  onConnect,
  onDismiss,
}: {
  pal: HomePalette;
  onConnect: () => void;
  onDismiss: () => void;
}) {
  return (
    <View className="mb-4 flex-row items-center">
      <View className="flex-1 pr-2">
        <Text
          style={{ color: pal.text }}
          className="text-[14px] font-sans-medium leading-[20px]"
        >
          Connect your device
        </Text>
        <Text
          style={{ color: pal.bannerBody }}
          className="text-[12px] font-sans leading-[16px]"
        >
          Unlock more insights by connecting your wearable devices
        </Text>
      </View>
      <Pressable
        onPress={onConnect}
        style={{ backgroundColor: pal.bannerButtonBg }}
        className="h-[34px] items-center justify-center rounded-[7px] px-3 active:opacity-80"
      >
        <Text
          style={{ fontFamily: fonts.mono, color: pal.bannerButtonText }}
          className="text-[10px] uppercase tracking-[1px]"
        >
          Connect
        </Text>
      </Pressable>
      <Pressable
        accessibilityLabel="Dismiss"
        onPress={onDismiss}
        style={{ backgroundColor: pal.bannerDismissBg }}
        className="ml-2 h-[34px] w-[34px] items-center justify-center rounded-[7px] active:opacity-60"
      >
        <CloseIcon stroke={pal.closeIcon} />
      </Pressable>
    </View>
  );
}

/**
 * Pulsing placeholder in the connect card's slot while the device list is
 * still unknown, so the connect pitch never flashes at someone who already
 * has devices. Static under Reduce Motion.
 */
function ConnectCardSkeleton({ pal }: { pal: HomePalette }) {
  const pulse = useSharedValue(0.55);

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
        style,
        { borderColor: pal.skeletonBorder, backgroundColor: pal.skeletonBg },
      ]}
      className="mb-4 rounded-[18px] border-[0.5px] p-4"
    >
      <View className="flex-row items-start">
        <View
          style={{ backgroundColor: pal.skeletonTile }}
          className="h-12 w-12 rounded-[20px]"
        />
        <View className="ml-3 flex-1 gap-2 pt-1">
          <View
            style={{ backgroundColor: pal.skeletonTile }}
            className="h-4 w-40 rounded-full"
          />
          <View
            style={{ backgroundColor: pal.skeletonLine }}
            className="h-3 w-56 rounded-full"
          />
        </View>
      </View>
      <View
        style={{ backgroundColor: pal.skeletonLine }}
        className="mt-4 h-[46px] w-full rounded-[9px]"
      />
    </Animated.View>
  );
}

type Probe =
  | { state: 'idle' | 'pending' | 'empty' }
  | { state: 'found'; latestTs: string };

export function HomeScreen() {
  const {
    mode,
    theme,
    session,
    connectCardDismissed,
    dismissConnectCard,
    signOut,
    devices,
    refreshDevices,
    nav,
  } = useApp();
  // Chrome colors for the resolved theme. The teal biomarkers card keeps
  // its own dark palette inside LineChart regardless of the theme.
  const pal = homePalette[theme];
  const displayName = useDisplayName(session);
  const [metric, setMetric] = useState(METRICS[0]);
  const [range, setRange] = useState(RANGES[1]);
  // The last-used range survives restarts: picking 90d once means 90d
  // everywhere until changed, mirroring web.
  useEffect(() => {
    storage.loadRange().then((label: string | null) => {
      if (!label) return;
      const saved = RANGES.find((r) => r.label === label);
      if (saved) setRange(saved);
    });
  }, []);
  const pickRange = useCallback((r: (typeof RANGES)[number]) => {
    storage.saveRange(r.label);
    setRange(r);
  }, []);
  // Device filter: null charts every device blended; a provider slug
  // isolates one wearable. Per-session state, mirroring web.
  const [providerFilter, setProviderFilter] = useState<string | null>(null);
  const [series, setSeries] = useState<Timeseries | null>(null);
  // The metric the loaded series belongs to. The metric state alone runs
  // one commit ahead of the data after a switch, so the chart's count-up
  // bookkeeping reads this value, set together with the data.
  const [seriesMetricKey, setSeriesMetricKey] = useState<string>(METRICS[0].key);
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
  const { height: windowHeight } = useWindowDimensions();
  const scrollY = useSharedValue(0);
  // Quiet entrance for the YOU(th) wordmark at the foot: it fades in and
  // settles upward once the end of the page scrolls into view. One-shot,
  // and instant when the OS asks for reduced motion.
  const logoIn = useSharedValue(0);
  const logoTriggered = useSharedValue(false);
  const logoTiming = {
    duration: 480,
    easing: Easing.out(Easing.cubic),
    reduceMotion: ReduceMotion.System,
  } as const;
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
    if (
      !logoTriggered.value &&
      event.contentOffset.y + event.layoutMeasurement.height >=
        event.contentSize.height - 64
    ) {
      logoTriggered.value = true;
      logoIn.value = withTiming(1, logoTiming);
    }
  });
  // Scroll events never fire when everything already fits on screen, so a
  // short page reveals the wordmark as soon as the content size is known.
  const onContentSizeChange = useCallback(
    (_width: number, height: number) => {
      if (height > windowHeight || logoTriggered.value) return;
      logoTriggered.value = true;
      logoIn.value = withTiming(1, logoTiming);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [windowHeight, logoIn, logoTriggered],
  );
  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoIn.value,
    transform: [{ translateY: (1 - logoIn.value) * 10 }],
  }));
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

  const loadSeries = useCallback(async (): Promise<Timeseries | null> => {
    if (!session) {
      setSeries(null);
      return null;
    }
    setLoading(true);
    // A retry must show the busy spinner, never a frozen error view.
    setError(null);
    const fetchOnce = () => {
      const end = new Date();
      const start = new Date(end.getTime() - range.hours * 3600 * 1000);
      return api.getTimeseries(session.userId, metric.key, {
        start,
        end,
        resolution: range.resolution,
        provider: providerFilter ?? undefined,
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
      setSeriesMetricKey(`${metric.key}|${providerFilter ?? 'all'}`);
      return next;
    } catch {
      // Both attempts failed: a real request failure.
      setError('Could not load data. Check your connection and try again.');
      setSeries(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, [session, metric, range, providerFilter]);

  // Revalidate the shared device list every time home gains focus (this
  // screen mounts fresh per navigation) and when the session or auth state
  // resolves, so connect-state UI never trusts a stale snapshot. The settle
  // result is tracked so a device list that cannot load bounds its spinner
  // with retryable copy instead of holding it forever.
  const [devicesFailed, setDevicesFailed] = useState(false);
  useEffect(() => {
    let stale = false;
    refreshDevices().then((list) => {
      if (!stale) setDevicesFailed(list === null);
    });
    return () => {
      stale = true;
    };
  }, [refreshDevices]);

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
      const [, next] = await Promise.all([refreshDevices(), loadSeries()]);
      const nextLatest = next?.points.at(-1)?.ts ?? null;
      const gotNewData =
        nextLatest !== null && (prevLatest === null || nextLatest > prevLatest);
      // First data is the heartbeat's moment; otherwise a light tap confirms
      // that the pull actually brought something new in.
      if (gotNewData && !firstDataPending) tapLight();
    } finally {
      setRefreshing(false);
    }
  }, [session, series, metric.key, refreshDevices, loadSeries]);

  // Null means the device list is not known yet (still fetching, or every
  // fetch failed); only a confirmed list may drive connect-state UI.
  const devicesKnown = devices !== null;
  const active = (devices ?? []).filter((d) => d.status !== 'disconnected');
  const expired = active.filter((d) => d.status === 'expired');
  // A device that never delivered data only counts as stale once it has
  // been connected for over a day; brand new connections get grace time.
  const stale = active.filter(
    (d) =>
      d.status === 'connected' &&
      isOlderThan(d.last_data_at ?? d.connected_at, 24),
  );
  // The connect pitch only shows when devices are confidently known to be
  // absent. While unknown, a skeleton holds the slot instead.
  const showConnectCard =
    !connectCardDismissed && (!session || (devicesKnown && active.length === 0));
  const showConnectSkeleton =
    !connectCardDismissed && !!session && !devicesKnown;
  // With zero devices confirmed and the connect card dismissed, the
  // notification slot carries the Figma connect prompt so the screen
  // still offers a working path to connecting. Session-scoped dismissal.
  const [connectBannerDismissed, setConnectBannerDismissed] = useState(false);
  const showConnectBanner =
    !!session &&
    devicesKnown &&
    active.length === 0 &&
    connectCardDismissed &&
    !connectBannerDismissed;

  const providerSlugs = active.map((d) => d.provider);
  const supported = metricSupported(metric.key, providerSlugs, {
    demo: demoMode,
  });
  const slugsKey = providerSlugs.slice().sort().join(',');

  // A filtered device that gets disconnected falls back to all devices.
  useEffect(() => {
    if (
      providerFilter &&
      devicesKnown &&
      !providerSlugs.includes(providerFilter)
    ) {
      setProviderFilter(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerFilter, devicesKnown, slugsKey]);

  const inRangeEmpty =
    !loading && !error && !!session && series != null
      ? series.points.length === 0
      : false;

  // The selected window may simply be too narrow; probe wide before
  // explaining the emptiness, so the copy never misleads. The probe key
  // names the context a result belongs to; a change resets the machine.
  const probeKey = `${session?.userId ?? ''}|${metric.key}|${range.key}|${slugsKey}|${providerFilter ?? 'all'}`;
  const probeKeyRef = useRef(probeKey);
  probeKeyRef.current = probeKey;

  useEffect(() => {
    setProbe({ state: 'idle' });
  }, [probeKey]);

  // The probe effect must not pair a probe-state dependency with a
  // cancelling cleanup: setting `pending` would re-run the effect, fire the
  // previous run's cleanup, and discard the fetch result, leaving the
  // spinner up forever. An in-flight ref guards a single probe instead;
  // there is no cleanup, and a resolution whose key no longer matches is
  // dropped and re-arms the machine for the current key. A late resolution
  // on an unmounted instance is a harmless no-op.
  const probeInFlight = useRef(false);
  useEffect(() => {
    if (!inRangeEmpty || !session || active.length === 0) return;
    if (probe.state !== 'idle' || probeInFlight.current) return;
    if (!supported) {
      // Nothing connected can produce this metric; skip the wide probe so
      // the capability empty state renders without a wasted round trip.
      setProbe({ state: 'empty' });
      return;
    }
    probeInFlight.current = true;
    const key = probeKey;
    setProbe({ state: 'pending' });
    const end = new Date();
    const start = new Date(end.getTime() - 90 * 24 * 3600 * 1000);
    api
      .getTimeseries(session.userId, metric.key, {
        start,
        end,
        resolution: 'day',
        provider: providerFilter ?? undefined,
      })
      .then((wide) => {
        if (probeKeyRef.current !== key) return;
        const last = wide.points.at(-1);
        setProbe(
          last ? { state: 'found', latestTs: last.ts } : { state: 'empty' },
        );
      })
      .catch(() => {
        // On probe failure fall back to the connected-but-waiting copy.
        if (probeKeyRef.current === key) setProbe({ state: 'empty' });
      })
      .finally(() => {
        probeInFlight.current = false;
        // A result for a superseded key settled nothing; re-arm so the
        // current key launches its own probe instead of idling forever.
        if (probeKeyRef.current !== key) setProbe({ state: 'idle' });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    inRangeEmpty,
    active.length,
    probe,
    supported,
    session,
    metric.key,
    providerFilter,
  ]);

  // Hold the spinner while the probe decides which empty state applies, so
  // the explanation never flickers between copies.
  const probePending =
    inRangeEmpty &&
    active.length > 0 &&
    supported &&
    (probe.state === 'idle' || probe.state === 'pending');

  // An empty chart cannot pick its empty-state copy until the device list
  // is known; hold the spinner rather than guess. Once every fetch attempt
  // has failed the spinner yields to retryable copy instead of hanging.
  const devicesPending =
    !!session && !devicesKnown && !devicesFailed && inRangeEmpty;

  const friendly = meta.friendlyName.toLowerCase();
  const empty = useMemo(() => {
    if (!devicesKnown) {
      // Reachable only when every device fetch failed: without the list the
      // other copies would guess, so say what happened and offer a retry.
      return {
        title: 'Could not check your devices',
        message:
          'The connection hiccuped while loading your device list. Your data is safe.',
        action: { label: 'Try again', onPress: onRefresh },
      };
    }
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
    // With a device filter on, the waiting copy names that one device so
    // the message matches what the chart is actually showing.
    const named = providerFilter
      ? active.filter((d) => d.provider === providerFilter)
      : active;
    const names =
      formatNameList(named.map((d) => providerName(d.provider))) ||
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
    devicesKnown,
    slugsKey,
    active.length,
    supported,
    demoMode,
    friendly,
    metric.key,
    probe,
    range.label,
    providerFilter,
    nav,
    onRefresh,
  ]);

  const lastTs = series?.points.at(-1)?.ts ?? null;

  return (
    <View style={{ flex: 1, backgroundColor: pal.bg }}>
      {/* The warm ember raster and gradient belong to the dark home only;
          the light home sits on plain brand cream. */}
      {theme === 'dark' ? <HomeBackdrop /> : null}
      <Animated.ScrollView
        style={{ flex: 1 }}
        onScroll={onScroll}
        onContentSizeChange={onContentSizeChange}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={pal.refreshTint}
          />
        }
      >
        <View className="px-5 pb-28 pt-16">
          <Animated.View entering={enter(0)}>
            <View className="mb-5 flex-row items-center justify-between">
              <Animated.View style={headerStyle}>
                <Text
                  style={{ fontFamily: fonts.mono, color: pal.caption }}
                  className="text-[10px] uppercase tracking-[1px]"
                >
                  {session ? 'Hello' : 'Welcome back,'}
                </Text>
                <Text
                  style={{ color: pal.text }}
                  className="mt-2 text-[18px] font-sans-medium tracking-[-0.3px]"
                >
                  {displayName}
                </Text>
              </Animated.View>
              <Pressable
                accessibilityLabel="Profile and devices"
                onPress={() => nav.push({ name: 'devices' })}
                style={{
                  borderColor: pal.avatarBorder,
                  backgroundColor: pal.avatarBg,
                }}
                className="h-10 w-10 items-center justify-center rounded-full border-[0.4px] active:opacity-80"
              >
                <Text
                  style={{ color: pal.avatarText }}
                  className="text-[15px] font-sans-medium"
                >
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

          {/* A sync warning needs something connected to sync. With zero
              devices confirmed, the Figma home design shows a connect
              prompt in the notification area instead, never sync copy. */}
          {devicesKnown && active.length > 0 && stale.length > 0 ? (
            <Animated.View entering={enter(1)}>
              <Banner
                kind="warning"
                title="Sync issues"
                message="We have not received data recently. Pull down to refresh or check the device's own app."
              />
            </Animated.View>
          ) : null}

          {showConnectBanner ? (
            <Animated.View entering={enter(1)}>
              <ConnectBanner
                pal={pal}
                onConnect={() => nav.push({ name: 'connectMenu' })}
                onDismiss={() => setConnectBannerDismissed(true)}
              />
            </Animated.View>
          ) : null}

          {showConnectSkeleton ? (
            <Animated.View entering={enter(1)}>
              <ConnectCardSkeleton pal={pal} />
            </Animated.View>
          ) : showConnectCard ? (
            <Animated.View entering={enter(1)}>
              <ConnectCard
                hasSession={!!session}
                pal={pal}
                onConnect={() =>
                  session ? nav.push({ name: 'connectMenu' }) : signOut()
                }
                onDismiss={dismissConnectCard}
              />
            </Animated.View>
          ) : null}

          <Animated.View entering={enter(2)}>
            <View className="mb-3 mt-2 flex-row items-center justify-between">
              <Text
                style={{ color: pal.text }}
                className="text-[20px] font-sans-medium tracking-[-0.5px]"
              >
                Biomarkers
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`What is ${meta.friendlyName}?`}
                onPress={() => setInfoVisible(true)}
                hitSlop={8}
                className="h-8 w-8 items-center justify-center rounded-full active:opacity-60"
              >
                <InfoIcon stroke={pal.infoIcon} />
              </Pressable>
            </View>

            <MetricTabs active={metric} pal={pal} onSelect={setMetric} />
            <RangeTabs active={range} pal={pal} onSelect={pickRange} />
            {devicesKnown && active.length > 1 ? (
              <DeviceTabs
                devices={active}
                activeProvider={providerFilter}
                pal={pal}
                onSelect={setProviderFilter}
              />
            ) : null}
          </Animated.View>

          <Animated.View entering={enter(3)}>
            {/* The rounded card clips its children, so the plot inside is
                allowed to run edge to edge while never escaping the card. */}
            <View className="overflow-hidden rounded-[24px]">
              <TealCardBackdrop />
              <View className="px-4 pt-4">
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
              </View>

              {/* Every body below shares the chart block's footprint, so
                  the card holds one height across charts, empty states,
                  errors, and the signed-out pitch. */}
              {error ? (
                <View
                  style={{ minHeight: CHART_CONTENT_MIN_HEIGHT }}
                  className="items-center justify-center gap-3 px-6"
                >
                  <Text className="text-center text-[13px] font-sans text-[rgba(255,255,255,0.65)]">
                    {error}
                  </Text>
                  <Pressable
                    onPress={() => loadSeries()}
                    className="mt-1 h-10 items-center justify-center rounded-full bg-white px-5 active:opacity-80"
                  >
                    <Text
                      style={{ fontFamily: fonts.mono }}
                      className="text-[12px] uppercase tracking-[0.5px] text-ink"
                    >
                      Try again
                    </Text>
                  </Pressable>
                </View>
              ) : !session ? (
                <View
                  style={{ minHeight: CHART_CONTENT_MIN_HEIGHT }}
                  className="items-center justify-center px-6"
                >
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
                  seriesKey={seriesMetricKey}
                  inset={16}
                  rangeHours={range.hours}
                  loading={loading || probePending || devicesPending}
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

              {/* Breathing room between the x axis labels and the card's
                  bottom edge. */}
              <View className="h-4" />
            </View>
          </Animated.View>

          <Animated.View entering={enter(4)}>
            <View className="mt-8 px-1">
              <Text
                style={{ fontFamily: fonts.mono, color: pal.faint }}
                className="text-[10px] uppercase tracking-[1px]"
              >
                Disclaimer
              </Text>
              <Text
                style={{ color: pal.faint }}
                className="mt-2 text-[12px] font-sans leading-[17px]"
              >
                These readings provide an overview, and they do not capture
                everything. Regular check-ups with health professionals are
                recommended.
              </Text>
              <Animated.View style={logoStyle}>
                <Text
                  style={{ color: pal.text }}
                  className="mt-6 text-[20px] font-sans-medium"
                >
                  YOU(th)
                </Text>
              </Animated.View>
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
