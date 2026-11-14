import type { ProductoConStock, ProductoPresentacion } from '@/core/types'
import { clave } from '@/lib/variantes'

/**
 * Presentaciones (caja, pack): otra forma de vender o comprar un producto sin variantes.
 * El stock va siempre en unidades base; una línea de «2 × Caja x50» ocupa 100 unidades.
 */

/** Precio que sale cada unidad dentro de la presentación (redondeado a peso). */
export function precioPorUnidad(x: Pick<ProductoPresentacion, 'precio_venta' | 'factor'>): number {
  return Math.round(x.precio_venta / Math.max(1, x.factor))
}

/** Presentaciones que se pueden vender en el POS (no aplica a productos con tallas/colores). */
export function presentacionesVendibles(p: ProductoConStock): ProductoPresentacion[] {
  if (p.variantes?.length) return []
  return (p.presentaciones ?? []).filter((x) => x.activa && x.se_vende)
}

interface LineaConPresentacion {
  producto_id: string
  variante_id: string | null
  presentacion_id?: string | null
  factor?: number
  cantidad: number
}

/** Clave de una línea del ticket: producto + variante + presentación ('' = unidad suelta). */
export function claveLinea(l: LineaConPresentacion): string {
  return `${clave(l.producto_id, l.variante_id)}|${l.presentacion_id ?? ''}`
}

/** Unidades base que ocupa una línea (2 cajas de 50 = 100). */
export function unidadesDeLinea(l: Pick<LineaConPresentacion, 'cantidad' | 'factor'>): number {
  return l.cantidad * (l.factor ?? 1)
}

/** Unidades base del mismo producto/variante ya en el ticket, sin contar la línea `excluir`. */
export function unidadesEnTicket(
  lineas: LineaConPresentacion[],
  productoId: string,
  varianteId: string | null,
  excluir?: string
): number {
  let total = 0
  for (const l of lineas) {
    if (l.producto_id !== productoId || l.variante_id !== varianteId) continue
    if (excluir && claveLinea(l) === excluir) continue
    total += unidadesDeLinea(l)
  }
  return total
}

/** Producto y presentación por código de barras exacto de una caja/pack. */
export function buscarPresentacionPorCodigo(
  productos: ProductoConStock[],
  codigo: string
): { producto: ProductoConStock; presentacion: ProductoPresentacion } | null {
  const c = codigo.trim()
  if (!c) return null
  for (const p of productos) {
    const x = (p.presentaciones ?? []).find((y) => y.activa && y.codigo_barras === c)
    if (x) return { producto: p, presentacion: x }
  }
  return null
}
