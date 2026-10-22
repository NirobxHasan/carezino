'use client';

import * as React from 'react';
import Link from 'next/link';
import { addDays, format, parseISO, startOfWeek } from 'date-fns';
import { ChevronLeft, ChevronRight, Globe } from 'lucide-react';

import { ErrorState, PageSkeleton } from '@/components/feedback/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { SegmentedList, SegmentedTrigger, Tabs } from '@/components/ui/tabs';
import { useGeneralSettings } from '@/lib/api/settings';
import { useTherapistSchedule } from '@/lib/api/therapists';
import { formatCenterClock } from '@/lib/format';
import { useMediaQuery } from '@/lib/hooks/use-media-query';
import { useSession } from '@/lib/session';
import type { ScheduleDay, TimeDisplayFormat as TimeFormat, TimeInterval } from '@/lib/types';
import { cn } from '@/lib/utils';
import { TIME_OFF_REASONS } from './therapist-display';

type View = 'week' | 'day';
const HOUR_PX = 44;
const toIso = (d: Date) => format(d, 'yyyy-MM-dd');
const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
/** The API ends whole days at "24:00": midnight, or 24:00 on a 24-hour clock. */
const showClock = (t: string, timeFormat: TimeFormat) =>
  t === '24:00' && timeFormat === 'H24'
    ? t
    : formatCenterClock(t === '24:00' ? '00:00' : t, timeFormat);

/** Today's date where the center is, so "Today" is right whatever the browser's zone. */
function centerToday(timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Whole hours that fit everything shown, with 08:00–18:00 as the minimum span. */
function hourRange(days: ScheduleDay[]) {
  let start = 8 * 60;
  let end = 18 * 60;
  for (const day of days) {
    const parts: TimeInterval[] = [
      ...day.centerHours,
      ...day.regularHours,
      ...(day.appointments ?? []),
      ...day.timeOff.filter((t) => !t.isAllDay && !(t.start === '00:00' && t.end === '24:00')),
      ...day.closures.filter((c) => !c.allDay),
    ];
    for (const p of parts) {
      start = Math.min(start, toMinutes(p.start));
      end = Math.max(end, toMinutes(p.end));
    }
  }
  return { first: Math.floor(start / 60), last: Math.min(24, Math.ceil(end / 60)) };
}

function Block({
  interval,
  first,
  last,
  className,
  children,
  label,
}: {
  interval: TimeInterval;
  first: number;
  last: number;
  className: string;
  children?: React.ReactNode;
  label: string;
}) {
  const start = Math.max(toMinutes(interval.start), first * 60);
  const end = Math.min(toMinutes(interval.end), last * 60);
  if (end <= start) return null;
  return (
    <div
      className={cn(
        'absolute inset-x-1 overflow-hidden rounded-md text-[11px] leading-tight',
        className,
      )}
      style={{
        top: ((start - first * 60) / 60) * HOUR_PX,
        height: ((end - start) / 60) * HOUR_PX,
      }}
      title={label}
    >
      {children}
    </div>
  );
}

function DayColumn({
  day,
  first,
  last,
  timeFormat,
}: {
  day: ScheduleDay;
  first: number;
  last: number;
  timeFormat: TimeFormat;
}) {
  const clock = (t: string) => showClock(t, timeFormat);
  const range = (i: TimeInterval) => `${clock(i.start)}–${clock(i.end)}`;
  return (
    <div
      className="relative border-l border-border bg-muted/60"
      style={{ height: (last - first) * HOUR_PX }}
    >
      {/* Center opening hours: white; outside them the column stays grey. */}
      {day.centerHours.map((i) => (
        <Block
          key={`c${i.start}`}
          interval={i}
          first={first}
          last={last}
          className="inset-x-0 rounded-none bg-surface"
          label={`Center open ${range(i)}`}
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
      {day.regularHours.map((i) => (
        <Block
          key={`r${i.start}`}
          interval={i}
          first={first}
          last={last}
          className="border border-dashed border-primary/40"
          label={`Regular hours ${range(i)}`}
        />
      ))}
      {day.available.map((i) => (
        <Block
          key={`a${i.start}`}
          interval={i}
          first={first}
          last={last}
          className="border-l-[3px] border-l-primary bg-primary-subtle px-1.5 py-1 text-primary-subtle-foreground"
          label={`Available ${range(i)}`}
        >
          <span className="font-medium tabular">{range(i)}</span>
        </Block>
      ))}
      {day.closures.map((c) => (
        <Block
          key={`x${c.id}`}
          interval={c}
          first={first}
          last={last}
          className="border border-danger/30 bg-[repeating-linear-gradient(135deg,var(--color-danger-subtle)_0_6px,var(--color-surface)_6px_12px)] px-1.5 py-1 text-danger-foreground"
          label={`Center closed: ${c.title}`}
        >
          <span className="font-medium">{c.title}</span>
        </Block>
      ))}
      {day.timeOff.map((t) => (
        <Block
          key={`t${t.id}`}
          interval={t}
          first={first}
          last={last}
          className="border border-warning/40 bg-[repeating-linear-gradient(135deg,var(--color-warning-subtle)_0_6px,var(--color-surface)_6px_12px)] px-1.5 py-1 text-warning-foreground"
          label={`Time off${t.reason ? `: ${TIME_OFF_REASONS[t.reason]}` : ''} ${range(t)}`}
        >
          <span className="font-medium">{t.reason ? TIME_OFF_REASONS[t.reason] : 'Time off'}</span>
        </Block>
      ))}
      {day.appointments?.map((a) => {
        const start = Math.max(toMinutes(a.start), first * 60);
        const end = Math.min(toMinutes(a.end), last * 60);
        if (end <= start) return null;
        return (
          <Link
            key={`b${a.id}`}
            href={`/appointments/${a.id}`}
            className="absolute inset-x-1.5 overflow-hidden rounded-md border border-border/60 border-l-[3px] bg-surface px-1.5 py-0.5 text-[11px] leading-tight shadow-xs hover:shadow-md focus-ring"
            style={{
              top: ((start - first * 60) / 60) * HOUR_PX + 1,
              height: Math.max(((end - start) / 60) * HOUR_PX - 2, 14),
              borderLeftColor: a.therapyType.color ?? undefined,
            }}
            title={`${a.patient.fullName} · ${a.therapyType.name} · ${range(a)}`}
          >
            <span className="block truncate font-medium">{a.patient.fullName}</span>
            <span className="block truncate text-muted-foreground tabular">
              {a.therapyType.code} · {clock(a.start)}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

/** Screen-reader summary of a day, since the grid itself is visual. */
function describeDay(day: ScheduleDay, timeFormat: TimeFormat) {
  const clock = (t: string) => showClock(t, timeFormat);
  const parts = [
    day.available.length
      ? `Available ${day.available.map((i) => `${clock(i.start)} to ${clock(i.end)}`).join(', ')}`
      : 'Not available',
  ];
  if (day.closures.length)
    parts.push(`Center closed: ${day.closures.map((c) => c.title).join(', ')}`);
  if (day.timeOff.length) parts.push('Time off');
  if (day.appointments?.length) {
    parts.push(
      `${day.appointments.length} appointment${day.appointments.length === 1 ? '' : 's'}: ${day.appointments
        .map((a) => `${a.patient.fullName} at ${clock(a.start)}`)
        .join(', ')}`,
    );
  }
  return parts.join('. ');
}

function Legend() {
  const item = (className: string, label: string) => (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('size-3 rounded-sm', className)} aria-hidden />
      {label}
    </span>
  );
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {item('border border-border border-l-[3px] border-l-foreground/40 bg-surface', 'Appointment')}
      {item('border-l-[3px] border-l-primary bg-primary-subtle', 'Available')}
      {item('border border-dashed border-primary/50', 'Regular hours')}
      {item('border border-warning/40 bg-warning-subtle', 'Time off')}
      {item('border border-danger/30 bg-danger-subtle', 'Center closure')}
      {item('bg-muted', 'Center not open')}
    </div>
  );
}

/**
 * Week or day overview of when a therapist works: regular hours, time off, center hours
 * and closures, with their booked appointments, from GET /therapists/:id/schedule.
 * Booking itself happens in Appointments.
 */
export function ScheduleCalendar({
  therapistId,
  actions,
}: {
  therapistId: string;
  /** Quick actions shown in the toolbar, e.g. edit availability or add time off */
  actions?: React.ReactNode;
}) {
  const { activeCenter } = useSession();
  const general = useGeneralSettings();
  const weekStartsOn = (general.data?.weekStartsOn ?? 6) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
  const timeFormat = general.data?.timeFormat ?? 'H12';
  const isWide = useMediaQuery('(min-width: 768px)');
  const today = centerToday(activeCenter.timezone);
  const [anchor, setAnchor] = React.useState(today);
  const [chosenView, setView] = React.useState<View | null>(null);
  const view: View = chosenView ?? (isWide ? 'week' : 'day');

  const anchorDate = parseISO(anchor);
  const first = view === 'week' ? startOfWeek(anchorDate, { weekStartsOn }) : anchorDate;
  const range = {
    startDate: toIso(first),
    endDate: toIso(addDays(first, view === 'week' ? 6 : 0)),
  };
  const { data, isPending, isFetching, error, refetch } = useTherapistSchedule(therapistId, range);
  const step = view === 'week' ? 7 : 1;

  const label =
    view === 'week'
      ? `${format(first, 'd MMM')} – ${format(addDays(first, 6), 'd MMM yyyy')}`
      : format(anchorDate, 'EEEE, d MMM yyyy');

  if (isPending || general.isPending) return <PageSkeleton />;
  if (error && !data) {
    return (
      <Card>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </Card>
    );
  }
  const days = data.days;
  const hours = hourRange(days);

  return (
    <Card>
      <CardContent className="grid gap-4 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={view === 'week' ? 'Previous week' : 'Previous day'}
                onClick={() => setAnchor(toIso(addDays(anchorDate, -step)))}
              >
                <ChevronLeft />
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setAnchor(today)}>
                Today
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={view === 'week' ? 'Next week' : 'Next day'}
                onClick={() => setAnchor(toIso(addDays(anchorDate, step)))}
              >
                <ChevronRight />
              </Button>
            </div>
            <h3 className="text-card-title tabular" aria-live="polite">
              {label}
            </h3>
            {isFetching && <span className="sr-only">Loading</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {actions}
            <Tabs value={view} onValueChange={(v) => setView(v as View)}>
              <SegmentedList aria-label="View">
                <SegmentedTrigger value="week">Week</SegmentedTrigger>
                <SegmentedTrigger value="day">Day</SegmentedTrigger>
              </SegmentedList>
            </Tabs>
          </div>
        </div>

        {data.therapist.status === 'INACTIVE' && (
          <p className="rounded-lg bg-muted px-3 py-2 text-[13px] text-muted-foreground">
            This therapist is inactive, so they aren’t available for new bookings.
          </p>
        )}

        <div className={cn('overflow-x-auto', isFetching && 'opacity-70 transition-opacity')}>
          <div className={cn(view === 'week' && 'min-w-[44rem]')}>
            <div
              className="grid"
              style={{ gridTemplateColumns: `4.25rem repeat(${days.length}, minmax(0, 1fr))` }}
            >
              <div />
              {days.map((day) => {
                const closed = !day.centerHours.length;
                const isToday = day.date === today;
                return (
                  <div
                    key={day.date}
                    className="flex flex-col items-center gap-0.5 border-b border-border px-1 pb-2 text-center"
                  >
                    <span className="text-xs text-muted-foreground">
                      {format(parseISO(day.date), 'EEE')}
                    </span>
                    <span
                      className={cn(
                        'grid size-7 place-items-center rounded-full text-sm font-medium tabular',
                        isToday && 'bg-primary text-primary-foreground',
                      )}
                    >
                      {format(parseISO(day.date), 'd')}
                    </span>
                    {closed ? (
                      <Badge className="px-1.5 text-[10px]">Center closed</Badge>
                    ) : day.available.length === 0 ? (
                      <Badge className="px-1.5 text-[10px]">Unavailable</Badge>
                    ) : null}
                    <span className="sr-only">{describeDay(day, timeFormat)}</span>
                  </div>
                );
              })}
              <div className="relative" style={{ height: (hours.last - hours.first) * HOUR_PX }}>
                {Array.from({ length: hours.last - hours.first }, (_, h) => (
                  <span
                    key={h}
                    className="absolute right-2 -translate-y-1/2 text-[11px] whitespace-nowrap text-muted-foreground tabular first:translate-y-0"
                    style={{ top: h * HOUR_PX }}
                  >
                    {formatCenterClock(
                      `${String(hours.first + h).padStart(2, '0')}:00`,
                      timeFormat,
                    )}
                  </span>
                ))}
              </div>
              {days.map((day) => (
                <DayColumn
                  key={day.date}
                  day={day}
                  first={hours.first}
                  last={hours.last}
                  timeFormat={timeFormat}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <Legend />
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Globe className="mt-px size-3.5 shrink-0" aria-hidden />
            Times are in {data.timezone}. “Available” means working hours; booked appointments are
            shown on top.
            {!data.appointmentsIncluded && ' Appointments couldn’t be loaded.'}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
