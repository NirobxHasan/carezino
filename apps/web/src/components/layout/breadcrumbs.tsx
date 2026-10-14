'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import { segmentLabels } from './nav';

type Labels = Record<string, string>;

const BreadcrumbContext = React.createContext<{
  labels: Labels;
  setLabel: (segment: string, label: string | null) => void;
}>({ labels: {}, setLabel: () => {} });

export function BreadcrumbProvider({ children }: { children: React.ReactNode }) {
  const [labels, setLabels] = React.useState<Labels>({});
  const setLabel = React.useCallback((segment: string, label: string | null) => {
    setLabels((prev) => {
      if (label === null) {
        const next = { ...prev };
        delete next[segment];
        return next;
      }
      return prev[segment] === label ? prev : { ...prev, [segment]: label };
    });
  }, []);
  const value = React.useMemo(() => ({ labels, setLabel }), [labels, setLabel]);
  return <BreadcrumbContext.Provider value={value}>{children}</BreadcrumbContext.Provider>;
}

/** Detail pages call this to replace an ID segment (e.g. pt_12) with a readable name. */
export function useBreadcrumbLabel(segment: string | undefined, label: string | undefined) {
  const { setLabel } = React.useContext(BreadcrumbContext);
  React.useEffect(() => {
    if (!segment || !label) return;
    setLabel(segment, label);
    return () => setLabel(segment, null);
  }, [segment, label, setLabel]);
}

export function Breadcrumbs({ className }: { className?: string }) {
  const pathname = usePathname();
  const { labels } = React.useContext(BreadcrumbContext);
  const segments = pathname.split('/').filter(Boolean);
  const crumbs = segments.map((segment, i) => ({
    href: `/${segments.slice(0, i + 1).join('/')}`,
    label: labels[segment] ?? segmentLabels[segment] ?? 'Details',
  }));
  if (!crumbs.length) return null;

  return (
    <nav aria-label="Breadcrumb" className={cn('min-w-0', className)}>
      <ol className="flex min-w-0 items-center gap-1 text-sm">
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li
              key={crumb.href}
              className={cn('flex min-w-0 items-center gap-1', !last && 'hidden sm:flex')}
            >
              {last ? (
                <span aria-current="page" className="truncate font-medium text-foreground">
                  {crumb.label}
                </span>
              ) : (
                <>
                  <Link
                    href={crumb.href}
                    className="truncate rounded text-muted-foreground transition-colors hover:text-foreground focus-ring"
                  >
                    {crumb.label}
                  </Link>
                  <ChevronRight className="size-3.5 shrink-0 text-subtle-foreground" aria-hidden />
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
