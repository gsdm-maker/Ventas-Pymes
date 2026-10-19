import { LayoutGrid, List, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

export type Vista = 'lista' | 'tarjetas'

export interface OpcionVista<V extends string> {
  v: V
  etiqueta: string
  Icono: LucideIcon
}

const POR_DEFECTO: OpcionVista<Vista>[] = [
  { v: 'lista', etiqueta: 'Vista lista', Icono: List },
  { v: 'tarjetas', etiqueta: 'Vista tarjetas', Icono: LayoutGrid }
]

/** Cambia el tipo de vista; la lista va primero y es la vista por defecto en todas las páginas. */
export function SelectorVista<V extends string = Vista>({
  valor,
  onChange,
  opciones = POR_DEFECTO as unknown as OpcionVista<V>[]
}: {
  valor: V
  onChange: (v: V) => void
  opciones?: OpcionVista<V>[]
}) {
  return (
    <div className="flex shrink-0 overflow-hidden rounded-xl border border-border" role="group" aria-label="Tipo de vista">
      {opciones.map(({ v, etiqueta, Icono }) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-label={etiqueta}
          aria-pressed={valor === v}
          title={etiqueta}
          className={cn(
            'grid size-10 place-items-center transition-colors',
            valor === v ? 'bg-accent text-on-accent' : 'text-fg-muted hover:bg-surface'
          )}
        >
          <Icono size={16} aria-hidden />
        </button>
      ))}
    </div>
  )
}
