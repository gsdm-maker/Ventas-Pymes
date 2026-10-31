import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, FileText, Package, PackagePlus, Plus, ScanBarcode, Search, Trash2 } from 'lucide-react'
import { useAuth } from '@/core/auth/AuthProvider'
import { listarCategorias, listarProductosConStock, listarProveedores } from '@/core/data/api'
import { invalidarAlertas } from '@/core/data/useAlertasStock'
import type { Categoria, ProductoConStock, Proveedor } from '@/core/types'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Input'
import { PageHeader } from '@/components/ui/Feedback'
import { useToast } from '@/components/ui/Toast'
import { CrearProductoRapido } from '@/components/productos/CrearProductoRapido'
import { EscanerCamara, type ResultadoEscaneo } from '@/components/ui/EscanerCamara'
import { cn } from '@/lib/cn'
import { formatCLP } from '@/lib/format'
import { margenDesdePrecio } from '@/lib/precio'
import { etiquetaVariante } from '@/lib/variantes'
import { registrarEntrada } from '@/core/data/inventario'

/** Una línea por producto; las tallas van en la misma fila ('' = sin talla). */
interface Linea {
  producto_id: string
  cantidades: Record<string, number>
  costo_unitario: number
}

const TIPOS_DOC = [
  { v: 'factura', label: 'Factura' },
  { v: 'guia', label: 'Guía de despacho' },
  { v: 'boleta', label: 'Boleta' },
  { v: 'otro', label: 'Otro' }
]

export function Ingreso() {
  const { ubicaciones, ubicacionActiva, can } = useAuth()
  const toast = useToast()
  const [productos, setProductos] = useState<ProductoConStock[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [proveedores, setProveedores] = useState<Proveedor[]>([])
  const [proveedor, setProveedor] = useState('')
  const [destino, setDestino] = useState(ubicacionActiva ?? '')
  const [obs, setObs] = useState('')
  const [lineas, setLineas] = useState<Linea[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [abiertoBuscador, setAbiertoBuscador] = useState(false)
  const [creando, setCreando] = useState<string | null>(null)
  const [codigoNuevo, setCodigoNuevo] = useState('')
  const [escaneando, setEscaneando] = useState(false)
  // Documento del proveedor (opcional)
  const [conDocumento, setConDocumento] = useState(false)
  const [docTipo, setDocTipo] = useState('factura')
  const [docNumero, setDocNumero] = useState('')
  const [docFecha, setDocFecha] = useState('')
  const [actualizarCosto, setActualizarCosto] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [ok, setOk] = useState<{ unidades: number; productos: number; total: number } | null>(null)
  const buscador = useRef<HTMLInputElement>(null)
  const puedeCrear = can('productos.gestionar')

  useEffect(() => {
    listarProveedores().then(setProveedores)
    listarCategorias().then(setCategorias)
    listarProductosConStock(null).then(setProductos)
  }, [])

  useEffect(() => {
    if (ubicacionActiva && !destino) setDestino(ubicacionActiva)
  }, [ubicacionActiva, destino])

  const prod = (id: string) => productos.find((p) => p.id === id)

  // Buscador: nombre, SKU o código de barras exacto (lector)
  const termino = busqueda.trim().toLowerCase()
  const resultados = useMemo(() => {
    if (!termino) return []
    return productos
      // Solo se recibe lo que controla stock; la lista completa sirve para SKU y códigos únicos
      .filter((p) => p.activo && p.controla_stock !== false)
      .filter((p) => p.nombre.toLowerCase().includes(termino) || p.sku.toLowerCase().includes(termino) || p.codigo_barras === termino)
      .slice(0, 8)
  }, [productos, termino])

  function enfocar(selector: string) {
    setTimeout(() => {
      const el = document.querySelector<HTMLInputElement>(selector)
      el?.focus()
      el?.select()
    }, 50)
  }

  function agregar(p: ProductoConStock, enfocarCantidad = true) {
    setBusqueda('')
    setAbiertoBuscador(false)
    // Sobre la lista más reciente: al escanear seguido no se pierde ninguna unidad
    setLineas((prev) => {
      const existe = prev.find((l) => l.producto_id === p.id)
      if (!existe)
        return [{ producto_id: p.id, cantidades: p.variantes.length ? {} : { '': 1 }, costo_unitario: p.costo_referencia || 0 }, ...prev]
      if (p.variantes.length) return prev
      return prev.map((l) => (l === existe ? { ...l, cantidades: { '': (l.cantidades[''] ?? 0) + 1 } } : l))
    })
    // Foco en la cantidad para escribirla de inmediato (con la cámara no: abriría el teclado)
    if (enfocarCantidad) enfocar(`[data-cantidad="${p.id}"]`)
  }

  /** Código leído con la cámara del teléfono: mismo criterio que el lector USB (código o SKU exacto). */
  function alEscanear(codigo: string): ResultadoEscaneo {
    const c = codigo.toLowerCase()
    const p = productos.find((x) => x.codigo_barras?.toLowerCase() === c || x.sku.toLowerCase() === c)
    if (p && (!p.activo || p.controla_stock === false))
      return { ok: false, mensaje: `${p.nombre} no controla stock o está inactivo` }
    if (p) {
      agregar(p, false)
      if (p.variantes.length) return { ok: true, mensaje: `${p.nombre}: escribe la cantidad por talla` }
      const antes = lineas.find((l) => l.producto_id === p.id)?.cantidades[''] ?? 0
      return { ok: true, mensaje: `+1 ${p.nombre} · ${antes + 1} en total` }
    }
    if (puedeCrear) {
      setCodigoNuevo(codigo)
      setCreando('')
      return { ok: false, mensaje: 'Código nuevo: completa los datos del producto', cerrar: true }
    }
    return { ok: false, mensaje: `El código ${codigo} no está registrado` }
  }

  function onEnter() {
    if (resultados[0]) agregar(resultados[0])
    else if (termino && puedeCrear) setCreando(busqueda.trim())
  }

  const setCantidad = (pid: string, varKey: string, n: number) =>
    setLineas((prev) => prev.map((l) => (l.producto_id === pid ? { ...l, cantidades: { ...l.cantidades, [varKey]: Math.max(0, n) } } : l)))
  const setCosto = (pid: string, c: number) =>
    setLineas((prev) => prev.map((l) => (l.producto_id === pid ? { ...l, costo_unitario: Math.max(0, c) } : l)))

  const unidadesLinea = (l: Linea) => Object.values(l.cantidades).reduce((a, n) => a + (n || 0), 0)
  const totalUnidades = lineas.reduce((a, l) => a + unidadesLinea(l), 0)
  const neto = lineas.reduce((a, l) => a + unidadesLinea(l) * (l.costo_unitario || 0), 0)
  const iva = Math.round(neto * 0.19)

  async function confirmar() {
    if (!destino) return toast('Selecciona la ubicación de destino', 'warning')
    const items = lineas.flatMap((l) =>
      Object.entries(l.cantidades)
        .filter(([, n]) => n > 0)
        .map(([varKey, n]) => ({
          producto_id: l.producto_id,
          variante_id: varKey || null,
          cantidad: n,
          costo_unitario: l.costo_unitario || null
        }))
    )
    if (!items.length) return toast('Ingresa al menos una cantidad', 'warning')
    setEnviando(true)
    const error = await registrarEntrada({
      ubicacion_id: destino,
      items,
      proveedor_id: proveedor || null,
      observaciones: obs || null,
      documento: conDocumento ? { tipo: docTipo, numero: docNumero || null, fecha: docFecha || null } : null,
      actualizar_costo: conDocumento && actualizarCosto
    })
    setEnviando(false)
    if (error) return toast(error, 'error')
    invalidarAlertas()
    setOk({ unidades: totalUnidades, productos: lineas.filter((l) => unidadesLinea(l) > 0).length, total: neto + iva })
  }

  function reiniciar() {
    setOk(null)
    setLineas([])
    setObs('')
    setDocNumero('')
    setDocFecha('')
    listarProductosConStock(null).then(setProductos)
    enfocar('input[aria-label="Buscar producto para ingresar"]')
  }

  if (ok) {
    return (
      <div className="mx-auto max-w-md">
        <Card>
          <CardBody className="text-center">
            <div className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-success-soft text-success">
              <Check size={28} />
            </div>
            <h2 className="text-lg font-semibold text-fg">Recepción registrada</h2>
            <p className="mt-1 text-sm text-fg-muted">
              {ok.unidades} unidades de {ok.productos} producto(s) sumadas al stock
              {ok.total > 0 ? ` · ${formatCLP(ok.total)} con IVA` : ''}.
            </p>
            <Button className="mt-5" block onClick={reiniciar}>
              Registrar otra recepción
            </Button>
          </CardBody>
        </Card>
      </div>
    )
  }

  return (
    <>
      <PageHeader title="Ingreso de mercadería" subtitle="Busca, escribe las cantidades y confirma: el stock del destino se actualiza al instante" />

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Productos recibidos" subtitle="Enter agrega el primer resultado · sirve con lector de código de barras o la cámara del teléfono" />
          <CardBody className="space-y-4">
            {/* Buscador con resultados y «crear producto» */}
            <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint" aria-hidden />
              <Input
                ref={buscador}
                className="pl-9 text-base"
                placeholder="Nombre, SKU o código…"
                aria-label="Buscar producto para ingresar"
                autoComplete="off"
                value={busqueda}
                onChange={(e) => {
                  setBusqueda(e.target.value)
                  setAbiertoBuscador(true)
                }}
                onFocus={() => setAbiertoBuscador(true)}
                onBlur={() => setTimeout(() => setAbiertoBuscador(false), 150)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    onEnter()
                  } else if (e.key === 'Escape') setBusqueda('')
                }}
              />
              {abiertoBuscador && termino && (
                <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-border bg-panel shadow-popover">
                  {resultados.map((p, i) => (
                    <button
                      key={p.id}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => agregar(p)}
                      className={cn('flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-surface', i === 0 && 'bg-accent-soft/40')}
                    >
                      <span className="min-w-0 flex-1 truncate text-fg">{p.nombre}</span>
                      {p.variantes.length > 0 && <span className="text-xs text-fg-muted">{p.variantes.length} tallas</span>}
                      <span className="text-xs text-fg-muted">{p.sku}</span>
                    </button>
                  ))}
                  {puedeCrear && (
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setCreando(busqueda.trim())}
                      className="flex w-full items-center gap-2 border-t border-border px-3 py-2.5 text-left text-sm font-medium text-accent hover:bg-surface"
                    >
                      <Plus size={15} aria-hidden /> Crear producto «{busqueda.trim()}»
                    </button>
                  )}
                  {!resultados.length && !puedeCrear && <p className="px-3 py-2.5 text-sm text-fg-muted">Sin resultados.</p>}
                </div>
              )}
            </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setEscaneando(true)}
                aria-label="Escanear con la cámara"
                title="Escanear con la cámara"
                className="h-auto shrink-0 self-stretch px-3"
              >
                <ScanBarcode size={18} aria-hidden />
                <span className="hidden sm:inline">Cámara</span>
              </Button>
            </div>

            {lineas.length === 0 ? (
              <p className="py-8 text-center text-sm text-fg-muted">Busca o escanea los productos de la factura o guía.</p>
            ) : (
              <div className="divide-y divide-border">
                {lineas.map((l) => {
                  const p = prod(l.producto_id)
                  if (!p) return null
                  const unidades = unidadesLinea(l)
                  const costoCambio = l.costo_unitario > 0 && p.costo_referencia > 0 && l.costo_unitario !== p.costo_referencia
                  const margenNuevo = margenDesdePrecio(l.costo_unitario, p.precio_venta)
                  return (
                    <div key={l.producto_id} className="space-y-2 py-3">
                      <div className="flex items-center gap-3">
                        {p.foto_url ? (
                          <img src={p.foto_url} alt="" width={40} height={40} loading="lazy" className="size-10 shrink-0 rounded-lg object-cover" />
                        ) : (
                          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-2 text-fg-faint"><Package size={16} aria-hidden /></span>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-fg">{p.nombre}</p>
                          <p className="text-xs text-fg-muted">{p.sku} · {unidades} u.{l.costo_unitario > 0 ? ` · ${formatCLP(unidades * l.costo_unitario)}` : ''}</p>
                        </div>
                        <button
                          onClick={() => setLineas((prev) => prev.filter((x) => x !== l))}
                          aria-label={`Quitar ${p.nombre} de la recepción`}
                          className="grid size-8 place-items-center rounded-lg text-fg-muted hover:bg-danger-soft hover:text-danger"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                      <div className="flex flex-wrap items-end gap-2 pl-[52px]">
                        {p.variantes.length ? (
                          p.variantes.map((v, i) => (
                            <label key={v.id} className="w-16">
                              <span className="mb-0.5 block text-center text-[11px] font-medium text-fg-muted">{etiquetaVariante(v) || v.sku}</span>
                              <Input
                                type="number"
                                inputMode="numeric"
                                min={0}
                                data-cantidad={i === 0 ? p.id : undefined}
                                aria-label={`Cantidad ${p.nombre} ${etiquetaVariante(v)}`}
                                value={l.cantidades[v.id] || ''}
                                placeholder="0"
                                onChange={(e) => setCantidad(p.id, v.id, Number(e.target.value) || 0)}
                                className="py-1.5 text-center"
                              />
                            </label>
                          ))
                        ) : (
                          <label className="w-24">
                            <span className="mb-0.5 block text-[11px] font-medium text-fg-muted">Cantidad</span>
                            <Input
                              type="number"
                              inputMode="numeric"
                              min={0}
                              data-cantidad={p.id}
                              aria-label={`Cantidad ${p.nombre}`}
                              value={l.cantidades[''] || ''}
                              placeholder="0"
                              onChange={(e) => setCantidad(p.id, '', Number(e.target.value) || 0)}
                              className="py-1.5 text-center"
                            />
                          </label>
                        )}
                        <label className="w-32">
                          <span className="mb-0.5 block text-[11px] font-medium text-fg-muted">Costo neto c/u</span>
                          <Input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            aria-label={`Costo ${p.nombre}`}
                            value={l.costo_unitario || ''}
                            placeholder="0"
                            onChange={(e) => setCosto(p.id, Number(e.target.value) || 0)}
                            className="py-1.5"
                          />
                        </label>
                        {costoCambio && (
                          <p className={cn('pb-2 text-xs', margenNuevo !== null && margenNuevo <= 0 ? 'text-danger' : 'text-fg-muted')}>
                            Antes {formatCLP(p.costo_referencia)}
                            {margenNuevo !== null && ` · margen ${Math.round(margenNuevo)}%`}
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {lineas.length > 0 && (
              <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 border-t border-border pt-3 text-sm">
                <span className="text-fg-muted">
                  <strong className="font-semibold tabular-nums text-fg">{totalUnidades}</strong> unidades
                </span>
                {neto > 0 && (
                  <>
                    <span className="text-fg-muted">Neto <strong className="font-semibold tabular-nums text-fg">{formatCLP(neto)}</strong></span>
                    <span className="text-fg-muted">IVA <strong className="font-semibold tabular-nums text-fg">{formatCLP(iva)}</strong></span>
                    <span className="text-fg-muted">Total <strong className="font-semibold tabular-nums text-fg">{formatCLP(neto + iva)}</strong></span>
                  </>
                )}
              </div>
            )}
          </CardBody>
        </Card>

        <Card className="self-start">
          <CardHeader title="Datos de la recepción" />
          <CardBody className="space-y-4">
            <Field label="Destino" required>
              <Select value={destino} onChange={(e) => setDestino(e.target.value)}>
                {ubicaciones.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nombre}
                    {u.tipo === 'bodega' ? ' · bodega' : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Proveedor">
              <Select value={proveedor} onChange={(e) => setProveedor(e.target.value)}>
                <option value="">Sin proveedor</option>
                {proveedores.map((p) => (
                  <option key={p.id} value={p.id}>{p.nombre}</option>
                ))}
              </Select>
            </Field>

            {/* Documento del proveedor: opcional */}
            <button
              type="button"
              onClick={() => setConDocumento((v) => !v)}
              aria-expanded={conDocumento}
              className="flex w-full items-center justify-between rounded-xl border border-border px-3 py-2.5 text-sm font-medium text-fg-body hover:bg-surface"
            >
              <span className="flex items-center gap-2"><FileText size={15} aria-hidden /> Documento del proveedor (opcional)</span>
              <ChevronDown size={16} className={cn('text-fg-muted transition-transform', conDocumento && 'rotate-180')} aria-hidden />
            </button>
            {conDocumento && (
              <div className="space-y-3 rounded-xl bg-surface/60 p-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Tipo">
                    <Select value={docTipo} onChange={(e) => setDocTipo(e.target.value)}>
                      {TIPOS_DOC.map((t) => (
                        <option key={t.v} value={t.v}>{t.label}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="N°">
                    <Input value={docNumero} onChange={(e) => setDocNumero(e.target.value)} inputMode="numeric" autoComplete="off" />
                  </Field>
                </div>
                <Field label="Fecha del documento">
                  <Input type="date" value={docFecha} onChange={(e) => setDocFecha(e.target.value)} />
                </Field>
                {can('productos.gestionar') && (
                  <label className="flex items-start gap-2 text-sm text-fg-body">
                    <input
                      type="checkbox"
                      checked={actualizarCosto}
                      onChange={(e) => setActualizarCosto(e.target.checked)}
                      className="mt-0.5 size-4 accent-[rgb(var(--accent))]"
                    />
                    <span>
                      Actualizar el costo de los productos con lo pagado
                      <span className="block text-xs text-fg-muted">El precio de venta no cambia; revisa el margen indicado en cada línea.</span>
                    </span>
                  </label>
                )}
              </div>
            )}

            <Field label="Observaciones">
              <Textarea value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Opcional" />
            </Field>
            <Button block size="lg" disabled={enviando || totalUnidades === 0} onClick={() => void confirmar()}>
              <PackagePlus size={18} />
              {enviando ? 'Registrando…' : totalUnidades > 0 ? `Confirmar recepción (${totalUnidades} u.)` : 'Confirmar recepción'}
            </Button>
          </CardBody>
        </Card>
      </div>

      <CrearProductoRapido
        abierto={creando !== null}
        nombreInicial={creando ?? ''}
        codigoInicial={codigoNuevo}
        categorias={categorias}
        productos={productos}
        onCerrar={() => {
          setCreando(null)
          setCodigoNuevo('')
        }}
        onCreado={(p) => {
          setCreando(null)
          setCodigoNuevo('')
          setBusqueda('')
          setProductos((prev) => [...prev, p])
          setLineas((prev) => [{ producto_id: p.id, cantidades: { '': 1 }, costo_unitario: p.costo_referencia || 0 }, ...prev])
          enfocar(`[data-cantidad="${p.id}"]`)
        }}
      />

      <EscanerCamara open={escaneando} onClose={() => setEscaneando(false)} onCodigo={alEscanear} />
    </>
  )
}
