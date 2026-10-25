import { supabase } from '@/core/supabase/client'
import type { ParametrosReposicion, TipoUbicacion } from '@/core/types'
import { soloError } from '@/core/data/resultado'

export type TablaCatalogo = 'categorias' | 'motivos_salida' | 'proveedores'

export async function agregarACatalogo(tabla: TablaCatalogo, fila: Record<string, unknown>): Promise<string | null> {
  return soloError(await supabase.from(tabla).insert(fila))
}

export async function eliminarDeCatalogo(tabla: TablaCatalogo, id: string): Promise<string | null> {
  return soloError(await supabase.from(tabla).delete().eq('id', id))
}

export async function crearUbicacion(empresaId: string, nombre: string, tipo: TipoUbicacion): Promise<string | null> {
  return soloError(await supabase.from('ubicaciones').insert({ empresa_id: empresaId, nombre, tipo }))
}

/** Si RLS no deja actualizar, Postgres no avisa: se detecta porque no vuelve ninguna fila. */
export async function renombrarUbicacion(id: string, nombre: string): Promise<string | null> {
  const { data, error } = await supabase.from('ubicaciones').update({ nombre }).eq('id', id).select('id')
  if (error) return error.message
  if (!data?.length) return 'No tienes permiso para renombrar esta ubicación'
  return null
}

export async function cambiarActivaUbicacion(id: string, activa: boolean): Promise<string | null> {
  return soloError(await supabase.from('ubicaciones').update({ activa }).eq('id', id))
}

export async function guardarParametrosReposicion(empresaId: string, p: ParametrosReposicion): Promise<string | null> {
  return soloError(await supabase.from('empresas').update({ reposicion: p }).eq('id', empresaId))
}

export async function actualizarEmpresa(
  empresaId: string,
  cambios: { nombre: string; moneda: string; usa_variantes: boolean }
): Promise<string | null> {
  return soloError(await supabase.from('empresas').update(cambios).eq('id', empresaId))
}
