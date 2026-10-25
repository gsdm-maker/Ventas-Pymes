import { useCallback, useEffect, useRef, useState } from 'react'
import { ChefHat, Undo2, Volume2, VolumeX } from 'lucide-react'
import { useAuth } from '@/core/auth/AuthProvider'
import { comandasCocina, type ComandaCocina } from '@/core/data/api'
import { useTiempoReal } from '@/core/data/useTiempoReal'
import type { EstadoComanda } from '@/core/types'
import { Button } from '@/components/ui/Button'
import { EmptyState, LoadingState, PageHeader } from '@/components/ui/Feedback'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/cn'
import { formatHora } from '@/lib/format'
import { cambiarEstadoComanda } from '@/core/data/restaurante'

const COLUMNAS: { estado: EstadoComanda; titulo: string; tono: string; accion: string; siguiente: EstadoComanda }[] = [
  { estado: 'pendiente', titulo: 'Por preparar', tono: 'bg-warning', accion: 'Empezar', siguiente: 'preparando' },
  { estado: 'preparando', titulo: 'En preparación', tono: 'bg-info', accion: 'Listo', siguiente: 'lista' },
  { estado: 'lista', titulo: 'Listas para servir', tono: 'bg-success', accion: 'Entregada', siguiente: 'entregada' }
]
const ANTERIOR: Partial<Record<EstadoComanda, EstadoComanda>> = { preparando: 'pendiente', lista: 'preparando' }

function leerSonido() {
  try {
    return localStorage.getItem('misociopyme:cocina:sonido') !== 'no'
  } catch {
    return true
  }
}

/** Pitido corto al llegar una comanda nueva (sin archivos de audio). */
function pitar() {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gan = ctx.createGain()
    osc.frequency.value = 880
    gan.gain.setValueAtTime(0.15, ctx.currentTime)
    gan.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35)
    osc.connect(gan).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.35)
    osc.onended = () => void ctx.close()
  } catch {
    // Sin audio disponible: no pasa nada
  }
}

export function Cocina() {
  const { ubicacionActiva, ubicaciones } = useAuth()
  const toast = useToast()
  const [comandas, setComandas] = useState<ComandaCocina[] | null>(null)
  const [ahora, setAhora] = useState(() => Date.now())
  const [sonido, setSonido] = useState(leerSonido)
  const [enviando, setEnviando] = useState<string | null>(null)
  const vistas = useRef<Set<string> | null>(null)
  const ubicacion = ubicaciones.find((u) => u.id === ubicacionActiva)

  const cargar = useCallback(async () => {
    if (!ubicacionActiva) return
    try {
      const lista = await comandasCocina(ubicacionActiva)
      // Pitido solo por comandas que no estaban (no en la primera carga)
      const nuevas = vistas.current ? lista.filter((c) => c.estado === 'pendiente' && !vistas.current!.has(c.id)) : []
      vistas.current = new Set(lista.map((c) => c.id))
      if (nuevas.length && sonido) pitar()
      setComandas(lista)
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }, [ubicacionActiva, sonido, toast])

  useEffect(() => {
    vistas.current = null
    setComandas(null)
    void cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ubicacionActiva])

  useTiempoReal(ubicacionActiva, ['comandas', 'cuenta_items'], () => void cargar())

  // Minutos de espera al día
  useEffect(() => {
    const t = window.setInterval(() => setAhora(Date.now()), 30000)
    return () => window.clearInterval(t)
  }, [])

  function alternarSonido() {
    const v = !sonido
    setSonido(v)
    try {
      localStorage.setItem('misociopyme:cocina:sonido', v ? 'si' : 'no')
    } catch {
      // Preferencia solo para esta sesión
    }
    if (v) pitar()
  }

  async function mover(c: ComandaCocina, estado: EstadoComanda) {
    setEnviando(c.id)
    // Optimista: la tarjeta cambia de columna al instante
    setComandas((prev) => prev && (estado === 'entregada' ? prev.filter((x) => x.id !== c.id) : prev.map((x) => (x.id === c.id ? { ...x, estado } : x))))
    const error = await cambiarEstadoComanda(c.id, estado)
    setEnviando(null)
    if (error) toast(error, 'error')
    void cargar()
  }

  if (!ubicacion || ubicacion.tipo !== 'tienda') {
    return (
      <>
        <PageHeader title="Cocina" />
        <EmptyState icon={<ChefHat size={22} />} title="Elige un local" description="Selecciona arriba la tienda o local cuyas comandas quieres ver." />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Cocina"
        subtitle={`${ubicacion.nombre} · las comandas llegan solas desde Mesas`}
        actions={
          <Button variant="secondary" size="sm" onClick={alternarSonido} aria-pressed={sonido}>
            {sonido ? <Volume2 size={15} /> : <VolumeX size={15} />}
            {sonido ? 'Sonido activado' : 'Sin sonido'}
          </Button>
        }
      />

      {comandas === null ? (
        <LoadingState />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {COLUMNAS.map((col) => {
            const lista = comandas.filter((c) => c.estado === col.estado)
            return (
              <section key={col.estado} className="flex min-w-0 flex-col rounded-2xl border border-border bg-surface/50 p-3">
                <h2 className="mb-3 flex items-center justify-between px-1 text-sm font-semibold text-fg">
                  <span className="flex items-center gap-2">
                    <span className={cn('size-2 rounded-full', col.tono)} aria-hidden />
                    {col.titulo}
                  </span>
                  <span className="rounded-full bg-panel px-2 py-0.5 text-xs font-medium tabular-nums text-fg-muted">{lista.length}</span>
                </h2>
                <div className="space-y-3">
                  {lista.length === 0 && <p className="px-1 py-8 text-center text-xs text-fg-faint">Nada por aquí.</p>}
                  {lista.map((c) => {
                    const min = Math.max(0, Math.floor((ahora - new Date(c.created_at).getTime()) / 60000))
                    const atrasada = col.estado !== 'lista' && min >= 20
                    const demorada = col.estado !== 'lista' && min >= 12
                    return (
                      <article
                        key={c.id}
                        className={cn('rounded-xl border bg-panel p-3 shadow-card', atrasada ? 'border-danger' : 'border-border')}
                      >
                        <header className="mb-2 flex items-start justify-between gap-2">
                          <div>
                            <p className="text-base font-semibold text-fg">{c.mesa}</p>
                            <p className="text-xs text-fg-muted">
                              Comanda #{c.numero} · {formatHora(c.created_at)}
                            </p>
                          </div>
                          <span
                            className={cn(
                              'rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums',
                              atrasada ? 'bg-danger-soft text-danger' : demorada ? 'bg-warning-soft text-warning' : 'bg-surface-2 text-fg-body'
                            )}
                          >
                            {min} min
                          </span>
                        </header>
                        <ul className="space-y-1.5 border-t border-border pt-2">
                          {c.items.map((i) => (
                            <li key={i.id} className="text-sm">
                              <span className="font-semibold tabular-nums text-fg">{i.cantidad}×</span>{' '}
                              <span className="text-fg">{i.descripcion}</span>
                              {i.nota && <span className="mt-0.5 block rounded-md bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">{i.nota}</span>}
                            </li>
                          ))}
                        </ul>
                        <div className="mt-3 flex gap-2">
                          {ANTERIOR[c.estado] && (
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Devolver comanda #${c.numero} a la columna anterior`}
                              disabled={enviando === c.id}
                              onClick={() => void mover(c, ANTERIOR[c.estado]!)}
                            >
                              <Undo2 size={14} />
                            </Button>
                          )}
                          <Button
                            className="flex-1"
                            size="sm"
                            variant={col.estado === 'lista' ? 'secondary' : 'primary'}
                            disabled={enviando === c.id}
                            onClick={() => void mover(c, col.siguiente)}
                          >
                            {col.accion}
                          </Button>
                        </div>
                      </article>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </>
  )
}
