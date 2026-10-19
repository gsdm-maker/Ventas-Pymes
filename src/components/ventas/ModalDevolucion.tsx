import { useMemo, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { supabase } from '@/core/supabase/client'
import type { Devolucion, Venta, VentaItem } from '@/core/types'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/confirm'
import { formatCLP } from '@/lib/format'

const MOTIVOS = ['Producto defectuoso', 'Cambio de talla o color', 'Error de cobro', 'Cliente se arrepintió', 'Otro']

/**
 * Devolución parcial o anulación de una venta. El reembolso se prorratea según el
 * descuento de la venta (mismo cálculo que devolver_venta en la base).
 */
export function ModalDevolucion({
  venta,
  items,
  abierto,
  onCerrar,
  onListo
}: {
  venta: Venta
  items: VentaItem[]
  abierto: boolean
  onCerrar: () => void
  onListo: (d: Devolucion) => void
}) {
  const toast = useToast()
  const confirmar = useConfirm()
  const [cant, setCant] = useState<Record<string, number>>({})
  const [motivo, setMotivo] = useState(MOTIVOS[0])
  const [detalle, setDetalle] = useState('')
  const [enviando, setEnviando] = useState(false)

  const restante = (i: VentaItem) => i.cantidad - (i.cantidad_devuelta ?? 0)
  const bruto = items.reduce((a, i) => a + i.total_linea, 0)
  const factor = bruto > 0 ? venta.total / bruto : 0

  const seleccion = useMemo(() => items.filter((i) => (cant[i.id] ?? 0) > 0), [items, cant])
  const todo = items.every((i) => (cant[i.id] ?? 0) === restante(i))
  const reembolso = todo
    ? venta.total - (venta.monto_devuelto ?? 0)
    : seleccion.reduce((a, i) => a + Math.round((cant[i.id] ?? 0) * i.precio_unitario * factor), 0)

  function devolverTodo() {
    const c: Record<string, number> = {}
    items.forEach((i) => (c[i.id] = restante(i)))
    setCant(c)
  }

  async function enviar() {
    const texto = [motivo === 'Otro' ? '' : motivo, detalle.trim()].filter(Boolean).join(': ')
    if (texto.length < 3) return toast('Indica el motivo de la devolución', 'warning')
    if (!seleccion.length) return toast('Indica qué productos se devuelven', 'warning')
    const ok = await confirmar({
      titulo: todo && !venta.monto_devuelto ? `Anular la venta ${venta.folio}` : `Registrar devolución de ${venta.folio}`,
      mensaje: `Se reembolsarán ${formatCLP(reembolso)} (${venta.medio_pago}) y los productos volverán al stock. Queda registrado y no se puede deshacer.`,
      accion: todo && !venta.monto_devuelto ? 'Anular venta' : 'Registrar devolución'
    })
    if (!ok) return
    setEnviando(true)
    const { data, error } = await supabase.rpc('devolver_venta', {
      p_venta: venta.id,
      p_items: todo ? null : seleccion.map((i) => ({ venta_item_id: i.id, cantidad: cant[i.id] })),
      p_motivo: texto
    })
    setEnviando(false)
    if (error) return toast(error.message, 'error')
    toast(todo ? 'Venta anulada' : 'Devolución registrada')
    setCant({})
    setDetalle('')
    onListo(data as Devolucion)
  }

  return (
    <Modal
      open={abierto}
      onClose={onCerrar}
      title={`Devolver o anular ${venta.folio}`}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onCerrar}>Cancelar</Button>
          <Button variant="danger" onClick={() => void enviar()} disabled={enviando || !seleccion.length}>
            <RotateCcw size={16} /> {enviando ? 'Registrando…' : todo && !venta.monto_devuelto ? 'Anular venta' : 'Registrar devolución'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface text-left text-xs text-fg-muted">
                <th className="px-3 py-2 font-medium">Producto</th>
                <th className="px-3 py-2 text-right font-medium">Vendido</th>
                <th className="px-3 py-2 text-right font-medium">Ya devuelto</th>
                <th className="px-3 py-2 text-right font-medium">Devolver</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2 text-fg">{i.descripcion}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-fg-body">{i.cantidad}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-fg-muted">{i.cantidad_devuelta || '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={restante(i)}
                      disabled={restante(i) === 0}
                      aria-label={`Unidades a devolver de ${i.descripcion}`}
                      value={cant[i.id] ?? 0}
                      onChange={(e) =>
                        setCant((prev) => ({ ...prev, [i.id]: Math.max(0, Math.min(restante(i), Number(e.target.value) || 0)) }))
                      }
                      className="ml-auto w-20 py-1.5 text-center"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button size="sm" variant="secondary" onClick={devolverTodo}>Devolver todo</Button>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Motivo" required>
            <Select value={motivo} onChange={(e) => setMotivo(e.target.value)}>
              {MOTIVOS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </Select>
          </Field>
          <Field label={motivo === 'Otro' ? 'Describe el motivo' : 'Detalle (opcional)'} required={motivo === 'Otro'}>
            <Input value={detalle} onChange={(e) => setDetalle(e.target.value)} autoComplete="off" />
          </Field>
        </div>

        <div className="flex items-center justify-between rounded-xl bg-surface px-4 py-3 text-sm">
          <span className="text-fg-body">Reembolso ({venta.medio_pago})</span>
          <span className="text-lg font-semibold tabular-nums text-fg">{formatCLP(reembolso)}</span>
        </div>
        {venta.descuento_valor > 0 && (
          <p className="text-xs text-fg-muted">El reembolso considera el descuento aplicado en la venta.</p>
        )}
      </div>
    </Modal>
  )
}
