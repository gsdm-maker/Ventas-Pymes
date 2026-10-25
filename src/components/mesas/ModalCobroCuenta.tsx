import { useEffect, useState } from 'react'
import { supabase } from '@/core/supabase/client'
import type { MedioPago, Venta } from '@/core/types'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/cn'
import { MEDIO_PAGO, MEDIOS_PAGO, montosSugeridos, referenciaCompleta, referenciaPara } from '@/lib/mediosPago'
import { formatCLP } from '@/lib/format'

type ModoPropina = 'sugerida' | 'sin' | 'otra'

/** Cobro de una cuenta de mesa: propina sugerida del 10 % (editable), medio de pago y vuelto. */
export function ModalCobroCuenta({
  abierto,
  cuentaId,
  mesa,
  total,
  onCerrar,
  onCobrado
}: {
  abierto: boolean
  cuentaId: string | null
  mesa: string
  total: number
  onCerrar: () => void
  onCobrado: (v: Venta) => void
}) {
  const toast = useToast()
  const [modo, setModo] = useState<ModoPropina>('sugerida')
  const [otra, setOtra] = useState(0)
  const [medio, setMedio] = useState<MedioPago>('efectivo')
  const [referencia, setReferencia] = useState('')
  const [recibido, setRecibido] = useState(0)
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    if (!abierto) return
    setModo('sugerida')
    setOtra(0)
    setMedio('efectivo')
    setReferencia('')
    setRecibido(0)
  }, [abierto])

  const sugerida = Math.round((total * 0.1) / 10) * 10
  const propina = modo === 'sugerida' ? sugerida : modo === 'otra' ? Math.max(0, otra) : 0
  const aPagar = total + propina
  const billetes = montosSugeridos(aPagar)
  const vuelto = recibido > 0 ? recibido - aPagar : 0
  const info = MEDIO_PAGO[medio]

  async function cobrar() {
    if (!cuentaId) return
    if (!referenciaCompleta(medio, referencia)) return toast('Ingresa el número de referencia del pago', 'warning')
    if (propina > total) return toast('La propina no puede ser mayor que el consumo', 'warning')
    setEnviando(true)
    const { data, error } = await supabase.rpc('cobrar_cuenta', {
      p_cuenta: cuentaId,
      p_medio_pago: medio,
      p_referencia: referenciaPara(medio, referencia),
      p_propina: propina
    })
    setEnviando(false)
    if (error) return toast(error.message, 'error')
    onCobrado(data as Venta)
  }

  return (
    <Modal
      open={abierto}
      onClose={onCerrar}
      title={`Cobrar ${mesa}`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onCerrar}>Cancelar</Button>
          <Button onClick={() => void cobrar()} disabled={enviando || total <= 0}>
            {enviando ? 'Cobrando…' : `Cobrar ${formatCLP(aPagar)}`}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="space-y-1 text-sm">
          <div className="flex justify-between text-fg-muted">
            <span>Consumo</span>
            <span className="tabular-nums text-fg">{formatCLP(total)}</span>
          </div>
          <div className="flex justify-between text-fg-muted">
            <span>Propina</span>
            <span className="tabular-nums text-fg">{formatCLP(propina)}</span>
          </div>
          <div className="flex justify-between border-t border-border pt-2 text-base font-semibold text-fg">
            <span>Total a pagar</span>
            <span className="tabular-nums text-accent">{formatCLP(aPagar)}</span>
          </div>
        </div>

        <fieldset>
          <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Propina</legend>
          <div className="grid grid-cols-3 gap-2">
            {([
              ['sugerida', `10% · ${formatCLP(sugerida)}`],
              ['sin', 'Sin propina'],
              ['otra', 'Otro monto']
            ] as [ModoPropina, string][]).map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={modo === k}
                onClick={() => {
                  setModo(k)
                  setRecibido(0)
                }}
                className={cn(
                  'rounded-xl border px-2 py-2 text-xs font-medium transition-colors',
                  modo === k ? 'border-accent bg-accent-soft text-accent' : 'border-border text-fg-body hover:bg-surface'
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {modo === 'otra' && (
            <Input
              className="mt-2"
              type="number"
              inputMode="numeric"
              min={0}
              autoFocus
              aria-label="Monto de la propina"
              placeholder="Monto de la propina"
              value={otra || ''}
              onChange={(e) => setOtra(Number(e.target.value) || 0)}
            />
          )}
          <p className="mt-1.5 text-xs text-fg-muted">La propina es voluntaria, no lleva IVA y queda registrada para el garzón.</p>
        </fieldset>

        <fieldset>
          <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Medio de pago</legend>
          <div className="grid grid-cols-3 gap-2">
            {MEDIOS_PAGO.map((m) => (
              <button
                key={m.key}
                type="button"
                aria-pressed={medio === m.key}
                onClick={() => {
                  setMedio(m.key)
                  setReferencia('')
                }}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-xl py-2 text-[11px] font-medium transition-colors',
                  medio === m.key ? 'bg-accent-soft text-accent shadow-sm' : 'bg-surface text-fg-muted hover:bg-surface-2'
                )}
              >
                <m.icon size={16} aria-hidden />
                {m.label}
              </button>
            ))}
          </div>
          {info.pideReferencia && (
            <Input className="mt-2" placeholder={info.refLabel} aria-label={info.refLabel} value={referencia} onChange={(e) => setReferencia(e.target.value)} />
          )}
          {info.daVuelto && (
            <div className="mt-2 space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {billetes.map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setRecibido(b)}
                    aria-pressed={recibido === b}
                    className={cn(
                      'rounded-lg border px-2.5 py-1.5 text-xs font-medium tabular-nums transition-colors',
                      recibido === b ? 'border-accent bg-accent-soft text-accent' : 'border-border text-fg-body hover:bg-surface'
                    )}
                  >
                    {b === aPagar ? 'Exacto' : formatCLP(b)}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  aria-label="Efectivo recibido"
                  placeholder="Recibido"
                  value={recibido || ''}
                  onChange={(e) => setRecibido(Number(e.target.value) || 0)}
                />
                {recibido > 0 && (
                  <span className={cn('shrink-0 text-sm font-semibold tabular-nums', vuelto < 0 ? 'text-danger' : 'text-success')}>
                    {vuelto < 0 ? `Faltan ${formatCLP(-vuelto)}` : `Vuelto ${formatCLP(vuelto)}`}
                  </span>
                )}
              </div>
            </div>
          )}
        </fieldset>
      </div>
    </Modal>
  )
}
