import { useEffect, useMemo, useState } from 'react'
import { Search, Package } from 'lucide-react'
import { useAuth } from '@/core/auth/AuthProvider'
import { listarCategorias, listarProductosConStock } from '@/core/data/api'
import { etiquetaVariante } from '@/lib/variantes'
import type { Categoria, EstadoStock, ProductoConStock } from '@/core/types'
import { Card, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Input, Select } from '@/components/ui/Input'
import { SidePanel } from '@/components/ui/SidePanel'
import { EmptyState, LoadingState, PageHeader } from '@/components/ui/Feedback'
import { ProductoDetalleView } from '@/pages/ProductoDetalle'
import { cn } from '@/lib/cn'
import { SelectorVista, type Vista } from '@/components/ui/SelectorVista'
import { formatCLP } from '@/lib/format'

const estadoLabel: Record<EstadoStock, string> = {
  sin: 'Sin stock',
  bajo: 'Bajo mínimo',
  ok: 'Disponible',
  exceso: 'Exceso'
}
const estadoTono = { sin: 'danger', bajo: 'warning', ok: 'success', exceso: 'info' } as const

export function Inventario() {
  const { ubicacionActiva, ubicaciones } = useAuth()
  const [productos, setProductos] = useState<ProductoConStock[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [cat, setCat] = useState('all')
  const [estado, setEstado] = useState('all')
  const [vista, setVista] = useState<Vista>('lista')
  const [cargando, setCargando] = useState(true)
  const [productoSeleccionado, setProductoSeleccionado] = useState<ProductoConStock | null>(null)

  const ubicacionNombre = ubicaciones.find((u) => u.id === ubicacionActiva)?.nombre ?? 'Todas las ubicaciones'

  useEffect(() => {
    listarCategorias().then(setCategorias)
  }, [])

  useEffect(() => {
    setCargando(true)
    // El inventario muestra solo productos con control de stock
    listarProductosConStock(ubicacionActiva)
      .then((p) => setProductos(p.filter((x) => x.controla_stock !== false)))
      .finally(() => setCargando(false))
  }, [ubicacionActiva])

  const filtrados = useMemo(() => {
    const t = busqueda.trim().toLowerCase()
    return productos.filter((p) => {
      if (cat !== 'all' && p.categoria_id !== cat) return false
      if (estado !== 'all' && p.estado_stock !== estado) return false
      if (!t) return true
      return p.nombre.toLowerCase().includes(t) || p.sku.toLowerCase().includes(t)
    })
  }, [productos, busqueda, cat, estado])

  return (
    <>
      <PageHeader title="Inventario" subtitle={ubicacionNombre} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint" />
          <Input className="pl-9" placeholder="Buscar por nombre o SKU…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </div>
        <Select value={cat} onChange={(e) => setCat(e.target.value)} className="w-auto">
          <option value="all">Todas las categorías</option>
          {categorias.map((c) => (
            <option key={c.id} value={c.id}>{c.nombre}</option>
          ))}
        </Select>
        <Select value={estado} onChange={(e) => setEstado(e.target.value)} className="w-auto">
          <option value="all">Todo estado</option>
          <option value="ok">Disponible</option>
          <option value="bajo">Bajo mínimo</option>
          <option value="sin">Sin stock</option>
        </Select>
        <SelectorVista valor={vista} onChange={setVista} />
      </div>

      {cargando ? (
        <LoadingState />
      ) : filtrados.length === 0 ? (
        <EmptyState icon={<Package size={32} />} title="Sin resultados" description="Ajusta los filtros o la búsqueda." />
      ) : vista === 'lista' ? (
        <Card>
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-fg-muted">
                    <th className="px-4 py-3 font-medium">Producto</th>
                    {/* En el celular solo lo esencial: producto, disponible y estado */}
                    <th className="hidden px-4 py-3 font-medium md:table-cell">Categoría</th>
                    <th className="px-4 py-3 text-right font-medium">Disponible</th>
                    <th className="hidden px-4 py-3 text-right font-medium sm:table-cell">Mínimo</th>
                    <th className="hidden px-4 py-3 text-right font-medium sm:table-cell">Precio</th>
                    <th className="px-4 py-3 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((p) => (
                    <tr
                      key={p.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`Ver detalle de ${p.nombre}`}
                      onClick={() => setProductoSeleccionado(p)}
                      onKeyDown={(e) => e.key === 'Enter' && setProductoSeleccionado(p)}
                      className="cursor-pointer border-b border-border/60 last:border-0 transition-colors hover:bg-surface focus-visible:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {p.foto_url ? (
                            <img src={p.foto_url} alt="" width={36} height={36} loading="lazy" className="size-9 rounded-lg object-cover" />
                          ) : (
                            <span className="grid size-9 place-items-center rounded-lg bg-surface-2 text-fg-faint"><Package size={14} /></span>
                          )}
                          <div>
                            <p className="font-medium text-fg">{p.nombre}</p>
                            <p className="text-xs text-fg-muted">{p.sku}</p>
                            {p.variantes.length > 0 && (
                              <p className="mt-0.5 text-xs tabular-nums text-fg-muted">
                                {p.variantes.map((v) => (
                                  <span key={v.id} className={cn('mr-2', v.disponible <= 0 && 'text-danger')}>
                                    {etiquetaVariante(v)} {v.disponible}
                                  </span>
                                ))}
                                {p.legado > 0 && <span className="mr-2">sin talla {p.legado}</span>}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="hidden px-4 py-3 text-fg-body md:table-cell">{p.categoria_nombre ?? '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-fg">{p.disponible}</td>
                      <td className="hidden px-4 py-3 text-right tabular-nums text-fg-muted sm:table-cell">{p.stock_minimo}</td>
                      <td className="hidden px-4 py-3 text-right tabular-nums text-fg sm:table-cell">{formatCLP(p.precio_venta)}</td>
                      <td className="px-4 py-3"><Badge tone={estadoTono[p.estado_stock]} dot>{estadoLabel[p.estado_stock]}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {filtrados.map((p) => (
            <button
              key={p.id}
              onClick={() => setProductoSeleccionado(p)}
              aria-label={`Ver detalle de ${p.nombre}`}
              className="overflow-hidden rounded-2xl border border-border bg-panel p-3 text-left transition-shadow duration-200 hover:shadow-card-hover active:scale-[0.98]"
            >
              {p.foto_url ? (
                <img src={p.foto_url} alt="" width={320} height={144} loading="lazy" className="mb-3 h-36 w-full rounded-lg object-cover" />
              ) : (
                <div className="mb-3 grid h-36 w-full place-items-center rounded-lg bg-surface-2 text-fg-faint"><Package size={20} /></div>
              )}
              <p className="text-[10px] uppercase tracking-wider text-fg-faint">{p.categoria_nombre ?? '—'}</p>
              <p className="line-clamp-1 text-sm font-medium text-fg">{p.nombre}</p>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs text-fg-muted">Stock {p.disponible}</span>
                <Badge tone={estadoTono[p.estado_stock]} dot>{estadoLabel[p.estado_stock]}</Badge>
              </div>
            </button>
          ))}
        </div>
      )}

      <SidePanel
        open={!!productoSeleccionado}
        onClose={() => setProductoSeleccionado(null)}
        title={productoSeleccionado?.nombre}
        eyebrow={productoSeleccionado?.sku}
      >
        {productoSeleccionado && (
          <ProductoDetalleView id={productoSeleccionado.id} onClose={() => setProductoSeleccionado(null)} />
        )}
      </SidePanel>
    </>
  )
}
