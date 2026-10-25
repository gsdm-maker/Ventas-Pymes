import { useEffect, useState } from 'react'
import { ArrowLeftRight, Search, Package } from 'lucide-react'
import { useAuth } from '@/core/auth/AuthProvider'
import { listarMovimientos } from '@/core/data/api'
import type { Movimiento, Producto } from '@/core/types'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { SidePanel } from '@/components/ui/SidePanel'
import { EmptyState, LoadingState, PageHeader } from '@/components/ui/Feedback'
import { cn } from '@/lib/cn'
import { formatFechaHora } from '@/lib/format'
import { productoPorId } from '@/core/data/inventario'

// Movimientos por página: el historial completo puede tener miles
const POR_PAGINA = 100

const tipoTono = { entrada: 'success', salida: 'accent', transferencia: 'info', ajuste: 'warning' } as const

function MovimientoDetalleView({ movimiento, ubicaciones }: { movimiento: Movimiento; ubicaciones: { id: string; nombre: string }[] }) {
  const [producto, setProducto] = useState<Producto | null>(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let activo = true
    setCargando(true)
    void productoPorId(movimiento.producto_id).then((p) => {
      if (!activo) return
      setProducto(p)
      setCargando(false)
    })
    return () => { activo = false }
  }, [movimiento.producto_id])

  const nombreUbi = (id: string | null) => id ? ubicaciones.find((u) => u.id === id)?.nombre ?? '—' : '—'

  const campos = [
    { label: 'Tipo', value: <Badge tone={tipoTono[movimiento.tipo]}>{movimiento.tipo}</Badge> },
    { label: 'Cantidad', value: <span className="tabular-nums text-fg">{movimiento.cantidad}</span> },
    { label: 'Fecha', value: formatFechaHora(movimiento.created_at) },
    { label: 'Referencia', value: movimiento.referencia ?? '—' },
    { label: 'Estado', value: (
      <span className={cn('inline-flex items-center gap-1.5 text-xs', movimiento.estado_sync === 'sincronizado' ? 'text-success' : movimiento.estado_sync === 'local' ? 'text-warning' : 'text-danger')}>
        <span className="size-1.5 rounded-full bg-current" />
        {movimiento.estado_sync}
      </span>
    )},
    { label: 'Ubicación origen', value: nombreUbi(movimiento.ubicacion_origen_id) },
    { label: 'Ubicación destino', value: nombreUbi(movimiento.ubicacion_destino_id) },
    { label: 'Observaciones', value: movimiento.observaciones ?? '—' }
  ]

  return (
    <div className="space-y-5">
      <Card>
        <CardBody className="space-y-3">
          {campos.map((c) => (
            <div key={c.label} className="flex items-start justify-between gap-3 text-sm">
              <span className="text-fg-muted">{c.label}</span>
              <span className="text-right text-fg">{c.value}</span>
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Producto" />
        <CardBody>
          {cargando ? (
            <LoadingState label="Cargando producto…" />
          ) : producto ? (
            <div className="flex items-center gap-3">
              {producto.foto_url ? (
                <img src={producto.foto_url} alt="" width={48} height={48} loading="lazy" className="size-12 rounded-lg object-cover" />
              ) : (
                <span className="grid size-12 place-items-center rounded-lg bg-surface-2 text-fg-faint">
                  <Package size={18} />
                </span>
              )}
              <div>
                <p className="font-medium text-fg">{producto.nombre}</p>
                <p className="text-xs text-fg-muted">{producto.sku}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-fg-muted">Producto no encontrado.</p>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

export function Movimientos() {
  const { ubicaciones } = useAuth()
  const [movs, setMovs] = useState<Movimiento[]>([])
  const [total, setTotal] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [cargandoMas, setCargandoMas] = useState(false)
  const [tipo, setTipo] = useState('all')
  const [estado, setEstado] = useState('all')
  const [busqueda, setBusqueda] = useState('')
  const [movimientoSeleccionado, setMovimientoSeleccionado] = useState<Movimiento | null>(null)

  // Los filtros se aplican en el servidor sobre todo el historial (no solo lo descargado)
  const filtros = {
    tipo: tipo === 'all' ? undefined : tipo,
    estado: estado === 'all' ? undefined : estado,
    referencia: busqueda.trim() || undefined,
    cantidad: POR_PAGINA
  }

  useEffect(() => {
    let vigente = true
    setCargando(true)
    // La búsqueda espera a que se deje de escribir
    const t = window.setTimeout(() => {
      listarMovimientos(filtros)
        .then((r) => {
          if (!vigente) return
          setMovs(r.filas)
          setTotal(r.total)
        })
        .finally(() => vigente && setCargando(false))
    }, busqueda ? 300 : 0)
    return () => {
      vigente = false
      window.clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo, estado, busqueda])

  async function cargarMas() {
    setCargandoMas(true)
    try {
      const r = await listarMovimientos({ ...filtros, desde: movs.length })
      setMovs((prev) => [...prev, ...r.filas])
      setTotal(r.total)
    } finally {
      setCargandoMas(false)
    }
  }

  const nombreUbi = (id: string | null) => (id ? ubicaciones.find((u) => u.id === id)?.nombre ?? '—' : '—')

  return (
    <>
      <PageHeader title="Movimientos" subtitle="Trazabilidad de entradas, salidas, transferencias y ajustes" />

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-52 flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint" />
          <Input className="pl-9" placeholder="Buscar por referencia/folio…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </div>
        <Select value={tipo} onChange={(e) => setTipo(e.target.value)} className="w-auto">
          <option value="all">Todos los tipos</option>
          <option value="entrada">Entradas</option>
          <option value="salida">Salidas</option>
          <option value="transferencia">Transferencias</option>
          <option value="ajuste">Ajustes</option>
        </Select>
        <Select value={estado} onChange={(e) => setEstado(e.target.value)} className="w-auto">
          <option value="all">Todo estado</option>
          <option value="sincronizado">Sincronizado</option>
          <option value="local">Local</option>
          <option value="rechazado">Rechazado</option>
        </Select>
      </div>

      {cargando ? (
        <LoadingState />
      ) : movs.length === 0 ? (
        <EmptyState icon={<ArrowLeftRight size={32} />} title="Sin movimientos" description="No hay movimientos que coincidan con los filtros." />
      ) : (
        <Card>
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-fg-muted">
                    <th className="px-4 py-3 font-medium">Fecha</th>
                    <th className="px-4 py-3 font-medium">Tipo</th>
                    <th className="px-4 py-3 font-medium">Ubicación</th>
                    <th className="px-4 py-3 text-right font-medium">Cantidad</th>
                    <th className="px-4 py-3 font-medium">Referencia</th>
                    <th className="px-4 py-3 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {movs.map((m) => (
                    <tr
                      key={m.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`Ver detalle del movimiento ${m.referencia ?? m.tipo}`}
                      onClick={() => setMovimientoSeleccionado(m)}
                      onKeyDown={(e) => e.key === 'Enter' && setMovimientoSeleccionado(m)}
                      className="cursor-pointer border-b border-border/60 last:border-0 transition-colors hover:bg-surface focus-visible:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
                    >
                      <td className="px-4 py-3 text-fg-muted">{formatFechaHora(m.created_at)}</td>
                      <td className="px-4 py-3"><Badge tone={tipoTono[m.tipo]}>{m.tipo}</Badge></td>
                      <td className="px-4 py-3 text-fg-body">{nombreUbi(m.ubicacion_destino_id ?? m.ubicacion_origen_id)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-fg">{m.cantidad}</td>
                      <td className="px-4 py-3 text-fg-muted">{m.referencia ?? '—'}</td>
                      <td className="px-4 py-3">
                        <span className={cn('inline-flex items-center gap-1.5 text-xs', m.estado_sync === 'sincronizado' ? 'text-success' : m.estado_sync === 'local' ? 'text-warning' : 'text-danger')}>
                          <span className="size-1.5 rounded-full bg-current" />
                          {m.estado_sync}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-fg-muted">
              <span className="tabular-nums">
                Mostrando {movs.length.toLocaleString('es-CL')} de {total.toLocaleString('es-CL')} movimientos
              </span>
              {movs.length < total && (
                <Button size="sm" variant="secondary" onClick={() => void cargarMas()} disabled={cargandoMas}>
                  {cargandoMas ? 'Cargando…' : `Cargar ${Math.min(POR_PAGINA, total - movs.length)} más`}
                </Button>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      <SidePanel
        open={!!movimientoSeleccionado}
        onClose={() => setMovimientoSeleccionado(null)}
        title={movimientoSeleccionado ? `Movimiento ${movimientoSeleccionado.referencia ?? movimientoSeleccionado.tipo}` : undefined}
        eyebrow={movimientoSeleccionado ? formatFechaHora(movimientoSeleccionado.created_at) : undefined}
      >
        {movimientoSeleccionado && (
          <MovimientoDetalleView movimiento={movimientoSeleccionado} ubicaciones={ubicaciones} />
        )}
      </SidePanel>
    </>
  )
}
