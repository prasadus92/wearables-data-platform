import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme, type ThemePreference } from './ThemeProvider'
import { cn } from '@/lib/utils'

const OPTIONS: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: 'light', label: 'Light theme', Icon: Sun },
  { value: 'system', label: 'Follow system theme', Icon: Monitor },
  { value: 'dark', label: 'Dark theme', Icon: Moon },
]

/**
 * Compact three-state theme switch (sun / system / moon), shared by the
 * app header and the onboarding corner. Styled like the header chips.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  return (
    <div
      role="radiogroup"
      aria-label="Color theme"
      className={cn(
        'flex items-center gap-0.5 rounded-full border bg-card p-0.5',
        className,
      )}
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = theme === value
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={cn(
              'flex size-6 cursor-pointer items-center justify-center rounded-full transition-colors',
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-3.5" />
          </button>
        )
      })}
    </div>
  )
}
