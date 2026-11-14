import type { Empresa, Nivel, NivelPlanConfig, UsoRecurso } from '@/core/types'

/**
 * Niveles del plan (migración 0027). La base exige los topes con triggers; aquí solo
 * se calcula lo que se muestra: medidores, avisos y el enlace para subir de plan.
 */

export const NIVEL_LABEL: Record<Nivel, string> = {
  s: 'Socio',
  m: 'Socio Pro',
  l: 'Socio Pro Max',
  medida: 'A medida'
}

export function etiquetaNivel(nivel: string | null | undefined): string {
  return nivel && nivel in NIVEL_LABEL ? NIVEL_LABEL[nivel as Nivel] : 'Sin plan'
}

/** Desde qué fracción del tope se avisa que se está por llegar. */
export const AVISO_TOPE = 0.9

export type EstadoTope = 'libre' | 'cerca' | 'lleno'

export function estadoTope(uso: UsoRecurso | null | undefined): EstadoTope {
  if (!uso || uso.tope === null) return 'libre'
  if (uso.usados >= uso.tope) return 'lleno'
  return uso.usados >= Math.ceil(uso.tope * AVISO_TOPE) ? 'cerca' : 'libre'
}

/** Porcentaje usado (0–100) para la barra; null si no hay tope. */
export function porcentajeTope(uso: UsoRecurso | null | undefined): number | null {
  if (!uso || uso.tope === null || uso.tope <= 0) return null
  return Math.min(100, Math.round((uso.usados / uso.tope) * 100))
}

/** El recurso de un error de tope de la base («tope_plan:productos») o null si no lo es. */
export function recursoDeTope(error: { hint?: string | null } | null | undefined): string | null {
  const hint = error?.hint ?? ''
  return hint.startsWith('tope_plan:') ? hint.slice('tope_plan:'.length) : null
}

/** Enlace de WhatsApp de ventas con el mensaje escrito; null si no está configurado. */
export function enlaceSubirPlan(empresa: string, nivelActual: string | null, siguiente?: string | null): string | null {
  const numero = String(import.meta.env.VITE_WHATSAPP_VENTAS ?? '').replace(/\D/g, '')
  if (!numero) return null
  const destino = siguiente ? ` a ${siguiente}` : ''
  const desde = nivelActual ? ` (hoy tengo ${nivelActual})` : ''
  const texto = `Hola, quiero subir de plan${destino} para ${empresa}${desde}.`
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`
}

/** Nivel inmediatamente superior (para el botón de subir); null si ya es el máximo o a medida. */
export function siguienteNivel(nivel: string | null | undefined): Nivel | null {
  return nivel === 's' ? 'm' : nivel === 'm' ? 'l' : null
}

export interface TopesEmpresa {
  productos: number | null
  ubicaciones: number | null
  usuarios: number | null
}

/**
 * Topes vigentes de una empresa (espejo de _topes_empresa en la base): «medida» usa los suyos,
 * un nivel estándar los del catálogo y sin nivel no hay topes.
 */
export function topesDe(empresa: Pick<Empresa, 'nivel' | 'max_productos' | 'max_ubicaciones' | 'max_usuarios'>, catalogo: NivelPlanConfig[]): TopesEmpresa {
  if (empresa.nivel === 'medida') {
    return {
      productos: empresa.max_productos ?? null,
      ubicaciones: empresa.max_ubicaciones ?? null,
      usuarios: empresa.max_usuarios ?? null
    }
  }
  const n = catalogo.find((x) => x.nivel === empresa.nivel)
  return {
    productos: n?.max_productos ?? null,
    ubicaciones: n?.max_ubicaciones ?? null,
    usuarios: n?.max_usuarios ?? null
  }
}

/** Orden para listar y filtrar por plan; «sin» = empresas sin nivel asignado. */
export const FILTROS_NIVEL = ['s', 'm', 'l', 'medida', 'sin'] as const
export type FiltroNivel = (typeof FILTROS_NIVEL)[number]

export function claveNivel(nivel: string | null | undefined): FiltroNivel {
  return nivel === 's' || nivel === 'm' || nivel === 'l' || nivel === 'medida' ? nivel : 'sin'
}

export const FILTRO_NIVEL_LABEL: Record<FiltroNivel, string> = { ...NIVEL_LABEL, sin: 'Sin plan' }
