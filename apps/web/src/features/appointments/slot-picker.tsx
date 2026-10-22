'use client';

import * as React from 'react';
import { CalendarX2 } from 'lucide-react';

import { EmptyState, ErrorState, InlineLoader } from '@/components/feedback/states';
import { useAvailableSlots, type SlotParams } from '@/lib/api/appointments';
import type { ClockTime } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useCenterFormat } from './appointment-display';

/**
 * Bookable start times for one therapist, day and length, straight from the API, which
 * applies every rule. Only free times are offered; when there are none the API's reason
 * is shown. A picked time that disappears on refresh (someone else booked it) is cleared,
 * so a stale choice is never submitted unnoticed.
 */
export function SlotPicker({
  params,
  value,
  onChange,
}: {
  /** Null until everything the slots depend on has been chosen */
  params: SlotParams | null;
  value: ClockTime | undefined;
  onChange: (startTime: ClockTime | undefined) => void;
}) {
  const fmt = useCenterFormat();
  const { data, isFetching, isPlaceholderData, error, refetch } = useAvailableSlots(params);
  const current = data && !isPlaceholderData ? data : undefined;

  React.useEffect(() => {
    if (current && value && !current.slots.some((s) => s.startTime === value)) {
      onChange(undefined);
    }
  }, [current, value, onChange]);

  if (!params) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-[13px] text-muted-foreground">
        Choose the therapist, length and date to see free times.
      </p>
    );
  }
  if (!current && isFetching) return <InlineLoader label="Checking availability…" />;
  if (error && !current) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!current) return null;
  if (!current.slots.length) {
    return (
      <EmptyState
        compact
        icon={CalendarX2}
        title="No free times on this day"
        description={current.unavailable?.message ?? 'Try another day or therapist.'}
      />
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {current.slots.length} free {current.slots.length === 1 ? 'time' : 'times'} · every{' '}
        {current.slotIntervalMinutes} min
      </p>
      <div
        role="radiogroup"
        aria-label="Free times"
        className={cn(
          'grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5',
          isFetching && 'opacity-70 transition-opacity',
        )}
      >
        {current.slots.map((slot) => {
          const selected = value === slot.startTime;
          return (
            <button
              key={slot.startTime}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${fmt.clock(slot.startTime)} to ${fmt.clock(slot.endTime)}`}
              onClick={() => onChange(slot.startTime)}
              className={cn(
                'h-10 rounded-lg border text-[13px] font-medium tabular transition-colors focus-ring',
                selected
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border-strong bg-surface hover:border-primary hover:bg-primary-subtle',
              )}
            >
              {fmt.clock(slot.startTime)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
