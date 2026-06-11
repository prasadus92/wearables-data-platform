import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import type { DashboardContext } from '../App'
import type { ActivityEvent } from '@examplehealth/health-core'
import { api } from '../api'
import { EmptyState } from '../components/EmptyState'
import { springTransition, TapButton } from '../components/motion'
import { BADGE_TONES, relativeTime } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

function StatusBadge({ status, eventType }: { status: ActivityEvent['status']; eventType: string }) {
  // Lifecycle ledger entries (connects, disconnects, identity changes) carry
  // their own badge: they are transitions, never pipeline states.
  if (eventType.startsWith('lifecycle.')) {
    return <Badge className={BADGE_TONES.lifecycle}>lifecycle</Badge>
  }
  if (status === 'processed') {
    return <Badge className={BADGE_TONES.positive}>processed</Badge>
  }
  if (status === 'failed') {
    return <Badge className={BADGE_TONES.warning}>failed</Badge>
  }
  if (status === 'received') {
    return (
      <Badge variant="secondary" className="tracking-wide text-muted-foreground uppercase">
        received
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="tracking-wide uppercase">
      {status}
    </Badge>
  )
}

/** The activity view: a live feed of the user's recent ingestion events. */
export function ActivityPage() {
  const { user, liveVersion } = useOutletContext<DashboardContext>()
  const navigate = useNavigate()
  const [events, setEvents] = useState<ActivityEvent[] | null>(null)
  const [failed, setFailed] = useState(false)
  // Whether the last fetch had rows before filtering, so the empty state can
  // tell "nothing happened yet" apart from "only uncharted readings arrived".
  const [hadRawRows, setHadRawRows] = useState(false)
  // Bumped by the retry button; re-runs the load effect.
  const [retryNonce, setRetryNonce] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const rows = await api.events(user.id)
        // Skipped events are readings we deliberately do not chart (steps,
        // calories, distance); a feed full of them reads as failure, so the
        // activity view shows only what moved the timeline or the devices.
        if (!cancelled) {
          setEvents(rows.filter((row) => row.status !== 'skipped'))
          setHadRawRows(rows.length > 0)
          setFailed(false)
        }
      } catch {
        // Keep showing the last good list; the next tick retries. With no
        // list yet, surface a retryable error instead of an eternal skeleton.
        if (!cancelled) setFailed(true)
      }
    }

    load()
    // SSE drives instant refreshes via liveVersion; the slow interval is a
    // fallback for proxies that buffer event streams.
    const interval = setInterval(load, 30_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [user.id, liveVersion, retryNonce])

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springTransition}
    >
      <Card>
        <CardHeader>
          <CardTitle className="font-mono text-xs font-medium tracking-widest text-muted-foreground uppercase">
            Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          {events === null && !failed && (
            <Skeleton className="h-[300px] w-full rounded-xl" />
          )}

          {events === null && failed && (
            <EmptyState className="h-[300px]">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">Could not load your activity</span>
                <span className="text-sm text-muted-foreground">
                  The connection hiccuped. Your data is safe; try again.
                </span>
              </div>
              <TapButton
                size="sm"
                onClick={() => {
                  setFailed(false)
                  setRetryNonce((n) => n + 1)
                }}
              >
                Retry
              </TapButton>
            </EmptyState>
          )}

          {events !== null && events.length === 0 && (
            <EmptyState className="h-[300px]">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">
                  {hadRawRows ? 'Nothing to show here yet' : 'No activity yet'}
                </span>
                <span className="text-sm text-muted-foreground">
                  {hadRawRows
                    ? 'Updates are arriving, and so far they are all readings the timeline does not chart, like steps. Heart rate, sleep, and connection changes land here.'
                    : 'Every update lands here as your devices deliver readings: new data, backfills, and connection changes.'}
                </span>
              </div>
              {hadRawRows ? (
                <TapButton size="sm" onClick={() => navigate('/metrics/heartrate')}>
                  View your timeline
                </TapButton>
              ) : (
                <TapButton size="sm" onClick={() => navigate('/devices')}>
                  Connect a device
                </TapButton>
              )}
            </EmptyState>
          )}

          {events !== null && events.length > 0 && (
            <ul className="m-0 list-none divide-y p-0">
              <AnimatePresence mode="popLayout" initial={false}>
                {events.map((event) => (
                  <motion.li
                    key={event.id}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={springTransition}
                    className="flex items-center justify-between gap-3 py-2.5"
                  >
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="text-sm">{event.summary}</span>
                      <StatusBadge status={event.status} eventType={event.event_type} />
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {relativeTime(event.received_at)}
                    </span>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}
