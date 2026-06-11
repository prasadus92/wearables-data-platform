import type { CSSProperties } from 'react'
import type { ResolvedTheme } from '@/components/ThemeProvider'

/**
 * Recharts cannot read CSS custom properties in every prop (gradient stops,
 * tooltip styles), so all per-theme chart colors live here, keyed by the
 * resolved theme. Light keeps the editorial red-line look; dark mirrors the
 * mobile biomarkers card: green line with a soft green fill on the teal
 * surface, faint white grid, light axis labels, white typical-range band,
 * and an inverted tooltip.
 */
export interface ChartTheme {
  /** Primary series stroke (systolic for blood pressure). */
  line: string
  /** Secondary series stroke (diastolic). */
  lineSecondary: string
  /** Soft area fill under the primary line: gradient stops and opacities. */
  fillFrom: string
  fillFromOpacity: number
  fillToOpacity: number
  grid: string
  axis: string
  /** Clinical reference band fill and label color. */
  clinicalBand: string
  clinicalBandOpacity: number
  /** Personal typical-range band fill and opacity. */
  typicalBand: string
  typicalBandOpacity: number
  bandLabel: string
  tooltip: CSSProperties
}

export const CHART_THEMES: Record<ResolvedTheme, ChartTheme> = {
  light: {
    line: '#e8554d',
    lineSecondary: '#4d7ce8',
    fillFrom: '#e8554d',
    fillFromOpacity: 0,
    fillToOpacity: 0,
    grid: '#e8e7e3',
    axis: '#8f8f8f',
    clinicalBand: '#4d7ce8',
    clinicalBandOpacity: 0.05,
    typicalBand: '#8f8f8f',
    typicalBandOpacity: 0.06,
    bandLabel: '#8f8f8f',
    tooltip: {
      borderRadius: 12,
      border: '1px solid #e8e7e3',
      background: '#ffffff',
      color: '#1c1c1e',
      fontSize: 12,
    },
  },
  dark: {
    line: '#0ed187',
    lineSecondary: '#f54ef0',
    fillFrom: '#0ed187',
    fillFromOpacity: 0.32,
    fillToOpacity: 0,
    grid: 'rgba(255, 255, 255, 0.14)',
    axis: 'rgba(255, 255, 255, 0.62)',
    clinicalBand: '#ffffff',
    clinicalBandOpacity: 0.05,
    typicalBand: '#ffffff',
    typicalBandOpacity: 0.08,
    bandLabel: 'rgba(255, 255, 255, 0.62)',
    // Inverted on the teal card: a light surface with ink text.
    tooltip: {
      borderRadius: 12,
      border: '1px solid rgba(255, 255, 255, 0.2)',
      background: '#f7f6f3',
      color: '#1c1c1e',
      fontSize: 12,
    },
  },
}
