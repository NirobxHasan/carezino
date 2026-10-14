import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

export const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium [&_svg]:size-3',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-muted text-muted-foreground',
        primary: 'border-primary/15 bg-primary-subtle text-primary-subtle-foreground',
        success: 'border-success/15 bg-success-subtle text-success-foreground',
        warning: 'border-warning/20 bg-warning-subtle text-warning-foreground',
        danger: 'border-danger/15 bg-danger-subtle text-danger-foreground',
        info: 'border-info/15 bg-info-subtle text-info-foreground',
        outline: 'border-border-strong bg-surface text-foreground',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;

export function Badge({
  className,
  tone,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ tone }), className)} {...props} />;
}
