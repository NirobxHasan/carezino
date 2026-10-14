import * as React from 'react';

import { cn } from '@/lib/utils';

export const inputBaseClass =
  'w-full min-w-0 rounded-lg border border-input bg-surface text-sm text-foreground shadow-xs transition-[color,box-shadow,border-color] placeholder:text-subtle-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/15 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70 aria-invalid:border-danger aria-invalid:focus-visible:ring-danger/15';

export function Input({ className, type = 'text', ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        inputBaseClass,
        'h-10 px-3 file:border-0 file:bg-transparent file:text-sm file:font-medium',
        className,
      )}
      {...props}
    />
  );
}
