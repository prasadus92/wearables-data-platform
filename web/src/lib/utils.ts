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
