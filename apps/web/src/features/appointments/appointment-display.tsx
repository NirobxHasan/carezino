'use client';

import * as React from 'react';
import { format, parseISO } from 'date-fns';
import {
  Ban,
  CalendarClock,
  CheckCircle2,
  CircleCheck,
  ClipboardCheck,
  Repeat,
  UserX,
  type LucideIcon,
} from 'lucide-react';

import { ColorDot } from '@/components/forms/color-picker';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { useGeneralSettings } from '@/lib/api/settings';
import { formatCenterClock, formatCenterDate } from '@/lib/format';
import { WEEKDAYS, weekOrder } from '@/lib/settings-limits';
import type {
  AppointmentItem,
  AppointmentRecordStatus,
  AppointmentType,
  CancellationReason,
  ClockTime,
  ISODate,
  SeriesRule,
} from '@/lib/types';
import { cn } from '@/lib/utils';

export const APPOINTMENT_TYPES: Record<AppointmentType, string> = {
  THERAPY_SESSION: 'Therapy session',
  ASSESSMENT: 'Assessment',
};

export const APPOINTMENT_STATUSES: Record<
  AppointmentRecordStatus,
  { label: string; tone: BadgeTone; icon: LucideIcon }
> = {
  SCHEDULED: { label: 'Scheduled', tone: 'info', icon: CalendarClock },
  CONFIRMED: { label: 'Confirmed', tone: 'primary', icon: CircleCheck },
  COMPLETED: { label: 'Completed', tone: 'success', icon: CheckCircle2 },
  CANCELLED: { label: 'Cancelled', tone: 'neutral', icon: Ban },
  NO_SHOW: { label: 'No-show', tone: 'warning', icon: UserX },
};

export const CANCELLATION_REASONS: Record<CancellationReason, string> = {
  PATIENT_REQUEST: 'Patient or guardian request',
  THERAPIST_UNAVAILABLE: 'Therapist unavailable',
  CENTER_CLOSURE: 'Center closure',
  PERSONAL_REASON: 'Personal reason',
  OTHER: 'Other',
};

export const appointmentLinks = {
  list: '/appointments',
  calendar: '/appointments/calendar',
  detail: (id: string) => `/appointments/${id}`,
  /** The booking form, prefilled with whatever is known */
  book: (prefill: Record<string, string | undefined> = {}) => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(prefill)) if (value) q.set(key, value);
    const s = q.toString();
    return s ? `/appointments/new?${s}` : '/appointments/new';
  },
};

/** Status with a label and icon: colour is never the only signal. */
export function AppointmentStatusBadge({
  status,
  className,
}: {
  status: AppointmentRecordStatus;
  className?: string;
}) {
  const def = APPOINTMENT_STATUSES[status];
  const Icon = def.icon;
  return (
    <Badge tone={def.tone} className={className}>
      <Icon aria-hidden />
      {def.label}
    </Badge>
  );
}

/** "Assessment" stands out; therapy sessions are the norm and stay quiet. */
export function AppointmentTypeLabel({
  type,
  quiet = false,
}: {
  type: AppointmentType;
  /** Show nothing for therapy sessions */
  quiet?: boolean;
}) {
  if (type === 'THERAPY_SESSION') {
    return quiet ? null : <span className="text-[13px]">Therapy session</span>;
  }
  return (
    <span className="inline-flex items-center gap-1 text-[13px] font-medium text-info-foreground">
      <ClipboardCheck className="size-3.5" aria-hidden /> Assessment
    </span>
  );
}

export function TherapyTypeChip({
  therapyType,
  full = false,
}: {
  therapyType: AppointmentItem['therapyType'];
  /** The name instead of the code */
  full?: boolean;
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-[13px]">
      <ColorDot color={therapyType.color} />
      <span className="truncate" title={therapyType.name}>
        {full ? therapyType.name : therapyType.code}
      </span>
    </span>
  );
}

export function RecurringMark() {
  return <Repeat className="size-3.5 shrink-0 text-subtle-foreground" aria-label="Recurring" />;
}

/** Today's date where the center is, so "today" is right whatever the browser's zone. */
export function centerToday(timeZone: string): ISODate {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Dates and times in the center's chosen formats (General settings). */
export function useCenterFormat() {
  const general = useGeneralSettings();
  const dateFormat = general.data?.dateFormat;
  const timeFormat = general.data?.timeFormat ?? 'H12';
  return React.useMemo(() => {
    const clock = (t: ClockTime) =>
      t === '24:00' && timeFormat === 'H24'
        ? t
        : formatCenterClock(t === '24:00' ? '00:00' : t, timeFormat);
    return {
      timeFormat,
      weekStartsOn: (general.data?.weekStartsOn ?? 6) as 0 | 1 | 2 | 3 | 4 | 5 | 6,
      date: (d: ISODate) => formatCenterDate(d, dateFormat),
      /** "Mon, 26 Oct" */
      shortDate: (d: ISODate) => format(parseISO(d), 'EEE, d MMM'),
      /** "Monday, 26 October 2026" */
      longDate: (d: ISODate) => format(parseISO(d), 'EEEE, d MMMM yyyy'),
      clock,
      range: (a: { startTime: ClockTime; endTime: ClockTime }) =>
        `${clock(a.startTime)} – ${clock(a.endTime)}`,
    };
  }, [dateFormat, timeFormat, general.data?.weekStartsOn]);
}

/** "Every 2 weeks on Sat, Mon, Wed · 12 sessions" */
export function describeRule(
  rule: Pick<SeriesRule, 'frequency' | 'interval' | 'daysOfWeek' | 'endType' | 'until' | 'count'>,
  weekStartsOn = 6,
  date: (d: ISODate) => string = (d) => d,
) {
  const unit = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month' }[rule.frequency];
  let text = rule.interval === 1 ? `Every ${unit}` : `Every ${rule.interval} ${unit}s`;
  if (rule.frequency === 'DAILY' && rule.interval === 1) text = 'Daily';
  if (rule.frequency === 'WEEKLY' && rule.daysOfWeek.length) {
    const days = weekOrder(weekStartsOn)
      .filter((d) => rule.daysOfWeek.includes(d))
      .map((d) => WEEKDAYS[d].slice(0, 3));
    text += ` on ${days.join(', ')}`;
  }
  if (rule.frequency === 'MONTHLY') text += ' on the same date';
  const end =
    rule.endType === 'COUNT'
      ? `${rule.count} session${rule.count === 1 ? '' : 's'}`
      : rule.until
        ? `until ${date(rule.until)}`
        : '';
  return end ? `${text} · ${end}` : text;
}

/** Cancelled and no-show bookings stay visible but recede, in calendars and lists. */
export function statusBlockClass(status: AppointmentRecordStatus) {
  return cn(
    status === 'CANCELLED' && 'opacity-60 line-through decoration-muted-foreground/60',
    status === 'NO_SHOW' && 'opacity-75',
  );
}
