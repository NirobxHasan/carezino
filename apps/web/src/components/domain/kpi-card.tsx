import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  href,
  tone = 'neutral',
  loading,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon: LucideIcon;
  href?: string;
  /** Tints the icon only; the number itself stays neutral and readable */
  tone?: 'neutral' | 'primary' | 'warning' | 'success';
  loading?: boolean;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] leading-5 font-medium text-muted-foreground sm:truncate">
          {label}
        </p>
        <span
          className={cn(
            'hidden size-8 shrink-0 place-items-center rounded-lg sm:grid',
            tone === 'neutral' && 'bg-muted text-muted-foreground',
            tone === 'primary' && 'bg-primary-subtle text-primary',
            tone === 'warning' && 'bg-warning-subtle text-warning-foreground',
            tone === 'success' && 'bg-success-subtle text-success-foreground',
          )}
          aria-hidden
        >
          <Icon className="size-4" />
        </span>
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-8 w-20" />
      ) : (
        <p className="mt-1 text-kpi tracking-tight tabular">{value}</p>
      )}
      {hint && (
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{loading ? ' ' : hint}</p>
      )}
    </>
  );
  const className =
    'block rounded-xl border border-border bg-surface p-4 shadow-xs transition-colors';
  return href ? (
    <Link href={href} className={cn(className, 'hover:border-border-strong focus-ring')}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
