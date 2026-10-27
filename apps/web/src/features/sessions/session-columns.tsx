'use client';

import Link from 'next/link';

import type { ColumnDef } from '@/components/data-table/data-table';
import { Badge } from '@/components/ui/badge';
import type { SessionItem } from '@/lib/types';
import {
  AppointmentStatusBadge,
  AppointmentTypeLabel,
  TherapyTypeChip,
  useCenterFormat,
} from '../appointments/appointment-display';
import { COVERAGE } from '../packages/package-display';
import { SessionRowActions, type SessionAction } from './session-actions';
import {
  AttendanceBadge,
  NoteStatusBadge,
  SessionStatusBadge,
  sessionLinks,
} from './session-display';

/** A session row with, optionally, how many goals its note recorded (patient profile). */
type Row = SessionItem & { goalsRecorded?: number | null };

/**
 * The session list's columns, shared by the day list, the history and the patient
 * profile. Session status reads as the appointment's status once it was cancelled or a
 * no-show, since no session took place.
 */
export function sessionColumns({
  fmt,
  onAction,
  busyId,
  showDate = false,
  showPatient = true,
  showTherapist = true,
  showPackage = false,
  showGoals = false,
}: {
  fmt: ReturnType<typeof useCenterFormat>;
  onAction: (action: SessionAction, session: SessionItem) => void;
  busyId?: string;
  showDate?: boolean;
  showPatient?: boolean;
  showTherapist?: boolean;
  showPackage?: boolean;
  showGoals?: boolean;
}): ColumnDef<Row, unknown>[] {
  const when: ColumnDef<Row, unknown> = {
    id: 'when',
    header: showDate ? 'Date' : 'Time',
    meta: { className: 'whitespace-nowrap tabular' },
    cell: ({ row }) => {
      const s = row.original;
      return (
        <Link
          href={sessionLinks.detail(s.id)}
          className="flex flex-col rounded hover:underline focus-ring"
        >
          <span className="font-medium">
            {showDate ? fmt.date(s.date) : fmt.clock(s.startTime)}
          </span>
          <span className="text-xs text-muted-foreground">
            {showDate ? fmt.range(s) : `to ${fmt.clock(s.endTime)}`}
          </span>
        </Link>
      );
    },
  };
  const columns: (ColumnDef<Row, unknown> | false)[] = [
    when,
    showPatient && {
      id: 'patient',
      header: 'Patient',
      cell: ({ row }) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{row.original.patient.fullName}</span>
          <span className="truncate text-xs text-muted-foreground">
            {row.original.patient.code}
          </span>
        </span>
      ),
    },
    {
      id: 'therapy',
      header: 'Therapy',
      cell: ({ row }) => (
        <span className="flex flex-col gap-0.5">
          <TherapyTypeChip therapyType={row.original.therapyType} />
          <AppointmentTypeLabel type={row.original.type} quiet />
        </span>
      ),
    },
    showTherapist && {
      id: 'therapist',
      header: 'Therapist',
      meta: { className: 'hidden md:table-cell' },
      cell: ({ row }) => (
        <span className="truncate">
          {row.original.therapist.fullName}
          {row.original.therapist.isYou && <span className="text-muted-foreground"> (you)</span>}
        </span>
      ),
    },
    {
      id: 'attendance',
      header: 'Attendance',
      cell: ({ row }) => {
        const a = row.original.attendance;
        return (
          <span className="flex flex-col items-start gap-0.5">
            <AttendanceBadge status={a.status} />
            {a.checkInTime && (
              <span className="text-xs text-muted-foreground tabular">
                In at {fmt.clock(a.checkInTime)}
              </span>
            )}
          </span>
        );
      },
    },
    {
      id: 'session',
      header: 'Session',
      meta: { className: 'hidden sm:table-cell' },
      cell: ({ row }) => {
        const s = row.original;
        return s.status === 'CANCELLED' || s.status === 'NO_SHOW' ? (
          <AppointmentStatusBadge status={s.status} />
        ) : (
          <SessionStatusBadge status={s.sessionStatus} />
        );
      },
    },
    {
      id: 'note',
      header: 'Note',
      meta: { className: 'hidden lg:table-cell' },
      cell: ({ row }) => {
        const s = row.original;
        if (s.type !== 'THERAPY_SESSION') {
          return <span className="text-[13px] text-subtle-foreground">Assessment</span>;
        }
        if (s.noteStatus === 'NONE' && !s.notePending) {
          return <span className="text-[13px] text-subtle-foreground">—</span>;
        }
        return (
          <span className="flex flex-col items-start gap-0.5">
            <NoteStatusBadge state={s.noteStatus} pending={s.notePending} />
            {showGoals && typeof s.goalsRecorded === 'number' && s.goalsRecorded > 0 && (
              <span className="text-xs text-muted-foreground">
                {s.goalsRecorded} goal{s.goalsRecorded === 1 ? '' : 's'} recorded
              </span>
            )}
          </span>
        );
      },
    },
    showPackage && {
      id: 'package',
      header: 'Package',
      meta: { className: 'hidden xl:table-cell' },
      cell: ({ row }) => {
        const usage = row.original.packageUsage;
        return usage ? (
          <Badge tone={COVERAGE[usage].tone}>{COVERAGE[usage].label}</Badge>
        ) : (
          <span className="text-[13px] text-subtle-foreground">—</span>
        );
      },
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      meta: { className: 'text-right' },
      cell: ({ row }) => (
        <SessionRowActions
          session={row.original}
          onAction={onAction}
          busy={busyId === row.original.id}
        />
      ),
    },
  ];
  return columns.filter((c): c is ColumnDef<Row, unknown> => Boolean(c));
}
