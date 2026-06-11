import {
  METRIC_META,
  type Metric,
  type Resolution,
} from '@examplehealth/health-core';

export interface ProviderInfo {
  slug: string;
  name: string;
  blurb: string;
  /** Sandbox demo connect available for this provider. */
  demo: boolean;
}

/**
 * Provider slug for Apple Watch. HealthKit data leaves an iPhone only
 * through an app with HealthKit entitlements, so this provider connects
 * via a pairing code and the Aggregator Connect bridge app instead of hosted
 * OAuth. The connect flow branches on this slug.
 */
export const APPLE_SLUG = 'apple_health_kit';

export const PROVIDERS: ProviderInfo[] = [
  {
    slug: 'oura',
    name: 'Oura',
    blurb: 'Smart ring for sleep, readiness and heart health.',
    demo: true,
  },
  {
    slug: 'whoop_v2',
    name: 'WHOOP',
    blurb: 'Strap focused on strain, recovery and sleep.',
    demo: false,
  },
  {
    slug: 'garmin',
    name: 'Garmin',
    blurb: 'Watches for training, endurance and daily health.',
    demo: false,
  },
  {
    slug: 'fitbit',
    name: 'Fitbit',
    blurb: 'Trackers and watches for everyday activity.',
    demo: true,
  },
  {
    slug: APPLE_SLUG,
    name: 'Apple Watch',
    blurb: 'Watch for activity, heart health and sleep.',
    demo: true,
  },
];

export function providerName(slug: string): string {
  return PROVIDERS.find((p) => p.slug === slug)?.name ?? slug;
}

export interface MetricInfo {
  key: Metric;
  label: string;
  /** Blood pressure plots systolic and diastolic as two lines. */
  dual: boolean;
}

// Tab labels come from the shared metric metadata, so the app and the web
// dashboard speak the same plain language.
export const METRICS: MetricInfo[] = [
  { key: 'heartrate', label: METRIC_META.heartrate.friendlyName, dual: false },
  { key: 'hrv', label: METRIC_META.hrv.friendlyName, dual: false },
  { key: 'spo2', label: METRIC_META.spo2.friendlyName, dual: false },
  {
    key: 'respiratory_rate',
    label: METRIC_META.respiratory_rate.friendlyName,
    dual: false,
  },
  {
    key: 'blood_pressure',
    label: METRIC_META.blood_pressure.friendlyName,
    dual: true,
  },
];

export interface RangeInfo {
  key: string;
  label: string;
  hours: number;
  resolution: Resolution;
}

export const RANGES: RangeInfo[] = [
  { key: '24h', label: '24h', hours: 24, resolution: 'hour' },
  { key: '7d', label: '7d', hours: 24 * 7, resolution: 'hour' },
  { key: '30d', label: '30d', hours: 24 * 30, resolution: 'day' },
  { key: '90d', label: '90d', hours: 24 * 90, resolution: 'week' },
];

export const DATA_WE_READ = [
  'Heart rate',
  'Heart rate variability (HRV)',
  'Blood oxygen (SpO2)',
  'Respiratory rate',
  'Blood pressure (where supported)',
];
