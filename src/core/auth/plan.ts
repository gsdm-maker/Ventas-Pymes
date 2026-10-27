import type { Empresa, Plan } from '@/core/types'

/**
 * Planes de suscripción (migración 0025). Espejo de _plan_vigente() en la base y de
 * planVigente() en la Edge Function admin-users: la base es la que bloquea de verdad;
 * aquí se calcula lo mismo para mostrar avisos y la pantalla de bloqueo.
 */

export const DIAS_PRUEBA_DEFAULT = 15
const DIA = 86400000

export const PLAN_LABEL: Record<Plan, string> = {
  prueba: 'Prueba',
  mensual: 'Mensual',
  anual: 'Anual',
  dueno: 'Dueño'
}

export const PLAN_DESCRIPCION: Record<Plan, string> = {
  prueba: 'Días de uso gratis para conocer el sistema. Al terminar se bloquea.',
  mensual: 'Membresía de 30 días contados desde la fecha de alta. Se renueva registrando el pago.',
  anual: 'Pago único por un año desde la fecha de alta. Se renueva registrando el pago.',
  dueno: 'Pago único: usa el sistema sin membresía ni vencimiento.'
}

export const PLAN_TONO: Record<Plan, 'warning' | 'success' | 'info' | 'accent'> = {
  prueba: 'warning',
  mensual: 'success',
  anual: 'info',
  dueno: 'accent'
}

/**
 * - sin_vencimiento: dueño (o prueba sin fecha)
 * - vigente: falta más que `aviso_dias_antes` para vencer
 * - por_vencer: dentro del período de aviso
 * - gracia: venció, pero quedan días antes del bloqueo (solo mensual y anual)
 * - bloqueado: ya no se puede usar
 */
export type FasePlan = 'sin_vencimiento' | 'vigente' | 'por_vencer' | 'gracia' | 'bloqueado'

export interface EstadoPlan {
  fase: FasePlan
  /** Fin del período (prueba o pagado) */
  vence: Date | null
  /** Momento en que se bloquea (vence + días de gracia) */
  bloqueo: Date | null
  /** Días enteros que faltan para vencer (por_vencer/vigente) o para el bloqueo (gracia) */
  dias: number | null
}

type DatosPlan = Pick<Empresa, 'plan' | 'prueba_hasta' | 'plan_vence' | 'dias_gracia' | 'aviso_dias_antes'>

export function estadoPlan(empresa: DatosPlan | null, ahora = Date.now()): EstadoPlan {
  const sinVencer: EstadoPlan = { fase: 'sin_vencimiento', vence: null, bloqueo: null, dias: null }
  if (!empresa || empresa.plan === 'dueno') return sinVencer
  // Plan desconocido (p. ej. datos previos a la migración 0025): la base decide, aquí no se bloquea
  if (!['prueba', 'mensual', 'anual'].includes(empresa.plan)) return sinVencer

  const fecha = empresa.plan === 'prueba' ? empresa.prueba_hasta : empresa.plan_vence
  if (!fecha) {
    // Mensual/anual sin vencimiento no debería existir (la base lo impide): se trata como vencido
    return empresa.plan === 'prueba' ? sinVencer : { fase: 'bloqueado', vence: null, bloqueo: null, dias: null }
  }
  const vence = new Date(fecha)
  const gracia = empresa.plan === 'prueba' ? 0 : (empresa.dias_gracia ?? 0)
  const bloqueo = new Date(vence.getTime() + gracia * DIA)

  if (ahora >= bloqueo.getTime()) return { fase: 'bloqueado', vence, bloqueo, dias: 0 }
  if (ahora >= vence.getTime()) {
    return { fase: 'gracia', vence, bloqueo, dias: Math.ceil((bloqueo.getTime() - ahora) / DIA) }
  }
  const dias = Math.ceil((vence.getTime() - ahora) / DIA)
  const aviso = empresa.aviso_dias_antes ?? 7
  return { fase: dias <= aviso ? 'por_vencer' : 'vigente', vence, bloqueo, dias }
}

export function planBloqueado(empresa: DatosPlan | null, esOwner: boolean): boolean {
  if (esOwner || !empresa) return false
  return estadoPlan(empresa).fase === 'bloqueado'
}

/** Frase corta del estado, para listas y avisos. */
export function resumenPlan(empresa: DatosPlan, estado = estadoPlan(empresa)): string {
  const fecha = (d: Date | null) =>
    d ? d.toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
  const nombre = empresa.plan === 'prueba' ? 'La prueba' : 'El plan'
  switch (estado.fase) {
    case 'sin_vencimiento':
      return empresa.plan === 'dueno' ? 'Pago único, sin vencimiento' : 'Sin vencimiento'
    case 'vigente':
      return `Vence el ${fecha(estado.vence)}`
    case 'por_vencer':
      return estado.dias === 1 ? `${nombre} vence mañana` : `${nombre} vence en ${estado.dias} días (${fecha(estado.vence)})`
    case 'gracia':
      return `Venció el ${fecha(estado.vence)} · se bloquea en ${estado.dias} día(s)`
    case 'bloqueado':
      return empresa.plan === 'prueba' ? `Prueba terminada el ${fecha(estado.vence)}` : `Bloqueado desde el ${fecha(estado.bloqueo)}`
  }
}

/** Nombre del plan; tolera valores previos a la migración 0025 (p. ej. «gratis»). */
export function etiquetaPlan(plan: string | null | undefined): string {
  return (plan && PLAN_LABEL[plan as Plan]) || plan || '—'
}

export function tonoPlan(plan: string | null | undefined): (typeof PLAN_TONO)[Plan] | 'neutral' {
  return (plan && PLAN_TONO[plan as Plan]) || 'neutral'
}
