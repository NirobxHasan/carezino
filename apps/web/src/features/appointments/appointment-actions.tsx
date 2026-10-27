'use client';

import * as React from 'react';
import Link from 'next/link';
import { Ban, CalendarClock, CheckCircle2, CircleCheck, Ellipsis, Eye, UserX } from 'lucide-react';

import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { RadioCard, RadioGroup } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui/sonner';
import { Textarea } from '@/components/ui/textarea';
import {
  useCancelAppointment,
  useCancelSeries,
  useSetAppointmentStatus,
  type StatusChange,
} from '@/lib/api/appointments';
import { useSchedulingSettings } from '@/lib/api/settings';
import { useSession } from '@/lib/session';
import { formatMinutes } from '@/lib/settings-limits';
import type { AppointmentItem, CancellationReason } from '@/lib/types';
import { CANCELLATION_REASONS, appointmentLinks, useCenterFormat } from './appointment-display';
import { RescheduleDialog } from './reschedule-dialog';

export type AppointmentAction = 'confirm' | 'complete' | 'noShow' | 'cancel' | 'reschedule';

const STATUS_STEPS: Record<
  'confirm' | 'complete' | 'noShow',
  { status: StatusChange; title: string; description: string; label: string; done: string }
> = {
  confirm: {
    status: 'CONFIRMED',
    title: 'Confirm this appointment?',
    description: 'Mark that the patient or guardian has confirmed they’re coming.',
    label: 'Confirm',
    done: 'Appointment confirmed',
  },
  complete: {
    status: 'COMPLETED',
    title: 'Complete this session?',
    description:
      'Records that the session took place and uses a session of the package paying for it, if any. The session note is written separately.',
    label: 'Complete session',
    done: 'Session completed',
  },
  noShow: {
    status: 'NO_SHOW',
    title: 'Mark as no-show?',
    description:
      'Records that the patient didn’t come: they’re marked absent and the time is released. The appointment and its history are kept.',
    label: 'Mark no-show',
    done: 'Marked as no-show',
  },
};

/**
 * Every appointment action with its dialog, in one place so the list, calendar, details
 * and profiles behave the same. What's offered follows `appointment.actions`, which the
 * API works out from the status, the time and the user's permissions.
 */
export function useAppointmentDialogs() {
  const [state, setState] = React.useState<{
    action: AppointmentAction;
    appointment: AppointmentItem;
  } | null>(null);
  const setStatus = useSetAppointmentStatus();
  // Completing needs attendance; when it isn't marked yet, it's asked here.
  const [attendance, setAttendance] = React.useState<'PRESENT' | 'LATE'>('PRESENT');
  const close = () => setState(null);
  const asksAttendance =
    state?.action === 'complete' && state.appointment.attendance.status === 'NOT_MARKED';
  const step =
    state && state.action !== 'cancel' && state.action !== 'reschedule'
      ? STATUS_STEPS[state.action]
      : null;

  const dialogs = (
    <>
      <ConfirmDialog
        open={Boolean(step)}
        onOpenChange={(o) => !o && close()}
        title={step?.title ?? ''}
        description={
          step &&
          state && (
            <>
              <span className="block font-medium text-foreground">
                {state.appointment.patient.fullName}
              </span>
              {step.description}
            </>
          )
        }
        confirmLabel={step?.label}
        loading={setStatus.isPending}
        onConfirm={() => {
          if (!state || !step) return;
          setStatus.mutate(
            {
              id: state.appointment.id,
              status: step.status,
              attendance: asksAttendance ? attendance : undefined,
            },
            {
              onSuccess: () => {
                toast.success(step.done, { description: state.appointment.patient.fullName });
                close();
              },
              onError: (e) => toast.error(e.message),
            },
          );
        }}
      >
        {asksAttendance && (
          <fieldset className="grid gap-2">
            <legend className="mb-1.5 text-sm font-medium">The patient’s attendance</legend>
            <RadioGroup
              value={attendance}
              onValueChange={(v) => setAttendance(v as typeof attendance)}
              className="sm:grid-cols-2"
            >
              <RadioCard value="PRESENT" title="Present" />
              <RadioCard value="LATE" title="Late" description="Arrived late, but attended" />
            </RadioGroup>
          </fieldset>
        )}
      </ConfirmDialog>
      {state?.action === 'cancel' && (
        <CancelDialog appointment={state.appointment} open onOpenChange={(o) => !o && close()} />
      )}
      {state?.action === 'reschedule' && (
        <RescheduleDialog
          appointment={state.appointment}
          open
          onOpenChange={(o) => !o && close()}
        />
      )}
    </>
  );

  return {
    open: React.useCallback(
      (action: AppointmentAction, appointment: AppointmentItem) =>
        setState({ action, appointment }),
      [],
    ),
    dialogs,
  };
}

/** The actions an appointment offers now, in the order screens show them. */
export function availableActions(a: AppointmentItem) {
  const list: { action: AppointmentAction; label: string; icon: typeof Ban; danger?: boolean }[] =
    [];
  if (a.actions.confirm) list.push({ action: 'confirm', label: 'Confirm', icon: CircleCheck });
  if (a.actions.complete)
    list.push({ action: 'complete', label: 'Complete session', icon: CheckCircle2 });
  if (a.actions.noShow) list.push({ action: 'noShow', label: 'Mark no-show', icon: UserX });
  if (a.actions.reschedule)
    list.push({ action: 'reschedule', label: 'Reschedule', icon: CalendarClock });
  if (a.actions.cancel) list.push({ action: 'cancel', label: 'Cancel', icon: Ban, danger: true });
  return list;
}

export function AppointmentActionsMenu({
  appointment,
  onAction,
  onView,
}: {
  appointment: AppointmentItem;
  onAction: (action: AppointmentAction, appointment: AppointmentItem) => void;
  /** Open details in place (e.g. a sheet); defaults to the details page */
  onView?: () => void;
}) {
  const actions = availableActions(appointment);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Actions for ${appointment.patient.fullName}’s appointment`}
        >
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {onView ? (
          <DropdownMenuItem onSelect={onView}>
            <Eye /> View details
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem asChild>
            <Link href={appointmentLinks.detail(appointment.id)}>
              <Eye /> View details
            </Link>
          </DropdownMenuItem>
        )}
        {actions.length > 0 && <DropdownMenuSeparator />}
        {actions.map(({ action, label, icon: Icon, danger }) => (
          <DropdownMenuItem
            key={action}
            tone={danger ? 'danger' : 'default'}
            onSelect={() => onAction(action, appointment)}
          >
            <Icon /> {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Cancels with a reason; nothing is deleted. Inside the center's cutoff it says the
 * cancellation counts as late. For a series, staff can cancel this and every later open
 * appointment instead (completed ones are never touched).
 */
function CancelDialog({
  appointment: a,
  open,
  onOpenChange,
}: {
  appointment: AppointmentItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { can } = useSession();
  const fmt = useCenterFormat();
  const scheduling = useSchedulingSettings();
  const cancelOne = useCancelAppointment();
  const cancelSeries = useCancelSeries();
  const [reason, setReason] = React.useState<CancellationReason | undefined>();
  const [note, setNote] = React.useState('');
  const [scope, setScope] = React.useState<'one' | 'following'>('one');
  const [touched, setTouched] = React.useState(false);
  const canSeries = Boolean(a.seriesId) && can('appointments.manage_recurring');
  const pending = cancelOne.isPending || cancelSeries.isPending;
  const cutoff = scheduling.data?.cancellationCutoffMinutes ?? 0;

  const submit = () => {
    setTouched(true);
    if (!reason) return;
    const input = { reason, note: note.trim() || undefined };
    const done = (message: string) => {
      toast.success(message, { description: a.patient.fullName });
      onOpenChange(false);
    };
    if (scope === 'following' && a.seriesId) {
      cancelSeries.mutate(
        { id: a.seriesId, input: { ...input, fromAppointmentId: a.id } },
        {
          onSuccess: (r) =>
            done(`${r.cancelled} appointment${r.cancelled === 1 ? '' : 's'} cancelled`),
          onError: (e) => toast.error(e.message),
        },
      );
    } else {
      cancelOne.mutate(
        { id: a.id, input },
        {
          onSuccess: () => done('Appointment cancelled'),
          onError: (e) => toast.error(e.message),
        },
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel appointment?</DialogTitle>
          <DialogDescription>
            {a.patient.fullName} · {fmt.shortDate(a.date)}, {fmt.range(a)} with{' '}
            {a.therapist.fullName}. It stays in the history as cancelled and its time is freed.
          </DialogDescription>
        </DialogHeader>

        {a.actions.lateCancellation && (
          <p className="rounded-lg border border-warning/30 bg-warning-subtle px-3 py-2 text-[13px] text-warning-foreground">
            This is a late cancellation: it starts within the {formatMinutes(cutoff)} cancellation
            cutoff, and will be recorded as late.
          </p>
        )}

        {canSeries && (
          <RadioGroup value={scope} onValueChange={(v) => setScope(v as typeof scope)}>
            <RadioCard value="one" title="This appointment only" />
            <RadioCard
              value="following"
              title="This and following appointments"
              description="Every later scheduled or confirmed appointment of this series. Completed ones are kept."
            />
          </RadioGroup>
        )}

        <Field label="Reason" required error={touched && !reason ? 'Choose a reason' : undefined}>
          <Select value={reason} onValueChange={(v) => setReason(v as CancellationReason)}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a reason" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(CANCELLATION_REASONS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Note" optional>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            rows={3}
          />
        </Field>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            Keep appointment
          </Button>
          <Button variant="danger" onClick={submit} loading={pending}>
            {scope === 'following' ? 'Cancel appointments' : 'Cancel appointment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
