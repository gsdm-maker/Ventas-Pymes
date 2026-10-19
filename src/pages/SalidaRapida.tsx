import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Minus, Plus, Check, ArrowLeft, CloudOff } from 'lucide-react'
import { useAuth } from '@/core/auth/AuthProvider'
import { useSync } from '@/core/offline/SyncProvider'
import { esErrorDeRed } from '@/core/offline/errores'
import { invalidarAlertas } from '@/core/data/useAlertasStock'
import { supabase } from '@/core/supabase/client'
import { listarMotivos, listarProductosConStock } from '@/core/data/api'
import { pendientesPorProducto } from '@/core/offline/respaldo'
import { aplicarPendientes, etiquetaVariante } from '@/lib/variantes'
import type { MotivoSalida, ProductoConStock } from '@/core/types'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { Card, CardBody } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/Feedback'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/cn'
import { formatCLP } from '@/lib/format'

export function SalidaRapida() {
  const { ubicacionActiva, ubicaciones } = useAuth()
  const { online, encolarOperacion } = useSync()
  const toast = useToast()
  const navigate = useNavigate()

  const [productos, setProductos] = useState<ProductoConStock[]>([])
  const [motivos, setMotivos] = useState<MotivoSalida[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [sel, setSel] = useState<ProductoConStock | null>(null)
  const [cantidad, setCantidad] = useState(1)
  // undefined = falta elegir talla; null = sin talla (o producto sin variantes)
  const [varSel, setVarSel] = useState<string | null | undefined>(undefined)
  const [motivo, setMotivo] = useState('')
  const [obs, setObs] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [ok, setOk] = useState<{ numero: string; offline: boolean } | null>(null)

  const ubicacionNombre = ubicaciones.find((u) => u.id === ubicacionActiva)?.nombre ?? ''

  useEffect(() => {
    listarMotivos().then(setMotivos)
  }, [])

  useEffect(() => {
    if (!ubicacionActiva) return
    // Solo productos con inventario; stock menos lo que aún está en la cola offline
    Promise.all([listarProductosConStock(ubicacionActiva), pendientesPorProducto(ubicacionActiva)])
      .then(([lista, pendientes]) =>
        setProductos(aplicarPendientes(lista.filter((x) => x.activo && x.controla_stock !== false), pendientes))
      )
      .catch(() => toast('No hay copia local del catálogo: conéctate una vez para descargarlo', 'error'))
  }, [ubicacionActiva, toast])

  const resultados = useMemo(() => {
    const t = busqueda.trim().toLowerCase()
    if (!t) return productos.slice(0, 12)
    return productos
      .filter(
        (p) =>
          p.nombre.toLowerCase().includes(t) ||
          p.sku.toLowerCase().includes(t) ||
          (p.codigo_barras ?? '').includes(t)
      )
      .slice(0, 20)
  }, [productos, busqueda])

  // Stock de lo elegido: la variante, el stock antiguo sin talla o el producto
  const tieneVariantes = !!sel?.variantes?.length
  const disponibleSel = !sel
    ? 0
    : !tieneVariantes
      ? sel.disponible
      : varSel === undefined
        ? 0
        : varSel === null
          ? sel.legado
          : sel.variantes.find((v) => v.id === varSel)?.disponible ?? 0

  // Refleja la salida en pantalla (producto y talla) sin volver a consultar
  function descontarLocal() {
    if (!sel) return
    setProductos((prev) =>
      prev.map((p) =>
        p.id !== sel.id
          ? p
          : {
              ...p,
              disponible: Math.max(0, p.disponible - cantidad),
              legado: varSel === null && p.variantes.length ? Math.max(0, p.legado - cantidad) : p.legado,
              variantes: p.variantes.map((v) => (v.id === varSel ? { ...v, disponible: Math.max(0, v.disponible - cantidad) } : v))
            }
      )
    )
  }

  async function confirmar() {
    if (!sel || !ubicacionActiva) return
    if (tieneVariantes && varSel === undefined) {
      toast('Elige la talla o color', 'warning')
      return
    }
    if (cantidad < 1 || cantidad > disponibleSel) {
      toast('Cantidad inválida para el stock disponible', 'warning')
      return
    }
    setEnviando(true)
    const uuidLocal = crypto.randomUUID()

    const guardarOffline = async () => {
      await encolarOperacion(
        'salida',
        {
          producto_id: sel.id,
          variante_id: varSel ?? null,
          ubicacion_id: ubicacionActiva,
          cantidad,
          motivo_id: motivo || null,
          observaciones: obs || null
        },
        uuidLocal
      )
      setOk({ numero: 'Pendiente de sincronización', offline: true })
      descontarLocal()
      setEnviando(false)
    }

    if (!online) return guardarOffline()

    const { data, error, status } = await supabase.rpc('registrar_salida', {
      p_producto: sel.id,
      p_variante: varSel ?? null,
      p_ubicacion: ubicacionActiva,
      p_cantidad: cantidad,
      p_motivo: motivo || null,
      p_observaciones: obs || null,
      p_uuid_local: uuidLocal
    })
    if (esErrorDeRed(error, status)) return guardarOffline()
    setEnviando(false)
    if (error) {
      toast(error.message, 'error')
      return
    }
    const v = data as { numero: string; id: string }
    invalidarAlertas()
    setOk({ numero: v.numero, offline: false })
    descontarLocal()
  }

  if (ok) {
    return (
      <div className="mx-auto max-w-md">
        <Card>
          <CardBody className="text-center">
            <div className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-success-soft text-success">
              <Check size={28} />
            </div>
            <h2 className="text-lg font-semibold text-fg">Salida registrada</h2>
            <p className="mt-1 text-sm text-fg-muted">Voucher {ok.numero}</p>
            {ok.offline && (
              <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-warning">
                <CloudOff size={13} /> Se sincronizará al recuperar la conexión.
              </p>
            )}
            <div className="mt-5 flex gap-2">
              <Button variant="secondary" block onClick={() => setOk(null)}>
                Nuevo movimiento
              </Button>
              <Button block onClick={() => navigate('/salidas')}>
                Ver historial
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md">
      <PageHeader
        title="Salida rápida"
        subtitle={`Descuenta stock en ${ubicacionNombre}`}
        actions={
          <Button variant="ghost" size="sm" onClick={() => navigate('/salidas')}>
            <ArrowLeft size={16} /> Volver
          </Button>
        }
      />

      {!sel ? (
        <>
          <div className="relative mb-3">
            <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-fg-faint" />
            <Input
              className="h-12 pl-10 text-base"
              placeholder="Buscar producto o SKU…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {resultados.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setSel(p)
                  setCantidad(1)
                  setVarSel(p.variantes?.length ? undefined : null)
                }}
                className="flex flex-col overflow-hidden rounded-xl border border-border bg-panel p-2.5 text-left active:scale-[0.98]"
              >
                {p.foto_url ? (
                  <img src={p.foto_url} alt="" width={320} height={112} loading="lazy" className="mb-2 h-28 w-full rounded-lg object-cover" />
                ) : (
                  <div className="mb-2 h-28 w-full rounded-lg bg-surface-2" />
                )}
                <p className="line-clamp-2 text-xs font-medium text-fg">{p.nombre}</p>
                <p className={cn('mt-1 text-xs', p.disponible <= 0 ? 'text-danger' : 'text-fg-muted')}>
                  Stock: {p.disponible}
                </p>
              </button>
            ))}
          </div>
        </>
      ) : (
        <Card>
          <CardBody className="space-y-4">
            <div className="flex gap-3">
              {sel.foto_url ? (
                <img src={sel.foto_url} alt="" width={80} height={80} loading="lazy" className="size-20 rounded-xl object-cover" />
              ) : (
                <div className="size-20 rounded-xl bg-surface-2" />
              )}
              <div className="min-w-0">
                <p className="font-medium text-fg">{sel.nombre}</p>
                <p className="text-xs text-fg-muted">{sel.sku}</p>
                <p className="tabular-nums mt-1 text-sm font-semibold text-accent">{formatCLP(sel.precio_venta)}</p>
                <p className="text-xs text-fg-muted">
                  Disponible: {tieneVariantes && varSel === undefined ? 'elige talla' : disponibleSel}
                </p>
              </div>
            </div>

            {tieneVariantes && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-fg-body">Talla o color</p>
                <div className="flex flex-wrap gap-2">
                  {sel.variantes.map((v) => (
                    <button
                      key={v.id}
                      disabled={v.disponible <= 0}
                      aria-pressed={varSel === v.id}
                      onClick={() => {
                        setVarSel(v.id)
                        setCantidad(1)
                      }}
                      className={cn(
                        'rounded-xl border px-3 py-2 text-left text-sm transition-colors disabled:opacity-40',
                        varSel === v.id ? 'border-accent bg-accent-soft/50 text-fg' : 'border-border text-fg-body hover:bg-surface'
                      )}
                    >
                      <span className="block font-medium">{etiquetaVariante(v) || v.sku}</span>
                      <span className="text-xs tabular-nums text-fg-muted">{v.disponible} u.</span>
                    </button>
                  ))}
                  {sel.legado > 0 && (
                    <button
                      aria-pressed={varSel === null}
                      onClick={() => setVarSel(null)}
                      className={cn(
                        'rounded-xl border border-dashed px-3 py-2 text-left text-sm',
                        varSel === null ? 'border-accent bg-accent-soft/50' : 'border-border hover:bg-surface'
                      )}
                    >
                      <span className="block font-medium">Sin talla</span>
                      <span className="text-xs tabular-nums text-fg-muted">{sel.legado} u. antiguas</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            <div>
              <p className="mb-1.5 text-xs font-medium text-fg-body">Cantidad</p>
              <div className="flex items-center justify-center gap-4">
                <button
                  onClick={() => setCantidad((c) => Math.max(1, c - 1))}
                  aria-label="Disminuir cantidad"
                  className="grid size-12 place-items-center rounded-xl bg-surface-2 text-fg active:scale-95"
                >
                  <Minus size={20} />
                </button>
                <input
                  type="number"
                  value={cantidad}
                  onChange={(e) => setCantidad(Math.max(1, Number(e.target.value) || 1))}
                  className="h-12 w-20 rounded-xl border border-border bg-field text-center text-lg font-semibold text-fg"
                />
                <button
                  onClick={() => setCantidad((c) => Math.min(Math.max(1, disponibleSel), c + 1))}
                  aria-label="Aumentar cantidad"
                  className="grid size-12 place-items-center rounded-xl bg-surface-2 text-fg active:scale-95"
                >
                  <Plus size={20} />
                </button>
              </div>
            </div>

            {motivos.length > 0 && (
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-fg-body">Motivo de salida</span>
                <Select value={motivo} onChange={(e) => setMotivo(e.target.value)}>
                  <option value="">Sin especificar</option>
                  {motivos.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nombre}
                    </option>
                  ))}
                </Select>
              </label>
            )}

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-fg-body">Observaciones</span>
              <Input
                placeholder="Opcional"
                value={obs}
                onChange={(e) => setObs(e.target.value)}
              />
            </label>

            <Button block size="xl" disabled={enviando} onClick={() => void confirmar()}>
              {enviando ? 'Registrando…' : 'Confirmar salida'}
            </Button>
            <Button variant="ghost" block onClick={() => setSel(null)}>
              Elegir otro producto
            </Button>
          </CardBody>
        </Card>
      )}
    </div>
  )
}
