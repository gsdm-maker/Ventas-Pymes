import type { UsoPlan, UsoRecurso } from '@/core/types'
import { estadoTope, porcentajeTope } from '@/lib/niveles'
import { formatMiles } from '@/lib/format'
import { cn } from '@/lib/cn'
import { AvisoSubirPlan } from '@/components/plan/AvisoSubirPlan'

const RECURSOS: { clave: 'productos' | 'ubicaciones' | 'usuarios'; label: string; plural: string }[] = [
  { clave: 'productos', label: 'Productos', plural: 'productos' },
  { clave: 'ubicaciones', label: 'Locales (tiendas y bodegas)', plural: 'locales' },
  { clave: 'usuarios', label: 'Usuarios', plural: 'usuarios' }
]

/** Barras de uso de productos, locales y usuarios frente a los topes del plan. */
export function MedidoresPlan({ uso }: { uso: UsoPlan }) {
  const llenos = RECURSOS.filter((r) => estadoTope(uso[r.clave]) === 'lleno')
  const cerca = RECURSOS.filter((r) => estadoTope(uso[r.clave]) === 'cerca')

  return (
    <div className="space-y-3">
      <ul className="space-y-2.5">
        {RECURSOS.map((r) => (
          <Medidor key={r.clave} label={r.label} uso={uso[r.clave]} />
        ))}
      </ul>
      {llenos.length > 0 ? (
        <AvisoSubirPlan
          mensaje={`Llegaste al límite de ${llenos.map((r) => r.plural).join(' y ')} de tu plan. Lo que tienes sigue funcionando; para agregar más, sube de plan.`}
        />
      ) : (
        cerca.length > 0 && (
          <AvisoSubirPlan
            tono="info"
            mensaje={`Estás cerca del límite de ${cerca.map((r) => r.plural).join(' y ')} de tu plan.`}
          />
        )
      )}
    </div>
  )
}

/** Una barra de uso frente a su tope (también la usa la consola general). */
export function Medidor({ label, uso }: { label: string; uso: UsoRecurso }) {
  const pct = porcentajeTope(uso)
  const estado = estadoTope(uso)
  return (
    <li>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-fg-body">{label}</span>
        <span className={cn('tabular-nums', estado === 'lleno' ? 'font-semibold text-warning' : 'text-fg-muted')}>
          {formatMiles(uso.usados)} {uso.tope === null ? '· sin límite' : `de ${formatMiles(uso.tope)}`}
        </span>
      </div>
      {pct !== null && (
        <div
          className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2"
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={uso.tope ?? 0}
          aria-valuenow={uso.usados}
        >
          <div
            className={cn('h-full rounded-full', estado === 'lleno' ? 'bg-warning' : estado === 'cerca' ? 'bg-info' : 'bg-accent')}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </li>
  )
}
