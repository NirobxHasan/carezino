'use client';

import { CalendarX2 } from 'lucide-react';

import { EmptyState, InlineLoader } from '@/components/feedback/states';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatTime } from '@/lib/format';
import type { TimeSlot } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * Time-slot picker. Unavailable slots stay visible (struck through, with the reason in
 * a tooltip) so staff can see *why* a time can't be booked instead of guessing.
 */
export function SlotGrid({
  slots,
  loading,
  value,
  onChange,
  emptyText = 'No working hours on this day.',
}: {
  slots: TimeSlot[] | undefined;
  loading?: boolean;
  value?: string;
  onChange: (start: string) => void;
  emptyText?: string;
}) {
  if (loading && !slots) return <InlineLoader label="Checking availability…" />;
  if (!slots?.length) {
    return <EmptyState compact icon={CalendarX2} title="No slots" description={emptyText} />;
  }
  const available = slots.filter((s) => s.available).length;

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {available} of {slots.length} slots available
      </p>
      <div
        role="radiogroup"
        aria-label="Available times"
        className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5"
      >
        {slots.map((slot) => {
          const selected = value === slot.start;
          const button = (
            <button
              key={slot.start}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-disabled={!slot.available}
              aria-label={`${formatTime(slot.start)}${slot.available ? '' : `, unavailable: ${slot.reason}`}`}
              onClick={() => slot.available && onChange(slot.start)}
              className={cn(
                'h-10 rounded-lg border text-[13px] font-medium tabular transition-colors focus-ring',
                selected
                  ? 'border-primary bg-primary text-primary-foreground'
                  : slot.available
                    ? 'border-border-strong bg-surface hover:border-primary hover:bg-primary-subtle'
                    : 'cursor-not-allowed border-dashed border-border bg-muted/50 text-subtle-foreground line-through',
              )}
            >
              {formatTime(slot.start)}
            </button>
          );
          if (slot.available) return button;
          return (
            <Tooltip key={slot.start}>
              <TooltipTrigger asChild>{button}</TooltipTrigger>
              <TooltipContent>{slot.reason}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
