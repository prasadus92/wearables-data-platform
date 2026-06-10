import { motion } from 'motion/react'
import type * as React from 'react'
import { Button } from '@/components/ui/button'

/** Shared spring for entrances and layout reflows: quick, physical, no bounce. */
export const springTransition = { type: 'spring', stiffness: 420, damping: 34 } as const

/**
 * shadcn Button with a subtle press response. Uses asChild so the rendered
 * element is a real motion.button and keeps every Button variant and prop.
 */
export function TapButton({ children, ...props }: React.ComponentProps<typeof Button>) {
  return (
    <Button asChild {...props}>
      <motion.button
        whileTap={{ scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 520, damping: 32 }}
      >
        {children}
      </motion.button>
    </Button>
  )
}
