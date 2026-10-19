import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type Tone =
  | 'neutral'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'blocked'

const tones: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-fg-body',
  accent: 'bg-accent-soft text-accent',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
  blocked: 'bg-blocked-soft text-blocked'
}

export function Badge({
  tone = 'neutral',
  children,
  className,
  dot
}: {
  tone?: Tone
  children: ReactNode
  className?: string
  dot?: boolean
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        tones[tone],
        className
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  )
}
