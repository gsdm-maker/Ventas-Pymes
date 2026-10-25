import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps
} from 'recharts'
import { AlertTriangle, Download, FlaskConical, Minus, Package, Table2, TrendingDown, TrendingUp, LineChart as IconoLinea } from 'lucide-react'
import { contarVentasSimuladas, listarProductosConStock, reportePropinas, reporteVentas, type FilaPropina } from '@/core/data/api'
import { useAuth } from '@/core/auth/AuthProvider'
import type { ProductoConStock, ReporteVentas } from '@/core/types'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { EmptyState, LoadingState, PageHeader } from '@/components/ui/Feedback'
import { cn } from '@/lib/cn'
import {
  DIAS_SEMANA,
  aDia,
  formatCLP,
  formatCLPCompacto,
  formatDiaCorto,
  formatMiles
} from '@/lib/format'

type Periodo = 'hoy' | '7d' | '28d' | 'mes' | 'mes_ant' | 'rango'

const PERIODOS: { key: Periodo; label: string }[] = [
  { key: 'hoy', label: 'Hoy' },
  { key: '7d', label: '7 días' },
  { key: '28d', label: '28 días' },
  { key: 'mes', label: 'Este mes' },
  { key: 'mes_ant', label: 'Mes anterior' },
  { key: 'rango', label: 'Rango' }
]

const MEDIO_LABEL: Record<string, string> = { efectivo: 'Efectivo', debito: 'Débito', transferencia: 'Transferencia' }

function rangoDe(p: Periodo, desde: string | null, hasta: string | null): [string, string] {
  const hoy = new Date()
  const dias = (n: number) => {
    const d = new Date(hoy)
    d.setDate(d.getDate() - n)
    return aDia(d)
  }
  switch (p) {
    case 'hoy':
      return [aDia(hoy), aDia(hoy)]
    case '7d':
      return [dias(6), aDia(hoy)]
    case 'mes':
      return [aDia(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), aDia(hoy)]
    case 'mes_ant':
      return [aDia(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)), aDia(new Date(hoy.getFullYear(), hoy.getMonth(), 0))]
    case 'rango':
      return [desde ?? dias(27), hasta ?? aDia(hoy)]
    default:
      return [dias(27), aDia(hoy)]
  }
}

/** Variación porcentual; null si no hay base de comparación */
function variacion(actual: number, anterior: number): number | null {
  if (!anterior) return null
  return ((actual - anterior) / anterior) * 100
}

/** Color por tienda: sigue a la tienda (orden alfabético), nunca a su posición en el ranking */
const HOY = aDia(new Date())
const etiquetaDia = (dia: string) => (dia === HOY ? 'Hoy' : formatDiaCorto(dia))

function colorSerie(i: number): string {
  return i < 8 ? `var(--serie-${i + 1})` : 'rgb(var(--fg-faint))'
}

export function Reportes() {
  const { can } = useAuth()
  const [params, setParams] = useSearchParams()
  const periodo = (PERIODOS.some((p) => p.key === params.get('periodo')) ? params.get('periodo') : '28d') as Periodo
  const tienda = params.get('tienda')
  const [desde, hasta] = rangoDe(periodo, params.get('desde'), params.get('hasta'))

  const [rep, setRep] = useState<ReporteVentas | null>(null)
  const [inventario, setInventario] = useState<ProductoConStock[]>([])
  const [cargando, setCargando] = useState(true)
  const [simuladas, setSimuladas] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [vistaTabla, setVistaTabla] = useState(false)

  function setParam(cambios: Record<string, string | null>) {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        Object.entries(cambios).forEach(([k, v]) => (v ? p.set(k, v) : p.delete(k)))
        return p
      },
      { replace: true }
    )
  }

  useEffect(() => {
    let vigente = true
    setCargando(true)
    setError(null)
    reporteVentas(desde, hasta, tienda)
      .then((r) => vigente && setRep(r))
      .catch((e) => vigente && setError((e as Error).message))
      .finally(() => vigente && setCargando(false))
    contarVentasSimuladas(desde, hasta, tienda)
      .then((n) => vigente && setSimuladas(n))
      .catch(() => vigente && setSimuladas(0))
    return () => {
      vigente = false
    }
  }, [desde, hasta, tienda])

  useEffect(() => {
    listarProductosConStock(null).then(setInventario)
  }, [])

  // Todas las tiendas (para colores estables), en orden alfabético desde la base
  const colores = useMemo(() => {
    const m = new Map<string, string>()
    rep?.tiendas.forEach((t, i) => m.set(t.id, colorSerie(i)))
    return m
  }, [rep])

  const nombreTienda = (id: string) => rep?.tiendas.find((t) => t.id === id)?.nombre ?? '—'

  // Serie diaria: una fila por fecha con una columna por tienda
  const serieDiaria = useMemo(() => {
    if (!rep) return []
    const filas = new Map<string, Record<string, number | string>>()
    for (const d of rep.por_dia) {
      const f = filas.get(d.fecha) ?? { fecha: d.fecha }
      f[d.tienda] = d.monto
      filas.set(d.fecha, f)
    }
    return [...filas.values()]
  }, [rep])
  const tiendasSerie = useMemo(() => [...new Set(rep?.por_dia.map((d) => d.tienda) ?? [])], [rep])

  const ranking = useMemo(() => [...(rep?.tiendas ?? [])].sort((a, b) => b.monto - a.monto), [rep])
  const totalMonto = rep?.totales.monto ?? 0

  function exportarCSV() {
    if (!rep) return
    const sep = ';'
    const lineas = [
      ['Ventas por tienda', `${rep.desde} a ${rep.hasta}`].join(sep),
      ['Tienda', 'Venta', 'N° ventas', 'Ticket promedio', 'Unidades', 'Venta período anterior'].join(sep),
      ...ranking.map((t) =>
        [t.nombre, t.monto, t.tickets, t.tickets ? Math.round(t.monto / t.tickets) : 0, t.unidades, t.monto_ant].join(sep)
      ),
      '',
      ['Fecha', ...tiendasSerie.map(nombreTienda)].join(sep),
      ...serieDiaria.map((f) => [f.fecha, ...tiendasSerie.map((id) => f[id] ?? 0)].join(sep))
    ]
    const blob = new Blob(['﻿' + lineas.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ventas_tiendas_${rep.desde}_${rep.hasta}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const t = rep?.totales
  const ticketProm = t && t.tickets ? Math.round(t.monto / t.tickets) : 0
  const ticketPromAnt = t && t.tickets_ant ? Math.round(t.monto_ant / t.tickets_ant) : 0

  return (
    <>
      <PageHeader
        title="Ventas por tienda"
        subtitle={
          rep
            ? `Del ${formatDiaCorto(rep.desde)} al ${formatDiaCorto(rep.hasta)} · comparado con los ${rep.dias} días anteriores`
            : 'Seguimiento de ventas'
        }
        actions={
          rep && rep.totales.tickets > 0 ? (
            <Button size="sm" variant="secondary" onClick={exportarCSV}>
              <Download size={14} /> Exportar CSV
            </Button>
          ) : undefined
        }
      />

      {/* Filtros: una sola fila sobre todo lo que acotan */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-xl border border-border bg-panel p-1" role="group" aria-label="Período">
          {PERIODOS.map((p) => (
            <button
              key={p.key}
              onClick={() => setParam({ periodo: p.key === '28d' ? null : p.key, ...(p.key === 'rango' ? { desde, hasta } : { desde: null, hasta: null }) })}
              aria-pressed={periodo === p.key}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                periodo === p.key ? 'bg-accent text-on-accent' : 'text-fg-muted hover:bg-surface'
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        {periodo === 'rango' && (
          <div className="flex items-center gap-2">
            <Input type="date" aria-label="Desde" className="w-auto" value={desde} max={hasta} onChange={(e) => e.target.value && setParam({ desde: e.target.value })} />
            <span className="text-xs text-fg-muted">a</span>
            <Input type="date" aria-label="Hasta" className="w-auto" value={hasta} min={desde} max={aDia(new Date())} onChange={(e) => e.target.value && setParam({ hasta: e.target.value })} />
          </div>
        )}
        {/* Filtro propio del reporte: no depende de la ubicación elegida en la barra superior */}
        <Select
          aria-label="Tienda del reporte"
          title="Filtro propio del reporte (no depende de la ubicación de la barra superior)"
          className="w-auto"
          value={tienda ?? ''}
          onChange={(e) => setParam({ tienda: e.target.value || null })}
        >
          <option value="">Reporte: todas las tiendas</option>
          {rep?.tiendas.map((x) => (
            <option key={x.id} value={x.id}>
              {x.nombre}
            </option>
          ))}
        </Select>
      </div>

      {simuladas > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-xs text-warning">
          <FlaskConical size={15} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            Este período incluye <b>{simuladas.toLocaleString('es-CL')} ventas simuladas</b> (historia de demostración
            para probar la proyección). Para ver solo ventas reales, bórralas en{' '}
            <Link to="/configuracion" className="font-medium underline">Configuración → Historia simulada</Link>.
          </span>
        </div>
      )}

      {error ? (
        <EmptyState icon={<AlertTriangle size={28} aria-hidden />} title="No se pudo cargar el reporte" description={error} />
      ) : !rep ? (
        <LoadingState label="Calculando ventas…" />
      ) : (
        // Al refrescar se mantiene lo anterior atenuado (sin saltos de diseño)
        <div className={cn('space-y-5 transition-opacity duration-200', cargando && 'opacity-60')} aria-busy={cargando}>
          <div className="grid grid-cols-3 gap-3 sm:gap-4 xl:grid-cols-4">
            <Cifra className="col-span-3 xl:col-span-1" label="Venta total" valor={formatCLP(t!.monto)} actual={t!.monto} anterior={t!.monto_ant} detalle={`Neto ${formatCLP(t!.neto)} · IVA ${formatCLP(t!.iva)}`} />
            <Cifra label="N° de ventas" valor={formatMiles(t!.tickets)} actual={t!.tickets} anterior={t!.tickets_ant} />
            <Cifra label="Ticket promedio" valor={formatCLP(ticketProm)} actual={ticketProm} anterior={ticketPromAnt} />
            <Cifra label="Unidades vendidas" valor={formatMiles(t!.unidades)} actual={t!.unidades} anterior={t!.unidades_ant} />
          </div>

          {t!.tickets === 0 ? (
            <EmptyState icon={<Package size={28} aria-hidden />} title="Sin ventas en este período" description="Prueba con un período más amplio o con otra tienda." />
          ) : (
            <>
              {/* Ranking: también es la tabla de los montos por tienda */}
              <Card>
                <CardHeader title="Ranking de tiendas" subtitle="Haz clic en una tienda para ver solo sus ventas" />
                <CardBody className="p-0">
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-xs text-fg-muted">
                          <th className="px-5 py-3 font-medium">Tienda</th>
                          <th className="px-4 py-3 text-right font-medium">Venta</th>
                          <th className="w-[22%] px-4 py-3 font-medium">Participación</th>
                          <th className="px-4 py-3 text-right font-medium">N° ventas</th>
                          <th className="px-4 py-3 text-right font-medium">Ticket prom.</th>
                          <th className="px-4 py-3 text-right font-medium">Unidades</th>
                          <th className="px-5 py-3 text-right font-medium">vs anterior</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ranking.map((x) => {
                          const pct = totalMonto && !tienda ? (x.monto / totalMonto) * 100 : 0
                          const sel = tienda === x.id
                          return (
                            <tr
                              key={x.id}
                              tabIndex={0}
                              onClick={() => setParam({ tienda: sel ? null : x.id })}
                              onKeyDown={(e) => e.key === 'Enter' && setParam({ tienda: sel ? null : x.id })}
                              aria-pressed={sel}
                              className={cn(
                                'cursor-pointer border-b border-border/60 last:border-0 transition-colors hover:bg-surface focus-visible:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40',
                                sel && 'bg-accent-soft/40',
                                tienda && !sel && 'opacity-60'
                              )}
                            >
                              <td className="px-5 py-3">
                                <span className="flex items-center gap-2 font-medium text-fg">
                                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: colores.get(x.id) }} aria-hidden />
                                  {x.nombre}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right font-semibold tabular-nums text-fg">{formatCLP(x.monto)}</td>
                              <td className="px-4 py-3">
                                {tienda ? (
                                  <span className="text-xs text-fg-muted">—</span>
                                ) : (
                                  <div className="flex items-center gap-2">
                                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: colores.get(x.id) }} />
                                    </div>
                                    <span className="w-11 text-right text-xs tabular-nums text-fg-body">{pct.toFixed(1)}%</span>
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right tabular-nums text-fg-body">{formatMiles(x.tickets)}</td>
                              <td className="px-4 py-3 text-right tabular-nums text-fg-body">
                                {x.tickets ? formatCLP(Math.round(x.monto / x.tickets)) : '—'}
                              </td>
                              <td className="px-4 py-3 text-right tabular-nums text-fg-body">{formatMiles(x.unidades)}</td>
                              <td className="px-5 py-3 text-right">
                                <Variacion valor={variacion(x.monto, x.monto_ant)} />
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Móvil: una tarjeta por tienda */}
                  <div className="divide-y divide-border md:hidden">
                    {ranking.map((x) => {
                      const pct = totalMonto && !tienda ? (x.monto / totalMonto) * 100 : 0
                      const sel = tienda === x.id
                      return (
                        <button
                          key={x.id}
                          onClick={() => setParam({ tienda: sel ? null : x.id })}
                          aria-pressed={sel}
                          className={cn(
                            'block w-full px-4 py-3 text-left transition-colors hover:bg-surface',
                            sel && 'bg-accent-soft/40',
                            tienda && !sel && 'opacity-60'
                          )}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="flex min-w-0 items-center gap-2 font-medium text-fg">
                              <span className="size-2.5 shrink-0 rounded-full" style={{ background: colores.get(x.id) }} aria-hidden />
                              <span className="truncate">{x.nombre}</span>
                            </span>
                            <span className="shrink-0 font-semibold tabular-nums text-fg">{formatCLP(x.monto)}</span>
                          </div>
                          {!tienda && (
                            <div className="mt-2 flex items-center gap-2">
                              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: colores.get(x.id) }} />
                              </div>
                              <span className="w-11 text-right text-xs tabular-nums text-fg-body">{pct.toFixed(1)}%</span>
                            </div>
                          )}
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
                            <span>{formatMiles(x.tickets)} ventas</span>
                            <span>Ticket {x.tickets ? formatCLP(Math.round(x.monto / x.tickets)) : '—'}</span>
                            <span>{formatMiles(x.unidades)} u.</span>
                            <Variacion valor={variacion(x.monto, x.monto_ant)} />
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </CardBody>
              </Card>

              {/* Venta diaria por tienda */}
              <Card>
                <CardHeader
                  title="Venta diaria por tienda"
                  subtitle={`${tienda ? nombreTienda(tienda) : 'Una línea por tienda'}${rep.hasta === HOY ? ' · hoy está en curso' : ''}`}
                  action={
                    <button
                      onClick={() => setVistaTabla((v) => !v)}
                      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-accent hover:bg-surface"
                      aria-pressed={vistaTabla}
                    >
                      {vistaTabla ? <IconoLinea size={14} aria-hidden /> : <Table2 size={14} aria-hidden />}
                      {vistaTabla ? 'Ver gráfico' : 'Ver tabla'}
                    </button>
                  }
                />
                <CardBody>
                  {vistaTabla ? (
                    <div className="max-h-80 overflow-auto rounded-xl border border-border">
                      <table className="w-full text-sm">
                        <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:bg-panel [&_th]:shadow-[inset_0_-1px_0_rgb(var(--border))]">
                          <tr className="text-left text-xs text-fg-muted">
                            <th className="px-3 py-2 font-medium">Día</th>
                            {tiendasSerie.map((id) => (
                              <th key={id} className="px-3 py-2 text-right font-medium">
                                {nombreTienda(id)}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {serieDiaria.map((f) => (
                            <tr key={String(f.fecha)} className="border-b border-border/60 last:border-0">
                              <td className="px-3 py-2 capitalize text-fg-body">{etiquetaDia(String(f.fecha))}</td>
                              {tiendasSerie.map((id) => (
                                <td key={id} className="px-3 py-2 text-right tabular-nums text-fg-body">
                                  {formatCLP(Number(f[id] ?? 0))}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <>
                      {tiendasSerie.length > 1 && (
                        <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-body" aria-label="Leyenda">
                          {tiendasSerie.map((id) => (
                            <li key={id} className="flex items-center gap-1.5">
                              <span className="h-0.5 w-4 rounded-full" style={{ background: colores.get(id) }} aria-hidden />
                              {nombreTienda(id)}
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="h-72">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={serieDiaria} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                            <CartesianGrid vertical={false} stroke="rgb(var(--border))" strokeWidth={1} />
                            <XAxis
                              dataKey="fecha"
                              tickFormatter={(v) => etiquetaDia(String(v))}
                              tick={{ fontSize: 11, fill: 'rgb(var(--fg-muted))' }}
                              tickLine={false}
                              axisLine={{ stroke: 'rgb(var(--border))' }}
                              minTickGap={24}
                            />
                            <YAxis
                              width={64}
                              tickFormatter={(v) => formatCLPCompacto(Number(v))}
                              tick={{ fontSize: 11, fill: 'rgb(var(--fg-muted))' }}
                              tickLine={false}
                              axisLine={false}
                            />
                            <Tooltip
                              content={<TooltipVentas nombre={nombreTienda} />}
                              cursor={{ stroke: 'rgb(var(--border-strong))', strokeWidth: 1 }}
                            />
                            {tiendasSerie.map((id) => (
                              <Line
                                key={id}
                                type="monotone"
                                dataKey={id}
                                name={nombreTienda(id)}
                                stroke={colores.get(id)}
                                strokeWidth={2}
                                dot={false}
                                activeDot={{ r: 4, strokeWidth: 2, stroke: 'rgb(var(--panel))' }}
                                isAnimationActive={false}
                              />
                            ))}
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </>
                  )}
                </CardBody>
              </Card>

              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <MapaDiaSemana rep={rep} nombre={nombreTienda} colores={colores} />
                <ListaBarras
                  titulo="Productos más vendidos"
                  subtitulo={tienda ? nombreTienda(tienda) : 'Todas las tiendas'}
                  filas={rep.top_productos.map((p) => ({ clave: p.id, label: p.nombre, sub: `${p.sku} · ${formatMiles(p.unidades)} u.`, monto: p.monto }))}
                />
                <div className="space-y-5">
                  <ListaBarras
                    titulo="Medios de pago"
                    filas={rep.medios.map((m) => ({ clave: m.medio, label: MEDIO_LABEL[m.medio] ?? m.medio, sub: `${formatMiles(m.tickets)} ventas`, monto: m.monto }))}
                    conPorcentaje
                  />
                  <ListaBarras
                    titulo="Ventas por categoría"
                    filas={rep.categorias.map((c) => ({ clave: c.categoria, label: c.categoria, sub: `${formatMiles(c.unidades)} u.`, monto: c.monto }))}
                    conPorcentaje
                  />
                </div>
              </div>
            </>
          )}

          {can('modulos.mesas') && <PropinasGarzon desde={desde} hasta={hasta} tienda={tienda} />}

          <InventarioValorizado productos={inventario} />
        </div>
      )}
    </>
  )
}

/** Restaurante: mesas cobradas y propinas por garzón en el período. */
function PropinasGarzon({ desde, hasta, tienda }: { desde: string; hasta: string; tienda: string | null }) {
  const [filas, setFilas] = useState<FilaPropina[] | null>(null)
  useEffect(() => {
    let vigente = true
    reportePropinas(desde, hasta, tienda)
      .then((f) => vigente && setFilas(f))
      .catch(() => vigente && setFilas([]))
    return () => {
      vigente = false
    }
  }, [desde, hasta, tienda])
  const total = (filas ?? []).reduce((a, f) => a + f.propinas, 0)
  return (
    <Card>
      <CardHeader title="Propinas por garzón" subtitle={`Mesas cobradas en el período · ${formatCLP(total)} en propinas`} />
      <CardBody className="p-0">
        {!filas ? (
          <p className="px-5 py-6 text-sm text-fg-muted">Cargando…</p>
        ) : filas.length === 0 ? (
          <p className="px-5 py-6 text-sm text-fg-muted">Sin mesas cobradas en este período.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-fg-muted">
                <th className="px-5 py-2 font-medium">Garzón</th>
                <th className="px-3 py-2 text-right font-medium">Mesas</th>
                <th className="px-3 py-2 text-right font-medium">Consumo</th>
                <th className="px-3 py-2 text-right font-medium">Propinas</th>
                <th className="px-5 py-2 text-right font-medium">% del consumo</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.garzon_id ?? f.garzon} className="border-b border-border/60 last:border-0">
                  <td className="px-5 py-2.5 text-fg">{f.garzon}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-fg-body">{formatMiles(f.cuentas)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-fg-body">{formatCLP(f.ventas)}</td>
                  <td className="px-3 py-2.5 text-right font-medium tabular-nums text-fg">{formatCLP(f.propinas)}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-fg-muted">{f.ventas ? ((f.propinas / f.ventas) * 100).toFixed(1) : '0'}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardBody>
    </Card>
  )
}

function Variacion({ valor }: { valor: number | null }) {
  if (valor === null) return <span className="text-xs text-fg-muted">sin base</span>
  const sube = valor > 0.5
  const baja = valor < -0.5
  const Icono = sube ? TrendingUp : baja ? TrendingDown : Minus
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs font-medium tabular-nums',
        sube ? 'text-success' : baja ? 'text-danger' : 'text-fg-muted'
      )}
    >
      <Icono size={13} aria-hidden />
      <span className="sr-only">{sube ? 'Sube' : baja ? 'Baja' : 'Sin cambio'}</span>
      {valor > 0 ? '+' : ''}
      {valor.toFixed(1)}%
    </span>
  )
}

function Cifra({
  label,
  valor,
  actual,
  anterior,
  detalle,
  className
}: {
  className?: string
  label: string
  valor: string
  actual: number
  anterior: number
  detalle?: string
}) {
  return (
    <div className={cn('min-w-0 rounded-2xl border border-border bg-panel p-3 shadow-card sm:p-5', className)}>
      <p className="text-xs font-medium text-fg-body sm:text-sm">{label}</p>
      <p className="mt-1.5 text-xl font-semibold tracking-tight text-fg sm:mt-2 sm:text-3xl">{valor}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <Variacion valor={variacion(actual, anterior)} />
        <span className="hidden text-xs text-fg-muted sm:inline">vs período anterior</span>
      </div>
      {detalle && <p className="mt-1 text-xs text-fg-muted">{detalle}</p>}
    </div>
  )
}

function TooltipVentas({ active, payload, label, nombre }: TooltipProps<number, string> & { nombre: (id: string) => string }) {
  if (!active || !payload?.length) return null
  const filas = [...payload].sort((a, b) => Number(b.value) - Number(a.value))
  const total = filas.reduce((a, p) => a + Number(p.value ?? 0), 0)
  return (
    <div className="min-w-48 rounded-xl border border-border bg-panel px-3 py-2 text-xs shadow-popover">
      <p className="mb-1.5 font-medium capitalize text-fg">
        {String(label) === HOY ? 'Hoy (en curso)' : formatDiaCorto(String(label))}
      </p>
      <ul className="space-y-1">
        {filas.map((p) => (
          <li key={String(p.dataKey)} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-fg-body">
              <span className="size-2 rounded-full" style={{ background: p.color }} aria-hidden />
              {nombre(String(p.dataKey))}
            </span>
            <span className="tabular-nums text-fg">{formatCLP(Number(p.value))}</span>
          </li>
        ))}
      </ul>
      {filas.length > 1 && (
        <p className="mt-1.5 flex justify-between border-t border-border pt-1.5 text-fg">
          <span>Total</span>
          <span className="font-medium tabular-nums">{formatCLP(total)}</span>
        </p>
      )}
    </div>
  )
}

/** Promedio por día de la semana: mapa de calor (un tono, claro → oscuro). También es tabla. */
function MapaDiaSemana({
  rep,
  nombre,
  colores
}: {
  rep: ReporteVentas
  nombre: (id: string) => string
  colores: Map<string, string>
}) {
  const tiendas = [...new Set(rep.por_dia_semana.map((d) => d.tienda))]
  const valor = (t: string, dow: number) => rep.por_dia_semana.find((d) => d.tienda === t && d.dow === dow)?.monto_prom ?? 0
  const max = Math.max(1, ...rep.por_dia_semana.map((d) => d.monto_prom))
  const mejorDia = (t: string) => {
    let m = 1
    for (let d = 2; d <= 7; d++) if (valor(t, d) > valor(t, m)) m = d
    return m
  }

  return (
    <Card className="lg:col-span-2">
      <CardHeader title="Venta promedio por día de la semana" subtitle="Útil para turnos y para reponer antes de los días fuertes" />
      <CardBody className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-fg-muted">
                <th className="sticky left-0 z-10 bg-panel px-5 py-2.5 text-left font-medium">Tienda</th>
                {DIAS_SEMANA.map((d) => (
                  <th key={d} className="px-1.5 py-2.5 text-center font-medium">
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tiendas.map((t) => {
                const mejor = mejorDia(t)
                return (
                  <tr key={t} className="border-b border-border/60 last:border-0">
                    <td className="sticky left-0 z-10 bg-panel px-5 py-2">
                      <span className="flex items-center gap-2 whitespace-nowrap font-medium text-fg">
                        <span className="size-2.5 shrink-0 rounded-full" style={{ background: colores.get(t) }} aria-hidden />
                        {nombre(t)}
                      </span>
                    </td>
                    {DIAS_SEMANA.map((d, i) => {
                      const v = valor(t, i + 1)
                      const a = v / max
                      return (
                        <td key={d} className="px-1 py-1.5">
                          <div
                            className={cn(
                              'rounded-md px-1 py-2 text-center text-xs tabular-nums',
                              a > 0.55 ? 'text-white' : 'text-fg-body',
                              mejor === i + 1 && v > 0 && 'font-semibold'
                            )}
                            style={{ background: `color-mix(in oklab, var(--serie-1) ${Math.round(8 + a * 82)}%, transparent)` }}
                            title={`${nombre(t)} · ${d}: ${formatCLP(v)} promedio`}
                          >
                            {formatCLPCompacto(v)}
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="px-5 py-2.5 text-xs text-fg-muted">
          Más oscuro = más venta. En negrita, el mejor día de cada tienda.
        </p>
      </CardBody>
    </Card>
  )
}

function ListaBarras({
  titulo,
  subtitulo,
  filas,
  conPorcentaje
}: {
  titulo: string
  subtitulo?: string
  filas: { clave: string; label: string; sub?: string; monto: number }[]
  conPorcentaje?: boolean
}) {
  const max = Math.max(1, ...filas.map((f) => f.monto))
  const total = filas.reduce((a, f) => a + f.monto, 0)
  return (
    <Card>
      <CardHeader title={titulo} subtitle={subtitulo} />
      <CardBody className="space-y-3">
        {filas.length === 0 && <p className="text-sm text-fg-muted">Sin datos.</p>}
        {filas.map((f) => (
          <div key={f.clave}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-fg">
                {f.label}
                {f.sub && <span className="ml-2 text-xs text-fg-muted">{f.sub}</span>}
              </span>
              <span className="shrink-0 tabular-nums text-fg">
                {formatCLP(f.monto)}
                {conPorcentaje && total > 0 && (
                  <span className="ml-1.5 text-xs text-fg-muted">{((f.monto / total) * 100).toFixed(0)}%</span>
                )}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full" style={{ width: `${(f.monto / max) * 100}%`, background: 'var(--serie-1)' }} />
            </div>
          </div>
        ))}
      </CardBody>
    </Card>
  )
}

function InventarioValorizado({ productos }: { productos: ProductoConStock[] }) {
  const porCategoria = new Map<string, number>()
  for (const p of productos) {
    const k = p.categoria_nombre ?? 'Sin categoría'
    porCategoria.set(k, (porCategoria.get(k) ?? 0) + p.disponible * p.precio_venta)
  }
  const filas = [...porCategoria.entries()]
    .map(([clave, monto]) => ({ clave, label: clave, monto }))
    .sort((a, b) => b.monto - a.monto)
  const total = filas.reduce((a, f) => a + f.monto, 0)
  if (!productos.length) return null
  return (
    <ListaBarras
      titulo={`Inventario valorizado · ${formatCLP(total)}`}
      subtitulo="Stock actual de todas las ubicaciones a precio de venta"
      filas={filas}
      conPorcentaje
    />
  )
}
