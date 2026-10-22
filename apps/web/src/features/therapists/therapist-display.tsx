import { CheckCircle2, CircleSlash, Star } from 'lucide-react';

import { StatusBadge } from '@/components/domain/status-badges';
import { ColorDot } from '@/components/forms/color-picker';
import { formatMinutes, WEEKDAYS } from '@/lib/settings-limits';
import type {
  EmploymentType,
  PersonGender,
  TherapistBookingIssue,
  TherapistListItem,
  TherapistProfileStatus,
  TherapistSpecialization,
  TimeOffReason,
} from '@/lib/types';
import { cn } from '@/lib/utils';

/** Labels for the API's controlled values; the API's enums are the source of truth. */
export const EMPLOYMENT_TYPES: Record<EmploymentType, string> = {
  FULL_TIME: 'Full-time',
  PART_TIME: 'Part-time',
  VISITING: 'Visiting',
  CONTRACTUAL: 'Contractual',
};

export const GENDERS: Record<PersonGender, string> = {
  MALE: 'Male',
  FEMALE: 'Female',
  OTHER: 'Other',
};

export const TIME_OFF_REASONS: Record<TimeOffReason, string> = {
  PERSONAL: 'Personal leave',
  SICK: 'Sick leave',
  TRAINING: 'Training',
  VACATION: 'Vacation',
  EMERGENCY: 'Emergency',
  SCHEDULE_CHANGE: 'Schedule change',
  OTHER: 'Other',
};

export const BOOKING_ISSUES: Record<TherapistBookingIssue, string> = {
  INACTIVE: 'The therapist is inactive.',
  NO_SPECIALIZATION: 'No active specialization: add the therapy types they provide.',
  NO_AVAILABILITY: 'No weekly availability: set the hours they work.',
};

export function TherapistStatusBadge({ status }: { status: TherapistProfileStatus }) {
  return (
    <StatusBadge
      def={
        status === 'ACTIVE'
          ? { label: 'Active', tone: 'success', icon: CheckCircle2 }
          : { label: 'Inactive', tone: 'neutral', icon: CircleSlash }
      }
    />
  );
}

/** Therapy type chips, primary first. Inactive types are shown struck through. */
export function SpecializationTags({
  specializations,
  full = false,
  className,
}: {
  specializations: TherapistSpecialization[];
  /** Full names instead of short codes */
  full?: boolean;
  className?: string;
}) {
  if (!specializations.length) {
    return <span className="text-[13px] text-subtle-foreground">None yet</span>;
  }
  return (
    <span className={cn('flex flex-wrap gap-x-3 gap-y-1', className)}>
      {specializations.map((s) => (
        <span
          key={s.therapyTypeId}
          className={cn(
            'inline-flex items-center gap-1.5 text-[13px] whitespace-nowrap',
            !s.isActive && 'text-muted-foreground line-through',
          )}
          title={`${s.name}${s.isPrimary ? ' (primary)' : ''}${s.isActive ? '' : ' (inactive)'}`}
        >
          <ColorDot color={s.color} />
          {full ? (
            s.name
          ) : (
            <>
              <span aria-hidden>{s.code}</span>
              <span className="sr-only">{s.name}</span>
            </>
          )}
          {s.isPrimary && (
            <>
              <Star className="size-3 fill-current text-warning" aria-hidden />
              <span className="sr-only">(primary)</span>
            </>
          )}
        </span>
      ))}
    </span>
  );
}

const SHORT_DAYS = WEEKDAYS.map((d) => d.slice(0, 3));

/** "Sat–Mon, Wed · 24 h/week" in the center's week order. */
export function describeAvailability(
  summary: TherapistListItem['availabilitySummary'],
  weekStartsOn = 6,
) {
  if (!summary.daysOfWeek.length) return null;
  const order = Array.from({ length: 7 }, (_, i) => (weekStartsOn + i) % 7);
  const set = new Set(summary.daysOfWeek);
  const runs: number[][] = [];
  for (const day of order) {
    if (!set.has(day)) continue;
    const last = runs.at(-1);
    const prev = last?.at(-1);
    if (last && prev !== undefined && order.indexOf(prev) === order.indexOf(day) - 1) {
      last.push(day);
    } else {
      runs.push([day]);
    }
  }
  const days = runs
    .map((run) =>
      run.length > 2
        ? `${SHORT_DAYS[run[0]]}–${SHORT_DAYS[run.at(-1)!]}`
        : run.map((d) => SHORT_DAYS[d]).join(', '),
    )
    .join(', ');
  return { days, hours: `${formatMinutes(summary.weeklyMinutes)}/week` };
}

export function AvailabilitySummary({
  summary,
  weekStartsOn,
}: {
  summary: TherapistListItem['availabilitySummary'];
  weekStartsOn?: number;
}) {
  const text = describeAvailability(summary, weekStartsOn);
  if (!text) return <span className="text-[13px] text-subtle-foreground">Not set</span>;
  return (
    <span className="flex flex-col text-[13px]">
      <span>{text.days}</span>
      <span className="text-xs text-muted-foreground tabular">{text.hours}</span>
    </span>
  );
}
