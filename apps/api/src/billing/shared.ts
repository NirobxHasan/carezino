import { HttpStatus } from '@nestjs/common';

import type { TenantContext } from '../auth/auth-context';
import type { Permission } from '../auth/permissions';
import { apiError } from '../common/errors';
import {
  addDays,
  formatIsoDate,
  parseIsoDate,
  todayIn,
  zonedToInstant,
} from '../common/time';
import { Prisma } from '../generated/prisma/client';
import { fieldError } from '../patients/contacts';
import type { PrismaService } from '../prisma/prisma.service';
import { BILLING_LIMITS } from './rules';

export type Tx = Prisma.TransactionClient;
export type Db = Tx | PrismaService;
export const Decimal = Prisma.Decimal;
export type Decimal = Prisma.Decimal;

export const userSelect = { select: { id: true, fullName: true } } as const;
export const methodSelect = {
  select: { id: true, name: true, isActive: true },
} as const;
export const patientSelect = {
  select: {
    id: true,
    code: true,
    fullName: true,
    photoUrl: true,
    deletedAt: true,
    status: true,
  },
} as const;

export type PatientRow = Prisma.PatientGetPayload<typeof patientSelect>;

export function toPatient(p: PatientRow) {
  return {
    id: p.id,
    code: p.code,
    fullName: p.fullName,
    photoUrl: p.photoUrl,
    status: p.status,
    isDeleted: p.deletedAt !== null,
  };
}

/** NUMERIC(12, 2) as a fixed two-decimal string, e.g. "9000.00" */
export const money = (value: Prisma.Decimal) => value.toFixed(2);
export const iso = (date: Date | null) => (date ? formatIsoDate(date) : null);

export const can = (tenant: TenantContext, p: Permission) =>
  tenant.permissions.includes(p);

export const notFound = (what: string) =>
  apiError(HttpStatus.NOT_FOUND, `${what} not found`, 'NOT_FOUND');

export const conflict = (
  code: string,
  message: string,
  details?: Record<string, unknown>,
) => apiError(HttpStatus.CONFLICT, message, code, undefined, details);

export const changedMeanwhile = () =>
  conflict(
    'BILLING_CHANGED',
    'Someone else changed this just now. Refresh and try again.',
  );

/** The center billing works in: its time zone, currency, today and contact details. */
export async function billingCenter(db: Db, tenant: TenantContext) {
  const c = await db.center.findUniqueOrThrow({
    where: { id: tenant.centerId },
    select: {
      name: true,
      code: true,
      phone: true,
      email: true,
      address: true,
      district: true,
      logoUrl: true,
      website: true,
      timezone: true,
      currency: true,
    },
  });
  return { ...c, timeZone: c.timezone, today: todayIn(c.timezone) };
}

export type BillingCenter = Awaited<ReturnType<typeof billingCenter>>;

/** A center-local "YYYY-MM-DD" from a query or body, or a field error. */
export function parseDate(value: string, field: string) {
  const d = parseIsoDate(value);
  if (!d) throw fieldError(field, 'Choose a valid date', 'VALIDATION_FAILED');
  return d;
}

/**
 * A center-local date range → the instants [from 00:00, the day after `to` 00:00), for
 * filtering timestamps such as when payments were collected. Either end may be open.
 */
export function instantRange(
  from: string | undefined,
  to: string | undefined,
  timeZone: string,
) {
  const first = from ? parseDate(from, 'from') : null;
  const last = to ? parseDate(to, 'to') : null;
  if (first && last) {
    if (last < first) {
      throw fieldError(
        'to',
        'Choose an end date on or after the start',
        'VALIDATION_FAILED',
      );
    }
    if (last > addDays(first, BILLING_LIMITS.reportDays)) {
      throw fieldError(
        'to',
        'Choose a range of up to two years',
        'VALIDATION_FAILED',
      );
    }
  }
  return {
    from: first,
    to: last,
    instants:
      first || last
        ? {
            ...(first && { gte: zonedToInstant(first, 0, timeZone) }),
            ...(last && { lt: zonedToInstant(addDays(last, 1), 0, timeZone) }),
          }
        : undefined,
    dates:
      first || last
        ? { ...(first && { gte: first }), ...(last && { lte: last }) }
        : undefined,
  };
}

/** A payment, refund or expense time: not in the future, and not more than a year back. */
export function pastInstant(value: string | undefined, field: string) {
  const now = new Date();
  if (!value) return now;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) {
    throw fieldError(
      field,
      'Choose a valid date and time',
      'VALIDATION_FAILED',
    );
  }
  // A few minutes' grace for clocks that run ahead.
  if (at.getTime() > now.getTime() + 5 * 60_000) {
    throw fieldError(field, 'This can’t be in the future', 'VALIDATION_FAILED');
  }
  if (at < addDays(now, -BILLING_LIMITS.backdateDays)) {
    throw fieldError(
      field,
      'Choose a time within the last year',
      'VALIDATION_FAILED',
    );
  }
  return at;
}

/**
 * Locks rows of one of the center's tables, in ID order, until the transaction ends.
 * Billing always locks invoices before payments, each in ID order, so concurrent
 * writers queue rather than deadlock; the CHECKs on paid and allocated amounts are
 * the last line of defence.
 */
export async function lockRows(
  tx: Tx,
  table: 'Invoice' | 'Payment' | 'Expense',
  tenant: TenantContext,
  ids: string[],
) {
  if (!ids.length) return;
  const sorted = [...new Set(ids)].sort();
  await tx.$queryRawUnsafe(
    `SELECT id FROM "${table}" WHERE id = ANY($1::uuid[]) AND "centerId" = $2::uuid ORDER BY id FOR UPDATE`,
    sorted,
    tenant.centerId,
  );
}

function causeOf(error: unknown) {
  return (
    error as {
      meta?: {
        driverAdapterError?: { cause?: { code?: string; message?: string } };
      };
    }
  )?.meta?.driverAdapterError?.cause;
}

/** Whether a write was refused by a named CHECK constraint (check_violation). */
export function isCheckViolation(error: unknown, constraint: string) {
  const cause = causeOf(error);
  return (
    cause?.code === '23514' && Boolean(cause.message?.includes(constraint))
  );
}

/** Whether a write hit a unique constraint, optionally a named (e.g. partial) index. */
export function isUniqueViolation(error: unknown, index?: string) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== 'P2002') return false;
  return !index || JSON.stringify(error.meta ?? {}).includes(index);
}
