'use client';

import {
  CheckCircle2,
  Circle,
  CircleDashed,
  CircleDot,
  CircleSlash,
  Clock,
  FileCheck2,
  FilePenLine,
  FileQuestion,
  FileWarning,
  History,
  UserCheck,
  UserX,
  type LucideIcon,
} from 'lucide-react';

import { Badge, type BadgeTone } from '@/components/ui/badge';
import type {
  AttendanceStatus,
  NoteState,
  SessionCorrectionOutcome,
  SessionStatus,
} from '@/lib/types';

type StatusDef = { label: string; tone: BadgeTone; icon: LucideIcon };

export const ATTENDANCE_STATUSES: Record<AttendanceStatus, StatusDef> = {
  NOT_MARKED: { label: 'Not marked', tone: 'neutral', icon: Circle },
  PRESENT: { label: 'Present', tone: 'success', icon: UserCheck },
  LATE: { label: 'Late', tone: 'warning', icon: Clock },
  ABSENT: { label: 'Absent', tone: 'danger', icon: UserX },
};

export const SESSION_STATUSES: Record<SessionStatus, StatusDef> = {
  NOT_STARTED: { label: 'Not started', tone: 'neutral', icon: CircleDashed },
  IN_PROGRESS: { label: 'In progress', tone: 'info', icon: CircleDot },
  COMPLETED: { label: 'Completed', tone: 'success', icon: CheckCircle2 },
  VOIDED: { label: 'Voided', tone: 'neutral', icon: CircleSlash },
};

export const NOTE_STATES: Record<NoteState, StatusDef> = {
  NONE: { label: 'No note', tone: 'neutral', icon: FileQuestion },
  DRAFT: { label: 'Draft', tone: 'warning', icon: FilePenLine },
  COMPLETED: { label: 'Signed', tone: 'success', icon: FileCheck2 },
  AMENDED: { label: 'Amended', tone: 'primary', icon: History },
};

export const CORRECTION_OUTCOMES: Record<
  SessionCorrectionOutcome,
  { label: string; description: string }
> = {
  NOT_ATTENDED: {
    label: 'The patient didn’t attend',
    description: 'The appointment becomes a no-show and attendance is marked absent.',
  },
  NOT_DELIVERED: {
    label: 'The session didn’t take place',
    description: 'The appointment is cancelled. Attendance stays as recorded.',
  },
};

export const sessionLinks = {
  today: '/sessions/today',
  list: '/sessions',
  mine: '/my-sessions',
  detail: (id: string) => `/sessions/${id}`,
  note: (id: string) => `/sessions/${id}/note`,
  templates: '/settings/session-note-templates',
  template: (id: string) => `/settings/session-note-templates/${id}`,
};

/** Status with a label and icon: colour is never the only signal. */
function StatusBadge({ def, className }: { def: StatusDef; className?: string }) {
  const Icon = def.icon;
  return (
    <Badge tone={def.tone} className={className}>
      <Icon aria-hidden />
      {def.label}
    </Badge>
  );
}

export function AttendanceBadge({ status }: { status: AttendanceStatus }) {
  return <StatusBadge def={ATTENDANCE_STATUSES[status]} />;
}

export function SessionStatusBadge({ status }: { status: SessionStatus }) {
  return <StatusBadge def={SESSION_STATUSES[status]} />;
}

/** A note's state; a completed session without a signed note reads "Note pending". */
export function NoteStatusBadge({ state, pending }: { state: NoteState; pending?: boolean }) {
  if (pending) {
    return (
      <StatusBadge
        def={{
          label: state === 'DRAFT' ? 'Note pending (draft)' : 'Note pending',
          tone: 'warning',
          icon: FileWarning,
        }}
      />
    );
  }
  return <StatusBadge def={NOTE_STATES[state]} />;
}
