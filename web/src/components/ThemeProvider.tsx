import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

/**
 * Class-strategy theming: three states (system, light, dark) persisted in
 * localStorage, resolved to a `.dark` class on <html> so the Tailwind v4
 * dark variant and the CSS token sets do the rest. Default is system, and
 * the system theme tracks the OS live via matchMedia.
 */
export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const THEME_KEY = 'wearables-theme'

interface ThemeContextValue {
  /** The stored preference, possibly 'system'. */
  theme: ThemePreference
  /** What is actually on screen right now. */
  resolved: ResolvedTheme
  setTheme: (theme: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function loadPreference(): ThemePreference {
  const saved = localStorage.getItem(THEME_KEY)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** Background colors per theme, mirrored into <meta name="theme-color">. */
const THEME_COLORS: Record<ResolvedTheme, string> = {
  light: '#f7f6f3',
  dark: '#121111',
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(loadPreference)
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme)
  const resolved: ResolvedTheme = theme === 'system' ? system : theme

  // Track the OS preference while in system mode.
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystem(query.matches ? 'dark' : 'light')
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  // Apply the resolved theme to <html>. A short-lived helper class gives
  // every surface one soft cross-fade; correctness never depends on it.
  const switchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const firstPaint = useRef(true)
  useEffect(() => {
    const root = document.documentElement
    if (!firstPaint.current) {
      root.classList.add('theme-switching')
      if (switchTimer.current) clearTimeout(switchTimer.current)
      switchTimer.current = setTimeout(
        () => root.classList.remove('theme-switching'),
        300,
      )
    }
    firstPaint.current = false
    root.classList.toggle('dark', resolved === 'dark')
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', THEME_COLORS[resolved])
  }, [resolved])

  useEffect(
    () => () => {
      if (switchTimer.current) clearTimeout(switchTimer.current)
    },
    [],
  )

  const setTheme = useCallback((next: ThemePreference) => {
    setThemeState(next)
    if (next === 'system') localStorage.removeItem(THEME_KEY)
    else localStorage.setItem(THEME_KEY, next)
  }, [])

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolved, setTheme }),
    [theme, resolved, setTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
