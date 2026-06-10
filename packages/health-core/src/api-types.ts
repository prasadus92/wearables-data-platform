// Shared API contract types for the backend's public schemas
// (backend/app/schemas.py). Field names match the Pydantic models exactly;
// datetimes arrive as ISO strings, UUIDs as strings. This is the superset
// both clients consume; client-specific request plumbing stays in each app.

/** Biomarkers in scope (backend Metric enum). */
export type Metric =
  | 'heartrate'
  | 'hrv'
  | 'spo2'
  | 'respiratory_rate'
  | 'blood_pressure';

/** Timeline chart bucket sizes (backend Resolution enum). */
export type Resolution = 'raw' | 'hour' | 'day' | 'week';

/** Aggregator environment a session lives in. Demo maps to sandbox, Live to production. */
export type AggregatorEnv = 'sandbox' | 'production';

/** Device connection lifecycle (backend ConnectionStatus enum). */
export type ConnectionStatus = 'connected' | 'expired' | 'disconnected';

/** Ingestion event outcome (backend WebhookEventStatus enum). */
export type ActivityEventStatus = 'received' | 'processed' | 'failed' | 'skipped';

/** Backend UserOut. */
export interface User {
  id: string;
  client_user_id: string;
  aggregator_user_id: string | null;
  aggregator_environment: AggregatorEnv;
  created_at: string;
}

/** Backend ConnectionOut. */
export interface Device {
  id: string;
  provider: string;
  status: ConnectionStatus;
  device_meta: Record<string, unknown> | null;
  connected_at: string;
  last_data_at: string | null;
}

/** Backend EventOut: one ingestion event in a user's activity feed. */
export interface ActivityEvent {
  id: string;
  event_type: string;
  status: ActivityEventStatus;
  received_at: string;
  processed_at: string | null;
  summary: string;
}

/** Backend TimeseriesPoint. value_secondary is diastolic for blood_pressure, null otherwise. */
export interface TimeseriesPoint {
  ts: string;
  value: number;
  value_secondary: number | null;
}

/** Backend TimeseriesOut. */
export interface Timeseries {
  metric: Metric;
  unit: string;
  resolution: Resolution;
  start: string;
  end: string;
  points: TimeseriesPoint[];
}
