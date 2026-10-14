'use client';

import * as React from 'react';
import { Slot } from 'radix-ui';
import { AlertCircle } from 'lucide-react';

import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * Label-above-input field. Wires id, aria-invalid and aria-describedby onto its single
 * child control, so every form gets accessible labels and inline errors for free.
 */
export function Field({
  label,
  required,
  optional,
  helper,
  error,
  className,
  children,
  id: idProp,
  labelAction,
}: {
  label: React.ReactNode;
  required?: boolean;
  /** Shows "(optional)" instead of the required asterisk */
  optional?: boolean;
  helper?: React.ReactNode;
  error?: string;
  className?: string;
  children: React.ReactElement;
  id?: string;
  labelAction?: React.ReactNode;
}) {
  const autoId = React.useId();
  const id = idProp ?? autoId;
  const helperId = `${id}-helper`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, helper ? helperId : null].filter(Boolean).join(' ');

  return (
    <div className={cn('grid content-start gap-1.5', className)}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>
          {label}
          {required && (
            <span className="text-danger" aria-hidden>
              *
            </span>
          )}
          {required && <span className="sr-only">(required)</span>}
          {optional && <span className="font-normal text-muted-foreground">(optional)</span>}
        </Label>
        {labelAction}
      </div>
      <Slot.Root
        id={id}
        aria-invalid={error ? true : undefined}
        aria-required={required || undefined}
        aria-describedby={describedBy || undefined}
      >
        {children}
      </Slot.Root>
      {error ? (
        <p id={errorId} className="flex items-center gap-1 text-xs text-danger-foreground">
          <AlertCircle className="size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : helper ? (
        <p id={helperId} className="text-xs text-muted-foreground">
          {helper}
        </p>
      ) : null}
    </div>
  );
}

/** Group of related fields with a heading, used on full-page forms. */
export function FormSection({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'grid gap-x-8 gap-y-4 border-b border-border py-6 first:pt-0 last:border-0 last:pb-0 lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)]',
        className,
      )}
    >
      <div className="space-y-1">
        <h2 className="text-card-title">{title}</h2>
        {description && <p className="text-[13px] text-muted-foreground">{description}</p>}
      </div>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}
