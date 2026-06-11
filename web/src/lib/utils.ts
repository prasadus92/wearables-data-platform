import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Provider slugs as the backend stores them, mapped to the names users know.
// Slugs outside the product list fall back to a simple capitalization.
const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  whoop_v2: 'WHOOP',
  oura: 'Oura',
  garmin: 'Garmin',
  fitbit: 'Fitbit',
}

export function providerDisplayName(slug: string): string {
  return PROVIDER_DISPLAY_NAMES[slug] ?? slug.charAt(0).toUpperCase() + slug.slice(1)
}

/** "Oura", "Oura and Fitbit", "Oura, Fitbit and WHOOP". */
export function formatNameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** Compact relative age: "just now", "5m ago", "3h ago", "2d ago". */
export function relativeTime(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/**
 * Status badge tones shared by the activity feed and the device list, so a
 * "connected" device and a "processed" event read as the same kind of good.
 */
export const BADGE_TONES = {
  positive: 'border-emerald-200 bg-emerald-50 tracking-wide text-emerald-700 uppercase',
  warning: 'border-amber-200 bg-amber-50 tracking-wide text-amber-700 uppercase',
  lifecycle: 'border-violet-200 bg-violet-50 tracking-wide text-violet-700 uppercase',
} as const
