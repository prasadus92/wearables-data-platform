import { AnimatePresence, motion } from 'motion/react'
import type { Device } from '@youth/health-core'
import { springTransition, TapButton } from './motion'
import { BADGE_TONES, providerDisplayName, relativeTime } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

// Providers offered in the YOU(th) connect menu (product spec) plus the
// sandbox demo shortcut. WHOOP/Garmin require real accounts (no sandbox
// demo data); Apple Watch requires the native SDK and is mobile-only.
const PROVIDERS = [
  { slug: 'whoop_v2', name: 'WHOOP', unlocks: 'Heart rate, HRV, breathing rate' },
  { slug: 'oura', name: 'Oura', unlocks: 'HRV, blood oxygen, breathing rate' },
  { slug: 'garmin', name: 'Garmin', unlocks: 'Heart rate, HRV, breathing rate' },
  { slug: 'fitbit', name: 'Fitbit', unlocks: 'Heart rate, sleep, blood oxygen' },
  {
    slug: 'apple_health_kit',
    name: 'Apple Watch',
    unlocks: 'Heart rate, HRV, blood pressure',
  },
]

export const APPLE_SLUG = 'apple_health_kit'

interface Props {
  /** null while the list is unknown; renders skeleton rows. */
  devices: Device[] | null
  onConnect: (provider: string) => void
  /** Apple Watch pairs through a code instead of hosted OAuth. */
  onConnectApple: () => void
  onDisconnect: (provider: string) => void
}

function lastSynced(device: Device): string {
  // last_data_at is the newest reading's own timestamp, so the honest label
  // is about the data's age, never about when a sync ran.
  if (!device.last_data_at) return 'no data yet'
  return `latest reading ${relativeTime(device.last_data_at)}`
}

function StatusBadge({ status }: { status: Device['status'] }) {
  if (status === 'connected') {
    return <Badge className={BADGE_TONES.positive}>connected</Badge>
  }
  if (status === 'expired') {
    return <Badge className={BADGE_TONES.warning}>connection expired</Badge>
  }
  return (
    <Badge variant="outline" className="tracking-wide uppercase">
      {status}
    </Badge>
  )
}

export function DevicePanel({ devices, onConnect, onConnectApple, onDisconnect }: Props) {
  if (devices === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="font-mono text-xs font-medium tracking-widest text-muted-foreground uppercase">
            Devices
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </CardContent>
      </Card>
    )
  }
  const active = devices.filter((d) => d.status !== 'disconnected')
  const connectedSlugs = new Set(active.map((d) => d.provider))
  // Connect menu shows only what is not already connected (product spec).
  const available = PROVIDERS.filter((p) => !connectedSlugs.has(p.slug))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-mono text-xs font-medium tracking-widest text-muted-foreground uppercase">
          Devices
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3.5">
        {active.length === 0 && (
          <p className="text-sm text-muted-foreground">Connect a wearable once and your readings keep flowing in automatically.</p>
        )}

        {active.length > 0 && (
          <ul className="m-0 list-none divide-y p-0">
            <AnimatePresence mode="popLayout" initial={false}>
              {active.map((device) => (
                <motion.li
                  key={device.id}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={springTransition}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-2.5"
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                    <span className="text-sm font-medium">{providerDisplayName(device.provider)}</span>
                    <StatusBadge status={device.status} />
                    <span className="text-xs text-muted-foreground">{lastSynced(device)}</span>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {device.status === 'expired' && (
                      <TapButton size="sm" onClick={() => onConnect(device.provider)}>
                        Reconnect
                      </TapButton>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onDisconnect(device.provider)}
                    >
                      Disconnect
                    </Button>
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}

        {available.length > 0 && (
          <div className="flex flex-wrap gap-3">
            <AnimatePresence mode="popLayout" initial={false}>
              {available.map((provider) => (
                <motion.div
                  key={provider.slug}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={springTransition}
                  className="flex min-w-[120px] flex-col items-center gap-2 rounded-xl border border-dashed border-input px-4 py-3.5"
                >
                  <span className="text-sm font-medium">{provider.name}</span>
                <span className="text-center text-xs leading-snug text-muted-foreground">
                  {provider.unlocks}
                </span>
                  <TapButton
                    size="sm"
                    onClick={() =>
                      provider.slug === APPLE_SLUG ? onConnectApple() : onConnect(provider.slug)
                    }
                  >
                    Connect
                  </TapButton>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
