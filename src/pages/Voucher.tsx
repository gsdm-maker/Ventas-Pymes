import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CloudOff, Check, Printer, RotateCcw } from 'lucide-react'
import { supabase } from '@/core/supabase/client'
import { useAuth } from '@/core/auth/AuthProvider'
import { useSync } from '@/core/offline/SyncProvider'
import type { Devolucion, Venta, VentaItem, Voucher as VoucherT } from '@/core/types'
import { ModalDevolucion } from '@/components/ventas/ModalDevolucion'
import { Card, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { LoadingState } from '@/components/ui/Feedback'
import { desglosarIVA, formatCLP, formatFechaHora } from '@/lib/format'
import { etiquetaMedio } from '@/lib/mediosPago'

export function Voucher() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [voucher, setVoucher] = useState<VoucherT | null>(null)
  const [venta, setVenta] = useState<Venta | null>(null)
  const [items, setItems] = useState<VentaItem[]>([])
  const [devoluciones, setDevoluciones] = useState<(Devolucion & { voucher_id?: string })[]>([])
  const [devolucion, setDevolucion] = useState<Devolucion | null>(null)
  const [devItems, setDevItems] = useState<{ cantidad: number; monto: number; descripcion: string }[]>([])
  const [ventaDeDevolucion, setVentaDeDevolucion] = useState<{ folio: string; voucher_id?: string } | null>(null)
  const [cargando, setCargando] = useState(true)
  const [devolviendo, setDevolviendo] = useState(false)
  const { can } = useAuth()
  const { online } = useSync()

  async function cargar() {
    if (!id) return
    const { data: v } = await supabase.from('vouchers').select('*').eq('id', id).single()
    setVoucher((v as VoucherT) ?? null)
    if (v?.tipo === 'venta') {
      const { data: ventaData } = await supabase.from('ventas').select('*').eq('id', v.referencia_id).single()
      setVenta((ventaData as Venta) ?? null)
      const { data: its } = await supabase.from('venta_items').select('*').eq('venta_id', v.referencia_id)
      setItems((its as VentaItem[]) ?? [])
      const { data: devs } = await supabase
        .from('devoluciones')
        .select('*')
        .eq('venta_id', v.referencia_id)
        .order('created_at')
      const lista = (devs as Devolucion[]) ?? []
      const { data: vs } = lista.length
        ? await supabase.from('vouchers').select('id, referencia_id').in('referencia_id', lista.map((d) => d.id))
        : { data: [] }
      setDevoluciones(lista.map((d) => ({ ...d, voucher_id: (vs ?? []).find((x) => x.referencia_id === d.id)?.id })))
    }
    if (v?.tipo === 'devolucion') {
      const { data: d } = await supabase.from('devoluciones').select('*').eq('id', v.referencia_id).single()
      setDevolucion((d as Devolucion) ?? null)
      const { data: di } = await supabase
        .from('devolucion_items')
        .select('cantidad, monto, venta_items(descripcion)')
        .eq('devolucion_id', v.referencia_id)
      setDevItems(
        ((di ?? []) as unknown as { cantidad: number; monto: number; venta_items: { descripcion: string } | null }[]).map((x) => ({
          cantidad: x.cantidad,
          monto: x.monto,
          descripcion: x.venta_items?.descripcion ?? 'Producto'
        }))
      )
      if (d) {
        const { data: ve } = await supabase.from('ventas').select('folio').eq('id', d.venta_id).single()
        const { data: vv } = await supabase.from('vouchers').select('id').eq('referencia_id', d.venta_id).eq('tipo', 'venta').maybeSingle()
        setVentaDeDevolucion(ve ? { folio: ve.folio, voucher_id: vv?.id } : null)
      }
    }
    setCargando(false)
  }

  useEffect(() => {
    void cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  if (cargando) return <LoadingState />
  if (!voucher) return <p className="text-sm text-fg-muted">Voucher no encontrado.</p>

  const d = voucher.detalle as {
    total?: number
    neto?: number
    iva?: number
    cantidad?: number
    medio_pago?: string
    referencia?: string
    propina?: number
    mesa?: string
  }
  const total = d.total ?? 0
  const desglose = desglosarIVA(total)

  return (
    <div className="mx-auto max-w-md">
      <Button variant="ghost" size="sm" className="mb-3" onClick={() => navigate(-1)}>
        <ArrowLeft size={16} /> Volver
      </Button>

      <Card>
        <CardBody className="space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs uppercase tracking-wider text-fg-faint">Comprobante interno</p>
              <h1 className="text-lg font-semibold text-fg">{voucher.numero}</h1>
            </div>
            <Badge tone={voucher.estado_sync === 'sincronizado' ? 'success' : 'warning'}>
              {voucher.estado_sync === 'sincronizado' ? (
                <>
                  <Check size={11} /> Sincronizado
                </>
              ) : (
                <>
                  <CloudOff size={11} /> Local
                </>
              )}
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-y-2 border-y border-border py-3 text-xs">
            <span className="text-fg-muted">Fecha y hora</span>
            <span className="text-right text-fg">{formatFechaHora(voucher.created_at)}</span>
            <span className="text-fg-muted">Tipo</span>
            <span className="text-right capitalize text-fg">{voucher.tipo}</span>
            {d.mesa && (
              <>
                <span className="text-fg-muted">Mesa</span>
                <span className="text-right text-fg">{d.mesa}</span>
              </>
            )}
          </div>

          {venta && venta.estado !== 'vigente' && (
            <div className="flex items-center justify-between rounded-xl bg-warning-soft px-3 py-2 text-xs text-warning">
              <span className="font-medium">{venta.estado === 'anulada' ? 'Venta anulada' : 'Venta con devolución parcial'}</span>
              <span className="tabular-nums">Devuelto {formatCLP(venta.monto_devuelto)}</span>
            </div>
          )}

          {venta && (
            <div className="space-y-2">
              {items.map((it) => (
                <div key={it.id} className="flex justify-between text-sm">
                  <span className="text-fg-body">
                    {it.cantidad} × {it.descripcion}
                    {it.cantidad_devuelta > 0 && (
                      <span className="ml-1 text-xs text-warning">({it.cantidad_devuelta} devuelta{it.cantidad_devuelta > 1 ? 's' : ''})</span>
                    )}
                  </span>
                  <span className="tabular-nums text-fg">{formatCLP(it.total_linea)}</span>
                </div>
              ))}
              <div className="mt-2 space-y-1 border-t border-border pt-2 text-sm">
                <div className="flex justify-between text-fg-muted">
                  <span>Neto</span>
                  <span className="tabular-nums">{formatCLP(desglose.neto)}</span>
                </div>
                <div className="flex justify-between text-fg-muted">
                  <span>IVA (19%)</span>
                  <span className="tabular-nums">{formatCLP(desglose.iva)}</span>
                </div>
                <div className="flex justify-between text-base font-semibold text-fg">
                  <span>Total</span>
                  <span className="tabular-nums text-accent">{formatCLP(total)}</span>
                </div>
                {(d.propina ?? 0) > 0 && (
                  <>
                    <div className="flex justify-between text-fg-muted">
                      <span>Propina (voluntaria)</span>
                      <span className="tabular-nums">{formatCLP(d.propina ?? 0)}</span>
                    </div>
                    <div className="flex justify-between font-medium text-fg">
                      <span>Total pagado</span>
                      <span className="tabular-nums">{formatCLP(total + (d.propina ?? 0))}</span>
                    </div>
                  </>
                )}
              </div>
              <div className="rounded-xl bg-surface p-3 text-xs">
                <div className="flex justify-between">
                  <span className="text-fg-muted">Medio de pago</span>
                  <span className="text-fg">{etiquetaMedio(venta.medio_pago)}</span>
                </div>
                {venta.referencia_pago && (
                  <div className="mt-1 flex justify-between">
                    <span className="text-fg-muted">Referencia</span>
                    <span className="text-fg">{venta.referencia_pago}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {devoluciones.length > 0 && (
            <div className="space-y-1.5 rounded-xl border border-border p-3 text-xs">
              <p className="font-medium text-fg">Devoluciones</p>
              {devoluciones.map((dv) => (
                <div key={dv.id} className="flex items-start justify-between gap-3">
                  <span className="text-fg-body">
                    {dv.voucher_id ? (
                      <Link to={`/voucher/${dv.voucher_id}`} className="font-medium text-accent hover:underline">{dv.folio}</Link>
                    ) : (
                      dv.folio
                    )}{' '}
                    · {formatFechaHora(dv.created_at)} · {dv.motivo}
                  </span>
                  <span className="shrink-0 tabular-nums text-fg">−{formatCLP(dv.total)}</span>
                </div>
              ))}
            </div>
          )}

          {devolucion && (
            <div className="space-y-2">
              <div className="rounded-xl bg-surface p-3 text-xs">
                <div className="flex justify-between">
                  <span className="text-fg-muted">{devolucion.tipo === 'anulacion' ? 'Anulación de' : 'Devolución de'}</span>
                  {ventaDeDevolucion?.voucher_id ? (
                    <Link to={`/voucher/${ventaDeDevolucion.voucher_id}`} className="font-medium text-accent hover:underline">
                      {ventaDeDevolucion.folio}
                    </Link>
                  ) : (
                    <span className="text-fg">{ventaDeDevolucion?.folio ?? '—'}</span>
                  )}
                </div>
                <div className="mt-1 flex justify-between gap-3">
                  <span className="text-fg-muted">Motivo</span>
                  <span className="text-right text-fg">{devolucion.motivo}</span>
                </div>
              </div>
              {devItems.map((it, n) => (
                <div key={n} className="flex justify-between text-sm">
                  <span className="text-fg-body">{it.cantidad} × {it.descripcion}</span>
                  <span className="tabular-nums text-fg">{formatCLP(it.monto)}</span>
                </div>
              ))}
              <div className="flex justify-between border-t border-border pt-2 text-base font-semibold text-fg">
                <span>Reembolsado</span>
                <span className="tabular-nums text-accent">{formatCLP(devolucion.total)}</span>
              </div>
            </div>
          )}

          {venta && venta.estado !== 'anulada' && can('ventas.devolver') && (
            <Button variant="secondary" block onClick={() => setDevolviendo(true)} disabled={!online}>
              <RotateCcw size={16} /> {online ? 'Devolver o anular' : 'Devolver o anular (requiere conexión)'}
            </Button>
          )}

          {!venta && !devolucion && typeof d.cantidad === 'number' && (
            <p className="text-sm text-fg-body">Cantidad: {d.cantidad} unidad(es)</p>
          )}

          <Button variant="secondary" block onClick={() => window.print()}>
            <Printer size={16} /> Imprimir
          </Button>
        </CardBody>
      </Card>

      {venta && (
        <ModalDevolucion
          venta={venta}
          items={items}
          abierto={devolviendo}
          onCerrar={() => setDevolviendo(false)}
          onListo={() => {
            setDevolviendo(false)
            void cargar()
          }}
        />
      )}
    </div>
  )
}
