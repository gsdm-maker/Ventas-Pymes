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
  /** Stock en unidades base; Infinity si el producto no controla stock */
  disponible: number
  /** Caja/pack vendido (null o ausente = unidad suelta) */
  presentacion_id?: string | null
  /** Unidades base por cada unidad de la línea (1 = suelta) */
  factor?: number
}

export type VistaPos = 'lista' | 'botones'

/** Aviso de la última venta (la caja queda lista para la siguiente). */
export interface UltimaVenta {
  folio: string
  total: number
  offline: boolean
  ticket: TicketVenta
}
