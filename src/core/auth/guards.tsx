import { Navigate, Outlet } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth, useCapabilities } from '@/core/auth/AuthProvider'
import { AppShell } from '@/components/layout/AppShell'
import { estadoPlan, planBloqueado, etiquetaPlan } from '@/core/auth/plan'
import type { Capability } from '@/core/auth/capabilities'
import { Button } from '@/components/ui/Button'
import { Loader2, ShieldAlert, Clock } from 'lucide-react'

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

function PlanBloqueado() {
  const { cerrarSesion, empresa } = useAuth()
  const esPrueba = empresa?.plan === 'prueba'
  const { vence } = estadoPlan(empresa)
  return (
    <Pantalla>
      <Clock className="mx-auto mb-4 text-danger" size={40} />
      <h1 className="text-lg font-semibold text-fg">
        {esPrueba ? 'Período de prueba finalizado' : 'Suscripción vencida'}
      </h1>
      <p className="mt-2 text-sm text-fg-muted">
        {esPrueba
          ? 'Tu información sigue guardada. Contacta al administrador de la plataforma para activar un plan.'
          : `El plan ${etiquetaPlan(empresa?.plan ?? 'mensual').toLowerCase()} venció${
              vence ? ` el ${vence.toLocaleDateString('es-CL')}` : ''
            } y terminaron los días de gracia. Tu información sigue guardada: al registrar el pago se reactiva al tiro.`}
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
  if (planBloqueado(empresa, !!profile?.es_owner)) return <PlanBloqueado />

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

export { Pantalla }
export const OutletPlaceholder = Outlet
