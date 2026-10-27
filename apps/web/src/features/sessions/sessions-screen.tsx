'use client';

import * as React from 'react';
import { History } from 'lucide-react';

import { RequirePermission } from '@/components/auth/require-permission';
import { DataTable } from '@/components/data-table/data-table';
import { FilterBar } from '@/components/data-table/filter-bar';
import { EmptyState } from '@/components/feedback/states';
import { DateRangePicker } from '@/components/forms/date-picker';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { useSessionList } from '@/lib/api/sessions';
import { useSession } from '@/lib/session';
import { useCenterFormat } from '../appointments/appointment-display';
import { sessionColumns } from './session-columns';
import { useSessionDialogs } from './session-actions';
import {
  CLEARED,
  PAGE_SIZES,
  SessionFilterBar,
  filtersOf,
  isFiltered,
  useListState,
} from './session-filters';

/** Every session, newest first, with server-side filters and pages. */
function SessionHistory() {
  const { can } = useSession();
  const fmt = useCenterFormat();
  const [state, set] = useListState(20);
  const { data, isFetching, error, refetch } = useSessionList({
    ...filtersOf(state),
    from: state.from || undefined,
    to: state.to || undefined,
  });
  const { open, dialogs, busyId } = useSessionDialogs();
  const seesTeam = can('sessions.read');
  const columns = React.useMemo(
    () =>
      sessionColumns({
        fmt,
        onAction: open,
        busyId,
        showDate: true,
        showTherapist: seesTeam,
        showPackage: true,
      }),
    [fmt, open, busyId, seesTeam],
  );
  const filtered = isFiltered(state);

  return (
    <>
      <PageHeader
        title="Sessions"
        description={
          data
            ? `${data.total} ${data.total === 1 ? 'session' : 'sessions'}${filtered ? ' match' : ''}`
            : 'Attendance, session and note status for every appointment.'
        }
      />
      <DataTable
        label="Sessions"
        columns={columns}
        data={data?.items}
        loading={isFetching}
        error={error}
        onRetry={() => void refetch()}
        getRowId={(s) => s.id}
        pagination={
          data
            ? {
                page: data.page,
                pageSize: data.pageSize,
                total: data.total,
                onPageChange: (page) => set({ page }),
                pageSizeOptions: PAGE_SIZES,
                onPageSizeChange: (pageSize) => set({ pageSize }),
              }
            : undefined
        }
        toolbar={
          <FilterBar>
            <SessionFilterBar state={state} set={set}>
              <DateRangePicker
                value={state.from ? { from: state.from, to: state.to } : null}
                onChange={(range) => set({ from: range.from, to: range.to })}
                placeholder="Any date"
              />
            </SessionFilterBar>
          </FilterBar>
        }
        empty={
          filtered ? (
            <EmptyState
              title="No sessions match these filters"
              action={
                <Button variant="secondary" size="sm" onClick={() => set(CLEARED)}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState icon={History} title="No sessions yet" />
          )
        }
      />
      {dialogs}
    </>
  );
}

export function SessionsScreen() {
  return (
    <RequirePermission permission="sessions.read_own">
      <div className="animate-in">
        <SessionHistory />
      </div>
    </RequirePermission>
  );
}
