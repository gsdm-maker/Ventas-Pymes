import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useEsMovil } from '@/hooks/useMediaQuery'

interface SidePanelProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  eyebrow?: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: 'md' | 'lg'
}

const WIDTH = { md: 'sm:w-[420px]', lg: 'sm:w-[520px]' }

/**
 * Panel de detalle lateral derecho (estilo Lumix).
 *
 * En escritorio convive con la página: no oscurece el fondo y se puede seguir
 * interactuando con la lista. En móvil se comporta como una hoja a pantalla completa.
 */
export function SidePanel({
  open,
  onClose,
  title,
  eyebrow,
  children,
  footer,
  width = 'md'
}: SidePanelProps) {
  const esMovil = useEsMovil()
  const ref = useRef<HTMLElement>(null)
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open || !ref.current) return
    ref.current.focus({ preventScroll: true })
  }, [open])

  if (!open) return null

  return (
    <>
      {esMovil && (
        <div
          className="fixed inset-0 z-40 bg-black/40 anim-fade-in"
          onClick={onClose}
          aria-hidden
        />
      )}
      <aside
        ref={ref}
        role="dialog"
        aria-modal={esMovil || undefined}
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={cn(
          'fixed inset-0 z-50 flex flex-col bg-panel shadow-popover outline-none',
          'sm:inset-auto sm:right-0 sm:top-0 sm:bottom-0 sm:m-3 sm:max-h-[calc(100vh-1.5rem)] sm:w-full sm:rounded-2xl sm:border sm:border-border',
          'anim-panel-in',
          WIDTH[width]
        )}
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="flex items-start gap-3 border-b border-border px-5 pb-3 pt-4">
          <div className="min-w-0 flex-1">
            {eyebrow && <div className="mb-1 truncate text-xs text-fg-faint">{eyebrow}</div>}
            {title && (
              <h2 id={titleId} className="text-balance text-lg font-semibold leading-snug tracking-tight text-fg">
                {title}
              </h2>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar panel"
            className="grid size-8 place-items-center rounded-lg text-fg-muted hover:bg-surface"
            data-overlay-close
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
        {footer && (
          <div
            className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3"
            style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}
          >
            {footer}
          </div>
        )}
      </aside>
    </>
  )
}
