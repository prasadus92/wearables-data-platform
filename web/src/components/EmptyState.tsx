import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Centered empty-state shell shared by the timeline chart and the activity
 * feed: a fixed-height column for a short headline, supporting copy, and a
 * working CTA. Callers pass the height so the shell matches the content it
 * stands in for.
 */
export function EmptyState({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-4 px-10 text-center',
        className,
      )}
    >
      {children}
    </div>
  )
}
