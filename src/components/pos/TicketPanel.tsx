import { CheckCircle2, CloudOff, Minus, Plus, ShoppingCart, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { cn } from '@/lib/cn'
import { clave } from '@/lib/variantes'
import { formatCLP } from '@/lib/format'
import { MEDIO_PAGO, MEDIOS_PAGO, montosSugeridos } from '@/lib/mediosPago'
import type { TicketPos } from '@/components/pos/useTicketPos'
import type { Linea, UltimaVenta } from '@/components/pos/tipos'

interface TicketPanelProps {
  ticket: TicketPos
  puedeCobrar: boolean
  enviando: boolean
  finalizar: () => void
  online: boolean
  ultima: UltimaVenta | null
}

/** Ticket en curso y cobro (en escritorio a la derecha; en móvil dentro de un modal). */
export function TicketPanel({ ticket, puedeCobrar, enviando, finalizar, online, ultima }: TicketPanelProps) {
  const {
    lineas,
    cambiarCantidad,
    eliminarLinea,
    bruto,
    descMonto,
    total,
    neto,
    iva,
    descuentoTipo,
    setDescuentoTipo,
    descuentoValor,
    setDescuentoValor,
    medio,
    setMedio,
    referencia,
    setReferencia,
    recibido,
    setRecibido
  } = ticket
  // Billetes para cobrar rápido en efectivo (montos mayores al total)
  const billetes = montosSugeridos(total)
  const vuelto = recibido > 0 ? recibido - total : 0
  const medioInfo = MEDIO_PAGO[medio]
  const referenciaRequerida = medioInfo.pideReferencia

  return (
    <>
      {ultima && (
        <div className={cn('mb-2.5 flex shrink-0 items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-xs', ultima.offline ? 'bg-warning-soft text-warning' : 'bg-success-soft text-success')}>
          <span className="flex items-center gap-1.5">
            {ultima.offline ? <CloudOff size={13} aria-hidden /> : <CheckCircle2 size={13} aria-hidden />}
            Última venta: <strong className="font-semibold">{ultima.folio}</strong>
          </span>
          <span className="font-semibold tabular-nums">{formatCLP(ultima.total)}</span>
        </div>
      )}
      {/* En móvil el título lo pone el modal */}
      <div className="hidden shrink-0 items-center justify-between lg:flex">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
          <ShoppingCart size={16} className="text-accent" />
          Ticket activo
        </h2>
        <span className="rounded-full bg-surface px-2.5 py-0.5 text-xs text-fg-muted">
          {lineas.length} ítem(s)
        </span>
      </div>

      {/* Detalle: en escritorio se desplaza y el cobro queda siempre a la vista */}
      <div className="my-3 space-y-2 lg:-mr-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-2">
        {lineas.length === 0 ? (
          <p className="py-8 text-center text-sm text-fg-muted">
            El ticket está vacío. Selecciona productos del catálogo.
          </p>
        ) : (
          lineas.map((l) => (
            <div
              key={clave(l.producto_id, l.variante_id)}
              className="flex items-center gap-2 rounded-xl bg-surface py-2 pl-3 pr-1.5"
            >
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-medium leading-snug text-fg">{l.descripcion}</p>
                <p className="mt-0.5 truncate text-xs tabular-nums text-fg-muted">
                  <span className="font-mono">{l.codigo}</span> · {formatCLP(l.precio_unitario)} c/u
                </p>
              </div>
              <div className="flex items-center">
                <button
                  onClick={() => cambiarCantidad(clave(l.producto_id, l.variante_id), -1)}
                  aria-label={`Disminuir cantidad de ${l.descripcion}`}
                  className="grid size-7 place-items-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg"
                >
                  <Minus size={13} />
                </button>
                <span className="w-6 text-center text-sm font-medium tabular-nums">{l.cantidad}</span>
                <button
                  onClick={() => cambiarCantidad(clave(l.producto_id, l.variante_id), 1)}
                  aria-label={`Aumentar cantidad de ${l.descripcion}`}
                  className="grid size-7 place-items-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg"
                >
                  <Plus size={13} />
                </button>
              </div>
              <span className="w-20 text-right text-sm font-semibold tabular-nums text-fg">
                {formatCLP(l.precio_unitario * l.cantidad)}
              </span>
              <button
                onClick={() => eliminarLinea(clave(l.producto_id, l.variante_id))}
                aria-label={`Eliminar ${l.descripcion} del ticket`}
                className="grid size-7 place-items-center rounded-md text-fg-faint hover:bg-danger-soft hover:text-danger"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))
        )}
      </div>

      <div className="shrink-0 space-y-3 border-t border-border pt-3">
        {/* Descuento: valor y tipo (% o $) en un solo control */}
        <div className="flex h-10 items-stretch overflow-hidden rounded-xl border border-border bg-field focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/40">
          <label htmlFor="pos-descuento" className="flex items-center pl-3 text-xs font-medium text-fg-muted">
            Descuento
          </label>
          <input
            id="pos-descuento"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            placeholder="0"
            value={descuentoValor || ''}
            // La base recibe un entero: un "12.5" haría fallar la venta (y la cola offline)
            // Tope: 100 % o el subtotal del ticket
            onChange={(e) => {
              const v = Math.max(0, Math.round(Number(e.target.value) || 0))
              setDescuentoValor(Math.min(v, descuentoTipo === 'porcentaje' ? 100 : bruto))
            }}
            className="min-w-0 flex-1 bg-transparent px-2 text-right text-sm tabular-nums text-fg outline-none placeholder:text-fg-faint"
          />
          <div role="group" aria-label="Tipo de descuento" className="flex border-l border-border">
            {(['porcentaje', 'monto'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setDescuentoTipo(t)
                  if (t === 'porcentaje' && descuentoValor > 100) setDescuentoValor(100)
                }}
                aria-pressed={descuentoTipo === t}
                aria-label={t === 'porcentaje' ? 'Descuento en porcentaje' : 'Descuento en pesos'}
                className={cn(
                  'w-10 text-sm font-semibold transition-colors',
                  descuentoTipo === t ? 'bg-accent text-on-accent' : 'text-fg-muted hover:bg-surface'
                )}
              >
                {t === 'porcentaje' ? '%' : '$'}
              </button>
            ))}
          </div>
        </div>

        {/* Medio de pago */}
        <div>
          <div role="group" aria-label="Medio de pago" className="grid grid-cols-3 gap-1.5">
            {MEDIOS_PAGO.map((m) => (
              <button
                key={m.key}
                onClick={() => {
                  setMedio(m.key)
                  setReferencia('')
                }}
                aria-pressed={medio === m.key}
                className={cn(
                  'flex h-10 items-center justify-center gap-1.5 rounded-xl px-1 text-xs font-medium transition-colors duration-200',
                  medio === m.key
                    ? 'bg-accent-soft text-accent ring-1 ring-accent/30'
                    : 'bg-surface text-fg-muted hover:bg-surface-2'
                )}
              >
                <m.icon size={14} className="shrink-0" />
                <span className="truncate">{m.label}</span>
              </button>
            ))}
          </div>
          {referenciaRequerida && (
            <Input
              className="mt-2 h-10 py-0"
              placeholder={medioInfo.refLabel}
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
            />
          )}
          {medioInfo.daVuelto && total > 0 && (
            <div className="mt-2 flex items-center gap-1.5">
              <div className="flex shrink-0 gap-1">
                {billetes.slice(0, 3).map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setRecibido(b)}
                    aria-pressed={recibido === b}
                    className={cn(
                      'h-10 rounded-xl border px-2.5 text-xs font-medium tabular-nums transition-colors',
                      recibido === b ? 'border-accent bg-accent-soft text-accent' : 'border-border text-fg-body hover:bg-surface'
                    )}
                  >
                    {b === total ? 'Exacto' : formatCLP(b)}
                  </button>
                ))}
              </div>
              <Input
                type="number"
                inputMode="numeric"
                placeholder="Paga con…"
                aria-label="Monto recibido en efectivo"
                value={recibido || ''}
                onChange={(e) => setRecibido(Number(e.target.value) || 0)}
                className="h-10 min-w-0 px-2.5 py-0 text-right tabular-nums"
              />
            </div>
          )}
        </div>

        {/* Totales */}
        <div className="space-y-1 text-sm text-fg-muted">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span className="tabular-nums">{formatCLP(bruto)}</span>
          </div>
          {descMonto > 0 && (
            <div className="flex justify-between">
              <span>Descuento</span>
              <span className="tabular-nums">-{formatCLP(descMonto)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span>Neto · IVA 19% incluido</span>
            <span className="tabular-nums">{formatCLP(neto)} · {formatCLP(iva)}</span>
          </div>
          {medioInfo.daVuelto && recibido > 0 && (
            <div className={cn('flex justify-between font-semibold', vuelto < 0 ? 'text-danger' : 'text-fg')}>
              <span>{vuelto < 0 ? 'Faltan' : 'Vuelto'}</span>
              <span className="tabular-nums">{formatCLP(Math.abs(vuelto))}</span>
            </div>
          )}
          <div className="flex items-baseline justify-between pt-1 text-fg">
            <span className="text-base font-semibold">Total a cobrar</span>
            <span className="text-2xl font-semibold tabular-nums text-accent">{formatCLP(total)}</span>
          </div>
        </div>

        <Button block size="lg" disabled={!puedeCobrar} onClick={() => void finalizar()}>
          <ShoppingCart size={18} />
          {enviando ? 'Registrando…' : 'Cobrar'}
          <kbd className="ml-1 hidden rounded border border-current/30 px-1 text-[10px] font-normal opacity-70 lg:inline">F9</kbd>
        </Button>
        {lineas.length > 0 && total <= 0 && (
          <p className="text-center text-xs text-danger">Con ese descuento la venta queda en $0: no se puede cobrar.</p>
        )}
        {!online && (
          <p className="flex items-center justify-center gap-1.5 text-[11px] text-warning">
            <CloudOff size={12} />
            Sin conexión: la venta se guardará y sincronizará automáticamente.
          </p>
        )}
      </div>
    </>
  )
}

export function TicketResumenMovil({
  lineas,
  total,
  onVerTicket
}: {
  lineas: Linea[]
  total: number
  onVerTicket: () => void
}) {
  return (
    <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 px-4 lg:hidden">
      <button
        onClick={onVerTicket}
        className="flex w-full items-center justify-between gap-3 rounded-2xl border border-border bg-panel/95 px-4 py-3 shadow-card backdrop-blur active:scale-[0.99]"
      >
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg bg-accent text-on-accent">
            <ShoppingCart size={16} />
          </span>
          <div className="text-left">
            <p className="text-xs text-fg-muted">{lineas.length} ítem(s)</p>
            <p className="tabular-nums text-sm font-semibold text-fg">{formatCLP(total)}</p>
          </div>
        </div>
        <span className="text-xs font-medium text-accent">Ver ticket</span>
      </button>
    </div>
  )
}
