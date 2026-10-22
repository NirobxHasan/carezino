'use client';

import Link from 'next/link';
import { differenceInMinutes, parseISO } from 'date-fns';
import { ClipboardCheck, Repeat } from 'lucide-react';

import { AppointmentStatusBadge, NoteStatusBadge } from '@/components/domain/status-badges';
import { TherapyTypeTag } from '@/components/domain/therapy-type';
import type { AppointmentWithRefs } from '@/lib/api/prototype-appointments';
import { formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { AppointmentActions } from './appointment-actions';

/** One appointment as a row: time, patient, therapist, type and status, plus actions. */
export function AppointmentCard({
  appointment: a,
  showTherapist = true,
  showDate,
  className,
}: {
  appointment: AppointmentWithRefs;
  showTherapist?: boolean;
  showDate?: React.ReactNode;
  className?: string;
}) {
  const minutes = differenceInMinutes(parseISO(a.end), parseISO(a.start));
  const muted = a.status === 'cancelled';
  const now = new Date();
  const live =
    a.status === 'checked_in' ||
    (parseISO(a.start) <= now && parseISO(a.end) > now && a.status === 'scheduled');

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-4 py-3 sm:gap-4',
        live && 'bg-primary-subtle/50',
        className,
      )}
    >
      <div className="w-17 shrink-0 tabular">
        {showDate && <p className="text-xs text-muted-foreground">{showDate}</p>}
        <p className={cn('text-sm font-medium', muted && 'text-muted-foreground line-through')}>
          {formatTime(a.start)}
        </p>
        <p className="text-xs text-muted-foreground">{minutes} min</p>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <Link
            href={`/patients/${a.patientId}`}
            className={cn(
              'truncate rounded text-sm font-medium hover:underline focus-ring',
              muted && 'text-muted-foreground',
            )}
          >
            {a.patient.fullName}
          </Link>
          {a.kind === 'assessment' && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-info-foreground">
              <ClipboardCheck className="size-3.5" aria-hidden /> Assessment
            </span>
          )}
          {a.seriesId && (
            <Repeat className="size-3.5 text-subtle-foreground" aria-label="Recurring" />
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
          <TherapyTypeTag id={a.therapyTypeId} />
          {showTherapist && <span className="truncate">{a.therapist.name}</span>}
          {a.room && <span className="hidden truncate md:inline">{a.room}</span>}
          <span className="sm:hidden">
            <AppointmentStatusBadge status={a.status} />
          </span>
        </div>
      </div>
      <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
        <AppointmentStatusBadge status={a.status} />
        {a.status === 'completed' && a.noteStatus !== 'submitted' && (
          <NoteStatusBadge status={a.noteStatus} />
        )}
      </div>
      <div className="shrink-0">
        <AppointmentActions appointment={a} />
      </div>
    </div>
  );
}
