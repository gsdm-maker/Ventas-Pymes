import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRightLeft,
  Ban,
  CheckCircle2,
  ChefHat,
  Minus,
  Plus,
  Printer,
  Search,
  Settings2,
  StickyNote,
  Trash2,
  Users,
  UtensilsCrossed,
  X
} from 'lucide-react'
import { useAuth } from '@/core/auth/AuthProvider'
import { useSync } from '@/core/offline/SyncProvider'
import { cargarSalon, listarCategorias, listarProductosConStock, rankingVentas, type Salon } from '@/core/data/api'
import { useTiempoReal } from '@/core/data/useTiempoReal'
import type { Categoria, Comanda, CuentaItem, Mesa, ProductoConStock, Venta } from '@/core/types'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { EmptyState, LoadingState, PageHeader } from '@/components/ui/Feedback'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/confirm'
import { ModalCobroCuenta } from '@/components/mesas/ModalCobroCuenta'
import { GestorMesas } from '@/components/mesas/GestorMesas'
import { documentoTicket, esc, imprimirDocumento, leerConfigImpresion, ticketVentaHtml } from '@/lib/impresion'
import { cn } from '@/lib/cn'
import { desglosarIVA, formatCLP, formatHora } from '@/lib/format'
import { etiquetaVariante } from '@/lib/variantes'
import { anularCuenta as anularCuentaEnBase, anularItemCuenta, cambiarEstadoComanda, enviarPedido, moverCuenta } from '@/core/data/restaurante'
import { voucherDeVenta } from '@/core/data/ventas'

/** Línea del pedido que aún no se envía a cocina. */
interface Borrador {
  clave: string
  producto_id: string
  variante_id: string | null
  descripcion: string
  precio: number
  cantidad: number
  nota: string
}

const ESTADO_COMANDA: Record<Comanda['estado'], { label: string; tone: 'warning' | 'info' | 'success' | 'neutral' | 'danger' }> = {
  pendiente: { label: 'En cocina', tone: 'warning' },
  preparando: { label: 'Preparando', tone: 'info' },
  lista: { label: 'Lista para servir', tone: 'success' },
  entregada: { label: 'Entregada', tone: 'neutral' },
  anulada: { label: 'Anulada', tone: 'danger' }
}


export function Mesas() {
  const { ubicacionActiva, ubicaciones, empresa, can, profile } = useAuth()
  const { online } = useSync()
  const toast = useToast()
  const confirmar = useConfirm()
  const [salon, setSalon] = useState<Salon | null>(null)
  const [productos, setProductos] = useState<ProductoConStock[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [ranking, setRanking] = useState<Map<string, number>>(new Map())
  const [sel, setSel] = useState<string | null>(null)
  const [modo, setModo] = useState<'salon' | 'pedido'>('salon')
  const [borradores, setBorradores] = useState<Record<string, Borrador[]>>({})
  const [comensales, setComensales] = useState<Record<string, number>>({})
  const [busqueda, setBusqueda] = useState('')
  const [categoria, setCategoria] = useState('')
  const [notaDe, setNotaDe] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [cobrando, setCobrando] = useState(false)
  const [moviendo, setMoviendo] = useState(false)
  const [configurando, setConfigurando] = useState(false)
  const [motivo, setMotivo] = useState<{ titulo: string; texto: string; accion: (m: string) => Promise<void> } | null>(null)
  const [cobrada, setCobrada] = useState<{ mesa: string; venta: Venta; voucherId?: string } | null>(null)
  const [ahora, setAhora] = useState(() => Date.now())
  const ubicacion = ubicaciones.find((u) => u.id === ubicacionActiva)

  const cargar = useCallback(async () => {
    if (!ubicacionActiva) return
    try {
      setSalon(await cargarSalon(ubicacionActiva))
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }, [ubicacionActiva, toast])

  useEffect(() => {
    setSalon(null)
    setSel(null)
    setModo('salon')
    if (!ubicacionActiva) return
    void cargar()
    listarProductosConStock(ubicacionActiva).then((p) => setProductos(p.filter((x) => x.activo)))
    rankingVentas(ubicacionActiva).then(setRanking).catch(() => setRanking(new Map()))
    listarCategorias().then(setCategorias)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ubicacionActiva])

  useTiempoReal(ubicacionActiva, ['cuentas', 'comandas', 'cuenta_items'], () => void cargar())

  useEffect(() => {
    const t = window.setInterval(() => setAhora(Date.now()), 30000)
    return () => window.clearInterval(t)
  }, [])

  // ---------------- Derivados ----------------
  const cuentaDe = (mesaId: string) => salon?.cuentas.find((c) => c.mesa_id === mesaId) ?? null
  const mesa = salon?.mesas.find((m) => m.id === sel) ?? null
  const cuenta = mesa ? cuentaDe(mesa.id) : null
  const comandas = cuenta ? salon!.comandas.filter((c) => c.cuenta_id === cuenta.id) : []
  const items = cuenta ? salon!.items.filter((i) => i.cuenta_id === cuenta.id) : []
  const vigentes = items.filter((i) => !i.anulado)
  const totalCuenta = vigentes.reduce((a, i) => a + i.cantidad * i.precio_unitario, 0)
  const borrador = (sel && borradores[sel]) || []
  const totalBorrador = borrador.reduce((a, b) => a + b.cantidad * b.precio, 0)
  const unidadesBorrador = borrador.reduce((a, b) => a + b.cantidad, 0)

  const totalDe = (cuentaId: string) =>
    salon!.items.filter((i) => i.cuenta_id === cuentaId && !i.anulado).reduce((a, i) => a + i.cantidad * i.precio_unitario, 0)
  const ocupadas = useMemo(() => new Set((salon?.cuentas ?? []).map((c) => c.mesa_id)), [salon])

  const zonas = useMemo(() => {
    const g = new Map<string, Mesa[]>()
    for (const m of salon?.mesas ?? []) {
      const z = m.zona?.trim() || 'Salón'
      g.set(z, [...(g.get(z) ?? []), m])
    }
    return [...g.entries()]
  }, [salon])

  // Catálogo: más vendidos primero; una entrada por talla si el producto tiene
  const catalogo = useMemo(() => {
    const t = busqueda.trim().toLowerCase()
    return productos
      .filter((p) => !categoria || p.categoria_id === categoria)
      .filter((p) => !t || p.nombre.toLowerCase().includes(t) || p.sku.toLowerCase().includes(t) || p.codigo_barras === t)
      .sort((a, b) => (ranking.get(b.id) ?? 0) - (ranking.get(a.id) ?? 0) || a.nombre.localeCompare(b.nombre))
      .flatMap((p) =>
        p.variantes.length
          ? p.variantes.map((v) => ({ p, variante_id: v.id as string | null, etiqueta: `${p.nombre} · ${etiquetaVariante(v)}`, disponible: v.disponible }))
          : [{ p, variante_id: null as string | null, etiqueta: p.nombre, disponible: p.disponible }]
      )
  }, [productos, categoria, busqueda, ranking])
  const categoriasUsadas = categorias.filter((c) => productos.some((p) => p.categoria_id === c.id))

  // ---------------- Pedido (borrador) ----------------
  function setBorrador(fn: (b: Borrador[]) => Borrador[]) {
    if (!sel) return
    setBorradores((prev) => ({ ...prev, [sel]: fn(prev[sel] ?? []) }))
  }

  function agregar(p: ProductoConStock, variante_id: string | null, etiqueta: string) {
    const clave = `${p.id}:${variante_id ?? ''}`
    setBorrador((b) => {
      const ex = b.find((x) => x.clave === clave && !x.nota)
      if (ex) return b.map((x) => (x === ex ? { ...x, cantidad: x.cantidad + 1 } : x))
      return [...b, { clave, producto_id: p.id, variante_id, descripcion: etiqueta, precio: p.precio_venta, cantidad: 1, nota: '' }]
    })
  }

  async function enviar() {
    if (!mesa || !borrador.length) return
    setEnviando(true)
    const { data, error } = await enviarPedido(
      mesa.id,
      borrador.map((b) => ({ producto_id: b.producto_id, variante_id: b.variante_id, cantidad: b.cantidad, nota: b.nota.trim() || null })),
      !cuenta ? comensales[mesa.id] ?? null : null
    )
    setEnviando(false)
    if (error) return toast(error, 'error')
    // Sin comanda: el pedido era solo de cosas que no pasan por cocina (bebidas, envasados)
    const com = data as Comanda | null
    toast(com?.id ? `Comanda #${com.numero} enviada a cocina` : 'Pedido agregado a la cuenta (no pasa por cocina)')
    setBorradores((prev) => ({ ...prev, [mesa.id]: [] }))
    setModo('salon')
    setNotaDe(null)
    void cargar()
  }

  // ---------------- Acciones de la cuenta ----------------
  async function anularItem(it: CuentaItem) {
    const com = comandas.find((c) => c.id === it.comanda_id)
    const ejecutar = async (m: string | null) => {
      const error = await anularItemCuenta(it.id, m)
      if (error) return toast(error, 'error')
      void cargar()
    }
    if (!it.comanda_id || com?.estado === 'pendiente') {
      const mensaje = it.comanda_id ? 'Cocina aún no lo empieza.' : 'Se quita de la cuenta.'
      if (!(await confirmar({ titulo: `¿Quitar ${it.cantidad}× ${it.descripcion}?`, mensaje, accion: 'Quitar' }))) return
      return ejecutar(null)
    }
    setMotivo({ titulo: `Quitar ${it.cantidad}× ${it.descripcion}`, texto: 'Cocina ya lo está preparando. ¿Por qué se quita?', accion: ejecutar })
  }

  async function entregar(c: Comanda) {
    const error = await cambiarEstadoComanda(c.id, 'entregada')
    if (error) return toast(error, 'error')
    void cargar()
  }

  // Una línea de la cuenta (con botón para quitarla)
  const filaItem = (i: CuentaItem) => (
    <li key={i.id} className={cn('flex items-start gap-2 px-3 py-2 text-sm', i.anulado && 'opacity-50')}>
      <span className="w-6 shrink-0 font-semibold tabular-nums text-fg">{i.cantidad}×</span>
      <span className="min-w-0 flex-1">
        <span className={cn('text-fg', i.anulado && 'line-through')}>{i.descripcion}</span>
        {i.nota && <span className="block text-xs text-warning">{i.nota}</span>}
      </span>
      <span className="shrink-0 tabular-nums text-fg-body">{formatCLP(i.cantidad * i.precio_unitario)}</span>
      {!i.anulado && (
        <button
          onClick={() => void anularItem(i)}
          aria-label={`Quitar ${i.descripcion}`}
          className="grid size-6 shrink-0 place-items-center rounded-md text-fg-faint hover:bg-danger-soft hover:text-danger"
        >
          <X size={13} />
        </button>
      )}
    </li>
  )

  async function moverA(destino: Mesa) {
    if (!cuenta) return
    const error = await moverCuenta(cuenta.id, destino.id)
    if (error) return toast(error, 'error')
    toast(`Cuenta movida a ${destino.nombre}`)
    setMoviendo(false)
    setSel(destino.id)
    void cargar()
  }

  async function anularCuenta() {
    if (!cuenta || !mesa) return
    const ejecutar = async (m: string | null) => {
      const error = await anularCuentaEnBase(cuenta.id, m)
      if (error) return toast(error, 'error')
      toast(`${mesa.nombre} quedó libre`)
      void cargar()
    }
    if (!vigentes.length) {
      if (!(await confirmar({ titulo: `¿Liberar ${mesa.nombre}?`, mensaje: 'La cuenta no tiene pedidos.', accion: 'Liberar mesa' }))) return
      return ejecutar(null)
    }
    setMotivo({ titulo: `Anular la cuenta de ${mesa.nombre}`, texto: `Hay ${formatCLP(totalCuenta)} sin cobrar. Indica el motivo.`, accion: ejecutar })
  }

  function precuenta() {
    if (!mesa || !cuenta) return
    const agrupados = new Map<string, { d: string; c: number; t: number }>()
    for (const i of vigentes) {
      const k = `${i.descripcion}|${i.precio_unitario}`
      const a = agrupados.get(k) ?? { d: i.descripcion, c: 0, t: 0 }
      agrupados.set(k, { d: a.d, c: a.c + i.cantidad, t: a.t + i.cantidad * i.precio_unitario })
    }
    const sugerida = Math.round((totalCuenta * 0.1) / 10) * 10
    const cuerpo = `<h1>${esc(empresa?.nombre ?? '')}</h1><p>${esc(ubicacion?.nombre ?? '')}</p><p><b>PRECUENTA · ${esc(mesa.nombre)}</b></p>
<p class="s">${esc(new Date().toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }))}</p><table>
${[...agrupados.values()].map((a) => `<tr><td>${a.c} × ${esc(a.d)}</td><td>${esc(formatCLP(a.t))}</td></tr>`).join('')}
<tr class="sep fuerte"><td>Total consumo</td><td>${esc(formatCLP(totalCuenta))}</td></tr>
<tr><td class="s">Propina sugerida 10%</td><td class="s">${esc(formatCLP(sugerida))}</td></tr>
<tr><td><b>Total con propina</b></td><td><b>${esc(formatCLP(totalCuenta + sugerida))}</b></td></tr></table>
<p class="s">La propina es voluntaria.<br>Documento no válido como boleta.</p>`
    imprimirDocumento(documentoTicket(`Precuenta ${mesa.nombre}`, cuerpo, leerConfigImpresion().ancho))
  }

  async function alCobrar(v: Venta) {
    const nombre = mesa?.nombre ?? ''
    // Comprobante automático al cobrar (como en el POS); reimprimir desde el voucher
    const config = leerConfigImpresion()
    if (config.alCobrar) {
      const bruto = vigentes.reduce((a, i) => a + i.cantidad * i.precio_unitario, 0)
      const desglose = desglosarIVA(v.total)
      imprimirDocumento(
        ticketVentaHtml(
          {
            empresa: empresa?.nombre ?? '',
            ubicacion: ubicacion?.nombre ?? '',
            folio: v.folio,
            fecha: new Date(v.created_at),
            cajero: profile?.nombre || '',
            lineas: vigentes.map((i) => ({ descripcion: i.descripcion, cantidad: i.cantidad, precio_unitario: i.precio_unitario })),
            bruto,
            descuento: Math.max(0, bruto - v.total),
            total: v.total,
            neto: desglose.neto,
            iva: desglose.iva,
            medio: v.medio_pago,
            referencia: v.referencia_pago ?? null,
            recibido: 0,
            mesa: nombre,
            propina: v.propina ?? 0
          },
          config.ancho
        )
      )
    }
    setCobrando(false)
    setSel(null)
    const voucherId = await voucherDeVenta(v.id)
    setCobrada({ mesa: nombre, venta: v, voucherId: voucherId ?? undefined })
    void cargar()
  }

  function elegirMesa(m: Mesa) {
    setSel(m.id)
    setNotaDe(null)
    setCobrada(null)
    // Mesa libre: directo a tomar el pedido
    setModo(cuentaDe(m.id) ? 'salon' : 'pedido')
  }

  // ---------------- Vistas ----------------
  if (!ubicacion || ubicacion.tipo !== 'tienda') {
    return (
      <>
        <PageHeader title="Mesas" />
        <EmptyState icon={<UtensilsCrossed size={22} />} title="Elige un local" description="Selecciona arriba la tienda o local donde atiendes." />
      </>
    )
  }
  if (!salon) return <LoadingState />

  const minutos = (iso: string) => Math.max(0, Math.floor((ahora - new Date(iso).getTime()) / 60000))

  return (
    <>
      <PageHeader
        title="Mesas"
        subtitle={`${ubicacion.nombre} · ${ocupadas.size} de ${salon.mesas.length} ocupadas`}
        actions={
          can('config.gestionar') && (
            <Button variant="secondary" size="sm" onClick={() => setConfigurando(true)}>
              <Settings2 size={15} /> Configurar mesas
            </Button>
          )
        }
      />

      {!online && (
        <p className="mb-4 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">
          Sin conexión: las mesas necesitan internet para enviar comandas y cobrar. Para vender sin conexión usa el Punto de Venta.
        </p>
      )}
      {cobrada && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-success-soft px-3 py-2 text-sm text-success">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 size={15} aria-hidden />
            {cobrada.mesa} cobrada: <strong className="font-semibold">{cobrada.venta.folio}</strong> · {formatCLP(cobrada.venta.total)}
            {(cobrada.venta.propina ?? 0) > 0 && ` + propina ${formatCLP(cobrada.venta.propina ?? 0)}`}
          </span>
          {cobrada.voucherId && (
            <Link to={`/voucher/${cobrada.voucherId}`} className="font-medium underline underline-offset-2">Ver comprobante</Link>
          )}
        </div>
      )}

      {salon.mesas.length === 0 ? (
        <EmptyState
          icon={<UtensilsCrossed size={22} />}
          title="Este local aún no tiene mesas"
          description={can('config.gestionar') ? 'Agrégalas en un minuto: cantidad y zona.' : 'Pide a un administrador que configure las mesas.'}
          action={can('config.gestionar') && <Button onClick={() => setConfigurando(true)}><Plus size={16} /> Agregar mesas</Button>}
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
          {/* Izquierda: salón o catálogo */}
          <div className={cn('min-w-0', sel && modo === 'salon' && 'hidden lg:block')}>
            {modo === 'salon' ? (
              <div className="space-y-5">
                {zonas.map(([z, ms]) => (
                  <section key={z}>
                    {zonas.length > 1 && <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">{z}</h2>}
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                      {ms.map((m) => {
                        const c = cuentaDe(m.id)
                        const coms = c ? salon.comandas.filter((x) => x.cuenta_id === c.id) : []
                        const lista = coms.some((x) => x.estado === 'lista')
                        const enCocina = coms.some((x) => x.estado === 'pendiente' || x.estado === 'preparando')
                        return (
                          <button
                            key={m.id}
                            onClick={() => elegirMesa(m)}
                            aria-pressed={sel === m.id}
                            className={cn(
                              'flex min-h-[104px] flex-col justify-between rounded-2xl border p-3 text-left transition-colors',
                              c ? 'border-accent/30 bg-accent-soft/40 hover:bg-accent-soft/60' : 'border-border bg-panel hover:bg-surface',
                              sel === m.id && 'ring-2 ring-accent'
                            )}
                          >
                            <span className="flex items-start justify-between gap-2">
                              <span className="text-base font-semibold text-fg">{m.nombre}</span>
                              <span className="flex items-center gap-1 text-xs text-fg-muted">
                                <Users size={12} aria-hidden />
                                {c?.comensales ?? m.capacidad}
                              </span>
                            </span>
                            {c ? (
                              <span className="space-y-1">
                                <span className="block text-sm font-semibold tabular-nums text-fg">{formatCLP(totalDe(c.id))}</span>
                                <span className="flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
                                  {minutos(c.abierta_at)} min
                                  {lista && <Badge tone="success">Lista</Badge>}
                                  {!lista && enCocina && <Badge tone="warning">En cocina</Badge>}
                                </span>
                              </span>
                            ) : (
                              <span className="text-xs text-fg-faint">Libre</span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setModo('salon')} aria-label="Volver al salón">
                    <ArrowLeft size={16} /> <span className="hidden sm:inline">Salón</span>
                  </Button>
                  <div className="relative flex-1">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint" aria-hidden />
                    <Input
                      className="pl-9"
                      placeholder={`Pedido para ${mesa?.nombre ?? ''}: buscar…`}
                      aria-label="Buscar producto para el pedido"
                      autoComplete="off"
                      value={busqueda}
                      onChange={(e) => setBusqueda(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && catalogo[0]) {
                          agregar(catalogo[0].p, catalogo[0].variante_id, catalogo[0].etiqueta)
                          setBusqueda('')
                        }
                      }}
                    />
                  </div>
                </div>
                {categoriasUsadas.length > 1 && (
                  <div className="flex gap-1.5 overflow-x-auto pb-1">
                    {[{ id: '', nombre: 'Todo' }, ...categoriasUsadas].map((c) => (
                      <button
                        key={c.id}
                        onClick={() => setCategoria(c.id)}
                        aria-pressed={categoria === c.id}
                        className={cn(
                          'shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                          categoria === c.id ? 'border-accent bg-accent text-on-accent' : 'border-border text-fg-body hover:bg-surface'
                        )}
                      >
                        {c.nombre}
                      </button>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                  {catalogo.map(({ p, variante_id, etiqueta, disponible }) => {
                    const agotado = p.controla_stock !== false && disponible <= 0
                    const enPedido = borrador.filter((b) => b.producto_id === p.id && b.variante_id === variante_id).reduce((a, b) => a + b.cantidad, 0)
                    return (
                      <button
                        key={`${p.id}:${variante_id ?? ''}`}
                        onClick={() => agregar(p, variante_id, etiqueta)}
                        className={cn(
                          'relative flex min-h-[84px] flex-col justify-between rounded-xl border p-3 text-left transition-colors',
                          enPedido ? 'border-accent bg-accent-soft/40' : 'border-border bg-panel hover:bg-surface'
                        )}
                      >
                        <span className="line-clamp-2 text-sm font-medium text-fg">{etiqueta}</span>
                        <span className="mt-1 flex items-center justify-between gap-1 text-xs">
                          <span className="font-semibold tabular-nums text-fg-body">{formatCLP(p.precio_venta)}</span>
                          {agotado ? (
                            <span className="text-danger">Agotado</span>
                          ) : p.controla_stock !== false && disponible <= 5 ? (
                            <span className="text-warning">Quedan {disponible}</span>
                          ) : null}
                        </span>
                        {enPedido > 0 && (
                          <span className="absolute -right-1.5 -top-1.5 grid size-6 place-items-center rounded-full bg-accent text-xs font-semibold tabular-nums text-on-accent">
                            {enPedido}
                          </span>
                        )}
                      </button>
                    )
                  })}
                  {catalogo.length === 0 && <p className="col-span-full py-8 text-center text-sm text-fg-muted">Sin productos que coincidan.</p>}
                </div>
                {/* Móvil: acceso al pedido */}
                {borrador.length > 0 && (
                  <div className="sticky bottom-20 z-10 lg:hidden">
                    <Button block size="lg" onClick={() => setModo('salon')}>
                      Revisar pedido ({unidadesBorrador}) · {formatCLP(totalBorrador)}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Derecha: cuenta de la mesa */}
          <aside className={cn('min-w-0', !sel || modo === 'pedido' ? 'hidden lg:block' : 'block')}>
            <div className="rounded-2xl border border-border bg-panel p-4 shadow-card lg:sticky lg:top-20">
              {!mesa ? (
                <p className="py-16 text-center text-sm text-fg-muted">Elige una mesa para ver su cuenta o tomar el pedido.</p>
              ) : (
                <div className="space-y-4">
                  <header className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <button onClick={() => setSel(null)} aria-label="Volver al salón" className="grid size-8 place-items-center rounded-lg hover:bg-surface lg:hidden">
                        <ArrowLeft size={16} />
                      </button>
                      <div>
                        <h2 className="text-base font-semibold text-fg">{mesa.nombre}</h2>
                        <p className="text-xs text-fg-muted">
                          {cuenta
                            ? `Abierta ${formatHora(cuenta.abierta_at)} · ${minutos(cuenta.abierta_at)} min${cuenta.comensales ? ` · ${cuenta.comensales} personas` : ''}`
                            : 'Libre'}
                        </p>
                      </div>
                    </div>
                    <button onClick={() => setSel(null)} aria-label="Cerrar cuenta de la mesa" className="hidden size-8 place-items-center rounded-lg text-fg-muted hover:bg-surface lg:grid">
                      <X size={16} />
                    </button>
                  </header>

                  {!cuenta && (
                    <label className="flex items-center justify-between gap-3 rounded-xl bg-surface/60 px-3 py-2 text-sm text-fg-body">
                      <span className="flex items-center gap-2"><Users size={15} aria-hidden /> Personas</span>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={99}
                        className="w-20 py-1.5 text-center"
                        placeholder={String(mesa.capacidad)}
                        value={comensales[mesa.id] || ''}
                        onChange={(e) => setComensales((prev) => ({ ...prev, [mesa.id]: Math.min(99, Number(e.target.value) || 0) }))}
                      />
                    </label>
                  )}

                  {/* Pedidos enviados, por comanda */}
                  {comandas.filter((c) => c.estado !== 'anulada').map((c) => {
                    const its = items.filter((i) => i.comanda_id === c.id)
                    const e = ESTADO_COMANDA[c.estado]
                    return (
                      <section key={c.id} className="rounded-xl border border-border">
                        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                          <span className="text-xs text-fg-muted">#{c.numero} · {formatHora(c.created_at)}</span>
                          <span className="flex items-center gap-1.5">
                            <Badge tone={e.tone}>{e.label}</Badge>
                            {c.estado === 'lista' && (
                              <Button size="sm" variant="soft" onClick={() => void entregar(c)}>Entregada</Button>
                            )}
                          </span>
                        </div>
                        <ul className="divide-y divide-border">
                          {its.map(filaItem)}
                        </ul>
                      </section>
                    )
                  })}

                  {/* Lo que no pasa por cocina (bebidas, envasados): directo a la cuenta */}
                  {items.some((i) => !i.comanda_id) && (
                    <section className="rounded-xl border border-border">
                      <p className="border-b border-border px-3 py-2 text-xs text-fg-muted">Directo a la cuenta · sin cocina</p>
                      <ul className="divide-y divide-border">{items.filter((i) => !i.comanda_id).map(filaItem)}</ul>
                    </section>
                  )}

                  {/* Pedido nuevo (aún no enviado) */}
                  {borrador.length > 0 && (
                    <section className="rounded-xl border border-dashed border-accent/50 bg-accent-soft/20">
                      <p className="border-b border-accent/20 px-3 py-2 text-xs font-semibold text-accent">Pedido nuevo · sin enviar</p>
                      <ul className="divide-y divide-border">
                        {borrador.map((b) => (
                          <li key={b.clave + b.nota} className="space-y-1.5 px-3 py-2">
                            <div className="flex items-center gap-2 text-sm">
                              <span className="min-w-0 flex-1 truncate text-fg">{b.descripcion}</span>
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => setBorrador((l) => l.flatMap((x) => (x === b ? (x.cantidad > 1 ? [{ ...x, cantidad: x.cantidad - 1 }] : []) : [x])))}
                                  aria-label={`Disminuir ${b.descripcion}`}
                                  className="grid size-7 place-items-center rounded-lg bg-surface-2 hover:bg-border"
                                >
                                  {b.cantidad > 1 ? <Minus size={13} /> : <Trash2 size={13} />}
                                </button>
                                <span className="w-6 text-center text-sm tabular-nums">{b.cantidad}</span>
                                <button
                                  onClick={() => setBorrador((l) => l.map((x) => (x === b ? { ...x, cantidad: x.cantidad + 1 } : x)))}
                                  aria-label={`Aumentar ${b.descripcion}`}
                                  className="grid size-7 place-items-center rounded-lg bg-surface-2 hover:bg-border"
                                >
                                  <Plus size={13} />
                                </button>
                                <button
                                  onClick={() => setNotaDe(notaDe === b.clave + b.nota ? null : b.clave + b.nota)}
                                  aria-label={`Nota para cocina: ${b.descripcion}`}
                                  aria-pressed={!!b.nota}
                                  className={cn('grid size-7 place-items-center rounded-lg hover:bg-surface-2', b.nota ? 'text-warning' : 'text-fg-muted')}
                                >
                                  <StickyNote size={13} />
                                </button>
                              </div>
                            </div>
                            {notaDe === b.clave + b.nota ? (
                              <Input
                                autoFocus
                                maxLength={140}
                                placeholder="Ej.: sin cebolla, término medio"
                                aria-label="Nota para cocina"
                                defaultValue={b.nota}
                                className="py-1.5 text-xs"
                                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                                onBlur={(e) => {
                                  const nota = e.target.value
                                  setBorrador((l) => l.map((x) => (x === b ? { ...x, nota } : x)))
                                  setNotaDe(null)
                                }}
                              />
                            ) : (
                              b.nota && <p className="text-xs text-warning">{b.nota}</p>
                            )}
                          </li>
                        ))}
                      </ul>
                      <div className="p-3">
                        <Button block onClick={() => void enviar()} disabled={enviando || !online || !can('mesas.atender')}>
                          <ChefHat size={16} />
                          {enviando ? 'Enviando…' : `Enviar pedido (${unidadesBorrador}) · ${formatCLP(totalBorrador)}`}
                        </Button>
                      </div>
                    </section>
                  )}

                  {!cuenta && !borrador.length && (
                    <p className="py-4 text-center text-sm text-fg-muted">Agrega productos del catálogo para abrir la mesa.</p>
                  )}

                  <Button variant="secondary" block onClick={() => setModo('pedido')} className={cn(modo === 'pedido' && 'lg:hidden')}>
                    <Plus size={16} /> {cuenta || borrador.length ? 'Agregar al pedido' : 'Tomar pedido'}
                  </Button>

                  {cuenta && (
                    <div className="space-y-3 border-t border-border pt-3">
                      <div className="flex items-baseline justify-between">
                        <span className="text-sm text-fg-muted">Total consumo</span>
                        <span className="text-xl font-semibold text-fg">{formatCLP(totalCuenta)}</span>
                      </div>
                      <Button block size="lg" onClick={() => setCobrando(true)} disabled={!vigentes.length || !online || !can('pos.vender')}>
                        Cobrar {formatCLP(totalCuenta)}
                      </Button>
                      <div className="grid grid-cols-3 gap-2">
                        <Button variant="ghost" size="sm" onClick={precuenta} disabled={!vigentes.length}>
                          <Printer size={14} /> Precuenta
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setMoviendo(true)}>
                          <ArrowRightLeft size={14} /> Mover
                        </Button>
                        {(!vigentes.length || can('ventas.devolver')) && (
                          <Button variant="ghost" size="sm" className="text-danger" onClick={() => void anularCuenta()}>
                            <Ban size={14} /> {vigentes.length ? 'Anular' : 'Liberar'}
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </aside>
        </div>
      )}

      <ModalCobroCuenta
        abierto={cobrando}
        cuentaId={cuenta?.id ?? null}
        mesa={mesa?.nombre ?? ''}
        total={totalCuenta}
        onCerrar={() => setCobrando(false)}
        onCobrado={(v) => void alCobrar(v)}
      />

      <Modal open={moviendo} onClose={() => setMoviendo(false)} title={`Mover la cuenta de ${mesa?.nombre ?? ''}`} size="sm">
        <div className="grid grid-cols-3 gap-2">
          {salon.mesas.filter((m) => !ocupadas.has(m.id)).map((m) => (
            <Button key={m.id} variant="secondary" onClick={() => void moverA(m)}>{m.nombre}</Button>
          ))}
        </div>
        {salon.mesas.every((m) => ocupadas.has(m.id)) && <p className="text-sm text-fg-muted">No hay mesas libres.</p>}
      </Modal>

      <ModalMotivo motivo={motivo} onCerrar={() => setMotivo(null)} />

      {ubicacionActiva && (
        <GestorMesas
          abierto={configurando}
          ubicacionId={ubicacionActiva}
          mesas={salon.mesas}
          ocupadas={ocupadas}
          onCerrar={() => setConfigurando(false)}
          onCambio={() => void cargar()}
        />
      )}
    </>
  )
}

function ModalMotivo({
  motivo,
  onCerrar
}: {
  motivo: { titulo: string; texto: string; accion: (m: string) => Promise<void> } | null
  onCerrar: () => void
}) {
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  useEffect(() => setTexto(''), [motivo])
  return (
    <Modal
      open={!!motivo}
      onClose={onCerrar}
      title={motivo?.titulo}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onCerrar}>Cancelar</Button>
          <Button
            variant="danger"
            disabled={!texto.trim() || enviando}
            onClick={async () => {
              setEnviando(true)
              await motivo?.accion(texto.trim())
              setEnviando(false)
              onCerrar()
            }}
          >
            Confirmar
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-fg-muted">{motivo?.texto}</p>
      <Input autoFocus aria-label="Motivo" placeholder="Motivo" value={texto} maxLength={200} onChange={(e) => setTexto(e.target.value)} />
    </Modal>
  )
}
