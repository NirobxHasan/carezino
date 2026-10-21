'use client';

import * as React from 'react';
import {
  Controller,
  useFieldArray,
  useForm,
  useFormState,
  useWatch,
  type Control,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, CopyCheck, Globe, Plus, X } from 'lucide-react';
import { z } from 'zod';

import { RequirePermission } from '@/components/auth/require-permission';
import { ErrorState, PageSkeleton } from '@/components/feedback/states';
import { TimePicker } from '@/components/forms/time-picker';
import { SectionHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { toast } from '@/components/ui/sonner';
import { Switch } from '@/components/ui/switch';
import { useGeneralSettings, useSaveWorkingHours, useWorkingHours } from '@/lib/api/settings';
import { formatClock } from '@/lib/format';
import { showFormError } from '@/lib/forms';
import { useUnsavedChanges } from '@/lib/hooks/use-unsaved-changes';
import { useSession } from '@/lib/session';
import { LIMITS, WEEKDAYS, weekOrder } from '@/lib/settings-limits';
import type { WorkingWeek } from '@/lib/types';
import { cn } from '@/lib/utils';

const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const DEFAULT_INTERVAL = { start: '09:00', end: '17:00' };

/** Same rules as the API: start before end, no overlaps, same-day only. */
const schema = z.object({
  days: z
    .array(
      z.object({
        dayOfWeek: z.number(),
        isOpen: z.boolean(),
        intervals: z.array(z.object({ start: z.string(), end: z.string() })),
      }),
    )
    .superRefine((days, ctx) => {
      days.forEach((day, d) => {
        if (!day.isOpen) return;
        const parsed = day.intervals.map((iv, i) => ({
          i,
          start: toMinutes(iv.start),
          end: toMinutes(iv.end),
        }));
        for (const iv of parsed) {
          if (iv.start >= iv.end) {
            ctx.addIssue({
              code: 'custom',
              path: [d, 'intervals', iv.i, 'end'],
              message: 'Closing time must be after opening time',
            });
          }
        }
        const valid = parsed.filter((iv) => iv.start < iv.end).sort((a, b) => a.start - b.start);
        for (let k = 1; k < valid.length; k++) {
          if (valid[k].start < valid[k - 1].end) {
            ctx.addIssue({
              code: 'custom',
              path: [d, 'intervals', valid[k].i, 'start'],
              message: `Overlaps ${formatClock(day.intervals[valid[k - 1].i].start)} – ${formatClock(day.intervals[valid[k - 1].i].end)}`,
            });
          }
        }
      });
    }),
});

type Values = z.infer<typeof schema>;

function toValues(week: WorkingWeek): Values {
  return {
    days: week.days.map((d) => ({
      dayOfWeek: d.dayOfWeek,
      isOpen: d.isOpen,
      intervals: d.intervals.map((iv) => ({ ...iv })),
    })),
  };
}

function IntervalError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="flex items-center gap-1 text-xs text-danger-foreground">
      <AlertCircle className="size-3.5 shrink-0" aria-hidden />
      {message}
    </p>
  );
}

function DayRow({
  index,
  control,
  editable,
  onCopyToOpenDays,
}: {
  index: number;
  control: Control<Values>;
  editable: boolean;
  onCopyToOpenDays: (index: number) => void;
}) {
  const { fields, append, remove, replace } = useFieldArray({
    control,
    name: `days.${index}.intervals`,
  });
  const isOpen = useWatch({ control, name: `days.${index}.isOpen` });
  const { errors: formErrors } = useFormState({ control, name: `days.${index}.intervals` });
  const errors = formErrors.days?.[index]?.intervals;
  const dayName = WEEKDAYS[index];

  return (
    <div className="grid gap-3 py-4 first:pt-0 last:pb-0 sm:grid-cols-[11rem_minmax(0,1fr)]">
      <Controller
        control={control}
        name={`days.${index}.isOpen`}
        render={({ field }) => (
          <label className="flex h-10 items-center gap-3">
            <Switch
              checked={field.value}
              onCheckedChange={(open) => {
                field.onChange(open);
                if (open && fields.length === 0) replace([{ ...DEFAULT_INTERVAL }]);
              }}
              aria-label={`Open on ${dayName}`}
            />
            <span className={cn('text-sm font-medium', !field.value && 'text-muted-foreground')}>
              {dayName}
            </span>
          </label>
        )}
      />
      {isOpen ? (
        <div className="grid gap-2">
          {fields.map((interval, i) => (
            <div key={interval.id} className="grid gap-1">
              <div className="flex items-center gap-1.5 sm:gap-2">
                <Controller
                  control={control}
                  name={`days.${index}.intervals.${i}.start`}
                  render={({ field }) => (
                    <TimePicker
                      value={field.value}
                      onChange={field.onChange}
                      min="00:00"
                      max="23:45"
                      step={15}
                      className="w-28 sm:w-32"
                      aria-label={`${dayName} opens at`}
                      aria-invalid={errors?.[i]?.start ? true : undefined}
                    />
                  )}
                />
                <span className="text-sm text-muted-foreground" aria-hidden>
                  to
                </span>
                <Controller
                  control={control}
                  name={`days.${index}.intervals.${i}.end`}
                  render={({ field }) => (
                    <TimePicker
                      value={field.value}
                      onChange={field.onChange}
                      min="00:15"
                      max="23:45"
                      step={15}
                      className="w-28 sm:w-32"
                      aria-label={`${dayName} closes at`}
                      aria-invalid={errors?.[i]?.end ? true : undefined}
                    />
                  )}
                />
                {editable && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${interval.start}–${interval.end} on ${dayName}`}
                    onClick={() => remove(i)}
                    disabled={fields.length === 1}
                    title={fields.length === 1 ? 'Switch the day off to close it' : undefined}
                  >
                    <X />
                  </Button>
                )}
              </div>
              <IntervalError message={errors?.[i]?.start?.message ?? errors?.[i]?.end?.message} />
            </div>
          ))}
          {editable && (
            <div className="flex flex-wrap gap-1 [&_button]:text-muted-foreground [&_button:hover]:text-foreground">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={fields.length >= LIMITS.intervalsPerDay}
                onClick={() => {
                  const last = fields.at(-1);
                  const start = last ? last.end : DEFAULT_INTERVAL.start;
                  const end = toMinutes(start) + 60 <= 23 * 60 + 45 ? addHour(start) : '23:45';
                  append({ start, end });
                }}
              >
                <Plus /> Add time range
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onCopyToOpenDays(index)}
              >
                <CopyCheck /> Copy to other open days
              </Button>
            </div>
          )}
        </div>
      ) : (
        <p className="flex h-10 items-center text-sm text-muted-foreground">Closed</p>
      )}
    </div>
  );
}

function addHour(time: string) {
  const m = toMinutes(time) + 60;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function WorkingHoursForm({ week, weekStartsOn }: { week: WorkingWeek; weekStartsOn: number }) {
  const { can } = useSession();
  const editable = can('center_settings.update');
  const save = useSaveWorkingHours();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues(week) });
  const { control, handleSubmit, formState, reset, setError, getValues, setValue } = form;
  const { isDirty, isSubmitting } = formState;
  useUnsavedChanges(isDirty);
  const days = useWatch({ control, name: 'days' });
  const allClosed = days.every((d) => !d.isOpen);

  const copyToOpenDays = (from: number) => {
    const source = getValues(`days.${from}.intervals`);
    let copied = 0;
    getValues('days').forEach((day, i) => {
      if (i === from || !day.isOpen) return;
      setValue(
        `days.${i}.intervals`,
        source.map((iv) => ({ ...iv })),
        { shouldDirty: true },
      );
      copied++;
    });
    toast.success(
      copied
        ? `Copied ${WEEKDAYS[from]}’s hours to ${copied} other open day${copied > 1 ? 's' : ''}`
        : 'No other days are open yet. Switch them on first.',
    );
  };

  const onSubmit = handleSubmit(async (values) => {
    try {
      const saved = await save.mutateAsync(
        values.days.map((d) => ({
          dayOfWeek: d.dayOfWeek,
          intervals: d.isOpen ? d.intervals : [],
        })),
      );
      reset(toValues(saved));
      toast.success('Working hours saved');
    } catch (error) {
      // The API's paths (days.2.intervals.0.end) are the form's paths.
      const paths = values.days.flatMap((d, i) =>
        d.intervals.flatMap((_, j) => [
          `days.${i}.intervals.${j}.start`,
          `days.${i}.intervals.${j}.end`,
        ]),
      );
      showFormError(error, setError, paths);
    }
  });

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate>
        <fieldset disabled={!editable} className="contents">
          <CardContent className="pt-5">
            <p className="mb-4 flex items-center gap-2 text-[13px] text-muted-foreground">
              <Globe className="size-4 shrink-0" aria-hidden />
              Times are in {week.timezone}. Add a second time range for a lunch break or a split
              shift.
            </p>
            {!editable && (
              <p className="mb-4 rounded-lg bg-muted px-3 py-2 text-[13px] text-muted-foreground">
                Only center administrators can change working hours.
              </p>
            )}
            {allClosed && (
              <p className="mb-4 rounded-lg bg-warning-subtle px-3 py-2 text-[13px] text-warning-foreground">
                Every day is closed, so nothing can be booked. Switch on the days your center is
                open.
              </p>
            )}
            <div className="divide-y divide-border">
              {weekOrder(weekStartsOn).map((dayOfWeek) => (
                <DayRow
                  key={dayOfWeek}
                  index={dayOfWeek}
                  control={control}
                  editable={editable}
                  onCopyToOpenDays={copyToOpenDays}
                />
              ))}
            </div>
          </CardContent>
          {editable && (
            <CardFooter className="justify-end">
              {isDirty && (
                <span className="mr-auto text-[13px] text-muted-foreground" role="status">
                  Unsaved changes
                </span>
              )}
              <Button
                type="button"
                variant="secondary"
                disabled={!isDirty || isSubmitting}
                onClick={() => reset(toValues(week))}
              >
                Discard changes
              </Button>
              <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
                Save changes
              </Button>
            </CardFooter>
          )}
        </fieldset>
      </form>
    </Card>
  );
}

export function WorkingHoursScreen() {
  const { data, isPending, error, refetch } = useWorkingHours();
  const general = useGeneralSettings();
  return (
    <RequirePermission permission="center_settings.read">
      <SectionHeader
        title="Working hours"
        description="When your center is open each week. Bookings will only be offered inside these hours."
      />
      {isPending || general.isPending ? (
        <PageSkeleton />
      ) : error ? (
        <Card>
          <ErrorState error={error} onRetry={() => void refetch()} />
        </Card>
      ) : (
        <WorkingHoursForm
          key={JSON.stringify(data.days)}
          week={data}
          weekStartsOn={general.data?.weekStartsOn ?? 6}
        />
      )}
    </RequirePermission>
  );
}
