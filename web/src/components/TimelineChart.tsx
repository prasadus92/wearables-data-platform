import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  baseline,
  latestStatus,
  METRIC_META,
  metricSupported,
  weekDelta,
  type Metric,
  type Resolution,
  type Timeseries,
} from '@youth/health-core'
import { api } from '../api'
import { EmptyState } from './EmptyState'
import { TapButton } from './motion'
import { useTheme } from './ThemeProvider'
import { Skeleton } from '@/components/ui/skeleton'
import { CHART_THEMES } from '@/lib/chartTheme'
import { formatNameList } from '@/lib/utils'

interface Props {
  userId: string
  metric: Metric
  days: number
  resolution: Resolution
  /** Bumped by the SSE stream when new samples land; triggers a refetch. */
  liveVersion: number
  /** Whether the user has any active wearable connection; drives empty states. */
  hasDevices: boolean
  /** Display names of the active connections, for the waiting empty state. */
  providerNames: string[]
  /** Provider slugs of the active connections, for metric capability checks. */
  providerSlugs: string[]
  /** Demo connections deliver a narrower metric set than real devices. */
  demoMode: boolean
  /** Restrict the series to one device; undefined means all devices. */
  provider?: string
  /** Switches the metric tab when the current one cannot have data. */
  onShowMetric: (metric: Metric) => void
  /** Label of the selected range ("7d"), for the out-of-range empty state. */
  rangeLabel: string
  /** Scrolls/leads the user to the connect section. */
  onConnectDevice: () => void
  /** Switches the range param when data exists outside the current window. */
  onShowRange: (label: string) => void
  /** Sync-check state lives in the page so it survives chart remounts. */
  syncRequested: boolean
  /** Triggers a manual sync for the freshly-connected case. */
  onSync: () => void
  /** Reports that in-range readings arrived, ending any pending sync check. */
  onSyncResolved: () => void
  /** Drill into one day when an aggregated point is clicked. */
  onDrillDay?: (dayIso: string) => void
  /** When set, the chart shows this single day hour by hour. */
  anchorDay?: string
}

/** Plain relative age for the out-of-range empty state: "16 days ago". */
function relativeAge(ts: string): string {
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`
  const minutes = Math.max(1, Math.round((Date.now() - new Date(ts).getTime()) / 60000))
  if (minutes < 60) return plural(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (hours < 48) return plural(hours, 'hour')
  return plural(Math.round(hours / 24), 'day')
}

/** Small arrow chip for the 7-day vs prior 7-day change. Neutral styling on
 * purpose: a rising heart rate is not "bad" and a rising HRV is not "good"
 * enough to color-code without misleading. */
function DeltaChip({ delta }: { delta: number }) {
  const rising = delta >= 0
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2 py-0.5 text-xs font-medium text-muted-foreground"
      title="Average of the last 7 days compared with the 7 days before"
    >
      <svg
        viewBox="0 0 12 12"
        className={`size-3 ${rising ? '' : 'rotate-180'}`}
        aria-hidden="true"
      >
        <path d="M6 2.5 L10 8 H2 Z" fill="currentColor" />
      </svg>
      {rising ? '+' : ''}
      {delta.toFixed(1)}% vs prior week
    </span>
  )
}

/** Small-screen flag, media-query driven so resizes track live. */
function useCompact(): boolean {
  const [compact, setCompact] = useState(
    () => window.matchMedia('(max-width: 640px)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)')
    const onChange = (e: MediaQueryListEvent) => setCompact(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return compact
}

export function TimelineChart({
  userId,
  metric,
  days,
  resolution,
  liveVersion,
  hasDevices,
  providerNames,
  providerSlugs,
  demoMode,
  provider,
  onShowMetric,
  rangeLabel,
  onConnectDevice,
  onShowRange,
  syncRequested,
  onSync,
  onSyncResolved,
  onDrillDay,
  anchorDay,
}: Props) {
  // All per-mode chart colors come from one theme-keyed lookup; nothing in
  // the JSX below branches on the mode by hand.
  const chart = CHART_THEMES[useTheme().resolved]
  const compact = useCompact()
  const [data, setData] = useState<Timeseries | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  // Out-of-range probe: when the in-range query is empty but the user has
  // devices, one wide query (90d, day buckets) checks whether data exists
  // outside the window so the empty state can say so instead of going blank.
  const [probe, setProbe] = useState<
    { state: 'idle' | 'pending' | 'empty' } | { state: 'found'; latestTs: string }
  >({ state: 'idle' })

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    async function load() {
      try {
        const series = anchorDay
          ? await api.timeseriesDay(userId, metric, anchorDay, provider)
          : await api.timeseries(userId, metric, resolution, days, provider)
        if (!cancelled) {
          setData(series)
          setFailed(false)
          if (series.points.length > 0) onSyncResolved()
        }
      } catch {
        // A failed request must surface as a retryable error, never as an
        // eternal skeleton. Keep any previously loaded series on screen.
        if (!cancelled) setFailed(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    // SSE drives instant refreshes via liveVersion; the interval is the
    // fallback. While the series is empty (fresh demo wearable, first sync)
    // poll fast so the chart fills without any user action.
    const interval = setInterval(load, data && data.points.length > 0 ? 60_000 : 8_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, metric, days, resolution, provider, anchorDay, liveVersion, onSyncResolved, data == null || data.points.length === 0])

  const inRangeEmpty = !loading && data != null && data.points.length === 0

  // The probe must not depend on its own state or have a cancelling cleanup:
  // setting `pending` inside the effect would re-run it, fire the previous
  // run's cleanup, and discard the fetch result, leaving the skeleton up
  // forever. An in-flight ref guards instead; the component remounts per
  // metric/range, so each chart instance probes at most once.
  const probeInFlight = useRef(false)
  useEffect(() => {
    if (anchorDay) return
    if (!inRangeEmpty || !hasDevices || probe.state !== 'idle' || probeInFlight.current) return
    if (!metricSupported(metric, providerSlugs, { demo: demoMode })) {
      // Nothing connected can produce this metric; skip the wide probe so
      // the capability empty state renders without a wasted round trip.
      setProbe({ state: 'empty' })
      return
    }
    probeInFlight.current = true
    setProbe({ state: 'pending' })
    api
      .timeseries(userId, metric, 'day', 90, provider)
      .then((wide) => {
        const last = wide.points[wide.points.length - 1]
        setProbe(last ? { state: 'found', latestTs: last.ts } : { state: 'empty' })
      })
      .catch(() => {
        // On probe failure fall back to the connected-but-waiting copy.
        setProbe({ state: 'empty' })
      })
      .finally(() => {
        probeInFlight.current = false
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inRangeEmpty, hasDevices, userId, metric])

  const meta = METRIC_META[metric]

  if (loading && !data) return <Skeleton className="h-[400px] w-full rounded-xl" />
  if (anchorDay && data && data.points.length === 0) {
    return (
      <EmptyState className="h-[400px]">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">No readings within this day</span>
          <span className="text-sm text-muted-foreground">
            The selected source recorded nothing on this calendar day.
          </span>
        </div>
      </EmptyState>
    )
  }
  if (failed && !data) {
    return (
      <EmptyState className="h-[400px]">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">Could not load this chart</span>
          <span className="text-sm text-muted-foreground">
            The connection hiccuped. Your data is safe; try again.
          </span>
        </div>
        <TapButton
          size="sm"
          onClick={() => {
            setFailed(false)
            setLoading(true)
            api
              .timeseries(userId, metric, resolution, days)
              .then((series) => {
                setData(series)
                if (series.points.length > 0) onSyncResolved()
              })
              .catch(() => setFailed(true))
              .finally(() => setLoading(false))
          }}
        >
          Retry
        </TapButton>
      </EmptyState>
    )
  }
  if (!data || data.points.length === 0) {
    // The wide probe decides which empty state applies; hold the skeleton
    // until it answers so the copy never flickers between explanations.
    if (hasDevices && (probe.state === 'idle' || probe.state === 'pending'))
      return <Skeleton className="h-[400px] w-full rounded-xl" />

    if (hasDevices && probe.state === 'found') {
      // Data exists outside the selected window: say so and offer the
      // narrowest range that contains the latest reading.
      const latestAge = Date.now() - new Date(probe.latestTs).getTime()
      const target = latestAge > 30 * 24 * 3600 * 1000 ? '90d' : '30d'
      return (
        <EmptyState className="h-[400px]">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">
              No readings in the last {rangeLabel}
            </span>
            <span className="text-sm text-muted-foreground">
              Your latest data is from {relativeAge(probe.latestTs)}.
            </span>
          </div>
          <TapButton size="sm" onClick={() => onShowRange(target)}>
            Show last {target}
          </TapButton>
        </EmptyState>
      )
    }

    if (hasDevices && !metricSupported(metric, providerSlugs, { demo: demoMode })) {
      // Nothing connected can ever produce this metric; offering a sync here
      // would be a dead end. Say what measures it instead.
      return (
        <EmptyState className="h-[400px]">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">
              {demoMode
                ? `Demo wearables do not include ${meta.friendlyName.toLowerCase()}`
                : `None of your devices measures ${meta.friendlyName.toLowerCase()} yet`}
            </span>
            <span className="max-w-md text-sm text-muted-foreground">
              {demoMode
                ? 'Demo data covers heart rate, heart rate variability, and blood oxygen. Real devices deliver the rest.'
                : metric === 'blood_pressure'
                  ? 'Blood pressure usually comes from a smart cuff, or from readings logged in Apple Health on your phone.'
                  : 'Connect a device that measures it and readings flow in automatically.'}
            </span>
          </div>
          {demoMode ? (
            <TapButton size="sm" onClick={() => onShowMetric('heartrate')}>
              See heart rate instead
            </TapButton>
          ) : (
            <TapButton size="sm" onClick={onConnectDevice}>
              Connect a device
            </TapButton>
          )}
        </EmptyState>
      )
    }

    return (
      <EmptyState className="h-[400px]">
        {hasDevices ? (
          <>
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">
                No {meta.friendlyName.toLowerCase()} here yet
              </span>
              <span className="max-w-md text-sm text-muted-foreground">
                {demoMode
                  ? `${formatNameList(providerNames) || 'Your demo wearable'} connected. The first readings are being generated and usually land within a couple of minutes; the chart fills in by itself.`
                  : `${formatNameList(providerNames) || 'Your device'} connected. We are waiting for the wearable to sync with its phone app; readings appear here automatically the moment it does.`}
              </span>
            </div>
            <TapButton size="sm" disabled={syncRequested} onClick={onSync}>
              {syncRequested ? 'Checking…' : 'Sync now'}
            </TapButton>
            {/* Fixed-height slot so the explainer never shifts the layout. */}
            <span className="flex h-12 max-w-sm items-start justify-center text-xs text-muted-foreground">
              {syncRequested
                ? "Asking the device's service for new readings. If nothing appears, the wearable has not synced to its phone app yet."
                : ''}
            </span>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">
                Your {meta.friendlyName.toLowerCase()} will live here
              </span>
              <span className="text-sm text-muted-foreground">
                Connect a wearable once and your readings flow in automatically, day and
                night.
              </span>
            </div>
            <TapButton size="sm" onClick={onConnectDevice}>
              Connect a device
            </TapButton>
          </>
        )}
      </EmptyState>
    )
  }

  const isBloodPressure = metric === 'blood_pressure'
  const points = data.points.map((p) => ({
    ...p,
    label: new Date(p.ts).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      ...(anchorDay || resolution === 'hour' || resolution === 'raw'
        ? { hour: '2-digit', minute: '2-digit' }
        : {}),
    }),
  }))

  const base = baseline(data.points)
  const status = latestStatus(data.points, base, meta.goodDirection)
  const delta = weekDelta(data.points, new Date())

  const latest = data.points[data.points.length - 1]
  const formatValue = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1))
  const latestDisplay =
    isBloodPressure && latest.value_secondary != null
      ? `${formatValue(latest.value)}/${formatValue(latest.value_secondary)}`
      : formatValue(latest.value)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="flex flex-col gap-1">
          {status && (
            <span className="font-mono text-[11px] font-medium tracking-widest text-muted-foreground uppercase">
              {status}
            </span>
          )}
          {!provider && providerNames.length > 1 && (
            <span className="font-mono text-[10px] tracking-widest text-muted-foreground/70 uppercase">
              Averaged across {formatNameList(providerNames)}
            </span>
          )}
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={latestDisplay}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className="text-3xl font-semibold tracking-tight tabular-nums"
            >
              {latestDisplay}
              <span className="ml-1.5 text-sm font-normal text-muted-foreground">
                {meta.unitLabel}
              </span>
            </motion.span>
          </AnimatePresence>
        </div>
        {delta != null && <DeltaChip delta={delta} />}
      </div>

      {/* Phones: the plot reclaims the card's horizontal padding, the same
          full-bleed-inside-the-card treatment the mobile app uses. */}
      <div className={compact ? '-mr-5' : undefined}>
      <ResponsiveContainer width="100%" height={compact ? 300 : 320}>
        <ComposedChart
          data={points}
          margin={{ top: 8, right: compact ? 4 : 16, bottom: 4, left: compact ? -14 : 0 }}
          onClick={(state) => {
            // Day-bucket points drill into their day; finer resolutions are
            // already the drill target.
            if (anchorDay || resolution !== 'day' || !onDrillDay) return
            const idx = state && (state as { activeTooltipIndex?: number }).activeTooltipIndex
            if (idx == null || idx < 0 || idx >= points.length) return
            onDrillDay(points[idx].ts)
          }}
          style={resolution === 'day' && onDrillDay ? { cursor: 'pointer' } : undefined}
        >
          <defs>
            {/* Soft fill under the primary line; transparent stops in light
                keep the editorial plain-line look without branching JSX. */}
            <linearGradient id="timeline-fill" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                stopColor={chart.fillFrom}
                stopOpacity={chart.fillFromOpacity}
              />
              <stop
                offset="100%"
                stopColor={chart.fillFrom}
                stopOpacity={chart.fillToOpacity}
              />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: chart.axis }}
            stroke={chart.grid}
            minTickGap={32}
          />
          <YAxis
            tick={{ fontSize: compact ? 10 : 11, fill: chart.axis }}
            stroke={chart.grid}
            domain={['auto', 'auto']}
            width={compact ? 40 : 60}
            label={
              compact
                ? undefined
                : {
                    value: data.unit,
                    angle: -90,
                    position: 'insideLeft',
                    fontSize: 11,
                    fill: chart.axis,
                  }
            }
          />
          {meta.clinicalBand && (
            <ReferenceArea
              y1={meta.clinicalBand.min}
              y2={meta.clinicalBand.max}
              ifOverflow="extendDomain"
              fill={chart.clinicalBand}
              fillOpacity={chart.clinicalBandOpacity}
              stroke="none"
              label={{
                value: meta.clinicalBand.label,
                position: 'insideTopRight',
                fontSize: 9,
                fill: chart.bandLabel,
              }}
            />
          )}
          {base && (
            <ReferenceArea
              y1={base.low}
              y2={base.high}
              ifOverflow="extendDomain"
              fill={chart.typicalBand}
              fillOpacity={chart.typicalBandOpacity}
              stroke="none"
              label={{
                value: 'your typical range',
                position: meta.clinicalBand ? 'insideBottomLeft' : 'insideBottomRight',
                fontSize: 9,
                fill: chart.bandLabel,
              }}
            />
          )}
          <Tooltip contentStyle={chart.tooltip} />
          <Area
            type="monotone"
            dataKey="value"
            name={isBloodPressure ? 'systolic' : meta.friendlyName}
            stroke={chart.line}
            strokeWidth={2}
            fill="url(#timeline-fill)"
            dot={points.length < 60 ? { fill: chart.line, strokeWidth: 0, r: 2.5 } : false}
            activeDot={{ r: 4 }}
          />
          {isBloodPressure && (
            <Line
              type="monotone"
              dataKey="value_secondary"
              name="diastolic"
              stroke={chart.lineSecondary}
              strokeWidth={2}
              dot={points.length < 60}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      </div>
    </div>
  )
}
