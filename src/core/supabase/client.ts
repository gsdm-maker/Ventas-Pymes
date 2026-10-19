import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseConfigurado = Boolean(url && anonKey && url.startsWith('http'))

// Misma clave que Supabase usa por defecto (sb-<proyecto>-auth-token); explícita para
// poder leer la sesión guardada sin conexión.
export const CLAVE_SESION = `sb-${supabaseConfigurado ? new URL(url).hostname.split('.')[0] : 'local'}-auth-token`

/**
 * Cliente sin genéricos: las consultas se tipan con las interfaces de dominio
 * en `src/core/types.ts`. El aislamiento real vive en RLS (Postgres).
 */
export const supabase = createClient(
  supabaseConfigurado ? url : 'http://localhost:54321',
  supabaseConfigurado ? anonKey : 'anon-key-missing',
  {
    auth: {
      persistSession: true,
      storageKey: CLAVE_SESION,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }
)
