'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { CalendarPlus, ChevronLeft, ChevronRight, Globe, List } from 'lucide-react';

import { RequirePermission } from '@/components/auth/require-permission';
import { ErrorState, PageSkeleton } from '@/components/feedback/states';
import { ColorDot } from '@/components/forms/color-picker';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SegmentedList, SegmentedTrigger, Tabs } from '@/components/ui/tabs';
import { useAppointmentCalendar, type CalendarParams } from '@/lib/api/appointments';
import { useSchedulingSettings } from '@/lib/api/settings';
import { useTherapistList, useTherapistSchedule } from '@/lib/api/therapists';
import { useTherapyTypeList } from '@/lib/api/therapy-types';
import { useMediaQuery } from '@/lib/hooks/use-media-query';
import { useSession } from '@/lib/session';
import type {
  AppointmentCalendar,
  AppointmentItem,
  AppointmentRecordStatus,
  AppointmentType,
  ScheduleDay,
  TimeInterval,
} from '@/lib/types';
import { cn } from '@/lib/utils';
import { AppointmentSheet } from './appointment-details';
import {
  APPOINTMENT_STATUSES,
  APPOINTMENT_TYPES,
  appointmentLinks,
  centerToday,
  statusBlockClass,
  useCenterFormat,
} from './appointment-display';

type View = 'day' | 'week' | 'month';
type StatusFilter = 'active' | 'all' | AppointmentRecordStatus;

const HOUR_PX = 48;
const toIso = (d: Date) => format(d, 'yyyy-MM-dd');
/** "HH:mm" → minutes; "24:00" (midnight at the end of a day) is 1440 */
const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
/** Everything except cancelled, which would clutter the grid */
const ACTIVE: AppointmentRecordStatus[] = ['SCHEDULED', 'CONFIRMED', 'COMPLETED', 'NO_SHOW'];

const BLOCK_TONE: Record<AppointmentRecordStatus, string> = {
  SCHEDULED: 'bg-info-subtle text-foreground',
  CONFIRMED: 'bg-primary-subtle text-foreground',
  COMPLETED: 'bg-success-subtle text-foreground',
  NO_SHOW: 'bg-warning-subtle text-foreground',
  CANCELLED: 'bg-muted text-muted-foreground',
};

/** Calendar state in the URL: view, date and filters survive reloads and links. */
function useCalendarState(today: string, defaultView: View) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const view = (['day', 'week', 'month'] as const).find((v) => v === params.get('view'));
  const date = params.get('date');
  const state = {
    view: view ?? defaultView,
    date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today,
    therapistId: params.get('therapist') ?? 'all',
    therapyTypeId: params.get('therapy') ?? 'all',
    type: (params.get('type') ?? 'all') as AppointmentType | 'all',
    status: (params.get('status') ?? 'active') as StatusFilter,
  };
  const set = (patch: Partial<typeof state>) => {
    const next = { ...state, ...patch };
    const q = new URLSearchParams();
    q.set('view', next.view);
    if (next.date !== today) q.set('date', next.date);
    if (next.therapistId !== 'all') q.set('therapist', next.therapistId);
    if (next.therapyTypeId !== 'all') q.set('therapy', next.therapyTypeId);
    if (next.type !== 'all') q.set('type', next.type);
    if (next.status !== 'active') q.set('status', next.status);
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  };
  return [state, set] as const;
}

/** Side-by-side columns for overlapping appointments (double bookings, other therapists). */
function layout(items: AppointmentItem[]) {
  const sorted = [...items].sort(
    (a, b) =>
      toMinutes(a.startTime) - toMinutes(b.startTime) || b.durationMinutes - a.durationMinutes,
  );
  const placed: { item: AppointmentItem; col: number; cols: number }[] = [];
  let cluster: typeof placed = [];
  let clusterEnd = -1;
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((p) => p.col + 1));
    for (const p of cluster) p.cols = cols;
    cluster = [];
  };
  for (const item of sorted) {
    const start = toMinutes(item.startTime);
    const end = toMinutes(item.endTime);
    if (start >= clusterEnd) flush();
    const taken = new Set(
      cluster.filter((p) => toMinutes(p.item.endTime) > start).map((p) => p.col),
    );
    let col = 0;
    while (taken.has(col)) col += 1;
    const entry = { item, col, cols: 1 };
    cluster.push(entry);
    placed.push(entry);
    clusterEnd = Math.max(clusterEnd, end);
  }
  flush();
  return placed;
}

/** Whole hours covering opening hours and every appointment, at least 08:00–18:00. */
function hourRange(cal: AppointmentCalendar) {
  let start = 8 * 60;
  let end = 18 * 60;
  for (const d of cal.days) {
    for (const i of d.centerHours) {
      start = Math.min(start, toMinutes(i.start));
      end = Math.max(end, toMinutes(i.end));
    }
  }
  for (const a of cal.appointments) {
    start = Math.min(start, toMinutes(a.startTime));
    end = Math.max(end, toMinutes(a.endTime));
  }
  return { first: Math.floor(start / 60), last: Math.min(24, Math.ceil(end / 60)) };
}

function Band({
  interval,
  first,
  last,
  className,
  label,
  children,
}: {
  interval: TimeInterval;
  first: number;
  last: number;
  className: string;
  label?: string;
  children?: React.ReactNode;
}) {
  const start = Math.max(toMinutes(interval.start), first * 60);
  const end = Math.min(toMinutes(interval.end), last * 60);
  if (end <= start) return null;
  return (
    <div
      className={cn('pointer-events-none absolute inset-x-0', className)}
      style={{ top: ((start - first * 60) / 60) * HOUR_PX, height: ((end - start) / 60) * HOUR_PX }}
      title={label}
    >
      {children}
    </div>
  );
}

function TimeGrid({
  cal,
  schedule,
  showTherapist,
  today,
  onOpen,
  onBook,
}: {
  cal: AppointmentCalendar;
  schedule?: ScheduleDay[];
  showTherapist: boolean;
  today: string;
  onOpen: (id: string) => void;
  /** Click on free grid space; null when the user can't book */
  onBook: ((date: string, minutes: number) => void) | null;
}) {
  const fmt = useCenterFormat();
  const { first, last } = hourRange(cal);
  const height = (last - first) * HOUR_PX;
  const byDate = new Map<string, AppointmentItem[]>();
  for (const a of cal.appointments) {
    byDate.set(a.date, [...(byDate.get(a.date) ?? []), a]);
  }
  const wide = cal.days.length > 1;
  return (
    <div className="overflow-x-auto">
      <div className={cn(wide && 'min-w-[48rem]')}>
        <div
          className="grid"
          style={{ gridTemplateColumns: `4.25rem repeat(${cal.days.length}, minmax(0, 1fr))` }}
        >
          <div />
          {cal.days.map((d) => {
            const isToday = d.date === today;
            const closedAllDay = d.closures.find((c) => c.allDay);
            return (
              <div
                key={d.date}
                className="flex flex-col items-center gap-0.5 border-b border-border px-1 pb-2 text-center"
              >
                <span className="text-xs text-muted-foreground">
                  {format(parseISO(d.date), 'EEE')}
                </span>
                <span
                  className={cn(
                    'grid size-7 place-items-center rounded-full text-sm font-medium tabular',
                    isToday && 'bg-primary text-primary-foreground',
                  )}
                >
                  {format(parseISO(d.date), 'd')}
                </span>
                {closedAllDay ? (
                  <span className="max-w-full truncate text-[10px] text-danger-foreground">
                    {closedAllDay.title}
                  </span>
                ) : !d.centerHours.length ? (
                  <span className="text-[10px] text-muted-foreground">Closed</span>
                ) : null}
              </div>
            );
          })}

          <div className="relative" style={{ height }}>
            {Array.from({ length: last - first }, (_, h) => (
              <span
                key={h}
                className="absolute right-2 -translate-y-1/2 text-[11px] whitespace-nowrap text-muted-foreground tabular first:translate-y-0"
                style={{ top: h * HOUR_PX }}
              >
                {fmt.clock(`${String(first + h).padStart(2, '0')}:00`)}
              </span>
            ))}
          </div>

          {cal.days.map((d, i) => {
            const items = layout(byDate.get(d.date) ?? []);
            const sched = schedule?.[i]?.date === d.date ? schedule[i] : undefined;
            return (
              <div
                key={d.date}
                className={cn(
                  'relative border-l border-border bg-muted/60',
                  onBook && 'cursor-cell',
                )}
                style={{ height }}
                onClick={
                  onBook
                    ? (e) => {
                        if (e.target !== e.currentTarget) return;
                        const y = e.nativeEvent.offsetY;
                        onBook(d.date, first * 60 + Math.floor((y / HOUR_PX) * 60));
                      }
                    : undefined
                }
              >
                {d.centerHours.map((h) => (
                  <Band
                    key={`c${h.start}`}
                    interval={h}
                    first={first}
                    last={last}
                    className="bg-surface"
                  />
                ))}
                {sched?.available.map((h) => (
                  <Band
                    key={`a${h.start}`}
                    interval={h}
                    first={first}
                    last={last}
                    className="border-l-2 border-l-primary/50 bg-primary-subtle/40"
                    label={`Therapist available ${fmt.clock(h.start)}–${fmt.clock(h.end)}`}
                  />
                ))}
                {sched?.timeOff.map((t) => (
                  <Band
                    key={`t${t.id}`}
                    interval={t}
                    first={first}
                    last={last}
                    className="bg-[repeating-linear-gradient(135deg,var(--color-warning-subtle)_0_6px,transparent_6px_12px)]"
                    label="Therapist time off"
                  />
                ))}
                {d.closures.map((c) => (
                  <Band
                    key={`x${c.id}`}
                    interval={c}
                    first={first}
                    last={last}
                    className="bg-[repeating-linear-gradient(135deg,var(--color-danger-subtle)_0_6px,transparent_6px_12px)]"
                    label={`Center closed: ${c.title}`}
                  />
                ))}
                {Array.from({ length: last - first }, (_, h) => (
                  <div
                    key={h}
                    className="pointer-events-none absolute inset-x-0 border-t border-border/70"
                    style={{ top: h * HOUR_PX }}
                    aria-hidden
                  />
                ))}
                {items.map(({ item: a, col, cols }) => {
                  const start = Math.max(toMinutes(a.startTime), first * 60);
                  const end = Math.min(toMinutes(a.endTime), last * 60);
                  const h = ((end - start) / 60) * HOUR_PX;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => onOpen(a.id)}
                      className={cn(
                        'absolute overflow-hidden rounded-md border border-border/60 border-l-[3px] px-1.5 py-0.5 text-left text-[11px] leading-tight shadow-xs transition-shadow hover:shadow-md focus-ring',
                        BLOCK_TONE[a.status],
                      )}
                      style={{
                        top: ((start - first * 60) / 60) * HOUR_PX + 1,
                        height: Math.max(h - 2, 16),
                        left: `calc(${(col / cols) * 100}% + 2px)`,
                        width: `calc(${100 / cols}% - 4px)`,
                        borderLeftColor: a.therapyType.color ?? undefined,
                      }}
                      aria-label={`${a.patient.fullName}, ${fmt.range(a)}, ${a.therapyType.name}, ${a.therapist.fullName}, ${APPOINTMENT_STATUSES[a.status].label}`}
                    >
                      <span
                        className={cn('block truncate font-medium', statusBlockClass(a.status))}
                      >
                        {h >= 34 ? '' : `${fmt.clock(a.startTime)} `}
                        {a.patient.fullName}
                      </span>
                      {h >= 34 && (
                        <span className="block truncate text-muted-foreground tabular">
                          {fmt.range(a)}
                        </span>
                      )}
                      {h >= 50 && (
                        <span className="block truncate text-muted-foreground">
                          {a.therapyType.code}
                          {a.type === 'ASSESSMENT' && ' · Assessment'}
                          {showTherapist && ` · ${a.therapist.fullName}`}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MonthGrid({
  cal,
  month,
  today,
  onOpen,
  onDay,
}: {
  cal: AppointmentCalendar;
  month: Date;
  today: string;
  onOpen: (id: string) => void;
  onDay: (date: string) => void;
}) {
  const fmt = useCenterFormat();
  const byDate = new Map<string, AppointmentItem[]>();
  for (const a of cal.appointments) byDate.set(a.date, [...(byDate.get(a.date) ?? []), a]);
  const MAX = 3;
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[42rem] grid-cols-7 overflow-hidden rounded-lg border border-border">
        {cal.days.slice(0, 7).map((d) => (
          <div
            key={d.date}
            className="border-b border-border bg-muted/50 px-2 py-1.5 text-xs font-medium text-muted-foreground"
          >
            {format(parseISO(d.date), 'EEE')}
          </div>
        ))}
        {cal.days.map((d) => {
          const items = byDate.get(d.date) ?? [];
          const inMonth = parseISO(d.date).getMonth() === month.getMonth();
          const closed = !d.centerHours.length || d.closures.some((c) => c.allDay);
          return (
            <div
              key={d.date}
              className={cn(
                'flex min-h-28 flex-col gap-1 border-b border-l border-border p-1.5 [&:nth-child(7n+1)]:border-l-0',
                !inMonth && 'bg-muted/40',
                closed && inMonth && 'bg-muted/60',
              )}
            >
              <button
                type="button"
                onClick={() => onDay(d.date)}
                className={cn(
                  'grid size-6 place-items-center self-start rounded-full text-xs font-medium tabular hover:bg-accent focus-ring',
                  d.date === today && 'bg-primary text-primary-foreground hover:bg-primary',
                  !inMonth && 'text-subtle-foreground',
                )}
                aria-label={`Open ${format(parseISO(d.date), 'EEEE d MMMM')}`}
              >
                {format(parseISO(d.date), 'd')}
              </button>
              {d.closures.find((c) => c.allDay) && (
                <span className="truncate text-[10px] text-danger-foreground">
                  {d.closures.find((c) => c.allDay)!.title}
                </span>
              )}
              {items.slice(0, MAX).map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onOpen(a.id)}
                  className={cn(
                    'flex items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11px] hover:bg-accent focus-ring',
                    statusBlockClass(a.status),
                  )}
                >
                  <ColorDot color={a.therapyType.color} className="size-2" />
                  <span className="tabular text-muted-foreground">{fmt.clock(a.startTime)}</span>
                  <span className="truncate">{a.patient.fullName}</span>
                </button>
              ))}
              {items.length > MAX && (
                <button
                  type="button"
                  onClick={() => onDay(d.date)}
                  className="rounded px-1 text-left text-[11px] font-medium text-primary hover:underline focus-ring"
                >
                  +{items.length - MAX} more
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Legend({ withTherapist }: { withTherapist: boolean }) {
  const item = (className: string, label: string) => (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('size-3 rounded-sm', className)} aria-hidden />
      {label}
    </span>
  );
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {(Object.keys(APPOINTMENT_STATUSES) as AppointmentRecordStatus[]).map((s) =>
        item(cn('border border-border/60', BLOCK_TONE[s]), APPOINTMENT_STATUSES[s].label),
      )}
      {withTherapist &&
        item('border-l-2 border-l-primary/50 bg-primary-subtle/60', 'Therapist available')}
      {withTherapist && item('bg-warning-subtle', 'Time off')}
      {item('bg-danger-subtle', 'Center closure')}
      {item('bg-muted', 'Center not open')}
    </div>
  );
}

function CalendarView() {
  const { activeCenter, can } = useSession();
  const router = useRouter();
  const fmt = useCenterFormat();
  const scheduling = useSchedulingSettings();
  const isWide = useMediaQuery('(min-width: 768px)');
  const today = centerToday(activeCenter.timezone);
  const [state, set] = useCalendarState(today, isWide ? 'week' : 'day');
  const [openId, setOpenId] = React.useState<string | null>(null);
  const seesTeam = can('appointments.read') && can('therapists.read');
  const types = useTherapyTypeList({ status: 'all' });
  const therapists = useTherapistList(
    { status: 'all', pageSize: 100, sortBy: 'fullName' },
    seesTeam,
  );

  const anchor = parseISO(state.date);
  const range =
    state.view === 'day'
      ? { first: anchor, last: anchor }
      : state.view === 'week'
        ? (() => {
            const first = startOfWeek(anchor, { weekStartsOn: fmt.weekStartsOn });
            return { first, last: addDays(first, 6) };
          })()
        : {
            first: startOfWeek(startOfMonth(anchor), { weekStartsOn: fmt.weekStartsOn }),
            last: endOfWeek(endOfMonth(anchor), { weekStartsOn: fmt.weekStartsOn }),
          };
  const params: CalendarParams = {
    startDate: toIso(range.first),
    endDate: toIso(range.last),
    therapistId: state.therapistId === 'all' ? undefined : state.therapistId,
    therapyTypeId: state.therapyTypeId === 'all' ? undefined : state.therapyTypeId,
    type: state.type === 'all' ? undefined : state.type,
    status:
      state.status === 'all' ? undefined : state.status === 'active' ? ACTIVE : [state.status],
  };
  const { data, isPending, isFetching, error, refetch } = useAppointmentCalendar(params);
  const therapistFilter = params.therapistId;
  const schedule = useTherapistScheduleFor(
    state.view === 'month' ? undefined : therapistFilter,
    params.startDate,
    params.endDate,
  );

  const move = (dir: 1 | -1) => {
    const next =
      state.view === 'day'
        ? addDays(anchor, dir)
        : state.view === 'week'
          ? addDays(anchor, 7 * dir)
          : addMonths(anchor, dir);
    set({ date: toIso(next) });
  };
  const label =
    state.view === 'day'
      ? format(anchor, 'EEEE, d MMM yyyy')
      : state.view === 'week'
        ? `${format(range.first, 'd MMM')} – ${format(range.last, 'd MMM yyyy')}`
        : format(anchor, 'MMMM yyyy');

  const step = scheduling.data?.slotIntervalMinutes ?? 30;
  const onBook = can('appointments.create')
    ? (date: string, minutes: number) => {
        const m = Math.floor(minutes / step) * step;
        const time = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
        router.push(
          appointmentLinks.book({
            date,
            time,
            therapistId: therapistFilter,
            therapyTypeId: params.therapyTypeId,
          }),
        );
      }
    : null;

  return (
    <>
      <PageHeader
        title="Calendar"
        description="Appointments by day, week or month. Click a free time to book it."
        actions={
          <>
            <Button variant="secondary" asChild>
              <Link href={appointmentLinks.list}>
                <List /> List
              </Link>
            </Button>
            {can('appointments.create') && (
              <Button asChild>
                <Link
                  href={appointmentLinks.book({
                    date: state.date,
                    therapistId: therapistFilter,
                    therapyTypeId: params.therapyTypeId,
                  })}
                >
                  <CalendarPlus /> Book appointment
                </Link>
              </Button>
            )}
          </>
        }
      />
      <Card>
        <CardContent className="grid gap-4 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Previous ${state.view}`}
                  onClick={() => move(-1)}
                >
                  <ChevronLeft />
                </Button>
                <Button variant="secondary" size="sm" onClick={() => set({ date: today })}>
                  Today
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Next ${state.view}`}
                  onClick={() => move(1)}
                >
                  <ChevronRight />
                </Button>
              </div>
              <h2 className="text-card-title tabular" aria-live="polite">
                {label}
              </h2>
              {isFetching && <span className="sr-only">Loading</span>}
            </div>
            <Tabs value={state.view} onValueChange={(v) => set({ view: v as View })}>
              <SegmentedList aria-label="View">
                <SegmentedTrigger value="day">Day</SegmentedTrigger>
                <SegmentedTrigger value="week">Week</SegmentedTrigger>
                <SegmentedTrigger value="month">Month</SegmentedTrigger>
              </SegmentedList>
            </Tabs>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {seesTeam && (
              <Select
                value={state.therapistId}
                onValueChange={(therapistId) => set({ therapistId })}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full sm:w-48"
                  aria-label="Filter by therapist"
                >
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
            <Select
              value={state.therapyTypeId}
              onValueChange={(therapyTypeId) => set({ therapyTypeId })}
            >
              <SelectTrigger size="sm" className="w-full sm:w-44" aria-label="Filter by therapy">
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
            <Select value={state.type} onValueChange={(v) => set({ type: v as typeof state.type })}>
              <SelectTrigger size="sm" className="w-full sm:w-40" aria-label="Filter by type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any type</SelectItem>
                {Object.entries(APPOINTMENT_TYPES).map(([value, l]) => (
                  <SelectItem key={value} value={value}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={state.status} onValueChange={(v) => set({ status: v as StatusFilter })}>
              <SelectTrigger size="sm" className="w-full sm:w-44" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Hide cancelled</SelectItem>
                <SelectItem value="all">Any status</SelectItem>
                {Object.entries(APPOINTMENT_STATUSES).map(([value, s]) => (
                  <SelectItem key={value} value={value}>
                    {s.label} only
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isPending ? (
            <PageSkeleton />
          ) : error && !data ? (
            <ErrorState error={error} onRetry={() => void refetch()} />
          ) : (
            <div className={cn(isFetching && 'opacity-70 transition-opacity')}>
              {state.view === 'month' ? (
                <MonthGrid
                  cal={data}
                  month={anchor}
                  today={today}
                  onOpen={setOpenId}
                  onDay={(date) => set({ view: 'day', date })}
                />
              ) : (
                <TimeGrid
                  cal={data}
                  schedule={schedule}
                  showTherapist={!therapistFilter}
                  today={today}
                  onOpen={setOpenId}
                  onBook={onBook}
                />
              )}
              {!data.appointments.length && (
                <p className="pt-3 text-center text-[13px] text-muted-foreground">
                  No appointments in this {state.view}
                  {onBook && state.view !== 'month' ? ' · click a free time to book' : ''}.
                </p>
              )}
            </div>
          )}

          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <Legend withTherapist={Boolean(schedule)} />
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Globe className="mt-px size-3.5 shrink-0" aria-hidden />
              Times are in {data?.timezone ?? activeCenter.timezone}.
              {!therapistFilter &&
                seesTeam &&
                ' Choose a therapist to see their working hours and time off.'}
            </p>
          </div>
        </CardContent>
      </Card>
      <AppointmentSheet id={openId} onOpenChange={(o) => !o && setOpenId(null)} />
    </>
  );
}

/** A therapist's working windows and time off for the visible days, when one is chosen. */
function useTherapistScheduleFor(
  therapistId: string | undefined,
  startDate: string,
  endDate: string,
) {
  const query = useTherapistSchedule(
    therapistId ?? '',
    { startDate, endDate },
    Boolean(therapistId),
  );
  return therapistId && query.data?.therapist.id === therapistId ? query.data.days : undefined;
}

export function CalendarScreen() {
  return (
    <RequirePermission permission="appointments.read_own">
      <div className="animate-in">
        <CalendarView />
      </div>
    </RequirePermission>
  );
}
