import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PackageMinus, Plus, CloudOff, ShoppingCart, Undo2, ChevronRight, Receipt } from 'lucide-react'
import { listarVouchers } from '@/core/data/api'
import type { Voucher as VoucherT } from '@/core/types'
import { useAuth } from '@/core/auth/AuthProvider'
import { useSync } from '@/core/offline/SyncProvider'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { KpiCard } from '@/components/ui/KpiCard'
import { EmptyState, LoadingState, PageHeader } from '@/components/ui/Feedback'
import { cn } from '@/lib/cn'
import { aDia, formatCLP, formatDiaLargo, formatHora } from '@/lib/format'

type TipoListado = 'venta' | 'movimiento' | 'devolucion'
type Filtro = 'todos' | TipoListado

const TIPOS: Record<TipoListado, { label: string; plural: string; Icono: typeof Receipt; tile: string }> = {
  venta: { label: 'Venta', plural: 'Ventas', Icono: ShoppingCart, tile: 'bg-accent-soft text-accent' },
  movimiento: { label: 'Salida de stock', plural: 'Salidas de stock', Icono: PackageMinus, tile: 'bg-info-soft text-info' },
  devolucion: { label: 'Devolución', plural: 'Devoluciones', Icono: Undo2, tile: 'bg-warning-soft text-warning' }
}

type Detalle = { total?: number; cantidad?: number; venta?: string }

function etiquetaDia(dia: string, hoy: string, ayer: string): string {
  if (dia === hoy) return 'Hoy'
  if (dia === ayer) return 'Ayer'
  const largo = formatDiaLargo(dia)
  return largo.charAt(0).toUpperCase() + largo.slice(1)
}

export function Salidas() {
  const { can } = useAuth()
  const { pendientes } = useSync()
  const navigate = useNavigate()
  const [vouchers, setVouchers] = useState<VoucherT[]>([])
  const [cargando, setCargando] = useState(true)
  const [filtro, setFiltro] = useState<Filtro>('todos')

  useEffect(() => {
    listarVouchers()
      .then((v) => setVouchers(v.filter((x) => x.tipo === 'venta' || x.tipo === 'movimiento' || x.tipo === 'devolucion')))
      .finally(() => setCargando(false))
  }, [])

  const hoy = aDia(new Date())
  const ayer = aDia(new Date(Date.now() - 86400000))

  // Resumen del día (se calcula sobre todo, no sobre el filtro)
  const resumen = useMemo(() => {
    let comprobantes = 0
    let ventas = 0
    let unidades = 0
    for (const v of vouchers) {
      if (aDia(new Date(v.created_at)) !== hoy) continue
      const d = v.detalle as Detalle
      comprobantes++
      if (v.tipo === 'venta') ventas += d.total ?? 0
      if (v.tipo === 'devolucion') ventas -= d.total ?? 0
      if (v.tipo === 'movimiento') unidades += d.cantidad ?? 0
    }
    return { comprobantes, ventas, unidades }
  }, [vouchers, hoy])

  const conteo = useMemo(() => {
    const c: Record<Filtro, number> = { todos: vouchers.length, venta: 0, movimiento: 0, devolucion: 0 }
    for (const v of vouchers) c[v.tipo as TipoListado]++
    return c
  }, [vouchers])

  // Agrupado por día, en el orden que ya viene (más reciente primero)
  const grupos = useMemo(() => {
    const lista = filtro === 'todos' ? vouchers : vouchers.filter((v) => v.tipo === filtro)
    const out: { dia: string; items: VoucherT[] }[] = []
    for (const v of lista) {
      const dia = aDia(new Date(v.created_at))
      const ultimo = out[out.length - 1]
      if (ultimo?.dia === dia) ultimo.items.push(v)
      else out.push({ dia, items: [v] })
    }
    return out
  }, [vouchers, filtro])

  const puedeRegistrar = can('salidas.registrar')

  return (
    <>
      <PageHeader
        title="Salidas y vouchers"
        subtitle="Comprobantes internos de movimiento de inventario"
        actions={
          puedeRegistrar && (
            <Button onClick={() => navigate('/salidas/nueva')}>
              <Plus size={16} /> Nueva salida
            </Button>
          )
        }
      />

      {pendientes > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-warning/40 bg-warning-soft px-4 py-2.5 text-xs text-warning">
          <CloudOff size={14} /> {pendientes} operación(es) pendientes de sincronización.
        </div>
      )}

      {cargando ? (
        <LoadingState />
      ) : vouchers.length === 0 ? (
        <EmptyState
          icon={<PackageMinus size={32} />}
          title="Aún no hay salidas registradas"
          description="Las salidas y ventas generan un voucher interno que puedes consultar aquí."
          action={
            puedeRegistrar && <Button onClick={() => navigate('/salidas/nueva')}>Registrar primera salida</Button>
          }
        />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
            <KpiCard
              label="Comprobantes hoy"
              value={<span className="tabular-nums">{resumen.comprobantes}</span>}
              hint={`${conteo.todos} en el historial`}
              icon={<Receipt size={16} />}
              tone="neutral"
            />
            <KpiCard
              label="Vendido hoy"
              value={<span className="tabular-nums">{formatCLP(resumen.ventas)}</span>}
              hint="Ventas menos devoluciones"
              icon={<ShoppingCart size={16} />}
            />
            <KpiCard
              label="Unidades retiradas hoy"
              value={<span className="tabular-nums">{resumen.unidades}</span>}
              hint="Salidas de stock sin venta"
              icon={<PackageMinus size={16} />}
              tone="warning"
              className="col-span-2 lg:col-span-1"
            />
          </div>

          <div className="mb-4 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filtrar por tipo">
            {(['todos', 'venta', 'movimiento', 'devolucion'] as const).map((f) => (
              <button
                key={f}
                aria-pressed={filtro === f}
                onClick={() => setFiltro(f)}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                  filtro === f ? 'bg-accent text-on-accent shadow-sm' : 'bg-surface text-fg-muted hover:bg-surface-2'
                )}
              >
                {f === 'todos' ? 'Todos' : TIPOS[f].plural}
                <span className={cn('tabular-nums', filtro === f ? 'opacity-80' : 'text-fg-faint')}>{conteo[f]}</span>
              </button>
            ))}
          </div>

          {grupos.length === 0 ? (
            <Card className="px-5 py-10 text-center text-sm text-fg-muted">No hay comprobantes de este tipo.</Card>
          ) : (
            <div className="space-y-5">
              {grupos.map((g) => (
                <section key={g.dia} aria-label={etiquetaDia(g.dia, hoy, ayer)}>
                  <h2 className="mb-2 flex items-baseline justify-between px-1">
                    <span className="text-sm font-semibold text-fg">{etiquetaDia(g.dia, hoy, ayer)}</span>
                    <span className="text-xs tabular-nums text-fg-muted">
                      {g.items.length} {g.items.length === 1 ? 'comprobante' : 'comprobantes'}
                    </span>
                  </h2>
                  <Card className="overflow-hidden">
                    <ul className="divide-y divide-border">
                      {g.items.map((v) => {
                        const d = v.detalle as Detalle
                        const t = TIPOS[v.tipo as TipoListado]
                        const extra =
                          v.tipo === 'movimiento' && typeof d.cantidad === 'number'
                            ? `${d.cantidad} u.`
                            : v.tipo === 'devolucion' && d.venta
                              ? `de ${d.venta}`
                              : null
                        return (
                          <li key={v.id}>
                            <Link
                              to={`/voucher/${v.id}`}
                              className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface focus-visible:bg-surface focus-visible:outline-none sm:px-5"
                            >
                              <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', t.tile)}>
                                <t.Icono size={18} />
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium tabular-nums text-fg">{v.numero}</p>
                                <p className="truncate text-xs text-fg-muted">
                                  {t.label} · {formatHora(v.created_at)}
                                  {extra && ` · ${extra}`}
                                </p>
                              </div>
                              <div className="flex shrink-0 flex-col items-end gap-1">
                                {typeof d.total === 'number' && (
                                  <span
                                    className={cn(
                                      'text-sm font-semibold tabular-nums',
                                      v.tipo === 'devolucion' ? 'text-warning' : 'text-fg'
                                    )}
                                  >
                                    {v.tipo === 'devolucion' ? '−' : ''}
                                    {formatCLP(d.total)}
                                  </span>
                                )}
                                {v.estado_sync !== 'sincronizado' && (
                                  <Badge tone="warning" dot>
                                    Local
                                  </Badge>
                                )}
                              </div>
                              <ChevronRight
                                size={16}
                                className="shrink-0 text-fg-faint transition-transform group-hover:translate-x-0.5"
                              />
                            </Link>
                          </li>
                        )
                      })}
                    </ul>
                  </Card>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </>
  )
}
