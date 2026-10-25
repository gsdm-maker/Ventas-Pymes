import { esErrorDeRed } from '@/core/offline/errores'

/**
 * Resultado de una operación de datos (patrón Facade: las pantallas no ven a Supabase).
 * - error: mensaje listo para mostrar, o null si salió bien.
 * - codigo: código de Postgres (p. ej. '23505' = valor repetido) para casos especiales.
 * - deRed: se cortó la conexión o falló el servidor; la operación se puede reintentar (offline).
 */
export interface Resultado<T = null> {
  data: T | null
  error: string | null
  codigo?: string
  deRed: boolean
}

interface RespuestaSupabase {
  data: unknown
  error: { message: string; code?: string } | null
  status?: number
}

export function resultado<T = null>(r: RespuestaSupabase): Resultado<T> {
  return {
    data: (r.data as T) ?? null,
    error: r.error?.message ?? null,
    codigo: r.error?.code,
    deRed: esErrorDeRed(r.error, r.status)
  }
}

/** Solo el mensaje de error (para mutaciones donde no importa lo que vuelve). */
export function soloError(r: RespuestaSupabase): string | null {
  return r.error?.message ?? null
}
