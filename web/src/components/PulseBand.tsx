import { motion, useReducedMotion } from 'motion/react'

/*
 * Ambient heart-rate band for the onboarding hero. A single smooth trace
 * with two gentle beats, drawn once on entrance, then a soft gradient fill
 * that breathes on a slow loop. Pure SVG, no data, purely decorative.
 */

const TRACE =
  'M0 96 C60 96 92 88 132 90 S214 100 254 96 L290 96 L304 66 L316 118 L328 82 L338 96 L386 96 ' +
  'C426 96 458 86 498 88 S570 102 610 96 L646 96 L660 62 L672 122 L684 80 L694 96 L742 96 ' +
  'C782 96 814 90 846 92 S884 96 900 95'

const AREA = `${TRACE} L900 140 L0 140 Z`

export function PulseBand() {
  const reducedMotion = useReducedMotion()

  return (
    <svg
      viewBox="0 0 900 140"
      fill="none"
      aria-hidden="true"
      preserveAspectRatio="none"
      className="h-24 w-full sm:h-32"
    >
      <defs>
        <linearGradient id="pulse-band-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.16" />
          <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {reducedMotion ? (
        <>
          <path d={AREA} fill="url(#pulse-band-fill)" />
          <path
            d={TRACE}
            stroke="var(--brand)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : (
        <>
          <motion.g
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1.6, ease: 'easeOut', delay: 1.1 }}
          >
            <motion.path
              d={AREA}
              fill="url(#pulse-band-fill)"
              animate={{ opacity: [0.55, 1, 0.55] }}
              transition={{ duration: 6, ease: 'easeInOut', repeat: Infinity }}
            />
          </motion.g>
          <motion.path
            d={TRACE}
            stroke="var(--brand)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 2.4, ease: 'easeInOut', delay: 0.35 }}
          />
        </>
      )}
    </svg>
  )
}
