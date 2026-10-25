import { useEffect, useRef, useState } from 'react'
import type { MedioPago, ProductoConStock } from '@/core/types'
import { useToast } from '@/components/ui/Toast'
import { clave } from '@/lib/variantes'
import { desglosarIVA } from '@/lib/format'
import { MEDIO_PAGO, referenciaCompleta } from '@/lib/mediosPago'
import type { Linea } from '@/components/pos/tipos'

export type TipoDescuento = 'porcentaje' | 'monto'

/**
 * Estado del ticket en curso del POS: líneas, descuento, medio de pago y totales.
 * El ticket sobrevive a una recarga: queda en el dispositivo por usuario y tienda (`claveTicket`)
 * y se borra al cobrar o al vaciarlo.
 */
export function useTicketPos(claveTicket: string | null) {
  const toast = useToast()
  const [lineas, setLineas] = useState<Linea[]>([])
  const [descuentoTipo, setDescuentoTipo] = useState<TipoDescuento>('porcentaje')
  const [descuentoValor, setDescuentoValor] = useState(0)
  const [medio, setMedio] = useState<MedioPago>('efectivo')
  const [referencia, setReferencia] = useState('')
  const [recibido, setRecibido] = useState(0)

  const recienRestaurado = useRef(false)
  useEffect(() => {
    if (!claveTicket) return
    let guardado: Linea[] = []
    try {
      guardado = JSON.parse(localStorage.getItem(claveTicket) ?? '[]') as Linea[]
    } catch {
      guardado = []
    }
    // El guardado de este mismo render llevaría el ticket de la tienda anterior: se omite
    recienRestaurado.current = true
    // JSON guarda Infinity (productos sin control de stock) como null
    setLineas(Array.isArray(guardado) ? guardado.map((l) => ({ ...l, disponible: l.disponible ?? Number.POSITIVE_INFINITY })) : [])
  }, [claveTicket])
  useEffect(() => {
    if (!claveTicket) return
    if (recienRestaurado.current) {
      recienRestaurado.current = false
      return
    }
    try {
      if (lineas.length) localStorage.setItem(claveTicket, JSON.stringify(lineas))
      else localStorage.removeItem(claveTicket)
    } catch {
      // Sin almacenamiento (modo privado): el ticket solo vive en memoria
    }
  }, [lineas, claveTicket])

  function agregarLinea(p: ProductoConStock, varianteId: string | null, stock: number, etiqueta: string, cantidad = 1) {
    // Sin control de stock (platos, servicios): siempre se puede vender
    const controla = p.controla_stock !== false
    setLineas((prev) => {
      const ex = prev.find((l) => l.producto_id === p.id && l.variante_id === varianteId)
      const yaEnTicket = ex?.cantidad ?? 0
      if (controla && yaEnTicket + cantidad > stock) {
        toast(stock - yaEnTicket > 0 ? `Solo quedan ${stock - yaEnTicket} u.` : 'Sin stock en esta ubicación', 'warning')
        return prev
      }
      if (ex) return prev.map((l) => (l === ex ? { ...l, cantidad: l.cantidad + cantidad } : l))
      return [
        ...prev,
        {
          producto_id: p.id,
          variante_id: varianteId,
          codigo: p.variantes?.find((v) => v.id === varianteId)?.sku ?? p.sku,
          descripcion: etiqueta ? `${p.nombre} · ${etiqueta}` : p.nombre,
          precio_unitario: p.precio_venta,
          cantidad,
          disponible: controla ? stock : Number.POSITIVE_INFINITY
        }
      ]
    })
  }

  function cambiarCantidad(claveLinea: string, delta: number) {
    setLineas((prev) =>
      prev
        .map((l) => (clave(l.producto_id, l.variante_id) === claveLinea ? { ...l, cantidad: Math.min(l.cantidad + delta, l.disponible) } : l))
        .filter((l) => l.cantidad > 0)
    )
  }

  function eliminarLinea(claveLinea: string) {
    setLineas((prev) => prev.filter((x) => clave(x.producto_id, x.variante_id) !== claveLinea))
  }

  /** Deja la caja lista para la siguiente venta (conserva el medio de pago elegido). */
  function limpiar() {
    setLineas([])
    setDescuentoValor(0)
    setReferencia('')
    setRecibido(0)
  }

  const bruto = lineas.reduce((a, l) => a + l.precio_unitario * l.cantidad, 0)
  const descMonto =
    descuentoTipo === 'porcentaje'
      ? Math.round((bruto * Math.min(Math.max(descuentoValor, 0), 100)) / 100)
      : Math.min(Math.max(descuentoValor, 0), bruto)
  const total = bruto - descMonto
  const { neto, iva } = desglosarIVA(total)
  // Efectivo: si se ingresó con cuánto paga, debe alcanzar. Una venta en $0 no se cobra.
  const faltaEfectivo = MEDIO_PAGO[medio].daVuelto && recibido > 0 && recibido < total
  const listoParaCobrar = lineas.length > 0 && total > 0 && !faltaEfectivo && referenciaCompleta(medio, referencia)

  return {
    lineas,
    agregarLinea,
    cambiarCantidad,
    eliminarLinea,
    limpiar,
    descuentoTipo,
    setDescuentoTipo,
    descuentoValor,
    setDescuentoValor,
    medio,
    setMedio,
    referencia,
    setReferencia,
    recibido,
    setRecibido,
    bruto,
    descMonto,
    total,
    neto,
    iva,
    listoParaCobrar
  }
}

export type TicketPos = ReturnType<typeof useTicketPos>
