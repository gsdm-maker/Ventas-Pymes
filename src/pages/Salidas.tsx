import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PackageMinus, Plus, CloudOff, Check } from 'lucide-react'
import { listarVouchers } from '@/core/data/api'
import type { Voucher as VoucherT } from '@/core/types'
import { useAuth } from '@/core/auth/AuthProvider'
import { useSync } from '@/core/offline/SyncProvider'
import { Card, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState, LoadingState, PageHeader } from '@/components/ui/Feedback'
import { formatFechaHora, formatCLP } from '@/lib/format'

export function Salidas() {
  const { can } = useAuth()
  const { pendientes } = useSync()
  const navigate = useNavigate()
  const [vouchers, setVouchers] = useState<VoucherT[]>([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    listarVouchers()
      .then((v) => setVouchers(v.filter((x) => x.tipo === 'venta' || x.tipo === 'movimiento' || x.tipo === 'devolucion')))
      .finally(() => setCargando(false))
  }, [])

  return (
    <>
      <PageHeader
        title="Salidas y vouchers"
        subtitle="Comprobantes internos de movimiento de inventario"
        actions={
          can('salidas.registrar') && (
            <Button onClick={() => navigate('/salidas/nueva')}>
              <Plus size={16} /> Nueva salida
            </Button>
          )
        }
      />

      {pendientes > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-warning/40 bg-warning-soft px-4 py-2.5 text-xs text-warning">
          <CloudOff size={14} /> {pendientes} operación(es) pendientes de sincronización.
        </div>
      )}

      {cargando ? (
        <LoadingState />
      ) : vouchers.length === 0 ? (
        <EmptyState
          icon={<PackageMinus size={32} />}
          title="Aún no hay salidas registradas"
          description="Las salidas y ventas generan un voucher interno que puedes consultar aquí."
          action={
            can('salidas.registrar') && (
              <Button onClick={() => navigate('/salidas/nueva')}>Registrar primera salida</Button>
            )
          }
        />
      ) : (
        <Card>
          <CardBody className="p-0">
            <div className="divide-y divide-border">
              {vouchers.map((v) => {
                const detalle = v.detalle as { total?: number; cantidad?: number }
                return (
                  <Link
                    key={v.id}
                    to={`/voucher/${v.id}`}
                    className="flex items-center justify-between gap-3 px-5 py-3.5 hover:bg-surface"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-fg">{v.numero}</p>
                      <p className="text-xs text-fg-muted">
                        {v.tipo === 'venta' ? 'Venta' : v.tipo === 'devolucion' ? 'Devolución' : 'Movimiento'} · {formatFechaHora(v.created_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      {typeof detalle.total === 'number' && (
                        <span className={v.tipo === 'devolucion' ? 'text-sm font-semibold tabular-nums text-warning' : 'text-sm font-semibold tabular-nums text-fg'}>
                          {v.tipo === 'devolucion' ? '−' : ''}
                          {formatCLP(detalle.total)}
                        </span>
                      )}
                      <Badge tone={v.estado_sync === 'sincronizado' ? 'success' : 'warning'} dot>
                        {v.estado_sync === 'sincronizado' ? (
                          <>
                            <Check size={11} /> Sincronizado
                          </>
                        ) : (
                          <>Local</>
                        )}
                      </Badge>
                    </div>
                  </Link>
                )
              })}
            </div>
          </CardBody>
        </Card>
      )}
    </>
  )
}
