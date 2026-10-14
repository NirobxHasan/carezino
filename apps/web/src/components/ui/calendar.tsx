'use client';

import * as React from 'react';
import { DayPicker, getDefaultClassNames } from 'react-day-picker';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import { buttonVariants } from './button';

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

export function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = 'label',
  ...props
}: CalendarProps) {
  const defaults = getDefaultClassNames();
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      captionLayout={captionLayout}
      weekStartsOn={6}
      className={cn('p-1', className)}
      classNames={{
        root: cn('w-fit', defaults.root),
        months: 'relative flex flex-col gap-4 sm:flex-row',
        month: 'flex w-full flex-col gap-3',
        nav: 'absolute inset-x-0 top-0 flex items-center justify-between',
        button_previous: cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'z-10'),
        button_next: cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'z-10'),
        month_caption: 'flex h-8 items-center justify-center text-sm font-medium',
        caption_label:
          captionLayout === 'label'
            ? 'text-sm font-medium'
            : 'flex h-8 items-center gap-1 rounded-md pr-1 pl-2 text-sm font-medium [&>svg]:size-3.5 [&>svg]:text-muted-foreground',
        dropdowns: 'flex h-8 items-center justify-center gap-1.5 text-sm font-medium',
        dropdown_root:
          'relative rounded-md border border-input shadow-xs has-focus:border-primary has-focus:ring-[3px] has-focus:ring-primary/15',
        dropdown: 'absolute inset-0 bg-surface opacity-0',
        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday: 'w-9 text-[11px] font-medium text-muted-foreground uppercase',
        week: 'mt-1 flex w-full',
        day: 'relative size-9 p-0 text-center text-sm',
        day_button:
          'inline-flex size-9 items-center justify-center rounded-lg text-sm transition-colors hover:bg-accent focus-ring aria-selected:opacity-100',
        selected:
          '[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary-hover',
        range_start: 'rounded-l-lg bg-primary-subtle',
        range_end: 'rounded-r-lg bg-primary-subtle',
        range_middle:
          'bg-primary-subtle [&>button]:!bg-transparent [&>button]:!text-primary-subtle-foreground',
        today: '[&>button]:font-semibold [&>button]:text-primary',
        outside: 'text-subtle-foreground',
        disabled: 'text-subtle-foreground opacity-50',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === 'left' ? (
            <ChevronLeft className="size-4" />
          ) : orientation === 'right' ? (
            <ChevronRight className="size-4" />
          ) : (
            <ChevronDown className="size-3.5" />
          ),
      }}
      {...props}
    />
  );
}
