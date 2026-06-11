import type {
  Device,
  AggregatorEnv,
  Metric,
  Resolution,
  Timeseries,
  User,
} from '@examplehealth/health-core';
import Constants from 'expo-constants';

import type { ApplePairingCode, LinkOut } from './types';

interface AppExtra {
  apiBaseUrl?: string;
  apiKey?: string;
}

const extra: AppExtra = (Constants.expoConfig?.extra as AppExtra) ?? {};
const BASE_URL = extra.apiBaseUrl ?? 'https://api.examplehealth.example.com';
const API_KEY = extra.apiKey ?? '';

// When a signed-in account session exists, App registers a provider that
// yields a fresh session JWT; every request then authenticates as that
// identity via Authorization: Bearer. With no provider (anonymous mode) the
// static API key flows exactly as before. Mirrors web/src/api.ts.
type TokenProvider = () => Promise<string | null>;
let tokenProvider: TokenProvider | null = null;

export function setTokenProvider(fn: TokenProvider | null): void {
  tokenProvider = fn;
}

async function authToken(): Promise<string | null> {
  if (!tokenProvider) return null;
  // Clerk's getToken can transiently return null while a session
  // revalidates; a naked request would 401 and the UI would misread the
  // failure as missing data. Retry briefly before giving up.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const token = await tokenProvider();
      if (token) return token;
    } catch {
      // fall through to retry
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const TIMEOUT_MS = 20000;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await authToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/v1${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        ...(token
          ? { Authorization: `Bearer ${token}` }
          : { 'X-API-Key': API_KEY }),
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });
  } catch (err) {
    throw new ApiError(0, err instanceof Error ? err.message : 'Network error');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (typeof body.detail === 'string') detail = body.detail;
    } catch {
      // non-JSON error body, keep the default message
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  createUser(clientUserId: string, environment?: AggregatorEnv) {
    return request<User>('/users', {
      method: 'POST',
      body: JSON.stringify({
        client_user_id: clientUserId,
        ...(environment ? { environment } : {}),
      }),
    });
  },

  /** Bootstrap the signed-in identity: gets-or-creates its user per mode. */
  me(environment: AggregatorEnv) {
    return request<User>('/me', {
      method: 'POST',
      body: JSON.stringify({ environment }),
    });
  },

  getDevices(userId: string) {
    return request<Device[]>(`/users/${userId}/devices`);
  },

  createLink(userId: string, provider: string, redirectUrl: string) {
    return request<LinkOut>(`/users/${userId}/devices/link`, {
      method: 'POST',
      body: JSON.stringify({ provider, redirect_url: redirectUrl }),
    });
  },

  /**
   * Apple Watch connect (Live): mints a single-use, short-lived pairing
   * code the user enters in the Aggregator Connect bridge app.
   */
  createApplePairingCode(userId: string) {
    return request<ApplePairingCode>(
      `/users/${userId}/devices/apple-pairing-code`,
      { method: 'POST' },
    );
  },

  connectDemo(userId: string, provider: string) {
    return request<{ connected: boolean; provider: string }>(
      `/users/${userId}/devices/demo`,
      { method: 'POST', body: JSON.stringify({ provider }) },
    );
  },

  disconnectDevice(userId: string, provider: string) {
    return request<void>(`/users/${userId}/devices/${provider}`, {
      method: 'DELETE',
    });
  },

  syncUser(userId: string) {
    return request<{ status: string }>(`/users/${userId}/sync`, {
      method: 'POST',
    });
  },

  getTimeseries(
    userId: string,
    metric: Metric,
    opts: {
      start: Date;
      end: Date;
      resolution: Resolution;
      /** Restrict the series to one device; omitted means all devices. */
      provider?: string;
    },
  ) {
    const params = new URLSearchParams({
      start: opts.start.toISOString(),
      end: opts.end.toISOString(),
      resolution: opts.resolution,
    });
    if (opts.provider) params.set('provider', opts.provider);
    return request<Timeseries>(
      `/users/${userId}/timeseries/${metric}?${params.toString()}`,
    );
  },
};
