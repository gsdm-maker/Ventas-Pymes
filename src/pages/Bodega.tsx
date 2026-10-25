import { useEffect, useState } from 'react'
import { Plus, Truck, PackageCheck, Warehouse, X, AlertTriangle, List, Columns3 } from 'lucide-react'
import { useAuth } from '@/core/auth/AuthProvider'
import { invalidarAlertas } from '@/core/data/useAlertasStock'
import { listarProductosConStock, listarTransferencias } from '@/core/data/api'
import type { EstadoTransferencia, ProductoConStock, Transferencia, TransferenciaItem } from '@/core/types'
import { Card, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Field, Input, Select } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { LoadingState, PageHeader } from '@/components/ui/Feedback'
import { useToast } from '@/components/ui/Toast'
import { clave, etiquetaVariante, opcionesProducto } from '@/lib/variantes'
import { SelectorVista, type OpcionVista } from '@/components/ui/SelectorVista'
import { cn } from '@/lib/cn'
import { formatFechaHora } from '@/lib/format'
import { crearTransferencia, despacharTransferencia, itemsDeTransferencias, recibirTransferencia } from '@/core/data/inventario'

const estadoTono: Record<EstadoTransferencia, 'neutral' | 'warning' | 'info' | 'success' | 'danger'> = {
  borrador: 'neutral',
  pendiente_despacho: 'warning',
  en_transito: 'info',
  recibida: 'success',
  recibida_con_diferencias: 'warning',
  cancelada: 'danger'
}
const estadoLabel: Record<EstadoTransferencia, string> = {
  borrador: 'Borrador',
  pendiente_despacho: 'Pendiente de despacho',
  en_transito: 'En tránsito',
  recibida: 'Recibida',
  recibida_con_diferencias: 'Recibida con diferencias',
  cancelada: 'Cancelada'
}

type VistaBodega = 'lista' | 'tablero'
const VISTAS_BODEGA: OpcionVista<VistaBodega>[] = [
  { v: 'lista', etiqueta: 'Vista lista', Icono: List },
  { v: 'tablero', etiqueta: 'Tablero por estado', Icono: Columns3 }
]

export function Bodega() {
  const { ubicaciones, empresa } = useAuth()
  const toast = useToast()
  const [transf, setTransf] = useState<Transferencia[]>([])
  const [items, setItems] = useState<TransferenciaItem[]>([])
  const [productos, setProductos] = useState<ProductoConStock[]>([])
  const [cargando, setCargando] = useState(true)
  const [open, setOpen] = useState(false)

  const [origen, setOrigen] = useState('')
  const [destino, setDestino] = useState('')
  const [obs, setObs] = useState('')
  const [lineas, setLineas] = useState<{ producto_id: string; variante_id: string | null; etiqueta: string; cantidad_enviada: number }[]>([])
  // Recepción: cantidad que realmente llegó por ítem (por defecto, lo enviado)
  const [recibiendo, setRecibiendo] = useState<{ t: Transferencia; cantidades: Record<string, number> } | null>(null)
  const [confirmando, setConfirmando] = useState(false)
  const [sel, setSel] = useState('')
  const [vista, setVista] = useState<VistaBodega>('lista')

  async function cargar() {
    setCargando(true)
    const [t, p] = await Promise.all([listarTransferencias(), listarProductosConStock(null)])
    setTransf(t)
    setProductos(p.filter((x) => x.activo && x.controla_stock !== false))
    setItems(await itemsDeTransferencias(t.slice(0, 200).map((x) => x.id)))
    setCargando(false)
  }

  useEffect(() => {
    void cargar()
  }, [])

  const bodegas = ubicaciones.filter((u) => u.tipo === 'bodega')
  const tiendas = ubicaciones.filter((u) => u.tipo === 'tienda')

  useEffect(() => {
    if (!origen && bodegas[0]) setOrigen(bodegas[0].id)
    if (!destino && tiendas[0]) setDestino(tiendas[0].id)
  }, [bodegas, tiendas, origen, destino])

  async function crear() {
    if (!origen || !destino) return toast('Selecciona origen y destino', 'warning')
    if (lineas.length === 0) return toast('Agrega productos a la transferencia', 'warning')
    const error = await crearTransferencia(
      origen,
      destino,
      lineas.map((l) => ({ producto_id: l.producto_id, variante_id: l.variante_id, cantidad_enviada: l.cantidad_enviada })),
      obs || null
    )
    if (error) return toast(error, 'error')
    toast('Transferencia creada (pendiente de despacho)')
    invalidarAlertas()
    setOpen(false)
    setLineas([])
    setObs('')
    void cargar()
  }

  async function despachar(id: string) {
    const error = await despacharTransferencia(id)
    if (error) return toast(error, 'error')
    toast('Transferencia despachada (en tránsito)')
    invalidarAlertas()
    void cargar()
  }

  function recibir(t: Transferencia) {
    const cantidades: Record<string, number> = {}
    items.filter((i) => i.transferencia_id === t.id).forEach((i) => (cantidades[i.id] = i.cantidad_enviada))
    setRecibiendo({ t, cantidades })
  }

  async function confirmarRecepcion() {
    if (!recibiendo) return
    const itemsT = items.filter((i) => i.transferencia_id === recibiendo.t.id)
    const invalido = itemsT.find((i) => {
      const c = recibiendo.cantidades[i.id]
      return !Number.isInteger(c) || c < 0 || c > i.cantidad_enviada
    })
    if (invalido) return toast('Cada cantidad recibida debe estar entre 0 y lo enviado', 'warning')
    setConfirmando(true)
    const error = await recibirTransferencia(
      recibiendo.t.id,
      itemsT.map((i) => ({ id: i.id, cantidad_recibida: recibiendo.cantidades[i.id] }))
    )
    setConfirmando(false)
    if (error) return toast(error, 'error')
    const faltan = itemsT.reduce((a, i) => a + i.cantidad_enviada - recibiendo.cantidades[i.id], 0)
    toast(faltan > 0 ? `Recepción registrada con diferencias: faltaron ${faltan} u.` : 'Recepción confirmada')
    setRecibiendo(null)
    invalidarAlertas()
    void cargar()
  }

  /** Unidades que faltaron en una transferencia recibida con diferencias */
  const faltantes = (id: string) =>
    items.filter((i) => i.transferencia_id === id).reduce((a, i) => a + Math.max(0, -(i.diferencia ?? 0)), 0)

  const nombreUbi = (id: string) => ubicaciones.find((u) => u.id === id)?.nombre ?? '—'

  const unidades = (id: string) => items.filter((i) => i.transferencia_id === id).reduce((a, i) => a + i.cantidad_enviada, 0)

  function Acciones({ t }: { t: Transferencia }) {
    if (t.estado === 'pendiente_despacho') {
      return (
        <Button size="sm" variant="secondary" onClick={() => void despachar(t.id)}>
          <Truck size={14} /> Despachar
        </Button>
      )
    }
    if (t.estado === 'en_transito') {
      return (
        <Button size="sm" onClick={() => recibir(t)}>
          <PackageCheck size={14} /> Confirmar recepción
        </Button>
      )
    }
    return null
  }

  // Tablero: una columna por etapa; recibidas solo las 10 más recientes
  const columnas: { titulo: string; tono: string; lista: Transferencia[] }[] = [
    { titulo: 'Pendiente de despacho', tono: 'bg-warning', lista: transf.filter((t) => t.estado === 'pendiente_despacho') },
    { titulo: 'En tránsito', tono: 'bg-info', lista: transf.filter((t) => t.estado === 'en_transito') },
    {
      titulo: 'Recibidas',
      tono: 'bg-success',
      lista: transf.filter((t) => t.estado === 'recibida' || t.estado === 'recibida_con_diferencias').slice(0, 10)
    }
  ]

  return (
    <>
      <PageHeader
        title="Bodega y transferencias"
        subtitle={empresa?.nombre}
        actions={
          <>
            <SelectorVista valor={vista} onChange={setVista} opciones={VISTAS_BODEGA} />
            <Button onClick={() => setOpen(true)}>
              <Plus size={16} /> Nueva transferencia
            </Button>
          </>
        }
      />

      {cargando ? (
        <LoadingState />
      ) : transf.length === 0 ? (
        <Card><CardBody className="py-14 text-center text-sm text-fg-muted">
          <Warehouse className="mx-auto mb-3 text-fg-faint" size={32} />
          No hay transferencias registradas.
        </CardBody></Card>
      ) : vista === 'tablero' ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {columnas.map((c) => (
            <section key={c.titulo} className="flex min-w-0 flex-col rounded-2xl border border-border bg-surface/50 p-3">
              <h2 className="mb-3 flex items-center justify-between px-1 text-sm font-semibold text-fg">
                <span className="flex items-center gap-2">
                  <span className={cn('size-2 rounded-full', c.tono)} aria-hidden />
                  {c.titulo}
                </span>
                <span className="rounded-full bg-panel px-2 py-0.5 text-xs font-medium tabular-nums text-fg-muted">{c.lista.length}</span>
              </h2>
              <div className="space-y-2">
                {c.lista.length === 0 && <p className="px-1 py-6 text-center text-xs text-fg-faint">Nada en esta etapa.</p>}
                {c.lista.map((t) => (
                  <article key={t.id} className="rounded-xl border border-border bg-panel p-3 shadow-card">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-fg">{t.folio}</p>
                      <span className="text-xs tabular-nums text-fg-muted">{unidades(t.id)} u.</span>
                    </div>
                    <p className="mt-0.5 text-xs text-fg-body">
                      {nombreUbi(t.origen_id)} → {nombreUbi(t.destino_id)}
                    </p>
                    <p className="mt-0.5 text-[11px] text-fg-faint">
                      {formatFechaHora(t.recibida_at ?? t.despachada_at ?? t.created_at)}
                    </p>
                    {t.estado === 'recibida_con_diferencias' && faltantes(t.id) > 0 && (
                      <p className="mt-1 flex items-center gap-1 text-xs text-warning">
                        <AlertTriangle size={12} aria-hidden /> Faltaron {faltantes(t.id)} u.
                      </p>
                    )}
                    {(t.estado === 'pendiente_despacho' || t.estado === 'en_transito') && (
                      <div className="mt-2">
                        <Acciones t={t} />
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <Card>
          <CardBody className="p-0">
            <div className="divide-y divide-border">
              {transf.map((t) => (
                <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <div>
                    <p className="text-sm font-medium text-fg">{t.folio}</p>
                    <p className="text-xs text-fg-muted">
                      {nombreUbi(t.origen_id)} → {nombreUbi(t.destino_id)}
                    </p>
                    {t.estado === 'recibida_con_diferencias' && faltantes(t.id) > 0 && (
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-warning">
                        <AlertTriangle size={12} aria-hidden /> Faltaron {faltantes(t.id)} u. al recibir
                      </p>
                    )}
                  </div>
                  <Badge tone={estadoTono[t.estado]} dot>{estadoLabel[t.estado]}</Badge>
                  <div className="flex gap-2">
                    <Acciones t={t} />
                  </div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Nueva transferencia"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={() => void crear()}>Crear transferencia</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Ubicación de origen" required>
              <Select value={origen} onChange={(e) => setOrigen(e.target.value)}>
                {ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </Select>
            </Field>
            <Field label="Destino (tienda)" required>
              <Select value={destino} onChange={(e) => setDestino(e.target.value)}>
                {ubicaciones.filter((u) => u.id !== origen).map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </Select>
            </Field>
          </div>

          <div className="flex gap-2">
            <Select value={sel} onChange={(e) => setSel(e.target.value)}>
              <option value="">Agregar producto…</option>
              {opcionesProducto(productos, true).map((o) => <option key={o.clave} value={o.clave}>{o.etiqueta}</option>)}
            </Select>
            <Button
              variant="secondary"
              disabled={!sel}
              onClick={() => {
                const o = opcionesProducto(productos, true).find((x) => x.clave === sel)
                if (o && !lineas.some((l) => clave(l.producto_id, l.variante_id) === o.clave))
                  setLineas((prev) => [...prev, { producto_id: o.producto_id, variante_id: o.variante_id, etiqueta: o.etiqueta, cantidad_enviada: 1 }])
                setSel('')
              }}
            >
              <Plus size={16} />
            </Button>
          </div>

          <div className="divide-y divide-border">
            {lineas.map((l) => {
              const p = productos.find((x) => x.id === l.producto_id)
              return (
                <div key={clave(l.producto_id, l.variante_id)} className="flex items-center gap-3 py-2">
                  <span className="flex-1 truncate text-sm text-fg">{l.etiqueta.split(' · ').slice(1).join(' · ') || p?.nombre}</span>
                  <Input
                    type="number"
                    min={1}
                    value={l.cantidad_enviada}
                    onChange={(e) =>
                      setLineas((prev) => prev.map((x) => x === l ? { ...x, cantidad_enviada: Number(e.target.value) || 0 } : x))
                    }
                    className="w-24 py-1.5 text-center"
                  />
                  <button onClick={() => setLineas((prev) => prev.filter((x) => x !== l))} aria-label={`Quitar ${p?.nombre} de la transferencia`} className="text-fg-muted hover:text-danger"><X size={16} /></button>
                </div>
              )
            })}
          </div>

          <Field label="Observaciones">
            <Input value={obs} onChange={(e) => setObs(e.target.value)} />
          </Field>
          <p className="text-xs text-fg-muted">
            Al crear, el stock se reserva en el origen. Al despachar pasa a tránsito y al recibir se
            suma a la tienda. Una transferencia no se contabiliza dos veces.
          </p>
        </div>
      </Modal>

      <Modal
        open={!!recibiendo}
        onClose={() => setRecibiendo(null)}
        title={`Recibir ${recibiendo?.t.folio ?? ''}`}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRecibiendo(null)}>Cancelar</Button>
            <Button onClick={() => void confirmarRecepcion()} disabled={confirmando}>
              <PackageCheck size={16} /> {confirmando ? 'Registrando…' : 'Confirmar recepción'}
            </Button>
          </>
        }
      >
        {recibiendo && (() => {
          const itemsT = items.filter((i) => i.transferencia_id === recibiendo.t.id)
          const faltan = itemsT.reduce((a, i) => a + i.cantidad_enviada - (recibiendo.cantidades[i.id] ?? 0), 0)
          return (
            <div className="space-y-4">
              <p className="text-sm text-fg-body">
                {nombreUbi(recibiendo.t.origen_id)} → {nombreUbi(recibiendo.t.destino_id)}. Cuenta lo que llegó
                y corrige la cantidad si falta algo.
              </p>
              <div className="overflow-hidden rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface text-left text-xs text-fg-muted">
                      <th className="px-3 py-2 font-medium">Producto</th>
                      <th className="px-3 py-2 text-right font-medium">Enviado</th>
                      <th className="px-3 py-2 text-right font-medium">Recibido</th>
                      <th className="px-3 py-2 text-right font-medium">Diferencia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itemsT.map((i) => {
                      const p = productos.find((x) => x.id === i.producto_id)
                      const v = p?.variantes.find((x) => x.id === i.variante_id)
                      const rec = recibiendo.cantidades[i.id] ?? 0
                      const dif = rec - i.cantidad_enviada
                      return (
                        <tr key={i.id} className="border-b border-border/60 last:border-0">
                          <td className="px-3 py-2 text-fg">
                            {p?.nombre ?? 'Producto'}
                            {v && <span className="text-fg-muted"> · {etiquetaVariante(v)}</span>}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-fg-body">{i.cantidad_enviada}</td>
                          <td className="px-3 py-2 text-right">
                            <Input
                              type="number"
                              inputMode="numeric"
                              min={0}
                              max={i.cantidad_enviada}
                              aria-label={`Recibido de ${p?.nombre ?? 'producto'}`}
                              value={rec}
                              onChange={(e) =>
                                setRecibiendo({
                                  ...recibiendo,
                                  cantidades: { ...recibiendo.cantidades, [i.id]: Math.max(0, Math.min(i.cantidad_enviada, Number(e.target.value) || 0)) }
                                })
                              }
                              className="ml-auto w-20 py-1.5 text-center"
                            />
                          </td>
                          <td className={dif < 0 ? 'px-3 py-2 text-right font-medium tabular-nums text-warning' : 'px-3 py-2 text-right tabular-nums text-fg-muted'}>
                            {dif < 0 ? dif : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {faltan > 0 ? (
                <p className="flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2 text-xs text-warning">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
                  Faltan {faltan} u.: la transferencia quedará como «Recibida con diferencias» y a la tienda
                  solo se sumará lo recibido.
                </p>
              ) : (
                <p className="text-xs text-fg-muted">Todo llegó completo: se sumará lo enviado a la tienda.</p>
              )}
            </div>
          )
        })()}
      </Modal>
    </>
  )
}

