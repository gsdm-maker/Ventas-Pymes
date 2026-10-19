import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Building2, ChevronRight, ShieldCheck } from 'lucide-react'
import { listarEmpresas } from '@/core/data/api'
import type { Empresa } from '@/core/types'
import { AdminTabs } from '@/pages/admin/AdminTabs'
import { Card, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { LoadingState, PageHeader } from '@/components/ui/Feedback'
import { PLAN_LABEL } from '@/core/auth/plan'

export function Admin() {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    listarEmpresas().then(setEmpresas).finally(() => setCargando(false))
  }, [])

  const enPrueba = empresas.filter((e) => e.plan === 'prueba').length
  const pagas = empresas.filter((e) => e.plan === 'pago').length

  return (
    <>
      <AdminTabs />
      <PageHeader title="Consola general" subtitle="Administración de la plataforma" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card><CardBody className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-accent"><Building2 size={18} /></span>
          <div><p className="text-2xl font-semibold text-fg">{empresas.length}</p><p className="text-xs text-fg-muted">Empresas</p></div>
        </CardBody></Card>
        <Card><CardBody className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-warning-soft text-warning"><ShieldCheck size={18} /></span>
          <div><p className="text-2xl font-semibold text-fg">{enPrueba}</p><p className="text-xs text-fg-muted">En prueba</p></div>
        </CardBody></Card>
        <Card><CardBody className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-success-soft text-success"><ShieldCheck size={18} /></span>
          <div><p className="text-2xl font-semibold text-fg">{pagas}</p><p className="text-xs text-fg-muted">Con plan de pago</p></div>
        </CardBody></Card>
      </div>

      <div className="mt-5">
        {cargando ? (
          <LoadingState />
        ) : (
          <Card>
            <CardBody className="p-0">
              <div className="divide-y divide-border">
                {empresas.map((e) => (
                  <Link key={e.id} to={`/admin/empresas/${e.id}`} className="flex items-center justify-between px-5 py-4 hover:bg-surface">
                    <span className="text-sm font-medium text-fg">{e.nombre}</span>
                    <span className="flex items-center gap-3">
                      <Badge tone={e.plan === 'pago' ? 'success' : e.plan === 'prueba' ? 'warning' : 'neutral'}>{PLAN_LABEL[e.plan]}</Badge>
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
            </CardBody>
          </Card>
        )}
      </div>
    </>
  )
}
