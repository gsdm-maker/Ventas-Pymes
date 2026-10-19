import { IVA_TASA } from '@/lib/format'

/**
 * Precio de venta (con IVA) a partir del costo neto y el margen sobre el precio
 * neto: precio = costo / (1 − margen) × 1,19, redondeado a $10.
 */
export function precioDesdeMargen(costoNeto: number, margenPct: number): number {
  if (!costoNeto || margenPct >= 100) return 0
  const neto = costoNeto / (1 - margenPct / 100)
  return Math.round((neto * (1 + IVA_TASA)) / 10) * 10
}

/** Margen (% sobre el precio neto) de un precio con IVA; null si no se puede calcular. */
export function margenDesdePrecio(costoNeto: number, precioConIva: number): number | null {
  if (!costoNeto || !precioConIva) return null
  const neto = precioConIva / (1 + IVA_TASA)
  return Math.round(((neto - costoNeto) / neto) * 1000) / 10
}
