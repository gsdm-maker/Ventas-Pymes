import { MapPin } from 'lucide-react'
import { cn } from '@/lib/cn'

interface Ubicacion {
  id: string
  nombre: string
  tipo?: string
}

/**
 * Ubicaciones autorizadas de una cuenta.
 * `valor = null` → todas (también las que se creen después); un arreglo → solo esas.
 * En la base, «todas» se guarda como cero filas en ubicacion_acceso.
 */
export function SelectorUbicaciones({
  ubicaciones,
  valor,
  onChange
}: {
  ubicaciones: Ubicacion[]
  valor: string[] | null
  onChange: (v: string[] | null) => void
}) {
  const restringido = valor !== null
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-fg-body">
        <MapPin size={13} aria-hidden /> Ubicaciones autorizadas
      </legend>
      <label className="flex items-start gap-2 text-sm text-fg-body">
        <input
          type="radio"
          name="alcance-ubicaciones"
          checked={!restringido}
          onChange={() => onChange(null)}
          className="mt-0.5 size-4 accent-[rgb(var(--accent))]"
        />
        <span>
          Todas las ubicaciones
          <span className="block text-xs text-fg-muted">Incluye las que se creen más adelante.</span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm text-fg-body">
        <input
          type="radio"
          name="alcance-ubicaciones"
          checked={restringido}
          onChange={() => onChange(valor ?? [])}
          className="mt-0.5 size-4 accent-[rgb(var(--accent))]"
        />
        <span>Solo las seleccionadas</span>
      </label>
      {restringido && (
        <div className="flex flex-wrap gap-2 pl-6">
          {ubicaciones.map((u) => {
            const marcada = valor.includes(u.id)
            return (
              <label
                key={u.id}
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-colors',
                  marcada ? 'border-accent/50 bg-accent-soft/40 text-fg' : 'border-border text-fg-body'
                )}
              >
                <input
                  type="checkbox"
                  checked={marcada}
                  onChange={(e) =>
                    onChange(e.target.checked ? [...valor, u.id] : valor.filter((x) => x !== u.id))
                  }
                  className="size-3.5 accent-[rgb(var(--accent))]"
                />
                {u.nombre}
                {u.tipo === 'bodega' && <span className="text-fg-muted">· bodega</span>}
              </label>
            )
          })}
          {valor.length === 0 && (
            <p className="w-full text-xs text-warning">Marca al menos una ubicación.</p>
          )}
        </div>
      )}
    </fieldset>
  )
}
