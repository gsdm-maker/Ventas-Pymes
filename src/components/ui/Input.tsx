import {
  forwardRef,
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
  return (
    <label className="block">
      {label && (
        <span className="mb-1.5 flex items-center gap-1 text-xs font-medium text-fg-body">
          {label}
          {required && <span className="text-danger">*</span>}
        </span>
      )}
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-danger">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-fg-muted">{hint}</span>
      ) : null}
    </label>
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
