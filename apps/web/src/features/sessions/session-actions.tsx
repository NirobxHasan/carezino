'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  CalendarSearch,
  CheckCircle2,
  Clock,
  Ellipsis,
  Eye,
  FilePenLine,
  FilePlus2,
  History,
  LogIn,
  PlayCircle,
  ShieldAlert,
  UserCheck,
  UserX,
  type LucideIcon,
} from 'lucide-react';

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
import { Input } from '@/components/ui/input';
import { RadioCard, RadioGroup } from '@/components/ui/radio-group';
import { toast } from '@/components/ui/sonner';
import { Textarea } from '@/components/ui/textarea';
import { isApiError } from '@/lib/api/client';
import {
  useCheckIn,
  useCompleteSession,
  useCorrectSession,
  useRecordAttendance,
  useStartSession,
} from '@/lib/api/sessions';
import type { AttendanceStatus, SessionCorrectionOutcome, SessionItem } from '@/lib/types';
import { appointmentLinks, useCenterFormat } from '../appointments/appointment-display';
import { ATTENDANCE_STATUSES, CORRECTION_OUTCOMES, sessionLinks } from './session-display';

export type SessionAction =
  | 'checkIn'
  | 'markPresent'
  | 'markLate'
  | 'markAbsent'
  | 'start'
  | 'complete'
  | 'editAttendance'
  | 'correctAttendance'
  | 'correct';

const REASON_MIN = 5;

/** "Ayaan Rahman · Mon, 26 Oct, 10:00 – 10:45" */
function useWho() {
  const fmt = useCenterFormat();
  return (s: SessionItem) => `${s.patient.fullName} · ${fmt.shortDate(s.date)}, ${fmt.range(s)}`;
}

/** Reports a failed write, unless the dialog shows field errors itself. */
const onError = (e: Error) => !(isApiError(e, 400) && e.errors) && toast.error(e.message);

/**
 * Attendance and session actions with their dialogs, in one place so the day list,
 * history, session page and "My sessions" behave the same. Quick ones (check in, mark
 * present or late, start) run at once; the rest ask first. What's offered follows
 * `sessionActions`, which the API works out from the session and the user's permissions.
 */
export function useSessionDialogs() {
  const who = useWho();
  const [state, setState] = React.useState<{
    action: SessionAction;
    session: SessionItem;
  } | null>(null);
  const checkIn = useCheckIn();
  const record = useRecordAttendance();
  const start = useStartSession();
  const close = () => setState(null);
  // Dialogs are transient: close them when the page is hidden by a navigation.
  React.useLayoutEffect(() => () => setState(null), []);

  const run = React.useCallback(
    (action: SessionAction, s: SessionItem) => {
      const done = (message: string) => () =>
        toast.success(message, { description: s.patient.fullName });
      switch (action) {
        case 'checkIn':
          return checkIn.mutate({ id: s.id }, { onSuccess: done('Checked in'), onError });
        case 'markPresent':
        case 'markLate': {
          const status: AttendanceStatus = action === 'markLate' ? 'LATE' : 'PRESENT';
          return record.mutate(
            { id: s.id, input: { status } },
            {
              onSuccess: done(`Marked ${ATTENDANCE_STATUSES[status].label.toLowerCase()}`),
              onError,
            },
          );
        }
        case 'start':
          return start.mutate(s.id, { onSuccess: done('Session started'), onError });
        default:
          setState({ action, session: s });
      }
    },
    [checkIn, record, start],
  );

  /** The session a quick action is running for, to show progress on its row. */
  const busyId = checkIn.isPending
    ? checkIn.variables?.id
    : record.isPending
      ? record.variables?.id
      : start.isPending
        ? start.variables
        : undefined;

  const s = state?.session;
  const dialogs = s && (
    <>
      {state.action === 'markAbsent' && <AbsentDialog session={s} who={who(s)} onClose={close} />}
      {state.action === 'complete' && <CompleteDialog session={s} who={who(s)} onClose={close} />}
      {(state.action === 'editAttendance' || state.action === 'correctAttendance') && (
        <AttendanceDialog
          session={s}
          who={who(s)}
          correction={state.action === 'correctAttendance'}
          onClose={close}
        />
      )}
      {state.action === 'correct' && <CorrectDialog session={s} who={who(s)} onClose={close} />}
    </>
  );

  return { open: run, dialogs, busyId };
}

/** Absent makes the appointment a no-show; the package settles it by its own policy. */
function AbsentDialog({
  session: s,
  who,
  onClose,
}: {
  session: SessionItem;
  who: string;
  onClose: () => void;
}) {
  const record = useRecordAttendance();
  const [note, setNote] = React.useState('');
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Mark the patient absent?"
      description={
        <>
          <span className="block font-medium text-foreground">{who}</span>
          The appointment becomes a no-show. A package session is only used if the package charges
          no-shows; otherwise it’s given back.
        </>
      }
      confirmLabel="Mark absent"
      tone="danger"
      loading={record.isPending}
      onConfirm={() =>
        record.mutate(
          { id: s.id, input: { status: 'ABSENT', ...(note.trim() && { note: note.trim() }) } },
          {
            onSuccess: () => {
              toast.success('Marked absent', { description: s.patient.fullName });
              onClose();
            },
            onError,
          },
        )
      }
    >
      <Field label="Note" optional helper="e.g. called to say they’re unwell">
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={1000}
        />
      </Field>
    </ConfirmDialog>
  );
}

/**
 * Completing needs the patient present or late; when attendance isn't marked yet it's
 * asked here. The note can follow later: until it's signed the session shows as pending.
 */
function CompleteDialog({
  session: s,
  who,
  onClose,
}: {
  session: SessionItem;
  who: string;
  onClose: () => void;
}) {
  const complete = useCompleteSession();
  const unmarked = s.attendance.status === 'NOT_MARKED';
  const [attendance, setAttendance] = React.useState<'PRESENT' | 'LATE'>('PRESENT');
  const therapy = s.type === 'THERAPY_SESSION';
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Complete this session?"
      description={
        <>
          <span className="block font-medium text-foreground">{who}</span>
          {s.packageEnrollmentId ? 'The session held by the patient’s package is used now. ' : ''}
          {therapy &&
            (s.noteStatus === 'COMPLETED' || s.noteStatus === 'AMENDED'
              ? 'Its note is already signed.'
              : 'The note can be written afterwards; until it’s signed the session shows “Note pending”.')}
        </>
      }
      confirmLabel="Complete session"
      loading={complete.isPending}
      onConfirm={() =>
        complete.mutate(
          { id: s.id, attendance: unmarked ? attendance : undefined },
          {
            onSuccess: () => {
              toast.success('Session completed', { description: s.patient.fullName });
              onClose();
            },
            onError,
          },
        )
      }
    >
      {unmarked && (
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
  );
}

/**
 * Attendance with its optional times and note. As a correction (after the appointment
 * closed) it needs a reason: a completed session can only switch between present and
 * late, and a no-show corrected to present or late is reopened.
 */
function AttendanceDialog({
  session: s,
  who,
  correction,
  onClose,
}: {
  session: SessionItem & { attendance: { note?: string | null; revision?: number | null } };
  who: string;
  correction: boolean;
  onClose: () => void;
}) {
  const record = useRecordAttendance();
  const a = s.attendance;
  const [status, setStatus] = React.useState<AttendanceStatus>(
    a.status === 'NOT_MARKED' ? 'PRESENT' : a.status,
  );
  const [checkIn, setCheckIn] = React.useState(a.checkInTime ?? '');
  const [startTime, setStartTime] = React.useState(a.actualStartTime ?? '');
  const [endTime, setEndTime] = React.useState(a.actualEndTime ?? '');
  const [note, setNote] = React.useState(a.note ?? '');
  const [reason, setReason] = React.useState('');
  const [touched, setTouched] = React.useState(false);
  const errors = isApiError(record.error) ? (record.error.errors ?? {}) : {};
  const attended = status === 'PRESENT' || status === 'LATE';
  const choices: AttendanceStatus[] =
    s.status === 'COMPLETED'
      ? ['PRESENT', 'LATE']
      : s.status === 'NO_SHOW'
        ? ['ABSENT', 'PRESENT', 'LATE']
        : ['PRESENT', 'LATE', 'NOT_MARKED'];
  const reasonError =
    correction && touched && reason.trim().length < REASON_MIN
      ? 'Say why the attendance is being corrected'
      : errors.reason;

  const submit = () => {
    setTouched(true);
    if (correction && reason.trim().length < REASON_MIN) return;
    record.mutate(
      {
        id: s.id,
        input: {
          status,
          ...(attended
            ? {
                checkInTime: checkIn || null,
                actualStartTime: startTime || null,
                actualEndTime: endTime || null,
              }
            : {}),
          note: note.trim(),
          ...(correction && { reason: reason.trim() }),
          ...(a.revision ? { revision: a.revision } : {}),
        },
      },
      {
        onSuccess: () => {
          toast.success(correction ? 'Attendance corrected' : 'Attendance saved', {
            description: s.patient.fullName,
          });
          onClose();
        },
        onError,
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{correction ? 'Correct attendance' : 'Attendance'}</DialogTitle>
          <DialogDescription>{who}</DialogDescription>
        </DialogHeader>
        {correction && s.status === 'NO_SHOW' && (
          <p className="rounded-lg border border-warning/30 bg-warning-subtle px-3 py-2 text-[13px] text-warning-foreground">
            Marking a no-show present or late reopens the appointment, so the session can be
            completed. A no-show the package already charged can’t be reopened.
          </p>
        )}
        <RadioGroup
          value={status}
          onValueChange={(v) => setStatus(v as AttendanceStatus)}
          className="sm:grid-cols-3"
          aria-label="Attendance"
        >
          {choices.map((c) => (
            <RadioCard key={c} value={c} title={ATTENDANCE_STATUSES[c].label} />
          ))}
        </RadioGroup>
        {attended && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Arrived" optional error={errors.checkInTime}>
              <Input type="time" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
            </Field>
            <Field label="Session started" optional error={errors.actualStartTime}>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </Field>
            <Field label="Session ended" optional error={errors.actualEndTime}>
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </Field>
          </div>
        )}
        <Field label="Attendance note" optional error={errors.note}>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={1000}
          />
        </Field>
        {correction && (
          <Field label="Reason for the correction" required error={reasonError}>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={1000}
            />
          </Field>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={record.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={record.isPending}>
            {correction ? 'Save correction' : 'Save attendance'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Voids a completed session; its package charge is given back. Final. */
function CorrectDialog({
  session: s,
  who,
  onClose,
}: {
  session: SessionItem;
  who: string;
  onClose: () => void;
}) {
  const correct = useCorrectSession();
  const [outcome, setOutcome] = React.useState<SessionCorrectionOutcome>('NOT_ATTENDED');
  const [reason, setReason] = React.useState('');
  const [touched, setTouched] = React.useState(false);
  const short = reason.trim().length < REASON_MIN;
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Correct a completed session?"
      description={
        <>
          <span className="block font-medium text-foreground">{who}</span>
          The session is voided and stays in the history. A package session used for it is given
          back. This can’t be undone; the appointment can’t be charged again.
        </>
      }
      confirmLabel="Void session"
      tone="danger"
      loading={correct.isPending}
      onConfirm={() => {
        setTouched(true);
        if (short) return;
        correct.mutate(
          { id: s.id, outcome, reason: reason.trim() },
          {
            onSuccess: () => {
              toast.success('Session corrected', { description: s.patient.fullName });
              onClose();
            },
            onError,
          },
        );
      }}
    >
      <RadioGroup
        value={outcome}
        onValueChange={(v) => setOutcome(v as SessionCorrectionOutcome)}
        aria-label="What actually happened"
      >
        {Object.entries(CORRECTION_OUTCOMES).map(([value, o]) => (
          <RadioCard key={value} value={value} title={o.label} description={o.description} />
        ))}
      </RadioGroup>
      <Field
        label="Reason"
        required
        error={touched && short ? 'Say why the session is being corrected' : undefined}
      >
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          maxLength={1000}
        />
      </Field>
    </ConfirmDialog>
  );
}

/** The actions a session offers now, in the order screens show them. */
export function availableSessionActions(s: SessionItem) {
  const a = s.sessionActions;
  const list: { action: SessionAction; label: string; icon: LucideIcon; danger?: boolean }[] = [];
  if (a.checkIn) list.push({ action: 'checkIn', label: 'Check in', icon: LogIn });
  if (a.markPresent) list.push({ action: 'markPresent', label: 'Mark present', icon: UserCheck });
  if (a.markLate) list.push({ action: 'markLate', label: 'Mark late', icon: Clock });
  if (a.start) list.push({ action: 'start', label: 'Start session', icon: PlayCircle });
  if (a.complete) list.push({ action: 'complete', label: 'Complete session', icon: CheckCircle2 });
  if (a.markAbsent)
    list.push({ action: 'markAbsent', label: 'Mark absent', icon: UserX, danger: true });
  if (a.correctAttendance)
    list.push({ action: 'correctAttendance', label: 'Correct attendance', icon: History });
  if (a.correct)
    list.push({ action: 'correct', label: 'Correct session', icon: ShieldAlert, danger: true });
  return list;
}

/** The note link a session offers: write, continue, or view. */
export function noteLink(s: SessionItem) {
  const a = s.sessionActions;
  if (a.writeNote) return { label: 'Write note', icon: FilePlus2 };
  if (a.editNote) return { label: 'Continue draft', icon: FilePenLine };
  if (a.amendNote || a.viewNote) return { label: 'View note', icon: Eye };
  return null;
}

/**
 * One row's actions: the most likely next step as a button (check in, complete or the
 * note), everything else in a menu.
 */
export function SessionRowActions({
  session: s,
  onAction,
  busy,
}: {
  session: SessionItem;
  onAction: (action: SessionAction, session: SessionItem) => void;
  busy?: boolean;
}) {
  const actions = availableSessionActions(s);
  const note = noteLink(s);
  const primary =
    actions.find((a) => a.action === 'checkIn') ??
    (s.attendance.status !== 'NOT_MARKED'
      ? actions.find((a) => a.action === 'complete')
      : undefined);
  return (
    <div className="flex items-center justify-end gap-1">
      {primary ? (
        <Button
          size="sm"
          variant={primary.action === 'checkIn' ? 'primary' : 'secondary'}
          loading={busy}
          onClick={() => onAction(primary.action, s)}
        >
          <primary.icon /> {primary.label}
        </Button>
      ) : (
        note && (
          <Button size="sm" variant="secondary" asChild>
            <Link href={sessionLinks.note(s.id)}>
              <note.icon /> {note.label}
            </Link>
          </Button>
        )
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions for ${s.patient.fullName}’s session`}
          >
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={sessionLinks.detail(s.id)}>
              <Eye /> Open session
            </Link>
          </DropdownMenuItem>
          {note && (
            <DropdownMenuItem asChild>
              <Link href={sessionLinks.note(s.id)}>
                <note.icon /> {note.label}
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <Link href={appointmentLinks.detail(s.id)}>
              <CalendarSearch /> View appointment
            </Link>
          </DropdownMenuItem>
          {actions.length > 0 && <DropdownMenuSeparator />}
          {actions
            .filter((a) => a.action !== primary?.action)
            .map(({ action, label, icon: Icon, danger }) => (
              <DropdownMenuItem
                key={action}
                tone={danger ? 'danger' : 'default'}
                onSelect={() => onAction(action, s)}
              >
                <Icon /> {label}
              </DropdownMenuItem>
            ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
