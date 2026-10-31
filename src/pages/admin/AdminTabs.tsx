import { useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ShieldCheck, Users } from 'lucide-react'
import { ADMIN_NAV } from '@/components/layout/nav'
import { cn } from '@/lib/cn'

export function AdminTabs() {
  const { pathname } = useLocation()
  const activa = (to: string) => (to === '/admin' ? pathname === to : pathname.startsWith(to))
  const fila = useRef<HTMLElement>(null)
  // En el celular, deslizar la fila hasta la pestaña activa (si no, «Actividad» queda fuera)
  useEffect(() => {
    const nav = fila.current
    const el = nav?.querySelector<HTMLElement>('[aria-current="page"]')
    if (nav && el) nav.scrollLeft = el.offsetLeft - (nav.clientWidth - el.offsetWidth) / 2
  }, [pathname])
  return (
    // En el celular las pestañas van en una fila que se desliza (no se apilan en 3 líneas)
    <div className="-mx-4 mb-5 border-b border-border px-4 pb-3 lg:mx-0 lg:px-0">
      <nav
        ref={fila}
        aria-label="Secciones de la consola general"
        className="relative flex items-center gap-2 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <span className="mr-2 hidden shrink-0 items-center gap-1.5 text-sm font-semibold text-fg lg:flex">
          <ShieldCheck size={16} className="text-accent" />
          Consola general
        </span>
        {ADMIN_NAV.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            aria-current={activa(t.to) ? 'page' : undefined}
            className={cn(
              'flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-xs font-medium transition-colors',
              activa(t.to) ? 'bg-accent-soft text-accent' : 'text-fg-muted hover:bg-surface'
            )}
          >
            <t.icon size={14} />
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  )
}

export { Users }
