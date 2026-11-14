import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Building2, ChevronRight, Clock, Layers, Lock } from 'lucide-react'
import type { ReactNode } from 'react'
import { listarEmpresas } from '@/core/data/api'
import type { Empresa, Plan } from '@/core/types'
import { AdminTabs } from '@/pages/admin/AdminTabs'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { LoadingState, PageHeader } from '@/components/ui/Feedback'
import { estadoPlan, etiquetaPlan, tonoPlan, resumenPlan, type EstadoPlan } from '@/core/auth/plan'
import { cn } from '@/lib/cn'
import { FILTROS_NIVEL, FILTRO_NIVEL_LABEL, claveNivel, etiquetaNivel } from '@/lib/niveles'

function Cifra({ icono, n, label, tono }: { icono: ReactNode; n: number; label: string; tono: string }) {
  return (
    <Card>
      <CardBody className="flex items-center gap-3">
        <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', tono)}>{icono}</span>
        <div className="min-w-0">
          <p className="text-2xl font-semibold tabular-nums text-fg">{n}</p>
          <p className="text-xs leading-tight text-fg-muted">{label}</p>
        </div>
      </CardBody>
    </Card>
  )
}

const ORDEN_FASE: Record<EstadoPlan['fase'], number> = {
  bloqueado: 0,
  gracia: 1,
  por_vencer: 2,
  vigente: 3,
  sin_vencimiento: 4
}

export function Admin() {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    listarEmpresas().then(setEmpresas).finally(() => setCargando(false))
  }, [])

  const filas = useMemo(
    () =>
      empresas
        .map((e) => ({ e, estado: estadoPlan(e) }))
        .sort(
          (a, b) =>
            ORDEN_FASE[a.estado.fase] - ORDEN_FASE[b.estado.fase] ||
            (a.estado.vence?.getTime() ?? Infinity) - (b.estado.vence?.getTime() ?? Infinity)
        ),
    [empresas]
  )
  const atencion = filas.filter((f) => ['bloqueado', 'gracia', 'por_vencer'].includes(f.estado.fase))
  const porPlan = (p: Plan) => empresas.filter((e) => e.plan === p).length
  const porNivel = FILTROS_NIVEL.map((n) => ({ n, total: empresas.filter((e) => claveNivel(e.nivel) === n).length }))
  const sinPlan = porNivel.find((x) => x.n === 'sin')?.total ?? 0

  return (
    <>
      <AdminTabs />
      <PageHeader title="Consola general" subtitle="Administración de la plataforma" />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Cifra icono={<Building2 size={18} />} n={empresas.length} label="Empresas" tono="bg-accent-soft text-accent" />
        <Cifra
          icono={<Clock size={18} />}
          n={filas.filter((f) => f.estado.fase === 'por_vencer').length}
          label="Por vencer"
          tono="bg-warning-soft text-warning"
        />
        <Cifra
          icono={<AlertTriangle size={18} />}
          n={filas.filter((f) => f.estado.fase === 'gracia').length}
          label="En días de gracia"
          tono="bg-danger-soft text-danger"
        />
        <Cifra
          icono={<Lock size={18} />}
          n={filas.filter((f) => f.estado.fase === 'bloqueado').length}
          label="Bloqueadas"
          tono="bg-surface-2 text-fg-muted"
        />
      </div>

      {sinPlan > 0 && !cargando && (
        <Link
          to="/admin/empresas?plan=sin"
          className="mt-4 flex items-center gap-3 rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning transition-colors hover:brightness-95"
        >
          <AlertTriangle size={16} className="shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            {sinPlan === 1
              ? '1 empresa no tiene plan: no se le aplican topes. Asígnale el que paga.'
              : `${sinPlan} empresas no tienen plan: no se les aplican topes. Asígnales el que pagan.`}
          </span>
          <ChevronRight size={16} className="shrink-0" aria-hidden />
        </Link>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader
            title="Por plan"
            subtitle="Qué tiene contratado cada empresa"
            action={
              <Link to="/admin/planes" className="text-xs font-medium text-accent hover:underline">
                Ver qué incluye cada plan
              </Link>
            }
          />
          <CardBody className="space-y-1 pt-0">
            {porNivel.map(({ n, total }) => (
              <Link
                key={n}
                to={`/admin/empresas?plan=${n}`}
                className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-surface"
              >
                <Layers size={14} className={n === 'sin' && total > 0 ? 'text-warning' : 'text-fg-faint'} aria-hidden />
                <span className="flex-1 text-fg-body">{FILTRO_NIVEL_LABEL[n]}</span>
                <span className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                  <span
                    className={cn('block h-full rounded-full', n === 'sin' ? 'bg-warning' : 'bg-accent')}
                    style={{ width: `${empresas.length ? Math.round((total / empresas.length) * 100) : 0}%` }}
                  />
                </span>
                <span className="w-6 text-right font-medium tabular-nums text-fg">{total}</span>
              </Link>
            ))}
            <p className="flex flex-wrap gap-1.5 border-t border-border pt-3 text-xs">
              {(['prueba', 'mensual', 'anual', 'dueno'] as Plan[]).map((p) => (
                <Badge key={p} tone={tonoPlan(p)}>
                  {etiquetaPlan(p)}: {porPlan(p)}
                </Badge>
              ))}
            </p>
          </CardBody>
        </Card>

        <div>
          {cargando ? (
            <LoadingState />
          ) : (
            <Card>
              <CardHeader
                title={atencion.length ? 'Requieren atención' : 'Empresas'}
                subtitle={
                  atencion.length
                    ? 'Vencidas, en gracia o por vencer: registra el pago desde la ficha de la empresa'
                    : 'Todas al día'
                }
              />
              <CardBody className="p-0">
                <div className="divide-y divide-border">
                  {(atencion.length ? atencion : filas).map(({ e, estado }) => (
                    <Link
                      key={e.id}
                      to={`/admin/empresas/${e.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-3.5 hover:bg-surface sm:px-5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-fg">{e.nombre}</p>
                        <p
                          className={cn(
                            'text-xs',
                            estado.fase === 'bloqueado' || estado.fase === 'gracia'
                              ? 'text-danger'
                              : estado.fase === 'por_vencer'
                                ? 'text-warning'
                                : 'text-fg-muted'
                          )}
                        >
                          {resumenPlan(e, estado)}
                        </p>
                      </div>
                      <span className="flex shrink-0 items-center gap-2 sm:gap-3">
                        <span className={cn('hidden text-xs sm:inline', e.nivel ? 'text-fg-muted' : 'text-warning')}>
                          {etiquetaNivel(e.nivel)}
                        </span>
                        <Badge tone={tonoPlan(e.plan)}>{etiquetaPlan(e.plan)}</Badge>
                        <ChevronRight size={16} className="text-fg-faint" />
                      </span>
                    </Link>
                  ))}
                  {empresas.length === 0 && (
                    <p className="px-5 py-6 text-sm text-fg-muted">
                      No hay empresas. Ve a <Link to="/admin/empresas" className="text-accent underline">Empresas</Link> para crear la primera.
                    </p>
                  )}
                </div>
                {atencion.length > 0 && (
                  <Link to="/admin/empresas" className="block border-t border-border px-5 py-3 text-xs font-medium text-accent hover:bg-surface">
                    Ver todas las empresas →
                  </Link>
                )}
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  )
}
