import { cn } from '@/lib/utils';

export function Progress({
  value,
  max = 100,
  label,
  tone = 'primary',
  className,
}: {
  value: number;
  max?: number;
  /** Accessible name, e.g. "Sessions used" */
  label: string;
  tone?: 'primary' | 'warning' | 'danger' | 'success';
  className?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width]',
          tone === 'primary' && 'bg-primary',
          tone === 'warning' && 'bg-warning',
          tone === 'danger' && 'bg-danger',
          tone === 'success' && 'bg-success',
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
