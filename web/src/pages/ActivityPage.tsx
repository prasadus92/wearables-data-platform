import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import type { DashboardContext } from '../App'
import { api, type ActivityEvent } from '../api'
import { springTransition, TapButton } from '../components/motion'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

function relativeTime(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function StatusBadge({ status, eventType }: { status: ActivityEvent['status']; eventType: string }) {
  // Lifecycle ledger entries (connects, disconnects, identity changes) carry
  // their own badge: they are transitions, never pipeline states.
  if (eventType.startsWith('lifecycle.')) {
    return (
      <Badge className="border-violet-200 bg-violet-50 tracking-wide text-violet-700 uppercase">
        lifecycle
      </Badge>
    )
  }
  if (status === 'processed') {
    return (
      <Badge className="border-emerald-200 bg-emerald-50 tracking-wide text-emerald-700 uppercase">
        processed
      </Badge>
    )
  }
  if (status === 'failed') {
    return (
      <Badge className="border-amber-200 bg-amber-50 tracking-wide text-amber-700 uppercase">
        failed
      </Badge>
    )
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

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const rows = await api.events(user.id)
        if (!cancelled) setEvents(rows)
      } catch {
        // Keep showing the last good list; the next tick retries.
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
  }, [user.id, liveVersion])

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
          {events === null && <Skeleton className="h-[300px] w-full rounded-xl" />}

          {events !== null && events.length === 0 && (
            <div className="flex h-[300px] flex-col items-center justify-center gap-4 px-10 text-center">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">No activity yet</span>
                <span className="text-sm text-muted-foreground">
                  Every update lands here as your devices deliver readings: new data,
                  backfills, and connection changes.
                </span>
              </div>
              <TapButton size="sm" onClick={() => navigate('/devices')}>
                Connect a device
              </TapButton>
            </div>
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
