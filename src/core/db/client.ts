import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_PG_URL
const key = import.meta.env.VITE_PG_KEY

export const dbConfigurado = Boolean(url && key && url.startsWith('http'))

// Clave explícita para poder leer la sesión guardada sin conexión.
export const CLAVE_SESION = `pg-${dbConfigurado ? new URL(url).hostname.split('.')[0] : 'local'}-auth-token`

/**
 * Cliente HTTP hacia PostgreSQL (PostgREST + auth propio).
 * Las consultas se tipan con las interfaces de dominio
 * en `src/core/types.ts`. El aislamiento real vive en RLS (PostgreSQL).
 */
export const db = createClient(
  dbConfigurado ? url : 'http://localhost:54321',
  dbConfigurado ? key : 'anon-key-missing',
  {
    auth: {
      persistSession: true,
      storageKey: CLAVE_SESION,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }
)
