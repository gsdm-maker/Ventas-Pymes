import { Users as UsersIcon } from 'lucide-react'
import type { Puesto } from '@/core/types'
import {
  CAPABILITY_LABELS,
  ROLE_DEFAULTS,
  moduloDe,
  type Capability
} from '@/core/auth/capabilities'
import { Badge } from '@/components/ui/Badge'

interface Props {
  role: 'admin' | 'integrante'
  puesto: Puesto
  /** Ajustes del usuario sobre los defaults del puesto (suman o revocan). */
  permisos: Record<string, boolean>
  onChange: (permisos: Record<string, boolean>) => void
  /** Módulos que el administrador general habilitó para la empresa. */
  modulosEmpresa: string[]
  /** Si quien edita puede otorgar la capacidad (nadie da lo que no tiene). */
  puedeOtorgar: (cap: Capability) => boolean
}

/**
 * Permisos de un usuario: parten marcados según el puesto y cada cambio queda como ajuste.
 * Solo se ofrecen los módulos habilitados para la empresa y las acciones de esos módulos.
 */
export function EditorPermisos({ role, puesto, permisos, onChange, modulosEmpresa, puedeOtorgar }: Props) {
  const caps = (Object.keys(CAPABILITY_LABELS) as Capability[]).filter((c) => {
    const m = moduloDe(c)
    return !m || modulosEmpresa.includes(m)
  })

  function cambiar(cap: Capability, valor: boolean, porDefecto: boolean) {
    const siguiente = { ...permisos }
    // Igual al default del puesto: no hace falta guardarlo como ajuste
    if (valor === porDefecto) delete siguiente[cap]
    else siguiente[cap] = valor
    onChange(siguiente)
  }

  return (
    <div className="space-y-4">
      {(['Módulos', 'Acciones'] as const).map((grupo) => (
        <div key={grupo}>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">{grupo}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {caps
              .filter((c) => CAPABILITY_LABELS[c].group === grupo)
              .map((cap) => {
                const porDefecto = role === 'admin' || ROLE_DEFAULTS[puesto].includes(cap)
                const ajuste = permisos[cap]
                const valor = ajuste === undefined ? porDefecto : ajuste
                const bloqueado = !valor && !puedeOtorgar(cap)
                return (
                  <label
                    key={cap}
                    className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm has-[:disabled]:opacity-50"
                    title={bloqueado ? 'No puedes otorgar un permiso que tú no tienes' : undefined}
                  >
                    <input
                      type="checkbox"
                      checked={valor}
                      disabled={bloqueado}
                      onChange={(e) => cambiar(cap, e.target.checked, porDefecto)}
                      className="size-4 accent-[rgb(var(--accent))]"
                    />
                    <span className="flex-1 text-fg-body">{CAPABILITY_LABELS[cap].label}</span>
                    {ajuste !== undefined && <Badge tone="accent">ajustado</Badge>}
                  </label>
                )
              })}
          </div>
        </div>
      ))}
      <p className="flex items-start gap-1.5 text-xs text-fg-muted">
        <UsersIcon size={13} className="mt-0.5 shrink-0" />
        Vienen marcados según el puesto; lo que cambies queda como ajuste para este usuario. Solo
        aparecen los módulos que el administrador general habilitó para la empresa.
      </p>
    </div>
  )
}
