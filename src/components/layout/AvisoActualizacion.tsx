import { RefreshCw, X } from 'lucide-react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { Button } from '@/components/ui/Button'

// Cada cuánto una pestaña abierta (p. ej. el POS todo el día) pregunta si hay versión nueva
const REVISAR_CADA_MS = 30 * 60 * 1000

/**
 * Aviso de versión nueva. La app queda guardada en el navegador para funcionar sin
 * conexión; cuando se publica otra versión, se descarga por detrás y aquí se ofrece
 * cargarla. No se recarga sola: un cajero a mitad de una venta perdería el ticket.
 */
export function AvisoActualizacion() {
  const {
    needRefresh: [hayNueva, setHayNueva],
    updateServiceWorker
  } = useRegisterSW({
    onRegisteredSW(_url, registro) {
      if (registro) window.setInterval(() => void registro.update(), REVISAR_CADA_MS)
    }
  })

  if (!hayNueva) return null
  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-border bg-panel px-4 py-3 shadow-lg lg:bottom-6"
    >
      <RefreshCw size={18} className="shrink-0 text-accent" aria-hidden />
      <p className="flex-1 text-sm text-fg">Hay una versión nueva de Mi Socio Pyme.</p>
      <Button
        size="sm"
        onClick={() => {
          void updateServiceWorker(true)
          // Respaldo por si la pestaña no recibe el aviso de cambio del service worker
          window.setTimeout(() => window.location.reload(), 3000)
        }}
      >
        Actualizar
      </Button>
      <button
        onClick={() => setHayNueva(false)}
        aria-label="Más tarde"
        title="Más tarde"
        className="grid size-8 place-items-center rounded-lg text-fg-muted hover:bg-surface"
      >
        <X size={16} />
      </button>
    </div>
  )
}
