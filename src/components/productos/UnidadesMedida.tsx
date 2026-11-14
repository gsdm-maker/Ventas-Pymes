import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { useAuth } from '@/core/auth/AuthProvider'
import { listarUnidades } from '@/core/data/api'
import { agregarUnidades, eliminarDeCatalogo } from '@/core/data/configuracion'
import type { UnidadMedida } from '@/core/types'
import { UNIDADES_SUGERIDAS, normalizarCodigo, type Unidad } from '@/lib/unidades'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/confirm'

/**
 * Unidades de medida de la empresa (Configuración).
 * Mientras la empresa no define ninguna se usan las sugeridas; el primer cambio las guarda como propias.
 */
export function UnidadesMedida({ editable }: { editable: boolean }) {
  const { empresa } = useAuth()
  const toast = useToast()
  const confirmar = useConfirm()
  const [propias, setPropias] = useState<UnidadMedida[]>([])
  const [codigo, setCodigo] = useState('')
  const [nombre, setNombre] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function recargar() {
    try {
      setPropias(await listarUnidades())
    } catch {
      setPropias([])
    }
  }

  useEffect(() => {
    void recargar()
  }, [])

  const sugeridas = propias.length === 0
  const lista: (Unidad & { id?: string })[] = sugeridas ? UNIDADES_SUGERIDAS : propias

  async function guardar(filas: Unidad[]) {
    if (!empresa) return false
    setEnviando(true)
    const error = await agregarUnidades(empresa.id, filas)
    setEnviando(false)
    if (error) {
      toast(error, 'error')
      return false
    }
    await recargar()
    return true
  }

  async function agregar() {
    const cod = normalizarCodigo(codigo)
    const nom = nombre.trim()
    if (!cod || !nom) return toast('Escribe el código (ej. KG) y el nombre (ej. Kilo)', 'warning')
    if (lista.some((u) => u.codigo === cod)) return toast(`Ya existe la unidad ${cod}`, 'warning')
    const filas = sugeridas ? [...UNIDADES_SUGERIDAS, { codigo: cod, nombre: nom }] : [{ codigo: cod, nombre: nom }]
    if (await guardar(filas)) {
      setCodigo('')
      setNombre('')
      toast(`Unidad ${cod} agregada`)
    }
  }

  async function quitar(u: Unidad & { id?: string }) {
    if (lista.length <= 1) return toast('Debe quedar al menos una unidad', 'warning')
    const ok = await confirmar({
      titulo: `Quitar la unidad ${u.codigo}`,
      mensaje: 'Los productos que ya la usan la conservan; solo deja de ofrecerse para productos nuevos o al editar.',
      accion: 'Quitar'
    })
    if (!ok) return
    if (sugeridas) {
      await guardar(UNIDADES_SUGERIDAS.filter((x) => x.codigo !== u.codigo))
      return
    }
    if (!u.id) return
    const error = await eliminarDeCatalogo('unidades_medida', u.id)
    if (error) return toast(error, 'error')
    void recargar()
  }

  return (
    <Card>
      <CardHeader title="Unidades de medida" />
      <CardBody className="space-y-3">
        <div className="flex gap-2">
          <Input
            className="w-24 shrink-0 uppercase"
            placeholder="KG"
            aria-label="Código de la unidad"
            maxLength={8}
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
          />
          <Input placeholder="Kilo" aria-label="Nombre de la unidad" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          <Button variant="secondary" onClick={() => void agregar()} disabled={!editable || enviando} aria-label="Agregar unidad">
            <Plus size={16} />
          </Button>
        </div>
        {sugeridas && (
          <p className="text-xs text-fg-muted">
            Estas son las unidades sugeridas. Al agregar o quitar una, la lista queda guardada como propia de la empresa.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {lista.map((u) => (
            <span key={u.codigo} className="flex items-center gap-1.5 rounded-full bg-surface px-3 py-1 text-xs text-fg-body">
              <span className="font-semibold text-fg">{u.codigo}</span> {u.nombre}
              {editable && (
                <button
                  onClick={() => void quitar(u)}
                  disabled={enviando}
                  aria-label={`Quitar unidad ${u.codigo}`}
                  className="text-fg-muted hover:text-danger"
                >
                  <X size={12} />
                </button>
              )}
            </span>
          ))}
        </div>
      </CardBody>
    </Card>
  )
}
