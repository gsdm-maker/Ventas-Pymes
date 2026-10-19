import { Navigate, Outlet } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth, useCapabilities } from '@/core/auth/AuthProvider'
import { AppShell } from '@/components/layout/AppShell'
import { pruebaVencida } from '@/core/auth/plan'
import type { Capability } from '@/core/auth/capabilities'
import { Button } from '@/components/ui/Button'
import { Loader2, ShieldAlert, Clock } from 'lucide-react'
import { diasRestantes } from '@/core/auth/plan'

function Pantalla({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-shell p-6">
      <div className="w-full max-w-md text-center">{children}</div>
    </div>
  )
}

function SinEmpresa() {
  const { cerrarSesion } = useAuth()
  return (
    <Pantalla>
      <ShieldAlert className="mx-auto mb-4 text-warning" size={40} />
      <h1 className="text-lg font-semibold text-fg">Cuenta sin empresa asignada</h1>
      <p className="mt-2 text-sm text-fg-muted">
        Un administrador general debe asignarte a una empresa antes de poder usar el sistema.
      </p>
      <Button className="mt-5" variant="secondary" onClick={() => void cerrarSesion()}>
        Cerrar sesión
      </Button>
    </Pantalla>
  )
}

function PruebaTerminada() {
  const { cerrarSesion } = useAuth()
  return (
    <Pantalla>
      <Clock className="mx-auto mb-4 text-danger" size={40} />
      <h1 className="text-lg font-semibold text-fg">Período de prueba finalizado</h1>
      <p className="mt-2 text-sm text-fg-muted">
        Tu información sigue guardada. Contacta al administrador de la plataforma para activar
        un plan.
      </p>
      <Button className="mt-5" variant="secondary" onClick={() => void cerrarSesion()}>
        Cerrar sesión
      </Button>
    </Pantalla>
  )
}

export function AuthGuard() {
  const { listo, session, profile, empresa } = useAuth()

  if (!listo) {
    return (
      <Pantalla>
        <Loader2 className="mx-auto animate-spin text-accent" size={32} />
        <p className="mt-3 text-sm text-fg-muted">Cargando Mi Socio Pyme…</p>
      </Pantalla>
    )
  }
  if (!session) return <Navigate to="/login" replace />
  if (profile?.must_change_password) return <Navigate to="/cambiar-clave" replace />
  if (profile && !profile.empresa_id && !profile.es_owner) return <SinEmpresa />
  if (!profile?.es_owner && pruebaVencida(empresa, false)) return <PruebaTerminada />

  return <AppShell />
}

export function ModuloGuard({
  cap,
  children
}: {
  cap?: Capability
  children: ReactNode
}) {
  const { can } = useCapabilities()
  if (!cap) return <>{children}</>
  if (!can(cap)) return <Navigate to="/" replace />
  return <>{children}</>
}

export function AvisoPrueba() {
  const { empresa, profile } = useAuth()
  if (!empresa || profile?.es_owner || empresa.plan !== 'prueba') return null
  const dias = diasRestantes(empresa)
  if (dias === null || dias > 7) return null
  return (
    <div className="mb-4 flex items-center gap-2 rounded-xl border border-warning/40 bg-warning-soft px-4 py-2.5 text-sm text-warning">
      <Clock size={16} />
      {dias <= 0
        ? 'El período de prueba vence hoy.'
        : `Quedan ${dias} día(s) de período de prueba.`}
    </div>
  )
}

export { Pantalla }
export const OutletPlaceholder = Outlet
