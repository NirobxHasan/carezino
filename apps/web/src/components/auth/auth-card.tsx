import * as React from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/** The card that holds each public auth screen (sign in, register, reset, invitation). */
export function AuthCard({
  title,
  description,
  children,
  footer,
  wide = false,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={cn('w-full', wide ? 'max-w-3xl' : 'max-w-md')}>
      <Card className="p-6 sm:p-8">
        <div className="mb-6 space-y-1.5">
          <h1 className="text-page-title text-balance">{title}</h1>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {children}
      </Card>
      {footer && <div className="mt-5 text-center text-sm text-muted-foreground">{footer}</div>}
    </div>
  );
}

/** Inline banner for form-level messages, e.g. "Incorrect email or password". */
export function FormAlert({
  tone = 'danger',
  children,
}: {
  tone?: 'danger' | 'success';
  children: React.ReactNode;
}) {
  const Icon = tone === 'danger' ? AlertCircle : CheckCircle2;
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm',
        tone === 'danger'
          ? 'border-danger/20 bg-danger-subtle text-danger-foreground'
          : 'border-success/20 bg-success-subtle text-success-foreground',
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
