import { Info } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
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
  const { user, devices, liveVersion, setError } = useOutletContext<DashboardContext>()
  const { metric: metricParam } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

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
                hasDevices={devices.some((d) => d.status !== 'disconnected')}
                onConnectDevice={() => navigate('/devices')}
                onSync={async () => {
                  try {
                    await api.sync(user.id)
                  } catch (e) {
                    setError(String(e))
                  }
                }}
              />
            </motion.div>
          </AnimatePresence>
        </CardContent>
      </Card>
    </motion.div>
  )
}
