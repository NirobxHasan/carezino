'use client';

import * as React from 'react';
import { Controller, useForm, type Path } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { RequirePermission } from '@/components/auth/require-permission';
import { ErrorState, PageSkeleton } from '@/components/feedback/states';
import { Field, FormSection } from '@/components/forms/field';
import { SectionHeader } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui/sonner';
import {
  useSchedulingSettings,
  useUpdateSchedulingSettings,
  type SchedulingSettingsUpdate,
} from '@/lib/api/settings';
import { isApiError } from '@/lib/api/client';
import { useUnsavedChanges } from '@/lib/hooks/use-unsaved-changes';
import { useSession } from '@/lib/session';
import { LIMITS } from '@/lib/settings-limits';
import type { SchedulingSettings } from '@/lib/types';
import {
  NumberWithUnit,
  SettingsFormFooter,
  ToggleRow,
  UNIT_MINUTES,
  splitDuration,
  type TimeUnit,
} from './settings-controls';

const NOTICE_UNITS = ['minutes', 'hours', 'days'] as const satisfies readonly TimeUnit[];
const ADVANCE_UNITS = ['days', 'weeks'] as const satisfies readonly TimeUnit[];

const amount = (units: readonly [TimeUnit, ...TimeUnit[]]) =>
  z.object({
    value: z.number({ error: 'Enter a number' }).int('Use a whole number').min(0),
    unit: z.enum(units),
  });

const schema = z
  .object({
    slotIntervalMinutes: z.string(),
    bookingBufferMinutes: z
      .number({ error: 'Enter a number of minutes' })
      .int('Use whole minutes')
      .min(0, 'Can’t be negative')
      .max(
        LIMITS.bookingBufferMinutes.max,
        `Use at most ${LIMITS.bookingBufferMinutes.max} minutes`,
      ),
    allowCustomDuration: z.boolean(),
    allowBookingOnClosedDays: z.boolean(),
    advanceBookingLimit: amount(ADVANCE_UNITS),
    minimumBookingNotice: amount(NOTICE_UNITS),
    allowDoubleBooking: z.boolean(),
    allowPastDateBooking: z.boolean(),
    cancellationCutoff: amount(NOTICE_UNITS),
  })
  .superRefine((v, ctx) => {
    const check = (
      path: string,
      a: { value: number; unit: TimeUnit },
      perUnit: number,
      { min, max }: { min: number; max: number },
      message: string,
    ) => {
      const total = (a.value * UNIT_MINUTES[a.unit]) / perUnit;
      if (total < min || total > max)
        ctx.addIssue({ code: 'custom', path: [path, 'value'], message });
    };
    check(
      'advanceBookingLimit',
      v.advanceBookingLimit,
      UNIT_MINUTES.days,
      LIMITS.advanceBookingLimitDays,
      `Use 1 day to ${LIMITS.advanceBookingLimitDays.max / 365} years`,
    );
    check(
      'minimumBookingNotice',
      v.minimumBookingNotice,
      1,
      LIMITS.minimumBookingNoticeMinutes,
      'Use up to 30 days',
    );
    check(
      'cancellationCutoff',
      v.cancellationCutoff,
      1,
      LIMITS.cancellationCutoffMinutes,
      'Use up to 30 days',
    );
  });

type Values = z.infer<typeof schema>;

function toValues(s: SchedulingSettings): Values {
  return {
    slotIntervalMinutes: String(s.slotIntervalMinutes),
    bookingBufferMinutes: s.bookingBufferMinutes,
    allowCustomDuration: s.allowCustomDuration,
    allowBookingOnClosedDays: s.allowBookingOnClosedDays,
    advanceBookingLimit: splitDuration(
      s.advanceBookingLimitDays * UNIT_MINUTES.days,
      ADVANCE_UNITS,
    ) as Values['advanceBookingLimit'],
    minimumBookingNotice: splitDuration(
      s.minimumBookingNoticeMinutes,
      NOTICE_UNITS,
    ) as Values['minimumBookingNotice'],
    allowDoubleBooking: s.allowDoubleBooking,
    allowPastDateBooking: s.allowPastDateBooking,
    cancellationCutoff: splitDuration(
      s.cancellationCutoffMinutes,
      NOTICE_UNITS,
    ) as Values['cancellationCutoff'],
  };
}

const minutesOf = (a: { value: number; unit: TimeUnit }) => a.value * UNIT_MINUTES[a.unit];

/** Form values → the API's canonical units. */
function toSettings(v: Values): Omit<SchedulingSettings, 'updatedAt'> {
  return {
    slotIntervalMinutes: Number(v.slotIntervalMinutes),
    bookingBufferMinutes: v.bookingBufferMinutes,
    allowCustomDuration: v.allowCustomDuration,
    allowBookingOnClosedDays: v.allowBookingOnClosedDays,
    advanceBookingLimitDays: minutesOf(v.advanceBookingLimit) / UNIT_MINUTES.days,
    minimumBookingNoticeMinutes: minutesOf(v.minimumBookingNotice),
    allowDoubleBooking: v.allowDoubleBooking,
    allowPastDateBooking: v.allowPastDateBooking,
    cancellationCutoffMinutes: minutesOf(v.cancellationCutoff),
  };
}

/** API field → form field, for placing server errors. */
const SERVER_FIELDS: Record<string, Path<Values>> = {
  slotIntervalMinutes: 'slotIntervalMinutes',
  bookingBufferMinutes: 'bookingBufferMinutes',
  advanceBookingLimitDays: 'advanceBookingLimit.value',
  minimumBookingNoticeMinutes: 'minimumBookingNotice.value',
  cancellationCutoffMinutes: 'cancellationCutoff.value',
};

function SchedulingForm({ settings }: { settings: SchedulingSettings }) {
  const { can } = useSession();
  const editable = can('center_settings.update');
  const update = useUpdateSchedulingSettings();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: toValues(settings),
    mode: 'onTouched',
  });
  const { register, control, handleSubmit, formState, reset, setError } = form;
  const { errors, isDirty, isSubmitting } = formState;
  useUnsavedChanges(isDirty);

  const onSubmit = handleSubmit(async (values) => {
    const next = toSettings(values);
    const changed = Object.fromEntries(
      Object.entries(next).filter(([k, v]) => settings[k as keyof SchedulingSettings] !== v),
    ) as SchedulingSettingsUpdate;
    try {
      const saved = await update.mutateAsync(changed);
      reset(toValues(saved));
      toast.success('Scheduling settings saved');
    } catch (error) {
      // The API reports canonical fields (e.g. cancellationCutoffMinutes); place them on
      // the inputs they came from.
      let placed = false;
      if (isApiError(error) && error.errors) {
        for (const [field, message] of Object.entries(error.errors)) {
          const target = SERVER_FIELDS[field];
          if (!target) continue;
          setError(target, { type: 'server', message }, { shouldFocus: !placed });
          placed = true;
        }
      }
      if (!placed)
        toast.error(error instanceof Error ? error.message : 'Couldn’t save. Try again.');
    }
  });

  const toggle = (
    name:
      | 'allowCustomDuration'
      | 'allowBookingOnClosedDays'
      | 'allowDoubleBooking'
      | 'allowPastDateBooking',
    label: string,
    description: string,
  ) => (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <ToggleRow
          label={label}
          description={description}
          checked={field.value}
          onCheckedChange={field.onChange}
          disabled={!editable}
        />
      )}
    />
  );

  const amountField = (
    name: 'advanceBookingLimit' | 'minimumBookingNotice' | 'cancellationCutoff',
    label: string,
    helper: string,
    units: readonly TimeUnit[],
  ) => (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Field label={label} error={errors[name]?.value?.message} helper={helper}>
          <NumberWithUnit
            value={field.value.value}
            unit={field.value.unit}
            units={units}
            disabled={!editable}
            onChange={(value) => field.onChange({ ...field.value, value })}
            onUnitChange={(unit) => field.onChange({ ...field.value, unit })}
          />
        </Field>
      )}
    />
  );

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate>
        <fieldset disabled={!editable} className="contents">
          <CardContent className="pt-6">
            {!editable && (
              <p className="mb-5 rounded-lg bg-muted px-3 py-2 text-[13px] text-muted-foreground">
                Only center administrators can change these settings.
              </p>
            )}
            <FormSection title="Time & duration" description="How the booking calendar is divided.">
              <Controller
                control={control}
                name="slotIntervalMinutes"
                render={({ field }) => (
                  <Field
                    id="slot-interval"
                    label="Slot interval"
                    error={errors.slotIntervalMinutes?.message}
                    helper="How far apart session start times are offered."
                  >
                    <Select value={field.value} onValueChange={field.onChange} disabled={!editable}>
                      <SelectTrigger id="slot-interval">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LIMITS.slotIntervalMinutes.map((m) => (
                          <SelectItem key={m} value={String(m)}>
                            Every {m} minutes
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              />
              <Field
                label="Buffer after each session"
                error={errors.bookingBufferMinutes?.message}
                helper="Minutes kept free for notes or changing rooms. 0 for none."
              >
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={LIMITS.bookingBufferMinutes.max}
                  className="tabular"
                  {...register('bookingBufferMinutes', { valueAsNumber: true })}
                />
              </Field>
              {toggle(
                'allowCustomDuration',
                'Allow custom session lengths',
                'Staff can book a length that isn’t one of the therapy type’s durations.',
              )}
            </FormSection>
            <FormSection title="Booking rules" description="When sessions can be booked.">
              {amountField(
                'advanceBookingLimit',
                'Book up to',
                'How far ahead sessions can be booked.',
                ADVANCE_UNITS,
              )}
              {amountField(
                'minimumBookingNotice',
                'Minimum notice',
                'How soon before the start a session can still be booked. 0 for none.',
                NOTICE_UNITS,
              )}
              {toggle(
                'allowBookingOnClosedDays',
                'Allow booking on closed days',
                'Lets staff book on weekly closed days and holidays, for example for make-up sessions.',
              )}
              {toggle(
                'allowDoubleBooking',
                'Allow double booking',
                'Lets a therapist or patient have overlapping sessions. Clashes are still detected and shown when booking.',
              )}
              {toggle(
                'allowPastDateBooking',
                'Allow booking past dates',
                'Lets staff record sessions that already took place.',
              )}
            </FormSection>
            <FormSection
              title="Cancellation rules"
              description="What counts as a late cancellation."
            >
              {amountField(
                'cancellationCutoff',
                'Cancellation cutoff',
                'Cancelling with less notice than this counts as late. 0 turns it off.',
                NOTICE_UNITS,
              )}
            </FormSection>
          </CardContent>
          {editable && (
            <SettingsFormFooter
              dirty={isDirty}
              submitting={isSubmitting}
              onDiscard={() => reset(toValues(settings))}
            />
          )}
        </fieldset>
      </form>
    </Card>
  );
}

export function SchedulingSettingsScreen() {
  const { data, isPending, error, refetch } = useSchedulingSettings();
  return (
    <RequirePermission permission="center_settings.read">
      <SectionHeader
        title="Scheduling"
        description="Booking policies for this center. They take effect when appointment booking is set up."
      />
      {isPending ? (
        <PageSkeleton />
      ) : error ? (
        <Card>
          <ErrorState error={error} onRetry={() => void refetch()} />
        </Card>
      ) : (
        <SchedulingForm key={data.updatedAt} settings={data} />
      )}
    </RequirePermission>
  );
}
