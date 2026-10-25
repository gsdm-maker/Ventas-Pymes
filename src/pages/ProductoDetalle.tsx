import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Save, Package } from 'lucide-react'
import { supabase } from '@/core/supabase/client'
import { useAuth } from '@/core/auth/AuthProvider'
import type { Movimiento, Producto, Stock, Ubicacion } from '@/core/types'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Field, Input } from '@/components/ui/Input'
import { LoadingState } from '@/components/ui/Feedback'
import { useToast } from '@/components/ui/Toast'
import { formatCLP, formatFechaHora } from '@/lib/format'

interface ProductoDetalleViewProps {
  id: string
  onClose?: () => void
}

export function ProductoDetalleView({ id, onClose }: ProductoDetalleViewProps) {
  const navigate = useNavigate()
  const toast = useToast()
  const { can } = useAuth()
  const [producto, setProducto] = useState<Producto | null>(null)
  const [stock, setStock] = useState<(Stock & { ubicacion?: string })[]>([])
  const [movs, setMovs] = useState<Movimiento[]>([])
  const [minimo, setMinimo] = useState(0)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    async function cargar() {
      const { data: p } = await supabase.from('productos').select('*').eq('id', id).single()
      setProducto((p as Producto) ?? null)
      setMinimo(p?.stock_minimo ?? 0)

      const { data: s } = await supabase.from('stock').select('*').eq('producto_id', id)
      const { data: ubis } = await supabase.from('ubicaciones').select('id, nombre')
      const map = new globalThis.Map((ubis ?? []).map((u: Pick<Ubicacion, 'id' | 'nombre'>) => [u.id, u.nombre]))
      setStock((s ?? []).map((row) => ({ ...row, ubicacion: map.get(row.ubicacion_id) })))

      const { data: m } = await supabase
        .from('movimientos')
        .select('*')
        .eq('producto_id', id)
        .order('created_at', { ascending: false })
        .limit(15)
      setMovs((m as Movimiento[]) ?? [])
      setCargando(false)
    }
    void cargar()
  }, [id])

  async function guardarMinimo() {
    const { error } = await supabase.from('productos').update({ stock_minimo: minimo }).eq('id', id)
    if (error) return toast(error.message, 'error')
    toast('Configuración de alertas guardada')
  }

  if (cargando) return <LoadingState />
  if (!producto) return <p className="text-sm text-fg-muted">Producto no encontrado.</p>

  const totalDisponible = stock.reduce((a, s) => a + s.disponible, 0)

  return (
    <>
      {!onClose && (
        <Button variant="ghost" size="sm" className="mb-3" onClick={() => navigate(-1)}>
          <ArrowLeft size={16} /> Volver
        </Button>
      )}

      <div className="space-y-5">
        <Card>
          <CardBody>
            {producto.foto_url ? (
              <img
                src={producto.foto_url}
                alt=""
                width={400}
                height={400}
                loading="lazy"
                className="mb-4 aspect-square w-full rounded-xl object-cover"
              />
            ) : (
              <div className="mb-4 grid aspect-square w-full place-items-center rounded-xl bg-surface-2 text-fg-faint">
                <Package size={40} />
              </div>
            )}
            <h1 className="text-lg font-semibold text-fg">{producto.nombre}</h1>
            <p className="text-sm text-fg-muted">{producto.sku}</p>
            <p className="tabular-nums mt-2 text-xl font-semibold text-accent">{formatCLP(producto.precio_venta)}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <Badge tone="neutral">{producto.marca ?? 'Sin marca'}</Badge>
              <Badge tone="neutral">{producto.unidad_medida}</Badge>
              <Badge tone={producto.activo ? 'success' : 'blocked'}>{producto.activo ? 'Activo' : 'Inactivo'}</Badge>
            </div>
            {producto.descripcion && <p className="mt-3 text-sm text-fg-body">{producto.descripcion}</p>}
            <p className="mt-4 text-sm text-fg-muted">
              Total disponible: <span className="font-semibold text-fg">{totalDisponible}</span>
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Existencias por ubicación" />
          <CardBody className="p-0">
            <div className="divide-y divide-border">
              {stock.map((s) => (
                <div key={s.id} className="flex items-center justify-between px-5 py-3 text-sm">
                  <span className="text-fg">{s.ubicacion ?? '—'}</span>
                  <div className="flex gap-4 text-right tabular-nums">
                    <span className="text-fg">Disp. {s.disponible}</span>
                    <span className="text-fg-muted">Res. {s.reservado}</span>
                    <span className="text-fg-muted">Tráns. {s.transito}</span>
                  </div>
                </div>
              ))}
              {stock.length === 0 && <p className="px-5 py-4 text-sm text-fg-muted">Sin existencias registradas.</p>}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Alertas de stock" />
          <CardBody className="flex items-end gap-3">
            <Field label="Stock mínimo">
              <Input type="number" min={0} value={minimo} onChange={(e) => setMinimo(Number(e.target.value) || 0)} />
            </Field>
            <Button onClick={() => void guardarMinimo()} disabled={!can('productos.gestionar') && !can('inventario.ajustar')}>
              <Save size={16} /> Guardar
            </Button>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Historial de movimientos" />
          <CardBody className="p-0">
            <div className="divide-y divide-border">
              {movs.map((m) => (
                <div key={m.id} className="flex items-center justify-between px-5 py-3 text-sm">
                  <div>
                    <p className="capitalize text-fg">{m.tipo}</p>
                    <p className="text-xs text-fg-muted">{formatFechaHora(m.created_at)}</p>
                  </div>
                  <span className="tabular-nums text-fg">{m.cantidad}</span>
                </div>
              ))}
              {movs.length === 0 && <p className="px-5 py-4 text-sm text-fg-muted">Sin movimientos.</p>}
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  )
}

export function ProductoDetalle() {
  const { id } = useParams()
  if (!id) return <p className="text-sm text-fg-muted">Producto no encontrado.</p>
  return <ProductoDetalleView id={id} />
}
