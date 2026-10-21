'use client';

import * as React from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { RequirePermission } from '@/components/auth/require-permission';
import { ErrorState, PageSkeleton } from '@/components/feedback/states';
import { Field, FormSection } from '@/components/forms/field';
import { SectionHeader } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { RadioCard, RadioGroup } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui/sonner';
import {
  useGeneralSettings,
  useUpdateGeneralSettings,
  type GeneralSettingsUpdate,
} from '@/lib/api/settings';
import { formatCenterClock, formatCenterDate } from '@/lib/format';
import { showFormError } from '@/lib/forms';
import { useUnsavedChanges } from '@/lib/hooks/use-unsaved-changes';
import { useSession } from '@/lib/session';
import { WEEKDAYS } from '@/lib/settings-limits';
import type {
  DateDisplayFormat,
  DefaultDurationBehavior,
  GeneralSettings,
  TimeDisplayFormat,
} from '@/lib/types';
import { SettingsFormFooter, ToggleRow } from './settings-controls';

const DURATION_BEHAVIORS: { value: DefaultDurationBehavior; title: string; description: string }[] =
  [
    {
      value: 'THERAPY_TYPE_DEFAULT',
      title: 'Therapy type’s default',
      description: 'Start from the default duration set for the therapy type.',
    },
    {
      value: 'PREVIOUS_SESSION',
      title: 'Patient’s last session',
      description: 'Reuse the length of the patient’s previous session for that therapy.',
    },
    {
      value: 'ASK_EACH_TIME',
      title: 'Ask every time',
      description: 'Nothing is preselected; staff choose the length for each booking.',
    },
  ];

const DATE_FORMATS: DateDisplayFormat[] = ['D_MMM_YYYY', 'DD_MM_YYYY', 'MM_DD_YYYY', 'YYYY_MM_DD'];
const TIME_FORMATS: { value: TimeDisplayFormat; label: string }[] = [
  { value: 'H12', label: '12-hour' },
  { value: 'H24', label: '24-hour' },
];
const WEEK_STARTS = [6, 0, 1];

const schema = z.object({
  defaultDurationBehavior: z.enum(['THERAPY_TYPE_DEFAULT', 'PREVIOUS_SESSION', 'ASK_EACH_TIME']),
  autoGeneratePatientCode: z.boolean(),
  patientCodePrefix: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .refine(
      (v) => v === '' || /^[A-Z0-9][A-Z0-9-]{0,7}$/.test(v),
      'Use up to 8 letters, numbers or dashes, e.g. P-',
    ),
  defaultPatientStatus: z.enum(['ACTIVE', 'WAITLIST']),
  dateFormat: z.enum(['D_MMM_YYYY', 'DD_MM_YYYY', 'MM_DD_YYYY', 'YYYY_MM_DD']),
  timeFormat: z.enum(['H12', 'H24']),
  weekStartsOn: z.string(),
});

type Values = z.input<typeof schema>;
const FIELDS = Object.keys(schema.shape);

function toValues(s: GeneralSettings): Values {
  return {
    defaultDurationBehavior: s.defaultDurationBehavior,
    autoGeneratePatientCode: s.autoGeneratePatientCode,
    patientCodePrefix: s.patientCodePrefix ?? '',
    defaultPatientStatus: s.defaultPatientStatus,
    dateFormat: s.dateFormat,
    timeFormat: s.timeFormat,
    weekStartsOn: String(s.weekStartsOn),
  };
}

function GeneralForm({ settings }: { settings: GeneralSettings }) {
  const { can } = useSession();
  const editable = can('center_settings.update');
  const update = useUpdateGeneralSettings();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: toValues(settings),
    mode: 'onTouched',
  });
  const { register, control, handleSubmit, formState, reset, setError } = form;
  const { errors, isDirty, isSubmitting, dirtyFields } = formState;
  useUnsavedChanges(isDirty);
  const autoCode = useWatch({ control, name: 'autoGeneratePatientCode' });
  const prefix = useWatch({ control, name: 'patientCodePrefix' });
  // A fixed sample date, so the examples don't depend on today's date.
  const sample = React.useMemo(() => new Date(2026, 9, 14, 14, 30), []);

  const onSubmit = handleSubmit(async (raw) => {
    const values = schema.parse(raw);
    const all: GeneralSettingsUpdate = {
      ...values,
      // An empty prefix removes it.
      patientCodePrefix: values.patientCodePrefix || null,
      weekStartsOn: Number(values.weekStartsOn),
    };
    const changed = Object.fromEntries(
      Object.entries(all).filter(([key]) => dirtyFields[key as keyof Values]),
    ) as GeneralSettingsUpdate;
    try {
      const saved = await update.mutateAsync(changed);
      reset(toValues(saved));
      toast.success('General settings saved');
    } catch (error) {
      showFormError(error, setError, FIELDS);
    }
  });

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
            <FormSection
              title="Session length"
              description="Which duration is picked when a new session is booked. Staff can still change it."
            >
              <Controller
                control={control}
                name="defaultDurationBehavior"
                render={({ field }) => (
                  <RadioGroup
                    value={field.value}
                    onValueChange={field.onChange}
                    className="sm:col-span-2"
                    aria-label="Default session length"
                    disabled={!editable}
                  >
                    {DURATION_BEHAVIORS.map((b) => (
                      <RadioCard
                        key={b.value}
                        value={b.value}
                        title={b.title}
                        description={b.description}
                        disabled={!editable}
                      />
                    ))}
                  </RadioGroup>
                )}
              />
            </FormSection>
            <FormSection title="Patients" description="Used when patients are registered.">
              <Controller
                control={control}
                name="autoGeneratePatientCode"
                render={({ field }) => (
                  <ToggleRow
                    label="Generate patient codes automatically"
                    description="Each new patient gets the next number in sequence. Turn off to type codes yourself."
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={!editable}
                  />
                )}
              />
              <Field
                label="Code prefix"
                optional
                error={errors.patientCodePrefix?.message}
                helper={
                  autoCode
                    ? `New codes look like ${(prefix ?? '').trim().toUpperCase()}0001`
                    : 'Only used for generated codes.'
                }
              >
                <Input
                  placeholder="e.g. P-"
                  className="uppercase"
                  autoComplete="off"
                  disabled={!editable || !autoCode}
                  {...register('patientCodePrefix')}
                />
              </Field>
              <Controller
                control={control}
                name="defaultPatientStatus"
                render={({ field }) => (
                  <Field
                    id="default-patient-status"
                    label="New patients start as"
                    error={errors.defaultPatientStatus?.message}
                  >
                    <Select value={field.value} onValueChange={field.onChange} disabled={!editable}>
                      <SelectTrigger id="default-patient-status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ACTIVE">Active</SelectItem>
                        <SelectItem value="WAITLIST">Waitlist</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              />
            </FormSection>
            <FormSection
              title="Date & time display"
              description="How dates and times appear on screens for everyone at this center."
            >
              <Controller
                control={control}
                name="dateFormat"
                render={({ field }) => (
                  <Field id="date-format" label="Date format" error={errors.dateFormat?.message}>
                    <Select value={field.value} onValueChange={field.onChange} disabled={!editable}>
                      <SelectTrigger id="date-format">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DATE_FORMATS.map((f) => (
                          <SelectItem key={f} value={f}>
                            {formatCenterDate(sample, f)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              />
              <Controller
                control={control}
                name="timeFormat"
                render={({ field }) => (
                  <Field id="time-format" label="Time format" error={errors.timeFormat?.message}>
                    <Select value={field.value} onValueChange={field.onChange} disabled={!editable}>
                      <SelectTrigger id="time-format">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TIME_FORMATS.map((f) => (
                          <SelectItem key={f.value} value={f.value}>
                            {f.label} ({formatCenterClock('14:30', f.value)})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              />
              <Controller
                control={control}
                name="weekStartsOn"
                render={({ field }) => (
                  <Field
                    id="week-starts-on"
                    label="Week starts on"
                    error={errors.weekStartsOn?.message}
                    helper="First day on calendars and in working hours."
                  >
                    <Select value={field.value} onValueChange={field.onChange} disabled={!editable}>
                      <SelectTrigger id="week-starts-on">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {WEEK_STARTS.map((d) => (
                          <SelectItem key={d} value={String(d)}>
                            {WEEKDAYS[d]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              />
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

export function GeneralSettingsScreen() {
  const { data, isPending, error, refetch } = useGeneralSettings();
  return (
    <RequirePermission permission="center_settings.read">
      <SectionHeader
        title="General"
        description="Everyday preferences for this center. Time zone and currency are on the center profile."
      />
      {isPending ? (
        <PageSkeleton />
      ) : error ? (
        <Card>
          <ErrorState error={error} onRetry={() => void refetch()} />
        </Card>
      ) : (
        <GeneralForm key={data.updatedAt} settings={data} />
      )}
    </RequirePermission>
  );
}
