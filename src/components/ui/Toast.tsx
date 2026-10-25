import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode
} from 'react'
import { CheckCircle2, Info, AlertTriangle, XCircle, X } from 'lucide-react'
import { cn } from '@/lib/cn'

type ToastTone = 'success' | 'error' | 'warning' | 'info'
interface Toast {
  id: number
  tone: ToastTone
  message: string
}

interface ToastCtx {
  toast: (message: string, tone?: ToastTone) => void
}

const Ctx = createContext<ToastCtx | null>(null)

const icons = {
  success: <CheckCircle2 size={18} />,
  error: <XCircle size={18} />,
  warning: <AlertTriangle size={18} />,
  info: <Info size={18} />
}
const toneCls: Record<ToastTone, string> = {
  success: 'text-success',
  error: 'text-danger',
  warning: 'text-warning',
  info: 'text-info'
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])

  const toast = useCallback((message: string, tone: ToastTone = 'success') => {
    const id = Date.now() + Math.random()
    setItems((prev) => [...prev, { id, tone, message }])
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 3800)
  }, [])

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        // Arriba: abajo tapaban los botones de los paneles y modales (Cancelar, Guardar)
        className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-2 px-4 sm:top-6"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-border bg-panel px-4 py-3 shadow-popover"
          >
            <span className={cn('mt-0.5', toneCls[t.tone])}>{icons[t.tone]}</span>
            <p className="flex-1 text-sm text-fg">{t.message}</p>
            <button
              onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
              className="text-fg-faint hover:text-fg"
              aria-label="Cerrar"
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export function useToast() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useToast debe usarse dentro de ToastProvider')
  return ctx.toast
}
