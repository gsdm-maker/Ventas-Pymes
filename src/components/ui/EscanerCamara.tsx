import { useEffect, useRef, useState } from 'react'
import { CameraOff, Flashlight, FlashlightOff } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'

/** Lo que responde la pantalla al recibir un código: se muestra bajo la cámara. */
export interface ResultadoEscaneo {
  ok: boolean
  mensaje: string
  /** true = cerrar la cámara (p. ej. para crear el producto) */
  cerrar?: boolean
}

// BarcodeDetector (Chrome/Android) aún no viene en los tipos de TypeScript
interface DetectorNativo {
  detect(fuente: HTMLVideoElement): Promise<{ rawValue: string }[]>
}
interface ConstructorDetector {
  new (opts: { formats: string[] }): DetectorNativo
  getSupportedFormats(): Promise<string[]>
}

const FORMATOS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code']
/** El mismo código no se vuelve a contar hasta pasado este tiempo (la cámara lo lee muchas veces). */
const PAUSA_MISMO_CODIGO = 2500

function mensajeError(e: unknown): string {
  const nombre = e instanceof DOMException ? e.name : ''
  if (nombre === 'NotAllowedError' || nombre === 'SecurityError')
    return 'No hay permiso para usar la cámara. Actívalo en los ajustes del navegador para este sitio y vuelve a intentarlo.'
  if (nombre === 'NotFoundError' || nombre === 'OverconstrainedError') return 'Este dispositivo no tiene una cámara disponible.'
  if (nombre === 'NotReadableError') return 'Otra aplicación está usando la cámara. Ciérrala y vuelve a intentarlo.'
  return 'No se pudo abrir la cámara.'
}

/** Pitido corto de confirmación (como un lector de caja). Si el navegador no deja, se omite. */
function pitar(ok: boolean) {
  try {
    navigator.vibrate?.(ok ? 60 : [40, 60, 40])
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const vol = ctx.createGain()
    osc.frequency.value = ok ? 1250 : 330
    vol.gain.value = 0.08
    osc.connect(vol).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + (ok ? 0.09 : 0.2))
    osc.onended = () => void ctx.close()
  } catch {
    /* sin sonido */
  }
}

/**
 * Lector de código de barras con la cámara del teléfono. Usa el detector nativo del navegador
 * cuando existe (Chrome/Android) y, si no (iPhone/Safari), ZXing, que se descarga solo al abrir.
 * Queda abierto para escanear varios productos seguidos.
 */
export function EscanerCamara({
  open,
  onClose,
  onCodigo,
  titulo = 'Escanear código de barras'
}: {
  open: boolean
  onClose: () => void
  onCodigo: (codigo: string) => ResultadoEscaneo
  titulo?: string
}) {
  return (
    <Modal open={open} onClose={onClose} title={titulo}>
      {/* El contenido se desmonta al cerrar: así la cámara se apaga siempre */}
      <VistaCamara onCodigo={onCodigo} onClose={onClose} />
    </Modal>
  )
}

function VistaCamara({ onCodigo, onClose }: { onCodigo: (c: string) => ResultadoEscaneo; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const pista = useRef<MediaStreamTrack | null>(null)
  const ultimo = useRef({ codigo: '', en: 0 })
  // Siempre la versión más reciente de los callbacks, sin reiniciar la cámara
  const callbacks = useRef({ onCodigo, onClose })
  callbacks.current = { onCodigo, onClose }

  const [estado, setEstado] = useState<'abriendo' | 'leyendo' | 'error'>('abriendo')
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState<ResultadoEscaneo | null>(null)
  const [conLinterna, setConLinterna] = useState(false)
  const [linterna, setLinterna] = useState(false)

  useEffect(() => {
    let activo = true
    let stream: MediaStream | null = null
    let temporizador = 0
    let detenerZxing: (() => void) | null = null

    function leer(texto: string) {
      const codigo = texto.trim()
      const ahora = Date.now()
      if (!codigo || (codigo === ultimo.current.codigo && ahora - ultimo.current.en < PAUSA_MISMO_CODIGO)) return
      ultimo.current = { codigo, en: ahora }
      const r = callbacks.current.onCodigo(codigo)
      pitar(r.ok)
      setAviso(r)
      if (r.cerrar) callbacks.current.onClose()
    }

    async function iniciar() {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new DOMException(
          window.isSecureContext ? 'sin cámara' : 'La cámara solo funciona con https',
          window.isSecureContext ? 'NotFoundError' : 'SecurityError'
        )
      }
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
      })
      if (!activo) return
      const v = video.current!
      v.srcObject = stream
      await v.play()
      pista.current = stream.getVideoTracks()[0] ?? null
      const capacidades = pista.current?.getCapabilities?.() as { torch?: boolean } | undefined
      setConLinterna(!!capacidades?.torch)
      setEstado('leyendo')

      const Nativo = (window as unknown as { BarcodeDetector?: ConstructorDetector }).BarcodeDetector
      const soportados = Nativo ? await Nativo.getSupportedFormats().catch(() => [] as string[]) : []
      if (Nativo && soportados.includes('ean_13')) {
        const detector = new Nativo({ formats: FORMATOS.filter((f) => soportados.includes(f)) })
        const ciclo = async () => {
          if (!activo) return
          try {
            const [r] = await detector.detect(v)
            if (r) leer(r.rawValue)
          } catch {
            /* cuadro sin imagen todavía */
          }
          temporizador = window.setTimeout(ciclo, 120)
        }
        void ciclo()
        return
      }

      // Respaldo (Safari/iPhone): ZXing, cargado solo cuando hace falta
      const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
        import('@zxing/browser'),
        import('@zxing/library')
      ])
      if (!activo) return
      const pistas = new Map<number, unknown>([
        [
          DecodeHintType.POSSIBLE_FORMATS,
          [
            BarcodeFormat.EAN_13,
            BarcodeFormat.EAN_8,
            BarcodeFormat.UPC_A,
            BarcodeFormat.UPC_E,
            BarcodeFormat.CODE_128,
            BarcodeFormat.CODE_39,
            BarcodeFormat.ITF,
            BarcodeFormat.QR_CODE
          ]
        ]
      ])
      const lector = new BrowserMultiFormatReader(pistas, { delayBetweenScanAttempts: 120 })
      const controles = await lector.decodeFromVideoElement(v, (r) => {
        if (r) leer(r.getText())
      })
      detenerZxing = () => controles.stop()
      if (!activo) detenerZxing()
    }

    iniciar().catch((e) => {
      if (!activo) return
      setError(mensajeError(e))
      setEstado('error')
    })

    return () => {
      activo = false
      window.clearTimeout(temporizador)
      detenerZxing?.()
      stream?.getTracks().forEach((t) => t.stop())
      pista.current = null
    }
  }, [])

  // El aviso se borra solo a los 2,5 s
  useEffect(() => {
    if (!aviso) return
    const t = window.setTimeout(() => setAviso(null), 2500)
    return () => window.clearTimeout(t)
  }, [aviso])

  async function alternarLinterna() {
    const t = pista.current
    if (!t) return
    try {
      await t.applyConstraints({ advanced: [{ torch: !linterna } as MediaTrackConstraintSet] })
      setLinterna(!linterna)
    } catch {
      setConLinterna(false)
    }
  }

  if (estado === 'error') {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <CameraOff size={32} className="text-fg-faint" aria-hidden />
        <p className="text-sm text-fg-body">{error}</p>
        <p className="text-xs text-fg-muted">También puedes escribir el código en el buscador.</p>
        <Button variant="secondary" onClick={onClose}>
          Cerrar
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-black">
        <video ref={video} playsInline muted className="size-full object-cover" aria-label="Vista de la cámara" />
        {/* Guía: zona donde poner el código */}
        <div className="pointer-events-none absolute inset-x-[10%] top-1/2 h-1/3 -translate-y-1/2 rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
        {estado === 'abriendo' && (
          <p className="absolute inset-0 grid place-items-center text-sm text-white/80">Abriendo cámara…</p>
        )}
        {conLinterna && (
          <button
            type="button"
            onClick={() => void alternarLinterna()}
            aria-pressed={linterna}
            aria-label={linterna ? 'Apagar linterna' : 'Encender linterna'}
            className="absolute right-2 top-2 grid size-11 place-items-center rounded-full bg-black/50 text-white"
          >
            {linterna ? <FlashlightOff size={18} /> : <Flashlight size={18} />}
          </button>
        )}
      </div>

      <p
        role="status"
        aria-live="polite"
        className={cn(
          'min-h-10 rounded-lg px-3 py-2 text-center text-sm',
          !aviso && 'text-fg-muted',
          aviso?.ok && 'bg-success-soft font-medium text-success',
          aviso && !aviso.ok && 'bg-warning-soft font-medium text-warning'
        )}
      >
        {aviso ? aviso.mensaje : 'Apunta al código de barras. Puedes escanear varios productos seguidos.'}
      </p>

      <Button block variant="secondary" onClick={onClose}>
        Listo
      </Button>
    </div>
  )
}
