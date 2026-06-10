import { AlertCircle } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api, streamUrl, type Device, type Metric, type Resolution, type User } from './api'
import { DevicePanel } from './components/DevicePanel'
import { TimelineChart } from './components/TimelineChart'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

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

const STORAGE_KEY = 'wearables-user'

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
      <div className="mx-auto mt-[18vh] flex max-w-md flex-col gap-4 px-5 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">ExampleHealth Wearables</h1>
        <p className="text-sm text-muted-foreground">
          Connect your wearable and see your biometrics on a timeline.
        </p>
        <form onSubmit={handleCreateUser} className="flex gap-2">
          <Input
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder="Choose a user id, e.g. prasad-demo"
            required
            className="bg-card"
          />
          <Button type="submit">Get started</Button>
        </form>
        {error && (
          <Alert variant="destructive" className="text-left">
            <AlertCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-[880px] flex-col gap-4 px-5 pt-6 pb-16">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">ExampleHealth Wearables</h1>
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
              localStorage.removeItem(STORAGE_KEY)
              setUser(null)
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

      <Card>
        <CardHeader>
          <CardTitle className="font-mono text-xs font-medium tracking-widest text-muted-foreground uppercase">
            Timeline
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <Tabs value={metric} onValueChange={(v) => setMetric(v as Metric)}>
              <TabsList className="h-auto flex-wrap">
                {METRICS.map((m) => (
                  <TabsTrigger key={m.key} value={m.key}>
                    {m.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
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
          <TimelineChart
            userId={user.id}
            metric={metric}
            days={RANGES[range].days}
            resolution={RANGES[range].resolution}
            liveVersion={liveVersion}
          />
        </CardContent>
      </Card>
    </div>
  )
}
