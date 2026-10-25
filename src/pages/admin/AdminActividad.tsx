import { useEffect, useState } from 'react'
import { Building2, ScrollText } from 'lucide-react'
import { AdminTabs } from '@/pages/admin/AdminTabs'
import { Card, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { EmptyState, LoadingState, PageHeader } from '@/components/ui/Feedback'
import { formatFechaHora } from '@/lib/format'
import { listarAuditoria, type FilaAuditoria } from '@/core/data/admin'

type Auditoria = FilaAuditoria

export function AdminActividad() {
  const [filas, setFilas] = useState<Auditoria[]>([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    void listarAuditoria().then((f) => {
      setFilas(f)
      setCargando(false)
    })
  }, [])

  return (
    <>
      <AdminTabs />
      <PageHeader title="Actividad" subtitle="Registro de acciones administrativas" />

      {cargando ? (
        <LoadingState />
      ) : filas.length === 0 ? (
        <EmptyState icon={<ScrollText size={32} />} title="Sin actividad registrada" description="Las acciones del administrador general aparecerán aquí." />
      ) : (
        <Card>
          <CardBody className="p-0">
            <div className="divide-y divide-border">
              {filas.map((f) => (
                <div key={f.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge tone="neutral">{f.accion}</Badge>
                    <span className="text-xs text-fg-muted">
                      {f.detalle ? Object.entries(f.detalle).map(([k, v]) => `${k}=${String(v)}`).join(' · ') : ''}
                    </span>
                  </div>
                  <span className="whitespace-nowrap text-xs text-fg-faint">{formatFechaHora(f.created_at)}</span>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}
    </>
  )
}

export { Building2 }
