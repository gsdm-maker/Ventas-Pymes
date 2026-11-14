import { ArrowUpRight } from 'lucide-react'
import { useAuth } from '@/core/auth/AuthProvider'
import { enlaceSubirPlan, etiquetaNivel, siguienteNivel } from '@/lib/niveles'
import { cn } from '@/lib/cn'

/**
 * Aviso de tope del plan con el botón «Subir de plan» (abre WhatsApp de ventas con el
 * mensaje escrito). Si el WhatsApp no está configurado, queda solo el texto.
 */
export function AvisoSubirPlan({
  mensaje,
  tono = 'warning',
  className
}: {
  mensaje: string
  tono?: 'warning' | 'info'
  className?: string
}) {
  const { empresa, can } = useAuth()
  // Solo quien administra la empresa ve el botón de contratar; el resto, a quién pedirlo
  const decide = can('config.gestionar')
  const nivel = empresa?.nivel ?? null
  const siguiente = siguienteNivel(nivel)
  const enlace = enlaceSubirPlan(
    empresa?.nombre ?? 'mi negocio',
    nivel ? etiquetaNivel(nivel) : null,
    siguiente ? etiquetaNivel(siguiente) : null
  )

  return (
    <div
      role="status"
      className={cn(
        'flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs',
        tono === 'warning' ? 'bg-warning-soft text-warning' : 'bg-info-soft text-info',
        className
      )}
    >
      <p className="min-w-0 flex-1">{mensaje}</p>
      {!decide ? (
        <span className="shrink-0 font-medium">Avísale al administrador de tu empresa.</span>
      ) : enlace ? (
        <a
          href={enlace}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg bg-accent px-2.5 font-medium text-on-accent hover:bg-accent-container"
        >
          {siguiente ? `Subir a ${etiquetaNivel(siguiente)}` : 'Subir de plan'} <ArrowUpRight size={13} aria-hidden />
        </a>
      ) : (
        <span className="shrink-0 font-medium">Escríbenos para subir de plan.</span>
      )}
    </div>
  )
}
