import { useEffect, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api, type Metric, type Resolution, type Timeseries } from '../api'
import { Skeleton } from '@/components/ui/skeleton'

interface Props {
  userId: string
  metric: Metric
  days: number
  resolution: Resolution
  /** Bumped by the SSE stream when new samples land; triggers a refetch. */
  liveVersion: number
}

export function TimelineChart({ userId, metric, days, resolution, liveVersion }: Props) {
  const [data, setData] = useState<Timeseries | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    async function load() {
      try {
        const series = await api.timeseries(userId, metric, resolution, days)
        if (!cancelled) setData(series)
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

  if (loading && !data) return <Skeleton className="h-[320px] w-full rounded-xl" />
  if (!data || data.points.length === 0)
    return (
      <div className="flex h-[320px] items-center justify-center px-10 text-center text-sm text-muted-foreground">
        No {metric.replace('_', ' ')} data in this range yet. Connect a device and data will
        appear as Junction delivers it.
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

  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={points} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={32} />
        <YAxis
          tick={{ fontSize: 11 }}
          domain={['auto', 'auto']}
          label={{ value: data.unit, angle: -90, position: 'insideLeft', fontSize: 11 }}
        />
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
  )
}
