import { HttpStatus } from '@nestjs/common';

import type { TenantContext } from '../auth/auth-context';
import { apiError } from '../common/errors';
import { addDays, formatIsoDate } from '../common/time';
import type { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import {
  PACKAGE_LIMITS,
  balance,
  enrollmentStatus,
  type EnrollmentStatus,
  type EnrollmentFacts,
} from './rules';

export type Tx = Prisma.TransactionClient;
export type Db = Tx | PrismaService;

export const userSelect = { select: { id: true, fullName: true } } as const;
export const therapyTypeSelect = {
  select: { id: true, name: true, code: true, color: true, isActive: true },
} as const;

const can = (tenant: TenantContext, p: TenantContext['permissions'][number]) =>
  tenant.permissions.includes(p);

export const iso = (date: Date | null) => (date ? formatIsoDate(date) : null);
/** NUMERIC(12, 2) as a fixed two-decimal string, e.g. "9000.00" */
export const money = (value: Prisma.Decimal) => value.toFixed(2);

export const packageNotFound = () =>
  apiError(HttpStatus.NOT_FOUND, 'Package not found', 'NOT_FOUND');

export const enrollmentNotFound = () =>
  apiError(HttpStatus.NOT_FOUND, 'Package enrollment not found', 'NOT_FOUND');

// ── Catalog ─────────────────────────────────────────────────────────────────

export const packageSelect = {
  id: true,
  code: true,
  name: true,
  description: true,
  sessionCount: true,
  defaultDurationMinutes: true,
  price: true,
  validityValue: true,
  validityUnit: true,
  activationPolicy: true,
  usageLimitCount: true,
  usageLimitPeriod: true,
  coversAssessments: true,
  chargeNoShow: true,
  chargeLateCancellation: true,
  isActive: true,
  displayOrder: true,
  createdAt: true,
  updatedAt: true,
  therapyTypes: {
    select: { therapyType: therapyTypeSelect },
    orderBy: { therapyType: { displayOrder: 'asc' } },
  },
  _count: { select: { enrollments: true } },
} satisfies Prisma.TherapyPackageSelect;

export type PackageRow = Prisma.TherapyPackageGetPayload<{
  select: typeof packageSelect;
}>;

export function toPackage(tenant: TenantContext, row: PackageRow) {
  const { _count, therapyTypes, price, ...rest } = row;
  const used = _count.enrollments > 0;
  return {
    ...rest,
    price: money(price),
    therapyTypes: therapyTypes.map((t) => t.therapyType),
    usageLimit:
      row.usageLimitCount !== null && row.usageLimitPeriod !== null
        ? { count: row.usageLimitCount, period: row.usageLimitPeriod }
        : null,
    enrollmentCount: _count.enrollments,
    actions: {
      edit: can(tenant, 'packages.update'),
      activate: !row.isActive && can(tenant, 'packages.deactivate'),
      deactivate: row.isActive && can(tenant, 'packages.deactivate'),
      duplicate: can(tenant, 'packages.create'),
      // Packages anyone bought are kept for their history.
      delete: !used && can(tenant, 'packages.delete'),
      enroll: row.isActive && can(tenant, 'package_enrollments.create'),
    },
  };
}

// ── Enrollments ─────────────────────────────────────────────────────────────

/** What eligibility checks need, read under the enrollment's lock. */
export const factsSelect = {
  id: true,
  code: true,
  packageName: true,
  patientId: true,
  state: true,
  startDate: true,
  endDate: true,
  validityValue: true,
  validityUnit: true,
  activationPolicy: true,
  usageLimitCount: true,
  usageLimitPeriod: true,
  coversAssessments: true,
  chargeNoShow: true,
  chargeLateCancellation: true,
  totalSessions: true,
  consumedSessions: true,
  reservedSessions: true,
  therapyTypes: { select: { therapyTypeId: true } },
} satisfies Prisma.PackageEnrollmentSelect;

export type FactsRow = Prisma.PackageEnrollmentGetPayload<{
  select: typeof factsSelect;
}>;

export function toFacts(row: FactsRow): EnrollmentFacts {
  return {
    ...row,
    therapyTypeIds: row.therapyTypes.map((t) => t.therapyTypeId),
  };
}

export const enrollmentItemSelect = {
  id: true,
  code: true,
  state: true,
  packageId: true,
  packageName: true,
  packageCode: true,
  sessionCount: true,
  activationPolicy: true,
  startDate: true,
  endDate: true,
  currency: true,
  finalPrice: true,
  totalSessions: true,
  consumedSessions: true,
  reservedSessions: true,
  renewedFromId: true,
  cancelledAt: true,
  createdAt: true,
  patient: {
    select: {
      id: true,
      code: true,
      fullName: true,
      photoUrl: true,
      deletedAt: true,
    },
  },
  therapyTypes: {
    select: { therapyType: therapyTypeSelect },
    orderBy: { therapyType: { displayOrder: 'asc' } },
  },
  therapyPlan: { select: { id: true, code: true, status: true } },
} satisfies Prisma.PackageEnrollmentSelect;

export type EnrollmentItemRow = Prisma.PackageEnrollmentGetPayload<{
  select: typeof enrollmentItemSelect;
}>;

/** Session counts as the screens show them. */
export function sessionSummary(row: {
  sessionCount: number;
  totalSessions: number;
  consumedSessions: number;
  reservedSessions: number;
}) {
  return {
    purchased: row.sessionCount,
    /** Purchased plus credits minus manual debits */
    total: row.totalSessions,
    consumed: row.consumedSessions,
    reserved: row.reservedSessions,
    ...balance(row),
  };
}

function enrollmentActions(tenant: TenantContext, status: EnrollmentStatus) {
  const open = status !== 'CANCELLED';
  return {
    renew: can(tenant, 'package_enrollments.renew'),
    cancel: open && can(tenant, 'package_enrollments.cancel'),
    // Reversals are still allowed on cancelled enrollments; the service checks types.
    adjust: can(tenant, 'package_enrollments.adjust'),
  };
}

export function toEnrollmentItem(
  tenant: TenantContext,
  row: EnrollmentItemRow,
  today: Date,
) {
  const status = enrollmentStatus(row, today);
  return {
    id: row.id,
    code: row.code,
    status,
    patient: {
      id: row.patient.id,
      code: row.patient.code,
      fullName: row.patient.fullName,
      photoUrl: row.patient.photoUrl,
      isDeleted: row.patient.deletedAt !== null,
    },
    package: {
      id: row.packageId,
      name: row.packageName,
      code: row.packageCode,
    },
    therapyTypes: row.therapyTypes.map((t) => t.therapyType),
    therapyPlan: row.therapyPlan,
    activationPolicy: row.activationPolicy,
    startDate: iso(row.startDate),
    endDate: iso(row.endDate),
    /** Days from today to the last valid day; 0 on it, negative after */
    daysLeft:
      row.endDate === null
        ? null
        : Math.round((row.endDate.getTime() - today.getTime()) / 86_400_000),
    expiringSoon:
      status === 'ACTIVE' &&
      row.endDate !== null &&
      row.endDate <= addDays(today, PACKAGE_LIMITS.expiringSoonDays),
    sessions: sessionSummary(row),
    currency: row.currency,
    finalPrice: money(row.finalPrice),
    renewedFromId: row.renewedFromId,
    cancelledAt: row.cancelledAt,
    createdAt: row.createdAt,
    actions: enrollmentActions(tenant, status),
  };
}

/**
 * Locks an enrollment of the caller's center until the transaction ends and reads it.
 * Every change to its balance takes this lock first, so checks and writes can't
 * interleave; the balance CHECK in the migration is the last line of defence.
 */
export async function lockEnrollment(
  tx: Tx,
  tenant: TenantContext,
  id: string,
  notFound: () => Error = enrollmentNotFound,
) {
  await tx.$queryRaw`
    SELECT id FROM "PackageEnrollment"
    WHERE id = ${id}::uuid AND "centerId" = ${tenant.centerId}::uuid
    FOR UPDATE`;
  const row = await tx.packageEnrollment.findFirst({
    where: { id, centerId: tenant.centerId },
    select: factsSelect,
  });
  if (!row) throw notFound();
  return row;
}

/** Whether a write was refused by the balance CHECK (Postgres check_violation). */
export function isBalanceViolation(error: unknown) {
  const cause = (
    error as {
      meta?: {
        driverAdapterError?: { cause?: { code?: string; message?: string } };
      };
      cause?: { code?: string; message?: string };
    }
  )?.meta?.driverAdapterError?.cause;
  return (
    cause?.code === '23514' &&
    Boolean(cause.message?.includes('PackageEnrollment_balance_check'))
  );
}

export const noSessionsLeft = () =>
  apiError(
    HttpStatus.CONFLICT,
    'This package has no sessions left to book. Another booking may have just used the last one.',
    'PACKAGE_NO_SESSIONS',
  );
