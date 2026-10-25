import { ArrowLeftRight, Banknote, CreditCard, type LucideIcon } from 'lucide-react'
import type { MedioPago } from '@/core/types'

/**
 * Medios de pago (patrón Strategy): cada medio declara cómo se comporta al cobrar y las
 * pantallas (POS, cobro de mesas, reportes, voucher) solo preguntan. Para agregar un medio
 * nuevo se suma aquí (y en el CHECK de ventas.medio_pago), sin tocar cada pantalla.
 */
export interface MedioPagoDef {
  key: MedioPago
  label: string
  icon: LucideIcon
  /** Exige número de operación (la base lo valida: venta_referencia_pago) */
  pideReferencia: boolean
  /** Texto del campo de referencia */
  refLabel: string
  /** Se recibe un monto y se calcula vuelto */
  daVuelto: boolean
}

export const MEDIOS_PAGO: MedioPagoDef[] = [
  { key: 'efectivo', label: 'Efectivo', icon: Banknote, pideReferencia: false, refLabel: '', daVuelto: true },
  { key: 'debito', label: 'Débito / crédito', icon: CreditCard, pideReferencia: true, refLabel: 'Número de voucher de venta', daVuelto: false },
  { key: 'transferencia', label: 'Transferencia', icon: ArrowLeftRight, pideReferencia: true, refLabel: 'Número de transferencia', daVuelto: false }
]

export const MEDIO_PAGO = Object.fromEntries(MEDIOS_PAGO.map((m) => [m.key, m])) as Record<MedioPago, MedioPagoDef>

export function etiquetaMedio(medio: string | null | undefined): string {
  return (medio && MEDIO_PAGO[medio as MedioPago]?.label) || medio || '—'
}

/** Referencia a enviar a la base: null si el medio no la usa. */
export function referenciaPara(medio: MedioPago, referencia: string): string | null {
  return MEDIO_PAGO[medio].pideReferencia ? referencia.trim() : null
}

export function referenciaCompleta(medio: MedioPago, referencia: string): boolean {
  return !MEDIO_PAGO[medio].pideReferencia || referencia.trim().length > 0
}

/** Montos para cobrar rápido en efectivo: el exacto y los billetes redondos que lo cubren. */
export function montosSugeridos(total: number, max = 4): number[] {
  return [...new Set([total, ...[1000, 2000, 5000, 10000, 20000].map((b) => Math.ceil(total / b) * b)])]
    .filter((n) => n >= total && n > 0)
    .slice(0, max)
}
