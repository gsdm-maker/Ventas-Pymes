import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FlaskConical, Save, TrendingUp } from 'lucide-react'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabase } from '@/core/supabase/client'
import { borrarHistoriaSimulada, simularHistoria } from '@/core/data/api'
import { invalidarAlertas } from '@/core/data/useAlertasStock'
import type { ParametrosReposicion } from '@/core/types'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/confirm'

const DEFAULT: ParametrosReposicion = { semanas: 8, seguridad_pct: 20, ajuste_pct: 0 }

/** Parámetros de la proyección e historia simulada (Configuración). */
export function ConfigReposicion() {
  const { empresa, can, refrescar } = useAuth()
  const toast = useToast()
  const confirmar = useConfirm()
  const [p, setP] = useState<ParametrosReposicion>({ ...DEFAULT, ...empresa?.reposicion })
  const [guardando, setGuardando] = useState(false)
  const [simulando, setSimulando] = useState(false)
  const gestiona = can('config.gestionar')

  async function guardar() {
    if (!empresa) return
    if (!Number.isFinite(p.ajuste_pct) || p.ajuste_pct < -90 || p.ajuste_pct > 300) {
      return toast('El ajuste de temporada debe estar entre -90% y 300%', 'warning')
    }
    setGuardando(true)
    const { error } = await supabase.from('empresas').update({ reposicion: p }).eq('id', empresa.id)
    setGuardando(false)
    if (error) return toast(error.message, 'error')
    invalidarAlertas()
    await refrescar()
    toast('Parámetros de reposición guardados')
  }

  async function generar() {
    const ok = await confirmar({
      titulo: 'Generar historia simulada',
      mensaje:
        'Se cargarán 12 semanas de ventas ficticias en las tiendas (más ventas viernes, sábado y domingo). No cambia el stock actual; reemplaza cualquier historia simulada anterior.',
      accion: 'Generar'
    })
    if (!ok) return
    setSimulando(true)
    try {
      const n = await simularHistoria(12)
      invalidarAlertas()
      toast(`${n} ventas simuladas cargadas`)
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setSimulando(false)
    }
  }

  async function borrar() {
    const ok = await confirmar({
      titulo: 'Borrar historia simulada',
      mensaje: 'Se eliminarán todas las ventas simuladas. Las ventas reales no se tocan.',
      accion: 'Borrar'
    })
    if (!ok) return
    setSimulando(true)
    try {
      const n = await borrarHistoriaSimulada()
      invalidarAlertas()
      toast(`${n} ventas simuladas eliminadas`)
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setSimulando(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title="Proyección de reposición"
        subtitle="Cómo se calculan las alertas de quiebre"
        action={
          <Link to="/reposicion" className="text-xs font-medium text-accent hover:underline">
            Ver reposición
          </Link>
        }
      />
      <CardBody className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Historia a considerar">
            <Select
              value={p.semanas}
              disabled={!gestiona}
              onChange={(e) => setP({ ...p, semanas: Number(e.target.value) })}
            >
              {[4, 8, 12, 26].map((n) => (
                <option key={n} value={n}>
                  Últimas {n} semanas
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Stock de seguridad">
            <Select
              value={p.seguridad_pct}
              disabled={!gestiona}
              onChange={(e) => setP({ ...p, seguridad_pct: Number(e.target.value) })}
            >
              {[0, 10, 20, 30, 50].map((n) => (
                <option key={n} value={n}>
                  +{n}% sobre la demanda
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Ajuste de temporada (%)">
            <Input
              type="number"
              inputMode="numeric"
              min={-90}
              max={300}
              step={5}
              disabled={!gestiona}
              value={p.ajuste_pct}
              onChange={(e) => setP({ ...p, ajuste_pct: Number(e.target.value) })}
            />
          </Field>
        </div>
        <p className="flex items-start gap-2 text-xs text-fg-muted">
          <TrendingUp size={14} className="mt-0.5 shrink-0" aria-hidden />
          La venta esperada de cada día se calcula con el promedio de ese mismo día de la semana,
          dando más peso a las semanas recientes. Usa el ajuste de temporada para anticipar
          períodos fuertes (por ejemplo +30% en diciembre); con más de un año de historia, el
          sistema además compara con el mismo período del año anterior.
        </p>
        {gestiona && (
          <>
            <Button size="sm" onClick={() => void guardar()} disabled={guardando}>
              <Save size={14} /> {guardando ? 'Guardando…' : 'Guardar parámetros'}
            </Button>
            <div className="rounded-xl border border-dashed border-border p-3">
              <p className="flex items-center gap-2 text-sm font-medium text-fg">
                <FlaskConical size={15} aria-hidden /> Historia simulada (demo)
              </p>
              <p className="mt-1 text-xs text-fg-muted">
                Ventas ficticias para probar la proyección mientras se acumulan ventas reales.
                Aparecen en Movimientos con referencia «SIMULADO».
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => void generar()} disabled={simulando}>
                  Generar 12 semanas
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void borrar()} disabled={simulando}>
                  Borrar simuladas
                </Button>
              </div>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  )
}
