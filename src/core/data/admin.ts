import { supabase } from '@/core/supabase/client'
import type { Empresa, Profile, Ubicacion } from '@/core/types'
import { soloError } from '@/core/data/resultado'

/**
 * Llama a la Edge Function admin-users (crear empresas y cuentas, claves, planes…).
 * Devuelve el mensaje de error real de la función (no el genérico «non-2xx» del cliente).
 */
export async function adminUsers<T = Record<string, unknown>>(
  body: Record<string, unknown>
): Promise<{ data: T | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body })
  if (error) {
    let mensaje: string | null = null
    try {
      const cuerpo = await (error as { context?: Response }).context?.json()
      mensaje = cuerpo?.error ?? null
    } catch {
      mensaje = null
    }
    return { data: null, error: mensaje ?? error.message ?? 'Error' }
  }
  const r = data as (T & { error?: string }) | null
  if (r?.error) return { data: null, error: r.error }
  return { data: r, error: null }
}

/** Ficha de una empresa para la consola general. */
export async function detalleEmpresaAdmin(id: string) {
  const [{ data: empresa }, { data: usuarios }, { data: ubicaciones }] = await Promise.all([
    supabase.from('empresas').select('*').eq('id', id).single(),
    supabase.from('profiles').select('*').eq('empresa_id', id).order('nombre'),
    supabase.from('ubicaciones').select('*').eq('empresa_id', id).order('nombre')
  ])
  return {
    empresa: (empresa as Empresa) ?? null,
    usuarios: (usuarios as Profile[]) ?? [],
    ubicaciones: (ubicaciones as Ubicacion[]) ?? []
  }
}

export async function sembrarDemo(empresaId: string): Promise<string | null> {
  return soloError(await supabase.rpc('sembrar_demo', { p_empresa: empresaId }))
}


export interface FilaAuditoria {
  id: string
  accion: string
  detalle: Record<string, unknown> | null
  empresa_id: string | null
  created_at: string
}

/** Últimas acciones administrativas (solo el administrador general puede leerlas). */
export async function listarAuditoria(limite = 200): Promise<FilaAuditoria[]> {
  const { data } = await supabase
    .from('admin_auditoria')
    .select('id, accion, detalle, empresa_id, created_at')
    .order('created_at', { ascending: false })
    .limit(limite)
  return (data as FilaAuditoria[]) ?? []
}

export async function listarAdministradoresGenerales(): Promise<Profile[]> {
  const { data } = await supabase.from('profiles').select('*').eq('es_owner', true).order('nombre')
  return (data as Profile[]) ?? []
}

/** Puesto y permisos de un usuario (la base valida que no se otorgue lo que uno no tiene). */
export async function actualizarPerfilUsuario(
  userId: string,
  cambios: { puesto: string; permissions: Record<string, boolean> }
): Promise<string | null> {
  return soloError(await supabase.from('profiles').update(cambios).eq('id', userId))
}
