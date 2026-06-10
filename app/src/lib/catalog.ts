import type { MetricKey, Resolution } from '../api/types';

export interface ProviderInfo {
  slug: string;
  name: string;
  blurb: string;
  /** Sandbox demo connect available for this provider. */
  demo: boolean;
}

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
];

export function providerName(slug: string): string {
  return PROVIDERS.find((p) => p.slug === slug)?.name ?? slug;
}

export interface MetricInfo {
  key: MetricKey;
  label: string;
  /** Blood pressure plots systolic and diastolic as two lines. */
  dual: boolean;
}

export const METRICS: MetricInfo[] = [
  { key: 'heartrate', label: 'Heart Rate', dual: false },
  { key: 'hrv', label: 'HRV', dual: false },
  { key: 'spo2', label: 'SpO2', dual: false },
  { key: 'respiratory_rate', label: 'Resp Rate', dual: false },
  { key: 'blood_pressure', label: 'Blood Pressure', dual: true },
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
