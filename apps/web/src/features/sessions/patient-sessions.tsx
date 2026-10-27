'use client';

import * as React from 'react';
import { History } from 'lucide-react';

import { DataTable } from '@/components/data-table/data-table';
import { EmptyState } from '@/components/feedback/states';
import { usePatientSessions } from '@/lib/api/sessions';
import { useCenterFormat } from '../appointments/appointment-display';
import { sessionColumns } from './session-columns';
import { useSessionDialogs } from './session-actions';

/**
 * A patient's sessions, newest first: attendance, session and note status, and how
 * many goals each note recorded. Note content opens only for those with clinical access.
 */
export function PatientSessionsPanel({ patientId }: { patientId: string }) {
  const fmt = useCenterFormat();
  const [page, setPage] = React.useState(1);
  const { data, isFetching, error, refetch } = usePatientSessions(patientId, {
    page,
    pageSize: 20,
  });
  const { open, dialogs, busyId } = useSessionDialogs();
  const columns = React.useMemo(
    () =>
      sessionColumns({
        fmt,
        onAction: open,
        busyId,
        showDate: true,
        showPatient: false,
        showGoals: true,
      }),
    [fmt, open, busyId],
  );
  return (
    <>
      <DataTable
        label="Session history"
        columns={columns}
        data={data?.items}
        loading={isFetching}
        error={error}
        onRetry={() => void refetch()}
        getRowId={(s) => s.id}
        pagination={
          data
            ? { page: data.page, pageSize: data.pageSize, total: data.total, onPageChange: setPage }
            : undefined
        }
        toolbar={
          <p className="text-[13px] text-muted-foreground">
            Attendance, sessions and notes, newest first.
          </p>
        }
        empty={<EmptyState compact icon={History} title="No sessions yet." />}
      />
      {dialogs}
    </>
  );
}
