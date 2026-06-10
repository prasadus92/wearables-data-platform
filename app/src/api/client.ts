import Constants from 'expo-constants';

import type {
  ApiUser,
  Device,
  LinkOut,
  MetricKey,
  Resolution,
  TimeseriesOut,
} from './types';

interface AppExtra {
  apiBaseUrl?: string;
  apiKey?: string;
}

const extra: AppExtra = (Constants.expoConfig?.extra as AppExtra) ?? {};
const BASE_URL = extra.apiBaseUrl ?? 'https://api.examplehealth.example.com';
const API_KEY = extra.apiKey ?? '';

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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/v1${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'X-API-Key': API_KEY,
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
  createUser(clientUserId: string, environment?: 'sandbox' | 'production') {
    return request<ApiUser>('/users', {
      method: 'POST',
      body: JSON.stringify({
        client_user_id: clientUserId,
        ...(environment ? { environment } : {}),
      }),
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
    metric: MetricKey,
    opts: { start: Date; end: Date; resolution: Resolution },
  ) {
    const params = new URLSearchParams({
      start: opts.start.toISOString(),
      end: opts.end.toISOString(),
      resolution: opts.resolution,
    });
    return request<TimeseriesOut>(
      `/users/${userId}/timeseries/${metric}?${params.toString()}`,
    );
  },
};
