import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, Info, Package, PackageX, Search, ShoppingBag, Truck, TrendingDown } from 'lucide-react'
import { useAuth } from '@/core/auth/AuthProvider'
import { crearTransferenciasSugeridas, proyeccionReposicion } from '@/core/data/api'
import { invalidarAlertas } from '@/core/data/useAlertasStock'
import type { EstadoReposicion, FilaReposicion } from '@/core/types'
import { ETIQUETA_ESTADO, TONO_ESTADO, textoCobertura } from '@/lib/reposicion'
import { Card, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { EmptyState, LoadingState, PageHeader } from '@/components/ui/Feedback'
import { SidePanel } from '@/components/ui/SidePanel'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/confirm'
import { cn } from '@/lib/cn'
import { DIAS_SEMANA, aDia, formatDiaCorto, formatDiaLargo, parseDia } from '@/lib/format'

type Horizonte = 'domingo' | '7' | '14' | '30' | 'fecha'
type FiltroEstado = EstadoReposicion | 'alertas' | 'todos'
const FILTROS: FiltroEstado[] = ['alertas', 'quebrado', 'por_quebrar', 'bajo_minimo', 'ok', 'todos']

const HORIZONTES: { key: Horizonte; label: string }[] = [
  { key: 'domingo', label: 'Hasta el domingo' },
  { key: '7', label: '7 días' },
  { key: '14', label: '14 días' },
  { key: '30', label: '30 días' },
  { key: 'fecha', label: 'Otra fecha' }
]

function sumarDias(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return aDia(d)
}

export function Reposicion() {
  const { can } = useAuth()
  const toast = useToast()
  const confirmar = useConfirm()
  const [horizonte, setHorizonte] = useState<Horizonte>('domingo')
  const [fecha, setFecha] = useState(sumarDias(7))
  const [filas, setFilas] = useState<FilaReposicion[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Tienda y estado viven en la URL (enlaces desde el Dashboard, recargar, compartir)
  const [params, setParams] = useSearchParams()
  const ubicacion = params.get('tienda') ?? 'todas'
  const filtro = (FILTROS.includes(params.get('estado') as FiltroEstado) ? params.get('estado') : 'alertas') as FiltroEstado
  const cambiarParam = (clave: string, valor: string, porDefecto: string) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        if (valor === porDefecto) p.delete(clave)
        else p.set(clave, valor)
        return p
      },
      { replace: true }
    )
  const setUbicacion = (v: string) => cambiarParam('tienda', v, 'todas')
  const setFiltro = (v: FiltroEstado) => cambiarParam('estado', v, 'alertas')
  const [busqueda, setBusqueda] = useState('')
  const [seleccion, setSeleccion] = useState<FilaReposicion | null>(null)
  const [creando, setCreando] = useState(false)

  const hasta =
    horizonte === 'domingo' ? null : horizonte === 'fecha' ? fecha : sumarDias(Number(horizonte) - 1)

  async function cargar() {
    setCargando(true)
    setError(null)
    try {
      setFilas(await proyeccionReposicion(hasta))
    } catch (e) {
      setError((e as Error).message)
      setFilas([])
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    void cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasta])

  const ubicaciones = useMemo(
    () => [...new Map(filas.map((f) => [f.ubicacion_id, f.ubicacion_nombre])).entries()],
    [filas]
  )

  const delaUbicacion = useMemo(
    () => filas.filter((f) => ubicacion === 'todas' || f.ubicacion_id === ubicacion),
    [filas, ubicacion]
  )

  const conteo = useMemo(() => {
    const c = { quebrado: 0, por_quebrar: 0, bajo_minimo: 0, ok: 0 }
    delaUbicacion.forEach((f) => c[f.estado]++)
    return c
  }, [delaUbicacion])

  const visibles = useMemo(() => {
    const t = busqueda.trim().toLowerCase()
    return delaUbicacion.filter((f) => {
      if (filtro === 'alertas' && f.estado === 'ok') return false
      if (filtro !== 'alertas' && filtro !== 'todos' && f.estado !== filtro) return false
      return !t || f.nombre.toLowerCase().includes(t) || f.sku.toLowerCase().includes(t)
    })
  }, [delaUbicacion, filtro, busqueda])

  const totales = useMemo(
    () =>
      delaUbicacion.reduce(
        (a, f) => ({
          sugerido: a.sugerido + f.sugerido,
          bodega: a.bodega + f.desde_bodega,
          comprar: a.comprar + f.comprar
        }),
        { sugerido: 0, bodega: 0, comprar: 0 }
      ),
    [delaUbicacion]
  )

  const meta = filas[0]
  const sinHistoria = filas.length > 0 && filas.every((f) => !f.con_historia)
  const puedeTransferir = can('transferencias.gestionar')
  const transferibles = delaUbicacion.filter((f) => f.desde_bodega > 0 && f.bodega_origen_id)

  async function transferir(lista: FilaReposicion[]) {
    const unidades = lista.reduce((a, f) => a + f.desde_bodega, 0)
    const tiendas = new Set(lista.map((f) => f.ubicacion_id)).size
    const ok = await confirmar({
      titulo: 'Crear transferencias sugeridas',
      mensaje: `Se reservarán ${unidades} unidades en bodega para ${tiendas} tienda(s), en ${lista.length} línea(s). Quedarán pendientes de despacho en Bodega y transferencias.`,
      accion: 'Crear transferencias'
    })
    if (!ok) return
    setCreando(true)
    try {
      const n = await crearTransferenciasSugeridas(
        lista,
        `Reposición sugerida hasta el ${formatDiaCorto(meta?.hasta ?? aDia(new Date()))}`
      )
      toast(`${n} transferencia(s) creada(s). Despáchalas desde Bodega y transferencias.`)
      setSeleccion(null)
      invalidarAlertas()
      await cargar()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setCreando(false)
    }
  }

  const chips: { key: FiltroEstado; label: string; n: number }[] = [
    { key: 'alertas', label: 'Con alerta', n: conteo.quebrado + conteo.por_quebrar + conteo.bajo_minimo },
    { key: 'quebrado', label: 'Quebrados', n: conteo.quebrado },
    { key: 'por_quebrar', label: 'Por quebrar', n: conteo.por_quebrar },
    { key: 'bajo_minimo', label: 'Bajo mínimo', n: conteo.bajo_minimo },
    { key: 'todos', label: 'Todos', n: delaUbicacion.length }
  ]

  return (
    <>
      {/* Escritorio: encabezado, filtros y resumen fijos; solo las filas hacen scroll */}
      <div className="lg:flex lg:h-[calc(100dvh-7.25rem)] lg:flex-col">
        <PageHeader
          title="Reposición y alertas de quiebre"
          subtitle={
            meta
              ? `Proyección hasta el ${formatDiaLargo(meta.hasta)} · según ${meta.semanas_usadas} semana(s) de ventas`
              : 'Proyección de demanda según la historia de ventas'
          }
        />

        {/* Controles */}
        <div className="mb-3 shrink-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1 rounded-xl border border-border bg-panel p-1" role="group" aria-label="Período a cubrir">
              {HORIZONTES.map((h) => (
                <button
                  key={h.key}
                  onClick={() => setHorizonte(h.key)}
                  aria-pressed={horizonte === h.key}
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                    horizonte === h.key ? 'bg-accent text-on-accent' : 'text-fg-muted hover:bg-surface'
                  )}
                >
                  {h.label}
                </button>
              ))}
            </div>
            {horizonte === 'fecha' && (
              <Input
                type="date"
                aria-label="Cubrir hasta"
                className="w-auto"
                value={fecha}
                min={sumarDias(0)}
                max={sumarDias(90)}
                onChange={(e) => e.target.value && setFecha(e.target.value)}
              />
            )}
            <Select
              aria-label="Ubicación"
              className="w-auto"
              value={ubicacion}
              onChange={(e) => setUbicacion(e.target.value)}
            >
              <option value="todas">Todas las tiendas</option>
              {ubicaciones.map(([id, nombre]) => (
                <option key={id} value={id}>
                  {nombre}
                </option>
              ))}
            </Select>
            <div className="relative min-w-48 flex-1">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint" aria-hidden />
              <Input
                aria-label="Buscar producto"
                placeholder="Buscar por nombre o SKU…"
                autoComplete="off"
                className="pl-9"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Chips de estado: en móvil quedan pegados bajo la barra superior (hijo directo
            del contenedor de página, para que el sticky dure todo el listado) */}
        <div className="sticky top-16 z-20 -mx-4 mb-3 flex shrink-0 gap-2 overflow-x-auto border-b border-border bg-shell/95 px-4 py-2 shadow-sm backdrop-blur scrollbar-none lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:backdrop-blur-none">
          {chips.map((c) => (
            <button
              key={c.key}
              onClick={() => setFiltro(c.key)}
              aria-pressed={filtro === c.key}
              className={cn(
                'shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors',
                filtro === c.key ? 'bg-accent text-on-accent shadow-sm' : 'bg-surface text-fg-muted hover:bg-surface-2'
              )}
            >
              {c.label} <span className="tabular-nums">({c.n})</span>
            </button>
          ))}
        </div>

        {sinHistoria && (
          <div className="mb-3 flex shrink-0 items-start gap-2 rounded-xl border border-info/30 bg-info-soft px-4 py-3 text-xs text-info">
            <Info size={15} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              Todavía no hay historia de ventas suficiente: por ahora las alertas usan el stock mínimo de
              cada producto. La proyección mejora a medida que se registran ventas (ideal: 4 semanas o
              más).{' '}
              {can('config.gestionar') && (
                <>
                  Para probarla puedes cargar ventas simuladas en{' '}
                  <Link to="/configuracion" className="font-medium underline">
                    Configuración
                  </Link>
                  .
                </>
              )}
            </span>
          </div>
        )}

        {cargando ? (
          <LoadingState label="Calculando proyección…" />
        ) : error ? (
          <EmptyState icon={<AlertTriangle size={28} aria-hidden />} title="No se pudo calcular la proyección" description={error} />
        ) : (
          <div className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
            {/* Resumen y la acción principal en una sola fila */}
            <div className="mb-3 grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
              <Cifra icono={<PackageX size={15} />} n={conteo.quebrado} label="Quebrados" tono="danger" />
              <Cifra
                icono={<TrendingDown size={15} />}
                n={conteo.por_quebrar}
                label={meta ? `Por quebrar al ${sinCortes(formatDiaCorto(meta.hasta))}` : 'Por quebrar'}
                tono="warning"
              />
              <Cifra icono={<Truck size={15} />} n={totales.bodega} label="Unidades desde bodega" />
              <Cifra icono={<ShoppingBag size={15} />} n={totales.comprar} label="Unidades por comprar" />
              {puedeTransferir && transferibles.length > 0 && (
                <Button
                  onClick={() => void transferir(transferibles)}
                  disabled={creando}
                  className="col-span-2 h-auto min-h-10 sm:col-span-4 lg:col-span-1"
                >
                  <Truck size={15} /> Transferir desde bodega ({transferibles.length})
                </Button>
              )}
            </div>

            {visibles.length === 0 ? (
              <EmptyState
                icon={<Package size={28} aria-hidden />}
                title={filtro === 'alertas' ? 'Sin alertas para este período' : 'No hay productos en este filtro'}
                description={
                  filtro === 'alertas'
                    ? 'Con la venta esperada, el stock alcanza hasta la fecha elegida.'
                    : undefined
                }
              />
            ) : (
              <Card className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-hidden">
                <CardBody className="p-0 lg:min-h-0 lg:flex-1 lg:overflow-auto lg:overscroll-contain">
                  {/* Escritorio: tabla con títulos de columna fijos */}
                  <div className="hidden overflow-x-auto md:block lg:overflow-visible">
                    <table className="w-full text-sm">
                      <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-panel [&_th]:shadow-[inset_0_-1px_0_rgb(var(--border))]">
                        <tr className="text-left text-xs text-fg-muted">
                          <th className="px-4 py-3 font-medium">Producto</th>
                          <th className="px-4 py-3 font-medium">Tienda</th>
                          <th className="px-4 py-3 text-right font-medium">Stock</th>
                          <th className="px-4 py-3 text-right font-medium">Venta/día</th>
                          <th className="px-4 py-3 text-right font-medium">Demanda período</th>
                          <th className="px-4 py-3 font-medium">Cobertura</th>
                          <th className="px-4 py-3 text-right font-medium">Reponer</th>
                          <th className="px-4 py-3 font-medium">Cómo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibles.map((f) => (
                          <tr
                            key={`${f.producto_id}-${f.variante_id}-${f.ubicacion_id}`}
                            tabIndex={0}
                            onClick={() => setSeleccion(f)}
                            onKeyDown={(e) => e.key === 'Enter' && setSeleccion(f)}
                            className="scroll-mt-12 cursor-pointer border-b border-border/60 last:border-0 transition-colors hover:bg-surface focus-visible:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
                          >
                            <td className="px-4 py-3">
                              <div className="flex min-w-0 items-center gap-3">
                                <Foto f={f} />
                                <div className="min-w-0">
                                  <p className="truncate font-medium text-fg">{f.nombre}
                                  {f.variante && <span className="font-normal text-fg-muted"> · {f.variante}</span>}</p>
                                  <p className="text-xs text-fg-muted">{f.sku}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-fg-body">{f.ubicacion_nombre}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-fg">
                              {f.disponible}
                              {f.transito > 0 && <span className="text-xs text-fg-muted"> +{f.transito}</span>}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-fg-body">{f.prom_diario.toFixed(1)}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-fg-body">{f.demanda_periodo}</td>
                            <td className="px-4 py-3">
                              <Badge tone={TONO_ESTADO[f.estado]} dot>
                                {ETIQUETA_ESTADO[f.estado]}
                              </Badge>
                              <p className="mt-1 text-xs text-fg-muted">{textoCobertura(f)}</p>
                            </td>
                            <td className="px-4 py-3 text-right text-base font-semibold tabular-nums text-fg">{f.sugerido || '—'}</td>
                            <td className="px-4 py-3 text-xs text-fg-body">
                              <ComoReponer f={f} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Móvil: tarjetas */}
                  <div className="divide-y divide-border md:hidden">
                    {visibles.map((f) => (
                      <button
                        key={`${f.producto_id}-${f.variante_id}-${f.ubicacion_id}`}
                        onClick={() => setSeleccion(f)}
                        className="flex w-full scroll-mt-32 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface"
                      >
                        <Foto f={f} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-fg">{f.nombre}
                                  {f.variante && <span className="font-normal text-fg-muted"> · {f.variante}</span>}</p>
                          <p className="truncate text-xs text-fg-muted">
                            {f.ubicacion_nombre} · stock {f.disponible}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                            <Badge tone={TONO_ESTADO[f.estado]} dot>
                              {ETIQUETA_ESTADO[f.estado]}
                            </Badge>
                            <span className="text-xs text-fg-muted">{textoCobertura(f)}</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-semibold tabular-nums text-fg">{f.sugerido || '—'}</p>
                          <p className="text-[11px] text-fg-muted">reponer</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </CardBody>
              </Card>
            )}

            {meta && meta.factor_temporada !== 1 && (
              <p className="mt-2 shrink-0 text-xs text-fg-muted">
                Se aplicó un factor de temporada según el mismo período del año pasado.
              </p>
            )}
          </div>
        )}
      </div>

      <SidePanel
        open={!!seleccion}
        onClose={() => setSeleccion(null)}
        eyebrow={seleccion ? `${seleccion.ubicacion_nombre} · ${seleccion.sku}` : undefined}
        title={seleccion ? [seleccion.nombre, seleccion.variante].filter(Boolean).join(' · ') : undefined}
        width="lg"
        footer={
          seleccion && puedeTransferir && seleccion.desde_bodega > 0 ? (
            <Button block onClick={() => void transferir([seleccion])} disabled={creando}>
              <Truck size={16} /> Transferir {seleccion.desde_bodega} desde bodega
            </Button>
          ) : undefined
        }
      >
        {seleccion && <DetalleReposicion f={seleccion} />}
      </SidePanel>
    </>
  )
}

function Foto({ f }: { f: FilaReposicion }) {
  return f.foto_url ? (
    <img src={f.foto_url} alt="" width={40} height={40} loading="lazy" className="size-10 shrink-0 rounded-lg object-cover" />
  ) : (
    <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-2 text-fg-faint">
      <Package size={16} aria-hidden />
    </span>
  )
}

function ComoReponer({ f }: { f: FilaReposicion }) {
  if (f.sugerido === 0) return <span className="text-fg-muted">No necesita</span>
  return (
    <div className="space-y-0.5">
      {f.desde_bodega > 0 && (
        <p className="flex items-center gap-1">
          <Truck size={12} aria-hidden /> {f.desde_bodega} desde bodega
        </p>
      )}
      {f.comprar > 0 && (
        <p className="flex items-center gap-1 text-warning">
          <ShoppingBag size={12} aria-hidden /> {f.comprar} comprar
        </p>
      )}
    </div>
  )
}

function DetalleReposicion({ f }: { f: FilaReposicion }) {
  // Días de la semana dentro del período, para resaltarlos en el gráfico
  const diasPeriodo = new Set(f.detalle.map((d) => (parseDia(d.fecha).getDay() + 6) % 7))
  const perfil = f.prom_por_dia.map((v, i) => ({ dia: DIAS_SEMANA[i], venta: Number(v), enPeriodo: diasPeriodo.has(i) }))

  let stock = f.disponible + f.transito
  const proyeccion = f.detalle.map((d) => {
    stock -= d.demanda
    return { ...d, stock }
  })

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={TONO_ESTADO[f.estado]} dot>
          {ETIQUETA_ESTADO[f.estado]}
        </Badge>
        <span className="text-xs text-fg-muted">{textoCobertura(f)}</span>
      </div>

      <div className="rounded-xl bg-surface p-4 text-sm leading-relaxed text-fg-body">
        Para cubrir hasta el <strong className="text-fg">{formatDiaLargo(f.hasta)}</strong> se esperan{' '}
        <strong className="text-fg tabular-nums">{f.demanda_periodo}</strong> unidades
        {f.seguridad > 0 && (
          <>
            {' '}
            más <span className="tabular-nums">{f.seguridad}</span> de seguridad
          </>
        )}
        {f.objetivo > f.demanda_periodo + f.seguridad && <> (se respeta el stock mínimo de {f.stock_minimo})</>}. Hay{' '}
        <strong className="text-fg tabular-nums">{f.disponible}</strong> disponibles
        {f.transito > 0 && <> y {f.transito} en tránsito</>}.{' '}
        {f.sugerido > 0 ? (
          <>
            Repón <strong className="text-fg tabular-nums">{f.sugerido}</strong>
            {f.desde_bodega > 0 && <>: {f.desde_bodega} desde bodega</>}
            {f.comprar > 0 && (
              <>
                {f.desde_bodega > 0 ? ' y ' : ': '}
                {f.comprar} por comprar (bodega con {f.bodega_disponible})
              </>
            )}
            .
          </>
        ) : (
          <>El stock alcanza para el período.</>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3 text-center">
        <Dato label="Venta prom./día" valor={f.prom_diario.toFixed(1)} />
        <Dato label="Vendido hoy" valor={f.vendido_hoy} />
        <Dato label="Stock mínimo" valor={f.stock_minimo} />
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-fg">Venta promedio por día de la semana</p>
        {f.con_historia ? (
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={perfil}>
                <XAxis dataKey="dia" tick={{ fontSize: 11, fill: 'rgb(var(--fg-muted))' }} />
                <YAxis width={28} tick={{ fontSize: 11, fill: 'rgb(var(--fg-muted))' }} />
                <Tooltip
                  formatter={(v: number) => [v.toFixed(1), 'unidades']}
                  contentStyle={{ background: 'rgb(var(--panel))', border: '1px solid rgb(var(--border))', borderRadius: 12, fontSize: 12 }}
                />
                <Bar dataKey="venta" radius={[6, 6, 0, 0]}>
                  {perfil.map((p) => (
                    <Cell key={p.dia} fill={p.enPeriodo ? 'rgb(var(--accent))' : 'rgb(var(--border-strong))'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-xs text-fg-muted">Sin ventas registradas en las últimas semanas.</p>
        )}
        <p className="mt-1 text-xs text-fg-muted">En color, los días que entran en el período.</p>
      </div>

      {proyeccion.length > 0 && f.con_historia && (
        <div>
          <p className="mb-2 text-sm font-medium text-fg">Proyección día a día</p>
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface text-left text-xs text-fg-muted">
                  <th className="px-3 py-2 font-medium">Día</th>
                  <th className="px-3 py-2 text-right font-medium">Venta esperada</th>
                  <th className="px-3 py-2 text-right font-medium">Stock al cierre</th>
                </tr>
              </thead>
              <tbody>
                {proyeccion.map((d) => (
                  <tr key={d.fecha} className="border-b border-border/60 last:border-0">
                    <td className="px-3 py-2 capitalize text-fg-body">{formatDiaCorto(d.fecha)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-fg-body">{d.demanda.toFixed(1)}</td>
                    <td className={cn('px-3 py-2 text-right font-medium tabular-nums', d.stock < 0 ? 'text-danger' : 'text-fg')}>
                      {d.stock < 0 ? `Faltan ${Math.ceil(-d.stock)}` : Math.floor(d.stock)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-xs text-fg-muted">Incluye el stock en tránsito; hoy descuenta lo ya vendido.</p>
        </div>
      )}
    </div>
  )
}

/** «dom 25-10» sin saltos de línea dentro de la fecha (espacio y guion que no se cortan). */
function sinCortes(texto: string): string {
  return texto.replace(/ /g, '\u00a0').replace(/-/g, '\u2011')
}

function Cifra({
  icono,
  n,
  label,
  tono
}: {
  icono: ReactNode
  n: number
  label: string
  tono?: 'danger' | 'warning'
}) {
  const color = n > 0 && tono === 'danger' ? 'text-danger' : n > 0 && tono === 'warning' ? 'text-warning' : 'text-fg'
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-border bg-panel px-3 py-2 shadow-card">
      <span className={cn('shrink-0', n > 0 && tono ? color : 'text-fg-faint')} aria-hidden>
        {icono}
      </span>
      <div className="min-w-0">
        <p className={cn('text-base font-semibold leading-tight tabular-nums', color)}>{n}</p>
        <p className="line-clamp-2 text-[11px] leading-tight text-fg-muted">{label}</p>
      </div>
    </div>
  )
}

function Dato({ label, valor }: { label: string; valor: number | string }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <p className="text-lg font-semibold tabular-nums text-fg">{valor}</p>
      <p className="text-[11px] text-fg-muted">{label}</p>
    </div>
  )
}

