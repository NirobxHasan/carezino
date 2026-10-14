import * as React from 'react';

import { cn } from '@/lib/utils';
import { inputBaseClass } from './input';

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(inputBaseClass, 'field-sizing-content min-h-20 px-3 py-2 leading-6', className)}
      {...props}
    />
  );
}
