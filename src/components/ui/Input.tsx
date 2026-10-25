import {
  cloneElement,
  forwardRef,
  isValidElement,
  useId,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  type ReactNode
} from 'react'
import { cn } from '@/lib/cn'

const base =
  'w-full rounded-xl border border-border bg-field px-3 py-2.5 text-sm text-fg placeholder:text-fg-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:border-accent disabled:opacity-60'

export function Field({
  label,
  hint,
  error,
  required,
  children
}: {
  label?: string
  hint?: ReactNode
  error?: string
  required?: boolean
  children: ReactNode
}) {
  // Etiqueta asociada de forma explícita (for/id) al control, y la ayuda o el error como
  // descripción: así lo anuncian todos los lectores de pantalla
  const autoId = useId()
  const control = isValidElement<{ id?: string; 'aria-describedby'?: string }>(children) ? children : null
  const id = control?.props.id ?? autoId
  const ayudaId = error || hint ? `${id}-ayuda` : undefined
  return (
    <div className="block">
      {label && (
        <label htmlFor={control ? id : undefined} className="mb-1.5 flex items-center gap-1 text-xs font-medium text-fg-body">
          {label}
          {required && <span className="text-danger" aria-hidden>*</span>}
        </label>
      )}
      {control ? cloneElement(control, { id, 'aria-describedby': ayudaId }) : children}
      {error ? (
        <span id={ayudaId} className="mt-1 block text-xs text-danger">{error}</span>
      ) : hint ? (
        <span id={ayudaId} className="mt-1 block text-xs text-fg-muted">{hint}</span>
      ) : null}
    </div>
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(base, className)} {...props} />
  }
)

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, children, ...props }, ref) {
  return (
    <select ref={ref} className={cn(base, 'pr-8', className)} {...props}>
      {children}
    </select>
  )
})

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(base, 'min-h-20', className)} {...props} />
})
