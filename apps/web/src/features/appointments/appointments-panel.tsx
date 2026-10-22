'use client';

import * as React from 'react';
import Link from 'next/link';
import { CalendarDays, CalendarPlus } from 'lucide-react';

import { DataTable } from '@/components/data-table/data-table';
import { EmptyState } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { SegmentedList, SegmentedTrigger, Tabs } from '@/components/ui/tabs';
import { useAppointmentList, type AppointmentListParams } from '@/lib/api/appointments';
import { useSession } from '@/lib/session';
import { useAppointmentDialogs } from './appointment-actions';
import { appointmentLinks, useCenterFormat } from './appointment-display';
import { appointmentColumns } from './appointments-screen';

type View = 'upcoming' | 'past' | 'cancelled';

const VIEWS: Record<View, { label: string; params: AppointmentListParams; empty: string }> = {
  upcoming: {
    label: 'Upcoming',
    params: { timeframe: 'upcoming', status: ['SCHEDULED', 'CONFIRMED'], sortOrder: 'asc' },
    empty: 'Nothing booked ahead.',
  },
  past: {
    label: 'Previous',
    params: {
      timeframe: 'past',
      status: ['SCHEDULED', 'CONFIRMED', 'COMPLETED', 'NO_SHOW'],
      sortOrder: 'desc',
    },
    empty: 'No earlier appointments.',
  },
  cancelled: {
    label: 'Cancelled',
    params: { status: ['CANCELLED'], sortOrder: 'desc' },
    empty: 'No cancelled appointments.',
  },
};

/**
 * One patient's or therapist's appointments, split into upcoming, previous and
 * cancelled, with the same actions as everywhere else. Used on both profiles.
 */
export function AppointmentsPanel({
  patientId,
  therapistId,
  bookPrefill,
}: {
  patientId?: string;
  therapistId?: string;
  /** Shows a booking button that prefills the form from this profile */
  bookPrefill?: Record<string, string>;
}) {
  const { can } = useSession();
  const fmt = useCenterFormat();
  const [view, setView] = React.useState<View>('upcoming');
  const [page, setPage] = React.useState(1);
  const { open, dialogs } = useAppointmentDialogs();
  const { data, isFetching, error, refetch } = useAppointmentList({
    ...VIEWS[view].params,
    patientId,
    therapistId,
    page,
    pageSize: 10,
  });
  const columns = React.useMemo(
    () =>
      appointmentColumns({
        fmt,
        onAction: open,
        showPatient: !patientId,
        showTherapist: !therapistId,
      }),
    [fmt, open, patientId, therapistId],
  );
  const book = bookPrefill && can('appointments.create') && (
    <Button size="sm" asChild>
      <Link href={appointmentLinks.book(bookPrefill)}>
        <CalendarPlus /> Book appointment
      </Link>
    </Button>
  );

  return (
    <>
      <DataTable
        label="Appointments"
        columns={columns}
        data={data?.items}
        loading={isFetching}
        error={error}
        onRetry={() => void refetch()}
        getRowId={(a) => a.id}
        rowHref={(a) => appointmentLinks.detail(a.id)}
        pagination={
          data
            ? { page: data.page, pageSize: data.pageSize, total: data.total, onPageChange: setPage }
            : undefined
        }
        toolbar={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Tabs
              value={view}
              onValueChange={(v) => {
                setView(v as View);
                setPage(1);
              }}
            >
              <SegmentedList aria-label="Which appointments">
                {Object.entries(VIEWS).map(([value, v]) => (
                  <SegmentedTrigger key={value} value={value}>
                    {v.label}
                  </SegmentedTrigger>
                ))}
              </SegmentedList>
            </Tabs>
            {book}
          </div>
        }
        empty={<EmptyState compact icon={CalendarDays} title={VIEWS[view].empty} />}
      />
      {dialogs}
    </>
  );
}
