import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Line, Polyline, Text as SvgText } from 'react-native-svg';

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
}

const PAD = { top: 14, right: 12, bottom: 26, left: 44 };

interface XY {
  ts: number;
  value: number;
  secondary: number | null;
}

function toPath(pts: XY[], pick: (p: XY) => number | null, sx: (t: number) => number, sy: (v: number) => number): string {
  return pts
    .map((p) => {
      const v = pick(p);
      return v == null ? null : `${sx(p.ts).toFixed(1)},${sy(v).toFixed(1)}`;
    })
    .filter((s): s is string => s !== null)
    .join(' ');
}

export function LineChart({
  points,
  unit,
  dual = false,
  rangeHours,
  height = 220,
}: Props) {
  const [width, setWidth] = useState(0);

  const data: XY[] = points
    .map((p) => ({
      ts: new Date(p.ts).getTime(),
      value: p.value,
      secondary: p.value_secondary,
    }))
    .filter((p) => !Number.isNaN(p.ts))
    .sort((a, b) => a.ts - b.ts);

  const values = data.flatMap((p) =>
    dual && p.secondary != null ? [p.value, p.secondary] : [p.value],
  );

  let body = null;
  if (width > 0 && data.length > 0 && values.length > 0) {
    let lo = Math.min(...values);
    let hi = Math.max(...values);
    if (hi - lo < 1e-9) {
      lo -= 1;
      hi += 1;
    }
    const span = hi - lo;
    lo -= span * 0.1;
    hi += span * 0.1;

    const t0 = data[0].ts;
    const t1 = data[data.length - 1].ts;
    const tSpan = Math.max(1, t1 - t0);
    const plotW = width - PAD.left - PAD.right;
    const plotH = height - PAD.top - PAD.bottom;
    const sx = (t: number) => PAD.left + ((t - t0) / tSpan) * plotW;
    const sy = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * plotH;

    const yTicks = [0, 1, 2, 3].map((i) => lo + ((hi - lo) * i) / 3);
    const xTickTs =
      data.length === 1 ? [t0] : [t0, t0 + tSpan / 2, t1];
    const xLabel = rangeHours <= 24 ? hourLabel : dayLabel;

    body = (
      <Svg width={width} height={height}>
        {yTicks.map((v) => (
          <Line
            key={`g${v}`}
            x1={PAD.left}
            x2={width - PAD.right}
            y1={sy(v)}
            y2={sy(v)}
            stroke={colors.line}
            strokeWidth={1}
          />
        ))}
        {yTicks.map((v) => (
          <SvgText
            key={`y${v}`}
            x={PAD.left - 8}
            y={sy(v) + 4}
            fontSize={10}
            fill={colors.faint}
            textAnchor="end"
          >
            {Math.round(v)}
          </SvgText>
        ))}
        {xTickTs.map((t, i) => (
          <SvgText
            key={`x${t}-${i}`}
            x={sx(t)}
            y={height - 8}
            fontSize={10}
            fill={colors.faint}
            textAnchor={i === 0 ? 'start' : i === xTickTs.length - 1 ? 'end' : 'middle'}
          >
            {xLabel(t)}
          </SvgText>
        ))}
        <SvgText
          x={width - PAD.right}
          y={PAD.top - 2}
          fontSize={10}
          fill={colors.faint}
          textAnchor="end"
        >
          {unit}
        </SvgText>
        {data.length === 1 ? (
          <Line
            x1={sx(data[0].ts) - 3}
            x2={sx(data[0].ts) + 3}
            y1={sy(data[0].value)}
            y2={sy(data[0].value)}
            stroke={colors.coral}
            strokeWidth={6}
            strokeLinecap="round"
          />
        ) : (
          <Polyline
            points={toPath(data, (p) => p.value, sx, sy)}
            fill="none"
            stroke={colors.coral}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {dual && data.length > 1 ? (
          <Polyline
            points={toPath(data, (p) => p.secondary, sx, sy)}
            fill="none"
            stroke={colors.ink}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}
      </Svg>
    );
  }

  return (
    <View
      style={{ height }}
      onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
    >
      {body}
    </View>
  );
}
