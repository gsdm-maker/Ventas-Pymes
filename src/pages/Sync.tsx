import { useEffect, useState } from 'react'
import { CloudOff, RefreshCw, CheckCircle2, AlertTriangle, Wifi } from 'lucide-react'
import { useSync } from '@/core/offline/SyncProvider'
import { useAuth } from '@/core/auth/AuthProvider'
import { useConfirm } from '@/components/ui/confirm'
import { listarCola, quitarDeCola, reactivar, type OperacionPendiente } from '@/core/offline/db'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { PageHeader } from '@/components/ui/Feedback'
import { hace } from '@/lib/format'

export function Sync() {
  const { online, pendientes, ultimaSync, sincronizando, errores, sincronizar, refrescarEstado } = useSync()
  const { session } = useAuth()
  const confirmar = useConfirm()
  const userId = session?.user.id
  const [cola, setCola] = useState<OperacionPendiente[]>([])

  useEffect(() => {
    if (userId) listarCola(userId).then(setCola)
  }, [userId, pendientes, errores, sincronizando])

  async function reintentar(op: OperacionPendiente) {
    await reactivar(op.key)
    await sincronizar()
  }

  async function descartar(op: OperacionPendiente) {
    const ok = await confirmar({
      titulo: 'Descartar operación',
      mensaje: `La ${op.tipo} guardada sin conexión no se registrará en el sistema.`,
      accion: 'Descartar'
    })
    if (!ok) return
    await quitarDeCola(op.key)
    await refrescarEstado()
  }

  return (
    <>
      <PageHeader title="Sincronización" subtitle="Estado de la operación offline" />

      <div className="grid gap-5 lg:grid-cols-3">
        <Card>
          <CardBody className="text-center">
            {online ? (
              <Wifi className="mx-auto mb-3 text-success" size={36} />
            ) : (
              <CloudOff className="mx-auto mb-3 text-warning" size={36} />
            )}
            <p className="text-lg font-semibold text-fg">{online ? 'Conectado' : 'Sin conexión'}</p>
            <p className="mt-1 text-sm text-fg-muted">Última sincronización: {hace(ultimaSync)}</p>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="text-center">
            <CheckCircle2 className="mx-auto mb-3 text-accent" size={36} />
            <p className="text-3xl font-semibold tabular-nums text-fg">{pendientes}</p>
            <p className="mt-1 text-sm text-fg-muted">Operaciones pendientes</p>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="text-center">
            <AlertTriangle className={`mx-auto mb-3 ${errores > 0 ? 'text-danger' : 'text-fg-faint'}`} size={36} />
            <p className="text-3xl font-semibold tabular-nums text-fg">{errores}</p>
            <p className="mt-1 text-sm text-fg-muted">Errores que requieren revisión</p>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader
          title="Cola de operaciones"
          subtitle="Movimientos guardados localmente"
          action={
            <Button size="sm" disabled={!online || sincronizando} onClick={() => void sincronizar()}>
              <RefreshCw size={14} className={sincronizando ? 'animate-spin' : ''} />
              Reintentar sincronización
            </Button>
          }
        />
        <CardBody className="p-0">
          {cola.length === 0 ? (
            <p className="px-5 py-6 text-sm text-fg-muted">No hay operaciones en cola. Todo está sincronizado.</p>
          ) : (
            <div className="divide-y divide-border">
              {cola.map((op) => (
                <div key={op.key} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="capitalize text-fg">{op.tipo}</p>
                    <p className="text-xs text-fg-muted">{op.uuid_local.slice(0, 8)}… · guardado {hace(op.creado)}</p>
                    {op.estado === 'rechazado' && op.error && (
                      <p className="mt-1 text-xs text-danger">Rechazada: {op.error}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {op.estado === 'rechazado' ? (
                      <>
                        <Badge tone="danger">Rechazada</Badge>
                        <Button size="sm" variant="secondary" disabled={!online || sincronizando} onClick={() => void reintentar(op)}>
                          Reintentar
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void descartar(op)}>
                          Descartar
                        </Button>
                      </>
                    ) : (
                      <Badge tone={op.intentos > 0 ? 'warning' : 'neutral'}>
                        {op.intentos > 0 ? `${op.intentos} intento(s)` : 'En espera'}
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </>
  )
}
