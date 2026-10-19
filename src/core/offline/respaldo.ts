import type { Session } from '@supabase/supabase-js'
import { CLAVE_SESION } from '@/core/supabase/client'
import { guardarCache, leerCache, listarCola } from '@/core/offline/db'
import { clave } from '@/lib/variantes'

/**
 * Sesión guardada en el dispositivo, aunque el token haya vencido.
 * Sin conexión no se puede renovar; basta para identificar al usuario y seguir
 * vendiendo con la copia local. Al volver la red, Supabase renueva el token.
 */
export function sesionGuardada(): Session | null {
  try {
    const raw = localStorage.getItem(CLAVE_SESION)
    if (!raw) return null
    const s = JSON.parse(raw) as Session | { currentSession?: Session }
    const sesion = 'user' in s ? (s as Session) : (s.currentSession ?? null)
    return sesion?.user?.id ? sesion : null
  } catch {
    return null
  }
}

export function usuarioLocal(): string | null {
  return sesionGuardada()?.user.id ?? null
}

/**
 * Carga con respaldo local por usuario: con conexión consulta y guarda una copia;
 * sin conexión (o si falla la red) devuelve la última copia guardada.
 * `cargar` debe lanzar error si la consulta falla, para no guardar datos vacíos.
 */
export async function conRespaldo<T>(clave: string, cargar: () => Promise<T>): Promise<T> {
  const uid = usuarioLocal()
  const k = uid ? `${uid}:${clave}` : null
  if (navigator.onLine || !k) {
    try {
      const v = await cargar()
      if (k) await guardarCache(k, v)
      return v
    } catch (e) {
      const copia = k ? await leerCache<T>(k) : null
      if (copia !== null) return copia
      throw e
    }
  }
  const copia = await leerCache<T>(k)
  if (copia !== null) return copia
  return cargar()
}

/** Unidades aún en la cola offline por producto y variante (clave «producto|variante»). */
export async function pendientesPorProducto(ubicacionId: string): Promise<Map<string, number>> {
  const uid = usuarioLocal()
  const m = new Map<string, number>()
  if (!uid) return m
  for (const op of await listarCola(uid)) {
    if (op.estado === 'rechazado' || op.payload.ubicacion_id !== ubicacionId) continue
    if (op.tipo === 'salida') {
      const k = clave(String(op.payload.producto_id), op.payload.variante_id as string | null)
      m.set(k, (m.get(k) ?? 0) + Number(op.payload.cantidad))
    } else {
      for (const it of (op.payload.items as { producto_id: string; variante_id?: string | null; cantidad: number }[]) ?? []) {
        const k = clave(it.producto_id, it.variante_id)
        m.set(k, (m.get(k) ?? 0) + Number(it.cantidad))
      }
    }
  }
  return m
}
