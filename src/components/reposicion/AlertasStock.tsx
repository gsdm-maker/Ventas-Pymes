import { Link } from 'react-router-dom'
import { BellRing } from 'lucide-react'
import { useAlertasStock } from '@/core/data/useAlertasStock'
import { cn } from '@/lib/cn'

/** Campana de la barra superior: quebrados + por quebrar hasta el domingo. */
export function CampanaAlertas() {
  const { habilitado, quebrados, porQuebrar } = useAlertasStock()
  if (!habilitado) return null
  const n = quebrados.length + porQuebrar.length
  const etiqueta =
    n === 0
      ? 'Alertas de stock: sin alertas'
      : `Alertas de stock: ${quebrados.length} quebrados, ${porQuebrar.length} por quebrar`
  return (
    <Link
      to="/reposicion"
      aria-label={etiqueta}
      title={etiqueta}
      className="relative grid size-9 place-items-center rounded-lg border border-border text-fg-muted transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
    >
      <BellRing size={16} aria-hidden />
      {n > 0 && (
        <span
          className={cn(
            'absolute -right-1.5 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-[10px] font-semibold tabular-nums text-white',
            quebrados.length > 0 ? 'bg-danger' : 'bg-warning'
          )}
        >
          {n > 99 ? '99+' : n}
        </span>
      )}
    </Link>
  )
}
