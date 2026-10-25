import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { CLAVE_SESION, supabase, supabaseConfigurado } from '@/core/supabase/client'
import type { Empresa, Profile, Ubicacion } from '@/core/types'
import { guardarCache, leerCache } from '@/core/offline/db'
import { sesionGuardada } from '@/core/offline/respaldo'

interface DatosAuth {
  perfil: Profile | null
  empresa: Empresa | null
  ubicaciones: Ubicacion[]
}
import {
  evaluarCapacidad,
  type Capability,
  type Modulo
} from '@/core/auth/capabilities'

interface AuthCtx {
  listo: boolean
  session: Session | null
  profile: Profile | null
  empresa: Empresa | null
  ubicaciones: Ubicacion[]
  iniciarSesion: (email: string, password: string) => Promise<void>
  cerrarSesion: () => Promise<void>
  refrescar: () => Promise<void>
  cambiarClave: (nueva: string) => Promise<void>
  can: (cap: Capability) => boolean
  ubicacionActiva: string | null
  setUbicacionActiva: (id: string) => void
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [listo, setListo] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [empresa, setEmpresa] = useState<Empresa | null>(null)
  const [ubicaciones, setUbicaciones] = useState<Ubicacion[]>([])
  const [ubicacionActiva, setUbicacionActivaState] = useState<string | null>(null)

  const saliendo = useRef(false)

  const cargarDatos = useCallback(async (userId: string) => {
    const clave = `${userId}:auth`
    let datos: DatosAuth | null
    try {
      // Sin red ni se intenta: Supabase esperaría renovar el token antes de fallar
      if (!navigator.onLine) throw new Error('sin conexión')
      // Un solo viaje: el perfil trae su empresa y las ubicaciones se piden a la vez
      const [{ data: fila, error }, { data: ubis, error: e2 }] = await Promise.all([
        supabase.from('profiles').select('*, empresa:empresas(*)').eq('id', userId).single(),
        supabase.from('ubicaciones').select('*').eq('activa', true).order('tipo').order('nombre')
      ])
      if (error) throw error

      // Cuenta desactivada: se corta la sesión de inmediato.
      if (fila && !fila.activo) {
        await supabase.auth.signOut()
        setProfile(null)
        setEmpresa(null)
        setUbicaciones([])
        return
      }

      const { empresa: emp, ...perfil } = (fila ?? {}) as Profile & { empresa: Empresa | null }
      datos = { perfil: fila ? (perfil as Profile) : null, empresa: null, ubicaciones: [] }
      if (perfil.empresa_id) {
        if (e2) throw e2
        datos.empresa = emp ?? null
        datos.ubicaciones = (ubis as Ubicacion[]) ?? []
      }
      await guardarCache(clave, datos)
    } catch {
      // Sin conexión: la última copia de este usuario en el dispositivo
      datos = await leerCache<DatosAuth>(clave)
      if (!datos) return
    }
    setProfile(datos.perfil)
    setEmpresa(datos.empresa)
    setUbicaciones(datos.ubicaciones)
  }, [])

  useEffect(() => {
    if (!supabaseConfigurado) {
      setListo(true)
      return
    }
    let activo = true
    const iniciar = async () => {
      // Sin conexión no se espera a Supabase (getSession reintenta renovar el token y
      // tarda en fallar): se usa la sesión guardada para poder vender; al volver la
      // red, Supabase la renueva sola y avisa por onAuthStateChange.
      const { data } = navigator.onLine
        ? await supabase.auth.getSession()
        : { data: { session: sesionGuardada() } }
      if (!activo) return
      setSession(data.session)
      if (data.session?.user) await cargarDatos(data.session.user.id)
      setListo(true)
    }
    void iniciar()
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, s) => {
      // Un fallo de renovación sin conexión no debe sacar al cajero del POS
      if (!s && !navigator.onLine && !saliendo.current && sesionGuardada()) return
      saliendo.current = false
      setSession(s)
      if (s?.user) await cargarDatos(s.user.id)
      else {
        setProfile(null)
        setEmpresa(null)
        setUbicaciones([])
      }
    })
    return () => {
      activo = false
      sub.subscription.unsubscribe()
    }
  }, [cargarDatos])

  const iniciarSesion = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw new Error('Correo o contraseña incorrectos')
    // Verifica el estado real de la cuenta recién autenticada.
    if (data.user) {
      const { data: perfil } = await supabase
        .from('profiles')
        .select('activo')
        .eq('id', data.user.id)
        .single()
      if (perfil && !perfil.activo) {
        await supabase.auth.signOut()
        throw new Error('Tu cuenta está desactivada')
      }
    }
  }, [])

  const cerrarSesion = useCallback(async () => {
    saliendo.current = true
    // Sin red, signOut intenta renovar el token, falla y deja la sesión guardada: al recargar
    // volvería a entrar el mismo usuario. Se borra a mano en ese caso.
    const { error } = navigator.onLine ? await supabase.auth.signOut() : { error: true }
    if (error) localStorage.removeItem(CLAVE_SESION)
    setSession(null)
    setProfile(null)
    setEmpresa(null)
    setUbicaciones([])
  }, [])

  const refrescar = useCallback(async () => {
    const { data } = await supabase.auth.getUser()
    if (data.user) await cargarDatos(data.user.id)
  }, [cargarDatos])

  const cambiarClave = useCallback(async (nueva: string) => {
    // También se limpia la marca de los metadatos de la cuenta (la que viaja en el token):
    // la obligación real la controla profiles.must_change_password
    const { error } = await supabase.auth.updateUser({ password: nueva, data: { must_change_password: false } })
    if (error) throw new Error(error.message)
    const { data } = await supabase.auth.getUser()
    if (data.user) {
      await supabase
        .from('profiles')
        .update({ must_change_password: false })
        .eq('id', data.user.id)
    }
    await refrescar()
  }, [refrescar])

  const setUbicacionActiva = useCallback((id: string) => {
    setUbicacionActivaState(id)
    localStorage.setItem('misociopyme:ubicacion', id)
  }, [])

  useEffect(() => {
    if (!ubicacionActiva && ubicaciones.length) {
      const guardada = localStorage.getItem('misociopyme:ubicacion')
      const valida = ubicaciones.find((u) => u.id === guardada)
      setUbicacionActivaState(valida ? valida.id : ubicaciones[0].id)
    }
    if (ubicacionActiva && !ubicaciones.find((u) => u.id === ubicacionActiva)) {
      setUbicacionActivaState(ubicaciones[0]?.id ?? null)
    }
  }, [ubicaciones, ubicacionActiva])

  const can = useCallback(
    (cap: Capability) => {
      if (!profile) return false
      const modulos = (empresa?.modulos ?? []) as Modulo[]
      return evaluarCapacidad(cap, {
        esOwner: profile.es_owner,
        role: profile.role,
        puesto: profile.puesto,
        modulosHabilitados: modulos,
        overrides: profile.permissions ?? {}
      })
    },
    [profile, empresa]
  )

  const value = useMemo<AuthCtx>(
    () => ({
      listo,
      session,
      profile,
      empresa,
      ubicaciones,
      iniciarSesion,
      cerrarSesion,
      refrescar,
      cambiarClave,
      can,
      ubicacionActiva,
      setUbicacionActiva
    }),
    [
      listo,
      session,
      profile,
      empresa,
      ubicaciones,
      iniciarSesion,
      cerrarSesion,
      refrescar,
      cambiarClave,
      can,
      ubicacionActiva,
      setUbicacionActiva
    ]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return ctx
}

export function useCapabilities() {
  const { can } = useAuth()
  return { can }
}
