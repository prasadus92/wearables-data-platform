import { Link, useLocation } from 'react-router-dom'

/** Section switcher styled after the card titles: mono, uppercase, quiet. */
export function SectionNav() {
  const { pathname } = useLocation()
  const links = [
    { to: '/metrics/heartrate', label: 'Timeline', active: pathname.startsWith('/metrics') },
    { to: '/devices', label: 'Devices', active: pathname.startsWith('/devices') },
    { to: '/activity', label: 'Activity', active: pathname.startsWith('/activity') },
  ]
  return (
    <nav aria-label="Dashboard sections" className="flex items-center gap-4 border-b pb-2">
      {links.map((link) => (
        <Link
          key={link.to}
          to={link.to}
          aria-current={link.active ? 'page' : undefined}
          className={`font-mono text-xs font-medium tracking-widest uppercase transition-colors ${
            link.active
              ? 'text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  )
}
