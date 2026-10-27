'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { SearchInput } from '@/components/data-table/filter-bar';
import { ColorDot } from '@/components/forms/color-picker';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { SessionFilters } from '@/lib/api/sessions';
import { useTherapistList } from '@/lib/api/therapists';
import { useTherapyTypeList } from '@/lib/api/therapy-types';
import { useDebounced } from '@/lib/hooks/use-debounced';
import { useSession } from '@/lib/session';
import type { AppointmentRecordStatus, AttendanceStatus, NoteState } from '@/lib/types';
import { APPOINTMENT_STATUSES } from '../appointments/appointment-display';
import { ATTENDANCE_STATUSES, NOTE_STATES } from './session-display';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const PAGE_SIZES = [20, 50, 100];

type NoteFilter = NoteState | 'PENDING';

/** The lists' state, kept in the URL so it survives reloads and can be shared. */
export interface ListState {
  q: string;
  therapistId: string;
  therapyTypeId: string;
  attendance: AttendanceStatus | 'all';
  status: AppointmentRecordStatus | 'all';
  note: NoteFilter | 'all';
  /** Today's list: the day shown ('' is today). History: the range. */
  date: string;
  from: string;
  to: string;
  page: number;
  pageSize: number;
}

function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T) {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

const NOTE_FILTERS = [...(Object.keys(NOTE_STATES) as NoteState[]), 'PENDING'] as const;

function readState(params: URLSearchParams, defaultPageSize: number): ListState {
  const page = Number(params.get('page'));
  const size = Number(params.get('size'));
  const date = params.get('date') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const range = ISO_DATE.test(from) && ISO_DATE.test(to);
  return {
    q: params.get('q') ?? '',
    therapistId: params.get('therapist') ?? 'all',
    therapyTypeId: params.get('therapy') ?? 'all',
    attendance: oneOf(
      params.get('attendance'),
      Object.keys(ATTENDANCE_STATUSES) as AttendanceStatus[],
      'all' as const,
    ),
    status: oneOf(
      params.get('status'),
      Object.keys(APPOINTMENT_STATUSES) as AppointmentRecordStatus[],
      'all' as const,
    ),
    note: oneOf(params.get('note'), NOTE_FILTERS, 'all' as const),
    date: ISO_DATE.test(date) ? date : '',
    from: range ? from : '',
    to: range ? to : '',
    page: Number.isInteger(page) && page > 1 ? page : 1,
    pageSize: PAGE_SIZES.includes(size) ? size : defaultPageSize,
  };
}

function writeState(state: ListState, defaultPageSize: number) {
  const params = new URLSearchParams();
  if (state.q.trim()) params.set('q', state.q.trim());
  if (state.therapistId !== 'all') params.set('therapist', state.therapistId);
  if (state.therapyTypeId !== 'all') params.set('therapy', state.therapyTypeId);
  if (state.attendance !== 'all') params.set('attendance', state.attendance);
  if (state.status !== 'all') params.set('status', state.status);
  if (state.note !== 'all') params.set('note', state.note);
  if (state.date) params.set('date', state.date);
  if (state.from && state.to) {
    params.set('from', state.from);
    params.set('to', state.to);
  }
  if (state.page > 1) params.set('page', String(state.page));
  if (state.pageSize !== defaultPageSize) params.set('size', String(state.pageSize));
  return params.toString();
}

export function useListState(defaultPageSize: number) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const state = React.useMemo(
    () => readState(new URLSearchParams(searchParams), defaultPageSize),
    [searchParams, defaultPageSize],
  );
  const set = React.useCallback(
    (patch: Partial<ListState>) => {
      const next = { ...state, ...('page' in patch ? {} : { page: 1 }), ...patch };
      const q = writeState(next, defaultPageSize);
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    },
    [state, router, pathname, defaultPageSize],
  );
  return [state, set] as const;
}

/** The API filters a list state stands for. */
export function filtersOf(state: ListState): SessionFilters {
  return {
    search: state.q,
    therapistId: state.therapistId === 'all' ? undefined : state.therapistId,
    therapyTypeId: state.therapyTypeId === 'all' ? undefined : state.therapyTypeId,
    attendance: state.attendance === 'all' ? undefined : [state.attendance],
    status: state.status === 'all' ? undefined : [state.status],
    noteStatus: state.note === 'all' ? undefined : [state.note],
    page: state.page,
    pageSize: state.pageSize,
  };
}

export function isFiltered(state: ListState) {
  return (
    Boolean(state.q) ||
    state.therapistId !== 'all' ||
    state.therapyTypeId !== 'all' ||
    state.attendance !== 'all' ||
    state.status !== 'all' ||
    state.note !== 'all' ||
    Boolean(state.from)
  );
}

export const CLEARED: Partial<ListState> = {
  q: '',
  therapistId: 'all',
  therapyTypeId: 'all',
  attendance: 'all',
  status: 'all',
  note: 'all',
  from: '',
  to: '',
};

const NOTE_FILTER_LABELS: Record<NoteFilter, string> = {
  PENDING: 'Note pending',
  NONE: 'No note',
  DRAFT: 'Draft note',
  COMPLETED: 'Signed note',
  AMENDED: 'Amended note',
};

/**
 * Search (debounced into the URL) and the session filters. Therapists only see their
 * own sessions, so the therapist filter is for those who see the team.
 */
export function SessionFilterBar({
  state,
  set,
  children,
}: {
  state: ListState;
  set: (patch: Partial<ListState>) => void;
  /** Extra controls, e.g. the date range */
  children?: React.ReactNode;
}) {
  const { can } = useSession();
  const [search, setSearch] = React.useState(state.q);
  const debounced = useDebounced(search, 300);
  React.useEffect(() => {
    if (debounced.trim() !== state.q.trim()) set({ q: debounced });
    // Only when the typed value settles, not when the URL changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  const [shownQ, setShownQ] = React.useState(state.q);
  if (shownQ !== state.q) {
    setShownQ(state.q);
    if (debounced.trim() === search.trim()) setSearch(state.q);
  }
  const seesTeam = can('sessions.read') && can('therapists.read');
  const therapists = useTherapistList(
    { status: 'all', pageSize: 100, sortBy: 'fullName' },
    seesTeam,
  );
  const types = useTherapyTypeList({ status: 'all' });
  const filtered = isFiltered(state);

  return (
    <>
      <SearchInput
        value={search}
        onChange={setSearch}
        label="Search sessions"
        placeholder="Patient, patient ID, mobile or therapist…"
      />
      {seesTeam && (
        <Select value={state.therapistId} onValueChange={(therapistId) => set({ therapistId })}>
          <SelectTrigger size="sm" className="w-full sm:w-44" aria-label="Filter by therapist">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All therapists</SelectItem>
            {therapists.data?.items.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.fullName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Select value={state.therapyTypeId} onValueChange={(therapyTypeId) => set({ therapyTypeId })}>
        <SelectTrigger size="sm" className="w-full sm:w-40" aria-label="Filter by therapy">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All therapies</SelectItem>
          {types.data?.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              <span className="flex items-center gap-2">
                <ColorDot color={t.color} />
                {t.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={state.attendance}
        onValueChange={(v) => set({ attendance: v as ListState['attendance'] })}
      >
        <SelectTrigger size="sm" className="w-full sm:w-40" aria-label="Filter by attendance">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Any attendance</SelectItem>
          {Object.entries(ATTENDANCE_STATUSES).map(([value, s]) => (
            <SelectItem key={value} value={value}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={state.status} onValueChange={(v) => set({ status: v as ListState['status'] })}>
        <SelectTrigger
          size="sm"
          className="w-full sm:w-40"
          aria-label="Filter by appointment status"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Any status</SelectItem>
          {Object.entries(APPOINTMENT_STATUSES).map(([value, s]) => (
            <SelectItem key={value} value={value}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={state.note} onValueChange={(v) => set({ note: v as ListState['note'] })}>
        <SelectTrigger size="sm" className="w-full sm:w-40" aria-label="Filter by note">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Any note</SelectItem>
          {Object.entries(NOTE_FILTER_LABELS).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {children}
      {filtered && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setSearch('');
            set(CLEARED);
          }}
        >
          Clear filters
        </Button>
      )}
    </>
  );
}
