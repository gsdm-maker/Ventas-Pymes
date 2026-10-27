import { Link, useLocation } from 'react-router-dom'
import { Building2, Users, ScrollText, ShieldCheck, Sparkles } from 'lucide-react'
import { cn } from '@/lib/cn'

const tabs = [
  { to: '/admin', label: 'Resumen', icon: ShieldCheck },
  { to: '/admin/empresas', label: 'Empresas', icon: Building2 },
  { to: '/admin/asistente', label: 'Asistente IA', icon: Sparkles },
  { to: '/admin/owners', label: 'Admins generales', icon: Users },
  { to: '/admin/actividad', label: 'Actividad', icon: ScrollText }
]

export function AdminTabs() {
  const { pathname } = useLocation()
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2 border-b border-border pb-3">
      <span className="mr-2 flex items-center gap-1.5 text-sm font-semibold text-fg">
        <ShieldCheck size={16} className="text-accent" />
        Consola general
      </span>
      {tabs.map((t) => (
        <Link
          key={t.to}
          to={t.to}
          className={cn(
            'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
            pathname === t.to ? 'bg-accent-soft text-accent' : 'text-fg-muted hover:bg-surface'
          )}
        >
          <t.icon size={14} />
          {t.label}
        </Link>
      ))}
    </div>
  )
}

export { Users }
