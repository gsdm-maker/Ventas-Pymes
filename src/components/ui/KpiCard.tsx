import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export function KpiCard({
  label,
  value,
  hint,
  icon,
  tone = 'accent',
  className
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon?: ReactNode
  tone?: 'accent' | 'success' | 'warning' | 'danger' | 'neutral'
  className?: string
}) {
  const toneMap: Record<string, string> = {
    accent: 'bg-accent-soft text-accent',
    success: 'bg-success-soft text-success',
    warning: 'bg-warning-soft text-warning',
    danger: 'bg-danger-soft text-danger',
    neutral: 'bg-surface-2 text-fg-muted'
  }
  return (
    <div
      className={cn(
        'rounded-2xl border border-border bg-panel p-4 shadow-card',
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
          {label}
        </p>
        {icon && (
          <span
            className={cn(
              'grid size-8 place-items-center rounded-lg',
              toneMap[tone]
            )}
          >
            {icon}
          </span>
        )}
      </div>
      <p className="mt-2 text-2xl font-semibold text-fg">{value}</p>
      {hint && <div className="mt-1 text-xs text-fg-muted">{hint}</div>}
    </div>
  )
}
