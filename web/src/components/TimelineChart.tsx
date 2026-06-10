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

interface Props {
  userId: string
  metric: Metric
  days: number
  resolution: Resolution
}

export function TimelineChart({ userId, metric, days, resolution }: Props) {
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
    const interval = setInterval(load, 30_000) // new webhook data appears live
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [userId, metric, days, resolution])

  if (loading && !data) return <div className="chart-empty">Loading…</div>
  if (!data || data.points.length === 0)
    return (
      <div className="chart-empty">
        No {metric.replace('_', ' ')} data in this range yet. Connect a device and data will
        appear as Aggregator delivers it.
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
        <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={32} />
        <YAxis
          tick={{ fontSize: 11 }}
          domain={['auto', 'auto']}
          label={{ value: data.unit, angle: -90, position: 'insideLeft', fontSize: 11 }}
        />
        <Tooltip />
        <Line
          type="monotone"
          dataKey="value"
          name={isBloodPressure ? 'systolic' : metric}
          stroke="#e8554d"
          strokeWidth={2}
          dot={points.length < 60}
        />
        {isBloodPressure && (
          <Line
            type="monotone"
            dataKey="value_secondary"
            name="diastolic"
            stroke="#4d7ce8"
            strokeWidth={2}
            dot={points.length < 60}
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  )
}
