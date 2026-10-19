import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabase } from '@/core/supabase/client'
import type { Mesa } from '@/core/types'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'

/** Configurar las mesas de un local: agregar varias de una vez, renombrar, zona y capacidad. */
export function GestorMesas({
  abierto,
  ubicacionId,
  mesas,
  ocupadas,
  onCerrar,
  onCambio
}: {
  abierto: boolean
  ubicacionId: string
  mesas: Mesa[]
  ocupadas: Set<string>
  onCerrar: () => void
  onCambio: () => void
}) {
  const { empresa } = useAuth()
  const toast = useToast()
  const [cantidad, setCantidad] = useState(4)
  const [zona, setZona] = useState('')
  const [edicion, setEdicion] = useState<Record<string, Partial<Mesa>>>({})
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    if (abierto) setEdicion({})
  }, [abierto])

  async function agregar() {
    if (!empresa || cantidad < 1) return
    // Sigue la numeración: «Mesa 1… Mesa N»
    const usados = mesas.map((m) => Number(m.nombre.match(/(\d+)\s*$/)?.[1] ?? 0))
    const desde = Math.max(0, ...usados) + 1
    const orden = Math.max(0, ...mesas.map((m) => m.orden)) + 1
    const filas = Array.from({ length: Math.min(cantidad, 50) }, (_, i) => ({
      empresa_id: empresa.id,
      ubicacion_id: ubicacionId,
      nombre: `Mesa ${desde + i}`,
      zona: zona.trim() || null,
      orden: orden + i
    }))
    setGuardando(true)
    const { error } = await supabase.from('mesas').insert(filas)
    setGuardando(false)
    if (error) return toast(error.message, 'error')
    toast(`${filas.length} mesa(s) agregadas`)
    onCambio()
  }

  async function guardarCambios() {
    const cambios = Object.entries(edicion)
    if (!cambios.length) return onCerrar()
    setGuardando(true)
    for (const [id, c] of cambios) {
      const { error } = await supabase
        .from('mesas')
        .update({ ...c, ...(c.zona !== undefined ? { zona: c.zona?.trim() || null } : {}) })
        .eq('id', id)
      if (error) {
        setGuardando(false)
        return toast(error.code === '23505' ? 'Ya existe una mesa con ese nombre' : error.message, 'error')
      }
    }
    setGuardando(false)
    toast('Mesas actualizadas')
    onCambio()
    onCerrar()
  }

  async function quitar(m: Mesa) {
    if (ocupadas.has(m.id)) return toast(`${m.nombre} tiene una cuenta abierta: cóbrala o anúlala antes de quitarla`, 'warning')
    const { error } = await supabase.from('mesas').update({ activa: false }).eq('id', m.id)
    if (error) return toast(error.message, 'error')
    onCambio()
  }

  const valor = <K extends keyof Mesa>(m: Mesa, k: K) => (edicion[m.id]?.[k] ?? m[k]) as Mesa[K]
  const editar = (id: string, c: Partial<Mesa>) => setEdicion((prev) => ({ ...prev, [id]: { ...prev[id], ...c } }))

  return (
    <Modal
      open={abierto}
      onClose={onCerrar}
      title="Mesas del local"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onCerrar}>Cerrar</Button>
          <Button onClick={() => void guardarCambios()} disabled={guardando}>Guardar cambios</Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-end gap-3 rounded-xl bg-surface/60 p-3">
          <Field label="Agregar">
            <Input type="number" min={1} max={50} className="w-20" value={cantidad || ''} onChange={(e) => setCantidad(Number(e.target.value) || 0)} />
          </Field>
          <Field label="Zona (opcional)">
            <Input value={zona} onChange={(e) => setZona(e.target.value)} placeholder="Salón, Terraza…" className="w-44" />
          </Field>
          <Button variant="secondary" onClick={() => void agregar()} disabled={guardando}>
            <Plus size={16} /> Agregar mesas
          </Button>
        </div>

        {mesas.length === 0 ? (
          <p className="py-6 text-center text-sm text-fg-muted">Aún no hay mesas. Agrega las del local arriba.</p>
        ) : (
          <div className="divide-y divide-border">
            <div className="grid grid-cols-[1fr_1fr_80px_36px] gap-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
              <span>Nombre</span>
              <span>Zona</span>
              <span>Personas</span>
              <span />
            </div>
            {mesas.map((m) => (
              <div key={m.id} className="grid grid-cols-[1fr_1fr_80px_36px] items-center gap-2 py-2">
                <Input aria-label={`Nombre de ${m.nombre}`} value={valor(m, 'nombre')} onChange={(e) => editar(m.id, { nombre: e.target.value })} className="py-1.5" />
                <Input aria-label={`Zona de ${m.nombre}`} value={valor(m, 'zona') ?? ''} onChange={(e) => editar(m.id, { zona: e.target.value })} placeholder="Salón" className="py-1.5" />
                <Input
                  aria-label={`Personas en ${m.nombre}`}
                  type="number"
                  min={1}
                  value={valor(m, 'capacidad')}
                  onChange={(e) => editar(m.id, { capacidad: Math.max(1, Number(e.target.value) || 1) })}
                  className="py-1.5"
                />
                <button
                  onClick={() => void quitar(m)}
                  aria-label={`Quitar ${m.nombre}`}
                  className="grid size-9 place-items-center rounded-lg text-fg-muted hover:bg-danger-soft hover:text-danger"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}
