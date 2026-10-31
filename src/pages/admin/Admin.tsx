import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Building2, ChevronRight, Clock, Lock } from 'lucide-react'
import type { ReactNode } from 'react'
import { listarEmpresas } from '@/core/data/api'
import type { Empresa, Plan } from '@/core/types'
import { AdminTabs } from '@/pages/admin/AdminTabs'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { LoadingState, PageHeader } from '@/components/ui/Feedback'
import { estadoPlan, etiquetaPlan, tonoPlan, resumenPlan, type EstadoPlan } from '@/core/auth/plan'
import { cn } from '@/lib/cn'

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

      <p className="mt-3 flex flex-wrap gap-2 text-xs text-fg-muted">
        {(['prueba', 'mensual', 'anual', 'dueno'] as Plan[]).map((p) => (
          <Badge key={p} tone={tonoPlan(p)}>
            {etiquetaPlan(p)}: {porPlan(p)}
          </Badge>
        ))}
      </p>

      <div className="mt-5">
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
                    <span className="flex shrink-0 items-center gap-3">
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
    </>
  )
}
