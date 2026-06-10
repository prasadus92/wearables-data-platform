import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
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
  weekDelta,
  type Metric,
  type Resolution,
  type Timeseries,
} from '@examplehealth/health-core'
import { api } from '../api'
import { TapButton } from './motion'
import { Skeleton } from '@/components/ui/skeleton'

interface Props {
  userId: string
  metric: Metric
  days: number
  resolution: Resolution
  /** Bumped by the SSE stream when new samples land; triggers a refetch. */
  liveVersion: number
  /** Whether the user has any active wearable connection; drives empty states. */
  hasDevices: boolean
  /** Scrolls/leads the user to the connect section. */
  onConnectDevice: () => void
  /** Triggers a manual sync for the freshly-connected case. */
  onSync: () => void
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

export function TimelineChart({
  userId,
  metric,
  days,
  resolution,
  liveVersion,
  hasDevices,
  onConnectDevice,
  onSync,
}: Props) {
  const [data, setData] = useState<Timeseries | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncRequested, setSyncRequested] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    async function load() {
      try {
        const series = await api.timeseries(userId, metric, resolution, days)
        if (!cancelled) {
          setData(series)
          if (series.points.length > 0) setSyncRequested(false)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    // SSE drives instant refreshes via liveVersion; the slow interval is a
    // fallback for proxies that buffer event streams.
    const interval = setInterval(load, 60_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [userId, metric, days, resolution, liveVersion])

  const meta = METRIC_META[metric]

  if (loading && !data) return <Skeleton className="h-[400px] w-full rounded-xl" />
  if (!data || data.points.length === 0)
    return (
      <div className="flex h-[400px] flex-col items-center justify-center gap-4 px-10 text-center">
        {hasDevices ? (
          <>
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">
                No {meta.friendlyName.toLowerCase()} here yet
              </span>
              <span className="text-sm text-muted-foreground">
                Your device is connected. New readings usually arrive within a couple of
                minutes, or pull them in now.
              </span>
            </div>
            <TapButton
              size="sm"
              disabled={syncRequested}
              onClick={() => {
                setSyncRequested(true)
                onSync()
                // Re-enable if nothing arrives: the provider cloud may simply
                // have no new readings, and a stuck button reads as a hang.
                setTimeout(() => setSyncRequested(false), 20_000)
              }}
            >
              {syncRequested ? 'Checking…' : 'Sync now'}
            </TapButton>
            {syncRequested && (
              <span className="text-xs text-muted-foreground">
                Asking the device's service for new readings. If nothing appears,
                the wearable has not synced to its phone app yet.
              </span>
            )}
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
      </div>
    )

  const isBloodPressure = metric === 'blood_pressure'
  const points = data.points.map((p) => ({
    ...p,
    label: new Date(p.ts).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      ...(resolution === 'hour' || resolution === 'raw'
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
        <div className="flex flex-col gap-0.5">
          {status && <span className="text-sm font-medium">{status}</span>}
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

      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={points} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={32} />
          <YAxis
            tick={{ fontSize: 11 }}
            domain={['auto', 'auto']}
            label={{ value: data.unit, angle: -90, position: 'insideLeft', fontSize: 11 }}
          />
          {meta.clinicalBand && (
            <ReferenceArea
              y1={meta.clinicalBand.min}
              y2={meta.clinicalBand.max}
              ifOverflow="extendDomain"
              fill="var(--chart-2)"
              fillOpacity={0.05}
              stroke="none"
              label={{
                value: meta.clinicalBand.label,
                position: 'insideTopRight',
                fontSize: 9,
                fill: 'var(--muted-foreground)',
              }}
            />
          )}
          {base && (
            <ReferenceArea
              y1={base.low}
              y2={base.high}
              ifOverflow="extendDomain"
              fill="var(--muted-foreground)"
              fillOpacity={0.06}
              stroke="none"
              label={{
                value: 'your typical range',
                position: 'insideBottomRight',
                fontSize: 9,
                fill: 'var(--muted-foreground)',
              }}
            />
          )}
          <Tooltip
            contentStyle={{
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
              fontSize: 12,
            }}
          />
          <Line
            type="monotone"
            dataKey="value"
            name={isBloodPressure ? 'systolic' : metric}
            stroke="var(--chart-1)"
            strokeWidth={2}
            dot={points.length < 60}
          />
          {isBloodPressure && (
            <Line
              type="monotone"
              dataKey="value_secondary"
              name="diastolic"
              stroke="var(--chart-2)"
              strokeWidth={2}
              dot={points.length < 60}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
