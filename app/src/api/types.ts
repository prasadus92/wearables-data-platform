export type ConnectionStatus = 'connected' | 'expired' | 'disconnected';

/** Aggregator environment a session lives in. Demo maps to sandbox, Live to production. */
export type AggregatorEnv = 'sandbox' | 'production';

export type MetricKey =
  | 'heartrate'
  | 'hrv'
  | 'spo2'
  | 'respiratory_rate'
  | 'blood_pressure';

export type Resolution = 'raw' | 'hour' | 'day' | 'week';

export interface ApiUser {
  id: string;
  client_user_id: string;
  aggregator_user_id: string | null;
  aggregator_environment?: string;
  created_at: string;
}

export interface Device {
  id: string;
  provider: string;
  status: ConnectionStatus;
  device_meta: Record<string, unknown> | null;
  connected_at: string;
  last_data_at: string | null;
}

export interface LinkOut {
  link_token: string;
  link_url: string;
}

export interface TimeseriesPoint {
  ts: string;
  value: number;
  value_secondary: number | null;
}

export interface TimeseriesOut {
  metric: MetricKey;
  unit: string;
  resolution: Resolution;
  start: string;
  end: string;
  points: TimeseriesPoint[];
}
