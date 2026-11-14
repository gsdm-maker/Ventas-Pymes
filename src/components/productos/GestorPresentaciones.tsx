import { useEffect, useState } from 'react'
import { Boxes, Pencil, Plus, X } from 'lucide-react'
import type { ProductoPresentacion } from '@/core/types'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { useToast } from '@/components/ui/Toast'
import { formatCLP } from '@/lib/format'
import { precioPorUnidad } from '@/lib/presentaciones'
import { actualizarPresentacion, crearPresentacion, listarPresentaciones } from '@/core/data/inventario'

const vacio = { id: '', nombre: '', factor: '', precio: '', codigo: '' }

/**
 * Cajas y packs de un producto: «Caja x50» a $5.000 descuenta 50 u. del stock al venderse.
 * El stock se lleva siempre en unidades. Se desactivan, no se borran (quedan en las ventas).
 */
export function GestorPresentaciones({
  productoId,
  empresaId,
  precioUnidad
}: {
  productoId: string
  empresaId: string
  precioUnidad: number
}) {
  const toast = useToast()
  const [lista, setLista] = useState<ProductoPresentacion[]>([])
  const [form, setForm] = useState({ ...vacio })
  const [guardando, setGuardando] = useState(false)

  async function cargar() {
    setLista(await listarPresentaciones(productoId))
  }

  useEffect(() => {
    void cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productoId])

  const factor = Math.floor(Number(form.factor) || 0)
  const precio = Math.round(Number(form.precio) || 0)
  const sueltas = factor * precioUnidad

  async function guardar() {
    if (factor < 2) return toast('Una caja o pack trae al menos 2 unidades', 'warning')
    if (precio <= 0) return toast('Escribe el precio de la presentación', 'warning')
    const datos = {
      nombre: form.nombre.trim() || `Caja x${factor}`,
      factor,
      precio_venta: precio,
      codigo_barras: form.codigo.trim() || null
    }
    setGuardando(true)
    const error = form.id
      ? await actualizarPresentacion(form.id, datos)
      : await crearPresentacion({ ...datos, producto_id: productoId, empresa_id: empresaId })
    setGuardando(false)
    if (error) return toast(error, 'error')
    toast(form.id ? 'Presentación actualizada' : 'Presentación creada')
    setForm({ ...vacio })
    void cargar()
  }

  async function alternar(x: ProductoPresentacion) {
    const error = await actualizarPresentacion(x.id, { activa: !x.activa })
    if (error) return toast(error, 'error')
    setLista((prev) => prev.map((y) => (y.id === x.id ? { ...y, activa: !y.activa } : y)))
  }

  function editar(x: ProductoPresentacion) {
    setForm({
      id: x.id,
      nombre: x.nombre,
      factor: String(x.factor),
      precio: String(x.precio_venta),
      codigo: x.codigo_barras ?? ''
    })
  }

  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <p className="flex items-center gap-2 text-sm font-medium text-fg">
        <Boxes size={15} aria-hidden /> Cajas y packs
      </p>
      {lista.length === 0 ? (
        <p className="text-xs text-fg-muted">
          Si lo vendes también por caja o pack, agrégalo aquí con su precio y su código de barras. El stock sigue en
          unidades: vender 1 «Caja x50» descuenta 50.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {lista.map((x) => {
            const c = precioPorUnidad(x)
            return (
              <li key={x.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <span className={x.activa ? 'font-medium text-fg' : 'text-fg-faint line-through'}>{x.nombre}</span>
                <span className="text-xs text-fg-muted">{x.factor} u.</span>
                <span className="tabular-nums text-fg">{formatCLP(x.precio_venta)}</span>
                <span className="text-xs tabular-nums text-fg-muted">
                  {formatCLP(c)} c/u{precioUnidad > c ? ` · ahorra ${formatCLP(precioUnidad - c)} por unidad` : ''}
                </span>
                {x.codigo_barras && <span className="font-mono text-xs text-fg-muted">{x.codigo_barras}</span>}
                {!x.activa && <Badge tone="neutral">inactiva</Badge>}
                <span className="ml-auto flex gap-1">
                  <Button type="button" size="sm" variant="ghost" onClick={() => editar(x)} aria-label={`Editar ${x.nombre}`}>
                    <Pencil size={13} />
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => void alternar(x)}>
                    {x.activa ? 'Desactivar' : 'Activar'}
                  </Button>
                </span>
              </li>
            )
          })}
        </ul>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Unidades que trae">
          <Input type="number" inputMode="numeric" min={2} placeholder="50" value={form.factor}
            onChange={(e) => setForm({ ...form, factor: e.target.value })} />
        </Field>
        <Field label="Precio de la caja/pack" hint={factor >= 2 && precioUnidad > 0 ? `Suelto serían ${formatCLP(sueltas)}` : undefined}>
          <Input type="number" inputMode="numeric" min={0} placeholder="5000" value={form.precio}
            onChange={(e) => setForm({ ...form, precio: e.target.value })} />
        </Field>
        <Field label="Nombre" hint={factor >= 2 ? `Vacío: «Caja x${factor}»` : undefined}>
          <Input placeholder="Caja x50, Display x12…" maxLength={40} value={form.nombre}
            onChange={(e) => setForm({ ...form, nombre: e.target.value })} autoComplete="off" />
        </Field>
        <Field label="Código de barras de la caja" hint="Opcional. Distinto al de la unidad.">
          <Input placeholder="Escanéalo o escríbelo" value={form.codigo} autoComplete="off"
            onChange={(e) => setForm({ ...form, codigo: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }} />
        </Field>
      </div>
      {factor >= 2 && precio > 0 && (
        <p className="text-xs text-fg-muted">
          Sale a {formatCLP(Math.round(precio / factor))} por unidad
          {precioUnidad > 0 && precio > sueltas ? ' · ojo: más caro que comprar las unidades sueltas' : ''}.
        </p>
      )}
      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={() => void guardar()} disabled={guardando}>
          <Plus size={14} /> {form.id ? 'Guardar cambios' : 'Agregar'}
        </Button>
        {form.id && (
          <Button type="button" variant="ghost" onClick={() => setForm({ ...vacio })}>
            <X size={14} /> Cancelar
          </Button>
        )}
      </div>
    </div>
  )
}
