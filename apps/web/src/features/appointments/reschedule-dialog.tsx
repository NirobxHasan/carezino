'use client';

import * as React from 'react';
import { format, parseISO, startOfToday } from 'date-fns';

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
import { toast } from '@/components/ui/sonner';
import {
  useAvailableSlots,
  useRescheduleAppointment,
  type AppointmentWithRefs,
} from '@/lib/api/appointments';
import { formatShortDate, formatTime } from '@/lib/format';
import { SlotGrid } from './slot-grid';

export function RescheduleDialog({
  appointment,
  open,
  onOpenChange,
}: {
  appointment: AppointmentWithRefs;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [date, setDate] = React.useState(() => format(parseISO(appointment.start), 'yyyy-MM-dd'));
  const [start, setStart] = React.useState<string>();
  const duration =
    (parseISO(appointment.end).getTime() - parseISO(appointment.start).getTime()) / 60000;
  const slots = useAvailableSlots(
    open
      ? {
          therapistId: appointment.therapistId,
          patientId: appointment.patientId,
          date,
          durationMinutes: duration,
          ignoreAppointmentId: appointment.id,
        }
      : null,
  );
  const reschedule = useRescheduleAppointment();

  const submit = async () => {
    if (!start) return;
    try {
      await reschedule.mutateAsync({ id: appointment.id, start });
      toast.success('Appointment rescheduled', {
        description: `${appointment.patient.fullName} · ${formatShortDate(start)}, ${formatTime(start)}`,
      });
      onOpenChange(false);
    } catch (e) {
      toast.error('Couldn’t reschedule', { description: (e as Error).message });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setStart(undefined);
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Reschedule appointment</DialogTitle>
          <DialogDescription>
            {appointment.patient.fullName} with {appointment.therapist.name}, currently{' '}
            {formatShortDate(appointment.start)} at {formatTime(appointment.start)}.
          </DialogDescription>
        </DialogHeader>
        <Field label="New date">
          <DatePicker
            value={date}
            onChange={(d) => {
              if (d) setDate(d);
              setStart(undefined);
            }}
            disabledDays={{ before: startOfToday() }}
          />
        </Field>
        <SlotGrid
          slots={slots.data}
          loading={slots.isFetching}
          value={start}
          onChange={setStart}
          emptyText={`${appointment.therapist.name} doesn’t work on this day.`}
        />
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Keep current time
          </Button>
          <Button onClick={submit} disabled={!start} loading={reschedule.isPending}>
            Reschedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
