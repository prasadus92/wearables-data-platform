import { SignInButton, UserButton, useUser } from '@clerk/react'
import { AlertCircle } from 'lucide-react'
import { motion, MotionConfig } from 'motion/react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom'
import type { Device, JunctionEnv, User } from '@youth/health-core'
import { api, setGuestToken, streamUrl } from './api'
import { useClerkBridge } from './components/AuthBridge'
import { springTransition, TapButton } from './components/motion'
import { PulseBand } from './components/PulseBand'
import { SectionNav } from './components/SectionNav'
import { ThemeToggle } from './components/ThemeToggle'
import { ActivityPage } from './pages/ActivityPage'
import { DevicesPage } from './pages/DevicesPage'
import { TimelinePage } from './pages/TimelinePage'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

// One session per environment, so Demo and Live each keep their own session
// across reloads. Demo (sandbox) offers synthetic wearables; Live (production)
// connects real devices over real provider OAuth. The active mode follows the
// auth state (sign-in is Live, anonymous is Demo); MODE_KEY remembers the last
// mode so a reload renders the right world before Clerk resolves.
const MODE_KEY = 'youth-wearables-mode'
const userKey = (env: JunctionEnv) => `youth-wearables-user:${env}`

// Sessions bootstrapped through Clerk carry a marker so anonymous and
// signed-in identities never mix: each is ignored while the other applies.
// Guest sessions additionally persist their one-time token (issued only in
// the POST /v1/guests response) so keyless builds stay authenticated.
type StoredUser = User & { auth?: 'clerk'; guest_token?: string }

// The shared sample account is read via the service credential, so its
// entry point only exists when a key was configured at build time.
const hasServiceKey = Boolean(import.meta.env.VITE_API_KEY)

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
  /** null while unknown (first fetch in flight); consumers hold skeletons. */
  devices: Device[] | null
  liveVersion: number
  refreshDevices: () => Promise<void>
  setError: (error: string | null) => void
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
  // Live is reserved for sign-in. A guest-like session in the production
  // slot is residue from older builds; drop it so nobody browses Live as
  // an anonymous identity.
  useEffect(() => {
    const prod = sessions.production
    if (prod && (prod.client_user_id.startsWith('guest:') || prod.guest_token)) {
      localStorage.removeItem(userKey('production'))
      setSessions((s) => ({ ...s, production: null }))
    }
    // The door you entered through decides the world: sign-in is Live,
    // anonymous is Demo. No switching once inside.
    if (clerkLoaded) {
      const next: JunctionEnv = signedIn ? 'production' : 'sandbox'
      if (mode !== next) {
        setMode(next)
        localStorage.setItem(MODE_KEY, next)
        setDevices(null)
      }
    }
  }, [sessions.production, signedIn, clerkLoaded, mode])
  // Guests are demo-only identities; Live mode is reserved for sign-in.
  const isGuest = Boolean(
    user && (user.client_user_id.startsWith('guest:') || user.guest_token),
  )
  const { user: clerkUser } = useUser()
  // Header identity: a person's name, never a backend identifier.
  const displayName = isGuest
    ? 'Guest'
    : clerkUser?.firstName || clerkUser?.fullName || 'You'
  const navigate = useNavigate()
  const [devices, setDevices] = useState<Device[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Header sync chip feedback: idle -> busy -> asked (5s) -> idle.
  const [headerSync, setHeaderSync] = useState<'idle' | 'busy' | 'asked'>('idle')
  // Bumped by SSE updates; charts refetch when it changes.
  const [liveVersion, setLiveVersion] = useState(0)
  const wasSignedIn = useRef(false)

  // Keep the API client's guest credential in step with the active session.
  // A layout effect, deliberately: passive effects run children first, so a
  // plain useEffect here fires AFTER the chart's first fetch and that
  // request goes out with no credential (a 401 on keyless builds). Layout
  // effects all run before any passive effect, closing the race.
  useLayoutEffect(() => {
    setGuestToken(user?.guest_token ?? null)
  }, [user])

  // When Clerk finishes resolving (sign-in, or the handshake on a hard page
  // load), refetch everything: requests issued mid-handshake failed or hung.
  useEffect(() => {
    if (clerkLoaded) setLiveVersion((v) => v + 1)
  }, [clerkLoaded, signedIn])

  // Signed-in identities bootstrap through POST /v1/me per environment. The
  // result lands in the same per-mode slot, replacing any stored anonymous
  // session, so the rest of the app is identity-agnostic. Re-runs on mode
  // switch so Demo and Live each resolve their own user, and on meRetry so
  // a failed bootstrap has a way forward besides reloading the page.
  const [meRetry, setMeRetry] = useState(0)
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
        // Arriving from onboarding, the timeline is the first impression;
        // any deeper route was a deliberate destination, keep it.
        if (window.location.pathname === '/') navigate('/metrics/heartrate')
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
  }, [signedIn, mode, meRetry])

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
    setDevices(null)
    setError(null)
  }, [signedIn])

  // Which user's device list has loaded at least once. Before that, a fetch
  // failure surfaces (an empty list would read as "no devices", a lie); after
  // it, background poll blips stay quiet and the next tick retries.
  const devicesLoadedFor = useRef<string | null>(null)
  const refreshDevices = useCallback(async () => {
    if (!user) return
    try {
      setDevices(await api.listDevices(user.id))
      devicesLoadedFor.current = user.id
    } catch (e) {
      if (devicesLoadedFor.current !== user.id) setError(String(e))
    }
  }, [user])

  // Devices poll keeps connection status + "last synced" fresh while
  // Junction webhooks land in the background.
  useEffect(() => {
    refreshDevices()
    const interval = setInterval(refreshDevices, 15_000)
    return () => clearInterval(interval)
  }, [refreshDevices])

  // Guests created before demo auto-attach existed have no devices and an
  // empty timeline. Heal them once: attach the demo wearable the server now
  // provides at guest creation.
  const healedGuest = useRef<string | null>(null)
  useEffect(() => {
    if (!user || !isGuest || mode !== 'sandbox') return
    if (healedGuest.current === user.id) return
    let cancelled = false
    api
      .listDevices(user.id)
      .then(async (list) => {
        if (cancelled || list.some((d) => d.status !== 'disconnected')) return
        healedGuest.current = user.id
        await api.connectDemo(user.id, 'oura')
        await refreshDevices()
        setLiveVersion((v) => v + 1)
      })
      .catch(() => {
        // Next load retries; healing is best effort.
      })
    return () => {
      cancelled = true
    }
  }, [user, isGuest, mode, refreshDevices])

  // Live updates: the backend streams an SSE event whenever new samples are
  // ingested, so charts refresh the moment a Junction webhook is processed.
  useEffect(() => {
    if (!user) return
    let source: EventSource | null = null
    let cancelled = false
    let retry: ReturnType<typeof setTimeout> | null = null
    const connect = () => {
      streamUrl(user.id).then((url) => {
        if (cancelled) return
        source = new EventSource(url)
        source.addEventListener('update', () => {
          setLiveVersion((v) => v + 1)
          refreshDevices()
        })
        source.onerror = () => {
          // EventSource retries transient drops on its own. A CLOSED stream
          // (expired credential, proxy gone) never recovers by itself, so
          // rebuild it with a fresh URL or live updates silently stop.
          if (cancelled || source?.readyState !== EventSource.CLOSED) return
          source?.close()
          retry = setTimeout(connect, 5000)
        }
      })
    }
    connect()
    return () => {
      cancelled = true
      if (retry) clearTimeout(retry)
      source?.close()
    }
  }, [user, refreshDevices])

  // Establish a session from any identity source and store it per mode.
  // Returns whether the session was created, so callers can route on success.
  async function establishSession(create: () => Promise<User>): Promise<boolean> {
    setError(null)
    setBusy(true)
    try {
      const created = await create()
      localStorage.setItem(userKey(mode), JSON.stringify(created))
      setSessions((s) => ({ ...s, [mode]: created }))
      setDevices(null)
      return true
    } catch (e) {
      setError(String(e))
      return false
    } finally {
      setBusy(false)
    }
  }

  // Guests are explicit and server-issued: the backend mints a guest:<id>
  // identity and records the session start in the lifecycle ledger.
  const startAsGuest = async () => {
    // Guests get a demo wearable attached server-side, so the timeline is
    // the right first impression: readings stream in within a couple of
    // minutes over SSE.
    if (await establishSession(() => api.guests(mode))) navigate('/metrics/heartrate')
  }
  // The shared sample account rides the idempotent service-side create.
  const exploreSample = () => establishSession(() => api.createUser('youth-sample', mode))

  if (!user && (!clerkLoaded || signedIn)) {
    // Two windows where onboarding must never flash: while Clerk is still
    // resolving (it may be about to say signed in), and after it resolves
    // signed in while the session bootstrap is in flight. A quiet beat
    // covers both; genuinely signed-out visitors pass through in well under
    // a second.
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15 }}
          className="flex items-center gap-3"
        >
          <img src="/youth-logo.svg" alt="YOU(th)" className="h-5 w-auto dark:invert" />
          <span className="font-mono text-xs tracking-widest text-muted-foreground uppercase">
            {signedIn ? 'Signing you in' : 'Loading'}
          </span>
        </motion.div>
      </div>
    )
  }

  if (!user) {
    return (
      <MotionConfig reducedMotion="user">
        {/* In dark mode the hero sits on the warm ember backdrop from the
            mobile welcome screen; light keeps the editorial paper. */}
        <div
          aria-hidden="true"
          className="hero-backdrop pointer-events-none fixed inset-0 hidden dark:block"
        />
        <ThemeToggle className="fixed top-4 right-4 z-10" />
        <motion.div
          variants={staggerParent}
          initial="hidden"
          animate="show"
          className="relative mx-auto flex min-h-dvh max-w-4xl flex-col items-center justify-center gap-6 px-6 py-16 text-center"
        >
          <motion.div
            variants={riseIn}
            className="flex items-baseline gap-2.5"
            initial={{ opacity: 0, scale: 0.94, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          >
            <img src="/youth-logo.svg" alt="YOU(th)" className="h-6 w-auto dark:invert" />
            <span className="font-mono text-xs font-medium tracking-[0.25em] text-muted-foreground uppercase">
              Wearables
            </span>
          </motion.div>
          <motion.h1
            variants={riseIn}
            className="text-[clamp(2.5rem,6vw,4.5rem)] leading-[1.04] font-medium tracking-[-0.02em] text-balance"
          >
            <span className="block">Your body has a story.</span>
            <span className="block">See it unfold.</span>
          </motion.h1>
          <motion.p variants={riseIn} className="max-w-md text-base text-muted-foreground">
            Connect your wearables and watch heart rate, sleep, and activity arrive as they
            happen. Or look around first with demo data.
          </motion.p>
          <motion.div variants={riseIn} className="flex flex-col items-center gap-3">
            <div className="flex items-center gap-2">
              <SignInButton mode="modal">
                <Button size="lg" disabled={busy}>
                  Sign in
                </Button>
              </SignInButton>
              <TapButton
                size="lg"
                variant="outline"
                disabled={busy || signedIn}
                onClick={startAsGuest}
              >
                Try the demo
              </TapButton>
            </div>
            {hasServiceKey && (
              <button
                type="button"
                className="text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
                disabled={busy || signedIn}
                onClick={exploreSample}
              >
                Explore a sample account
              </button>
            )}
          </motion.div>
          <motion.div variants={riseIn} className="mt-6 w-full">
            <PulseBand />
          </motion.div>
          {error && (
            <Alert variant="destructive" className="text-left">
              <AlertCircle />
              <AlertDescription className="flex flex-col items-start gap-2">
                <span>{error}</span>
                {signedIn && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setError(null)
                      setMeRetry((n) => n + 1)
                    }}
                  >
                    Try again
                  </Button>
                )}
              </AlertDescription>
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
            <h1>
              <motion.button
                type="button"
                className="flex cursor-pointer items-baseline gap-2"
                aria-label="Go to your timeline"
                onClick={() => navigate('/metrics/heartrate')}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                transition={springTransition}
              >
                <img src="/youth-logo.svg" alt="YOU(th)" className="h-4 w-auto dark:invert" />
                <span className="text-xl leading-none font-semibold tracking-tight">
                  Wearables
                </span>
              </motion.button>
            </h1>
            <span
              className="rounded-full border bg-card px-2.5 py-0.5 font-mono text-xs tracking-wide text-muted-foreground uppercase"
              title={
                mode === 'production'
                  ? 'Real wearables connected to your account'
                  : 'Synthetic data for exploring'
              }
            >
              {mode === 'production' ? 'Live' : 'Demo'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <span className="flex items-center gap-1 rounded-full border bg-card py-1 pr-1.5 pl-3 text-xs">
              {mode === 'production' && (
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-brand hover:text-brand disabled:opacity-70"
                  disabled={headerSync !== 'idle'}
                  onClick={async () => {
                    setError(null)
                    setHeaderSync('busy')
                    try {
                      await api.sync(user.id)
                      // New readings arrive over SSE; the chip just confirms
                      // the ask went out, then resets.
                      setHeaderSync('asked')
                      setTimeout(() => setHeaderSync('idle'), 5000)
                    } catch (e) {
                      setError(String(e))
                      setHeaderSync('idle')
                    }
                  }}
                >
                  {headerSync === 'busy'
                    ? 'syncing'
                    : headerSync === 'asked'
                      ? 'sync requested'
                      : 'sync now'}
                </Button>
              )}
              <span className="text-foreground" title={user.client_user_id}>
                {displayName}
              </span>
              {!signedIn && (
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-muted-foreground"
                  onClick={() => {
                    localStorage.removeItem(userKey(mode))
                    setSessions((s) => ({ ...s, [mode]: null }))
                    setDevices(null)
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
