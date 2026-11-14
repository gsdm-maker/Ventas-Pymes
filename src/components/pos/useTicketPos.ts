import { useEffect, useRef, useState } from 'react'
import type { MedioPago, ProductoConStock, ProductoPresentacion } from '@/core/types'
import { useToast } from '@/components/ui/Toast'
import { claveLinea, unidadesEnTicket } from '@/lib/presentaciones'
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

  /**
   * Agrega al ticket. `presentacion` (caja, pack) cobra su precio y ocupa `factor` unidades del
   * stock; las unidades sueltas y las cajas del mismo producto comparten ese stock.
   */
  function agregarLinea(
    p: ProductoConStock,
    varianteId: string | null,
    stock: number,
    etiqueta: string,
    cantidad = 1,
    presentacion: ProductoPresentacion | null = null
  ) {
    // Sin control de stock (platos, servicios): siempre se puede vender
    const controla = p.controla_stock !== false
    const factor = presentacion?.factor ?? 1
    const nueva = {
      producto_id: p.id,
      variante_id: varianteId,
      presentacion_id: presentacion?.id ?? null,
      factor
    }
    setLineas((prev) => {
      const k = claveLinea({ ...nueva, cantidad })
      const ex = prev.find((l) => claveLinea(l) === k)
      const libres = stock - unidadesEnTicket(prev, p.id, varianteId)
      if (controla && cantidad * factor > libres) {
        const alcanza = Math.floor(Math.max(0, libres) / factor)
        toast(
          alcanza > 0
            ? presentacion ? `Solo alcanza para ${alcanza} × ${presentacion.nombre}` : `Solo quedan ${alcanza} u.`
            : presentacion && libres > 0 ? `Quedan ${libres} u.: no alcanza para una ${presentacion.nombre}` : 'Sin stock en esta ubicación',
          'warning'
        )
        return prev
      }
      if (ex) return prev.map((l) => (l === ex ? { ...l, cantidad: l.cantidad + cantidad } : l))
      const base = etiqueta ? `${p.nombre} · ${etiqueta}` : p.nombre
      return [
        ...prev,
        {
          ...nueva,
          codigo: presentacion?.codigo_barras || p.variantes?.find((v) => v.id === varianteId)?.sku || p.sku,
          descripcion: presentacion ? `${base} · ${presentacion.nombre}` : base,
          precio_unitario: presentacion?.precio_venta ?? p.precio_venta,
          cantidad,
          disponible: controla ? stock : Number.POSITIVE_INFINITY
        }
      ]
    })
  }

  function cambiarCantidad(k: string, delta: number) {
    setLineas((prev) =>
      prev
        .map((l) => {
          if (claveLinea(l) !== k) return l
          // Tope: el stock que dejan libre las demás líneas del mismo producto
          const libres = l.disponible - unidadesEnTicket(prev, l.producto_id, l.variante_id, k)
          return { ...l, cantidad: Math.min(l.cantidad + delta, Math.floor(libres / (l.factor ?? 1))) }
        })
        .filter((l) => l.cantidad > 0)
    )
  }

  function eliminarLinea(k: string) {
    setLineas((prev) => prev.filter((x) => claveLinea(x) !== k))
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
