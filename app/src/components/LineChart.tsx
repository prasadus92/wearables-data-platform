import { useMemo } from 'react';
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
  runOnJS,
  type SharedValue,
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
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
} from '@examplehealth/health-core';

import { dayLabel, hourLabel } from '../lib/format';
import { tapLight } from '../lib/haptics';
import { enter } from '../lib/motion';
import { colors } from '../theme/tokens';

interface Props {
  points: TimeseriesPoint[];
  unit: string;
  /** Plot value_secondary as a second line (blood pressure). */
  dual?: boolean;
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
  /** Mean of the last 7 days vs the prior 7, as a percentage. */
  weekDeltaPct?: number | null;
  /** Personal baseline band (mean +/- 1 stddev), drawn behind the line. */
  baselineBand?: Baseline | null;
  /** Population reference band from the metric metadata, where defensible. */
  clinicalBand?: ClinicalBand | null;
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

export function LineChart({
  points,
  unit,
  dual = false,
  rangeHours,
  height = 220,
  loading = false,
  dark = false,
  emptyTitle,
  emptyMessage = 'No data for this range yet.',
  emptyAction,
  status,
  weekDeltaPct,
  baselineBand,
  clinicalBand,
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

  useAnimatedReaction(
    () => state.isActive.value,
    (active, prev) => {
      if (active && prev === false) runOnJS(tapLight)();
    },
  );

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
        domain={xDomain ? { x: xDomain } : undefined}
        domainPadding={{ top: 14, bottom: 14, left: 6, right: 6 }}
        padding={{ top: 4, bottom: 2 }}
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
    <View>
      {hasData && !loading && stats ? (
        <>
          {status ? (
            <View className="mt-3 flex-row items-center justify-between">
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
          <View
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
                <Text
                  style={{ color: t.strong }}
                  className={
                    dark
                      ? 'text-[36px] font-sans leading-[42px]'
                      : 'text-[28px] font-sans-medium leading-[32px]'
                  }
                >
                  {stats.latest}
                </Text>
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
        style={{ height }}
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
      </View>
    </View>
  );
}
