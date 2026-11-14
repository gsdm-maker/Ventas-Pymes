import { useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { TituloSlotContext } from '@/components/layout/tituloSlot'
import { useMediaQuery } from '@/hooks/useMediaQuery'

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-5 animate-spin text-accent', className)} />
}

export function LoadingState({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-sm text-fg-muted">
      <div className="rounded-2xl bg-surface p-4">
        <Spinner className="size-6" />
      </div>
      <p>{label}</p>
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className
}: {
  icon?: ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border px-6 py-14 text-center',
        className
      )}
    >
      {icon && <div className="mb-2 rounded-2xl bg-surface p-3 text-fg-faint">{icon}</div>}
      <p className="text-balance text-sm font-semibold text-fg">{title}</p>
      {description && <p className="max-w-xs text-xs leading-relaxed text-fg-muted">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

export function PageHeader({
  title,
  subtitle,
  actions
}: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  // En escritorio título y acciones van a la barra superior (ahorra alto en todas las
  // pantallas). En móvil todo sigue dentro de la página. Las acciones se montan en un
  // solo lugar a la vez para no duplicar botones ni ids.
  const slot = useContext(TituloSlotContext)
  const escritorio = useMediaQuery('(min-width: 1024px)')
  if (slot && escritorio) {
    return createPortal(
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="shrink-0 text-base font-semibold tracking-tight text-fg">{title}</h1>
          {subtitle && <p className="truncate text-sm text-fg-muted">{subtitle}</p>}
        </div>
        {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
      </div>,
      slot
    )
  }
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-balance text-xl font-semibold tracking-tight text-fg">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-fg-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
