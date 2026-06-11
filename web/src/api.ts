// Thin typed client for the backend API.
// In dev, Vite proxies /v1 to localhost:8000; in production builds the base
// URL comes from VITE_API_URL.
// Response and request contract types live in @examplehealth/health-core, shared
// with the mobile app; only the request plumbing is web-specific.

import type {
  ActivityEvent,
  Device,
  AggregatorEnv,
  Metric,
  Resolution,
  Timeseries,
  User,
} from '@examplehealth/health-core'

const BASE = import.meta.env.VITE_API_URL ?? ''
const API_KEY = import.meta.env.VITE_API_KEY ?? ''

// Credential chain, strongest identity first: a signed-in Clerk session
// (AuthBridge registers a provider yielding a session JWT), else the active
// guest session's token (AppShell registers it when the active session
// changes), else the build-time static API key. Keyless builds therefore run
// the whole guest flow on the guest token alone.
type TokenProvider = () => Promise<string | null>
let tokenProvider: TokenProvider | null = null
let guestToken: string | null = null

export function setTokenProvider(fn: TokenProvider | null): void {
  tokenProvider = fn
}

/** AppShell calls this whenever the active session changes; null clears it. */
export function setGuestToken(token: string | null): void {
  guestToken = token
}

async function authToken(): Promise<string | null> {
  // Clerk's getToken can transiently return null while a session revalidates
  // (frequent on dev instances). A naked request would 401 on keyless builds,
  // so retry briefly before falling back to the guest token.
  if (tokenProvider) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // getToken can hang during the Clerk handshake on a hard page load;
        // an unbounded await here freezes every chart on a skeleton. Bound
        // each attempt and fall through, the caller surfaces a retry.
        const token = await Promise.race<string | null>([
          tokenProvider(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
        ])
        if (token) return token
      } catch {
        // fall through to retry
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  return guestToken
}

/** Backend GuestOut: the new user plus its one-time session token. */
export type GuestUser = User & { guest_token: string }

/** EventSource cannot set headers, so the stream URL carries the credential. */
export async function streamUrl(userId: string): Promise<string> {
  const credential = (await authToken()) ?? API_KEY
  const suffix = credential ? `?api_key=${encodeURIComponent(credential)}` : ''
  return `${BASE}/v1/users/${userId}/stream${suffix}`
}

async function requestOnce(path: string, init?: RequestInit): Promise<Response> {
  const token = await authToken()
  return fetch(`${BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token
        ? { Authorization: `Bearer ${token}` }
        : API_KEY
          ? { 'X-API-Key': API_KEY }
          : {}),
    },
    ...init,
  })
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response = await requestOnce(path, init)
  if (response.status === 401) {
    // Slow networks can lose the token-acquisition race on the first try;
    // one quiet retry with a fresh token resolves it without a scary banner.
    await new Promise((resolve) => setTimeout(resolve, 800))
    response = await requestOnce(path, init)
  }
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`${response.status}: ${body.slice(0, 200)}`)
  }
  if (response.status === 204) return undefined as T
  return response.json()
}

export const api = {
  createUser: (clientUserId: string, environment: AggregatorEnv = 'sandbox') =>
    request<User>('/v1/users', {
      method: 'POST',
      body: JSON.stringify({ client_user_id: clientUserId, environment }),
    }),

  /** Start an explicit guest session; the identity is minted server-side.
   * The response carries guest_token exactly once; persist it. */
  guests: (environment: AggregatorEnv = 'sandbox') =>
    request<GuestUser>('/v1/guests', {
      method: 'POST',
      body: JSON.stringify({ environment }),
    }),

  /** Bootstrap the signed-in identity: gets-or-creates its user per mode. */
  me: (environment: AggregatorEnv = 'sandbox') =>
    request<User>('/v1/me', {
      method: 'POST',
      body: JSON.stringify({ environment }),
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

  applePairingCode: (userId: string) =>
    request<{ code: string; expires_at: string }>(
      `/v1/users/${userId}/devices/apple-pairing-code`,
      { method: 'POST' },
    ),
  disconnect: (userId: string, provider: string) =>
    request<void>(`/v1/users/${userId}/devices/${provider}`, { method: 'DELETE' }),

  events: (userId: string, limit = 50) =>
    request<ActivityEvent[]>(`/v1/users/${userId}/events?limit=${limit}`),

  sync: (userId: string) =>
    request<{ status: string; jobs: number }>(`/v1/users/${userId}/sync`, { method: 'POST' }),

  timeseries: (
    userId: string,
    metric: Metric,
    resolution: Resolution,
    days: number,
    provider?: string,
  ) => {
    const end = new Date()
    const start = new Date(end.getTime() - days * 24 * 3600 * 1000)
    const params = new URLSearchParams({
      start: start.toISOString(),
      end: end.toISOString(),
      resolution,
    })
    if (provider) params.set('provider', provider)
    return request<Timeseries>(`/v1/users/${userId}/timeseries/${metric}?${params}`)
  },
}
