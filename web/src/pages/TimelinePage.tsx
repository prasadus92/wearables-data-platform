import { Info } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Navigate,
  useNavigate,
  useOutletContext,
  useParams,
  useSearchParams,
} from 'react-router-dom'
import type { DashboardContext } from '../App'
import { METRIC_META, type Metric, type Resolution } from '@examplehealth/health-core'
import { api } from '../api'
import { springTransition } from '../components/motion'
import { TimelineChart } from '../components/TimelineChart'
import { providerDisplayName } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

const METRICS: { key: Metric; label: string }[] = (
  ['heartrate', 'hrv', 'spo2', 'respiratory_rate', 'blood_pressure'] as Metric[]
).map((key) => ({ key, label: METRIC_META[key].friendlyName }))

const RANGES: { label: string; days: number; resolution: Resolution }[] = [
  { label: '24h', days: 1, resolution: 'hour' },
  { label: '7d', days: 7, resolution: 'hour' },
  { label: '30d', days: 30, resolution: 'day' },
  { label: '90d', days: 90, resolution: 'week' },
]

const DEFAULT_RANGE = '7d'

/** Info button that explains the selected metric in plain language. */
function MetricInfoPopover({ metric }: { metric: Metric }) {
  const meta = METRIC_META[metric]
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          className="size-6 rounded-full p-0 text-muted-foreground hover:text-foreground"
          aria-label={`What is ${meta.friendlyName}?`}
        >
          <Info className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-80 flex-col gap-2">
        <span className="text-sm font-medium">{meta.friendlyName}</span>
        <p className="text-sm leading-relaxed text-popover-foreground/90">
          {meta.shortExplanation}
        </p>
        <p className="border-t pt-2 text-xs text-muted-foreground">
          This is informational, and no substitute for medical advice.
        </p>
      </PopoverContent>
    </Popover>
  )
}

/** Tiny dot beside the Timeline title; pings once per SSE update. */
function LivePulse({ version }: { version: number }) {
  return (
    <span className="relative flex size-2" aria-hidden="true">
      {version > 0 && (
        <motion.span
          key={version}
          className="absolute inset-0 rounded-full bg-emerald-500"
          initial={{ scale: 1, opacity: 0.7 }}
          animate={{ scale: 2.4, opacity: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
        />
      )}
      <span className="size-2 rounded-full bg-emerald-500/70" />
    </span>
  )
}

/**
 * The timeline view. The selected metric lives in the URL path and the range
 * in the ?range query param, so any view is shareable as a plain link.
 */
export function TimelinePage() {
  const { user, mode, devices, liveVersion, setError } = useOutletContext<DashboardContext>()
  const { metric: metricParam } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  // Sync-check state lives here, above the chart, because the chart remounts
  // on every metric/range switch (AnimatePresence key): the pending flag, its
  // 20s timeout, and the explainer all survive those switches.
  const [syncRequested, setSyncRequested] = useState(false)
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestSync = useCallback(async () => {
    setSyncRequested(true)
    if (syncTimer.current) clearTimeout(syncTimer.current)
    // Re-enable if nothing arrives: the provider cloud may simply have no new
    // readings, and a stuck button reads as a hang.
    syncTimer.current = setTimeout(() => setSyncRequested(false), 20_000)
    try {
      await api.sync(user.id)
    } catch (e) {
      setError(String(e))
    }
  }, [user.id, setError])
  const resolveSync = useCallback(() => {
    if (syncTimer.current) {
      clearTimeout(syncTimer.current)
      syncTimer.current = null
    }
    setSyncRequested(false)
  }, [])
  useEffect(
    () => () => {
      if (syncTimer.current) clearTimeout(syncTimer.current)
    },
    [],
  )

  // Unknown metric slugs land on heart rate, keeping any range selection.
  if (!metricParam || !(metricParam in METRIC_META)) {
    return (
      <Navigate
        to={{ pathname: '/metrics/heartrate', search: searchParams.toString() }}
        replace
      />
    )
  }
  const metric = metricParam as Metric

  const rangeParam = searchParams.get('range') ?? DEFAULT_RANGE
  const matched = RANGES.findIndex((r) => r.label === rangeParam)
  const range = matched === -1 ? RANGES.findIndex((r) => r.label === DEFAULT_RANGE) : matched

  const activeDevices = devices.filter((d) => d.status !== 'disconnected')

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springTransition}
    >
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-mono text-xs font-medium tracking-widest text-muted-foreground uppercase">
            Timeline
            <LivePulse version={liveVersion} />
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-1.5">
              <Tabs
                value={metric}
                onValueChange={(v) =>
                  navigate({ pathname: `/metrics/${v}`, search: searchParams.toString() })
                }
              >
                <TabsList className="h-auto flex-wrap">
                {METRICS.map((m) => (
                  <TabsTrigger
                    key={m.key}
                    value={m.key}
                    className="data-[state=active]:bg-transparent group-data-[variant=default]/tabs-list:data-[state=active]:shadow-none dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-transparent"
                  >
                    {metric === m.key && (
                      <motion.span
                        layoutId="metric-tab-pill"
                        className="absolute inset-0 rounded-md bg-background shadow-sm dark:border dark:border-input dark:bg-input/30"
                        transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                      />
                    )}
                    <span className="relative z-10">{m.label}</span>
                  </TabsTrigger>
                ))}
                </TabsList>
              </Tabs>
              <MetricInfoPopover metric={metric} />
            </div>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={RANGES[range].label}
              onValueChange={(v) => {
                if (!v) return
                const next = new URLSearchParams(searchParams)
                next.set('range', v)
                setSearchParams(next)
              }}
            >
              {RANGES.map((r) => (
                <ToggleGroupItem
                  key={r.label}
                  value={r.label}
                  className="px-3 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                >
                  {r.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={`${metric}-${range}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
              <TimelineChart
                userId={user.id}
                metric={metric}
                days={RANGES[range].days}
                resolution={RANGES[range].resolution}
                liveVersion={liveVersion}
                hasDevices={activeDevices.length > 0}
                providerNames={activeDevices.map((d) => providerDisplayName(d.provider))}
                providerSlugs={activeDevices.map((d) => d.provider)}
                demoMode={mode === 'sandbox'}
                onShowMetric={(m) =>
                  navigate({ pathname: `/metrics/${m}`, search: searchParams.toString() })
                }
                rangeLabel={RANGES[range].label}
                onConnectDevice={() => navigate('/devices')}
                onShowRange={(label) => {
                  const next = new URLSearchParams(searchParams)
                  next.set('range', label)
                  setSearchParams(next)
                }}
                syncRequested={syncRequested}
                onSync={requestSync}
                onSyncResolved={resolveSync}
              />
            </motion.div>
          </AnimatePresence>
        </CardContent>
      </Card>
    </motion.div>
  )
}
