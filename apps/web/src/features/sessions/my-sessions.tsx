'use client';

import * as React from 'react';
import Link from 'next/link';
import { CalendarCheck, FileWarning, History, ListChecks, UserRoundX } from 'lucide-react';

import { RequirePermission } from '@/components/auth/require-permission';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/feedback/states';
import { PageHeader, SectionHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useMySessions } from '@/lib/api/sessions';
import type { SessionItem } from '@/lib/types';
import { TherapyTypeChip, useCenterFormat } from '../appointments/appointment-display';
import { noteLink, useSessionDialogs, type SessionAction } from './session-actions';
import {
  AttendanceBadge,
  NoteStatusBadge,
  SessionStatusBadge,
  sessionLinks,
} from './session-display';

/** Where a session of today stands, for grouping the day. */
function stage(s: SessionItem) {
  if (s.status === 'COMPLETED') return 'completed';
  if (s.status === 'NO_SHOW') return 'missed';
  if (s.sessionStatus === 'IN_PROGRESS') return 'inProgress';
  if (s.attendance.status === 'PRESENT' || s.attendance.status === 'LATE') return 'arrived';
  return 'upcoming';
}

const STAGES = [
  { key: 'arrived', title: 'Checked in', hint: 'Waiting for their session' },
  { key: 'inProgress', title: 'In progress', hint: undefined },
  { key: 'upcoming', title: 'Upcoming', hint: undefined },
  { key: 'completed', title: 'Completed', hint: undefined },
  { key: 'missed', title: 'Absent', hint: undefined },
] as const;

/** One session with its next step: write or continue the note, or complete it. */
function SessionCard({
  session: s,
  showDate,
  onAction,
}: {
  session: SessionItem;
  showDate?: boolean;
  onAction: (action: SessionAction, s: SessionItem) => void;
}) {
  const fmt = useCenterFormat();
  const note = noteLink(s);
  const canComplete = s.sessionActions.complete;
  return (
    <Card className="transition-colors hover:border-border-strong">
      <CardContent className="grid gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <Link
            href={sessionLinks.detail(s.id)}
            className="grid min-w-0 gap-0.5 rounded focus-ring"
          >
            <span className="truncate font-medium hover:underline">{s.patient.fullName}</span>
            <span className="text-[13px] text-muted-foreground tabular">
              {showDate && `${fmt.shortDate(s.date)}, `}
              {fmt.range(s)} · {s.patient.code}
            </span>
          </Link>
          <TherapyTypeChip therapyType={s.therapyType} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <AttendanceBadge status={s.attendance.status} />
          {s.status !== 'NO_SHOW' && <SessionStatusBadge status={s.sessionStatus} />}
          {s.type === 'THERAPY_SESSION' && (s.noteStatus !== 'NONE' || s.notePending) && (
            <NoteStatusBadge state={s.noteStatus} pending={s.notePending} />
          )}
          {s.plan && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <ListChecks className="size-3.5" aria-hidden /> {s.plan.code}
            </span>
          )}
        </div>
        {(note || canComplete) && (
          <div className="flex flex-wrap gap-2">
            {note && (
              <Button
                size="sm"
                variant={
                  s.sessionActions.writeNote || s.sessionActions.editNote ? 'primary' : 'secondary'
                }
                asChild
              >
                <Link href={sessionLinks.note(s.id)}>
                  <note.icon /> {note.label}
                </Link>
              </Button>
            )}
            {canComplete && (
              <Button size="sm" variant="secondary" onClick={() => onAction('complete', s)}>
                Complete session
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CardGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{children}</div>;
}

/**
 * A therapist's own day: today's sessions by where they stand, notes still to write or
 * sign, and recently completed sessions. Only sessions with their own profile.
 */
function MySessionsView() {
  const { data, error, isPending, refetch } = useMySessions();
  const { open, dialogs } = useSessionDialogs();
  if (isPending) return <ListSkeleton rows={4} />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!data.therapist) {
    return (
      <Card>
        <EmptyState
          icon={UserRoundX}
          title="Your account isn’t linked to a therapist profile"
          description="Ask an administrator to link your staff account to your therapist profile to see your sessions here."
        />
      </Card>
    );
  }
  const groups = STAGES.map((g) => ({
    ...g,
    items: data.today.filter((s) => stage(s) === g.key),
  })).filter((g) => g.items.length);

  return (
    <>
      <PageHeader title="My sessions" description={data.therapist.fullName} />
      <div className="grid gap-8">
        <section className="grid gap-4">
          <SectionHeader
            className="mb-0"
            title="Today"
            description={`${data.today.length} session${data.today.length === 1 ? '' : 's'}`}
          />
          {groups.length === 0 ? (
            <Card>
              <EmptyState compact icon={CalendarCheck} title="No sessions today" />
            </Card>
          ) : (
            groups.map((g) => (
              <div key={g.key} className="grid gap-2">
                <h3 className="text-[13px] font-medium text-muted-foreground">
                  {g.title} · {g.items.length}
                  {g.hint && <span className="font-normal"> — {g.hint}</span>}
                </h3>
                <CardGrid>
                  {g.items.map((s) => (
                    <SessionCard key={s.id} session={s} onAction={open} />
                  ))}
                </CardGrid>
              </div>
            ))
          )}
        </section>

        <section className="grid gap-4">
          <SectionHeader
            className="mb-0"
            title="Pending notes"
            description="Sessions whose documentation isn’t signed off yet, oldest first."
          />
          {data.pendingNotes.length === 0 ? (
            <Card>
              <EmptyState compact icon={FileWarning} title="Nothing pending. Well done." />
            </Card>
          ) : (
            <CardGrid>
              {data.pendingNotes.map((s) => (
                <SessionCard key={s.id} session={s} showDate onAction={open} />
              ))}
            </CardGrid>
          )}
        </section>

        <section className="grid gap-4">
          <SectionHeader
            className="mb-0"
            title="Recent sessions"
            description="Completed in the last two weeks."
            actions={
              <Button variant="ghost" size="sm" asChild>
                <Link href={sessionLinks.list}>
                  <History /> All sessions
                </Link>
              </Button>
            }
          />
          {data.recent.length === 0 ? (
            <Card>
              <EmptyState compact icon={History} title="No completed sessions recently." />
            </Card>
          ) : (
            <CardGrid>
              {data.recent.map((s) => (
                <SessionCard key={s.id} session={s} showDate onAction={open} />
              ))}
            </CardGrid>
          )}
        </section>
      </div>
      {dialogs}
    </>
  );
}

export function MySessionsScreen() {
  return (
    <RequirePermission permission="sessions.read_own">
      <div className="animate-in">
        <MySessionsView />
      </div>
    </RequirePermission>
  );
}
