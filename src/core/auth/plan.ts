import type { Empresa } from '@/core/types'

export const DIAS_PRUEBA_DEFAULT = 15

export function diasRestantes(empresa: Empresa | null): number | null {
  if (!empresa?.prueba_hasta || empresa.plan !== 'prueba') return null
  return Math.ceil((new Date(empresa.prueba_hasta).getTime() - Date.now()) / 86400000)
}

export function pruebaVencida(empresa: Empresa | null, esOwner: boolean): boolean {
  if (esOwner || !empresa) return false
  if (empresa.plan !== 'prueba' || !empresa.prueba_hasta) return false
  return new Date(empresa.prueba_hasta).getTime() < Date.now()
}

export const PLAN_LABEL: Record<Empresa['plan'], string> = {
  prueba: 'Prueba',
  gratis: 'Gratis',
  pago: 'Pago'
}
