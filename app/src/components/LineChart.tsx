import { useMemo } from 'react';
import {
  ActivityIndicator,
  Platform,
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
  vec,
} from '@shopify/react-native-skia';
import * as Haptics from 'expo-haptics';
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

import type { TimeseriesPoint } from '../api/types';
import { dayLabel, hourLabel } from '../lib/format';
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
  emptyMessage?: string;
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View className="ml-5 items-end">
      <Text
        style={{ fontFamily: MONO }}
        className="text-[9px] uppercase tracking-[1px] text-faint"
      >
        {label}
      </Text>
      <Text className="mt-0.5 text-[13px] font-semibold text-ink">{value}</Text>
    </View>
  );
}

/** Vertical hairline plus markers on each line while the user scrubs. */
function Cursor({
  state,
  top,
  bottom,
  dual,
}: {
  state: PressState;
  top: number;
  bottom: number;
  dual: boolean;
}) {
  const p1 = useDerivedValue(() => vec(state.x.position.value, top));
  const p2 = useDerivedValue(() => vec(state.x.position.value, bottom));
  return (
    <>
      <SkiaLine p1={p1} p2={p2} color={colors.faint} strokeWidth={1}>
        <DashPathEffect intervals={[3, 3]} />
      </SkiaLine>
      <Circle
        cx={state.x.position}
        cy={state.y.value.position}
        r={6}
        color={colors.coral}
        opacity={0.25}
      />
      <Circle
        cx={state.x.position}
        cy={state.y.value.position}
        r={4}
        color={colors.coral}
      />
      <Circle
        cx={state.x.position}
        cy={state.y.value.position}
        r={1.8}
        color={colors.card}
      />
      {dual ? (
        <>
          <Circle
            cx={state.x.position}
            cy={state.y.secondary.position}
            r={6}
            color={colors.blue}
            opacity={0.25}
          />
          <Circle
            cx={state.x.position}
            cy={state.y.secondary.position}
            r={4}
            color={colors.blue}
          />
          <Circle
            cx={state.x.position}
            cy={state.y.secondary.position}
            r={1.8}
            color={colors.card}
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
}: {
  state: PressState;
  dual: boolean;
  unit: string;
  containerWidth: SharedValue<number>;
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
      style={boxStyle}
      className="absolute left-0 top-0 items-center rounded-xl bg-ink px-3 py-1.5 shadow-sm"
    >
      <AnimatedTextInput
        editable={false}
        underlineColorAndroid="transparent"
        animatedProps={valueProps}
        style={{ padding: 0, margin: 0 }}
        className="text-[14px] font-bold text-card"
      />
      <AnimatedTextInput
        editable={false}
        underlineColorAndroid="transparent"
        animatedProps={tsProps}
        style={{ padding: 0, margin: 0 }}
        className="text-[10px] text-[#B9B7B2]"
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
  emptyMessage = 'No data for this range yet.',
}: Props) {
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

  const haptic = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
      () => undefined,
    );
  };

  useAnimatedReaction(
    () => state.isActive.value,
    (active, prev) => {
      if (active && prev === false) runOnJS(haptic)();
    },
  );

  const xLabel = rangeHours <= 24 ? hourLabel : dayLabel;
  const hasData = rows.length > 0;

  let body;
  if (loading) {
    body = (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color={colors.sub} />
      </View>
    );
  } else if (!hasData) {
    body = (
      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-center text-[13px] leading-[19px] text-sub">
          {emptyMessage}
        </Text>
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
          labelColor: colors.faint,
          lineWidth: 0,
          tickCount: 4,
          labelOffset: 6,
          formatXLabel: (t) => xLabel(t),
        }}
        yAxis={[
          {
            font: axisFont,
            labelColor: colors.faint,
            lineColor: colors.line,
            lineWidth: 1,
            tickCount: 4,
            labelOffset: 8,
            formatYLabel: (v) => String(Math.round(v)),
          },
        ]}
      >
        {({ points: pts, chartBounds }) => (
          <>
            <Area
              points={pts.value}
              y0={chartBounds.bottom}
              curveType="natural"
              animate={{ type: 'timing', duration: 400 }}
            >
              <LinearGradient
                start={vec(0, chartBounds.top)}
                end={vec(0, chartBounds.bottom)}
                colors={['rgba(232, 85, 77, 0.18)', 'rgba(232, 85, 77, 0)']}
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
                  colors={['rgba(77, 124, 232, 0.14)', 'rgba(77, 124, 232, 0)']}
                />
              </Area>
            ) : null}
            <ChartLine
              points={pts.value}
              color={colors.coral}
              strokeWidth={2.5}
              strokeCap="round"
              curveType="natural"
              animate={{ type: 'timing', duration: 400 }}
            />
            {dual ? (
              <ChartLine
                points={pts.secondary}
                color={colors.blue}
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
                  color={colors.coral}
                />
                {dual ? (
                  <Scatter
                    points={pts.secondary}
                    radius={4.5}
                    style="fill"
                    color={colors.blue}
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
        <View className="mb-2 mt-3 flex-row items-end justify-between">
          <View>
            <Text
              style={{ fontFamily: MONO }}
              className="text-[9px] uppercase tracking-[1px] text-faint"
            >
              Latest
            </Text>
            <View className="flex-row items-baseline">
              <Text className="text-[28px] font-bold leading-[32px] text-ink">
                {stats.latest}
              </Text>
              {unit ? (
                <Text className="ml-1.5 text-[13px] font-semibold text-sub">
                  {unit}
                </Text>
              ) : null}
            </View>
          </View>
          <View className="flex-row pb-1">
            <Stat label="Min" value={stats.min} />
            <Stat label="Avg" value={stats.avg} />
            <Stat label="Max" value={stats.max} />
          </View>
        </View>
      ) : null}
      <View
        style={{ height }}
        onLayout={(e) => {
          containerWidth.value = e.nativeEvent.layout.width;
        }}
      >
        {body}
        {hasData && !loading ? (
          <Tooltip
            state={state}
            dual={dual}
            unit={unit}
            containerWidth={containerWidth}
          />
        ) : null}
      </View>
    </View>
  );
}
