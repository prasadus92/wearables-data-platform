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
import { METRIC_META, type Metric, type Resolution } from '@youth/health-core'
import { api } from '../api'
import { springTransition } from '../components/motion'
import { TimelineChart } from '../components/TimelineChart'
import { providerDisplayName } from '@/lib/utils'
import { Chip } from '../components/Chip'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

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
const RANGE_KEY = 'youth-wearables-range'

/** Last-used range survives metric switches (URL param) and reloads
 * (localStorage), so picking 90d once means 90d everywhere until changed. */
function rememberedRange(): string {
  try {
    return localStorage.getItem(RANGE_KEY) ?? DEFAULT_RANGE
  } catch {
    return DEFAULT_RANGE
  }
}

function rememberRange(label: string): void {
  try {
    localStorage.setItem(RANGE_KEY, label)
  } catch {
    // Private windows can refuse storage; the URL param still works.
  }
}

/** Info button that explains the selected metric in plain language. A
 * centered dialog rather than an anchored popover: popper positioning
 * proved unreliable here (content stuck at its placeholder coordinates),
 * and a dialog reads better at phone widths anyway. */
function MetricInfoPopover({ metric }: { metric: Metric }) {
  const meta = METRIC_META[metric]
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        variant="ghost"
        size="xs"
        className="size-6 rounded-full p-0 text-muted-foreground hover:text-foreground"
        aria-label={`What is ${meta.friendlyName}?`}
        onClick={() => setOpen(true)}
      >
        <Info className="size-3.5" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{meta.friendlyName}</DialogTitle>
          </DialogHeader>
          <p className="text-sm leading-relaxed">{meta.shortExplanation}</p>
          <p className="border-t pt-3 text-xs text-muted-foreground">
            This is informational, and no substitute for medical advice.
          </p>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Tiny dot beside the Timeline title; pings once per SSE update. */
function LivePulse({ version }: { version: number }) {
  return (
    <span className="relative flex size-2" aria-hidden="true">
      {version > 0 && (
        <motion.span
          key={version}
          className="absolute inset-0 rounded-full bg-good"
          initial={{ scale: 1, opacity: 0.7 }}
          animate={{ scale: 2.4, opacity: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
        />
      )}
      <span className="size-2 rounded-full bg-good/70" />
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
      // The ask never went out, so there is nothing to wait for: reset the
      // button right away instead of holding "Checking" for the full 20s.
      setError(String(e))
      if (syncTimer.current) {
        clearTimeout(syncTimer.current)
        syncTimer.current = null
      }
      setSyncRequested(false)
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

  const rangeParam = searchParams.get('range') ?? rememberedRange()
  const matched = RANGES.findIndex((r) => r.label === rangeParam)
  const range = matched === -1 ? RANGES.findIndex((r) => r.label === DEFAULT_RANGE) : matched

  const activeDevices = devices?.filter((d) => d.status !== 'disconnected') ?? null

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springTransition}
    >
      <Card className="chart-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-mono text-xs font-medium tracking-widest text-muted-foreground uppercase">
            Timeline
            <LivePulse version={liveVersion} />
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2.5">
            {/* Independent chips in a scrollable row, like the mobile home;
                the info icon stays pinned outside the scroll area. */}
            <div className="flex min-w-0 items-center gap-1.5">
              <div className="chip-row -my-1 flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-1">
                {METRICS.map((m) => (
                  <Chip
                    key={m.key}
                    label={m.label}
                    active={metric === m.key}
                    onClick={() =>
                      navigate({
                        pathname: `/metrics/${m.key}`,
                        search: searchParams.toString(),
                      })
                    }
                  />
                ))}
              </div>
              <MetricInfoPopover metric={metric} />
            </div>
            <div className="chip-row -my-1 flex items-center gap-2 overflow-x-auto py-1">
              {RANGES.map((r) => (
                <Chip
                  key={r.label}
                  label={r.label}
                  small
                  active={RANGES[range].label === r.label}
                  onClick={() => {
                    rememberRange(r.label)
                    const next = new URLSearchParams(searchParams)
                    next.set('range', r.label)
                    setSearchParams(next)
                  }}
                />
              ))}
            </div>
          </div>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={`${metric}-${range}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
              {activeDevices === null ? (
                <Skeleton className="h-[400px] w-full rounded-xl" />
              ) : (
              <TimelineChart
                userId={user.id}
                metric={metric}
                days={RANGES[range].days}
                resolution={RANGES[range].resolution}
                liveVersion={liveVersion}
                hasDevices={activeDevices !== null && activeDevices.length > 0}
                providerNames={(activeDevices ?? []).map((d) => providerDisplayName(d.provider))}
                providerSlugs={(activeDevices ?? []).map((d) => d.provider)}
                demoMode={mode === 'sandbox'}
                onShowMetric={(m) =>
                  navigate({ pathname: `/metrics/${m}`, search: searchParams.toString() })
                }
                rangeLabel={RANGES[range].label}
                onConnectDevice={() => navigate('/devices')}
                onShowRange={(label) => {
                  rememberRange(label)
                  const next = new URLSearchParams(searchParams)
                  next.set('range', label)
                  setSearchParams(next)
                }}
                syncRequested={syncRequested}
                onSync={requestSync}
                onSyncResolved={resolveSync}
              />
              )}
            </motion.div>
          </AnimatePresence>
        </CardContent>
      </Card>
    </motion.div>
  )
}
