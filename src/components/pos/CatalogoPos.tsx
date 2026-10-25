import type { ReactNode, RefObject } from 'react'
import { Keyboard, LayoutGrid, Rows3, Search } from 'lucide-react'
import type { ProductoConStock } from '@/core/types'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { SelectorVista, type OpcionVista } from '@/components/ui/SelectorVista'
import { cn } from '@/lib/cn'
import { etiquetaVariante } from '@/lib/variantes'
import { formatCLP } from '@/lib/format'
import type { CatalogoPos as DatosCatalogo } from '@/components/pos/useCatalogoPos'
import type { VistaPos } from '@/components/pos/tipos'

const VISTAS_POS: OpcionVista<VistaPos>[] = [
  { v: 'lista', etiqueta: 'Lista compacta', Icono: Rows3 },
  { v: 'botones', etiqueta: 'Botones', Icono: LayoutGrid }
]

interface CatalogoPosProps {
  catalogo: DatosCatalogo
  buscador: RefObject<HTMLInputElement>
  vista: VistaPos
  setVista: (v: VistaPos) => void
  agregar: (p: ProductoConStock, cantidad?: number) => void
}

/** Buscador, categorías y productos del POS (lista compacta o botones con foto). */
export function CatalogoPos({ catalogo, buscador, vista, setVista, agregar }: CatalogoPosProps) {
  const { categorias, catActiva, setCatActiva, busqueda, setBusqueda, termino, cantidadBusqueda, filtrados } = catalogo
  return (
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
  )
}

/** Producto con tallas o colores: se elige la variante antes de agregarla. */
export function ElegirVariante({
  producto,
  onElegir,
  onCerrar
}: {
  producto: ProductoConStock | null
  onElegir: (varianteId: string | null, stock: number, etiqueta: string) => void
  onCerrar: () => void
}) {
  return (
    <Modal open={!!producto} onClose={onCerrar} title={producto ? `${producto.nombre}: elige talla o color` : ''} size="sm">
      {producto && (
        <div className="flex flex-wrap gap-2">
          {producto.variantes.map((v) => {
            const sinStock = producto.controla_stock !== false && v.disponible <= 0
            return (
              <button
                key={v.id}
                disabled={sinStock}
                onClick={() => {
                  onElegir(v.id, v.disponible, etiquetaVariante(v))
                }}
                className="min-w-20 rounded-xl border border-border px-3 py-2 text-left text-sm transition-colors hover:border-accent hover:bg-accent-soft/40 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="block font-medium text-fg">{etiquetaVariante(v) || v.sku}</span>
                {producto.controla_stock !== false && (
                  <span className={cn('text-xs tabular-nums', sinStock ? 'text-danger' : 'text-fg-muted')}>
                    {sinStock ? 'Sin stock' : `${v.disponible} u.`}
                  </span>
                )}
              </button>
            )
          })}
          {producto.legado > 0 && (
            <button
              onClick={() => {
                onElegir(null, producto.legado, 'sin talla')
              }}
              className="min-w-20 rounded-xl border border-dashed border-border px-3 py-2 text-left text-sm hover:bg-surface"
            >
              <span className="block font-medium text-fg">Sin talla</span>
              <span className="text-xs tabular-nums text-fg-muted">{producto.legado} u. antiguas</span>
            </button>
          )}
        </div>
      )}
    </Modal>
  )
}

function Chip({
  activa,
  onClick,
  children
}: {
  activa: boolean
  onClick: () => void
  children: ReactNode
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
