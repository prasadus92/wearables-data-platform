import { motion } from 'motion/react'
import { cn } from '@/lib/utils'

/**
 * Selector chip after the mobile home: mono uppercase label, fully rounded,
 * active chip filled, inactive outlined and translucent. Each chip stands
 * alone (no joined container) so a horizontally scrolled row reads as
 * individually scrollable items instead of a cut pill.
 *
 * Colors ride the theme tokens, so inside the dark chart card (where the
 * tokens are re-scoped to the on-teal palette) the active chip is white
 * with teal-ink text, exactly like the app.
 */
export function Chip({
  label,
  active,
  small,
  onClick,
}: {
  label: string
  active: boolean
  /** Range chips are the same family, one size down. */
  small?: boolean
  onClick: () => void
}) {
  return (
    <motion.button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      whileTap={{ scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 520, damping: 32 }}
      className={cn(
        'shrink-0 cursor-pointer rounded-full border font-mono tracking-[0.5px] whitespace-nowrap uppercase transition-colors',
        small ? 'px-3 py-1.5 text-[10px]' : 'px-4 py-2 text-[11px]',
        active
          ? 'border-transparent bg-primary text-primary-foreground'
          : 'border-border bg-accent/40 text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </motion.button>
  )
}
