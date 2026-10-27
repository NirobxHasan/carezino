'use client';

import * as React from 'react';
import { addDays, format, parseISO } from 'date-fns';
import {
  CalendarCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  FileWarning,
  UserCheck,
  UserX,
} from 'lucide-react';

import { RequirePermission } from '@/components/auth/require-permission';
import { DataTable } from '@/components/data-table/data-table';
import { FilterBar } from '@/components/data-table/filter-bar';
import { KpiCard } from '@/components/domain/kpi-card';
import { EmptyState } from '@/components/feedback/states';
import { DatePicker } from '@/components/forms/date-picker';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { useTodaySessions } from '@/lib/api/sessions';
import { useSession } from '@/lib/session';
import { centerToday, useCenterFormat } from '../appointments/appointment-display';
import { sessionColumns } from './session-columns';
import { useSessionDialogs } from './session-actions';
import { CLEARED, SessionFilterBar, filtersOf, isFiltered, useListState } from './session-filters';

const shift = (date: string, days: number) => format(addDays(parseISO(date), days), 'yyyy-MM-dd');

/**
 * The front desk's day: every appointment of one day in time order, with arrival,
 * session and note status, checking in and marking attendance in one click. Refreshes
 * on its own so arrivals recorded elsewhere show up.
 */
function TodayTable() {
  const { activeCenter } = useSession();
  const fmt = useCenterFormat();
  const [state, set] = useListState(100);
  const today = centerToday(activeCenter.timezone);
  const date = state.date || today;
  const { data, isFetching, error, refetch } = useTodaySessions({
    ...filtersOf(state),
    date,
  });
  const { open, dialogs, busyId } = useSessionDialogs();
  const columns = React.useMemo(
    () => sessionColumns({ fmt, onAction: open, busyId }),
    [fmt, open, busyId],
  );
  const summary = data?.summary;
  const filtered = isFiltered(state);
  const isToday = date === today;
  const kpi = (
    label: string,
    value: number | undefined,
    icon: typeof Circle,
    patch: Parameters<typeof set>[0],
    tone?: 'neutral' | 'primary' | 'warning' | 'success',
  ) => (
    <button
      type="button"
      className="rounded-xl text-left focus-ring"
      onClick={() => set({ ...CLEARED, ...patch })}
      aria-label={`${label}: ${value ?? 'loading'}. Show these`}
    >
      <KpiCard label={label} value={value ?? 0} icon={icon} tone={tone} loading={!summary} />
    </button>
  );

  return (
    <>
      <PageHeader
        title={isToday ? 'Today’s sessions' : 'Sessions'}
        description={`${fmt.longDate(date)}${data ? ` · ${data.total} appointment${data.total === 1 ? '' : 's'}${filtered ? ' match' : ''}` : ''}`}
        actions={
          <div className="flex items-center gap-1">
            <Button
              variant="secondary"
              size="icon-sm"
              aria-label="Previous day"
              onClick={() => set({ date: shift(date, -1) })}
            >
              <ChevronLeft />
            </Button>
            <DatePicker
              value={date}
              onChange={(d) => set({ date: d && d !== today ? d : '' })}
              className="w-44"
            />
            <Button
              variant="secondary"
              size="icon-sm"
              aria-label="Next day"
              onClick={() => set({ date: shift(date, 1) })}
            >
              <ChevronRight />
            </Button>
            {!isToday && (
              <Button variant="ghost" size="sm" onClick={() => set({ date: '' })}>
                Today
              </Button>
            )}
          </div>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {kpi('Expected', summary?.expected, CalendarCheck, {})}
        {kpi('Arrived', summary?.arrived, UserCheck, { attendance: 'PRESENT' }, 'success')}
        {kpi('Not marked', summary?.notMarked, Circle, { attendance: 'NOT_MARKED' }, 'primary')}
        {kpi('Absent', summary?.absent, UserX, { status: 'NO_SHOW' }, 'warning')}
        {kpi('Completed', summary?.completed, CheckCircle2, { status: 'COMPLETED' }, 'success')}
        {kpi('Notes pending', summary?.notesPending, FileWarning, { note: 'PENDING' }, 'warning')}
      </div>
      <DataTable
        label="Sessions of the day"
        columns={columns}
        data={data?.items}
        loading={isFetching && !data}
        error={error}
        onRetry={() => void refetch()}
        getRowId={(s) => s.id}
        pagination={
          data && data.total > data.pageSize
            ? {
                page: data.page,
                pageSize: data.pageSize,
                total: data.total,
                onPageChange: (page) => set({ page }),
              }
            : undefined
        }
        pageSize={100}
        toolbar={
          <FilterBar>
            <SessionFilterBar state={state} set={set} />
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
            <EmptyState
              icon={CalendarCheck}
              title={isToday ? 'No appointments today' : 'No appointments on this day'}
            />
          )
        }
      />
      {dialogs}
    </>
  );
}

export function TodaySessionsScreen() {
  return (
    <RequirePermission permission="sessions.read_own">
      <div className="animate-in">
        <TodayTable />
      </div>
    </RequirePermission>
  );
}
