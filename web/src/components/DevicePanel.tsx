import { AnimatePresence, motion } from 'motion/react'
import type { Device, JunctionEnv } from '../api'
import { springTransition, TapButton } from './motion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// Providers offered in the YOU(th) connect menu (product spec) plus the
// sandbox demo shortcut. WHOOP/Garmin require real accounts (no sandbox
// demo data); Apple Watch requires the native SDK and is mobile-only.
const PROVIDERS = [
  { slug: 'whoop_v2', name: 'WHOOP', demo: false, unlocks: 'Heart rate, HRV, breathing rate' },
  { slug: 'oura', name: 'Oura', demo: true, unlocks: 'Sleep, HRV, blood oxygen' },
  { slug: 'garmin', name: 'Garmin', demo: false, unlocks: 'Heart rate, HRV, breathing rate' },
  { slug: 'fitbit', name: 'Fitbit', demo: true, unlocks: 'Heart rate, sleep, blood oxygen' },
]

interface Props {
  devices: Device[]
  environment: JunctionEnv
  onConnect: (provider: string) => void
  onConnectDemo: (provider: string) => void
  onDisconnect: (provider: string) => void
}

function lastSynced(device: Device): string {
  if (!device.last_data_at) return 'no data yet'
  const minutes = Math.round((Date.now() - new Date(device.last_data_at).getTime()) / 60000)
  if (minutes < 1) return 'synced just now'
  if (minutes < 60) return `synced ${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `synced ${hours}h ago`
  return `synced ${Math.round(hours / 24)}d ago`
}

function StatusBadge({ status }: { status: Device['status'] }) {
  if (status === 'connected') {
    return (
      <Badge className="border-emerald-200 bg-emerald-50 tracking-wide text-emerald-700 uppercase">
        connected
      </Badge>
    )
  }
  if (status === 'expired') {
    return (
      <Badge className="border-amber-200 bg-amber-50 tracking-wide text-amber-700 uppercase">
        connection expired
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="tracking-wide uppercase">
      {status}
    </Badge>
  )
}

export function DevicePanel({ devices, environment, onConnect, onConnectDemo, onDisconnect }: Props) {
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
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="text-sm font-medium capitalize">{device.provider}</span>
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
                  <TapButton size="sm" onClick={() => onConnect(provider.slug)}>
                    Connect
                  </TapButton>
                  {provider.demo && environment === 'sandbox' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground"
                      onClick={() => onConnectDemo(provider.slug)}
                    >
                      Demo data
                    </Button>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
