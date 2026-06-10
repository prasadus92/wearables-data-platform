// Thin typed client for the backend API.
// In dev, Vite proxies /v1 to localhost:8000; in production builds the base
// URL comes from VITE_API_URL.

const BASE = import.meta.env.VITE_API_URL ?? ''
const API_KEY = import.meta.env.VITE_API_KEY ?? ''

/** EventSource cannot set headers, so the stream URL carries the key. */
export function streamUrl(userId: string): string {
  const suffix = API_KEY ? `?api_key=${encodeURIComponent(API_KEY)}` : ''
  return `${BASE}/v1/users/${userId}/stream${suffix}`
}

export type Metric = 'heartrate' | 'hrv' | 'spo2' | 'respiratory_rate' | 'blood_pressure'
export type Resolution = 'raw' | 'hour' | 'day' | 'week'

export type JunctionEnv = 'sandbox' | 'production'

export interface User {
  id: string
  client_user_id: string
  junction_user_id: string | null
  junction_environment: JunctionEnv
}

export interface Device {
  id: string
  provider: string
  status: 'connected' | 'expired' | 'disconnected'
  connected_at: string
  last_data_at: string | null
}

export interface TimeseriesPoint {
  ts: string
  value: number
  value_secondary: number | null
}

export interface Timeseries {
  metric: Metric
  unit: string
  resolution: Resolution
  points: TimeseriesPoint[]
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(API_KEY ? { 'X-API-Key': API_KEY } : {}),
    },
    ...init,
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`${response.status}: ${body.slice(0, 200)}`)
  }
  if (response.status === 204) return undefined as T
  return response.json()
}

export const api = {
  createUser: (clientUserId: string, environment: JunctionEnv = 'sandbox') =>
    request<User>('/v1/users', {
      method: 'POST',
      body: JSON.stringify({ client_user_id: clientUserId, environment }),
    }),

  listDevices: (userId: string) => request<Device[]>(`/v1/users/${userId}/devices`),

  createLink: (userId: string, provider: string) =>
    request<{ link_url: string }>(`/v1/users/${userId}/devices/link`, {
      method: 'POST',
      body: JSON.stringify({ provider, redirect_url: window.location.origin }),
    }),

  connectDemo: (userId: string, provider: string) =>
    request<unknown>(`/v1/users/${userId}/devices/demo`, {
      method: 'POST',
      body: JSON.stringify({ provider }),
    }),

  disconnect: (userId: string, provider: string) =>
    request<void>(`/v1/users/${userId}/devices/${provider}`, { method: 'DELETE' }),

  sync: (userId: string) =>
    request<{ status: string; jobs: number }>(`/v1/users/${userId}/sync`, { method: 'POST' }),

  timeseries: (userId: string, metric: Metric, resolution: Resolution, days: number) => {
    const end = new Date()
    const start = new Date(end.getTime() - days * 24 * 3600 * 1000)
    const params = new URLSearchParams({
      start: start.toISOString(),
      end: end.toISOString(),
      resolution,
    })
    return request<Timeseries>(`/v1/users/${userId}/timeseries/${metric}?${params}`)
  },
}
