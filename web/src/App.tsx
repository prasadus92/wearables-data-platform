import { SignInButton, UserButton } from '@clerk/react'
import { AlertCircle } from 'lucide-react'
import { motion, MotionConfig } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { api, streamUrl, type Device, type JunctionEnv, type User } from './api'
import { useClerkBridge } from './components/AuthBridge'
import { springTransition, TapButton } from './components/motion'
import { ActivityPage } from './pages/ActivityPage'
import { DevicesPage } from './pages/DevicesPage'
import { TimelinePage } from './pages/TimelinePage'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

// One session per environment, so Demo and Live coexist and switching is
// instant. Demo (sandbox) offers synthetic wearables; Live (production)
// connects real devices over real provider OAuth.
const MODE_KEY = 'youth-wearables-mode'
const userKey = (env: JunctionEnv) => `youth-wearables-user:${env}`

// Sessions bootstrapped through Clerk carry a marker so anonymous and
// signed-in identities never mix: each is ignored while the other applies.
type StoredUser = User & { auth?: 'clerk' }

function loadUser(env: JunctionEnv): StoredUser | null {
  // Migrate the pre-mode single-session key into the sandbox slot.
  const legacy = localStorage.getItem('youth-wearables-user')
  if (legacy && env === 'sandbox' && !localStorage.getItem(userKey('sandbox'))) {
    localStorage.setItem(userKey('sandbox'), legacy)
    localStorage.removeItem('youth-wearables-user')
  }
  const saved = localStorage.getItem(userKey(env))
  return saved ? JSON.parse(saved) : null
}

/** Everything the routed pages need from the shell, via Outlet context. */
export interface DashboardContext {
  user: User
  mode: JunctionEnv
  devices: Device[]
  liveVersion: number
  refreshDevices: () => Promise<void>
  setError: (error: string | null) => void
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: JunctionEnv
  onChange: (m: JunctionEnv) => void
}) {
  return (
    <ToggleGroup
      type="single"
      size="sm"
      variant="outline"
      value={mode}
      onValueChange={(v) => {
        if (v) onChange(v as JunctionEnv)
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

/** Section switcher styled after the card titles: mono, uppercase, quiet. */
function SectionNav() {
  const { pathname } = useLocation()
  const links = [
    { to: '/metrics/heartrate', label: 'Timeline', active: pathname.startsWith('/metrics') },
    { to: '/devices', label: 'Devices', active: pathname.startsWith('/devices') },
    { to: '/activity', label: 'Activity', active: pathname.startsWith('/activity') },
  ]
  return (
    <nav aria-label="Dashboard sections" className="flex items-center gap-4 border-b pb-2">
      {links.map((link) => (
        <Link
          key={link.to}
          to={link.to}
          aria-current={link.active ? 'page' : undefined}
          className={`font-mono text-xs font-medium tracking-widest uppercase transition-colors ${
            link.active
              ? 'text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  )
}

/**
 * Persistent layout: header and section nav stay mounted across routes.
 * Owns the session, devices, and live-update state every page shares.
 * When the active mode has no session, onboarding renders in place of the
 * routed content and the URL is left untouched.
 */
function AppShell() {
  const [mode, setMode] = useState<JunctionEnv>(
    () => (localStorage.getItem(MODE_KEY) as JunctionEnv) || 'sandbox',
  )
  const [sessions, setSessions] = useState<Record<JunctionEnv, StoredUser | null>>(() => ({
    sandbox: loadUser('sandbox'),
    production: loadUser('production'),
  }))
  const { loaded: clerkLoaded, signedIn } = useClerkBridge()
  // Once Clerk has resolved, only show sessions that match the auth state:
  // signed in ignores stored anonymous sessions (api.me replaces them), and
  // signed out ignores any leftover Clerk-bootstrapped session. While Clerk
  // is still loading, trust the stored slot to avoid an onboarding flash.
  const stored = sessions[mode]
  const storedIsClerk = stored?.auth === 'clerk'
  const user = clerkLoaded && storedIsClerk !== signedIn ? null : stored
  const [devices, setDevices] = useState<Device[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Bumped by SSE updates; charts refetch when it changes.
  const [liveVersion, setLiveVersion] = useState(0)
  const wasSignedIn = useRef(false)

  // Signed-in identities bootstrap through POST /v1/me per environment. The
  // result lands in the same per-mode slot, replacing any stored anonymous
  // session, so the rest of the app is identity-agnostic. Re-runs on mode
  // switch so Demo and Live each resolve their own user.
  useEffect(() => {
    if (!signedIn) return
    let cancelled = false
    setBusy(true)
    api
      .me(mode)
      .then((me) => {
        if (cancelled) return
        const session: StoredUser = { ...me, auth: 'clerk' }
        localStorage.setItem(userKey(mode), JSON.stringify(session))
        setSessions((s) => ({ ...s, [mode]: session }))
      })
      .catch((e) => {
        if (!cancelled) setError(String(e))
      })
      .finally(() => {
        if (!cancelled) setBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [signedIn, mode])

  // Signing out (via Clerk's UserButton) clears both mode slots and returns
  // to onboarding, so signed-in sessions never linger as anonymous ones.
  useEffect(() => {
    if (signedIn) {
      wasSignedIn.current = true
      return
    }
    if (!wasSignedIn.current) return
    wasSignedIn.current = false
    localStorage.removeItem(userKey('sandbox'))
    localStorage.removeItem(userKey('production'))
    setSessions({ sandbox: null, production: null })
    setDevices([])
    setError(null)
  }, [signedIn])

  const refreshDevices = useCallback(async () => {
    if (!user) return
    try {
      setDevices(await api.listDevices(user.id))
    } catch (e) {
      setError(String(e))
    }
  }, [user])

  // Devices poll keeps connection status + "last synced" fresh while
  // Junction webhooks land in the background.
  useEffect(() => {
    refreshDevices()
    const interval = setInterval(refreshDevices, 15_000)
    return () => clearInterval(interval)
  }, [refreshDevices])

  // Live updates: the backend streams an SSE event whenever new samples are
  // ingested, so charts refresh the moment a Junction webhook is processed.
  useEffect(() => {
    if (!user) return
    let source: EventSource | null = null
    let cancelled = false
    streamUrl(user.id).then((url) => {
      if (cancelled) return
      source = new EventSource(url)
      source.addEventListener('update', () => {
        setLiveVersion((v) => v + 1)
        refreshDevices()
      })
    })
    return () => {
      cancelled = true
      source?.close()
    }
  }, [user, refreshDevices])

  // Establish a session from any identity source and store it per mode.
  async function establishSession(create: () => Promise<User>) {
    setError(null)
    setBusy(true)
    try {
      const created = await create()
      localStorage.setItem(userKey(mode), JSON.stringify(created))
      setSessions((s) => ({ ...s, [mode]: created }))
      setDevices([])
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  // Guests are explicit and server-issued: the backend mints a guest:<id>
  // identity and records the session start in the lifecycle ledger.
  const startAsGuest = () => establishSession(() => api.guests(mode))
  // The shared sample account rides the idempotent service-side create.
  const exploreSample = () => establishSession(() => api.createUser('youth-sample', mode))

  function switchMode(next: JunctionEnv) {
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
            YOU(th) Wearables
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
            <div className="flex items-center gap-2">
              <TapButton size="lg" disabled={busy} onClick={startAsGuest}>
                Get started
              </TapButton>
              <SignInButton mode="modal">
                <Button size="lg" variant="outline" disabled={busy}>
                  Sign in
                </Button>
              </SignInButton>
            </div>
            {mode === 'sandbox' && (
              <button
                type="button"
                className="text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
                disabled={busy}
                onClick={exploreSample}
              >
                Explore a sample account
              </button>
            )}
          </motion.div>
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

  const context: DashboardContext = {
    user,
    mode,
    devices,
    liveVersion,
    refreshDevices,
    setError,
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto flex max-w-[880px] flex-col gap-4 px-5 pt-6 pb-16">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight">YOU(th) Wearables</h1>
            <ModeToggle mode={mode} onChange={switchMode} />
          </div>
          <div className="flex items-center gap-2">
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
              <span className="font-mono text-foreground">
                {user.client_user_id.startsWith('guest:') ? 'Guest' : user.client_user_id}
              </span>
              {!signedIn && (
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
                  start fresh
                </Button>
              )}
            </span>
            {signedIn && <UserButton />}
          </div>
        </header>

        <SectionNav />

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

        <Outlet context={context} />
      </div>
    </MotionConfig>
  )
}

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/metrics/heartrate" replace />} />
        <Route path="metrics/:metric" element={<TimelinePage />} />
        <Route path="devices" element={<DevicesPage />} />
        <Route path="activity" element={<ActivityPage />} />
        <Route path="*" element={<Navigate to="/metrics/heartrate" replace />} />
      </Route>
    </Routes>
  )
}
