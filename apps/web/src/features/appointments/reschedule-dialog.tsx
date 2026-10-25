'use client';

import * as React from 'react';
import { parseISO } from 'date-fns';

import { ColorDot } from '@/components/forms/color-picker';
import { DatePicker } from '@/components/forms/date-picker';
import { Field } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui/sonner';
import { useRescheduleAppointment } from '@/lib/api/appointments';
import { isApiError } from '@/lib/api/client';
import { useSchedulingSettings } from '@/lib/api/settings';
import { useTherapistList } from '@/lib/api/therapists';
import { useTherapyTypeList } from '@/lib/api/therapy-types';
import { useSession } from '@/lib/session';
import { formatMinutes } from '@/lib/settings-limits';
import type { AppointmentItem, ClockTime } from '@/lib/types';
import { centerToday, useCenterFormat } from './appointment-display';
import { ConflictNotice, conflictOf } from './conflicts';
import { SlotPicker } from './slot-picker';

/**
 * Moves one appointment to a free time, optionally with another therapist or length (and
 * therapy, for staff who can edit appointments). Its ID, series and history are kept;
 * other appointments of a series are never touched.
 */
export function RescheduleDialog({
  appointment,
  open,
  onOpenChange,
}: {
  appointment: AppointmentItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        {/* Remounted on every open, so it always starts from the appointment as it is. */}
        {open && <RescheduleForm appointment={appointment} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function RescheduleForm({
  appointment: a,
  onDone,
}: {
  appointment: AppointmentItem;
  onDone: () => void;
}) {
  const { can, activeCenter } = useSession();
  const fmt = useCenterFormat();
  const scheduling = useSchedulingSettings();
  const types = useTherapyTypeList({ status: 'all' });
  const reschedule = useRescheduleAppointment();
  const [therapyTypeId, setTherapyTypeId] = React.useState(a.therapyType.id);
  const [therapistId, setTherapistId] = React.useState(a.therapist.id);
  const [duration, setDuration] = React.useState(a.durationMinutes);
  const [date, setDate] = React.useState<string | undefined>(a.date);
  const [startTime, setStartTime] = React.useState<ClockTime | undefined>();
  const [reason, setReason] = React.useState('');
  const therapists = useTherapistList({ status: 'ACTIVE', therapyTypeId, pageSize: 100 });

  const sameType = therapyTypeId === a.therapyType.id;
  const type = types.data?.find((t) => t.id === therapyTypeId);
  const durations = React.useMemo(() => {
    const options = (type?.durationOptions ?? [])
      .filter((o) => o.isActive)
      .map((o) => o.durationMinutes);
    // The appointment may keep a length that's no longer offered.
    if (sameType && !options.includes(a.durationMinutes)) options.push(a.durationMinutes);
    return options.sort((x, y) => x - y);
  }, [type, sameType, a.durationMinutes]);

  const params =
    date && therapistId && durations.includes(duration)
      ? {
          therapistId,
          therapyTypeId,
          date,
          durationMinutes: duration,
          patientId: a.patient.id,
          excludeAppointmentId: a.id,
        }
      : null;

  const fieldError = (field: string) =>
    isApiError(reschedule.error) ? reschedule.error.errors?.[field] : undefined;
  const conflict = conflictOf(reschedule.error);
  // The new time is outside what the appointment's package covers (e.g. after it ends).
  const packageProblem =
    isApiError(reschedule.error, 409) &&
    reschedule.error.code === 'PACKAGE_NOT_APPLICABLE' &&
    reschedule.error.details.removable === true
      ? reschedule.error.message
      : null;

  const submit = (allowOverlap = false, withoutPackage = false) => {
    if (!date || !startTime) return;
    reschedule.mutate(
      {
        id: a.id,
        input: {
          date,
          startTime,
          durationMinutes: duration,
          therapistId,
          ...(!sameType && { therapyTypeId }),
          reason: reason.trim() || undefined,
          allowOverlap,
          ...(withoutPackage && { packageEnrollmentId: null }),
        },
      },
      {
        onSuccess: (updated) => {
          toast.success('Appointment rescheduled', {
            description: `${updated.patient.fullName} · ${fmt.shortDate(updated.date)}, ${fmt.clock(updated.startTime)}`,
          });
          onDone();
        },
        onError: (e) => {
          const handled =
            conflictOf(e) || (isApiError(e) && (e.errors || e.code === 'PACKAGE_NOT_APPLICABLE'));
          if (!handled) toast.error(e.message);
        },
      },
    );
  };

  const allowPast = scheduling.data?.allowPastDateBooking ?? false;
  const today = parseISO(centerToday(activeCenter.timezone));

  return (
    <>
      <DialogHeader>
        <DialogTitle>Reschedule appointment</DialogTitle>
        <DialogDescription>
          {a.patient.fullName} · now {fmt.shortDate(a.date)}, {fmt.range(a)} with{' '}
          {a.therapist.fullName}
          {a.seriesId && '. Only this appointment of the series moves.'}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 sm:grid-cols-2">
        {can('appointments.update') && (
          <Field label="Therapy" error={fieldError('therapyTypeId')}>
            <Select
              value={therapyTypeId}
              onValueChange={(id) => {
                setTherapyTypeId(id);
                const next = types.data?.find((t) => t.id === id);
                setDuration(next?.defaultDurationMinutes ?? duration);
                setStartTime(undefined);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {types.data
                  ?.filter((t) => t.isActive || t.id === a.therapyType.id)
                  .map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      <span className="flex items-center gap-2">
                        <ColorDot color={t.color} />
                        {t.name}
                      </span>
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
        )}
        <Field label="Therapist" error={fieldError('therapistId')}>
          <Select
            value={therapistId}
            onValueChange={(id) => {
              setTherapistId(id);
              setStartTime(undefined);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Choose a therapist" />
            </SelectTrigger>
            <SelectContent>
              {!therapists.data?.items.some((t) => t.id === a.therapist.id) && sameType && (
                <SelectItem value={a.therapist.id} disabled>
                  {a.therapist.fullName} (can’t be booked)
                </SelectItem>
              )}
              {therapists.data?.items.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.fullName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Length" error={fieldError('durationMinutes')}>
          <Select
            value={String(duration)}
            onValueChange={(v) => {
              setDuration(Number(v));
              setStartTime(undefined);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Choose a length" />
            </SelectTrigger>
            <SelectContent>
              {durations.map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {formatMinutes(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Date" error={fieldError('date')}>
          <DatePicker
            value={date}
            onChange={(d) => {
              setDate(d);
              setStartTime(undefined);
            }}
            disabledDays={allowPast ? undefined : { before: today }}
          />
        </Field>
      </div>

      <Field label="New time" error={fieldError('startTime')}>
        <div>
          <SlotPicker params={params} value={startTime} onChange={setStartTime} />
        </div>
      </Field>

      <Field label="Reason" optional>
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          placeholder="e.g. Guardian asked for the afternoon"
        />
      </Field>

      {packageProblem && (
        <div className="grid gap-2 rounded-lg border border-warning/30 bg-warning-subtle p-3 text-[13px] text-warning-foreground">
          <p>{packageProblem}. Keep the current time, or move it without the package.</p>
          <Button
            variant="secondary"
            size="sm"
            className="justify-self-start"
            loading={reschedule.isPending}
            onClick={() => submit(false, true)}
          >
            Reschedule without the package
          </Button>
        </div>
      )}

      {conflict && (
        <ConflictNotice
          error={reschedule.error}
          onOverride={() => submit(true)}
          overriding={reschedule.isPending}
        />
      )}

      <DialogFooter>
        <Button variant="secondary" onClick={onDone} disabled={reschedule.isPending}>
          Keep current time
        </Button>
        <Button
          onClick={() => submit()}
          disabled={!startTime}
          loading={reschedule.isPending && !conflict}
        >
          Reschedule
        </Button>
      </DialogFooter>
    </>
  );
}
