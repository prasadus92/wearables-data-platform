import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import {
  Circle,
  DashPathEffect,
  LinearGradient,
  Line as SkiaLine,
  matchFont,
  Rect,
  Text as SkiaText,
  vec,
} from '@shopify/react-native-skia';
import Animated, {
  Easing,
  runOnJS,
  type SharedValue,
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {
  Area,
  CartesianChart,
  Line as ChartLine,
  Scatter,
  useChartPressState,
  type ChartPressState,
} from 'victory-native';

import Svg, { Path } from 'react-native-svg';

import type {
  Baseline,
  ClinicalBand,
  TimeseriesPoint,
} from '@wearables/health-core';

import { dayLabel, hourLabel } from '../lib/format';
import { tapLight } from '../lib/haptics';
import { enter } from '../lib/motion';
import { colors } from '../theme/tokens';

interface Props {
  points: TimeseriesPoint[];
  unit: string;
  /** Plot value_secondary as a second line (blood pressure). */
  dual?: boolean;
  /**
   * Identifies the series (the metric key). The latest-value count-up only
   * continues from a previous value belonging to the same series; values
   * from two different metrics are never animated as if continuous.
   */
  seriesKey?: string;
  /**
   * Horizontal padding for the text rows (status, latest, min/avg/max).
   * The plot itself spans the component's full width so it can run edge
   * to edge inside a rounded, clipped card.
   */
  inset?: number;
  /** Chart window length, controls x axis label format. */
  rangeHours: number;
  height?: number;
  loading?: boolean;
  /** Renders the Figma dark-card palette (white type, green series). */
  dark?: boolean;
  /** Optional bold first line above the empty message. */
  emptyTitle?: string;
  emptyMessage?: string;
  /** Optional call to action rendered under the empty message. */
  emptyAction?: { label: string; onPress: () => void };
  /** Neutral sentence placing the latest reading against the baseline. */
  status?: string | null;
  /** Disclosure when the series averages several devices; null hides it. */
  blendNote?: string | null;
  /** Mean of the last 7 days vs the prior 7, as a percentage. */
  weekDeltaPct?: number | null;
  /** Personal baseline band (mean +/- 1 stddev), drawn behind the line. */
  baselineBand?: Baseline | null;
  /** Population reference band from the metric metadata, where defensible. */
  clinicalBand?: ClinicalBand | null;
  /**
   * Day-resolution drill. When set, finishing a scrub (or a plain tap,
   * which activates and releases the same press state) leaves a small
   * "View this day" chip at the release point; tapping it reports the
   * scrubbed point's timestamp so the caller can pin the chart to that
   * calendar day. Omitted on hour charts and while already anchored.
   */
  onDrillDay?: (tsIso: string) => void;
}

interface Row {
  x: number;
  value: number;
  secondary: number;
  [key: string]: number;
}

type PressState = ChartPressState<{
  x: number;
  y: { value: number; secondary: number };
}>;

const MAX_POINTS = 400;
const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

/**
 * Vertical room the status sentence plus the latest/min/avg/max block take
 * above the plot when data is shown. Loading and empty states reserve the
 * same footprint, so the card keeps one height whether or not a chart is
 * on screen and the page never reflows when switching metrics or ranges.
 */
const STATS_AREA_HEIGHT = 106;
const DEFAULT_CHART_HEIGHT = 220;
/** Total content height of the chart block; siblings that replace it
 * (error and signed-out states) should occupy the same footprint. */
export const CHART_CONTENT_MIN_HEIGHT =
  DEFAULT_CHART_HEIGHT + STATS_AREA_HEIGHT;

/** Color sets for the light card and the Figma dark biomarkers card. */
interface Theme {
  axisLabel: string;
  grid: string;
  line1: string;
  line2: string;
  area1: [string, string];
  area2: [string, string];
  bandClinical: string;
  bandClinicalOpacity: number;
  bandBaseline: string;
  bandBaselineOpacity: number;
  bandLabel: string;
  cursor: string;
  markerCore: string;
  spinner: string;
  caption: string;
  body: string;
  strong: string;
  tooltipBg: string;
  tooltipValue: string;
  tooltipTs: string;
  chipBorder: string;
  ctaBg: string;
  ctaText: string;
}

const LIGHT: Theme = {
  axisLabel: colors.faint,
  grid: colors.line,
  line1: colors.coral,
  line2: colors.blue,
  area1: ['rgba(232, 85, 77, 0.18)', 'rgba(232, 85, 77, 0)'],
  area2: ['rgba(77, 124, 232, 0.14)', 'rgba(77, 124, 232, 0)'],
  bandClinical: colors.blue,
  bandClinicalOpacity: 0.05,
  bandBaseline: colors.ink,
  bandBaselineOpacity: 0.06,
  bandLabel: colors.faint,
  cursor: colors.faint,
  markerCore: colors.card,
  spinner: colors.sub,
  caption: colors.faint,
  body: colors.sub,
  strong: colors.ink,
  tooltipBg: colors.ink,
  tooltipValue: colors.card,
  tooltipTs: '#B9B7B2',
  chipBorder: colors.line,
  ctaBg: colors.ink,
  ctaText: colors.card,
};

const DARK: Theme = {
  axisLabel: 'rgba(255, 255, 255, 0.55)',
  grid: 'rgba(255, 255, 255, 0.14)',
  line1: colors.good,
  line2: colors.pink,
  area1: ['rgba(14, 209, 135, 0.22)', 'rgba(14, 209, 135, 0)'],
  area2: ['rgba(245, 78, 240, 0.16)', 'rgba(245, 78, 240, 0)'],
  bandClinical: '#FFFFFF',
  bandClinicalOpacity: 0.05,
  bandBaseline: '#FFFFFF',
  bandBaselineOpacity: 0.08,
  bandLabel: 'rgba(255, 255, 255, 0.55)',
  cursor: 'rgba(255, 255, 255, 0.6)',
  markerCore: colors.tealBottom,
  spinner: '#FFFFFF',
  caption: 'rgba(255, 255, 255, 0.55)',
  body: 'rgba(255, 255, 255, 0.65)',
  strong: '#FFFFFF',
  tooltipBg: '#FFFFFF',
  tooltipValue: colors.ink,
  tooltipTs: colors.mute,
  chipBorder: 'rgba(255, 255, 255, 0.25)',
  ctaBg: '#FFFFFF',
  ctaText: colors.ink,
};

const axisFont = matchFont({
  fontFamily: Platform.select({ ios: 'Helvetica', default: 'sans-serif' }),
  fontSize: 10,
});

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function formatTooltipTs(ts: number): string {
  'worklet';
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}, ${hh}:${mm}`;
}

function formatValue(v: number): string {
  'worklet';
  return String(Math.round(v * 10) / 10);
}

/**
 * Largest-triangle-three-buckets downsampling. Keeps first and last points
 * and picks the visually dominant point from each bucket, so peaks and dips
 * survive even when thousands of raw points come back from the API.
 */
function decimate(rows: Row[], threshold: number): Row[] {
  if (rows.length <= threshold) return rows;
  const sampled: Row[] = [rows[0]];
  const bucketSize = (rows.length - 2) / (threshold - 2);
  let anchor = 0;
  for (let i = 0; i < threshold - 2; i++) {
    const nextStart = Math.floor((i + 1) * bucketSize) + 1;
    const nextEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, rows.length);
    let avgX = 0;
    let avgY = 0;
    for (let j = nextStart; j < nextEnd; j++) {
      avgX += rows[j].x;
      avgY += rows[j].value;
    }
    const n = Math.max(1, nextEnd - nextStart);
    avgX /= n;
    avgY /= n;

    const start = Math.floor(i * bucketSize) + 1;
    const end = Math.min(Math.floor((i + 1) * bucketSize) + 1, rows.length);
    let maxArea = -1;
    let chosenIdx = start;
    for (let j = start; j < end; j++) {
      const area = Math.abs(
        (rows[anchor].x - avgX) * (rows[j].value - rows[anchor].value) -
          (rows[anchor].x - rows[j].x) * (avgY - rows[anchor].value),
      );
      if (area > maxArea) {
        maxArea = area;
        chosenIdx = j;
      }
    }
    sampled.push(rows[chosenIdx]);
    anchor = chosenIdx;
  }
  sampled.push(rows[rows.length - 1]);
  return sampled;
}

function statText(lo: number, dual: boolean, loSec: number): string {
  return dual
    ? `${Math.round(lo)}/${Math.round(loSec)}`
    : String(Math.round(lo * 10) / 10);
}

/** Small arrow chip for the 7-day vs prior 7-day change. Neutral styling on
 * purpose: a rising heart rate is not "bad" and a rising HRV is not "good"
 * enough to color-code without misleading. */
function DeltaChip({ delta, t }: { delta: number; t: Theme }) {
  const rising = delta >= 0;
  return (
    <View
      style={{ borderColor: t.chipBorder }}
      className="flex-row items-center rounded-full border px-2.5 py-1"
    >
      <Svg
        width={10}
        height={10}
        viewBox="0 0 12 12"
        style={rising ? undefined : { transform: [{ rotate: '180deg' }] }}
      >
        <Path d="M6 2.5 L10 8 H2 Z" fill={t.body} />
      </Svg>
      <Text
        style={{ color: t.body }}
        className="ml-1.5 text-[11px] font-sans-medium"
      >
        {rising ? '+' : ''}
        {delta.toFixed(1)}% vs prior week
      </Text>
    </View>
  );
}

interface BandBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Horizontal translucent band behind the series, with a tiny right-aligned
 * label. Open-ended bounds extend to the chart edge, and everything clamps
 * to the plot area so a band outside the visible domain simply disappears.
 */
function BandRect({
  low,
  high,
  color,
  opacity,
  label,
  labelColor,
  labelPosition,
  chartBounds,
  yScale,
}: {
  low?: number;
  high?: number;
  color: string;
  opacity: number;
  label: string;
  labelColor: string;
  labelPosition: 'top' | 'bottom';
  chartBounds: BandBounds;
  yScale: (value: number) => number;
}) {
  const clamp = (v: number) =>
    Math.min(Math.max(v, chartBounds.top), chartBounds.bottom);
  const top = clamp(high != null ? yScale(high) : chartBounds.top);
  const bottom = clamp(low != null ? yScale(low) : chartBounds.bottom);
  const bandHeight = bottom - top;
  if (bandHeight < 2) return null;

  const labelWidth = axisFont.measureText(label).width;
  const showLabel = bandHeight >= 16;
  const labelY = labelPosition === 'top' ? top + 11 : bottom - 4;

  return (
    <>
      <Rect
        x={chartBounds.left}
        y={top}
        width={chartBounds.right - chartBounds.left}
        height={bandHeight}
        color={color}
        opacity={opacity}
      />
      {showLabel ? (
        <SkiaText
          font={axisFont}
          text={label}
          x={chartBounds.right - labelWidth - 6}
          y={labelY}
          color={labelColor}
        />
      ) : null}
    </>
  );
}

function Stat({ label, value, t }: { label: string; value: string; t: Theme }) {
  return (
    <View className="ml-5 items-end">
      <Text
        style={{ fontFamily: MONO, color: t.caption }}
        className="text-[9px] uppercase tracking-[1px]"
      >
        {label}
      </Text>
      <Text
        style={{ color: t.strong }}
        className="mt-0.5 text-[13px] font-sans-medium"
      >
        {value}
      </Text>
    </View>
  );
}

/** Vertical hairline plus markers on each line while the user scrubs. */
function Cursor({
  state,
  top,
  bottom,
  dual,
  t,
}: {
  state: PressState;
  top: number;
  bottom: number;
  dual: boolean;
  t: Theme;
}) {
  const p1 = useDerivedValue(() => vec(state.x.position.value, top));
  const p2 = useDerivedValue(() => vec(state.x.position.value, bottom));
  return (
    <>
      <SkiaLine p1={p1} p2={p2} color={t.cursor} strokeWidth={1}>
        <DashPathEffect intervals={[3, 3]} />
      </SkiaLine>
      <Circle
        cx={state.x.position}
        cy={state.y.value.position}
        r={6}
        color={t.line1}
        opacity={0.25}
      />
      <Circle
        cx={state.x.position}
        cy={state.y.value.position}
        r={4}
        color={t.line1}
      />
      <Circle
        cx={state.x.position}
        cy={state.y.value.position}
        r={1.8}
        color={t.markerCore}
      />
      {dual ? (
        <>
          <Circle
            cx={state.x.position}
            cy={state.y.secondary.position}
            r={6}
            color={t.line2}
            opacity={0.25}
          />
          <Circle
            cx={state.x.position}
            cy={state.y.secondary.position}
            r={4}
            color={t.line2}
          />
          <Circle
            cx={state.x.position}
            cy={state.y.secondary.position}
            r={1.8}
            color={t.markerCore}
          />
        </>
      ) : null}
    </>
  );
}

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

/**
 * Large latest reading. A range switch within the same metric counts from
 * the previously shown value (~350ms); a metric switch or a first load
 * fades the new value in quietly instead, so the count never runs across
 * two different units as if they were continuous. The count decides its
 * decimal places from the TARGET value once: integer targets count in
 * whole numbers and one-decimal targets show exactly one decimal at every
 * frame. On completion the exact formatted target is set definitively,
 * never left to the last interpolated frame, which used to strand text
 * like a trailing dot or a truncated value. Reduce Motion swaps in place.
 * Runs on animated props, so counting never re-renders the tree.
 */
function LatestValue({
  value,
  text,
  from,
  countUp,
  t,
  dark,
}: {
  /** Numeric latest for single-series metrics. */
  value: number;
  /** Preformatted latest, used verbatim when not counting (dual). */
  text: string;
  /** Previously shown latest for the SAME series, the count's start. */
  from: number | null;
  countUp: boolean;
  t: Theme;
  dark: boolean;
}) {
  const reduced = useReducedMotion();
  // The entrance choice is frozen at mount. Metric and range switches
  // remount this block (the loading state unmounts it), so every switch
  // replays exactly one entrance: a count when a same-series start value
  // exists, otherwise a quiet fade-in.
  const entrance = useRef({ from, countUp }).current;
  const startFrom =
    entrance.countUp && entrance.from != null ? entrance.from : null;
  const counting = !reduced && startFrom != null;
  const fading = !reduced && !counting;

  // Decimals come from the target once: 62 counts 58, 59, ... 62 and
  // 14.7 counts 13.9, 14.0, ... 14.7. toFixed pads every frame, so a
  // bare trailing dot can never render.
  const decimals = Number.isInteger(Math.round(value * 10) / 10) ? 0 : 1;
  const finalText = countUp
    ? (Math.round(value * 10) / 10).toFixed(decimals)
    : text;

  const sv = useSharedValue(startFrom != null && counting ? startFrom : value);
  // Once settled, the exact formatted target renders, never a frame value.
  const settled = useSharedValue(!counting);
  const opacity = useSharedValue(fading ? 0 : 1);

  useEffect(() => {
    if (fading) {
      opacity.value = withTiming(1, {
        duration: 300,
        easing: Easing.out(Easing.cubic),
      });
    }
    // The entrance plays once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!counting) {
      sv.value = value;
      settled.value = true;
      return;
    }
    settled.value = false;
    sv.value = withTiming(value, { duration: 350 }, (finished) => {
      'worklet';
      if (finished) {
        // Guarantee the final frame: set the exact target definitively.
        sv.value = value;
        settled.value = true;
      }
    });
  }, [value, counting, sv, settled]);

  const valueProps = useAnimatedProps(() => {
    const shown = settled.value ? finalText : sv.value.toFixed(decimals);
    return { text: shown, defaultValue: shown } as TextInputProps;
  });

  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <AnimatedTextInput
      editable={false}
      underlineColorAndroid="transparent"
      animatedProps={valueProps}
      style={[{ padding: 0, margin: 0, color: t.strong }, fadeStyle]}
      className={
        dark
          ? 'text-[36px] font-sans leading-[42px]'
          : 'text-[28px] font-sans-medium leading-[32px]'
      }
    />
  );
}

/**
 * Floating readout that follows the finger. Text updates run entirely on the
 * UI thread via animated props, so scrubbing never re-renders the tree.
 */
function Tooltip({
  state,
  dual,
  unit,
  containerWidth,
  t,
}: {
  state: PressState;
  dual: boolean;
  unit: string;
  containerWidth: SharedValue<number>;
  t: Theme;
}) {
  const tooltipWidth = useSharedValue(96);

  const valueProps = useAnimatedProps(() => {
    const v = state.y.value.value.value;
    const s = state.y.secondary.value.value;
    const text = dual
      ? `${Math.round(v)}/${Math.round(s)} ${unit}`
      : `${formatValue(v)} ${unit}`;
    return { text, defaultValue: text } as TextInputProps;
  });

  const tsProps = useAnimatedProps(() => {
    const text = formatTooltipTs(state.x.value.value);
    return { text, defaultValue: text } as TextInputProps;
  });

  const boxStyle = useAnimatedStyle(() => {
    const w = tooltipWidth.value;
    const max = Math.max(0, containerWidth.value - w - 2);
    const x = Math.min(Math.max(state.x.position.value - w / 2, 2), max);
    return {
      opacity: withTiming(state.isActive.value ? 1 : 0, { duration: 120 }),
      transform: [{ translateX: x }],
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      onLayout={(e) => {
        tooltipWidth.value = e.nativeEvent.layout.width;
      }}
      style={[boxStyle, { backgroundColor: t.tooltipBg }]}
      className="absolute left-0 top-0 items-center rounded-xl px-3 py-1.5 shadow-sm"
    >
      <AnimatedTextInput
        editable={false}
        underlineColorAndroid="transparent"
        animatedProps={valueProps}
        style={{ padding: 0, margin: 0, color: t.tooltipValue }}
        className="text-[14px] font-sans-medium"
      />
      <AnimatedTextInput
        editable={false}
        underlineColorAndroid="transparent"
        animatedProps={tsProps}
        style={{ padding: 0, margin: 0, color: t.tooltipTs }}
        className="text-[10px] font-sans"
      />
    </Animated.View>
  );
}

/**
 * Drill affordance for day-resolution charts. The scrub pan gesture owns
 * the canvas, so a competing tap recognizer inside the chart would race
 * it; instead this chip appears where the finger lifted, anchored under
 * the tooltip's last position, and pins the chart to the scrubbed point's
 * calendar day when tapped.
 */
function DrillChip({
  state,
  containerWidth,
  t,
  onPress,
}: {
  state: PressState;
  containerWidth: SharedValue<number>;
  t: Theme;
  onPress: () => void;
}) {
  const chipWidth = useSharedValue(104);

  const boxStyle = useAnimatedStyle(() => {
    const w = chipWidth.value;
    const max = Math.max(0, containerWidth.value - w - 2);
    const x = Math.min(Math.max(state.x.position.value - w / 2, 2), max);
    return { transform: [{ translateX: x }] };
  });

  return (
    <Animated.View
      entering={enter(0)}
      onLayout={(e) => {
        chipWidth.value = e.nativeEvent.layout.width;
      }}
      style={[boxStyle, { backgroundColor: t.ctaBg }]}
      className="absolute left-0 top-12 self-start rounded-full shadow-sm"
    >
      <Pressable
        onPress={onPress}
        hitSlop={6}
        className="px-3 py-1.5 active:opacity-80"
      >
        <Text
          style={{ fontFamily: MONO, color: t.ctaText }}
          className="text-[10px] uppercase tracking-[1px]"
        >
          View this day
        </Text>
      </Pressable>
    </Animated.View>
  );
}

export function LineChart({
  points,
  unit,
  dual = false,
  seriesKey = '',
  inset = 0,
  rangeHours,
  height = DEFAULT_CHART_HEIGHT,
  loading = false,
  dark = false,
  emptyTitle,
  emptyMessage = 'No data for this range yet.',
  emptyAction,
  status,
  blendNote,
  weekDeltaPct,
  baselineBand,
  clinicalBand,
  onDrillDay,
}: Props) {
  const t = dark ? DARK : LIGHT;
  const containerWidth = useSharedValue(0);
  const { state, isActive } = useChartPressState({
    x: 0,
    y: { value: 0, secondary: 0 },
  });

  const rows = useMemo<Row[]>(() => {
    const mapped = points
      .map((p) => ({
        x: new Date(p.ts).getTime(),
        value: p.value,
        secondary: dual ? (p.value_secondary ?? Number.NaN) : p.value,
      }))
      .filter((r) => !Number.isNaN(r.x) && !Number.isNaN(r.secondary))
      .sort((a, b) => a.x - b.x);
    return decimate(mapped, MAX_POINTS);
  }, [points, dual]);

  const stats = useMemo(() => {
    if (rows.length === 0) return null;
    let loV = Infinity;
    let hiV = -Infinity;
    let sumV = 0;
    let loS = Infinity;
    let hiS = -Infinity;
    let sumS = 0;
    for (const r of rows) {
      loV = Math.min(loV, r.value);
      hiV = Math.max(hiV, r.value);
      sumV += r.value;
      loS = Math.min(loS, r.secondary);
      hiS = Math.max(hiS, r.secondary);
      sumS += r.secondary;
    }
    const last = rows[rows.length - 1];
    return {
      min: statText(loV, dual, loS),
      avg: statText(sumV / rows.length, dual, sumS / rows.length),
      max: statText(hiV, dual, hiS),
      latest: dual
        ? `${Math.round(last.value)}/${Math.round(last.secondary)}`
        : String(Math.round(last.value * 10) / 10),
    };
  }, [rows, dual]);

  // A single sample cannot span a domain, so pad it to half an hour each side.
  const xDomain = useMemo<[number, number] | undefined>(() => {
    if (rows.length !== 1) return undefined;
    return [rows[0].x - 30 * 60 * 1000, rows[0].x + 30 * 60 * 1000];
  }, [rows]);

  // Explicit y-domain with headroom. The natural curve overshoots the data
  // extremes, so a value sitting on the auto domain edge clips its stroke
  // at the plot boundary. Pad 8% beyond the data and the typical-range
  // band, so the line and the band always render fully inside the plot.
  const yDomain = useMemo<[number, number] | undefined>(() => {
    if (rows.length === 0) return undefined;
    let lo = Infinity;
    let hi = -Infinity;
    for (const r of rows) {
      lo = Math.min(lo, r.value);
      hi = Math.max(hi, r.value);
      if (dual) {
        lo = Math.min(lo, r.secondary);
        hi = Math.max(hi, r.secondary);
      }
    }
    if (baselineBand) {
      lo = Math.min(lo, baselineBand.low);
      hi = Math.max(hi, baselineBand.high);
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return undefined;
    // Flat series still get breathing room via the absolute fallbacks.
    const pad = Math.max((hi - lo) * 0.08, Math.abs(hi) * 0.01, 0.5);
    return [lo - pad, hi + pad];
  }, [rows, dual, baselineBand]);

  // The timestamp where the last scrub released, captured on the JS thread
  // so the drill chip can render there. A new scrub hides the chip until
  // the finger lifts again; fresh data or a series switch clears it.
  const drillEnabled = onDrillDay != null;
  const [scrubTs, setScrubTs] = useState<number | null>(null);

  useAnimatedReaction(
    () => state.isActive.value,
    (active, prev) => {
      if (active && prev === false) {
        runOnJS(tapLight)();
        if (drillEnabled) runOnJS(setScrubTs)(null);
      } else if (!active && prev === true && drillEnabled) {
        runOnJS(setScrubTs)(state.x.value.value);
      }
    },
    [drillEnabled],
  );

  useEffect(() => {
    setScrubTs(null);
  }, [seriesKey, rows]);

  // The latest value last shown on screen, tagged with the series it
  // belongs to and surviving the loading unmounts. A range switch within
  // the same series counts from it. A series switch never does (the units
  // differ), and an unchanged value yields a fade instead of a dead frame,
  // so every switch visibly replays.
  const lastShown = useRef<{ key: string; value: number } | null>(null);
  const latestNumeric = rows.length > 0 ? rows[rows.length - 1].value : null;
  const prevShown = lastShown.current;
  const countFrom =
    prevShown != null &&
    prevShown.key === seriesKey &&
    prevShown.value !== latestNumeric
      ? prevShown.value
      : null;
  useEffect(() => {
    if (!loading && latestNumeric != null) {
      lastShown.current = { key: seriesKey, value: latestNumeric };
    }
  }, [latestNumeric, loading, seriesKey]);

  const xLabel = rangeHours <= 24 ? hourLabel : dayLabel;
  const hasData = rows.length > 0;

  let body;
  if (loading) {
    body = (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color={t.spinner} />
      </View>
    );
  } else if (!hasData) {
    body = (
      <View className="flex-1 items-center justify-center gap-3 px-6">
        {emptyTitle ? (
          <Text
            style={{ color: t.strong }}
            className="text-center text-[15px] font-sans-medium"
          >
            {emptyTitle}
          </Text>
        ) : null}
        <Text
          style={{ color: t.body }}
          className="text-center text-[13px] font-sans leading-[19px]"
        >
          {emptyMessage}
        </Text>
        {emptyAction ? (
          <Pressable
            onPress={emptyAction.onPress}
            style={{ backgroundColor: t.ctaBg }}
            className="mt-1 h-10 items-center justify-center rounded-full px-5"
          >
            <Text
              style={{ fontFamily: MONO, color: t.ctaText }}
              className="text-[12px] uppercase tracking-[0.5px]"
            >
              {emptyAction.label}
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  } else {
    body = (
      <CartesianChart
        data={rows}
        xKey="x"
        yKeys={['value', 'secondary']}
        domain={
          xDomain || yDomain
            ? {
                ...(xDomain ? { x: xDomain } : {}),
                ...(yDomain ? { y: yDomain } : {}),
              }
            : undefined
        }
        // Pixel padding on top of the padded domain keeps the 2.5pt stroke
        // (plus its round caps) inside the clip even at the extremes.
        domainPadding={{ top: 14, bottom: 14, left: 6, right: 6 }}
        // The canvas spans the card's full width: a small left padding
        // keeps the y axis labels off the card edge, while the right edge
        // stays at zero so the plot and the typical-range band run edge
        // to edge by design, clipped by the card's rounded bounds.
        padding={{ top: 4, bottom: 4, left: 12, right: 0 }}
        chartPressState={state}
        xAxis={{
          font: axisFont,
          labelColor: t.axisLabel,
          lineWidth: 0,
          tickCount: 4,
          labelOffset: 6,
          formatXLabel: (ts) => xLabel(ts),
        }}
        yAxis={[
          {
            font: axisFont,
            labelColor: t.axisLabel,
            lineColor: t.grid,
            lineWidth: 1,
            tickCount: 4,
            labelOffset: 8,
            formatYLabel: (v) => String(Math.round(v)),
          },
        ]}
      >
        {({ points: pts, chartBounds, yScale }) => (
          <>
            {clinicalBand ? (
              <BandRect
                low={clinicalBand.min}
                high={clinicalBand.max}
                color={t.bandClinical}
                opacity={t.bandClinicalOpacity}
                label={clinicalBand.label}
                labelColor={t.bandLabel}
                labelPosition="top"
                chartBounds={chartBounds}
                yScale={yScale}
              />
            ) : null}
            {baselineBand ? (
              <BandRect
                low={baselineBand.low}
                high={baselineBand.high}
                color={t.bandBaseline}
                opacity={t.bandBaselineOpacity}
                label="your typical range"
                labelColor={t.bandLabel}
                labelPosition="bottom"
                chartBounds={chartBounds}
                yScale={yScale}
              />
            ) : null}
            <Area
              points={pts.value}
              y0={chartBounds.bottom}
              curveType="natural"
              animate={{ type: 'timing', duration: 400 }}
            >
              <LinearGradient
                start={vec(0, chartBounds.top)}
                end={vec(0, chartBounds.bottom)}
                colors={[...t.area1]}
              />
            </Area>
            {dual ? (
              <Area
                points={pts.secondary}
                y0={chartBounds.bottom}
                curveType="natural"
                animate={{ type: 'timing', duration: 400 }}
              >
                <LinearGradient
                  start={vec(0, chartBounds.top)}
                  end={vec(0, chartBounds.bottom)}
                  colors={[...t.area2]}
                />
              </Area>
            ) : null}
            <ChartLine
              points={pts.value}
              color={t.line1}
              strokeWidth={2.5}
              strokeCap="round"
              curveType="natural"
              animate={{ type: 'timing', duration: 400 }}
            />
            {dual ? (
              <ChartLine
                points={pts.secondary}
                color={t.line2}
                strokeWidth={2.5}
                strokeCap="round"
                curveType="natural"
                animate={{ type: 'timing', duration: 400 }}
              />
            ) : null}
            {rows.length === 1 ? (
              <>
                <Scatter
                  points={pts.value}
                  radius={4.5}
                  style="fill"
                  color={t.line1}
                />
                {dual ? (
                  <Scatter
                    points={pts.secondary}
                    radius={4.5}
                    style="fill"
                    color={t.line2}
                  />
                ) : null}
              </>
            ) : null}
            {isActive ? (
              <Cursor
                state={state}
                top={chartBounds.top}
                bottom={chartBounds.bottom}
                dual={dual}
                t={t}
              />
            ) : null}
          </>
        )}
      </CartesianChart>
    );
  }

  return (
    <View style={{ minHeight: height + STATS_AREA_HEIGHT }}>
      {hasData && !loading && stats ? (
        <>
          {status ? (
            <View
              style={{ paddingHorizontal: inset }}
              className="mt-3 flex-row items-center justify-between"
            >
              <Text
                style={{ color: t.strong }}
                className="flex-1 pr-2 text-[13px] font-sans-medium"
              >
                {status}
              </Text>
              {weekDeltaPct != null ? (
                <DeltaChip delta={weekDeltaPct} t={t} />
              ) : null}
            </View>
          ) : null}
          {blendNote ? (
            <View style={{ paddingHorizontal: inset }} className="mt-1">
              <Text
                style={{ color: t.axisLabel }}
                className="font-mono text-[10px] uppercase tracking-widest"
              >
                {blendNote}
              </Text>
            </View>
          ) : null}
          <View
            style={{ paddingHorizontal: inset }}
            className={`mb-2 flex-row items-end justify-between ${status ? 'mt-2' : 'mt-3'}`}
          >
            <View>
              <Text
                style={{ fontFamily: MONO, color: t.caption }}
                className="text-[9px] uppercase tracking-[1px]"
              >
                Latest
              </Text>
              <View className="flex-row items-baseline">
                <LatestValue
                  value={latestNumeric ?? 0}
                  text={stats.latest}
                  from={dual ? null : countFrom}
                  countUp={!dual && latestNumeric != null}
                  t={t}
                  dark={dark}
                />
                {unit ? (
                  <Text
                    style={{ color: t.body }}
                    className="ml-1.5 text-[13px] font-sans-medium"
                  >
                    {unit}
                  </Text>
                ) : null}
              </View>
            </View>
            <View className="flex-row pb-1">
              <Stat label="Min" value={stats.min} t={t} />
              <Stat label="Avg" value={stats.avg} t={t} />
              <Stat label="Max" value={stats.max} t={t} />
            </View>
          </View>
        </>
      ) : null}
      <View
        // Empty and loading bodies stretch over the whole reserved
        // footprint and center there, so toggling between a chart and an
        // empty state never moves the rest of the page.
        style={hasData && !loading ? { height } : { flex: 1 }}
        onLayout={(e) => {
          containerWidth.value = e.nativeEvent.layout.width;
        }}
      >
        {hasData && !loading ? (
          // This wrapper mounts exactly when the chart gains its first
          // points (or fresh ones after a reload), so the entering spring
          // doubles as the empty-to-data draw-in for the whole plot.
          <Animated.View style={{ flex: 1 }} entering={enter(0)}>
            {body}
          </Animated.View>
        ) : (
          body
        )}
        {hasData && !loading ? (
          <Tooltip
            state={state}
            dual={dual}
            unit={unit}
            containerWidth={containerWidth}
            t={t}
          />
        ) : null}
        {hasData && !loading && onDrillDay && scrubTs != null ? (
          <DrillChip
            state={state}
            containerWidth={containerWidth}
            t={t}
            onPress={() => {
              tapLight();
              const ts = scrubTs;
              setScrubTs(null);
              onDrillDay(new Date(ts).toISOString());
            }}
          />
        ) : null}
      </View>
    </View>
  );
}
