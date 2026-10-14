'use client';

import * as React from 'react';
import {
  format,
  parseISO,
  startOfMonth,
  subMonths,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  subDays,
} from 'date-fns';
import { CalendarDays } from 'lucide-react';
import type { DateRange, Matcher } from 'react-day-picker';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { inputBaseClass } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

const toIso = (d: Date) => format(d, 'yyyy-MM-dd');

type TriggerProps = Omit<React.ComponentProps<'button'>, 'value' | 'onChange'>;

/** Single date. Value is an ISO date (yyyy-MM-dd). */
export function DatePicker({
  value,
  onChange,
  placeholder = 'Pick a date',
  disabled,
  disabledDays,
  withYearSelect = false,
  className,
  ...trigger
}: TriggerProps & {
  value?: string;
  onChange: (value: string | undefined) => void;
  placeholder?: string;
  disabledDays?: Matcher | Matcher[];
  /** Month/year dropdowns, for dates of birth */
  withYearSelect?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const selected = value ? parseISO(value) : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            inputBaseClass,
            'flex h-10 items-center gap-2 px-3 text-left',
            !selected && 'text-subtle-foreground',
            className,
          )}
          {...trigger}
        >
          <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">
            {selected ? format(selected, 'd MMM yyyy') : placeholder}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={(d) => {
            onChange(d ? toIso(d) : undefined);
            setOpen(false);
          }}
          disabled={disabledDays}
          captionLayout={withYearSelect ? 'dropdown' : 'label'}
          startMonth={withYearSelect ? new Date(1940, 0) : undefined}
          endMonth={withYearSelect ? new Date() : undefined}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}

export interface DateRangeValue {
  from: string;
  to: string;
}

/** Inclusive date range with quick presets. */
export function DateRangePicker({
  value,
  onChange,
  className,
}: {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<DateRange | undefined>();
  const from = parseISO(value.from);
  const to = parseISO(value.to);

  const presets = React.useMemo(() => {
    const now = new Date();
    return [
      { label: 'Today', from: now, to: now },
      { label: 'Last 7 days', from: subDays(now, 6), to: now },
      {
        label: 'This week',
        from: startOfWeek(now, { weekStartsOn: 6 }),
        to: endOfWeek(now, { weekStartsOn: 6 }),
      },
      { label: 'This month', from: startOfMonth(now), to: endOfMonth(now) },
      {
        label: 'Last month',
        from: startOfMonth(subMonths(now, 1)),
        to: endOfMonth(subMonths(now, 1)),
      },
    ];
    // Recompute when opened so "today" stays correct in long-lived tabs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const label =
    toIso(from) === toIso(to)
      ? format(from, 'd MMM yyyy')
      : `${format(from, 'd MMM')} – ${format(to, 'd MMM yyyy')}`;

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        setDraft(o ? { from, to } : undefined);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            inputBaseClass,
            'flex h-9 w-auto items-center gap-2 px-3 text-left text-[13px]',
            className,
          )}
          aria-label={`Date range: ${label}`}
        >
          <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate tabular">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-0">
        <div className="flex flex-col sm:flex-row">
          <div className="flex gap-1 overflow-x-auto border-b border-border p-2 sm:w-36 sm:flex-col sm:border-r sm:border-b-0">
            {presets.map((p) => (
              <Button
                key={p.label}
                variant="ghost"
                size="sm"
                className="justify-start"
                onClick={() => {
                  onChange({ from: toIso(p.from), to: toIso(p.to) });
                  setOpen(false);
                }}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <div className="p-2">
            <Calendar
              mode="range"
              numberOfMonths={1}
              selected={draft}
              defaultMonth={from}
              onSelect={(range) => {
                setDraft(range);
                if (range?.from && range.to && toIso(range.from) !== toIso(range.to)) {
                  onChange({ from: toIso(range.from), to: toIso(range.to) });
                  setOpen(false);
                }
              }}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
