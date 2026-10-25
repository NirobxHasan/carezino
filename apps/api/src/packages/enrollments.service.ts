import { HttpStatus, Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import type { TenantContext } from '../auth/auth-context';
import { SettingsService } from '../center-settings/settings.service';
import { isUniqueViolation } from '../centers/centers.service';
import { apiError } from '../common/errors';
import { nextSequenceValue } from '../common/sequences';
import {
  addDays,
  formatClock,
  formatIsoDate,
  instantToZoned,
  parseIsoDate,
  todayIn,
} from '../common/time';
import { Prisma } from '../generated/prisma/client';
import {
  AppointmentType,
  PackageActivationPolicy,
  PackageDiscountType,
  PackageEnrollmentState,
  PackageLedgerMovement,
  PackageReleaseReason,
  PackageReservationStatus,
  PatientStatus,
  TherapyPlanStatus,
} from '../generated/prisma/enums';
import {
  assertCan,
  patientNotFound,
  visiblePatients,
} from '../patients/access';
import { fieldError } from '../patients/contacts';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AdjustEnrollmentDto,
  CancelEnrollmentDto,
  CreateEnrollmentDto,
  EnrollmentOptionsQuery,
  ListEnrollmentsQuery,
  RenewEnrollmentDto,
} from './dto';
import {
  PACKAGE_LIMITS,
  priceAfterDiscount,
  validityEnd,
  type EnrollmentStatus,
} from './rules';
import { PackageSessions, problemMessage } from './sessions.service';
import {
  enrollmentItemSelect,
  enrollmentNotFound,
  factsSelect,
  iso,
  lockEnrollment,
  money,
  sessionSummary,
  toEnrollmentItem,
  userSelect,
} from './shared';

const CODE_PREFIX = 'PE-';

/** Eligibility facts besides therapy types, which the item select already has. */
const factsFields = Object.fromEntries(
  Object.entries(factsSelect).filter(([key]) => key !== 'therapyTypes'),
) as Omit<typeof factsSelect, 'therapyTypes'>;

const detailSelect = {
  ...enrollmentItemSelect,
  packageSnapshot: true,
  defaultDurationMinutes: true,
  validityValue: true,
  validityUnit: true,
  usageLimitCount: true,
  usageLimitPeriod: true,
  coversAssessments: true,
  chargeNoShow: true,
  chargeLateCancellation: true,
  catalogPrice: true,
  discountType: true,
  discountValue: true,
  customEndDate: true,
  activatedAt: true,
  notes: true,
  cancellationReason: true,
  cancelledBy: userSelect,
  createdBy: userSelect,
  updatedAt: true,
  package: { select: { id: true, code: true, name: true, isActive: true } },
  renewedFrom: {
    select: { id: true, code: true, startDate: true, endDate: true },
  },
  renewals: {
    select: { id: true, code: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  },
  therapyPlan: {
    select: { id: true, code: true, title: true, status: true },
  },
} satisfies Prisma.PackageEnrollmentSelect;

const appointmentSelect = {
  select: {
    id: true,
    startAt: true,
    status: true,
    type: true,
    therapist: { select: { id: true, fullName: true } },
    therapyType: { select: { id: true, name: true, code: true, color: true } },
  },
} as const;

type AppointmentRow = Prisma.AppointmentGetPayload<typeof appointmentSelect>;

/** Terms of a purchase, with the patient and package already decided. */
type Purchase = Omit<CreateEnrollmentDto, 'patientId' | 'packageId'>;

const already = (code: string, message: string) =>
  apiError(HttpStatus.CONFLICT, message, code);

/**
 * Patients' package enrollments: buying (and buying again), the balance and its
 * history, cancelling and manual adjustments. An enrollment's agreed price is recorded
 * for billing, never treated as paid; sessions are only ever used through appointments
 * (PackageSessions) or adjustments here, each leaving a ledger entry.
 */
@Injectable()
export class EnrollmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly sessions: PackageSessions,
  ) {}

  /** The center's time zone, currency, week start and today's date there. */
  async center(tenant: TenantContext) {
    const center = await this.prisma.center.findUniqueOrThrow({
      where: { id: tenant.centerId },
      select: { timezone: true, currency: true },
    });
    const general = await this.settings.getGeneral(tenant);
    return {
      timeZone: center.timezone,
      currency: center.currency,
      weekStartsOn: general.weekStartsOn,
      today: todayIn(center.timezone),
    };
  }

  // ── Reading ───────────────────────────────────────────────────────────────

  /** Enrollments in a derived status, as a query on dates and balances. */
  private statusWhere(
    status: EnrollmentStatus,
    today: Date,
  ): Prisma.PackageEnrollmentWhereInput {
    const f = this.prisma.packageEnrollment.fields;
    const open = { state: { not: PackageEnrollmentState.CANCELLED } };
    const left = { consumedSessions: { lt: f.totalSessions } };
    switch (status) {
      case 'CANCELLED':
        return { state: PackageEnrollmentState.CANCELLED };
      case 'EXHAUSTED':
        return { AND: [open, { consumedSessions: { gte: f.totalSessions } }] };
      case 'PENDING':
        return {
          AND: [
            open,
            left,
            { OR: [{ startDate: null }, { startDate: { gt: today } }] },
          ],
        };
      case 'EXPIRED':
        return { AND: [open, left, { endDate: { lt: today } }] };
      case 'ACTIVE':
        return {
          AND: [
            open,
            left,
            { startDate: { lte: today } },
            { endDate: { gte: today } },
          ],
        };
    }
  }

  async list(tenant: TenantContext, query: ListEnrollmentsQuery) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const { today } = await this.center(tenant);
    const date = (v: string | undefined, field: string) => {
      if (!v) return null;
      const d = parseIsoDate(v);
      if (!d)
        throw fieldError(field, 'Choose a valid date', 'VALIDATION_FAILED');
      return d;
    };
    const range = (from: Date | null, to: Date | null) =>
      from || to
        ? { ...(from && { gte: from }), ...(to && { lte: to }) }
        : undefined;
    const startDate = range(
      date(query.startFrom, 'startFrom'),
      date(query.startTo, 'startTo'),
    );
    const endDate = range(
      date(query.endFrom, 'endFrom'),
      date(query.endTo, 'endTo'),
    );
    const search = query.search;
    // "+880 1712-…" should find 01712…, which is how BD mobiles are stored.
    const digits = search
      ?.replace(/[\s\-().]/g, '')
      .replace(/^\+?88(?=01)/, '');
    const phoneLike = digits !== undefined && /^\+?\d{3,}$/.test(digits);
    const where: Prisma.PackageEnrollmentWhereInput = {
      AND: [
        { centerId: tenant.centerId },
        {
          ...(query.patientId && { patientId: query.patientId }),
          ...(query.packageId && { packageId: query.packageId }),
          ...(query.therapyTypeId && {
            therapyTypes: { some: { therapyTypeId: query.therapyTypeId } },
          }),
          ...(startDate && { startDate }),
          ...(endDate && { endDate }),
        },
        query.status?.length
          ? { OR: query.status.map((s) => this.statusWhere(s, today)) }
          : {},
        query.expiringSoon
          ? {
              AND: [
                this.statusWhere('ACTIVE', today),
                {
                  endDate: {
                    lte: addDays(today, PACKAGE_LIMITS.expiringSoonDays),
                  },
                },
              ],
            }
          : {},
        search
          ? {
              OR: [
                { code: { contains: search, mode: 'insensitive' } },
                { packageName: { contains: search, mode: 'insensitive' } },
                { packageCode: { contains: search, mode: 'insensitive' } },
                {
                  patient: {
                    fullName: { contains: search, mode: 'insensitive' },
                  },
                },
                {
                  patient: { code: { contains: search, mode: 'insensitive' } },
                },
                ...(phoneLike
                  ? [
                      { patient: { mobile: { contains: digits } } },
                      {
                        patient: {
                          guardians: {
                            some: {
                              guardian: {
                                OR: [
                                  { mobile: { contains: digits } },
                                  { secondaryMobile: { contains: digits } },
                                ],
                              },
                            },
                          },
                        },
                      },
                    ]
                  : []),
              ],
            }
          : {},
      ],
    };
    const sortBy = query.sortBy ?? 'createdAt';
    const order = query.sortOrder ?? (sortBy === 'createdAt' ? 'desc' : 'asc');
    const orderBy: Prisma.PackageEnrollmentOrderByWithRelationInput[] =
      sortBy === 'endDate'
        ? [{ endDate: { sort: order, nulls: 'last' } }]
        : sortBy === 'patientName'
          ? [{ patient: { fullName: order } }]
          : [{ createdAt: order }];
    const [total, rows] = await Promise.all([
      this.prisma.packageEnrollment.count({ where }),
      this.prisma.packageEnrollment.findMany({
        where,
        select: enrollmentItemSelect,
        orderBy: [...orderBy, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      items: rows.map((r) => toEnrollmentItem(tenant, r, today)),
      total,
      page,
      pageSize,
    };
  }

  /** One patient's enrollments, newest first. */
  async patientEnrollments(tenant: TenantContext, patientId: string) {
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, ...visiblePatients(tenant) },
      select: { id: true, code: true, fullName: true },
    });
    if (!patient) throw patientNotFound();
    const { today } = await this.center(tenant);
    const rows = await this.prisma.packageEnrollment.findMany({
      where: { centerId: tenant.centerId, patientId },
      select: enrollmentItemSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
    return {
      patient,
      items: rows.map((r) => toEnrollmentItem(tenant, r, today)),
    };
  }

  private local(a: AppointmentRow, timeZone: string) {
    const start = instantToZoned(a.startAt, timeZone);
    return {
      id: a.id,
      status: a.status,
      type: a.type,
      date: formatIsoDate(start.date),
      startTime: formatClock(start.minutes),
      therapist: a.therapist,
      therapyType: a.therapyType,
    };
  }

  async get(tenant: TenantContext, id: string) {
    const row = await this.prisma.packageEnrollment.findFirst({
      where: { id, centerId: tenant.centerId },
      select: detailSelect,
    });
    if (!row) throw enrollmentNotFound();
    const { today, timeZone } = await this.center(tenant);
    const [sums, held] = await Promise.all([
      this.prisma.packageSessionLedger.groupBy({
        by: ['movement'],
        where: { enrollmentId: id },
        _sum: { quantity: true },
        _count: true,
      }),
      this.prisma.packageSessionReservation.findMany({
        where: { enrollmentId: id, status: PackageReservationStatus.ACTIVE },
        select: { id: true, sessionDate: true, appointment: appointmentSelect },
        orderBy: { sessionDate: 'asc' },
      }),
    ]);
    const sum = (m: PackageLedgerMovement) =>
      sums.find((s) => s.movement === m)?._sum.quantity ?? 0;
    const item = toEnrollmentItem(tenant, row, today);
    const discountAmount = row.catalogPrice.minus(row.finalPrice);
    return {
      ...item,
      sessions: {
        ...sessionSummary(row),
        /** Bonus and manual credits */
        additionalCredits:
          sum(PackageLedgerMovement.BONUS_CREDIT) +
          sum(PackageLedgerMovement.MANUAL_CREDIT),
        /** Manual debits, as a positive number */
        manualDebits: -sum(PackageLedgerMovement.MANUAL_DEBIT),
        /** Charged sessions that were later reversed */
        reversed: sum(PackageLedgerMovement.CONSUMPTION_REVERSAL),
      },
      terms: {
        sessionCount: row.sessionCount,
        defaultDurationMinutes: row.defaultDurationMinutes,
        validity: { value: row.validityValue, unit: row.validityUnit },
        usageLimit:
          row.usageLimitCount !== null && row.usageLimitPeriod !== null
            ? { count: row.usageLimitCount, period: row.usageLimitPeriod }
            : null,
        coversAssessments: row.coversAssessments,
        chargeNoShow: row.chargeNoShow,
        chargeLateCancellation: row.chargeLateCancellation,
      },
      pricing: {
        currency: row.currency,
        catalogPrice: money(row.catalogPrice),
        discountType: row.discountType,
        discountValue: row.discountValue && money(row.discountValue),
        /** Catalog price minus the agreed price; negative when it was set higher */
        discountAmount: money(discountAmount),
        finalPrice: money(row.finalPrice),
      },
      packageSnapshot: row.packageSnapshot,
      catalogPackage: row.package,
      customEndDate: row.customEndDate,
      activatedAt: row.activatedAt,
      notes: row.notes,
      cancellationReason: row.cancellationReason,
      cancelledBy: row.cancelledBy,
      createdBy: row.createdBy,
      updatedAt: row.updatedAt,
      therapyPlan: row.therapyPlan,
      renewedFrom: row.renewedFrom && {
        id: row.renewedFrom.id,
        code: row.renewedFrom.code,
        startDate: iso(row.renewedFrom.startDate),
        endDate: iso(row.renewedFrom.endDate),
      },
      renewals: row.renewals,
      /** Booked sessions holding one of its sessions, earliest first */
      upcoming: held.map((r) => this.local(r.appointment, timeZone)),
    };
  }

  /**
   * Everything that happened to the balance, oldest first: ledger movements (the
   * allocation, credits, debits, consumptions, reversals) and reservations made and
   * released. A reservation that was charged appears as its consumption.
   */
  async ledger(tenant: TenantContext, id: string) {
    const exists = await this.prisma.packageEnrollment.findFirst({
      where: { id, centerId: tenant.centerId },
      select: { id: true },
    });
    if (!exists) throw enrollmentNotFound();
    const { timeZone } = await this.center(tenant);
    const [movements, reservations] = await Promise.all([
      this.prisma.packageSessionLedger.findMany({
        where: { enrollmentId: id },
        select: {
          id: true,
          movement: true,
          quantity: true,
          chargeReason: true,
          reason: true,
          reversesId: true,
          createdAt: true,
          createdBy: userSelect,
          appointment: appointmentSelect,
          reversedBy: { select: { id: true } },
        },
      }),
      this.prisma.packageSessionReservation.findMany({
        where: { enrollmentId: id },
        select: {
          id: true,
          status: true,
          sessionDate: true,
          createdAt: true,
          createdBy: userSelect,
          releasedAt: true,
          releasedBy: userSelect,
          releaseReason: true,
          appointment: appointmentSelect,
        },
      }),
    ]);
    const appointment = (a: AppointmentRow | null) =>
      a ? this.local(a, timeZone) : null;
    const items = [
      ...movements.map((m) => ({
        id: m.id,
        type: m.movement,
        quantity: m.quantity,
        at: m.createdAt,
        by: m.createdBy,
        reason: m.reason,
        chargeReason: m.chargeReason,
        releaseReason: null,
        reversesId: m.reversesId,
        /** A consumption that has since been reversed */
        reversed: m.reversedBy !== null,
        appointment: appointment(m.appointment),
      })),
      ...reservations.map((r) => ({
        id: `${r.id}:reserved`,
        type: 'SESSION_RESERVED' as const,
        quantity: 0,
        at: r.createdAt,
        by: r.createdBy,
        reason: null,
        chargeReason: null,
        releaseReason: null,
        reversesId: null,
        reversed: false,
        appointment: appointment(r.appointment),
      })),
      ...reservations
        .filter((r) => r.status === PackageReservationStatus.RELEASED)
        .map((r) => ({
          id: `${r.id}:released`,
          type: 'RESERVATION_RELEASED' as const,
          quantity: 0,
          at: r.releasedAt!,
          by: r.releasedBy,
          reason: null,
          chargeReason: null,
          releaseReason: r.releaseReason,
          reversesId: null,
          reversed: false,
          appointment: appointment(r.appointment),
        })),
    ].sort((a, b) => a.at.getTime() - b.at.getTime());
    return { items };
  }

  /**
   * A patient's packages that could pay for a session, each with whether it can and
   * why not, judged by the same rules as booking. Without a therapy only the balances
   * are shown. Cancelled, expired and used-up ones are left out, except the one the
   * appointment already uses.
   */
  async options(tenant: TenantContext, query: EnrollmentOptionsQuery) {
    const patient = await this.prisma.patient.findFirst({
      where: { id: query.patientId, ...visiblePatients(tenant) },
      select: { id: true },
    });
    if (!patient) throw patientNotFound();
    const { today, weekStartsOn } = await this.center(tenant);
    const date = query.date ? parseIsoDate(query.date) : today;
    if (!date)
      throw fieldError('date', 'Choose a valid date', 'VALIDATION_FAILED');
    const current = query.appointmentId
      ? await this.prisma.appointment.findFirst({
          where: {
            id: query.appointmentId,
            centerId: tenant.centerId,
            patientId: query.patientId,
          },
          select: {
            packageEnrollmentId: true,
            packageReservations: {
              where: { status: PackageReservationStatus.ACTIVE },
              select: { enrollmentId: true },
            },
          },
        })
      : null;
    const holding = current?.packageReservations[0]?.enrollmentId;
    const rows = await this.prisma.packageEnrollment.findMany({
      where: {
        centerId: tenant.centerId,
        patientId: query.patientId,
        state: { not: PackageEnrollmentState.CANCELLED },
        OR: [{ endDate: null }, { endDate: { gte: date } }],
      },
      select: { ...factsFields, ...enrollmentItemSelect },
      orderBy: [
        { endDate: { sort: 'asc', nulls: 'last' } },
        { createdAt: 'asc' },
      ],
    });
    const items = [];
    for (const row of rows) {
      const facts = {
        ...row,
        therapyTypeIds: row.therapyTypes.map((t) => t.therapyType.id),
      };
      const mine = row.id === holding;
      const item = toEnrollmentItem(tenant, row, today);
      if (!mine && item.sessions.remaining <= 0) continue;
      let problems: { reason: string; message: string }[] = [];
      if (query.therapyTypeId) {
        const usage = await this.prisma.packageSessionReservation.findMany({
          where: {
            enrollmentId: row.id,
            status: {
              in: [
                PackageReservationStatus.ACTIVE,
                PackageReservationStatus.CONSUMED,
              ],
            },
            ...(query.appointmentId && {
              appointmentId: { not: query.appointmentId },
            }),
          },
          select: { sessionDate: true, status: true },
        });
        const [result] = this.sessions.evaluate(
          facts,
          [
            {
              session: {
                patientId: query.patientId,
                therapyTypeId: query.therapyTypeId,
                type: query.type ?? AppointmentType.THERAPY_SESSION,
              },
              date,
            },
          ],
          {
            held: usage
              .filter((u) => u.status === PackageReservationStatus.ACTIVE)
              .map((u) => u.sessionDate),
            used: usage.map((u) => u.sessionDate),
          },
          { weekStartsOn, needsSession: !mine },
        );
        problems = result.problems.map((reason) => ({
          reason,
          message: problemMessage(reason, { ...facts, ...row }, result.dates),
        }));
      }
      items.push({
        ...item,
        eligible: !problems.length,
        problems,
        current: mine,
      });
    }
    items.sort((a, b) => Number(b.eligible) - Number(a.eligible));
    return { date: formatIsoDate(date), items };
  }

  // ── Purchasing ────────────────────────────────────────────────────────────

  async create(
    tenant: TenantContext,
    dto: CreateEnrollmentDto,
    ip: string | null,
  ) {
    const { patientId, packageId, ...terms } = dto;
    return this.purchase(tenant, patientId, packageId, terms, null, ip);
  }

  /**
   * Buys again for the same patient: a new enrollment with its own terms, price and
   * validity. The earlier one is left exactly as it is; nothing carries over.
   */
  async renew(
    tenant: TenantContext,
    id: string,
    dto: RenewEnrollmentDto,
    ip: string | null,
  ) {
    const source = await this.prisma.packageEnrollment.findFirst({
      where: { id, centerId: tenant.centerId },
      select: { id: true, code: true, patientId: true, packageId: true },
    });
    if (!source) throw enrollmentNotFound();
    const { packageId, ...terms } = dto;
    return this.purchase(
      tenant,
      source.patientId,
      packageId ?? source.packageId,
      terms,
      source,
      ip,
    );
  }

  private async existing(tenant: TenantContext, requestId?: string) {
    if (!requestId) return null;
    const row = await this.prisma.packageEnrollment.findFirst({
      where: { centerId: tenant.centerId, requestId },
      select: { id: true },
    });
    return row && this.get(tenant, row.id);
  }

  private async purchase(
    tenant: TenantContext,
    patientId: string,
    packageId: string,
    terms: Purchase,
    renewedFrom: { id: string; code: string } | null,
    ip: string | null,
  ) {
    const repeat = await this.existing(tenant, terms.requestId);
    if (repeat) return repeat;
    const center = await this.center(tenant);
    const { today } = center;

    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, ...visiblePatients(tenant) },
      select: { id: true, code: true, fullName: true, status: true },
    });
    if (!patient) {
      throw fieldError(
        'patientId',
        'This patient no longer exists. Search again.',
        'PATIENT_NOT_FOUND',
      );
    }
    if (patient.status === PatientStatus.INACTIVE) {
      throw fieldError(
        'patientId',
        `${patient.fullName} is inactive. Reactivate them on their profile to enroll.`,
        'PATIENT_INACTIVE',
      );
    }

    const pkg = await this.prisma.therapyPackage.findFirst({
      where: { id: packageId, centerId: tenant.centerId },
      include: {
        therapyTypes: {
          select: {
            therapyType: { select: { id: true, name: true, code: true } },
          },
        },
      },
    });
    if (!pkg) {
      throw fieldError(
        'packageId',
        'This package no longer exists. Choose another.',
        'PACKAGE_NOT_FOUND',
      );
    }
    if (!pkg.isActive) {
      throw fieldError(
        'packageId',
        `${pkg.name} is inactive, so patients can’t be enrolled in it. Choose another or activate it.`,
        'PACKAGE_INACTIVE',
      );
    }
    const typeIds = pkg.therapyTypes.map((t) => t.therapyType.id);

    if (terms.therapyPlanId) {
      const plan = await this.prisma.therapyPlan.findFirst({
        where: {
          id: terms.therapyPlanId,
          centerId: tenant.centerId,
          patientId,
        },
        select: { status: true, therapyTypeId: true, code: true },
      });
      if (!plan) {
        throw fieldError(
          'therapyPlanId',
          'Choose one of this patient’s therapy plans',
          'THERAPY_PLAN_NOT_FOUND',
        );
      }
      if (
        plan.status === TherapyPlanStatus.COMPLETED ||
        plan.status === TherapyPlanStatus.DISCONTINUED
      ) {
        throw fieldError(
          'therapyPlanId',
          `${plan.code} is closed. Choose a plan in force or a draft.`,
          'THERAPY_PLAN_CLOSED',
        );
      }
      if (!typeIds.includes(plan.therapyTypeId)) {
        throw fieldError(
          'therapyPlanId',
          `${pkg.name} doesn’t cover the therapy of ${plan.code}`,
          'THERAPY_PLAN_NOT_COVERED',
        );
      }
    }

    // Validity: when it starts, and its last day.
    const policy = terms.activationPolicy ?? pkg.activationPolicy;
    let start: Date | null = null;
    if (policy === PackageActivationPolicy.ENROLLMENT_DATE) start = today;
    if (policy === PackageActivationPolicy.FIXED_DATE) {
      start = terms.startDate ? parseIsoDate(terms.startDate) : null;
      const range = PACKAGE_LIMITS.startDateRange;
      if (
        !start ||
        start < addDays(today, -range) ||
        start > addDays(today, range)
      ) {
        throw fieldError(
          'startDate',
          `Choose a start date within a year of today`,
          'VALIDATION_FAILED',
        );
      }
    }
    if (policy === PackageActivationPolicy.FIRST_SESSION && terms.endDate) {
      throw fieldError(
        'endDate',
        'Its end date is set from its first session',
        'VALIDATION_FAILED',
      );
    }
    const computedEnd =
      start && validityEnd(start, pkg.validityValue, pkg.validityUnit);
    let end = computedEnd;
    if (start && terms.endDate) {
      const chosen = parseIsoDate(terms.endDate);
      if (!chosen || chosen < start) {
        throw fieldError(
          'endDate',
          'Choose an end date on or after the start date',
          'VALIDATION_FAILED',
        );
      }
      end = chosen;
    }
    const customEndDate = Boolean(
      end && computedEnd && end.getTime() !== computedEnd.getTime(),
    );

    // Price.
    const discountType = terms.discountType ?? PackageDiscountType.NONE;
    const price = priceAfterDiscount(pkg.price, {
      discountType,
      discountValue: terms.discountValue,
      agreedPrice: terms.agreedPrice,
    });
    if (!price.ok) {
      throw fieldError(price.field, price.message, 'VALIDATION_FAILED');
    }
    if (price.finalPrice.gt(PACKAGE_LIMITS.maxPrice)) {
      throw fieldError(
        'agreedPrice',
        'Enter a price up to 99,999,999.99',
        'VALIDATION_FAILED',
      );
    }
    const sessionCount = terms.sessionCount ?? pkg.sessionCount;
    if (
      discountType !== PackageDiscountType.NONE ||
      sessionCount !== pkg.sessionCount ||
      customEndDate
    ) {
      assertCan(tenant, 'package_enrollments.override_terms');
    }

    const snapshot = {
      id: pkg.id,
      code: pkg.code,
      name: pkg.name,
      description: pkg.description,
      sessionCount: pkg.sessionCount,
      price: money(pkg.price),
      validity: { value: pkg.validityValue, unit: pkg.validityUnit },
      activationPolicy: pkg.activationPolicy,
      defaultDurationMinutes: pkg.defaultDurationMinutes,
      usageLimit:
        pkg.usageLimitCount !== null
          ? { count: pkg.usageLimitCount, period: pkg.usageLimitPeriod }
          : null,
      coversAssessments: pkg.coversAssessments,
      chargeNoShow: pkg.chargeNoShow,
      chargeLateCancellation: pkg.chargeLateCancellation,
      therapyTypes: pkg.therapyTypes.map((t) => t.therapyType),
      updatedAt: pkg.updatedAt.toISOString(),
    };

    let id: string;
    try {
      id = await this.prisma.$transaction(async (tx) => {
        const n = await nextSequenceValue(
          tx,
          tenant.centerId,
          'package_enrollment',
        );
        const code = `${CODE_PREFIX}${String(n).padStart(4, '0')}`;
        const row = await tx.packageEnrollment.create({
          data: {
            centerId: tenant.centerId,
            code,
            patientId,
            packageId: pkg.id,
            therapyPlanId: terms.therapyPlanId ?? null,
            renewedFromId: renewedFrom?.id ?? null,
            requestId: terms.requestId ?? null,
            packageName: pkg.name,
            packageCode: pkg.code,
            packageSnapshot: snapshot,
            sessionCount,
            defaultDurationMinutes: pkg.defaultDurationMinutes,
            validityValue: pkg.validityValue,
            validityUnit: pkg.validityUnit,
            activationPolicy: policy,
            usageLimitCount: pkg.usageLimitCount,
            usageLimitPeriod: pkg.usageLimitPeriod,
            coversAssessments: pkg.coversAssessments,
            chargeNoShow: pkg.chargeNoShow,
            chargeLateCancellation: pkg.chargeLateCancellation,
            currency: center.currency,
            catalogPrice: pkg.price,
            discountType,
            discountValue: price.discountValue,
            finalPrice: price.finalPrice,
            startDate: start,
            endDate: end,
            customEndDate,
            state: start
              ? PackageEnrollmentState.ACTIVE
              : PackageEnrollmentState.PENDING,
            activatedAt: start ? new Date() : null,
            notes: terms.notes ?? null,
            createdById: tenant.userId,
            therapyTypes: {
              createMany: {
                data: typeIds.map((therapyTypeId) => ({ therapyTypeId })),
              },
            },
          },
          select: { id: true },
        });
        // The purchased sessions are the first ledger entry, like every later change.
        await tx.packageSessionLedger.create({
          data: {
            centerId: tenant.centerId,
            enrollmentId: row.id,
            movement: PackageLedgerMovement.INITIAL_ALLOCATION,
            quantity: sessionCount,
            createdById: tenant.userId,
          },
        });
        await this.audit.record(
          {
            centerId: tenant.centerId,
            actorUserId: tenant.userId,
            action: renewedFrom
              ? 'package_enrollment.renewed'
              : 'package_enrollment.created',
            entityType: 'PackageEnrollment',
            entityId: row.id,
            metadata: {
              code,
              patientCode: patient.code,
              packageCode: pkg.code,
              sessionCount,
              catalogPrice: money(pkg.price),
              discountType,
              finalPrice: money(price.finalPrice),
              ...(renewedFrom && { renewedFromCode: renewedFrom.code }),
            },
            ipAddress: ip,
          },
          tx,
        );
        return row.id;
      });
    } catch (error) {
      if (isUniqueViolation(error) && terms.requestId) {
        const again = await this.existing(tenant, terms.requestId);
        if (again) return again;
      }
      throw error;
    }
    return this.get(tenant, id);
  }

  // ── Changes ───────────────────────────────────────────────────────────────

  /**
   * Cancels administratively: sessions held for booked appointments are given back
   * (the appointments stay booked, without a package) and nothing more can be used.
   * Consumed sessions and the whole history stay. Refunds are billing's business.
   */
  async cancel(
    tenant: TenantContext,
    id: string,
    dto: CancelEnrollmentDto,
    ip: string | null,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const e = await lockEnrollment(tx, tenant, id);
      if (e.state === PackageEnrollmentState.CANCELLED) {
        throw already(
          'ALREADY_CANCELLED',
          'This enrollment is already cancelled.',
        );
      }
      const now = new Date();
      const { count } = await tx.packageSessionReservation.updateMany({
        where: { enrollmentId: id, status: PackageReservationStatus.ACTIVE },
        data: {
          status: PackageReservationStatus.RELEASED,
          releasedAt: now,
          releasedById: tenant.userId,
          releaseReason: PackageReleaseReason.ENROLLMENT_CANCELLED,
        },
      });
      await tx.packageEnrollment.update({
        where: { id },
        data: {
          state: PackageEnrollmentState.CANCELLED,
          cancelledAt: now,
          cancelledById: tenant.userId,
          cancellationReason: dto.reason,
        },
      });
      await this.audit.record(
        {
          centerId: tenant.centerId,
          actorUserId: tenant.userId,
          action: 'package_enrollment.cancelled',
          entityType: 'PackageEnrollment',
          entityId: id,
          metadata: { code: e.code, releasedReservations: count },
          ipAddress: ip,
        },
        tx,
      );
    });
    return this.get(tenant, id);
  }

  /**
   * A manual change to the balance, always a new ledger entry with a reason: a bonus
   * or correcting credit, a debit (never below what's booked), or reversing one
   * charged session. The purchased count itself never changes.
   */
  async adjust(
    tenant: TenantContext,
    id: string,
    dto: AdjustEnrollmentDto,
    ip: string | null,
  ) {
    const repeated = async () =>
      dto.requestId &&
      (await this.prisma.packageSessionLedger.findFirst({
        where: {
          enrollmentId: id,
          requestId: dto.requestId,
          centerId: tenant.centerId,
        },
        select: { id: true },
      }));
    if (await repeated()) return this.get(tenant, id);
    try {
      await this.prisma.$transaction(async (tx) => {
        const e = await lockEnrollment(tx, tenant, id);
        const cancelled = e.state === PackageEnrollmentState.CANCELLED;
        const base = {
          centerId: tenant.centerId,
          enrollmentId: id,
          reason: dto.reason,
          requestId: dto.requestId ?? null,
          createdById: tenant.userId,
        };
        let entry: { movement: PackageLedgerMovement; quantity: number };
        if (dto.type === 'CONSUMPTION_REVERSAL') {
          const consumption = await tx.packageSessionLedger.findFirst({
            where: {
              id: dto.consumptionId,
              enrollmentId: id,
              movement: PackageLedgerMovement.SESSION_CONSUMPTION,
            },
            select: { id: true, reversedBy: { select: { id: true } } },
          });
          if (!consumption) {
            throw fieldError(
              'consumptionId',
              'Choose a charged session of this enrollment',
              'VALIDATION_FAILED',
            );
          }
          if (consumption.reversedBy) {
            throw already(
              'ALREADY_REVERSED',
              'This session has already been reversed.',
            );
          }
          entry = {
            movement: PackageLedgerMovement.CONSUMPTION_REVERSAL,
            quantity: 1,
          };
          await tx.packageSessionLedger.create({
            data: { ...base, ...entry, reversesId: consumption.id },
          });
        } else {
          if (cancelled) {
            throw already(
              'ENROLLMENT_CANCELLED',
              'This enrollment is cancelled, so its balance can’t be changed.',
            );
          }
          const quantity = dto.quantity!;
          if (dto.type === 'MANUAL_DEBIT') {
            const available =
              e.totalSessions - e.consumedSessions - e.reservedSessions;
            if (quantity > available) {
              throw apiError(
                HttpStatus.CONFLICT,
                available > 0
                  ? `Only ${available} session${available === 1 ? '' : 's'} can be debited: the rest ${e.reservedSessions ? 'are booked or ' : ''}have been used.`
                  : 'There are no unbooked sessions left to debit.',
                'PACKAGE_DEBIT_TOO_LARGE',
                { quantity: `Up to ${Math.max(available, 0)}` },
              );
            }
          }
          entry = {
            movement: PackageLedgerMovement[dto.type],
            quantity: dto.type === 'MANUAL_DEBIT' ? -quantity : quantity,
          };
          await tx.packageSessionLedger.create({ data: { ...base, ...entry } });
        }
        await this.audit.record(
          {
            centerId: tenant.centerId,
            actorUserId: tenant.userId,
            action:
              dto.type === 'CONSUMPTION_REVERSAL'
                ? 'package_enrollment.consumption_reversed'
                : 'package_enrollment.adjusted',
            entityType: 'PackageEnrollment',
            entityId: id,
            metadata: {
              code: e.code,
              movement: entry.movement,
              quantity: entry.quantity,
              ...(dto.consumptionId && { consumptionId: dto.consumptionId }),
            },
            ipAddress: ip,
          },
          tx,
        );
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        // The same request sent again meanwhile, or a reversal made elsewhere.
        if (await repeated()) return this.get(tenant, id);
        if (dto.type === 'CONSUMPTION_REVERSAL') {
          throw already(
            'ALREADY_REVERSED',
            'This session has already been reversed.',
          );
        }
      }
      throw error;
    }
    return this.get(tenant, id);
  }
}
