import { useCallback, useEffect, useState } from 'react'
import { api, streamUrl, type Device, type Metric, type Resolution, type User } from './api'
import { DevicePanel } from './components/DevicePanel'
import { TimelineChart } from './components/TimelineChart'

const METRICS: { key: Metric; label: string }[] = [
  { key: 'heartrate', label: 'Heart Rate' },
  { key: 'hrv', label: 'HRV' },
  { key: 'spo2', label: 'SpO₂' },
  { key: 'respiratory_rate', label: 'Respiratory Rate' },
  { key: 'blood_pressure', label: 'Blood Pressure' },
]

const RANGES: { label: string; days: number; resolution: Resolution }[] = [
  { label: '24h', days: 1, resolution: 'hour' },
  { label: '7d', days: 7, resolution: 'hour' },
  { label: '30d', days: 30, resolution: 'day' },
  { label: '90d', days: 90, resolution: 'week' },
]

const STORAGE_KEY = 'youth-wearables-user'

export default function App() {
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? JSON.parse(saved) : null
  })
  const [devices, setDevices] = useState<Device[]>([])
  const [metric, setMetric] = useState<Metric>('heartrate')
  const [range, setRange] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [nameInput, setNameInput] = useState('')
  // Bumped by SSE updates; charts refetch when it changes.
  const [liveVersion, setLiveVersion] = useState(0)

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
    const source = new EventSource(streamUrl(user.id))
    source.addEventListener('update', () => {
      setLiveVersion((v) => v + 1)
      refreshDevices()
    })
    return () => source.close()
  }, [user, refreshDevices])

  async function handleCreateUser(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      const created = await api.createUser(nameInput.trim())
      localStorage.setItem(STORAGE_KEY, JSON.stringify(created))
      setUser(created)
    } catch (e) {
      setError(String(e))
    }
  }

  if (!user) {
    return (
      <div className="onboarding">
        <h1>YOU(th) Wearables</h1>
        <p>Connect your wearable and see your biometrics on a timeline.</p>
        <form onSubmit={handleCreateUser}>
          <input
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder="Choose a user id, e.g. prasad-demo"
            required
          />
          <button type="submit">Get started</button>
        </form>
        {error && <p className="error">{error}</p>}
      </div>
    )
  }

  return (
    <div className="layout">
      <header>
        <h1>YOU(th) Wearables</h1>
        <span className="user-chip">
          <button
            className="link-button"
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
          </button>
          {user.client_user_id}
          <button
            className="link-button"
            onClick={() => {
              localStorage.removeItem(STORAGE_KEY)
              setUser(null)
              setDevices([])
            }}
          >
            switch
          </button>
        </span>
      </header>

      {error && (
        <p className="error" onClick={() => setError(null)}>
          {error} (click to dismiss)
        </p>
      )}

      <DevicePanel
        devices={devices}
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

      <section className="chart-section">
        <div className="chart-controls">
          <nav className="tabs">
            {METRICS.map((m) => (
              <button
                key={m.key}
                className={m.key === metric ? 'tab active' : 'tab'}
                onClick={() => setMetric(m.key)}
              >
                {m.label}
              </button>
            ))}
          </nav>
          <nav className="ranges">
            {RANGES.map((r, i) => (
              <button
                key={r.label}
                className={i === range ? 'range active' : 'range'}
                onClick={() => setRange(i)}
              >
                {r.label}
              </button>
            ))}
          </nav>
        </div>
        <TimelineChart
          userId={user.id}
          metric={metric}
          days={RANGES[range].days}
          resolution={RANGES[range].resolution}
          liveVersion={liveVersion}
        />
      </section>
    </div>
  )
}
