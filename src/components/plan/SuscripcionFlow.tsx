import { useCallback, useEffect, useState } from 'react'
import { CreditCard, Loader2 } from 'lucide-react'
import { useAuth } from '@/core/auth/AuthProvider'
import {
  cancelarSuscripcion,
  contratarSuscripcion,
  listarCobros,
  listarNiveles,
  miSuscripcion
} from '@/core/data/api'
import { Button } from '@/components/ui/Button'
import { Badge, type Tone } from '@/components/ui/Badge'
import { Select } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/confirm'
import { formatCLP, formatFecha } from '@/lib/format'
import type { CobroFlow, EstadoSuscripcion, NivelPlanConfig, SuscripcionFlow as Suscripcion } from '@/core/types'

const ESTADO: Record<EstadoSuscripcion, { texto: string; tono: Tone }> = {
  pendiente_tarjeta: { texto: 'Falta registrar la tarjeta', tono: 'warning' },
  activa: { texto: 'Cobro automático activo', tono: 'success' },
  morosa: { texto: 'Cobro rechazado', tono: 'danger' },
  cancelada: { texto: 'Cancelada', tono: 'neutral' }
}

const COBRO: Record<CobroFlow['estado'], { texto: string; tono: Tone }> = {
  pagado: { texto: 'Pagado', tono: 'success' },
  pendiente: { texto: 'Pendiente', tono: 'warning' },
  fallido: { texto: 'Rechazado', tono: 'danger' },
  anulado: { texto: 'Anulado', tono: 'neutral' }
}

/** Contratar, ver y cancelar el cobro automático de la membresía (solo administrador de la empresa). */
export function SuscripcionFlow({ empresaId }: { empresaId?: string }) {
  const { empresa } = useAuth()
  const toast = useToast()
  const confirmar = useConfirm()
  const id = empresaId ?? empresa?.id
  const [sus, setSus] = useState<Suscripcion | null>(null)
  const [cobros, setCobros] = useState<CobroFlow[]>([])
  const [niveles, setNiveles] = useState<NivelPlanConfig[]>([])
  const [nivel, setNivel] = useState('s')
  const [periodo, setPeriodo] = useState<'mensual' | 'anual'>('mensual')
  const [cargando, setCargando] = useState(true)
  const [ocupado, setOcupado] = useState(false)

  const cargar = useCallback(async () => {
    if (!id) return
    const [s, c, n] = await Promise.all([miSuscripcion(id), listarCobros(id), listarNiveles()])
    setSus(s)
    setCobros(c)
    setNiveles(n)
    setCargando(false)
  }, [id])

  useEffect(() => {
    void cargar()
  }, [cargar])

  // Al volver de Flow: avisar el resultado y quitar el parámetro de la dirección
  useEffect(() => {
    const url = new URL(window.location.href)
    const r = url.searchParams.get('suscripcion')
    if (!r) return
    url.searchParams.delete('suscripcion')
    window.history.replaceState(null, '', url.pathname + url.search)
    if (r === 'ok') toast('Tarjeta registrada: el cobro automático quedó activo')
    else if (r === 'rechazada') toast('La tarjeta no se registró. Puedes intentarlo de nuevo.', 'warning')
    else toast('No se pudo completar el registro de la tarjeta', 'error')
    void cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const elegido = niveles.find((n) => n.nivel === nivel)
  const monto = periodo === 'anual' ? elegido?.precio_anual : elegido?.precio_mensual
  const vigente = sus && (sus.estado === 'activa' || sus.estado === 'morosa')

  async function contratar() {
    setOcupado(true)
    try {
      window.location.href = await contratarSuscripcion(nivel, periodo, empresaId)
    } catch (e) {
      toast((e as Error).message, 'error')
      setOcupado(false)
    }
  }

  async function cancelar() {
    const ok = await confirmar({
      titulo: 'Cancelar el cobro automático',
      mensaje:
        'No se harán más cobros. Conservas el acceso hasta que termine el período ya pagado y después tendrás que renovar.',
      accion: 'Cancelar suscripción'
    })
    if (!ok) return
    setOcupado(true)
    try {
      await cancelarSuscripcion(empresaId)
      toast('Suscripción cancelada')
      await cargar()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setOcupado(false)
    }
  }

  if (cargando) return <Loader2 className="animate-spin text-accent" size={18} />

  // Sin contrato o ya cancelada (o sin terminar de registrar la tarjeta): se puede contratar
  const puedeContratar = !sus || sus.estado === 'cancelada' || sus.estado === 'pendiente_tarjeta'

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <CreditCard size={16} className="text-fg-muted" />
        <span className="text-sm font-medium text-fg">Cobro automático</span>
        {sus && <Badge tone={ESTADO[sus.estado].tono}>{ESTADO[sus.estado].texto}</Badge>}
      </div>

      {vigente && sus && (
        <div className="space-y-1 text-sm text-fg-body">
          {sus.tarjeta_ultimos4 && (
            <p>
              Tarjeta {sus.tarjeta_marca} terminada en {sus.tarjeta_ultimos4}
            </p>
          )}
          {sus.cancela_al_vencer ? (
            <p className="text-warning">
              Cancelada: no habrá más cobros{sus.proximo_cobro ? ` desde el ${formatFecha(sus.proximo_cobro)}` : ''}.
            </p>
          ) : (
            sus.proximo_cobro && <p>Próximo cobro: {formatFecha(sus.proximo_cobro)}</p>
          )}
          {sus.estado === 'morosa' && (
            <p className="text-danger">
              El último cobro fue rechazado. Flow reintenta solo; si sigue fallando, contacta a tu banco.
            </p>
          )}
          {!sus.cancela_al_vencer && (
            <Button variant="ghost" size="sm" onClick={() => void cancelar()} disabled={ocupado}>
              Cancelar suscripción
            </Button>
          )}
        </div>
      )}

      {puedeContratar && (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <Select value={nivel} onChange={(e) => {
              setNivel(e.target.value)
              if (e.target.value !== 'l') setPeriodo('mensual')
            }}>
              {niveles.map((n) => (
                <option key={n.nivel} value={n.nivel}>{n.nombre}</option>
              ))}
            </Select>
            <Select value={periodo} onChange={(e) => setPeriodo(e.target.value as 'mensual' | 'anual')}>
              <option value="mensual">Mensual</option>
              {elegido?.precio_anual ? <option value="anual">Anual</option> : null}
            </Select>
          </div>
          <Button onClick={() => void contratar()} disabled={ocupado || !monto}>
            {ocupado ? 'Redirigiendo a Flow…' : `Registrar tarjeta${monto ? ` · ${formatCLP(monto)}` : ''}`}
          </Button>
          <p className="text-xs text-fg-muted">
            Pagas en Flow con tarjeta de crédito o débito. Los datos de la tarjeta no pasan por Mi Socio Pyme.
          </p>
        </div>
      )}

      {cobros.length > 0 && (
        <ul className="divide-y divide-border text-sm">
          {cobros.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 py-1.5">
              <span className="text-fg-body">
                {formatFecha(c.periodo_desde)} · {formatCLP(c.monto)}
              </span>
              <Badge tone={COBRO[c.estado].tono}>{COBRO[c.estado].texto}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
