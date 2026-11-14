import { useEffect, useState } from 'react'
import { BellRing, CalendarCheck, CreditCard, History } from 'lucide-react'
import type { Empresa, Plan } from '@/core/types'
import { AVISO_CADA_HORAS, AVISO_DIAS_ANTES, DIAS_PRUEBA_DEFAULT, estadoPlan, PLAN_DESCRIPCION, etiquetaPlan, tonoPlan, resumenPlan } from '@/core/auth/plan'
import { adminUsers, listarPagosPlan, type PagoPlan } from '@/core/data/admin'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Field, Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { formatFecha } from '@/lib/format'
import { cn } from '@/lib/cn'

const PLANES: Plan[] = ['prueba', 'mensual', 'anual', 'dueno']
const DIA = 86400000

function hoyIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function sumarPeriodo(desde: Date, plan: Plan): Date {
  if (plan === 'anual') {
    const d = new Date(desde)
    d.setFullYear(d.getFullYear() + 1)
    return d
  }
  return new Date(desde.getTime() + 30 * DIA)
}

/**
 * Consola general · plan de suscripción de una empresa: estado, registrar pago, cambiar plan,
 * días de gracia y alertas, e historial de pagos. Todo pasa por la Edge Function admin-users.
 */
export function PlanSuscripcion({ empresa, onCambio }: { empresa: Empresa; onCambio: () => void }) {
  const toast = useToast()
  const estado = estadoPlan(empresa)
  const [pagos, setPagos] = useState<PagoPlan[]>([])
  const [enviando, setEnviando] = useState(false)

  // Cambiar plan
  const [nuevo, setNuevo] = useState<Plan>(empresa.plan)
  const [diasPrueba, setDiasPrueba] = useState(DIAS_PRUEBA_DEFAULT)
  const [inicio, setInicio] = useState(hoyIso())

  // Registrar pago
  const [pagoAbierto, setPagoAbierto] = useState(false)
  const [nota, setNota] = useState('')

  // Avisos
  const [avisos, setAvisos] = useState({ dias_gracia: empresa.dias_gracia ?? 5 })

  useEffect(() => {
    setNuevo(empresa.plan)
    setAvisos({ dias_gracia: empresa.dias_gracia ?? 5 })
    void listarPagosPlan(empresa.id).then(setPagos)
  }, [empresa])

  async function invocar(body: Record<string, unknown>, ok: string) {
    setEnviando(true)
    const { error } = await adminUsers({ empresa_id: empresa.id, ...body })
    setEnviando(false)
    if (error) {
      toast(error, 'error')
      return false
    }
    toast(ok)
    onCambio()
    return true
  }

  async function aplicarPlan() {
    if (nuevo === 'prueba' && (!Number.isInteger(diasPrueba) || diasPrueba < 1 || diasPrueba > 365)) {
      return toast('Los días de prueba van de 1 a 365', 'warning')
    }
    await invocar(
      { accion: 'actualizar_plan', plan: nuevo, prueba_dias: diasPrueba, inicio: nuevo === 'mensual' || nuevo === 'anual' ? inicio : undefined },
      `Membresía cambiada a ${etiquetaPlan(nuevo)}`
    )
  }

  async function registrarPago() {
    const ok = await invocar({ accion: 'registrar_pago', nota }, 'Pago registrado')
    if (ok) {
      setPagoAbierto(false)
      setNota('')
    }
  }

  const periodico = empresa.plan === 'mensual' || empresa.plan === 'anual'
  const proximoVence = periodico && empresa.plan_vence ? sumarPeriodo(new Date(empresa.plan_vence), empresa.plan) : null
  const cambiaPlan = nuevo !== empresa.plan || nuevo === 'prueba'
  // También se guarda si la empresa tenía otra regla de avisos de antes, para dejarla en la fija
  const avisosCambiados =
    avisos.dias_gracia !== (empresa.dias_gracia ?? 5) ||
    empresa.aviso_dias_antes !== AVISO_DIAS_ANTES ||
    empresa.aviso_cada_horas !== AVISO_CADA_HORAS

  const tonoEstado =
    estado.fase === 'bloqueado' ? 'blocked' : estado.fase === 'gracia' ? 'danger' : estado.fase === 'por_vencer' ? 'warning' : 'success'
  const etiquetaEstado = {
    sin_vencimiento: 'Activo',
    vigente: 'Al día',
    por_vencer: 'Por vencer',
    gracia: 'En gracia',
    bloqueado: 'Bloqueado'
  }[estado.fase]

  return (
    <Card className="lg:col-span-2">
      <CardHeader title="Membresía" subtitle="Cómo paga la empresa, cuándo vence y cómo se le avisa" />
      <CardBody className="space-y-5">
        {/* Estado actual */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-fg">
              <Badge tone={tonoPlan(empresa.plan)}>{etiquetaPlan(empresa.plan)}</Badge>
              <Badge tone={tonoEstado} dot>{etiquetaEstado}</Badge>
            </p>
            <p className="mt-1 text-sm text-fg-body">{resumenPlan(empresa, estado)}</p>
            <p className="mt-0.5 text-xs text-fg-muted">
              {empresa.plan_inicio && `Alta ${formatFecha(empresa.plan_inicio)}`}
              {periodico && estado.bloqueo && ` · se bloquea el ${formatFecha(estado.bloqueo)} (${empresa.dias_gracia ?? 0} días de gracia)`}
            </p>
          </div>
          {periodico && (
            <Button onClick={() => setPagoAbierto(true)} disabled={enviando}>
              <CreditCard size={16} /> Registrar pago
            </Button>
          )}
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          {/* Cambiar plan */}
          <div className="space-y-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">
              <CalendarCheck size={13} aria-hidden /> Cambiar membresía
            </p>
            <div role="radiogroup" aria-label="Membresía" className="grid grid-cols-2 gap-1.5">
              {PLANES.map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={nuevo === p}
                  onClick={() => setNuevo(p)}
                  className={cn(
                    'rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors',
                    nuevo === p ? 'border-accent bg-accent-soft text-accent' : 'border-border text-fg-body hover:bg-surface'
                  )}
                >
                  {etiquetaPlan(p)}
                  {empresa.plan === p && <span className="ml-1 text-[11px] font-normal text-fg-muted">(actual)</span>}
                </button>
              ))}
            </div>
            <p className="text-xs text-fg-muted">{PLAN_DESCRIPCION[nuevo]}</p>
            {nuevo === 'prueba' && (
              <Field label="Días de prueba" hint={empresa.plan === 'prueba' ? 'Se cuentan desde hoy (reinicia la prueba).' : 'Se cuentan desde hoy.'}>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={365}
                  value={diasPrueba}
                  onChange={(e) => setDiasPrueba(Math.round(Number(e.target.value) || 0))}
                />
              </Field>
            )}
            {(nuevo === 'mensual' || nuevo === 'anual') && nuevo !== empresa.plan && (
              <Field
                label="Fecha de alta (cuando adquirió el sistema)"
                hint={`Los ciclos de ${nuevo === 'mensual' ? '30 días' : '1 año'} se cuentan desde esta fecha. Se da por pagado el ciclo en curso.`}
              >
                <Input type="date" value={inicio} max={hoyIso()} onChange={(e) => e.target.value && setInicio(e.target.value)} />
              </Field>
            )}
            <Button variant="secondary" block disabled={enviando || !cambiaPlan} onClick={() => void aplicarPlan()}>
              {nuevo === 'prueba' && empresa.plan === 'prueba' ? 'Reiniciar prueba' : `Pasar a ${etiquetaPlan(nuevo)}`}
            </Button>
          </div>

          {/* Gracia y alertas */}
          <div className="space-y-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">
              <BellRing size={13} aria-hidden /> Gracia y alertas al admin
            </p>
            <Field label="Días de gracia" hint="Mensual y anual. La prueba no tiene gracia.">
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                max={60}
                value={avisos.dias_gracia}
                onChange={(e) => setAvisos({ ...avisos, dias_gracia: Math.round(Number(e.target.value) || 0) })}
              />
            </Field>
            <ol className="space-y-1.5 rounded-lg bg-surface px-3 py-2.5 text-xs text-fg-body">
              <li>
                <span className="font-medium text-fg">1 día antes de vencer:</span> franja amarilla y un aviso emergente.
              </li>
              <li>
                <span className="font-medium text-fg">
                  {avisos.dias_gracia > 0
                    ? `Durante los ${avisos.dias_gracia} día(s) de gracia:`
                    : 'Sin días de gracia:'}
                </span>{' '}
                {avisos.dias_gracia > 0
                  ? 'franja roja y un aviso emergente cada día.'
                  : 'el día que vence se bloquea.'}
              </li>
              <li>
                <span className="font-medium text-fg">Al terminar la gracia:</span> se bloquea el acceso (la información
                queda guardada).
              </li>
              <li className="text-fg-muted">Solo lo ve el admin de la empresa, no el resto del equipo.</li>
            </ol>
            <Button
              variant="secondary"
              block
              disabled={enviando || !avisosCambiados}
              onClick={() => void invocar(
                  {
                    accion: 'configurar_avisos',
                    dias_gracia: avisos.dias_gracia,
                    aviso_dias_antes: AVISO_DIAS_ANTES,
                    aviso_cada_horas: AVISO_CADA_HORAS
                  },
                  'Días de gracia guardados'
                )}
            >
              Guardar días de gracia
            </Button>
          </div>
        </div>

        {/* Historial */}
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            <History size={13} aria-hidden /> Historial de pagos
          </p>
          {pagos.length === 0 ? (
            <p className="text-sm text-fg-muted">Sin pagos registrados.</p>
          ) : (
            <div className="divide-y divide-border rounded-xl border border-border">
              {pagos.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                  <span className="text-fg-body">
                    <Badge tone={tonoPlan(p.plan)}>{etiquetaPlan(p.plan)}</Badge>{' '}
                    {p.periodo_hasta
                      ? `${formatFecha(p.periodo_desde)} → ${formatFecha(p.periodo_hasta)}`
                      : 'Pago único'}
                    {p.nota && <span className="text-fg-muted"> · {p.nota}</span>}
                  </span>
                  <span className="text-xs text-fg-muted">Registrado {formatFecha(p.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardBody>

      <Modal
        open={pagoAbierto}
        onClose={() => setPagoAbierto(false)}
        size="sm"
        title="Registrar pago"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPagoAbierto(false)}>Cancelar</Button>
            <Button disabled={enviando} onClick={() => void registrarPago()}>
              {enviando ? 'Registrando…' : 'Registrar pago'}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-fg-body">
          <p>
            Suma {empresa.plan === 'anual' ? '1 año' : '30 días'} al vencimiento actual
            {empresa.plan_vence && <> ({formatFecha(empresa.plan_vence)})</>}, respetando el ciclo desde la fecha de alta.
          </p>
          {proximoVence && (
            <p className="rounded-xl bg-surface px-3 py-2">
              Nuevo vencimiento: <b className="text-fg">{formatFecha(proximoVence)}</b>
            </p>
          )}
          <Field label="Nota (opcional)" hint="Ej.: transferencia 12-10, boleta 345">
            <Input value={nota} maxLength={200} onChange={(e) => setNota(e.target.value)} />
          </Field>
        </div>
      </Modal>
    </Card>
  )
}
