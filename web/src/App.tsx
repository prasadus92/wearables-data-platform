import { AlertCircle, Info } from 'lucide-react'
import { AnimatePresence, motion, MotionConfig } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  api,
  streamUrl,
  type Device,
  type AggregatorEnv,
  type Metric,
  type Resolution,
  type User,
} from './api'
import { DevicePanel } from './components/DevicePanel'
import { springTransition, TapButton } from './components/motion'
import { TimelineChart } from './components/TimelineChart'
import { METRIC_META } from './lib/metrics'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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

// One session per environment, so Demo and Live coexist and switching is
// instant. Demo (sandbox) offers synthetic wearables; Live (production)
// connects real devices over real provider OAuth.
const MODE_KEY = 'wearables-mode'
const userKey = (env: AggregatorEnv) => `wearables-user:${env}`

function loadUser(env: AggregatorEnv): User | null {
  // Migrate the pre-mode single-session key into the sandbox slot.
  const legacy = localStorage.getItem('wearables-user')
  if (legacy && env === 'sandbox' && !localStorage.getItem(userKey('sandbox'))) {
    localStorage.setItem(userKey('sandbox'), legacy)
    localStorage.removeItem('wearables-user')
  }
  const saved = localStorage.getItem(userKey(env))
  return saved ? JSON.parse(saved) : null
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: AggregatorEnv
  onChange: (m: AggregatorEnv) => void
}) {
  return (
    <ToggleGroup
      type="single"
      size="sm"
      variant="outline"
      value={mode}
      onValueChange={(v) => {
        if (v) onChange(v as AggregatorEnv)
      }}
      aria-label="Data environment"
    >
      <ToggleGroupItem
        value="sandbox"
        className="px-3 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
      >
        Demo
      </ToggleGroupItem>
      <ToggleGroupItem
        value="production"
        className="px-3 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
      >
        Live
      </ToggleGroupItem>
    </ToggleGroup>
  )
}

// Entrance choreography: parents stagger, children rise gently into place.
const staggerParent = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07 } },
}

const riseIn = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: springTransition },
}

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

export default function App() {
  const [mode, setMode] = useState<AggregatorEnv>(
    () => (localStorage.getItem(MODE_KEY) as AggregatorEnv) || 'sandbox',
  )
  const [sessions, setSessions] = useState<Record<AggregatorEnv, User | null>>(() => ({
    sandbox: loadUser('sandbox'),
    production: loadUser('production'),
  }))
  const user = sessions[mode]
  const [devices, setDevices] = useState<Device[]>([])
  const [metric, setMetric] = useState<Metric>('heartrate')
  const [range, setRange] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [showExisting, setShowExisting] = useState(false)
  const [existingId, setExistingId] = useState('')
  const [busy, setBusy] = useState(false)
  // Bumped by SSE updates; charts refetch when it changes.
  const [liveVersion, setLiveVersion] = useState(0)
  const devicesRef = useRef<HTMLDivElement>(null)

  const refreshDevices = useCallback(async () => {
    if (!user) return
    try {
      setDevices(await api.listDevices(user.id))
    } catch (e) {
      setError(String(e))
    }
  }, [user])

  // Devices poll keeps connection status + "last synced" fresh while
  // Aggregator webhooks land in the background.
  useEffect(() => {
    refreshDevices()
    const interval = setInterval(refreshDevices, 15_000)
    return () => clearInterval(interval)
  }, [refreshDevices])

  // Live updates: the backend streams an SSE event whenever new samples are
  // ingested, so charts refresh the moment a Aggregator webhook is processed.
  useEffect(() => {
    if (!user) return
    const source = new EventSource(streamUrl(user.id))
    source.addEventListener('update', () => {
      setLiveVersion((v) => v + 1)
      refreshDevices()
    })
    return () => source.close()
  }, [user, refreshDevices])

  // Identity is an implementation detail: generate it silently, or attach to
  // a known client_user_id (backend create is idempotent and returns it).
  async function connectAs(clientUserId: string) {
    setError(null)
    setBusy(true)
    try {
      const created = await api.createUser(clientUserId, mode)
      localStorage.setItem(userKey(mode), JSON.stringify(created))
      setSessions((s) => ({ ...s, [mode]: created }))
      setDevices([])
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  function switchMode(next: AggregatorEnv) {
    setMode(next)
    localStorage.setItem(MODE_KEY, next)
    setDevices([])
    setError(null)
  }

  if (!user) {
    return (
      <MotionConfig reducedMotion="user">
        <motion.div
          variants={staggerParent}
          initial="hidden"
          animate="show"
          className="mx-auto mt-[18vh] flex max-w-md flex-col items-center gap-4 px-5 text-center"
        >
          <motion.h1 variants={riseIn} className="text-2xl font-semibold tracking-tight">
            ExampleHealth Wearables
          </motion.h1>
          <motion.p variants={riseIn} className="text-sm text-muted-foreground">
            {mode === 'sandbox'
              ? 'Explore with demo wearables and synthetic data.'
              : 'Connect your real wearables and see your biometrics on a timeline.'}
          </motion.p>
          <motion.div variants={riseIn}>
            <ModeToggle mode={mode} onChange={switchMode} />
          </motion.div>
          <motion.div variants={riseIn} className="flex flex-col items-center gap-3">
            <TapButton
              size="lg"
              disabled={busy}
              onClick={() => connectAs(`wearables-web-${crypto.randomUUID().slice(0, 8)}`)}
            >
              Get started
            </TapButton>
            <button
              type="button"
              className="text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
              onClick={() => setShowExisting((s) => !s)}
            >
              I have an existing ID
            </button>
          </motion.div>
          <AnimatePresence initial={false}>
            {showExisting && (
              <motion.form
                key="existing-id"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0, transition: springTransition }}
                exit={{ opacity: 0, y: -6, transition: { duration: 0.15 } }}
                className="flex w-full gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  connectAs(existingId.trim())
                }}
              >
                <Input
                  value={existingId}
                  onChange={(e) => setExistingId(e.target.value)}
                  placeholder="Existing ID, e.g. wearables-web-1a2b3c4d"
                  required
                  autoFocus
                  className="bg-card"
                />
                <TapButton type="submit" disabled={busy}>
                  Connect
                </TapButton>
              </motion.form>
            )}
          </AnimatePresence>
          {error && (
            <Alert variant="destructive" className="text-left">
              <AlertCircle />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </motion.div>
      </MotionConfig>
    )
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto flex max-w-[880px] flex-col gap-4 px-5 pt-6 pb-16">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight">ExampleHealth Wearables</h1>
            <ModeToggle mode={mode} onChange={switchMode} />
          </div>
          <span className="flex items-center gap-1 rounded-full border bg-card py-1 pr-1.5 pl-3 text-xs">
            <Button
              variant="ghost"
              size="xs"
              className="text-brand hover:text-brand"
              onClick={async () => {
                setError(null)
                try {
                  await api.sync(user.id)
                } catch (e) {
                  setError(String(e))
                }
              }}
            >
              sync now
            </Button>
            <span className="font-mono text-foreground">{user.client_user_id}</span>
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              onClick={() => {
                localStorage.removeItem(userKey(mode))
                setSessions((s) => ({ ...s, [mode]: null }))
                setDevices([])
              }}
            >
              switch
            </Button>
          </span>
        </header>

        {error && (
          <Alert
            variant="destructive"
            className="cursor-pointer border-destructive/30"
            onClick={() => setError(null)}
          >
            <AlertCircle />
            <AlertDescription>{error} (click to dismiss)</AlertDescription>
          </Alert>
        )}

        <motion.div
          variants={staggerParent}
          initial="hidden"
          animate="show"
          className="flex flex-col gap-4"
        >
          <motion.div variants={riseIn} ref={devicesRef}>
            <DevicePanel
              devices={devices}
              environment={mode}
              onConnect={async (provider) => {
                setError(null)
                try {
                  const { link_url } = await api.createLink(user.id, provider)
                  window.open(link_url, '_blank')
                } catch (e) {
                  setError(String(e))
                }
              }}
              onConnectDemo={async (provider) => {
                setError(null)
                try {
                  await api.connectDemo(user.id, provider)
                  await refreshDevices()
                } catch (e) {
                  setError(String(e))
                }
              }}
              onDisconnect={async (provider) => {
                setError(null)
                try {
                  await api.disconnect(user.id, provider)
                  await refreshDevices()
                } catch (e) {
                  setError(String(e))
                }
              }}
            />
          </motion.div>

          <motion.div variants={riseIn}>
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
                    <Tabs value={metric} onValueChange={(v) => setMetric(v as Metric)}>
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
                    value={String(range)}
                    onValueChange={(v) => {
                      if (v) setRange(Number(v))
                    }}
                  >
                    {RANGES.map((r, i) => (
                      <ToggleGroupItem
                        key={r.label}
                        value={String(i)}
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
                      onConnectDevice={() =>
                        devicesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                      }
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
        </motion.div>
      </div>
    </MotionConfig>
  )
}
