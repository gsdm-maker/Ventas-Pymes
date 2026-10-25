import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Search,
  Plus,
  Minus,
  Trash2,
  ShoppingCart,
  Banknote,
  CreditCard,
  ArrowLeftRight,
  CheckCircle2,
  CloudOff,
  Rows3,
  LayoutGrid,
  Keyboard
} from 'lucide-react'
import { useAuth } from '@/core/auth/AuthProvider'
import { useSync } from '@/core/offline/SyncProvider'
import { esErrorDeRed } from '@/core/offline/errores'
import { invalidarAlertas } from '@/core/data/useAlertasStock'
import { supabase } from '@/core/supabase/client'
import { listarCategorias, listarProductosConStock, rankingVentas } from '@/core/data/api'
import { pendientesPorProducto } from '@/core/offline/respaldo'
import { aplicarPendientes, clave, etiquetaVariante } from '@/lib/variantes'
import type { Categoria, ProductoConStock } from '@/core/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { PageHeader } from '@/components/ui/Feedback'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/cn'
import { SelectorVista, type OpcionVista } from '@/components/ui/SelectorVista'
import { desglosarIVA, formatCLP } from '@/lib/format'

interface Linea {
  producto_id: string
  variante_id: string | null
  /** SKU de la variante o del producto */
  codigo: string
  descripcion: string
  precio_unitario: number
  cantidad: number
  disponible: number
}

type Medio = 'efectivo' | 'transferencia' | 'debito'
type VistaPos = 'lista' | 'botones'

// Con conexión, la copia local del catálogo se renueva cada 5 minutos aunque no se venda:
// si se corta internet, el POS vende con un stock de hace como máximo ese tiempo
const RENOVAR_COPIA_MS = 5 * 60 * 1000

const VISTAS_POS: OpcionVista<VistaPos>[] = [
  { v: 'lista', etiqueta: 'Lista compacta', Icono: Rows3 },
  { v: 'botones', etiqueta: 'Botones', Icono: LayoutGrid }
]

const medios: { key: Medio; label: string; icon: typeof Banknote; refLabel: string }[] = [
  { key: 'efectivo', label: 'Efectivo', icon: Banknote, refLabel: '' },
  { key: 'transferencia', label: 'Transferencia', icon: ArrowLeftRight, refLabel: 'Número de transferencia' },
  { key: 'debito', label: 'Débito', icon: CreditCard, refLabel: 'Número de voucher de venta' }
]

export function POS() {
  const { ubicacionActiva, ubicaciones, profile } = useAuth()
  const { online, encolarOperacion } = useSync()
  const toast = useToast()
  const [productos, setProductos] = useState<ProductoConStock[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [catActiva, setCatActiva] = useState<string>('all')
  const [busqueda, setBusqueda] = useState('')
  const [vista, setVista] = useState<VistaPos>('lista')
  // Unidades vendidas por producto en esta tienda (30 días): lo más vendido primero
  const [ranking, setRanking] = useState<Map<string, number>>(new Map())
  const [recibido, setRecibido] = useState(0)
  const [cantidadEleccion, setCantidadEleccion] = useState(1)
  const buscador = useRef<HTMLInputElement>(null)
  const [lineas, setLineas] = useState<Linea[]>([])

  // El ticket en curso sobrevive a una recarga: queda en el dispositivo por usuario y tienda,
  // y se borra al cobrar (o al vaciarlo)
  const claveTicket = profile && ubicacionActiva ? `misociopyme:ticket:${profile.id}:${ubicacionActiva}` : null
  const recienRestaurado = useRef(false)
  useEffect(() => {
    if (!claveTicket) return
    let guardado: Linea[] = []
    try {
      guardado = JSON.parse(localStorage.getItem(claveTicket) ?? '[]') as Linea[]
    } catch {
      guardado = []
    }
    // El guardado de este mismo render llevaría el ticket de la tienda anterior: se omite
    recienRestaurado.current = true
    // JSON guarda Infinity (productos sin control de stock) como null
    setLineas(Array.isArray(guardado) ? guardado.map((l) => ({ ...l, disponible: l.disponible ?? Number.POSITIVE_INFINITY })) : [])
  }, [claveTicket])
  useEffect(() => {
    if (!claveTicket) return
    if (recienRestaurado.current) {
      recienRestaurado.current = false
      return
    }
    try {
      if (lineas.length) localStorage.setItem(claveTicket, JSON.stringify(lineas))
      else localStorage.removeItem(claveTicket)
    } catch {
      // Sin almacenamiento (modo privado): el ticket solo vive en memoria
    }
  }, [lineas, claveTicket])
  const [descuentoTipo, setDescuentoTipo] = useState<'porcentaje' | 'monto'>('porcentaje')
  const [descuentoValor, setDescuentoValor] = useState(0)
  const [medio, setMedio] = useState<Medio>('efectivo')
  const [referencia, setReferencia] = useState('')
  const [enviando, setEnviando] = useState(false)
  // Última venta: aviso sin bloquear, la caja queda lista para la siguiente
  const [ultima, setUltima] = useState<{ folio: string; total: number; offline: boolean } | null>(null)
  const [ticketAbierto, setTicketAbierto] = useState(false)

  const ubicacionNombre = ubicaciones.find((u) => u.id === ubicacionActiva)?.nombre ?? ''

  useEffect(() => {
    listarCategorias().then(setCategorias)
  }, [])

  // Stock de la copia (o del servidor) menos lo que aún está en la cola offline
  async function recargarProductos() {
    if (!ubicacionActiva) return
    const [lista, pendientes] = await Promise.all([
      listarProductosConStock(ubicacionActiva),
      pendientesPorProducto(ubicacionActiva)
    ])
    setProductos(aplicarPendientes(lista.filter((x) => x.activo), pendientes))
  }

  useEffect(() => {
    void recargarProductos().catch(() => toast('No hay copia local del catálogo: conéctate una vez para descargarlo', 'error'))
    if (ubicacionActiva) rankingVentas(ubicacionActiva).then(setRanking).catch(() => setRanking(new Map()))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ubicacionActiva])

  // Renovación de la copia: cada 5 min, al volver la conexión (tras dar tiempo a que suba la
  // cola de ventas offline) y al volver a esta pestaña. Sin red no hace nada: se usa la copia.
  const recargarRef = useRef(recargarProductos)
  recargarRef.current = recargarProductos
  useEffect(() => {
    const renovar = () => {
      if (navigator.onLine) void recargarRef.current().catch(() => {})
    }
    let tras: number | undefined
    const alReconectar = () => {
      window.clearTimeout(tras)
      tras = window.setTimeout(renovar, 3000)
    }
    const alVolver = () => {
      if (document.visibilityState === 'visible') renovar()
    }
    const id = window.setInterval(renovar, RENOVAR_COPIA_MS)
    window.addEventListener('online', alReconectar)
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      window.clearInterval(id)
      window.clearTimeout(tras)
      window.removeEventListener('online', alReconectar)
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [])

  const enfocarBuscador = () => {
    // En celular no se abre el teclado solo
    if (window.matchMedia('(pointer: fine)').matches) buscador.current?.focus()
  }

  // «3*pol» o «3x pol»: agrega 3 unidades del producto buscado
  const multiplicador = busqueda.match(/^\s*(\d{1,3})\s*[*x×]\s*(.*)$/i)
  const cantidadBusqueda = multiplicador ? Math.max(1, Number(multiplicador[1])) : 1
  const termino = (multiplicador ? multiplicador[2] : busqueda).trim().toLowerCase()

  const filtrados = useMemo(() => {
    return productos
      .filter((p) => {
        if (catActiva !== 'all' && p.categoria_id !== catActiva) return false
        if (!termino) return true
        return (
          p.nombre.toLowerCase().includes(termino) ||
          p.sku.toLowerCase().includes(termino) ||
          (p.codigo_barras ?? '') === termino
        )
      })
      .sort((a, b) => (ranking.get(b.id) ?? 0) - (ranking.get(a.id) ?? 0) || a.nombre.localeCompare(b.nombre))
  }, [productos, catActiva, termino, ranking])

  // Producto con tallas/colores: primero se elige la variante
  const [eligiendo, setEligiendo] = useState<ProductoConStock | null>(null)

  function agregar(p: ProductoConStock, cantidad = 1) {
    if (p.variantes?.length) {
      setCantidadEleccion(cantidad)
      setEligiendo(p)
    } else {
      agregarLinea(p, null, p.disponible, '', cantidad)
    }
    setBusqueda('')
    enfocarBuscador()
  }

  function agregarLinea(p: ProductoConStock, varianteId: string | null, stock: number, etiqueta: string, cantidad = 1) {
    // Sin control de stock (platos, servicios): siempre se puede vender
    const controla = p.controla_stock !== false
    const disponibleLinea = stock
    setLineas((prev) => {
      const ex = prev.find((l) => l.producto_id === p.id && l.variante_id === varianteId)
      const yaEnTicket = ex?.cantidad ?? 0
      if (controla && yaEnTicket + cantidad > disponibleLinea) {
        toast(disponibleLinea - yaEnTicket > 0 ? `Solo quedan ${disponibleLinea - yaEnTicket} u.` : 'Sin stock en esta ubicación', 'warning')
        return prev
      }
      if (ex) return prev.map((l) => (l === ex ? { ...l, cantidad: l.cantidad + cantidad } : l))
      return [
        ...prev,
        {
          producto_id: p.id,
          variante_id: varianteId,
          codigo: p.variantes?.find((v) => v.id === varianteId)?.sku ?? p.sku,
          descripcion: etiqueta ? `${p.nombre} · ${etiqueta}` : p.nombre,
          precio_unitario: p.precio_venta,
          cantidad,
          disponible: controla ? disponibleLinea : Number.POSITIVE_INFINITY
        }
      ]
    })
  }

  function cambiarCantidad(claveLinea: string, delta: number) {
    setLineas((prev) =>
      prev
        .map((l) =>
          clave(l.producto_id, l.variante_id) === claveLinea
            ? { ...l, cantidad: Math.min(l.cantidad + delta, l.disponible) }
            : l
        )
        .filter((l) => l.cantidad > 0)
    )
  }

  const bruto = lineas.reduce((a, l) => a + l.precio_unitario * l.cantidad, 0)
  const descMonto =
    descuentoTipo === 'porcentaje'
      ? Math.round((bruto * Math.min(Math.max(descuentoValor, 0), 100)) / 100)
      : Math.min(Math.max(descuentoValor, 0), bruto)
  const total = bruto - descMonto
  const { neto, iva } = desglosarIVA(total)

  const referenciaRequerida = medio !== 'efectivo'
  // Efectivo: si se ingresó con cuánto paga, debe alcanzar. Una venta en $0 no se cobra.
  const faltaEfectivo = medio === 'efectivo' && recibido > 0 && recibido < total
  const puedeCobrar =
    lineas.length > 0 &&
    total > 0 &&
    !faltaEfectivo &&
    (!referenciaRequerida || referencia.trim().length > 0) &&
    !enviando

  async function finalizar() {
    if (!ubicacionActiva) return
    setEnviando(true)
    // Identificador de la venta: el servidor la registra una sola vez aunque se reenvíe
    const uuidLocal = crypto.randomUUID()
    const items = lineas.map((l) => ({
      producto_id: l.producto_id,
      variante_id: l.variante_id,
      descripcion: l.descripcion,
      cantidad: l.cantidad,
      precio_unitario: l.precio_unitario
    }))
    const payload = {
      ubicacion_id: ubicacionActiva,
      items,
      descuento_tipo: descuentoTipo,
      descuento_valor: descuentoValor,
      medio_pago: medio,
      referencia: referenciaRequerida ? referencia.trim() : null
    }

    const guardarOffline = async () => {
      await encolarOperacion('venta', payload, uuidLocal)
      void recargarProductos()
      setUltima({ folio: 'Pendiente de sincronización', total, offline: true })
      toast('Venta guardada sin conexión')
      setLineas([])
      setDescuentoValor(0)
      setReferencia('')
      setRecibido(0)
      setEnviando(false)
      enfocarBuscador()
    }

    if (!online) return guardarOffline()

    const { data, error, status } = await supabase.rpc('registrar_venta', {
      p_ubicacion: ubicacionActiva,
      p_items: items,
      p_descuento_tipo: descuentoTipo,
      p_descuento_valor: descuentoValor,
      p_medio_pago: medio,
      p_referencia: referenciaRequerida ? referencia.trim() : null,
      p_uuid_local: uuidLocal
    })
    // Se cayó la red a mitad de camino: queda en cola con el mismo uuid (no se duplica)
    if (esErrorDeRed(error, status)) return guardarOffline()
    setEnviando(false)
    if (error) {
      toast(error.message, 'error')
      return
    }
    const venta = data as { folio: string; total: number }
    invalidarAlertas()
    setUltima({ folio: venta.folio, total: venta.total, offline: false })
    toast(`Venta ${venta.folio} registrada`)
    setLineas([])
    setDescuentoValor(0)
    setReferencia('')
    setRecibido(0)
    enfocarBuscador()
    void recargarProductos()
  }

  // F9 cobra · F2 o «/» va al buscador · Esc limpia la búsqueda
  useEffect(() => {
    const alPresionar = (e: KeyboardEvent) => {
      if (document.querySelector('[role=dialog]')) return
      if (e.key === 'F9' && puedeCobrar) {
        e.preventDefault()
        void finalizar()
      } else if (e.key === 'F2' || (e.key === '/' && document.activeElement?.tagName !== 'INPUT')) {
        e.preventDefault()
        buscador.current?.focus()
      } else if (e.key === 'Escape' && document.activeElement === buscador.current) {
        setBusqueda('')
      }
    }
    window.addEventListener('keydown', alPresionar)
    return () => window.removeEventListener('keydown', alPresionar)
  })

  return (
    <>
      <PageHeader title="Punto de Venta" subtitle={`Vendiendo en ${ubicacionNombre}`} />

      {/* En escritorio todo cabe en la pantalla: barra con el título (4rem) + márgenes (3.25rem) */}
      <div className="flex flex-col gap-4 lg:h-[calc(100dvh-7.25rem)] lg:min-h-[30rem] lg:flex-row lg:overflow-hidden">
        {/* Catálogo */}
        <div className="flex min-w-0 flex-1 flex-col pb-24 lg:min-h-0 lg:pb-0">
          <div className="sticky top-16 z-20 -mx-4 mb-3 border-b border-border bg-shell/95 px-4 py-2 shadow-sm backdrop-blur lg:static lg:mx-0 lg:mb-0 lg:rounded-t-2xl lg:border lg:border-b-0 lg:bg-panel lg:p-3 lg:shadow-none">
            <div className="mb-3 flex items-center gap-2">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint" aria-hidden />
                <Input
                  ref={buscador}
                  className="pl-9 text-base"
                  placeholder="Buscar producto…"
                  aria-label="Buscar producto"
                  autoComplete="off"
                  enterKeyHint="go"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && filtrados[0] && termino) {
                      e.preventDefault()
                      agregar(filtrados[0], cantidadBusqueda)
                    }
                  }}
                />
                {cantidadBusqueda > 1 && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md bg-accent px-1.5 py-0.5 text-xs font-semibold text-on-accent">
                    ×{cantidadBusqueda}
                  </span>
                )}
              </div>
              <SelectorVista valor={vista} onChange={setVista} opciones={VISTAS_POS} />
            </div>
            <p className="mb-2 hidden items-center gap-1.5 text-[11px] text-fg-faint lg:flex">
              <Keyboard size={12} aria-hidden /> Enter agrega el primero · 3* multiplica · Esc limpia · F9 cobra
            </p>

            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
              <Chip activa={catActiva === 'all'} onClick={() => setCatActiva('all')}>
                Todo el catálogo
              </Chip>
              {categorias.map((c) => (
                <Chip key={c.id} activa={catActiva === c.id} onClick={() => setCatActiva(c.id)}>
                  {c.nombre}
                </Chip>
              ))}
            </div>
          </div>

          <div className="lg:flex-1 lg:overflow-y-auto lg:rounded-b-2xl lg:border lg:border-t-0 lg:bg-panel lg:p-3">
            {filtrados.length === 0 ? (
              <p className="py-10 text-center text-sm text-fg-muted">No se encontraron productos.</p>
            ) : vista === 'botones' ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 min-[1400px]:grid-cols-4">
                {filtrados.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => agregar(p)}
                    className={cn(
                      'flex min-h-20 flex-col justify-between rounded-xl border border-border bg-panel p-2.5 text-left transition-colors hover:border-accent/50 active:scale-[0.98]',
                      agotado(p) && 'opacity-50'
                    )}
                  >
                    <span className="flex items-start gap-2">
                      {p.foto_url && (
                        <img src={p.foto_url} alt="" width={36} height={36} loading="lazy" className="size-9 shrink-0 rounded-lg object-cover" />
                      )}
                      <span className="min-w-0">
                        <span className="line-clamp-2 text-sm font-medium leading-snug text-fg">{p.nombre}</span>
                        <span className="block font-mono text-[11px] text-fg-faint">{p.sku}</span>
                      </span>
                    </span>
                    <span className="mt-1.5 flex items-end justify-between gap-1">
                      <span className="text-sm font-semibold tabular-nums text-fg">{formatCLP(p.precio_venta)}</span>
                      <AvisoStock p={p} />
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-panel lg:rounded-none lg:border-0 lg:bg-transparent">
                {filtrados.map((p, i) => (
                  <button
                    key={p.id}
                    onClick={() => agregar(p)}
                    className={cn(
                      'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface active:bg-surface-2',
                      i === 0 && termino && 'bg-accent-soft/40',
                      agotado(p) && 'opacity-50'
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="truncate text-sm font-medium text-fg">{p.nombre}</span>
                        <span className="shrink-0 font-mono text-[11px] text-fg-faint">{p.sku}</span>
                      </span>
                      {p.variantes?.length > 0 && <span className="text-xs text-fg-muted">{p.variantes.length} tallas/colores</span>}
                    </span>
                    <AvisoStock p={p} />
                    <span className="w-24 text-right text-sm font-semibold tabular-nums text-fg">{formatCLP(p.precio_venta)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Ticket */}
        <div className="hidden w-full flex-col rounded-2xl border border-border bg-panel p-4 lg:flex lg:h-full lg:w-[380px] lg:shrink-0 lg:overflow-hidden xl:w-[420px]">
          <TicketPanel
            lineas={lineas}
            cambiarCantidad={cambiarCantidad}
            eliminarLinea={(k) => setLineas((prev) => prev.filter((x) => clave(x.producto_id, x.variante_id) !== k))}
            bruto={bruto}
            descMonto={descMonto}
            total={total}
            neto={neto}
            iva={iva}
            descuentoTipo={descuentoTipo}
            setDescuentoTipo={setDescuentoTipo}
            descuentoValor={descuentoValor}
            setDescuentoValor={setDescuentoValor}
            medio={medio}
            setMedio={setMedio}
            referencia={referencia}
            setReferencia={setReferencia}
            puedeCobrar={puedeCobrar}
            enviando={enviando}
            finalizar={finalizar}
            online={online}
            ultima={ultima}
            recibido={recibido}
            setRecibido={setRecibido}
          />
        </div>

        {/* Resumen flotante del ticket en móvil */}
        <TicketResumenMovil
          lineas={lineas}
          total={total}
          onVerTicket={() => setTicketAbierto(true)}
        />

        {/* Modal del ticket en móvil */}
        <Modal
          open={ticketAbierto}
          onClose={() => setTicketAbierto(false)}
          title={`Ticket activo · ${lineas.length} ítem(s)`}
        >
          <TicketPanel
            lineas={lineas}
            cambiarCantidad={cambiarCantidad}
            eliminarLinea={(k) => setLineas((prev) => prev.filter((x) => clave(x.producto_id, x.variante_id) !== k))}
            bruto={bruto}
            descMonto={descMonto}
            total={total}
            neto={neto}
            iva={iva}
            descuentoTipo={descuentoTipo}
            setDescuentoTipo={setDescuentoTipo}
            descuentoValor={descuentoValor}
            setDescuentoValor={setDescuentoValor}
            medio={medio}
            setMedio={setMedio}
            referencia={referencia}
            setReferencia={setReferencia}
            puedeCobrar={puedeCobrar}
            enviando={enviando}
            finalizar={() => { setTicketAbierto(false); void finalizar() }}
            online={online}
            ultima={ultima}
            recibido={recibido}
            setRecibido={setRecibido}
          />
        </Modal>
      </div>

      <Modal open={!!eligiendo} onClose={() => setEligiendo(null)} title={eligiendo ? `${eligiendo.nombre}: elige talla o color` : ''} size="sm">
        {eligiendo && (
          <div className="flex flex-wrap gap-2">
            {eligiendo.variantes.map((v) => {
              const sinStock = eligiendo.controla_stock !== false && v.disponible <= 0
              return (
                <button
                  key={v.id}
                  disabled={sinStock}
                  onClick={() => {
                    agregarLinea(eligiendo, v.id, v.disponible, etiquetaVariante(v), cantidadEleccion)
                    setEligiendo(null)
                  }}
                  className="min-w-20 rounded-xl border border-border px-3 py-2 text-left text-sm transition-colors hover:border-accent hover:bg-accent-soft/40 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span className="block font-medium text-fg">{etiquetaVariante(v) || v.sku}</span>
                  {eligiendo.controla_stock !== false && (
                    <span className={cn('text-xs tabular-nums', sinStock ? 'text-danger' : 'text-fg-muted')}>
                      {sinStock ? 'Sin stock' : `${v.disponible} u.`}
                    </span>
                  )}
                </button>
              )
            })}
            {eligiendo.legado > 0 && (
              <button
                onClick={() => {
                  agregarLinea(eligiendo, null, eligiendo.legado, 'sin talla', cantidadEleccion)
                  setEligiendo(null)
                }}
                className="min-w-20 rounded-xl border border-dashed border-border px-3 py-2 text-left text-sm hover:bg-surface"
              >
                <span className="block font-medium text-fg">Sin talla</span>
                <span className="text-xs tabular-nums text-fg-muted">{eligiendo.legado} u. antiguas</span>
              </button>
            )}
          </div>
        )}
      </Modal>

    </>
  )
}

interface TicketPanelProps {
  lineas: Linea[]
  cambiarCantidad: (claveLinea: string, delta: number) => void
  eliminarLinea: (claveLinea: string) => void
  bruto: number
  descMonto: number
  total: number
  neto: number
  iva: number
  descuentoTipo: 'porcentaje' | 'monto'
  setDescuentoTipo: (t: 'porcentaje' | 'monto') => void
  descuentoValor: number
  setDescuentoValor: (v: number) => void
  medio: Medio
  setMedio: (m: Medio) => void
  referencia: string
  setReferencia: (r: string) => void
  puedeCobrar: boolean
  enviando: boolean
  finalizar: () => void
  online: boolean
  ultima: { folio: string; total: number; offline: boolean } | null
  recibido: number
  setRecibido: (n: number) => void
}

function TicketPanel({
  lineas,
  cambiarCantidad,
  eliminarLinea,
  bruto,
  descMonto,
  total,
  neto,
  iva,
  descuentoTipo,
  setDescuentoTipo,
  descuentoValor,
  setDescuentoValor,
  medio,
  setMedio,
  referencia,
  setReferencia,
  puedeCobrar,
  enviando,
  finalizar,
  online,
  ultima,
  recibido,
  setRecibido
}: TicketPanelProps) {
  // Billetes para cobrar rápido en efectivo (montos mayores al total)
  const billetes = [...new Set([total, ...[1000, 2000, 5000, 10000, 20000].map((b) => Math.ceil(total / b) * b)])]
    .filter((n) => n >= total && n > 0)
    .slice(0, 4)
  const vuelto = recibido > 0 ? recibido - total : 0
  const medioInfo = medios.find((m) => m.key === medio)!
  const referenciaRequerida = medio !== 'efectivo'

  return (
    <>
      {ultima && (
        <div className={cn('mb-2.5 flex shrink-0 items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-xs', ultima.offline ? 'bg-warning-soft text-warning' : 'bg-success-soft text-success')}>
          <span className="flex items-center gap-1.5">
            {ultima.offline ? <CloudOff size={13} aria-hidden /> : <CheckCircle2 size={13} aria-hidden />}
            Última venta: <strong className="font-semibold">{ultima.folio}</strong>
          </span>
          <span className="font-semibold tabular-nums">{formatCLP(ultima.total)}</span>
        </div>
      )}
      {/* En móvil el título lo pone el modal */}
      <div className="hidden shrink-0 items-center justify-between lg:flex">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
          <ShoppingCart size={16} className="text-accent" />
          Ticket activo
        </h2>
        <span className="rounded-full bg-surface px-2.5 py-0.5 text-xs text-fg-muted">
          {lineas.length} ítem(s)
        </span>
      </div>

      {/* Detalle: en escritorio se desplaza y el cobro queda siempre a la vista */}
      <div className="my-3 space-y-2 lg:-mr-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-2">
        {lineas.length === 0 ? (
          <p className="py-8 text-center text-sm text-fg-muted">
            El ticket está vacío. Selecciona productos del catálogo.
          </p>
        ) : (
          lineas.map((l) => (
            <div
              key={clave(l.producto_id, l.variante_id)}
              className="flex items-center gap-2 rounded-xl bg-surface py-2 pl-3 pr-1.5"
            >
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-medium leading-snug text-fg">{l.descripcion}</p>
                <p className="mt-0.5 truncate text-xs tabular-nums text-fg-muted">
                  <span className="font-mono">{l.codigo}</span> · {formatCLP(l.precio_unitario)} c/u
                </p>
              </div>
              <div className="flex items-center">
                <button
                  onClick={() => cambiarCantidad(clave(l.producto_id, l.variante_id), -1)}
                  aria-label={`Disminuir cantidad de ${l.descripcion}`}
                  className="grid size-7 place-items-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg"
                >
                  <Minus size={13} />
                </button>
                <span className="w-6 text-center text-sm font-medium tabular-nums">{l.cantidad}</span>
                <button
                  onClick={() => cambiarCantidad(clave(l.producto_id, l.variante_id), 1)}
                  aria-label={`Aumentar cantidad de ${l.descripcion}`}
                  className="grid size-7 place-items-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg"
                >
                  <Plus size={13} />
                </button>
              </div>
              <span className="w-20 text-right text-sm font-semibold tabular-nums text-fg">
                {formatCLP(l.precio_unitario * l.cantidad)}
              </span>
              <button
                onClick={() => eliminarLinea(clave(l.producto_id, l.variante_id))}
                aria-label={`Eliminar ${l.descripcion} del ticket`}
                className="grid size-7 place-items-center rounded-md text-fg-faint hover:bg-danger-soft hover:text-danger"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))
        )}
      </div>

      <div className="shrink-0 space-y-3 border-t border-border pt-3">
        {/* Descuento: valor y tipo (% o $) en un solo control */}
        <div className="flex h-10 items-stretch overflow-hidden rounded-xl border border-border bg-field focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/40">
          <label htmlFor="pos-descuento" className="flex items-center pl-3 text-xs font-medium text-fg-muted">
            Descuento
          </label>
          <input
            id="pos-descuento"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            placeholder="0"
            value={descuentoValor || ''}
            // La base recibe un entero: un "12.5" haría fallar la venta (y la cola offline)
            // Tope: 100 % o el subtotal del ticket
            onChange={(e) => {
              const v = Math.max(0, Math.round(Number(e.target.value) || 0))
              setDescuentoValor(Math.min(v, descuentoTipo === 'porcentaje' ? 100 : bruto))
            }}
            className="min-w-0 flex-1 bg-transparent px-2 text-right text-sm tabular-nums text-fg outline-none placeholder:text-fg-faint"
          />
          <div role="group" aria-label="Tipo de descuento" className="flex border-l border-border">
            {(['porcentaje', 'monto'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setDescuentoTipo(t)
                  if (t === 'porcentaje' && descuentoValor > 100) setDescuentoValor(100)
                }}
                aria-pressed={descuentoTipo === t}
                aria-label={t === 'porcentaje' ? 'Descuento en porcentaje' : 'Descuento en pesos'}
                className={cn(
                  'w-10 text-sm font-semibold transition-colors',
                  descuentoTipo === t ? 'bg-accent text-on-accent' : 'text-fg-muted hover:bg-surface'
                )}
              >
                {t === 'porcentaje' ? '%' : '$'}
              </button>
            ))}
          </div>
        </div>

        {/* Medio de pago */}
        <div>
          <div role="group" aria-label="Medio de pago" className="grid grid-cols-3 gap-1.5">
            {medios.map((m) => (
              <button
                key={m.key}
                onClick={() => {
                  setMedio(m.key)
                  setReferencia('')
                }}
                aria-pressed={medio === m.key}
                className={cn(
                  'flex h-10 items-center justify-center gap-1.5 rounded-xl px-1 text-xs font-medium transition-colors duration-200',
                  medio === m.key
                    ? 'bg-accent-soft text-accent ring-1 ring-accent/30'
                    : 'bg-surface text-fg-muted hover:bg-surface-2'
                )}
              >
                <m.icon size={14} className="shrink-0" />
                <span className="truncate">{m.label}</span>
              </button>
            ))}
          </div>
          {referenciaRequerida && (
            <Input
              className="mt-2 h-10 py-0"
              placeholder={medioInfo.refLabel}
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
            />
          )}
          {medio === 'efectivo' && total > 0 && (
            <div className="mt-2 flex items-center gap-1.5">
              <div className="flex shrink-0 gap-1">
                {billetes.slice(0, 3).map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setRecibido(b)}
                    aria-pressed={recibido === b}
                    className={cn(
                      'h-10 rounded-xl border px-2.5 text-xs font-medium tabular-nums transition-colors',
                      recibido === b ? 'border-accent bg-accent-soft text-accent' : 'border-border text-fg-body hover:bg-surface'
                    )}
                  >
                    {b === total ? 'Exacto' : formatCLP(b)}
                  </button>
                ))}
              </div>
              <Input
                type="number"
                inputMode="numeric"
                placeholder="Paga con…"
                aria-label="Monto recibido en efectivo"
                value={recibido || ''}
                onChange={(e) => setRecibido(Number(e.target.value) || 0)}
                className="h-10 min-w-0 px-2.5 py-0 text-right tabular-nums"
              />
            </div>
          )}
        </div>

        {/* Totales */}
        <div className="space-y-1 text-sm text-fg-muted">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span className="tabular-nums">{formatCLP(bruto)}</span>
          </div>
          {descMonto > 0 && (
            <div className="flex justify-between">
              <span>Descuento</span>
              <span className="tabular-nums">-{formatCLP(descMonto)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span>Neto · IVA 19% incluido</span>
            <span className="tabular-nums">{formatCLP(neto)} · {formatCLP(iva)}</span>
          </div>
          {medio === 'efectivo' && recibido > 0 && (
            <div className={cn('flex justify-between font-semibold', vuelto < 0 ? 'text-danger' : 'text-fg')}>
              <span>{vuelto < 0 ? 'Faltan' : 'Vuelto'}</span>
              <span className="tabular-nums">{formatCLP(Math.abs(vuelto))}</span>
            </div>
          )}
          <div className="flex items-baseline justify-between pt-1 text-fg">
            <span className="text-base font-semibold">Total a cobrar</span>
            <span className="text-2xl font-semibold tabular-nums text-accent">{formatCLP(total)}</span>
          </div>
        </div>

        <Button block size="lg" disabled={!puedeCobrar} onClick={() => void finalizar()}>
          <ShoppingCart size={18} />
          {enviando ? 'Registrando…' : 'Cobrar'}
          <kbd className="ml-1 hidden rounded border border-current/30 px-1 text-[10px] font-normal opacity-70 lg:inline">F9</kbd>
        </Button>
        {lineas.length > 0 && total <= 0 && (
          <p className="text-center text-xs text-danger">Con ese descuento la venta queda en $0: no se puede cobrar.</p>
        )}
        {!online && (
          <p className="flex items-center justify-center gap-1.5 text-[11px] text-warning">
            <CloudOff size={12} />
            Sin conexión: la venta se guardará y sincronizará automáticamente.
          </p>
        )}
      </div>
    </>
  )
}

function TicketResumenMovil({
  lineas,
  total,
  onVerTicket
}: {
  lineas: Linea[]
  total: number
  onVerTicket: () => void
}) {
  return (
    <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 px-4 lg:hidden">
      <button
        onClick={onVerTicket}
        className="flex w-full items-center justify-between gap-3 rounded-2xl border border-border bg-panel/95 px-4 py-3 shadow-card backdrop-blur active:scale-[0.99]"
      >
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg bg-accent text-on-accent">
            <ShoppingCart size={16} />
          </span>
          <div className="text-left">
            <p className="text-xs text-fg-muted">{lineas.length} ítem(s)</p>
            <p className="tabular-nums text-sm font-semibold text-fg">{formatCLP(total)}</p>
          </div>
        </div>
        <span className="text-xs font-medium text-accent">Ver ticket</span>
      </button>
    </div>
  )
}

function Chip({
  activa,
  onClick,
  children
}: {
  activa: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors',
        activa ? 'bg-accent text-on-accent shadow-sm' : 'bg-surface text-fg-muted hover:bg-surface-2'
      )}
    >
      {children}
    </button>
  )
}

function agotado(p: ProductoConStock): boolean {
  return p.controla_stock !== false && p.disponible <= 0
}

/** Stock solo cuando importa: agotado o pocas unidades (no es una vista de inventario) */
function AvisoStock({ p }: { p: ProductoConStock }) {
  if (p.controla_stock === false) return null
  if (p.disponible <= 0) return <span className="shrink-0 text-xs font-medium text-danger">Agotado</span>
  if (p.disponible <= Math.max(p.stock_minimo, 3)) {
    return <span className="shrink-0 text-xs font-medium text-warning">Quedan {p.disponible}</span>
  }
  return null
}
