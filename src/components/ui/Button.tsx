import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft'
type Size = 'sm' | 'md' | 'lg' | 'xl'

const variants: Record<Variant, string> = {
  primary:
    'bg-accent text-on-accent hover:bg-accent-container shadow-sm shadow-accent/10 disabled:bg-accent/50',
  secondary:
    'bg-surface text-fg hover:bg-surface-2 active:bg-surface-2 border border-border disabled:opacity-50',
  ghost: 'bg-transparent text-fg hover:bg-surface active:bg-surface disabled:opacity-50',
  danger: 'bg-danger text-white hover:opacity-90 active:opacity-90 disabled:opacity-50',
  soft: 'bg-accent-soft text-accent hover:opacity-90 active:opacity-90'
}

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-5 text-sm gap-2',
  xl: 'h-14 px-6 text-base gap-2.5'
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  block?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', block, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center rounded-xl font-medium transition-colors duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
        'disabled:cursor-not-allowed active:scale-[0.98]',
        variants[variant],
        sizes[size],
        block && 'w-full',
        className
      )}
      {...props}
    />
  )
})
