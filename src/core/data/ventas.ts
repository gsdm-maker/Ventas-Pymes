import { supabase } from '@/core/supabase/client'
import type { Devolucion, Venta, VentaItem, Voucher } from '@/core/types'
import { resultado, type Resultado } from '@/core/data/resultado'

/** Mismos argumentos que la cola offline (EJECUTORES en SyncProvider): un solo formato. */
export interface DatosVenta {
  ubicacion_id: string
  items: { producto_id: string; variante_id: string | null; descripcion?: string; cantidad: number; precio_unitario: number }[]
  descuento_tipo: 'porcentaje' | 'monto'
  descuento_valor: number
  medio_pago: string
  referencia: string | null
}

/** Registra una venta en línea. Si `deRed`, la pantalla la guarda en la cola offline (mismo uuid). */
export async function registrarVenta(v: DatosVenta, uuidLocal: string): Promise<Resultado<{ folio: string; total: number }>> {
  return resultado(
    await supabase.rpc('registrar_venta', {
      p_ubicacion: v.ubicacion_id,
      p_items: v.items,
      p_descuento_tipo: v.descuento_tipo,
      p_descuento_valor: v.descuento_valor,
      p_medio_pago: v.medio_pago,
      p_referencia: v.referencia,
      p_uuid_local: uuidLocal
    })
  )
}

export interface DatosSalida {
  producto_id: string
  variante_id: string | null
  ubicacion_id: string
  cantidad: number
  motivo_id: string | null
  observaciones: string | null
}

export async function registrarSalida(s: DatosSalida, uuidLocal: string): Promise<Resultado<{ numero: string; id: string }>> {
  return resultado(
    await supabase.rpc('registrar_salida', {
      p_producto: s.producto_id,
      p_variante: s.variante_id,
      p_ubicacion: s.ubicacion_id,
      p_cantidad: s.cantidad,
      p_motivo: s.motivo_id,
      p_observaciones: s.observaciones,
      p_uuid_local: uuidLocal
    })
  )
}

/** items null = anular todo lo que queda por devolver. */
export async function devolverVenta(
  ventaId: string,
  items: { venta_item_id: string; cantidad: number }[] | null,
  motivo: string
): Promise<Resultado<Devolucion>> {
  return resultado(await supabase.rpc('devolver_venta', { p_venta: ventaId, p_items: items, p_motivo: motivo }))
}

export async function voucherDeVenta(ventaId: string): Promise<string | null> {
  const { data } = await supabase.from('vouchers').select('id').eq('referencia_id', ventaId).eq('tipo', 'venta').maybeSingle()
  return data?.id ?? null
}

export interface DetalleVoucher {
  voucher: Voucher | null
  venta: Venta | null
  items: VentaItem[]
  devoluciones: (Devolucion & { voucher_id?: string })[]
  devolucion: Devolucion | null
  devItems: { cantidad: number; monto: number; descripcion: string }[]
  ventaDeDevolucion: { folio: string; voucher_id?: string } | null
}

/** Todo lo que muestra la pantalla de un comprobante (venta, devolución o salida). */
export async function detalleVoucher(id: string): Promise<DetalleVoucher> {
  const r: DetalleVoucher = { voucher: null, venta: null, items: [], devoluciones: [], devolucion: null, devItems: [], ventaDeDevolucion: null }
  const { data: v } = await supabase.from('vouchers').select('*').eq('id', id).single()
  r.voucher = (v as Voucher) ?? null
  if (v?.tipo === 'venta') {
    const [{ data: venta }, { data: its }, { data: devs }] = await Promise.all([
      supabase.from('ventas').select('*').eq('id', v.referencia_id).single(),
      supabase.from('venta_items').select('*').eq('venta_id', v.referencia_id),
      supabase.from('devoluciones').select('*').eq('venta_id', v.referencia_id).order('created_at')
    ])
    r.venta = (venta as Venta) ?? null
    r.items = (its as VentaItem[]) ?? []
    const lista = (devs as Devolucion[]) ?? []
    const { data: vs } = lista.length
      ? await supabase.from('vouchers').select('id, referencia_id').in('referencia_id', lista.map((d) => d.id))
      : { data: [] as { id: string; referencia_id: string }[] }
    r.devoluciones = lista.map((d) => ({ ...d, voucher_id: (vs ?? []).find((x) => x.referencia_id === d.id)?.id }))
  }
  if (v?.tipo === 'devolucion') {
    const [{ data: d }, { data: di }] = await Promise.all([
      supabase.from('devoluciones').select('*').eq('id', v.referencia_id).single(),
      supabase.from('devolucion_items').select('cantidad, monto, venta_items(descripcion)').eq('devolucion_id', v.referencia_id)
    ])
    r.devolucion = (d as Devolucion) ?? null
    r.devItems = ((di ?? []) as unknown as { cantidad: number; monto: number; venta_items: { descripcion: string } | null }[]).map((x) => ({
      cantidad: x.cantidad,
      monto: x.monto,
      descripcion: x.venta_items?.descripcion ?? 'Producto'
    }))
    if (d) {
      const [{ data: ve }, vv] = await Promise.all([
        supabase.from('ventas').select('folio').eq('id', d.venta_id).single(),
        voucherDeVenta(d.venta_id)
      ])
      r.ventaDeDevolucion = ve ? { folio: ve.folio, voucher_id: vv ?? undefined } : null
    }
  }
  return r
}

/** Nombres para reimprimir el ticket de una venta (tienda y cajero). */
export async function nombresParaTicket(ubicacionId: string, usuarioId: string) {
  const [{ data: ubi }, { data: cajero }] = await Promise.all([
    supabase.from('ubicaciones').select('nombre').eq('id', ubicacionId).maybeSingle(),
    supabase.from('profiles').select('nombre').eq('id', usuarioId).maybeSingle()
  ])
  return { ubicacion: ubi?.nombre ?? '', cajero: cajero?.nombre ?? '' }
}
