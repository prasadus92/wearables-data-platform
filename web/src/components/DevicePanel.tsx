import type { Device } from '../api'

// Providers offered in the YOU(th) connect menu (product spec) plus the
// sandbox demo shortcut. WHOOP/Garmin require real accounts (no sandbox
// demo data); Apple Watch requires the native SDK and is mobile-only.
const PROVIDERS = [
  { slug: 'whoop_v2', name: 'WHOOP', demo: false },
  { slug: 'oura', name: 'Oura', demo: true },
  { slug: 'garmin', name: 'Garmin', demo: false },
  { slug: 'fitbit', name: 'Fitbit', demo: true },
]

interface Props {
  devices: Device[]
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

export function DevicePanel({ devices, onConnect, onConnectDemo, onDisconnect }: Props) {
  const active = devices.filter((d) => d.status !== 'disconnected')
  const connectedSlugs = new Set(active.map((d) => d.provider))
  // Connect menu shows only what is not already connected (product spec).
  const available = PROVIDERS.filter((p) => !connectedSlugs.has(p.slug))

  return (
    <section className="devices">
      <h2>Devices</h2>
      {active.length === 0 && <p className="muted">No devices connected. Pick one below.</p>}

      <ul className="device-list">
        {active.map((device) => (
          <li key={device.id} className="device">
            <div>
              <strong>{device.provider}</strong>
              <span className={`status ${device.status}`}>
                {device.status === 'expired' ? 'connection expired' : device.status}
              </span>
              <span className="muted">{lastSynced(device)}</span>
            </div>
            <div className="device-actions">
              {device.status === 'expired' && (
                <button onClick={() => onConnect(device.provider)}>Reconnect</button>
              )}
              <button className="secondary" onClick={() => onDisconnect(device.provider)}>
                Disconnect
              </button>
            </div>
          </li>
        ))}
      </ul>

      {available.length > 0 && (
        <div className="connect-row">
          {available.map((provider) => (
            <div key={provider.slug} className="connect-card">
              <span>{provider.name}</span>
              <button onClick={() => onConnect(provider.slug)}>Connect</button>
              {provider.demo && (
                <button className="secondary" onClick={() => onConnectDemo(provider.slug)}>
                  Demo data
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
