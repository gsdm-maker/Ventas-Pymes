import type { TicketVenta } from '@/lib/impresion'

/** Una línea del ticket en curso. */
export interface Linea {
  producto_id: string
  variante_id: string | null
  /** SKU de la variante o del producto */
  codigo: string
  descripcion: string
  precio_unitario: number
  cantidad: number
  /** Infinity si el producto no controla stock */
  disponible: number
}

export type VistaPos = 'lista' | 'botones'

/** Aviso de la última venta (la caja queda lista para la siguiente). */
export interface UltimaVenta {
  folio: string
  total: number
  offline: boolean
  ticket: TicketVenta
}
