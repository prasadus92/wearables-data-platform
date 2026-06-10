// Plain-language metadata for each metric, so the dashboard is legible to
// someone with no background in health data. Wording is deliberately
// non-diagnostic: it describes what a signal reflects, never what a value
// "means" for a specific person.

import type { MetricKey } from '../api/types';

/**
 * Which direction is generally considered favorable for a metric.
 * - 'higher': larger values generally track with better recovery or capacity
 * - 'lower': smaller values generally track with rest
 * - 'range': values are expected to sit inside a band
 * - 'personal': only meaningful relative to your own baseline
 */
export type GoodDirection = 'higher' | 'lower' | 'range' | 'personal';

/**
 * A reference band that is defensible from broad clinical guidance.
 * Only defined for metrics where population-level ranges are meaningful;
 * heart rate and HRV deliberately have none, because typical values vary so
 * much between people that a fixed band would mislead.
 */
export interface ClinicalBand {
  min?: number;
  max?: number;
  label: string;
}

export interface MetricMeta {
  friendlyName: string;
  shortExplanation: string;
  unitLabel: string;
  goodDirection: GoodDirection;
  clinicalBand?: ClinicalBand;
  /** For dual-series metrics (blood pressure), a band for the secondary line. */
  clinicalBandSecondary?: ClinicalBand;
}

export const METRIC_META: Record<MetricKey, MetricMeta> = {
  heartrate: {
    friendlyName: 'Heart Rate',
    shortExplanation:
      'How many times your heart beats per minute. It naturally rises with movement, stress, caffeine, or heat, and settles when you rest. Comparing against your own typical range is more useful than any fixed number, since normal resting rates vary a lot between people.',
    unitLabel: 'bpm',
    goodDirection: 'personal',
  },
  hrv: {
    friendlyName: 'Heart Rate Variability',
    shortExplanation:
      'The tiny variation in time between heartbeats, measured in milliseconds. Higher values for you generally track with feeling rested and recovered, while late nights, illness, or hard training can pull it down for a day or two. Typical values differ widely between people, so only your own trend is meaningful.',
    unitLabel: 'ms',
    goodDirection: 'higher',
  },
  spo2: {
    friendlyName: 'Blood Oxygen',
    shortExplanation:
      'The percentage of oxygen your red blood cells are carrying. Most people sit in the high 90s most of the time, and small dips can happen during sleep or at altitude. Wearable readings can also wobble simply from how the sensor sits on your skin.',
    unitLabel: '%',
    goodDirection: 'range',
    clinicalBand: { min: 95, label: 'typical healthy range' },
  },
  respiratory_rate: {
    friendlyName: 'Breathing Rate',
    shortExplanation:
      'How many breaths you take per minute, usually measured while you sleep. It tends to stay remarkably steady from night to night, which is what makes it useful: a clear shift from your usual rate often just reflects a change in sleep, exercise load, or a cold coming on.',
    unitLabel: 'breaths/min',
    goodDirection: 'range',
    clinicalBand: { min: 12, max: 20, label: 'typical adult range' },
  },
  blood_pressure: {
    friendlyName: 'Blood Pressure',
    shortExplanation:
      'The pressure of blood against your artery walls, written as two numbers: systolic (when the heart squeezes) over diastolic (when it relaxes). It moves through the day with activity, posture, and stress, so single readings matter less than the pattern over time.',
    unitLabel: 'mmHg',
    goodDirection: 'range',
    clinicalBand: { min: 90, max: 120, label: 'typical systolic range' },
  },
};
