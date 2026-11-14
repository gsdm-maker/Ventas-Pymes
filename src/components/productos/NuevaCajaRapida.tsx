import { useEffect, useState } from 'react'
import type { ProductoConStock, ProductoPresentacion } from '@/core/types'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { formatCLP } from '@/lib/format'
import { crearPresentacionDevuelta } from '@/core/data/inventario'

/**
 * Crear una caja/pack sin salir de otra pantalla (p. ej. la recepción, cuando la factura
 * viene por cajas). Misma regla que en la ficha del producto: el stock sigue en unidades.
 * El precio de venta parte en «unidades sueltas» para que nunca quede una caja a $0 en el POS.
 */
export function NuevaCajaRapida({
  producto,
  onCerrar,
  onCreada
}: {
  /** null = cerrado */
  producto: ProductoConStock | null
  onCerrar: () => void
  onCreada: (x: ProductoPresentacion) => void
}) {
  const toast = useToast()
  const [factor, setFactor] = useState('')
  const [nombre, setNombre] = useState('')
  const [precio, setPrecio] = useState('')
  const [precioTocado, setPrecioTocado] = useState(false)
  const [codigo, setCodigo] = useState('')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    if (!producto) return
    setFactor('')
    setNombre('')
    setPrecio('')
    setPrecioTocado(false)
    setCodigo('')
  }, [producto])

  const n = Math.floor(Number(factor) || 0)
  const precioUnidad = producto?.precio_venta ?? 0
  const sueltas = n * precioUnidad
  const precioNum = Math.round(Number(precio) || 0)

  function cambiarFactor(t: string) {
    setFactor(t)
    // Mientras no se escriba un precio propio, se sugiere el de las unidades sueltas
    const f = Math.floor(Number(t) || 0)
    if (!precioTocado) setPrecio(f >= 2 && precioUnidad > 0 ? String(f * precioUnidad) : '')
  }

  async function guardar() {
    if (!producto) return
    if (n < 2) return toast('Una caja o pack trae al menos 2 unidades', 'warning')
    if (precioNum <= 0) return toast('Escribe el precio de venta de la caja', 'warning')
    setGuardando(true)
    const { data, error } = await crearPresentacionDevuelta({
      producto_id: producto.id,
      empresa_id: producto.empresa_id,
      nombre: nombre.trim() || `Caja x${n}`,
      factor: n,
      precio_venta: precioNum,
      codigo_barras: codigo.trim() || null
    })
    setGuardando(false)
    if (error || !data) return toast(error ?? 'No se pudo crear la caja', 'error')
    toast(`«${data.nombre}» creada en ${producto.nombre}`)
    onCreada(data)
  }

  return (
    <Modal
      open={!!producto}
      onClose={onCerrar}
      title={producto ? `Nueva caja · ${producto.nombre}` : 'Nueva caja'}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onCerrar}>Cancelar</Button>
          <Button onClick={() => void guardar()} disabled={guardando}>{guardando ? 'Creando…' : 'Crear y recibir en cajas'}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Unidades que trae *">
          <Input type="number" inputMode="numeric" min={2} placeholder="50" value={factor} autoFocus
            onChange={(e) => cambiarFactor(e.target.value)} />
        </Field>
        <Field label="Nombre" hint={n >= 2 ? `Vacío: «Caja x${n}»` : undefined}>
          <Input placeholder="Caja x50, Display x12…" maxLength={40} value={nombre} autoComplete="off"
            onChange={(e) => setNombre(e.target.value)} />
        </Field>
        <Field
          label="Precio de venta de la caja *"
          hint={n >= 2 && precioNum > 0 ? `Sale a ${formatCLP(Math.round(precioNum / n))} por unidad en el POS` : 'Lo que cobras si la vendes cerrada.'}
        >
          <Input type="number" inputMode="numeric" min={0} placeholder={sueltas ? String(sueltas) : '5000'} value={precio}
            onChange={(e) => { setPrecio(e.target.value); setPrecioTocado(true) }} />
        </Field>
        {n >= 2 && precioUnidad > 0 && precioNum > sueltas && (
          <p className="text-xs text-warning">Ojo: más caro que {n} unidades sueltas ({formatCLP(sueltas)}).</p>
        )}
        <Field label="Código de barras de la caja" hint="Opcional. Distinto al de la unidad; sirve para escanearla.">
          <Input placeholder="Escanéalo o escríbelo" value={codigo} autoComplete="off"
            onChange={(e) => setCodigo(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }} />
        </Field>
        <p className="text-xs text-fg-muted">El costo por caja lo escribes en la línea de la recepción.</p>
      </div>
    </Modal>
  )
}
