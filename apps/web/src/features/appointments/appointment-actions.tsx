'use client';

import * as React from 'react';
import Link from 'next/link';
import { isToday, parseISO } from 'date-fns';
import {
  Ban,
  CalendarClock,
  CheckCircle2,
  Ellipsis,
  FilePen,
  LogIn,
  UserRound,
  UserX,
} from 'lucide-react';

import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { Field } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui/sonner';
import { useUpdateAppointmentStatus, type AppointmentWithRefs } from '@/lib/api/appointments';
import { useSession } from '@/lib/session';
import type { AppointmentStatus } from '@/lib/types';
import { RescheduleDialog } from './reschedule-dialog';

const cancelReasons = [
  'Child unwell',
  'Guardian requested',
  'Therapist unavailable',
  'Family travelling',
  'Other',
];

const statusToast: Partial<Record<AppointmentStatus, string>> = {
  checked_in: 'Checked in',
  completed: 'Marked as completed',
  no_show: 'Marked as no-show',
  cancelled: 'Appointment cancelled',
};

/**
 * The one place appointment status changes happen, so the rules (who can do what, when)
 * stay consistent between the dashboard, calendar and patient profile.
 */
export function useAppointmentActions(appointment: AppointmentWithRefs) {
  const { can } = useSession();
  const update = useUpdateAppointmentStatus();
  const start = parseISO(appointment.start);
  const s = appointment.status;
  const manage = can('appointments.manage');
  const write = can('clinical.write');

  const setStatus = async (status: AppointmentStatus, reason?: string) => {
    try {
      await update.mutateAsync({ id: appointment.id, status, reason });
      toast.success(statusToast[status] ?? 'Updated', {
        description: appointment.patient.fullName,
      });
    } catch (e) {
      toast.error('Couldn’t update the appointment', { description: (e as Error).message });
    }
  };

  return {
    setStatus,
    pending: update.isPending,
    canCheckIn: manage && s === 'scheduled' && isToday(start),
    canComplete:
      (manage || write) && (s === 'scheduled' || s === 'checked_in') && start <= new Date(),
    canNoShow: manage && s === 'scheduled' && start <= new Date(),
    canReschedule: manage && s === 'scheduled',
    canCancel: manage && (s === 'scheduled' || s === 'checked_in'),
    canWriteNote:
      write && (s === 'checked_in' || s === 'completed') && appointment.noteStatus !== 'submitted',
    canViewNote: appointment.noteStatus === 'submitted' && can('clinical.view'),
  };
}

export function AppointmentActions({
  appointment,
  showPrimary = true,
}: {
  appointment: AppointmentWithRefs;
  /** Show the most likely next action as a visible button */
  showPrimary?: boolean;
}) {
  const a = useAppointmentActions(appointment);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [rescheduleOpen, setRescheduleOpen] = React.useState(false);
  const [reason, setReason] = React.useState(cancelReasons[0]);
  const noteHref = `/clinical/notes/${appointment.id}`;

  const primary = !showPrimary ? null : a.canWriteNote ? (
    <Button size="sm" variant="secondary" asChild>
      <Link href={noteHref}>
        <FilePen /> {appointment.noteStatus === 'draft' ? 'Continue note' : 'Write note'}
      </Link>
    </Button>
  ) : a.canCheckIn ? (
    <Button
      size="sm"
      variant="secondary"
      onClick={() => a.setStatus('checked_in')}
      loading={a.pending}
    >
      <LogIn /> Check in
    </Button>
  ) : null;

  const hasMenu = a.canComplete || a.canNoShow || a.canReschedule || a.canCancel || a.canViewNote;

  return (
    <div className="flex items-center justify-end gap-1.5">
      {primary}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions for ${appointment.patient.fullName}`}
          >
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-52">
          <DropdownMenuItem asChild>
            <Link href={`/patients/${appointment.patientId}`}>
              <UserRound /> View patient
            </Link>
          </DropdownMenuItem>
          {hasMenu && <DropdownMenuSeparator />}
          {a.canCheckIn && !primary && (
            <DropdownMenuItem onSelect={() => a.setStatus('checked_in')}>
              <LogIn /> Check in
            </DropdownMenuItem>
          )}
          {a.canComplete && (
            <DropdownMenuItem onSelect={() => a.setStatus('completed')}>
              <CheckCircle2 /> Mark as completed
            </DropdownMenuItem>
          )}
          {a.canNoShow && (
            <DropdownMenuItem onSelect={() => a.setStatus('no_show')}>
              <UserX /> Mark as no-show
            </DropdownMenuItem>
          )}
          {a.canWriteNote && !primary && (
            <DropdownMenuItem asChild>
              <Link href={noteHref}>
                <FilePen /> Write session note
              </Link>
            </DropdownMenuItem>
          )}
          {a.canViewNote && (
            <DropdownMenuItem asChild>
              <Link href={noteHref}>
                <FilePen /> View session note
              </Link>
            </DropdownMenuItem>
          )}
          {a.canReschedule && (
            <DropdownMenuItem onSelect={() => setRescheduleOpen(true)}>
              <CalendarClock /> Reschedule
            </DropdownMenuItem>
          )}
          {a.canCancel && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem tone="danger" onSelect={() => setCancelOpen(true)}>
                <Ban /> Cancel appointment
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel this appointment?"
        description={`${appointment.patient.fullName}’s session will be cancelled. If it was booked from a package, the session goes back to their balance.`}
        confirmLabel="Cancel appointment"
        cancelLabel="Keep it"
        tone="danger"
        loading={a.pending}
        onConfirm={async () => {
          await a.setStatus('cancelled', reason);
          setCancelOpen(false);
        }}
      >
        <Field label="Reason">
          <Select value={reason} onValueChange={setReason}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {cancelReasons.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </ConfirmDialog>
      {a.canReschedule && (
        <RescheduleDialog
          appointment={appointment}
          open={rescheduleOpen}
          onOpenChange={setRescheduleOpen}
        />
      )}
    </div>
  );
}
