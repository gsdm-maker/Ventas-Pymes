import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar
} from 'recharts'
import {
  Package,
  PackageX,
  TrendingDown,
  Truck,
  ArrowRight,
  Store,
  ShoppingBag,
  CloudUpload,
  AlertTriangle
} from 'lucide-react'
import { useAuth } from '@/core/auth/AuthProvider'
import {
  evolucionMovimientos,
  resumenDashboard,
  type ResumenDashboard
} from '@/core/data/api'
import { useAlertasStock } from '@/core/data/useAlertasStock'
import type { FilaReposicion } from '@/core/types'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { LoadingState, PageHeader } from '@/components/ui/Feedback'
import { AvisoPrueba } from '@/core/auth/guards'
import { AsistenteFlotante } from '@/components/asistente/AsistenteFlotante'
import { cn } from '@/lib/cn'
import { formatDiaCorto, formatFecha, formatMiles } from '@/lib/format'
import { ETIQUETA_ESTADO, TONO_ESTADO, textoCobertura } from '@/lib/reposicion'

const estiloTooltip = {
  background: 'rgb(var(--panel))',
  border: '1px solid rgb(var(--border))',
  borderRadius: 12,
  fontSize: 12
}

export function Dashboard() {
  const { empresa, ubicacionActiva, ubicaciones } = useAuth()
  const alertas = useAlertasStock()
  const [resumen, setResumen] = useState<ResumenDashboard | null>(null)
  const [evolucion, setEvolucion] = useState<
    { fecha: string; entradas: number; salidas: number }[]
  >([])
  const [cargando, setCargando] = useState(true)

  const activa = ubicaciones.find((u) => u.id === ubicacionActiva)
  // Una tienda seleccionada acota las alertas a ella; una bodega abastece a todas
  const tiendaActiva = activa?.tipo === 'tienda' ? activa : null

  useEffect(() => {
    let vigente = true
    setCargando(true)
    Promise.all([resumenDashboard(ubicacionActiva), evolucionMovimientos(ubicacionActiva)])
      .then(([r, e]) => {
        if (!vigente) return
        setResumen(r)
        setEvolucion(e)
      })
      .finally(() => vigente && setCargando(false))
    return () => {
      vigente = false
    }
  }, [ubicacionActiva])

  const filas = useMemo(
    () => alertas.filas.filter((f) => !tiendaActiva || f.ubicacion_id === tiendaActiva.id),
    [alertas.filas, tiendaActiva]
  )
  const quebrados = filas.filter((f) => f.estado === 'quebrado')
  const porQuebrar = filas.filter((f) => f.estado === 'por_quebrar')
  const reponer = filas.reduce(
    (a, f) => ({ total: a.total + f.sugerido, bodega: a.bodega + f.desde_bodega, comprar: a.comprar + f.comprar }),
    { total: 0, bodega: 0, comprar: 0 }
  )
  const hasta = alertas.filas[0]?.hasta
  const filtroTienda = tiendaActiva ? `&tienda=${tiendaActiva.id}` : ''

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`${empresa?.nombre ?? ''} · ${activa?.nombre ?? 'Todas las ubicaciones'}`}
      />
      <AvisoPrueba />
      <AsistenteFlotante />

      {cargando || !resumen ? (
        <LoadingState />
      ) : (
        <div className="space-y-5">
          {/* Indicadores principales: cada uno lleva a dónde actuar */}
          {alertas.habilitado ? (
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
              <Indicador
                to={`/reposicion?estado=quebrado${filtroTienda}`}
                tono="danger"
                icono={<PackageX size={18} />}
                label="Quebrados"
                valor={alertas.cargando && !alertas.filas.length ? '…' : quebrados.length}
                detalle="Productos sin stock en tienda"
              />
              <Indicador
                to={`/reposicion?estado=por_quebrar${filtroTienda}`}
                tono="warning"
                icono={<TrendingDown size={18} />}
                label="Por quebrar"
                valor={alertas.cargando && !alertas.filas.length ? '…' : porQuebrar.length}
                detalle={hasta ? `Se agotan antes del ${formatDiaCorto(hasta)}` : 'Según la venta esperada'}
              />
              <Indicador
                to={`/reposicion?estado=alertas${filtroTienda}`}
                tono="accent"
                icono={<Package size={18} />}
                label="Unidades a reponer"
                valor={formatMiles(reponer.total)}
                detalle={`${formatMiles(reponer.bodega)} desde bodega · ${formatMiles(reponer.comprar)} por comprar`}
              />
              <Indicador
                to="/bodega"
                tono="neutral"
                icono={<Truck size={18} />}
                label="Transferencias pendientes"
                valor={resumen.transferenciasPendientes}
                detalle="Por despachar o recibir"
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
              <Indicador to="/inventario" tono="danger" icono={<PackageX size={18} />} label="Sin stock" valor={resumen.sinStock} detalle="Productos agotados" />
              <Indicador to="/inventario" tono="warning" icono={<TrendingDown size={18} />} label="Bajo mínimo" valor={resumen.bajoMinimo} detalle="Bajo el stock mínimo" />
              <Indicador to="/inventario" tono="accent" icono={<Package size={18} />} label="Unidades disponibles" valor={formatMiles(resumen.unidadesDisponibles)} detalle={`${resumen.productosActivos} productos activos`} />
              <Indicador to="/bodega" tono="neutral" icono={<Truck size={18} />} label="Transferencias pendientes" valor={resumen.transferenciasPendientes} detalle="Por despachar o recibir" />
            </div>
          )}

          {/* Contexto, en pequeño */}
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-fg-muted">
            <span>
              <strong className="font-semibold tabular-nums text-fg">{resumen.productosActivos}</strong> productos activos
            </span>
            <span>
              <strong className="font-semibold tabular-nums text-fg">{formatMiles(resumen.unidadesDisponibles)}</strong> unidades
              disponibles{activa ? ` en ${activa.nombre}` : ''}
            </span>
            <Link to="/sync" className="inline-flex items-center gap-1 hover:text-fg">
              <CloudUpload size={14} aria-hidden />
              <strong className={cn('font-semibold tabular-nums', resumen.movimientosPendientes > 0 ? 'text-warning' : 'text-fg')}>
                {resumen.movimientosPendientes}
              </strong>{' '}
              pendientes de sincronizar
            </Link>
            {resumen.ventasConDiferencia > 0 && (
              <Link to="/inventario" className="inline-flex items-center gap-1 text-warning hover:underline">
                <AlertTriangle size={14} aria-hidden />
                <strong className="font-semibold tabular-nums">{resumen.ventasConDiferencia}</strong> venta(s) sin
                conexión registradas sin stock suficiente (7 días): revisa el inventario
              </Link>
            )}
          </div>

          {alertas.habilitado && (
            <div className="grid gap-5 lg:grid-cols-3">
              <ReponerPrimero
                filas={[...quebrados, ...porQuebrar].slice(0, 6)}
                hasta={hasta}
                ambito={tiendaActiva ? tiendaActiva.nombre : 'todas las tiendas'}
              />
              {!tiendaActiva && <AlertasPorTienda filas={alertas.filas} />}
            </div>
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader title="Evolución de movimientos" subtitle={`Últimos 14 días · ${activa?.nombre ?? 'todas las ubicaciones'}`} />
              <CardBody>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={evolucion}>
                      <defs>
                        <linearGradient id="gb" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="rgb(var(--accent))" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="rgb(var(--accent))" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis
                        dataKey="fecha"
                        tick={{ fontSize: 11, fill: 'rgb(var(--fg-muted))' }}
                        tickFormatter={(v: string) => `${v.slice(8, 10)}-${v.slice(5, 7)}`}
                        interval="preserveStartEnd"
                        minTickGap={16}
                      />
                      <YAxis width={28} tick={{ fontSize: 11, fill: 'rgb(var(--fg-muted))' }} />
                      <Tooltip contentStyle={estiloTooltip} labelFormatter={(v) => formatFecha(String(v))} />
                      {/* Sin animación: si el contenedor cambia de ancho al cargar, la animación quedaba
                          congelada y las series se veían amontonadas a la izquierda */}
                      <Area type="monotone" dataKey="entradas" name="Entradas" stroke="rgb(var(--success))" fill="url(#gb)" strokeWidth={2} isAnimationActive={false} />
                      <Area type="monotone" dataKey="salidas" name="Salidas" stroke="rgb(var(--accent))" fillOpacity={0} strokeWidth={2} isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Stock por ubicación" subtitle="Unidades disponibles" />
              <CardBody>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={resumen.porUbicacion}>
                      <XAxis dataKey="ubicacion" tick={{ fontSize: 11, fill: 'rgb(var(--fg-muted))' }} />
                      <YAxis width={36} tick={{ fontSize: 11, fill: 'rgb(var(--fg-muted))' }} />
                      <Tooltip contentStyle={estiloTooltip} />
                      <Bar dataKey="unidades" name="Unidades" fill="rgb(var(--accent))" radius={[6, 6, 0, 0]} maxBarSize={56} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </>
  )
}

const TONOS = {
  danger: { borde: 'hover:border-danger/50', icono: 'bg-danger-soft text-danger', valor: 'text-danger' },
  warning: { borde: 'hover:border-warning/50', icono: 'bg-warning-soft text-warning', valor: 'text-warning' },
  accent: { borde: 'hover:border-accent/50', icono: 'bg-accent-soft text-accent', valor: 'text-fg' },
  neutral: { borde: 'hover:border-border-strong', icono: 'bg-surface-2 text-fg-muted', valor: 'text-fg' }
} as const

function Indicador({
  to,
  tono,
  icono,
  label,
  valor,
  detalle
}: {
  to: string
  tono: keyof typeof TONOS
  icono: ReactNode
  label: string
  valor: ReactNode
  detalle: string
}) {
  const t = TONOS[tono]
  const conValor = typeof valor === 'number' ? valor > 0 : valor !== '0'
  return (
    <Link
      to={to}
      className={cn(
        'group flex flex-col rounded-2xl border border-border bg-panel p-5 shadow-card transition-colors duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
        t.borde
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-fg-body">{label}</span>
        <span className={cn('grid size-9 place-items-center rounded-xl', t.icono)} aria-hidden>
          {icono}
        </span>
      </div>
      <p className={cn('mt-3 text-4xl font-semibold tracking-tight', conValor ? t.valor : 'text-fg-faint')}>
        {valor}
      </p>
      <p className="mt-1 flex items-center justify-between gap-2 text-xs text-fg-muted">
        <span>{detalle}</span>
        <ArrowRight size={14} className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
      </p>
    </Link>
  )
}

function ReponerPrimero({ filas, hasta, ambito }: { filas: FilaReposicion[]; hasta?: string; ambito: string }) {
  return (
    <Card className="lg:col-span-2">
      <CardHeader
        title="Reponer primero"
        subtitle={`Lo más urgente en ${ambito}${hasta ? ` para cubrir hasta el ${formatDiaCorto(hasta)}` : ''}`}
        action={
          <Link to="/reposicion" className="whitespace-nowrap text-xs font-medium text-accent hover:underline">
            Ver todo
          </Link>
        }
      />
      <CardBody className="p-0">
        {filas.length === 0 ? (
          <p className="px-5 py-6 text-sm text-fg-muted">
            Con la venta esperada, el stock de las tiendas alcanza para el período.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {filas.map((f) => (
              <Link
                key={`${f.producto_id}-${f.variante_id}-${f.ubicacion_id}`}
                to={`/reposicion?estado=${f.estado}&tienda=${f.ubicacion_id}`}
                className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface"
              >
                {f.foto_url ? (
                  <img src={f.foto_url} alt="" width={40} height={40} loading="lazy" className="size-10 rounded-lg object-cover" />
                ) : (
                  <span className="grid size-10 place-items-center rounded-lg bg-surface-2 text-fg-faint">
                    <Package size={16} aria-hidden />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-fg">
                    {f.nombre}
                    {f.variante && <span className="font-normal text-fg-muted"> · {f.variante}</span>}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Badge tone={TONO_ESTADO[f.estado]} dot>
                      {ETIQUETA_ESTADO[f.estado]}
                    </Badge>
                    <span className="truncate text-xs text-fg-muted">
                      {f.ubicacion_nombre} · {textoCobertura(f)}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold tabular-nums text-fg">{f.sugerido}</p>
                  <p className="flex items-center justify-end gap-1 text-[11px] text-fg-muted">
                    {f.comprar > 0 ? (
                      <>
                        <ShoppingBag size={11} aria-hidden /> comprar {f.comprar}
                      </>
                    ) : (
                      <>
                        <Truck size={11} aria-hidden /> desde bodega
                      </>
                    )}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function AlertasPorTienda({ filas }: { filas: FilaReposicion[] }) {
  const tiendas = useMemo(() => {
    const m = new Map<string, { id: string; nombre: string; quebrados: number; porQuebrar: number; total: number }>()
    for (const f of filas) {
      const t = m.get(f.ubicacion_id) ?? { id: f.ubicacion_id, nombre: f.ubicacion_nombre, quebrados: 0, porQuebrar: 0, total: 0 }
      t.total++
      if (f.estado === 'quebrado') t.quebrados++
      if (f.estado === 'por_quebrar') t.porQuebrar++
      m.set(f.ubicacion_id, t)
    }
    return [...m.values()].sort((a, b) => b.quebrados * 100 + b.porQuebrar - (a.quebrados * 100 + a.porQuebrar))
  }, [filas])

  return (
    <Card>
      <CardHeader title="Alertas por tienda" subtitle="Dónde reponer primero" />
      <CardBody className="space-y-4">
        {tiendas.map((t) => {
          const pctQ = t.total ? (t.quebrados / t.total) * 100 : 0
          const pctP = t.total ? (t.porQuebrar / t.total) * 100 : 0
          return (
            <Link key={t.id} to={`/reposicion?estado=alertas&tienda=${t.id}`} className="block rounded-lg transition-colors hover:bg-surface">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2 font-medium text-fg">
                  <Store size={14} className="text-fg-muted" aria-hidden /> {t.nombre}
                </span>
                <span className="text-xs tabular-nums text-fg-muted">
                  <span className={t.quebrados ? 'font-semibold text-danger' : ''}>
                    {t.quebrados} {t.quebrados === 1 ? 'quebrado' : 'quebrados'}
                  </span>{' '}
                  ·{' '}
                  <span className={t.porQuebrar ? 'font-semibold text-warning' : ''}>{t.porQuebrar} por quebrar</span>
                </span>
              </div>
              <div
                className="mt-2 flex h-2 overflow-hidden rounded-full bg-surface-2"
                role="img"
                aria-label={`${t.quebrados} quebrados y ${t.porQuebrar} por quebrar de ${t.total} productos`}
              >
                <div className="bg-danger" style={{ width: `${pctQ}%` }} />
                <div className="bg-warning" style={{ width: `${pctP}%` }} />
              </div>
            </Link>
          )
        })}
        {tiendas.length === 0 && <p className="text-sm text-fg-muted">Sin tiendas con productos.</p>}
      </CardBody>
    </Card>
  )
}
