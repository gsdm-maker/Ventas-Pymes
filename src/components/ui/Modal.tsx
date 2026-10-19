import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md'
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-3xl' }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
          className={cn(
            'relative z-10 flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-panel shadow-popover sm:rounded-2xl',
            widths[size]
          )}
      >
        {title && (
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 className="text-sm font-semibold text-fg">{title}</h2>
            <button
              onClick={onClose}
              className="grid size-8 place-items-center rounded-lg text-fg-muted hover:bg-surface"
              aria-label="Cerrar"
            >
              <X size={18} />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto overscroll-contain p-5">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
