'use client';

import * as React from 'react';
import {
  Ban,
  CalendarClock,
  CheckCircle2,
  CircleSlash,
  Hourglass,
  type LucideIcon,
} from 'lucide-react';

import { Badge, type BadgeTone } from '@/components/ui/badge';
import { useSession } from '@/lib/session';
import type {
  AppointmentPackage,
  EnrollmentSessions,
  EnrollmentStatus,
  Money,
  PackageActivationPolicy,
  PackageChargeReason,
  PackageDiscountType,
  PackageMovementType,
  PackagePeriodUnit,
  PackageReleaseReason,
} from '@/lib/types';
import { cn } from '@/lib/utils';

type StatusDef = { label: string; tone: BadgeTone; icon: LucideIcon };

export const ENROLLMENT_STATUSES: Record<EnrollmentStatus, StatusDef & { description: string }> = {
  ACTIVE: {
    label: 'Active',
    tone: 'success',
    icon: CheckCircle2,
    description: 'Valid today, with sessions left',
  },
  PENDING: {
    label: 'Not started',
    tone: 'info',
    icon: Hourglass,
    description: 'Starts on a later date or its first session',
  },
  EXHAUSTED: {
    label: 'Used up',
    tone: 'neutral',
    icon: CircleSlash,
    description: 'Every session has been used',
  },
  EXPIRED: {
    label: 'Expired',
    tone: 'warning',
    icon: CalendarClock,
    description: 'Its validity has ended',
  },
  CANCELLED: {
    label: 'Cancelled',
    tone: 'neutral',
    icon: Ban,
    description: 'Cancelled by staff',
  },
};

export function EnrollmentStatusBadge({ status }: { status: EnrollmentStatus }) {
  const s = ENROLLMENT_STATUSES[status];
  const Icon = s.icon;
  return (
    <Badge tone={s.tone}>
      <Icon aria-hidden /> {s.label}
    </Badge>
  );
}

export function PackageActiveBadge({ isActive }: { isActive: boolean }) {
  return isActive ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>;
}

/** Formats instants ("12 Nov 2026, 10:30") in the center's time zone. */
export function useInstant() {
  const { activeCenter } = useSession();
  return React.useMemo(() => {
    const f = new Intl.DateTimeFormat('en-GB', {
      timeZone: activeCenter.timezone,
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    return (iso: string) => f.format(new Date(iso));
  }, [activeCenter.timezone]);
}

export const packageLinks = {
  list: '/packages',
  create: '/packages/new',
  edit: (id: string) => `/packages/${encodeURIComponent(id)}`,
  enrollments: '/packages/enrollments',
  enrollment: (id: string) => `/packages/enrollments/${encodeURIComponent(id)}`,
  /** The enrollment form, prefilled with whatever is known; `renew` is an enrollment ID */
  enroll: (prefill: { patientId?: string; packageId?: string; renew?: string } = {}) => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(prefill)) if (value) q.set(key, value);
    const s = q.toString();
    return s ? `/packages/enrollments/new?${s}` : '/packages/enrollments/new';
  },
};

export const PERIOD_UNITS: Record<PackagePeriodUnit, { one: string; many: string; per: string }> = {
  DAY: { one: 'day', many: 'days', per: 'day' },
  WEEK: { one: 'week', many: 'weeks', per: 'week' },
  MONTH: { one: 'month', many: 'months', per: 'month' },
};

/** "30 days", "1 month" */
export function validityText(value: number, unit: PackagePeriodUnit) {
  return `${value} ${value === 1 ? PERIOD_UNITS[unit].one : PERIOD_UNITS[unit].many}`;
}

/** "Up to 3 sessions per week" */
export function usageLimitText(limit: { count: number; period: PackagePeriodUnit } | null) {
  if (!limit) return null;
  return `Up to ${limit.count} session${limit.count === 1 ? '' : 's'} per ${PERIOD_UNITS[limit.period].per}`;
}

export const ACTIVATION_POLICIES: Record<
  PackageActivationPolicy,
  { label: string; description: string }
> = {
  ENROLLMENT_DATE: { label: 'On enrollment', description: 'Valid from the day it’s bought' },
  FIXED_DATE: { label: 'On a chosen date', description: 'Valid from a date you pick' },
  FIRST_SESSION: {
    label: 'On the first session',
    description: 'Valid from the day of its first charged session',
  },
};

export const DISCOUNT_TYPES: Record<PackageDiscountType, string> = {
  NONE: 'No discount',
  FIXED: 'Amount off',
  PERCENTAGE: 'Percentage off',
  PRICE_OVERRIDE: 'Agreed price',
};

export const MOVEMENTS: Record<
  PackageMovementType | 'SESSION_RESERVED' | 'RESERVATION_RELEASED',
  string
> = {
  INITIAL_ALLOCATION: 'Sessions purchased',
  BONUS_CREDIT: 'Bonus sessions',
  MANUAL_CREDIT: 'Sessions credited',
  MANUAL_DEBIT: 'Sessions debited',
  SESSION_CONSUMPTION: 'Session used',
  CONSUMPTION_REVERSAL: 'Charge reversed',
  SESSION_RESERVED: 'Session reserved',
  RESERVATION_RELEASED: 'Reservation released',
};

export const CHARGE_REASONS: Record<PackageChargeReason, string> = {
  COMPLETED: 'Completed session',
  NO_SHOW: 'No-show',
  LATE_CANCELLATION: 'Late cancellation',
};

export const RELEASE_REASONS: Record<PackageReleaseReason, string> = {
  APPOINTMENT_CANCELLED: 'Appointment cancelled',
  NO_SHOW_NOT_CHARGED: 'No-show, not charged',
  REMOVED: 'Package taken off the appointment',
  ENROLLMENT_CANCELLED: 'Enrollment cancelled',
};

export const COVERAGE: Record<AppointmentPackage['coverage'], { label: string; tone: BadgeTone }> =
  {
    HELD: { label: 'Session reserved', tone: 'info' },
    CHARGED: { label: 'Session used', tone: 'success' },
    REVERSED: { label: 'Charge reversed', tone: 'neutral' },
    RELEASED: { label: 'Not charged', tone: 'neutral' },
  };

// ── Money ───────────────────────────────────────────────────────────────────
// Amounts are exact decimal strings from the API. Arithmetic for previews is done in
// whole paisa (BigInt), never in floating point; the API recalculates on save.

const grouping = new Intl.NumberFormat('en-IN');

/** "9000.00" → "৳9,000"; "7500.50" → "৳7,500.50" */
export function formatMoney(value: Money, currency = 'BDT') {
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace('-', '').split('.');
  const cents = fraction.padEnd(2, '0').slice(0, 2);
  const symbol = currency === 'BDT' ? '৳' : `${currency} `;
  const text = `${grouping.format(BigInt(whole || '0'))}${cents !== '00' ? `.${cents}` : ''}`;
  return `${negative ? '-' : ''}${symbol}${text}`;
}

const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
// BigInt(…) rather than literals: the app targets ES2017.
const [ZERO, TWO, HUNDRED, HUNDRED_PERCENT] = [0, 2, 100, 10000].map((n) => BigInt(n));

/** "9,000.5" → 900050n paisa, or null if it isn't an amount */
export function toPaisa(input: string): bigint | null {
  const v = input.trim().replace(/,/g, '');
  if (!MONEY.test(v)) return null;
  const [whole, fraction = ''] = v.split('.');
  return BigInt(whole) * HUNDRED + BigInt(fraction.padEnd(2, '0'));
}

export function fromPaisa(paisa: bigint): Money {
  const sign = paisa < ZERO ? '-' : '';
  const abs = paisa < ZERO ? -paisa : paisa;
  return `${sign}${abs / HUNDRED}.${String(abs % HUNDRED).padStart(2, '0')}`;
}

/** The agreed price a discount gives, as the API computes it (percentages round half up). */
export function previewPrice(
  catalog: Money,
  type: PackageDiscountType,
  value: string,
  agreed: string,
): { finalPrice: Money; error?: string } | null {
  const price = toPaisa(catalog);
  if (price === null) return null;
  if (type === 'NONE') return { finalPrice: catalog };
  if (type === 'PRICE_OVERRIDE') {
    const p = toPaisa(agreed);
    return p === null
      ? { finalPrice: catalog, error: 'Enter the agreed price' }
      : { finalPrice: fromPaisa(p) };
  }
  const v = toPaisa(value);
  if (v === null || v <= ZERO) return { finalPrice: catalog, error: 'Enter the discount' };
  if (type === 'FIXED') {
    return v > price
      ? { finalPrice: catalog, error: 'The discount can’t be more than the price' }
      : { finalPrice: fromPaisa(price - v) };
  }
  // v is the percentage in hundredths (12.5% → 1250).
  if (v > HUNDRED_PERCENT) return { finalPrice: catalog, error: 'Enter up to 100%' };
  const off = (price * v * TWO + HUNDRED_PERCENT) / (HUNDRED_PERCENT * TWO);
  return { finalPrice: fromPaisa(price - off) };
}

// ── Sessions ────────────────────────────────────────────────────────────────

/** "7 of 12 left", with a thin bar of what's used and reserved. */
export function SessionMeter({
  sessions,
  className,
}: {
  sessions: EnrollmentSessions;
  className?: string;
}) {
  const total = Math.max(sessions.total, 1);
  const used = Math.min(100, (sessions.consumed / total) * 100);
  const held = Math.min(100 - used, (sessions.reserved / total) * 100);
  return (
    <span className={cn('flex min-w-28 flex-col gap-1', className)}>
      <span className="text-[13px] tabular">
        <span className="font-medium">{sessions.remaining}</span>
        <span className="text-muted-foreground"> of {sessions.total} left</span>
      </span>
      <span
        className="flex h-1.5 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`${sessions.consumed} used, ${sessions.reserved} reserved, ${sessions.availableToBook} free to book`}
      >
        <span className="bg-primary" style={{ width: `${used}%` }} />
        <span className="bg-primary/35" style={{ width: `${held}%` }} />
      </span>
    </span>
  );
}
