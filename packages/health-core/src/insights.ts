// Pure, unit-test-grade helpers that turn raw timeseries points into plain
// language insights. No Date.now() or other ambient state in here; callers
// pass "now" in where time matters. Wording stays strictly neutral and
// descriptive: these functions report position relative to the user's own
// data, never a judgement about health.

import type { TimeseriesPoint } from './api-types';
import type { GoodDirection } from './metrics';

export interface Baseline {
  mean: number;
  low: number;
  high: number;
}

const MS_PER_DAY = 24 * 3600 * 1000;

/**
 * Personal baseline as mean +/- 1 standard deviation of the primary values.
 * Returns null with fewer than 5 points, where a band would be noise.
 */
export function baseline(points: TimeseriesPoint[]): Baseline | null {
  if (points.length < 5) return null;
  const values = points.map((p) => p.value);
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  const stddev = Math.sqrt(variance);
  return { mean, low: mean - stddev, high: mean + stddev };
}

/**
 * One short neutral sentence placing the latest reading against the personal
 * baseline. The wording never implies a value is good or bad. The direction
 * parameter is accepted to keep the call signature stable for both clients;
 * the current copy is direction-neutral and does not read it.
 */
export function latestStatus(
  points: TimeseriesPoint[],
  base: Baseline | null,
  _goodDirection: GoodDirection,
): string | null {
  if (points.length === 0) return null;
  if (!base) return 'Collecting data to learn your typical range';
  const latest = points[points.length - 1].value;
  if (latest >= base.low && latest <= base.high) {
    return 'Within your typical range';
  }
  const pct =
    base.mean !== 0
      ? Math.round(((latest - base.mean) / Math.abs(base.mean)) * 100)
      : 0;
  // A value can sit just outside the band while rounding to 0% from the
  // mean; a "(+0%)" callout reads as a bug, so omit it.
  if (latest > base.high) {
    return pct > 0 ? `Above your typical range (+${pct}%)` : 'Above your typical range';
  }
  return pct < 0 ? `Below your typical range (${pct}%)` : 'Below your typical range';
}

/**
 * Percent change of the mean of the most recent 7 days vs the 7 days before
 * that. Only defined when the data actually spans 14 or more days; otherwise
 * null. "now" is the end of the window, passed in for purity.
 */
export function weekDelta(points: TimeseriesPoint[], now: Date): number | null {
  if (points.length === 0) return null;
  const nowMs = now.getTime();
  const timestamps = points.map((p) => new Date(p.ts).getTime());
  const spanDays = (nowMs - Math.min(...timestamps)) / MS_PER_DAY;
  if (spanDays < 14) return null;

  const weekAgo = nowMs - 7 * MS_PER_DAY;
  const twoWeeksAgo = nowMs - 14 * MS_PER_DAY;

  const recent: number[] = [];
  const prior: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const ts = timestamps[i];
    if (ts >= weekAgo) recent.push(points[i].value);
    else if (ts >= twoWeeksAgo) prior.push(points[i].value);
  }
  if (recent.length === 0 || prior.length === 0) return null;

  const recentMean = recent.reduce((sum, v) => sum + v, 0) / recent.length;
  const priorMean = prior.reduce((sum, v) => sum + v, 0) / prior.length;
  if (priorMean === 0) return null;
  return ((recentMean - priorMean) / Math.abs(priorMean)) * 100;
}
