'use client';

import * as React from 'react';
import { AlertCircle, AlertTriangle, Copy, Plus, X } from 'lucide-react';

import { TimePicker } from '@/components/forms/time-picker';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { formatClock } from '@/lib/format';
import { LIMITS, WEEKDAYS, weekOrder } from '@/lib/settings-limits';
import type { TimeInterval, WorkingDay } from '@/lib/types';
import { cn } from '@/lib/utils';

/** One weekday as the editor holds it. The array is indexed by dayOfWeek, Sunday first. */
export interface DayValue {
  dayOfWeek: number;
  isAvailable: boolean;
  intervals: TimeInterval[];
}

const DEFAULT_INTERVAL = { start: '09:00', end: '13:00' };
const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toClock = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function emptyWeek(): DayValue[] {
  return Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    isAvailable: false,
    intervals: [],
  }));
}

/**
 * Same rules as the API (start before end, no overlaps), keyed by the API's error paths
 * (days.6.intervals.1.start) so server and client errors land in the same place.
 */
export function validateWeek(days: DayValue[]) {
  const errors: Record<string, string> = {};
  days.forEach((day, d) => {
    const parsed = day.intervals.map((iv, i) => ({
      i,
      start: toMinutes(iv.start),
      end: toMinutes(iv.end),
    }));
    for (const iv of parsed) {
      if (iv.start >= iv.end) {
        errors[`days.${d}.intervals.${iv.i}.end`] = 'End time must be after start time';
      }
    }
    const valid = parsed.filter((iv) => iv.start < iv.end).sort((a, b) => a.start - b.start);
    for (let k = 1; k < valid.length; k++) {
      if (valid[k].start < valid[k - 1].end) {
        errors[`days.${d}.intervals.${valid[k].i}.start`] =
          `Overlaps ${toClock(valid[k - 1].start)}–${toClock(valid[k - 1].end)}`;
      }
    }
  });
  return errors;
}

/** What the API expects: off days keep their intervals; an "on" day without any is off. */
export function toAvailabilityInput(days: DayValue[]) {
  return days.map((d) => ({
    dayOfWeek: d.dayOfWeek,
    isAvailable: d.isAvailable && d.intervals.length > 0,
    intervals: d.intervals.map(({ start, end }) => ({ start, end })),
  }));
}

function outsideCenterHours(interval: TimeInterval, center: WorkingDay | undefined) {
  if (!center) return false;
  const start = toMinutes(interval.start);
  const end = toMinutes(interval.end);
  return !center.intervals.some((c) => toMinutes(c.start) <= start && end <= toMinutes(c.end));
}

function describeCenterDay(center: WorkingDay | undefined) {
  if (!center) return null;
  if (!center.isOpen) return 'Center closed';
  return `Center ${center.intervals.map((i) => `${formatClock(i.start)}–${formatClock(i.end)}`).join(', ')}`;
}

function ErrorText({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="flex items-center gap-1 text-xs text-danger-foreground">
      <AlertCircle className="size-3.5 shrink-0" aria-hidden />
      {message}
    </p>
  );
}

function DayRow({
  day,
  center,
  errors,
  disabled,
  order,
  onChange,
  onCopy,
}: {
  day: DayValue;
  center?: WorkingDay;
  errors: Record<string, string>;
  disabled: boolean;
  order: number[];
  onChange: (day: DayValue) => void;
  onCopy: (targets: number[]) => void;
}) {
  const name = WEEKDAYS[day.dayOfWeek];
  const prefix = `days.${day.dayOfWeek}.intervals`;
  const centerText = describeCenterDay(center);
  const setInterval = (i: number, patch: Partial<TimeInterval>) =>
    onChange({
      ...day,
      intervals: day.intervals.map((iv, k) => (k === i ? { ...iv, ...patch } : iv)),
    });

  return (
    <div className="grid gap-3 py-4 first:pt-0 last:pb-0 sm:grid-cols-[11rem_minmax(0,1fr)]">
      <div className="grid content-start gap-0.5">
        <label className="flex h-10 items-center gap-3">
          <Switch
            checked={day.isAvailable}
            disabled={disabled}
            onCheckedChange={(on) =>
              onChange({
                ...day,
                isAvailable: on,
                intervals: on && !day.intervals.length ? [{ ...DEFAULT_INTERVAL }] : day.intervals,
              })
            }
            aria-label={`Available on ${name}`}
          />
          <span className={cn('text-sm font-medium', !day.isAvailable && 'text-muted-foreground')}>
            {name}
          </span>
        </label>
        {centerText && <span className="text-xs text-muted-foreground sm:pl-12">{centerText}</span>}
      </div>
      {day.isAvailable ? (
        <div className="grid gap-2">
          {day.intervals.map((interval, i) => {
            const error = errors[`${prefix}.${i}.start`] ?? errors[`${prefix}.${i}.end`];
            const outside = !error && outsideCenterHours(interval, center);
            return (
              <div key={i} className="grid gap-1">
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <TimePicker
                    value={interval.start}
                    onChange={(start) => setInterval(i, { start })}
                    min="00:00"
                    max="23:45"
                    step={15}
                    disabled={disabled}
                    className="w-28 sm:w-32"
                    aria-label={`${name} interval ${i + 1} starts`}
                    aria-invalid={errors[`${prefix}.${i}.start`] ? true : undefined}
                  />
                  <span className="text-sm text-muted-foreground" aria-hidden>
                    to
                  </span>
                  <TimePicker
                    value={interval.end}
                    onChange={(end) => setInterval(i, { end })}
                    min="00:15"
                    max="23:45"
                    step={15}
                    disabled={disabled}
                    className="w-28 sm:w-32"
                    aria-label={`${name} interval ${i + 1} ends`}
                    aria-invalid={errors[`${prefix}.${i}.end`] ? true : undefined}
                  />
                  {!disabled && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${interval.start}–${interval.end} on ${name}`}
                      onClick={() =>
                        onChange({
                          ...day,
                          intervals: day.intervals.filter((_, k) => k !== i),
                          isAvailable: day.intervals.length > 1,
                        })
                      }
                    >
                      <X />
                    </Button>
                  )}
                </div>
                <ErrorText message={error} />
                {outside && (
                  <p className="flex items-center gap-1 text-xs text-warning-foreground">
                    <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
                    Outside the center’s hours: this part can’t be booked.
                  </p>
                )}
              </div>
            );
          })}
          {!disabled && (
            <div className="flex flex-wrap gap-1 [&_button]:text-muted-foreground [&_button:hover]:text-foreground">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={day.intervals.length >= LIMITS.intervalsPerDay}
                onClick={() => {
                  const last = day.intervals.at(-1);
                  const start = last ? Math.min(toMinutes(last.end) + 60, 22 * 60) : 9 * 60;
                  onChange({
                    ...day,
                    intervals: [
                      ...day.intervals,
                      { start: toClock(start), end: toClock(Math.min(start + 120, 23 * 60 + 45)) },
                    ],
                  });
                }}
              >
                <Plus /> Add interval
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="sm">
                    <Copy /> Copy to…
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel>Copy {name}’s hours to</DropdownMenuLabel>
                  <DropdownMenuItem
                    onSelect={() => onCopy(order.filter((d) => d !== day.dayOfWeek))}
                  >
                    Every other day
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {order
                    .filter((d) => d !== day.dayOfWeek)
                    .map((d) => (
                      <DropdownMenuItem key={d} onSelect={() => onCopy([d])}>
                        {WEEKDAYS[d]}
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      ) : (
        <p className="flex h-10 items-center text-sm text-muted-foreground">Unavailable</p>
      )}
    </div>
  );
}

/**
 * Seven-day editor for a therapist's regular hours: several intervals a day, copy a day
 * to others, inline overlap errors and a warning when hours fall outside the center's.
 */
export function AvailabilityEditor({
  value,
  onChange,
  errors = {},
  centerHours,
  weekStartsOn = 6,
  disabled = false,
}: {
  value: DayValue[];
  onChange: (days: DayValue[]) => void;
  errors?: Record<string, string>;
  /** The center's week, Sunday first, to show opening hours beside each day */
  centerHours?: WorkingDay[];
  weekStartsOn?: number;
  disabled?: boolean;
}) {
  const order = weekOrder(weekStartsOn);
  const setDay = (day: DayValue) =>
    onChange(value.map((d) => (d.dayOfWeek === day.dayOfWeek ? day : d)));
  const copy = (from: number, targets: number[]) => {
    const source = value[from];
    onChange(
      value.map((d) =>
        targets.includes(d.dayOfWeek)
          ? {
              ...d,
              isAvailable: source.isAvailable,
              intervals: source.intervals.map((iv) => ({ ...iv })),
            }
          : d,
      ),
    );
  };

  return (
    <div className="divide-y divide-border">
      {order.map((dayOfWeek) => (
        <DayRow
          key={dayOfWeek}
          day={value[dayOfWeek]}
          center={centerHours?.[dayOfWeek]}
          errors={errors}
          disabled={disabled}
          order={order}
          onChange={setDay}
          onCopy={(targets) => copy(dayOfWeek, targets)}
        />
      ))}
    </div>
  );
}
