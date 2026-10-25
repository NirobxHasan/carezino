'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { addDays, parseISO } from 'date-fns';
import { AlertTriangle, CalendarCheck2, CheckCircle2, Clock, Repeat, X } from 'lucide-react';

import { RequirePermission } from '@/components/auth/require-permission';
import { ColorDot } from '@/components/forms/color-picker';
import { DatePicker } from '@/components/forms/date-picker';
import { Field } from '@/components/forms/field';
import { SearchableSelect } from '@/components/forms/searchable-select';
import { TimePicker } from '@/components/forms/time-picker';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { SegmentedList, SegmentedTrigger, Tabs } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  useAppointmentList,
  useCreateAppointment,
  useCreateSeries,
  useSeriesPreview,
  type SeriesInput,
} from '@/lib/api/appointments';
import { isApiError } from '@/lib/api/client';
import { usePatient, usePatientList } from '@/lib/api/patients';
import { useGeneralSettings, useSchedulingSettings } from '@/lib/api/settings';
import { useTherapistList } from '@/lib/api/therapists';
import { useTherapyTypeList } from '@/lib/api/therapy-types';
import { formatPhone } from '@/lib/format';
import { useDebounced } from '@/lib/hooks/use-debounced';
import { useSession } from '@/lib/session';
import { LIMITS, WEEKDAYS, formatMinutes, weekOrder } from '@/lib/settings-limits';
import type {
  AppointmentType,
  ClockTime,
  ISODate,
  PatientSummary,
  SeriesFrequency,
} from '@/lib/types';
import { cn } from '@/lib/utils';
import { PackagePicker } from '../packages/package-picker';
import { PatientAvatar, PatientStatusBadge, formatPatientAge } from '../patients/patient-display';
import {
  APPOINTMENT_TYPES,
  appointmentLinks,
  centerToday,
  describeRule,
  useCenterFormat,
} from './appointment-display';
import { ConflictNotice, conflictOf } from './conflicts';
import { SlotPicker } from './slot-picker';

type Mode = 'single' | 'recurring';

interface Recurrence {
  frequency: SeriesFrequency;
  interval: number;
  daysOfWeek: number[];
  endType: 'UNTIL' | 'COUNT';
  count: number;
  until: ISODate | undefined;
}

const UNITS: Record<SeriesFrequency, string> = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month' };
/** Shown before the API's own maximum, since that's the usual mistake */
const SESSION_COUNTS = [4, 8, 12, 16, 24];

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <p className="text-[13px] text-muted-foreground">{description}</p>}
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">{children}</CardContent>
    </Card>
  );
}

/** The chosen patient, with what front desk needs to recognize and reach them. */
function PatientCard({ patient, onClear }: { patient: PatientSummary; onClear?: () => void }) {
  const contact = patient.primaryContact;
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-3">
      <PatientAvatar patient={patient} size="md" />
      <div className="min-w-0 flex-1 text-[13px]">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {patient.fullName}
          <PatientStatusBadge status={patient.status} />
        </p>
        <p className="text-muted-foreground">
          {[patient.code, formatPatientAge(patient.age)].filter(Boolean).join(' · ')}
        </p>
        {contact && (
          <p className="text-muted-foreground">
            {contact.type === 'SELF' ? 'Self' : contact.name}
            {contact.mobile && ` · ${formatPhone(contact.mobile)}`}
          </p>
        )}
      </div>
      {onClear && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Choose another patient"
          onClick={onClear}
        >
          <X />
        </Button>
      )}
    </div>
  );
}

function Summary({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid gap-3 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="grid gap-0.5">
          <dt className="text-[13px] text-muted-foreground">{label}</dt>
          <dd className={cn(!value && 'text-subtle-foreground')}>{value || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Booking in the order front desk thinks: patient → service → therapist → date and
 * length → a free time → confirm. Each choice refreshes what depends on it, and only
 * times the API says are free are offered; the API checks everything again on booking.
 * Recurring bookings preview every date with its problems before anything is saved.
 */
function BookingForm() {
  const router = useRouter();
  const search = useSearchParams();
  const { activeCenter } = useSession();
  const fmt = useCenterFormat();
  const scheduling = useSchedulingSettings();
  const general = useGeneralSettings();
  const types = useTherapyTypeList({ status: 'ACTIVE' });
  const today = centerToday(activeCenter.timezone);

  // ── Patient ──
  const prefillPatient = usePatient(search.get('patientId') ?? undefined);
  const [picked, setPicked] = React.useState<PatientSummary | null>(null);
  const [cleared, setCleared] = React.useState(false);
  const patient = picked ?? (cleared ? null : (prefillPatient.data ?? null));
  const [patientQuery, setPatientQuery] = React.useState('');
  const debouncedQuery = useDebounced(patientQuery, 250);
  const patients = usePatientList(
    { search: debouncedQuery, pageSize: 8, sortBy: 'fullName', sortOrder: 'asc' },
    !patient,
  );

  // ── Service ──
  const [type, setType] = React.useState<AppointmentType>(
    search.get('type') === 'ASSESSMENT' ? 'ASSESSMENT' : 'THERAPY_SESSION',
  );
  const [therapyTypeId, setTherapyTypeId] = React.useState(search.get('therapyTypeId') ?? '');
  const therapyType = types.data?.find((t) => t.id === therapyTypeId);
  const [therapistId, setTherapistId] = React.useState(search.get('therapistId') ?? '');
  const therapists = useTherapistList(
    { status: 'ACTIVE', therapyTypeId, pageSize: 100, sortBy: 'fullName' },
    Boolean(therapyTypeId),
  );
  const therapist = therapists.data?.items.find((t) => t.id === therapistId);
  // A therapist chosen before the therapy changed may not provide the new one.
  const therapistOk = Boolean(therapist);

  // ── Length: preselected as the center's General settings say ──
  const behavior = general.data?.defaultDurationBehavior ?? 'THERAPY_TYPE_DEFAULT';
  const previous = useAppointmentList(
    {
      patientId: patient?.id,
      therapyTypeId,
      status: ['SCHEDULED', 'CONFIRMED', 'COMPLETED'],
      sortOrder: 'desc',
      pageSize: 1,
    },
    behavior === 'PREVIOUS_SESSION' && Boolean(patient && therapyTypeId),
  );
  const durations = (therapyType?.durationOptions ?? []).filter((o) => o.isActive);
  const suggested =
    behavior === 'ASK_EACH_TIME' || !therapyType
      ? undefined
      : behavior === 'PREVIOUS_SESSION' && previous.data?.items[0]
        ? previous.data.items[0].durationMinutes
        : therapyType.defaultDurationMinutes;
  const [durationChoice, setDurationChoice] = React.useState<number | 'custom' | undefined>();
  const [customMinutes, setCustomMinutes] = React.useState('');
  const duration =
    durationChoice === 'custom'
      ? Number(customMinutes) || undefined
      : (durationChoice ?? suggested);

  // ── When ──
  const [mode, setMode] = React.useState<Mode>('single');
  const [date, setDate] = React.useState<ISODate | undefined>(search.get('date') ?? today);
  const [startTime, setStartTime] = React.useState<ClockTime | undefined>(
    search.get('time') ?? undefined,
  );
  const [manualTime, setManualTime] = React.useState(false);
  const [notes, setNotes] = React.useState('');
  /** The patient's package that pays for it; null books without one */
  const [packageEnrollmentId, setPackageEnrollmentId] = React.useState<string | null>(null);
  const [recurrence, setRecurrence] = React.useState<Recurrence>(() => ({
    frequency: 'WEEKLY',
    interval: 1,
    daysOfWeek: [parseISO(search.get('date') ?? today).getDay()],
    endType: 'COUNT',
    count: 8,
    until: undefined,
  }));
  const setRule = (patch: Partial<Recurrence>) => setRecurrence((r) => ({ ...r, ...patch }));

  const allowPast = scheduling.data?.allowPastDateBooking ?? false;
  const limitDays = scheduling.data?.advanceBookingLimitDays ?? 60;
  const disabledDays = [
    ...(allowPast ? [] : [{ before: parseISO(today) }]),
    { after: addDays(parseISO(today), limitDays) },
  ];

  /** Anything that changes which times are free forgets the chosen time. */
  const resetTime = () => setStartTime(undefined);

  const ready = Boolean(patient && therapyType && therapistOk && duration && date);
  const slotParams =
    ready && mode === 'single' && !manualTime
      ? {
          therapistId,
          therapyTypeId,
          date: date!,
          durationMinutes: duration!,
          patientId: patient!.id,
        }
      : null;

  const create = useCreateAppointment();
  const createSeries = useCreateSeries();
  const error = mode === 'single' ? create.error : createSeries.error;
  const fieldError = (field: string) => (isApiError(error) ? error.errors?.[field] : undefined);

  const base = ready
    ? {
        patientId: patient!.id,
        type,
        therapyTypeId,
        therapistId,
        durationMinutes: duration!,
        internalNotes: notes.trim() || undefined,
        ...(packageEnrollmentId && { packageEnrollmentId }),
      }
    : null;

  // ── Recurring preview: only for exactly what's on screen ──
  const seriesInput: SeriesInput | null =
    base && mode === 'recurring' && startTime && date
      ? {
          ...base,
          startTime,
          recurrence: {
            frequency: recurrence.frequency,
            interval: recurrence.interval,
            ...(recurrence.frequency === 'WEEKLY' && { daysOfWeek: recurrence.daysOfWeek }),
            startDate: date,
            endType: recurrence.endType,
            ...(recurrence.endType === 'COUNT'
              ? { count: recurrence.count }
              : { until: recurrence.until }),
          },
        }
      : null;
  const [checked, setChecked] = React.useState<SeriesInput | null>(null);
  const current = Boolean(checked && JSON.stringify(checked) === JSON.stringify(seriesInput));
  const preview = useSeriesPreview(current ? checked : null);
  const previewError = isApiError(preview.error) ? preview.error : null;
  const recurrenceError = (field: string) =>
    previewError?.errors?.[`recurrence.${field}`] ?? fieldError(`recurrence.${field}`);

  const bookSingle = (allowOverlap = false) => {
    if (!base || !date || !startTime) return;
    create.mutate(
      { ...base, date, startTime, allowOverlap },
      {
        onSuccess: (a) => {
          toast.success('Appointment booked', {
            description: `${a.patient.fullName} · ${fmt.shortDate(a.date)}, ${fmt.clock(a.startTime)} with ${a.therapist.fullName}`,
          });
          router.push(appointmentLinks.detail(a.id));
        },
        onError: (e) => {
          if (!conflictOf(e) && !(isApiError(e) && e.errors)) toast.error(e.message);
        },
      },
    );
  };

  const bookSeries = (skipConflicts: boolean) => {
    if (!checked) return;
    createSeries.mutate(
      { ...checked, skipConflicts },
      {
        onSuccess: (r) => {
          toast.success(`${r.created} session${r.created === 1 ? '' : 's'} booked`, {
            description: r.skipped.length
              ? `${r.skipped.length} date${r.skipped.length === 1 ? ' was' : 's were'} skipped`
              : `${r.series.patient.fullName} with ${r.series.therapist.fullName}`,
          });
          const first = r.series.appointments[0];
          router.push(first ? appointmentLinks.detail(first.id) : appointmentLinks.calendar);
        },
        onError: (e) => toast.error(e.message),
      },
    );
  };

  const typeOptions = (types.data ?? []).map((t) => ({
    value: t.id,
    label: t.name,
    leading: <ColorDot color={t.color} />,
    description: patient?.therapyInterests.some((i) => i.therapyTypeId === t.id)
      ? 'The patient is interested in this'
      : undefined,
  }));

  const therapistOptions = (therapists.data?.items ?? []).map((t) => {
    const noHours = t.availabilitySummary.weeklyMinutes === 0;
    return {
      value: t.id,
      label: t.fullName,
      description: noHours ? 'No weekly hours set' : (t.designation ?? t.code),
      disabled: noHours,
      keywords: [t.code],
    };
  });

  const order = weekOrder(fmt.weekStartsOn);
  const occurrences = preview.data?.occurrences ?? [];
  const summary = preview.data?.summary;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
      <div className="grid gap-4">
        <Section title="Patient & service">
          <Field label="Patient" required className="sm:col-span-2" error={fieldError('patientId')}>
            {patient ? (
              <div>
                <PatientCard
                  patient={patient}
                  onClear={() => {
                    setPicked(null);
                    setCleared(true);
                    resetTime();
                  }}
                />
              </div>
            ) : (
              <SearchableSelect
                options={(patients.data?.items ?? []).map((p) => ({
                  value: p.id,
                  label: p.fullName,
                  description: [
                    p.code,
                    p.primaryContact?.mobile && formatPhone(p.primaryContact.mobile),
                    p.status === 'INACTIVE' && 'Inactive: reactivate to book',
                  ]
                    .filter(Boolean)
                    .join(' · '),
                  disabled: p.status === 'INACTIVE',
                  leading: <PatientAvatar patient={p} size="sm" />,
                }))}
                onChange={(id) => {
                  const p = patients.data?.items.find((x) => x.id === id);
                  if (p) {
                    setPicked(p);
                    resetTime();
                  }
                }}
                onSearch={setPatientQuery}
                loading={patients.isFetching && !patients.data}
                placeholder="Search by name, patient ID or mobile"
                searchPlaceholder="Name, patient ID or guardian mobile…"
                emptyText="No patients found."
              />
            )}
          </Field>

          <Field label="Appointment type" required className="sm:col-span-2">
            <RadioGroup
              value={type}
              onValueChange={(v) => setType(v as AppointmentType)}
              className="sm:grid-cols-2"
            >
              <RadioCard value="THERAPY_SESSION" title="Therapy session" />
              <RadioCard
                value="ASSESSMENT"
                title="Assessment"
                description="An evaluation, e.g. a first visit"
              />
            </RadioGroup>
          </Field>

          <Field label="Therapy" required error={fieldError('therapyTypeId')}>
            <SearchableSelect
              options={typeOptions}
              value={therapyTypeId || undefined}
              onChange={(id) => {
                setTherapyTypeId(id ?? '');
                setDurationChoice(undefined);
                resetTime();
              }}
              placeholder="Choose a therapy"
              searchPlaceholder="Search therapies…"
              emptyText="No active therapies. Add them in Settings."
            />
          </Field>

          <Field
            label="Therapist"
            required
            error={
              fieldError('therapistId') ??
              (therapistId && therapists.data && !therapistOk
                ? 'This therapist doesn’t provide the chosen therapy'
                : undefined)
            }
            helper={therapyTypeId ? 'Active therapists who provide this therapy' : undefined}
          >
            <SearchableSelect
              options={therapistOptions}
              value={therapistId || undefined}
              onChange={(id) => {
                setTherapistId(id ?? '');
                resetTime();
              }}
              disabled={!therapyTypeId}
              loading={therapists.isFetching && !therapists.data}
              placeholder={therapyTypeId ? 'Choose a therapist' : 'Choose a therapy first'}
              searchPlaceholder="Search therapists…"
              emptyText="No active therapist provides this therapy."
            />
          </Field>

          <PackagePicker
            className="sm:col-span-2"
            params={
              patient && therapyTypeId && date
                ? { patientId: patient.id, therapyTypeId, type, date }
                : null
            }
            value={packageEnrollmentId}
            onChange={setPackageEnrollmentId}
            error={fieldError('packageEnrollmentId')}
          />
        </Section>

        <Section title="Scheduling">
          <Field label="Booking" className="sm:col-span-2">
            <Tabs
              value={mode}
              onValueChange={(v) => {
                setMode(v as Mode);
                setManualTime(false);
                resetTime();
              }}
            >
              <SegmentedList aria-label="Booking mode" className="w-full sm:w-auto">
                <SegmentedTrigger value="single" className="gap-1.5 [&_svg]:size-3.5">
                  <CalendarCheck2 aria-hidden /> Single appointment
                </SegmentedTrigger>
                <SegmentedTrigger value="recurring" className="gap-1.5 [&_svg]:size-3.5">
                  <Repeat aria-hidden /> Recurring
                </SegmentedTrigger>
              </SegmentedList>
            </Tabs>
          </Field>

          <Field label="Length" required error={fieldError('durationMinutes')}>
            <Select
              value={durationChoice === 'custom' ? 'custom' : duration ? String(duration) : ''}
              onValueChange={(v) => {
                setDurationChoice(v === 'custom' ? 'custom' : Number(v));
                resetTime();
              }}
              disabled={!therapyType}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={therapyType ? 'Choose a length' : 'Choose a therapy first'}
                />
              </SelectTrigger>
              <SelectContent>
                {durations.map((o) => (
                  <SelectItem key={o.id} value={String(o.durationMinutes)}>
                    {formatMinutes(o.durationMinutes)}
                    {o.label && ` · ${o.label}`}
                  </SelectItem>
                ))}
                {duration &&
                  durationChoice !== 'custom' &&
                  !durations.some((o) => o.durationMinutes === duration) && (
                    <SelectItem value={String(duration)}>
                      {formatMinutes(duration)} · previous session
                    </SelectItem>
                  )}
                {scheduling.data?.allowCustomDuration && (
                  <SelectItem value="custom">Custom length…</SelectItem>
                )}
              </SelectContent>
            </Select>
          </Field>
          {durationChoice === 'custom' ? (
            <Field label="Custom length (minutes)" required helper="In steps of 5 minutes">
              <Input
                type="number"
                inputMode="numeric"
                min={LIMITS.durationMinutes.min}
                max={LIMITS.durationMinutes.max}
                step={5}
                value={customMinutes}
                onChange={(e) => {
                  setCustomMinutes(e.target.value);
                  resetTime();
                }}
                className="tabular"
              />
            </Field>
          ) : (
            <div className="hidden sm:block" />
          )}

          <Field
            label={mode === 'single' ? 'Date' : 'Starts on'}
            required
            error={fieldError('date') ?? recurrenceError('startDate')}
          >
            <DatePicker
              value={date}
              onChange={(d) => {
                setDate(d);
                resetTime();
              }}
              disabledDays={disabledDays}
            />
          </Field>

          {mode === 'recurring' ? (
            <Field label="Time" required error={fieldError('startTime')}>
              <TimePicker
                value={startTime}
                onChange={setStartTime}
                step={scheduling.data?.slotIntervalMinutes ?? 15}
                min="06:00"
                max="22:00"
              />
            </Field>
          ) : (
            <div className="hidden sm:block" />
          )}

          {mode === 'single' && (
            <Field
              label="Available time"
              required
              className="sm:col-span-2"
              error={fieldError('startTime')}
              labelAction={
                scheduling.data?.allowDoubleBooking && (
                  <Button
                    variant="link"
                    size="sm"
                    onClick={() => {
                      setManualTime((m) => !m);
                      resetTime();
                    }}
                  >
                    {manualTime ? 'Show free times' : 'Enter a time'}
                  </Button>
                )
              }
            >
              {manualTime ? (
                <TimePicker
                  value={startTime}
                  onChange={setStartTime}
                  step={scheduling.data?.slotIntervalMinutes ?? 15}
                  min="06:00"
                  max="22:00"
                  className="sm:w-48"
                />
              ) : (
                <div>
                  <SlotPicker params={slotParams} value={startTime} onChange={setStartTime} />
                </div>
              )}
            </Field>
          )}

          {mode === 'recurring' && (
            <>
              <Field label="Repeat" required>
                <Select
                  value={recurrence.frequency}
                  onValueChange={(v) => setRule({ frequency: v as SeriesFrequency })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DAILY">Daily</SelectItem>
                    <SelectItem value="WEEKLY">Weekly</SelectItem>
                    <SelectItem value="MONTHLY">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Every" required error={recurrenceError('interval')}>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={12}
                    value={recurrence.interval}
                    onChange={(e) =>
                      setRule({ interval: Math.max(1, Number(e.target.value) || 1) })
                    }
                    className="w-20 tabular"
                  />
                  <span className="text-sm text-muted-foreground">
                    {UNITS[recurrence.frequency]}
                    {recurrence.interval === 1 ? '' : 's'}
                  </span>
                </div>
              </Field>
              {recurrence.frequency === 'WEEKLY' && (
                <Field
                  label="On"
                  required
                  className="sm:col-span-2"
                  error={recurrenceError('daysOfWeek')}
                >
                  <div role="group" className="flex flex-wrap gap-2">
                    {order.map((d) => {
                      const on = recurrence.daysOfWeek.includes(d);
                      return (
                        <button
                          key={d}
                          type="button"
                          aria-pressed={on}
                          onClick={() =>
                            setRule({
                              daysOfWeek: on
                                ? recurrence.daysOfWeek.filter((x) => x !== d)
                                : [...recurrence.daysOfWeek, d],
                            })
                          }
                          className={cn(
                            'h-9 min-w-12 rounded-lg border px-3 text-[13px] font-medium transition-colors focus-ring',
                            on
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border-strong bg-surface hover:bg-accent',
                          )}
                        >
                          {WEEKDAYS[d].slice(0, 3)}
                        </button>
                      );
                    })}
                  </div>
                </Field>
              )}
              {recurrence.frequency === 'MONTHLY' && (
                <p className="text-[13px] text-muted-foreground sm:col-span-2">
                  On the same date each month. In months without that date (the 29th–31st), the
                  session falls on the month’s last day; the preview marks these.
                </p>
              )}
              <Field
                label="Ends"
                required
                className="sm:col-span-2"
                error={recurrenceError('until') ?? recurrenceError('count')}
              >
                <RadioGroup
                  value={recurrence.endType}
                  onValueChange={(v) => setRule({ endType: v as Recurrence['endType'] })}
                  className="sm:grid-cols-2"
                >
                  <div className="grid gap-2 rounded-lg border border-border p-3">
                    <RadioCard
                      value="COUNT"
                      title="After a number of sessions"
                      className="border-0 p-0 hover:bg-transparent has-[[data-state=checked]]:bg-transparent"
                    />
                    <Select
                      value={String(recurrence.count)}
                      onValueChange={(v) => setRule({ count: Number(v), endType: 'COUNT' })}
                    >
                      <SelectTrigger size="sm" aria-label="Number of sessions">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[...new Set([...SESSION_COUNTS, recurrence.count])]
                          .sort((x, y) => x - y)
                          .map((n) => (
                            <SelectItem key={n} value={String(n)}>
                              {n} sessions
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2 rounded-lg border border-border p-3">
                    <RadioCard
                      value="UNTIL"
                      title="On a date"
                      className="border-0 p-0 hover:bg-transparent has-[[data-state=checked]]:bg-transparent"
                    />
                    <DatePicker
                      value={recurrence.until}
                      onChange={(d) => setRule({ until: d, endType: 'UNTIL' })}
                      disabledDays={{ before: parseISO(date ?? today) }}
                      placeholder="Last date"
                      className="h-8 text-[13px]"
                    />
                  </div>
                </RadioGroup>
              </Field>
            </>
          )}

          <Field
            label="Internal note"
            optional
            className="sm:col-span-2"
            helper="Visible to staff only."
          >
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={2000}
            />
          </Field>
        </Section>

        {mode === 'recurring' && (
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <div className="space-y-1">
                <CardTitle>Dates</CardTitle>
                <p className="text-[13px] text-muted-foreground">
                  Every date is checked against schedules, closures, time off and other bookings.
                </p>
              </div>
              <Button
                variant={current ? 'secondary' : 'primary'}
                disabled={!seriesInput}
                onClick={() => setChecked(seriesInput)}
                loading={preview.isFetching}
              >
                {current ? 'Check again' : 'Preview dates'}
              </Button>
            </CardHeader>
            <CardContent className="grid gap-3">
              {!seriesInput && (
                <p className="text-[13px] text-muted-foreground">
                  Choose the patient, therapy, therapist, length, start date and time first.
                </p>
              )}
              {seriesInput && checked && !current && (
                <p className="text-[13px] text-warning-foreground">
                  The schedule changed since the preview. Preview the dates again.
                </p>
              )}
              {current && previewError && (
                <p className="text-[13px] text-danger-foreground">{previewError.message}</p>
              )}
              {current && summary && (
                <>
                  <p className="text-sm" aria-live="polite">
                    <span className="font-medium">{summary.total} sessions requested:</span>{' '}
                    {summary.available} available
                    {summary.conflicts > 0 && (
                      <span className="text-warning-foreground">
                        , {summary.conflicts} with conflicts
                      </span>
                    )}
                  </p>
                  <ul className="grid max-h-80 gap-1 overflow-y-auto rounded-lg border border-border p-1">
                    {occurrences.map((o) => (
                      <li
                        key={o.date}
                        className={cn(
                          'flex items-start gap-3 rounded-md px-2 py-1.5 text-[13px]',
                          !o.available && 'bg-warning-subtle/60',
                        )}
                      >
                        {o.available ? (
                          <CheckCircle2
                            className="mt-0.5 size-4 shrink-0 text-success"
                            aria-label="Available"
                          />
                        ) : (
                          <AlertTriangle
                            className="mt-0.5 size-4 shrink-0 text-warning"
                            aria-label="Conflict"
                          />
                        )}
                        <span className="w-32 shrink-0 tabular">
                          {fmt.shortDate(o.date)}
                          <span className="block text-xs text-muted-foreground">
                            {fmt.range(o)}
                          </span>
                        </span>
                        <span className="min-w-0 flex-1">
                          {o.available
                            ? o.adjusted
                              ? 'Available · moved to the month’s last day'
                              : 'Available'
                            : o.conflicts.map((c) => c.message).join('; ')}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {summary.conflicts > 0 ? (
                    <div className="grid gap-2 rounded-lg border border-warning/30 bg-warning-subtle p-3 text-[13px] text-warning-foreground">
                      <p>
                        Nothing is booked yet. Change the schedule above, or book only the available
                        dates and skip the {summary.conflicts} with conflicts.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          disabled={!summary.available}
                          loading={createSeries.isPending}
                          onClick={() => bookSeries(true)}
                        >
                          Book {summary.available}, skip {summary.conflicts}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <Card className="lg:sticky lg:top-20">
        <CardHeader>
          <CardTitle>Summary</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Summary
            rows={[
              ['Patient', patient && `${patient.fullName} (${patient.code})`],
              ['Service', therapyType && `${APPOINTMENT_TYPES[type]} · ${therapyType.name}`],
              ['Therapist', therapist?.fullName],
              [
                'When',
                mode === 'single'
                  ? date && (
                      <span className="tabular">
                        {fmt.longDate(date)}
                        {startTime && (
                          <span className="block">
                            {fmt.clock(startTime)}
                            {duration && ` · ${formatMinutes(duration)}`}
                          </span>
                        )}
                      </span>
                    )
                  : seriesInput && (
                      <span>
                        {describeRule(
                          {
                            ...seriesInput.recurrence,
                            daysOfWeek: seriesInput.recurrence.daysOfWeek ?? [],
                            until: seriesInput.recurrence.until ?? null,
                            count: seriesInput.recurrence.count ?? null,
                          },
                          fmt.weekStartsOn,
                          fmt.date,
                        )}
                        <span className="block text-muted-foreground">
                          from {fmt.date(date!)} at {fmt.clock(startTime!)} ·{' '}
                          {formatMinutes(duration!)}
                        </span>
                      </span>
                    ),
              ],
            ]}
          />
          {mode === 'single' && (
            <ConflictNotice
              error={create.error}
              onOverride={() => bookSingle(true)}
              overriding={create.isPending}
            />
          )}
          {mode === 'single' ? (
            <Button
              size="lg"
              disabled={!base || !startTime}
              loading={create.isPending}
              onClick={() => bookSingle()}
            >
              <CalendarCheck2 /> Book appointment
            </Button>
          ) : (
            <Button
              size="lg"
              disabled={!current || !summary || summary.conflicts > 0 || !summary.available}
              loading={createSeries.isPending}
              onClick={() => bookSeries(false)}
            >
              <Repeat />{' '}
              {current && summary && !summary.conflicts
                ? `Book ${summary.total} sessions`
                : 'Book sessions'}
            </Button>
          )}
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Clock className="mt-px size-3.5 shrink-0" aria-hidden />
            Times are in {activeCenter.timezone}. Availability is checked again when you book.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export function NewAppointmentScreen() {
  return (
    <RequirePermission permission="appointments.create">
      <div className="animate-in">
        <PageHeader
          back={{ href: appointmentLinks.list, label: 'Appointments' }}
          title="Book appointment"
          description="Assessments and therapy sessions, once or on a repeating schedule."
          actions={
            <Button variant="ghost" asChild>
              <Link href={appointmentLinks.calendar}>Open calendar</Link>
            </Button>
          }
        />
        <BookingForm />
      </div>
    </RequirePermission>
  );
}
