import { useEffect, useState } from 'react'
import { AlertTriangle, Clock } from 'lucide-react'
import { useAuth } from '@/core/auth/AuthProvider'
import { estadoPlan, etiquetaPlan, resumenPlan } from '@/core/auth/plan'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'

const CLAVE = (empresaId: string) => `misociopyme:aviso-plan:${empresaId}`

function leerUltimoAviso(empresaId: string): number {
  try {
    return Number(localStorage.getItem(CLAVE(empresaId))) || 0
  } catch {
    return 0
  }
}

function guardarUltimoAviso(empresaId: string) {
  try {
    localStorage.setItem(CLAVE(empresaId), String(Date.now()))
  } catch {
    // Sin almacenamiento el aviso vuelve a salir al recargar: es aceptable
  }
}

/**
 * Alertas de vencimiento para el administrador de la empresa (no para el resto del equipo):
 * - Franja fija arriba de todas las pantallas mientras el plan está por vencer o en gracia.
 * - Aviso emergente cada `aviso_cada_horas` horas (24 = una vez al día), por equipo.
 * Los plazos los configura el administrador general en la ficha de la empresa.
 */
export function AvisoPlan() {
  const { empresa, profile } = useAuth()
  const [emergente, setEmergente] = useState(false)

  const esAdmin = !!profile && !profile.es_owner && profile.role === 'admin'
  const estado = estadoPlan(empresa)
  const alerta = esAdmin && !!empresa && (estado.fase === 'por_vencer' || estado.fase === 'gracia')

  useEffect(() => {
    if (!alerta || !empresa) return
    const cadaMs = (empresa.aviso_cada_horas ?? 24) * 3600000
    if (Date.now() - leerUltimoAviso(empresa.id) >= cadaMs) setEmergente(true)
  }, [alerta, empresa])

  if (!alerta || !empresa) return null

  const enGracia = estado.fase === 'gracia'
  const texto = resumenPlan(empresa, estado)
  const accion =
    empresa.plan === 'prueba'
      ? 'Contacta al administrador de la plataforma para elegir un plan.'
      : 'Realiza el pago y avísale al administrador de la plataforma para renovarlo.'

  function cerrar() {
    if (empresa) guardarUltimoAviso(empresa.id)
    setEmergente(false)
  }

  return (
    <>
      <div
        role="status"
        className={cn(
          'mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border px-4 py-2.5 text-sm',
          enGracia ? 'border-danger/40 bg-danger-soft text-danger' : 'border-warning/40 bg-warning-soft text-warning'
        )}
      >
        {enGracia ? <AlertTriangle size={16} aria-hidden /> : <Clock size={16} aria-hidden />}
        <span className="font-medium">
          Plan {etiquetaPlan(empresa.plan).toLowerCase()}: {texto}.
        </span>
        <span className="text-xs opacity-90">{accion}</span>
      </div>

      <Modal
        open={emergente}
        onClose={cerrar}
        size="sm"
        title={enGracia ? 'Tu plan está vencido' : 'Tu plan está por vencer'}
        footer={<Button onClick={cerrar}>Entendido</Button>}
      >
        <div className="space-y-2 text-sm text-fg-body">
          <p className="font-medium text-fg">
            Plan {etiquetaPlan(empresa.plan).toLowerCase()}: {texto}.
          </p>
          {enGracia && (
            <p>
              Estás usando los días de gracia. Cuando terminen, el equipo no podrá entrar al sistema
              (la información queda guardada).
            </p>
          )}
          <p>{accion}</p>
        </div>
      </Modal>
    </>
  )
}
