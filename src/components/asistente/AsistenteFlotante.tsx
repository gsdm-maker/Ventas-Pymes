import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowUp, RotateCcw, Sparkles, WifiOff } from 'lucide-react'
import { useAuth } from '@/core/auth/AuthProvider'
import { miUsoIa, preguntarAsistente, type TurnoAsistente } from '@/core/data/api'
import type { UsoIa } from '@/core/types'
import { SidePanel } from '@/components/ui/SidePanel'
import { cn } from '@/lib/cn'

interface Mensaje extends TurnoAsistente {
  error?: boolean
}

const SUGERENCIAS = [
  '¿Qué debo tener en stock para este fin de semana?',
  '¿Cómo va mi negocio este mes?',
  '¿En qué horario me conviene abrir?',
  '¿Qué productos me dejan más margen y cuáles no se mueven?'
]

/**
 * Botón flotante y chat con el asistente (Socio IA). Solo aparece si la empresa tiene plan de
 * asistente y la persona tiene el permiso; los topes los controla el servidor.
 */
export function AsistenteFlotante() {
  const { empresa, profile, can, ubicacionActiva } = useAuth()
  const habilitado = !!empresa?.plan_ia && can('asistente.usar')
  const [abierto, setAbierto] = useState(false)

  if (!habilitado || !profile) return null

  return (
    <>
      {!abierto && (
        <button
          onClick={() => setAbierto(true)}
          className={cn(
            'fixed right-4 z-30 flex items-center gap-2 rounded-full bg-accent px-4 py-3 text-sm font-medium text-on-accent shadow-popover',
            'bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] lg:bottom-6 lg:right-6',
            'transition-transform duration-150 hover:scale-[1.03] active:scale-[0.97]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2'
          )}
          aria-label="Abrir el asistente Socio IA"
        >
          <Sparkles size={18} />
          <span>Pregúntale a tu socio</span>
        </button>
      )}
      <ChatAsistente
        abierto={abierto}
        onClose={() => setAbierto(false)}
        userId={profile.id}
        ubicacionId={ubicacionActiva}
      />
    </>
  )
}

function ChatAsistente({
  abierto,
  onClose,
  userId,
  ubicacionId
}: {
  abierto: boolean
  onClose: () => void
  userId: string
  ubicacionId: string | null
}) {
  const clave = `misociopyme:asistente:${userId}`
  const [mensajes, setMensajes] = useState<Mensaje[]>(() => {
    try {
      const guardado = sessionStorage.getItem(clave)
      return guardado ? (JSON.parse(guardado) as Mensaje[]) : []
    } catch {
      return []
    }
  })
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [uso, setUso] = useState<UsoIa | null>(null)
  const [enLinea, setEnLinea] = useState(() => navigator.onLine)
  const finRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // La conversación dura lo que la pestaña (no se guarda en el servidor)
  useEffect(() => {
    try {
      sessionStorage.setItem(clave, JSON.stringify(mensajes.slice(-30)))
    } catch {
      // sin almacenamiento: la conversación se pierde al recargar
    }
  }, [clave, mensajes])

  useEffect(() => {
    const on = () => setEnLinea(true)
    const off = () => setEnLinea(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  useEffect(() => {
    if (!abierto || !enLinea) return
    let vigente = true
    void miUsoIa().then((u) => vigente && u && setUso(u))
    setTimeout(() => inputRef.current?.focus(), 50)
    return () => {
      vigente = false
    }
  }, [abierto, enLinea])

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [mensajes, enviando])

  const enviar = useCallback(
    async (pregunta: string) => {
      const limpia = pregunta.trim()
      if (!limpia || enviando) return
      const historial = mensajes.filter((m) => !m.error).slice(-8)
      setMensajes((prev) => [...prev, { rol: 'usuario', texto: limpia }])
      setTexto('')
      setEnviando(true)
      try {
        const r = await preguntarAsistente(limpia, historial, ubicacionId)
        setMensajes((prev) => [...prev, { rol: 'asistente', texto: r.respuesta }])
        if (r.uso) setUso(r.uso)
      } catch (e) {
        const err = e as Error & { uso?: UsoIa | null }
        setMensajes((prev) => [...prev, { rol: 'asistente', texto: err.message, error: true }])
        if (err.uso) setUso(err.uso)
      } finally {
        setEnviando(false)
        inputRef.current?.focus()
      }
    },
    [enviando, mensajes, ubicacionId]
  )

  // Lo que queda hoy: el menor entre el cupo personal (si el plan lo tiene) y la bolsa de la empresa
  const quedaEmpresa =
    uso?.tope_empresa != null && uso.usados_empresa != null ? Math.max(0, uso.tope_empresa - uso.usados_empresa) : null
  const quedaPersona =
    uso?.tope_usuario != null && uso.usados_usuario != null ? Math.max(0, uso.tope_usuario - uso.usados_usuario) : null
  const quedan =
    quedaPersona !== null && quedaEmpresa !== null
      ? Math.min(quedaPersona, quedaEmpresa)
      : (quedaPersona ?? quedaEmpresa)
  const agotado = uso ? !uso.permitido : false
  const bloqueado = !enLinea || agotado || enviando

  return (
    <SidePanel
      open={abierto}
      onClose={onClose}
      eyebrow={
        uso?.plan_nombre
          ? `Plan ${uso.plan_nombre}${quedan !== null ? ` · ${quedan === 1 ? 'queda 1 mensaje' : `quedan ${quedan} mensajes`} hoy` : ''}`
          : 'Asistente con IA'
      }
      title={
        <span className="flex items-center gap-2">
          <Sparkles size={18} className="text-accent" /> Socio IA
        </span>
      }
      footer={
        <form
          className="flex w-full items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void enviar(texto)
          }}
        >
          <textarea
            ref={inputRef}
            value={texto}
            onChange={(e) => setTexto(e.target.value.slice(0, 800))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void enviar(texto)
              }
            }}
            rows={1}
            disabled={!enLinea || agotado}
            placeholder={
              !enLinea ? 'Necesitas conexión a internet' : agotado ? 'Sin mensajes disponibles hoy' : 'Escribe tu pregunta…'
            }
            aria-label="Pregunta para el asistente"
            className={cn(
              'max-h-32 min-h-10 flex-1 resize-none rounded-xl border border-border bg-panel px-3 py-2.5 text-sm text-fg',
              'placeholder:text-fg-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-60'
            )}
          />
          <button
            type="submit"
            disabled={bloqueado || !texto.trim()}
            aria-label="Enviar pregunta"
            className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-on-accent transition-opacity disabled:opacity-40"
          >
            <ArrowUp size={18} />
          </button>
        </form>
      }
    >
      <div className="flex min-h-full flex-col gap-3">
        {mensajes.length > 0 && (
          <div className="flex justify-end">
            <button
              onClick={() => setMensajes([])}
              disabled={enviando}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-surface disabled:opacity-50"
            >
              <RotateCcw size={12} /> Nueva conversación
            </button>
          </div>
        )}

        {!enLinea && (
          <p className="flex items-center gap-2 rounded-xl bg-warning-soft px-3 py-2 text-xs text-warning">
            <WifiOff size={14} /> Sin conexión: el asistente vuelve cuando regrese internet.
          </p>
        )}
        {agotado && uso?.motivo && (
          <p className="rounded-xl bg-warning-soft px-3 py-2 text-xs text-warning">{uso.motivo}</p>
        )}

        {mensajes.length === 0 ? (
          <div className="flex flex-1 flex-col justify-center gap-4 py-6">
            <div>
              <p className="text-base font-semibold text-fg">Hola, ¿en qué te ayudo?</p>
              <p className="mt-1 text-sm text-fg-muted">
                Soy tu asesor del negocio: reviso tu stock, ventas, márgenes y horarios, y te digo qué hacer.
                Respondo con los datos de las ubicaciones que puedes ver.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              {SUGERENCIAS.map((s) => (
                <button
                  key={s}
                  onClick={() => void enviar(s)}
                  disabled={bloqueado}
                  className="rounded-xl border border-border px-3 py-2.5 text-left text-sm text-fg-body transition-colors hover:bg-surface disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
            <p className="text-xs text-fg-faint">
              Las respuestas las genera una IA a partir de tus datos: revisa las cifras importantes antes de decidir.
            </p>
          </div>
        ) : (
          mensajes.map((m, i) => (
            <div key={i} className={cn('flex', m.rol === 'usuario' ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm',
                  m.rol === 'usuario'
                    ? 'rounded-br-md bg-accent text-on-accent'
                    : m.error
                      ? 'rounded-bl-md bg-warning-soft text-warning'
                      : 'rounded-bl-md bg-surface text-fg-body'
                )}
              >
                {m.rol === 'usuario' ? <p className="whitespace-pre-wrap">{m.texto}</p> : <TextoFormateado texto={m.texto} />}
              </div>
            </div>
          ))
        )}

        {enviando && (
          <div className="flex justify-start" aria-live="polite">
            <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md bg-surface px-4 py-3 text-xs text-fg-muted">
              <span className="size-1.5 animate-pulse rounded-full bg-fg-muted" />
              <span className="size-1.5 animate-pulse rounded-full bg-fg-muted [animation-delay:150ms]" />
              <span className="size-1.5 animate-pulse rounded-full bg-fg-muted [animation-delay:300ms]" />
              <span className="ml-1">Revisando tus datos…</span>
            </div>
          </div>
        )}
        <div ref={finRef} />
      </div>
    </SidePanel>
  )
}

/** Markdown mínimo: párrafos, viñetas, listas numeradas, títulos y **negrita**. */
function TextoFormateado({ texto }: { texto: string }) {
  const bloques: ReactNode[] = []
  let lista: { ordenada: boolean; items: string[] } | null = null
  const cerrarLista = () => {
    if (!lista) return
    const L = lista.ordenada ? 'ol' : 'ul'
    bloques.push(
      <L key={bloques.length} className={cn('space-y-1 pl-5', lista.ordenada ? 'list-decimal' : 'list-disc')}>
        {lista.items.map((it, i) => (
          <li key={i}>{enLinea(it)}</li>
        ))}
      </L>
    )
    lista = null
  }
  for (const cruda of texto.split('\n')) {
    const linea = cruda.trim()
    const vineta = linea.match(/^[-*•]\s+(.*)$/)
    const numero = linea.match(/^\d+[.)]\s+(.*)$/)
    if (vineta || numero) {
      const ordenada = !!numero
      if (lista && lista.ordenada !== ordenada) cerrarLista()
      lista ??= { ordenada, items: [] }
      lista.items.push((vineta ?? numero)![1])
      continue
    }
    cerrarLista()
    if (!linea) continue
    const titulo = linea.match(/^#{1,4}\s+(.*)$/)
    bloques.push(
      <p key={bloques.length} className={titulo ? 'font-semibold text-fg' : undefined}>
        {enLinea(titulo ? titulo[1] : linea)}
      </p>
    )
  }
  cerrarLista()
  return <div className="space-y-2 leading-relaxed">{bloques}</div>
}

function enLinea(t: string): ReactNode {
  return t.split(/(\*\*[^*]+\*\*)/g).map((parte, i) =>
    parte.startsWith('**') && parte.endsWith('**') && parte.length > 4 ? (
      <strong key={i} className="font-semibold text-fg">
        {parte.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={i}>{parte}</Fragment>
    )
  )
}
