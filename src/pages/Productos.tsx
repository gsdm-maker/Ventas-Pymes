import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Plus, Package, Search, ChevronDown } from 'lucide-react'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabase } from '@/core/supabase/client'
import { listarCategorias, listarProductosConStock } from '@/core/data/api'
import { GestorVariantes } from '@/components/productos/GestorVariantes'
import { FotoProducto } from '@/components/productos/FotoProducto'
import { CampoCodigoBarras } from '@/components/productos/CampoCodigoBarras'
import { margenDesdePrecio, precioDesdeMargen } from '@/lib/precio'
import { skuAutomatico as skuAutomaticoLib } from '@/lib/sku'
import type { Categoria, ProductoConStock } from '@/core/types'
import { Card, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Field, Input, Select, Textarea } from '@/components/ui/Input'
import { SidePanel } from '@/components/ui/SidePanel'
import { LoadingState, PageHeader } from '@/components/ui/Feedback'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/cn'
import { SelectorVista, type Vista } from '@/components/ui/SelectorVista'
import { formatCLP } from '@/lib/format'

const vacio = {
  id: '',
  sku: '',
  nombre: '',
  codigo_barras: '',
  descripcion: '',
  categoria_id: '',
  marca: '',
  unidad_medida: 'UN',
  foto_url: '',
  precio_venta: 0,
  costo_referencia: 0,
  stock_minimo: 0,
  stock_objetivo: 0,
  controla_stock: true,
  va_a_cocina: true,
  activo: true,
  margen: ''
}

export function Productos() {
  const { can, empresa } = useAuth()
  const toast = useToast()
  const conCocina = !!empresa?.modulos.includes('cocina')
  const [productos, setProductos] = useState<ProductoConStock[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [cargando, setCargando] = useState(true)
  const [open, setOpen] = useState(false)
  const [masOpciones, setMasOpciones] = useState(false)
  const [form, setForm] = useState({ ...vacio })
  // Id del producto nuevo desde el inicio: la foto se guarda con ese nombre antes de crearlo
  const [idNuevo, setIdNuevo] = useState('')
  const [vista, setVista] = useState<Vista>('lista')
  const [busqueda, setBusqueda] = useState('')
  const [cat, setCat] = useState('all')
  const [estado, setEstado] = useState('all')

  async function cargar() {
    setCargando(true)
    const [p, c] = await Promise.all([listarProductosConStock(null), listarCategorias()])
    setProductos(p)
    setCategorias(c)
    setCargando(false)
  }

  useEffect(() => {
    void cargar()
  }, [])

  function nuevo() {
    setMasOpciones(false)
    // En un restaurante lo habitual es vender platos sin inventario; las bebidas se marcan a mano
    setForm({ ...vacio, controla_stock: empresa?.tipo_negocio !== 'restaurante' })
    setIdNuevo(crypto.randomUUID())
    setOpen(true)
  }

  function editar(p: ProductoConStock) {
    setMasOpciones(false)
    setForm({
      id: p.id,
      sku: p.sku,
      nombre: p.nombre,
      codigo_barras: p.codigo_barras ?? '',
      descripcion: p.descripcion ?? '',
      categoria_id: p.categoria_id ?? '',
      marca: p.marca ?? '',
      unidad_medida: p.unidad_medida,
      foto_url: p.foto_url ?? '',
      precio_venta: p.precio_venta,
      costo_referencia: p.costo_referencia,
      stock_minimo: p.stock_minimo,
      stock_objetivo: p.stock_objetivo,
      controla_stock: p.controla_stock !== false,
      va_a_cocina: p.va_a_cocina !== false,
      activo: p.activo,
      margen: String(margenDesdePrecio(p.costo_referencia, p.precio_venta) ?? '')
    })
    setOpen(true)
  }

  async function guardar() {
    if (!form.nombre.trim()) return toast('Escribe el nombre del producto', 'warning')
    const payload = {
      empresa_id: empresa?.id,
      sku: form.sku.trim() || skuAutomatico(),
      nombre: form.nombre.trim(),
      codigo_barras: form.codigo_barras.trim() || null,
      descripcion: form.descripcion || null,
      categoria_id: form.categoria_id || null,
      marca: form.marca || null,
      unidad_medida: form.unidad_medida || 'UN',
      foto_url: form.foto_url || null,
      precio_venta: Number(form.precio_venta) || 0,
      costo_referencia: Number(form.costo_referencia) || 0,
      stock_minimo: Number(form.stock_minimo) || 0,
      stock_objetivo: Number(form.stock_objetivo) || 0,
      controla_stock: form.controla_stock,
      va_a_cocina: form.va_a_cocina,
      activo: form.activo
    }
    const { error } = form.id
      ? await supabase.from('productos').update(payload).eq('id', form.id)
      : await supabase.from('productos').insert({ ...payload, id: idNuevo })
    if (error) {
      return toast(error.code === '23505' && error.message.includes('codigo_barras')
        ? 'Ese código de barras ya lo tiene otro producto'
        : error.message, 'error')
    }
    toast(form.id ? 'Producto actualizado' : 'Producto creado')
    setOpen(false)
    void cargar()
  }

  const puedeEditar = can('productos.gestionar')

  // Producto nuevo que no se guardó: su foto ya subida se borra para no dejar archivos sueltos
  function cerrarFicha() {
    const ruta = form.foto_url.match(/\/public\/productos\/([^?]+)/)?.[1]
    if (!form.id && ruta) void supabase.storage.from('productos').remove([ruta])
    setOpen(false)
  }

  function cambiarCosto(costo: number) {
    const m = Number(form.margen)
    if (form.margen !== '' && Number.isFinite(m) && m < 100) {
      setForm({ ...form, costo_referencia: costo, precio_venta: precioDesdeMargen(costo, m) })
    } else {
      setForm({ ...form, costo_referencia: costo, margen: String(margenDesdePrecio(costo, form.precio_venta) ?? '') })
    }
  }
  function cambiarMargen(texto: string) {
    const m = Number(texto.replace(',', '.'))
    setForm({
      ...form,
      margen: texto,
      precio_venta: texto !== '' && Number.isFinite(m) && m < 100 && form.costo_referencia
        ? precioDesdeMargen(form.costo_referencia, m)
        : form.precio_venta
    })
  }
  function cambiarPrecio(precio: number) {
    setForm({ ...form, precio_venta: precio, margen: String(margenDesdePrecio(form.costo_referencia, precio) ?? '') })
  }
  const codigosUsados = new Set(productos.filter((x) => x.id !== form.id && x.codigo_barras).map((x) => x.codigo_barras as string))

  const skuAutomatico = () =>
    skuAutomaticoLib(categorias.find((c) => c.id === form.categoria_id)?.nombre, productos.map((x) => x.sku))

  const filtrados = useMemo(() => {
    const t = busqueda.trim().toLowerCase()
    return productos.filter((p) => {
      if (cat !== 'all' && p.categoria_id !== cat) return false
      if (estado === 'activos' && !p.activo) return false
      if (estado === 'inactivos' && p.activo) return false
      if (estado === 'sin_control' && p.controla_stock !== false) return false
      if (estado === 'con_variantes' && !p.variantes.length) return false
      if (!t) return true
      return p.nombre.toLowerCase().includes(t) || p.sku.toLowerCase().includes(t)
    })
  }, [productos, busqueda, cat, estado])

  return (
    <>
      <PageHeader
        title="Productos"
        subtitle="Mantenedor del catálogo: datos, precios y configuración de cada producto. El stock se ve en Inventario."
      />

      {/* Acción principal flotante (sobre la barra inferior en móvil); se oculta con la ficha abierta */}
      {puedeEditar && !open && (
        <Button
          onClick={nuevo}
          aria-label="Nuevo producto"
          className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-30 h-12 rounded-full px-4 shadow-lg sm:px-5 lg:bottom-8 lg:right-8"
        >
          <Plus size={18} /> <span className="hidden sm:inline">Nuevo producto</span>
        </Button>
      )}

      <div className="mb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-52 flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint" />
            <Input
              className="pl-9"
              placeholder="Buscar por nombre o SKU…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </div>
          <Select value={estado} onChange={(e) => setEstado(e.target.value)} className="w-auto">
            <option value="all">Todo estado</option>
            <option value="activos">Activos</option>
            <option value="inactivos">Inactivos</option>
            <option value="sin_control">Sin inventario</option>
            {empresa?.usa_variantes && <option value="con_variantes">Con tallas y colores</option>}
          </Select>
          <SelectorVista valor={vista} onChange={setVista} />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          <button
            onClick={() => setCat('all')}
            className={cn(
              'shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors',
              cat === 'all' ? 'bg-accent text-on-accent shadow-sm' : 'bg-surface text-fg-muted hover:bg-surface-2'
            )}
          >
            Todas ({productos.length})
          </button>
          {categorias.map((c) => {
            const n = productos.filter((p) => p.categoria_id === c.id).length
            return (
              <button
                key={c.id}
                onClick={() => setCat(c.id)}
                className={cn(
                  'shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors',
                  cat === c.id ? 'bg-accent text-on-accent shadow-sm' : 'bg-surface text-fg-muted hover:bg-surface-2'
                )}
              >
                {c.nombre} ({n})
              </button>
            )
          })}
        </div>
      </div>

      {cargando ? (
        <LoadingState />
      ) : filtrados.length === 0 ? (
        <Card>
          <CardBody className="py-14 text-center text-sm text-fg-muted">
            <Package className="mx-auto mb-3 text-fg-faint" size={32} />
            No hay productos que coincidan con los filtros.
          </CardBody>
        </Card>
      ) : vista === 'tarjetas' ? (
        <Card>
          <CardBody className="p-0">
            <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-3">
              {filtrados.map((p) => (
                <div
                  key={p.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${puedeEditar ? 'Editar' : 'Ver'} ${p.nombre}`}
                  onClick={() => editar(p)}
                  onKeyDown={(e) => e.key === 'Enter' && editar(p)}
                  className="flex cursor-pointer items-center gap-3 border-b border-border p-4 transition-colors hover:bg-surface focus-visible:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 sm:border-r"
                >
                  {p.foto_url ? (
                    <img src={p.foto_url} alt="" width={48} height={48} loading="lazy" className="size-12 rounded-lg object-cover" />
                  ) : (
                    <span className="grid size-12 place-items-center rounded-lg bg-surface-2 text-fg-faint">
                      <Package size={18} />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">{p.nombre}</p>
                    <p className="text-xs text-fg-muted">{p.sku} · {p.categoria_nombre ?? 'Sin categoría'}</p>
                    <p className="tabular-nums mt-0.5 text-sm font-semibold text-accent">{formatCLP(p.precio_venta)}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge tone={p.activo ? 'success' : 'blocked'}>{p.activo ? 'Activo' : 'Inactivo'}</Badge>
                    {p.controla_stock === false && <Badge tone="neutral">Sin inventario</Badge>}
                    {conCocina && p.va_a_cocina === false && <Badge tone="neutral">No va a cocina</Badge>}
                    {p.variantes.length > 0 && <Badge tone="info">{p.variantes.length} variantes</Badge>}
                  </div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-fg-muted">
                    <th className="px-4 py-3 font-medium">Producto</th>
                    <th className="px-4 py-3 font-medium">Categoría</th>
                    <th className="px-4 py-3 text-right font-medium">Precio</th>
                    <th className="px-4 py-3 text-right font-medium">Costo neto</th>
                    <th className="px-4 py-3 text-right font-medium">Margen</th>
                    <th className="px-4 py-3 font-medium">Tipo</th>
                    <th className="px-4 py-3 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((p) => (
                    <tr
                      key={p.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`${puedeEditar ? 'Editar' : 'Ver'} ${p.nombre}`}
                      onClick={() => editar(p)}
                      onKeyDown={(e) => e.key === 'Enter' && editar(p)}
                      className="cursor-pointer border-b border-border/60 last:border-0 transition-colors hover:bg-surface focus-visible:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {p.foto_url ? (
                            <img src={p.foto_url} alt="" width={40} height={40} loading="lazy" className="size-10 rounded-lg object-cover" />
                          ) : (
                            <span className="grid size-10 place-items-center rounded-lg bg-surface-2 text-fg-faint">
                              <Package size={16} />
                            </span>
                          )}
                          <div>
                            <p className="font-medium text-fg">{p.nombre}</p>
                            <p className="text-xs text-fg-muted">{p.sku}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-fg-body">{p.categoria_nombre ?? '—'}</td>
                      <td className="tabular-nums px-4 py-3 text-right font-semibold text-accent">{formatCLP(p.precio_venta)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-fg-body">
                        {p.costo_referencia ? formatCLP(p.costo_referencia) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-fg-body">{margen(p)}</td>
                      <td className="px-4 py-3 text-fg-body">{tipoProducto(p)}</td>
                      <td className="px-4 py-3">
                        <Badge tone={p.activo ? 'success' : 'blocked'}>{p.activo ? 'Activo' : 'Inactivo'}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}
      {/* Espacio para que el botón flotante no tape la última fila */}
      {puedeEditar && <div aria-hidden className="h-16" />}

      <SidePanel
        open={open}
        onClose={cerrarFicha}
        eyebrow={form.id ? form.sku : undefined}
        title={form.id ? form.nombre || 'Producto' : 'Nuevo producto'}
        width="lg"
        footer={
          puedeEditar ? (
            <>
              <Button variant="secondary" onClick={cerrarFicha}>Cancelar</Button>
              <Button onClick={() => void guardar()}>Guardar</Button>
            </>
          ) : (
            <Button variant="secondary" onClick={() => setOpen(false)}>Cerrar</Button>
          )
        }
      >
        <fieldset disabled={!puedeEditar} className="space-y-4">
          {/* Lo esencial: con esto ya se puede vender */}
          {empresa && (
            <FotoProducto
              url={form.foto_url}
              empresaId={empresa.id}
              productoId={form.id || idNuevo}
              disabled={!puedeEditar}
              onChange={(url) => setForm((f) => ({ ...f, foto_url: url }))}
            />
          )}
          <Field label="Nombre" required>
            <Input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} placeholder="Ej: Polera básica…" autoComplete="off" />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Costo neto">
              <Input type="number" inputMode="numeric" value={form.costo_referencia || ''} onChange={(e) => cambiarCosto(Number(e.target.value) || 0)} placeholder="0" />
            </Field>
            <Field label="Margen %">
              <Input inputMode="decimal" value={form.margen} onChange={(e) => cambiarMargen(e.target.value)} placeholder="40" disabled={!form.costo_referencia} />
            </Field>
            <Field label="Precio venta" required>
              <Input type="number" inputMode="numeric" value={form.precio_venta || ''} onChange={(e) => cambiarPrecio(Number(e.target.value) || 0)} placeholder="0" />
            </Field>
          </div>
          <p className="-mt-2 text-xs text-fg-muted">
            {form.precio_venta > 0
              ? `Precio con IVA: neto ${formatCLP(Math.round(form.precio_venta / 1.19))} + IVA ${formatCLP(form.precio_venta - Math.round(form.precio_venta / 1.19))}.`
              : 'Ingresa el costo y el margen, o el precio directamente.'}{' '}
            {form.costo_referencia > 0 && form.precio_venta > 0 && form.precio_venta / 1.19 <= form.costo_referencia && (
              <span className="font-medium text-danger">El precio no cubre el costo.</span>
            )}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Categoría">
              <Select value={form.categoria_id} onChange={(e) => setForm({ ...form, categoria_id: e.target.value })}>
                <option value="">Sin categoría</option>
                {categorias.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </Select>
            </Field>
            <Field label="Stock mínimo" hint={form.controla_stock ? 'Bajo esta cantidad se alerta' : 'No aplica: el producto no controla stock'}>
              <Input type="number" inputMode="numeric" disabled={!form.controla_stock} value={form.stock_minimo || ''} onChange={(e) => setForm({ ...form, stock_minimo: Number(e.target.value) || 0 })} placeholder="0" />
            </Field>
          </div>
          <Field label="Código de barras">
            <CampoCodigoBarras
              valor={form.codigo_barras}
              usados={codigosUsados}
              nombre={form.nombre}
              precio={form.precio_venta}
              disabled={!puedeEditar}
              onChange={(v) => setForm((f) => ({ ...f, codigo_barras: v }))}
            />
          </Field>
          {form.id && (
            <label className="flex items-center gap-2 text-sm text-fg-body">
              <input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} className="size-4 accent-[rgb(var(--accent))]" />
              Producto activo (visible para vender)
            </label>
          )}

          <button
            type="button"
            onClick={() => setMasOpciones((v) => !v)}
            aria-expanded={masOpciones}
            className="flex w-full items-center justify-between rounded-xl border border-border px-3 py-2.5 text-sm font-medium text-fg-body hover:bg-surface"
          >
            Más opciones
            <span className="flex items-center gap-1 text-xs font-normal text-fg-muted">
              código interno, marca, inventario{empresa?.usa_variantes ? ', tallas' : ''}
              <ChevronDown size={16} className={cn('transition-transform', masOpciones && 'rotate-180')} aria-hidden />
            </span>
          </button>

          {masOpciones && (
            <div className="space-y-6">
              <Seccion titulo="Detalle">
                <Field label="Código interno (SKU)" hint={form.id ? undefined : `Si lo dejas vacío se asigna ${skuAutomatico()}`}>
                  <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder={form.id ? '' : skuAutomatico()} autoComplete="off" />
                </Field>
                <Field label="Marca">
                  <Input value={form.marca} onChange={(e) => setForm({ ...form, marca: e.target.value })} />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Descripción">
                    <Textarea value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} />
                  </Field>
                </div>
              </Seccion>

              <Seccion titulo="Inventario">
                <label className="flex items-start gap-2 rounded-xl border border-border p-3 text-sm text-fg-body sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={form.controla_stock}
                    onChange={(e) => setForm({ ...form, controla_stock: e.target.checked })}
                    className="mt-0.5 size-4 accent-[rgb(var(--accent))]"
                  />
                  <span>
                    <span className="font-medium text-fg">Controla stock</span>
                    <span className="block text-xs text-fg-muted">
                      Desmárcalo para productos que se preparan o no se inventarían (platos, servicios).
                    </span>
                  </span>
                </label>
                {conCocina && (
                  <label className="flex items-start gap-2 rounded-xl border border-border p-3 text-sm text-fg-body sm:col-span-2">
                    <input
                      type="checkbox"
                      checked={form.va_a_cocina}
                      onChange={(e) => setForm({ ...form, va_a_cocina: e.target.checked })}
                      className="mt-0.5 size-4 accent-[rgb(var(--accent))]"
                    />
                    <span>
                      <span className="font-medium text-fg">Se prepara en cocina</span>
                      <span className="block text-xs text-fg-muted">
                        Desmárcalo para bebidas, postres envasados y todo lo que se sirve sin preparar: se agrega a
                        la cuenta sin aparecer en la pantalla de cocina.
                      </span>
                    </span>
                  </label>
                )}
                <Field label="Unidad de medida">
                  <Input value={form.unidad_medida} onChange={(e) => setForm({ ...form, unidad_medida: e.target.value })} />
                </Field>
              </Seccion>

              {empresa?.usa_variantes &&
                (form.id ? (
                  <GestorVariantes productoId={form.id} sku={form.sku} empresaId={empresa.id} />
                ) : (
                  <p className="text-xs text-fg-muted">Guarda el producto para agregarle tallas o colores.</p>
                ))}
            </div>
          )}
        </fieldset>
      </SidePanel>
    </>
  )
}

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="border-b border-border pb-1.5 text-xs font-semibold text-fg-muted">{titulo}</h3>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  )
}

function margen(p: ProductoConStock): string {
  const m = margenDesdePrecio(p.costo_referencia, p.precio_venta)
  return m === null ? '—' : `${Math.round(m)}%`
}

function tipoProducto(p: ProductoConStock): string {
  if (p.controla_stock === false) return 'Sin inventario'
  if (p.variantes.length) return `${p.variantes.length} tallas/colores`
  return 'Con inventario'
}
