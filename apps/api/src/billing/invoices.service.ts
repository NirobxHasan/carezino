import { HttpStatus, Injectable, Logger } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import type { TenantContext } from '../auth/auth-context';
import type { Permission } from '../auth/permissions';
import { apiError } from '../common/errors';
import { nextSequenceValue } from '../common/sequences';
import { addDays, formatIsoDate, instantToZoned } from '../common/time';
import { Prisma } from '../generated/prisma/client';
import {
  AllocationReleaseReason,
  AppointmentStatus,
  AppointmentType,
  BillableServiceCategory,
  InvoiceItemKind,
  InvoiceStatus,
  PackageEnrollmentState,
  PackageReservationStatus,
  PaymentStatus,
} from '../generated/prisma/enums';
import { assertCan, visiblePatients } from '../patients/access';
import { fieldError } from '../patients/contacts';
import { PrismaService } from '../prisma/prisma.service';
import type {
  ChargesQuery,
  CreateInvoiceDto,
  InvoiceItemInput,
  ListInvoicesQuery,
  UpdateInvoiceDto,
  VoidInvoiceDto,
} from './dto';
import {
  BILLING_LIMITS,
  OPEN_INVOICE_STATUSES,
  agingBucket,
  computeInvoice,
  computeLine,
  daysOverdue,
  isOverdue,
  outstandingOf,
  type LineTotals,
} from './rules';
import { BillingSettingsService } from './settings.service';
import {
  Decimal,
  billingCenter,
  can,
  changedMeanwhile,
  conflict,
  instantRange,
  iso,
  isUniqueViolation,
  lockRows,
  money,
  notFound,
  parseDate,
  patientSelect,
  toPatient,
  userSelect,
  type BillingCenter,
  type Db,
  type Tx,
} from './shared';

const invoiceNotFound = () => notFound('Invoice');

/** "12 Nov 2026" */
const dateText = (date: Date) =>
  date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** Kinds whose line charges for an event that may be invoiced only once. */
const FEE_KINDS: InvoiceItemKind[] = [
  InvoiceItemKind.ASSESSMENT_FEE,
  InvoiceItemKind.SESSION_FEE,
];

/** Package sessions held for or used by an appointment: it's paid for by the package. */
const COVERING: PackageReservationStatus[] = [
  PackageReservationStatus.ACTIVE,
  PackageReservationStatus.CONSUMED,
];

const appointmentFacts = {
  id: true,
  patientId: true,
  type: true,
  status: true,
  startAt: true,
  therapyTypeId: true,
  therapyType: { select: { id: true, name: true, code: true, color: true } },
  therapist: { select: { id: true, fullName: true } },
  packageReservations: {
    where: { status: { in: COVERING } },
    select: {
      enrollment: { select: { id: true, code: true, packageName: true } },
    },
  },
} satisfies Prisma.AppointmentSelect;

type AppointmentFacts = Prisma.AppointmentGetPayload<{
  select: typeof appointmentFacts;
}>;

const enrollmentFacts = {
  id: true,
  code: true,
  patientId: true,
  packageName: true,
  finalPrice: true,
  currency: true,
  state: true,
  createdAt: true,
} satisfies Prisma.PackageEnrollmentSelect;

const serviceFacts = {
  id: true,
  code: true,
  name: true,
  category: true,
  therapyTypeId: true,
  price: true,
  isActive: true,
  displayOrder: true,
} satisfies Prisma.BillableServiceSelect;

type ServiceFacts = Prisma.BillableServiceGetPayload<{
  select: typeof serviceFacts;
}>;

const itemSelect = {
  id: true,
  position: true,
  kind: true,
  description: true,
  quantity: true,
  unitPrice: true,
  amount: true,
  discountType: true,
  discountValue: true,
  discountAmount: true,
  totalAmount: true,
  active: true,
  serviceId: true,
  appointmentId: true,
  packageEnrollmentId: true,
  service: { select: { id: true, code: true, name: true, category: true } },
  appointment: {
    select: {
      id: true,
      type: true,
      status: true,
      startAt: true,
      therapyType: {
        select: { id: true, name: true, code: true, color: true },
      },
      therapist: { select: { id: true, fullName: true } },
    },
  },
  packageEnrollment: { select: { id: true, code: true, packageName: true } },
} satisfies Prisma.InvoiceItemSelect;

type ItemRow = Prisma.InvoiceItemGetPayload<{ select: typeof itemSelect }>;

export const invoiceSummarySelect = {
  id: true,
  number: true,
  status: true,
  invoiceDate: true,
  dueDate: true,
  currency: true,
  subtotal: true,
  discountAmount: true,
  taxAmount: true,
  totalAmount: true,
  paidAmount: true,
  automatic: true,
  createdAt: true,
  issuedAt: true,
  patient: patientSelect,
  _count: { select: { items: true } },
} satisfies Prisma.InvoiceSelect;

export type InvoiceSummaryRow = Prisma.InvoiceGetPayload<{
  select: typeof invoiceSummarySelect;
}>;

const detailSelect = {
  ...invoiceSummarySelect,
  invoiceDiscountType: true,
  invoiceDiscountValue: true,
  invoiceDiscountAmount: true,
  taxRate: true,
  taxLabel: true,
  notes: true,
  revision: true,
  updatedAt: true,
  voidedAt: true,
  voidReason: true,
  createdBy: userSelect,
  updatedBy: userSelect,
  issuedBy: userSelect,
  voidedBy: userSelect,
  reissuedFrom: { select: { id: true, number: true } },
  reissues: {
    select: { id: true, number: true, status: true },
    orderBy: { createdAt: 'asc' },
  },
  items: { select: itemSelect, orderBy: { position: 'asc' } },
  allocations: {
    select: {
      id: true,
      amount: true,
      createdAt: true,
      createdBy: userSelect,
      releasedAt: true,
      releasedBy: userSelect,
      releaseReason: true,
      releaseNote: true,
      payment: {
        select: {
          id: true,
          number: true,
          collectedAt: true,
          status: true,
          method: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.InvoiceSelect;

type DetailRow = Prisma.InvoiceGetPayload<{ select: typeof detailSelect }>;

/** The primary contact of a patient, for dues lists and printed invoices. */
export const contactSelect = {
  select: {
    mobile: true,
    email: true,
    address: true,
    primaryContactIsSelf: true,
    guardians: {
      where: { isPrimary: true },
      select: {
        relationship: true,
        customRelationship: true,
        guardian: {
          select: { fullName: true, mobile: true, email: true, address: true },
        },
      },
      take: 1,
    },
  },
} as const;

export type ContactRow = Prisma.PatientGetPayload<typeof contactSelect>;

export function contactOf(p: ContactRow) {
  const link = p.guardians[0];
  if (p.primaryContactIsSelf || !link) {
    return {
      name: null,
      relationship: null,
      mobile: p.mobile,
      email: p.email,
      address: p.address,
    };
  }
  return {
    name: link.guardian.fullName,
    relationship: link.customRelationship ?? link.relationship,
    mobile: link.guardian.mobile,
    email: link.guardian.email,
    address: link.guardian.address ?? p.address,
  };
}

function invoiceActions(tenant: TenantContext, status: InvoiceStatus) {
  const draft = status === InvoiceStatus.DRAFT;
  const open = OPEN_INVOICE_STATUSES.includes(status);
  return {
    edit: draft && can(tenant, 'invoices.create'),
    discard: draft && can(tenant, 'invoices.create'),
    issue: draft && can(tenant, 'invoices.issue'),
    collect: open && can(tenant, 'payments.collect'),
    void:
      (open || status === InvoiceStatus.PAID) && can(tenant, 'invoices.void'),
  };
}

export function toInvoiceSummary(
  tenant: TenantContext,
  row: InvoiceSummaryRow,
  today: Date,
) {
  const outstanding = outstandingOf(row);
  const overdue = isOverdue(row, today);
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    patient: toPatient(row.patient),
    invoiceDate: iso(row.invoiceDate),
    dueDate: iso(row.dueDate),
    currency: row.currency,
    subtotal: money(row.subtotal),
    discountAmount: money(row.discountAmount),
    taxAmount: money(row.taxAmount),
    totalAmount: money(row.totalAmount),
    paidAmount: money(row.paidAmount),
    outstanding: money(outstanding),
    overdue,
    /** Days past the due date while something is owed; null otherwise */
    daysOverdue: overdue ? daysOverdue(row.dueDate, today) : null,
    aging: outstanding.gt(0) ? agingBucket(row.dueDate, today) : null,
    itemCount: row._count.items,
    automatic: row.automatic,
    issuedAt: row.issuedAt,
    createdAt: row.createdAt,
    actions: invoiceActions(tenant, row.status),
  };
}

/** A line ready to store: what it charges for, its price and its arithmetic. */
interface ResolvedLine extends LineTotals {
  kind: InvoiceItemKind;
  description: string;
  serviceId: string | null;
  appointmentId: string | null;
  packageEnrollmentId: string | null;
  quantity: number;
  unitPrice: Decimal;
  discountType: InvoiceItemInput['discountType'];
  discountValue: Decimal | null;
}

interface ResolveContext {
  patientId: string;
  allowManualDiscount: boolean;
  center: BillingCenter;
  /** The invoice being edited, whose own lines don't count as other charges */
  invoiceId?: string;
  /** Services already on that invoice, which may stay even if since deactivated */
  keptServiceIds?: Set<string>;
  /** Automatic invoices: no permission checks, the center's policy decided */
  automatic?: boolean;
}

/** A refusal tied to one input, shown next to that line on the form. */
function lineError(
  path: string,
  message: string,
  code: string,
  status = HttpStatus.BAD_REQUEST,
) {
  return apiError(status, message, code, { [path]: message });
}

function requirePermission(
  tenant: TenantContext,
  ctx: ResolveContext,
  permission: Permission,
  path: string,
  message: string,
) {
  if (ctx.automatic || can(tenant, permission)) return;
  throw lineError(path, message, 'FORBIDDEN', HttpStatus.FORBIDDEN);
}

/** Why an appointment's fee can't be charged now, or null if it can. */
function feeProblem(kind: InvoiceItemKind, a: AppointmentFacts) {
  const wanted =
    kind === InvoiceItemKind.ASSESSMENT_FEE
      ? AppointmentType.ASSESSMENT
      : AppointmentType.THERAPY_SESSION;
  if (a.type !== wanted) {
    return kind === InvoiceItemKind.ASSESSMENT_FEE
      ? {
          code: 'NOT_AN_ASSESSMENT',
          message: 'This appointment is a therapy session, not an assessment',
        }
      : {
          code: 'NOT_A_SESSION',
          message: 'This appointment is an assessment, not a therapy session',
        };
  }
  if (a.status === AppointmentStatus.CANCELLED) {
    return {
      code: 'APPOINTMENT_CANCELLED',
      message: 'This appointment was cancelled, so there’s no fee to charge',
    };
  }
  if (a.status === AppointmentStatus.NO_SHOW) {
    return {
      code: 'APPOINTMENT_NO_SHOW',
      message:
        'The patient didn’t attend. Charge a no-show with an additional fee, if the center charges one.',
    };
  }
  const covering = a.packageReservations[0]?.enrollment;
  if (covering) {
    return {
      code: 'SESSION_COVERED_BY_PACKAGE',
      message: `${covering.packageName} (${covering.code}) pays for this ${a.type === AppointmentType.ASSESSMENT ? 'assessment' : 'session'}. Charge an additional fee only if an extra charge was agreed.`,
    };
  }
  return null;
}

/**
 * Invoices: drafts, issuing, voiding, and what a patient could still be invoiced for.
 * Prices come from the service catalog or the enrollment's agreed price and totals are
 * always recalculated here, never taken from the client. A line charging for a package
 * enrollment or an appointment's fee holds that event (a partial unique index), so the
 * same event can't be billed twice while its invoice stands.
 */
@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: BillingSettingsService,
  ) {}

  // ── Reading ───────────────────────────────────────────────────────────────

  async list(tenant: TenantContext, query: ListInvoicesQuery) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const center = await billingCenter(this.prisma, tenant);
    const { dates } = instantRange(query.from, query.to, center.timeZone);
    const search = query.search;
    const where: Prisma.InvoiceWhereInput = {
      AND: [
        { centerId: tenant.centerId },
        {
          ...(query.patientId && { patientId: query.patientId }),
          ...(query.status?.length && { status: { in: query.status } }),
          ...(dates && { invoiceDate: dates }),
        },
        query.overdue
          ? {
              status: { in: OPEN_INVOICE_STATUSES },
              dueDate: { lt: center.today },
            }
          : {},
        search
          ? {
              OR: [
                { number: { contains: search, mode: 'insensitive' } },
                {
                  patient: {
                    fullName: { contains: search, mode: 'insensitive' },
                  },
                },
                {
                  patient: { code: { contains: search, mode: 'insensitive' } },
                },
              ],
            }
          : {},
      ],
    };
    const sortBy = query.sortBy ?? 'createdAt';
    const order = query.sortOrder ?? 'desc';
    const orderBy: Prisma.InvoiceOrderByWithRelationInput =
      sortBy === 'total'
        ? { totalAmount: order }
        : sortBy === 'dueDate'
          ? { dueDate: { sort: order, nulls: 'last' } }
          : { [sortBy]: order };
    const [total, rows] = await Promise.all([
      this.prisma.invoice.count({ where }),
      this.prisma.invoice.findMany({
        where,
        select: invoiceSummarySelect,
        orderBy: [orderBy, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      items: rows.map((r) => toInvoiceSummary(tenant, r, center.today)),
      total,
      page,
      pageSize,
    };
  }

  /** The patient's unapplied credit: received, not applied to invoices nor refunded. */
  async patientCredit(db: Db, tenant: TenantContext, patientId: string) {
    const sums = await db.payment.aggregate({
      where: {
        centerId: tenant.centerId,
        patientId,
        status: PaymentStatus.RECORDED,
      },
      _sum: { amount: true, allocatedAmount: true, refundedAmount: true },
    });
    const zero = new Decimal(0);
    return (sums._sum.amount ?? zero)
      .minus(sums._sum.allocatedAmount ?? zero)
      .minus(sums._sum.refundedAmount ?? zero);
  }

  private toLine(item: ItemRow, timeZone: string) {
    const a = item.appointment;
    return {
      id: item.id,
      position: item.position,
      kind: item.kind,
      description: item.description,
      quantity: item.quantity,
      unitPrice: money(item.unitPrice),
      amount: money(item.amount),
      discountType: item.discountType,
      discountValue: item.discountValue && money(item.discountValue),
      discountAmount: money(item.discountAmount),
      totalAmount: money(item.totalAmount),
      active: item.active,
      service: item.service,
      appointment: a && {
        id: a.id,
        type: a.type,
        status: a.status,
        date: formatIsoDate(instantToZoned(a.startAt, timeZone).date),
        therapyType: a.therapyType,
        therapist: a.therapist,
      },
      packageEnrollment: item.packageEnrollment,
    };
  }

  private async detail(
    tenant: TenantContext,
    row: DetailRow,
    center: BillingCenter,
  ) {
    const summary = toInvoiceSummary(tenant, row, center.today);
    const [credit, history] = await Promise.all([
      this.patientCredit(this.prisma, tenant, row.patient.id),
      this.prisma.auditLog.findMany({
        where: {
          centerId: tenant.centerId,
          entityType: 'Invoice',
          entityId: row.id,
        },
        select: {
          id: true,
          action: true,
          createdAt: true,
          actor: userSelect,
          metadata: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    const open = OPEN_INVOICE_STATUSES.includes(row.status);
    return {
      ...summary,
      invoiceDiscount: row.invoiceDiscountType && {
        type: row.invoiceDiscountType,
        value: money(row.invoiceDiscountValue!),
        amount: money(row.invoiceDiscountAmount),
      },
      taxRate: money(row.taxRate),
      taxLabel: row.taxLabel,
      notes: row.notes,
      revision: row.revision,
      updatedAt: row.updatedAt,
      createdBy: row.createdBy,
      updatedBy: row.updatedBy,
      issuedBy: row.issuedBy,
      voidedAt: row.voidedAt,
      voidedBy: row.voidedBy,
      voidReason: row.voidReason,
      reissuedFrom: row.reissuedFrom,
      reissues: row.reissues,
      items: row.items.map((i) => this.toLine(i, center.timeZone)),
      allocations: row.allocations.map((a) => ({
        id: a.id,
        amount: money(a.amount),
        createdAt: a.createdAt,
        createdBy: a.createdBy,
        active: a.releasedAt === null,
        releasedAt: a.releasedAt,
        releasedBy: a.releasedBy,
        releaseReason: a.releaseReason,
        releaseNote: a.releaseNote,
        payment: a.payment,
      })),
      /** The patient's unapplied credit, which can be applied to this invoice */
      patientCredit: money(credit),
      history: history.map((h) => ({
        id: h.id,
        action: h.action,
        at: h.createdAt,
        by: h.actor,
        metadata: h.metadata,
      })),
      actions: {
        ...summary.actions,
        applyCredit: open && credit.gt(0) && can(tenant, 'payments.collect'),
        reallocate: can(tenant, 'payments.reallocate'),
      },
    };
  }

  async get(tenant: TenantContext, id: string) {
    const row = await this.prisma.invoice.findFirst({
      where: { id, centerId: tenant.centerId },
      select: detailSelect,
    });
    if (!row) throw invoiceNotFound();
    const center = await billingCenter(this.prisma, tenant);
    return this.detail(tenant, row, center);
  }

  /** Everything a printed invoice shows, with the center's and the payer's details. */
  async print(tenant: TenantContext, id: string) {
    const invoice = await this.get(tenant, id);
    const [center, patient] = await Promise.all([
      billingCenter(this.prisma, tenant),
      this.prisma.patient.findUniqueOrThrow({
        where: { id: invoice.patient.id },
        select: contactSelect.select,
      }),
    ]);
    return {
      center: {
        name: center.name,
        code: center.code,
        phone: center.phone,
        email: center.email,
        address: center.address,
        district: center.district,
        website: center.website,
        logoUrl: center.logoUrl,
      },
      contact: contactOf(patient),
      invoice,
    };
  }

  async patientInvoices(tenant: TenantContext, patientId: string) {
    await this.visiblePatient(this.prisma, tenant, patientId);
    const { today } = await billingCenter(this.prisma, tenant);
    const rows = await this.prisma.invoice.findMany({
      where: { centerId: tenant.centerId, patientId },
      select: invoiceSummarySelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 200,
    });
    return { items: rows.map((r) => toInvoiceSummary(tenant, r, today)) };
  }

  private async visiblePatient(
    db: Db,
    tenant: TenantContext,
    id: string,
    field?: string,
  ) {
    const patient = await db.patient.findFirst({
      where: { id, ...visiblePatients(tenant) },
      select: { id: true, code: true, fullName: true, status: true },
    });
    if (!patient) {
      if (field) {
        throw fieldError(
          field,
          'This patient no longer exists. Search again.',
          'PATIENT_NOT_FOUND',
        );
      }
      throw notFound('Patient');
    }
    return patient;
  }

  // ── Lines ─────────────────────────────────────────────────────────────────

  /** Active services that price assessments and sessions, best match first. */
  private async feeServices(db: Db, tenant: TenantContext) {
    return db.billableService.findMany({
      where: {
        centerId: tenant.centerId,
        isActive: true,
        category: {
          in: [
            BillableServiceCategory.ASSESSMENT,
            BillableServiceCategory.THERAPY_SESSION,
          ],
        },
      },
      select: serviceFacts,
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
  }

  /** The service that prices an appointment's fee: its therapy's, else a general one. */
  private matchService(services: ServiceFacts[], a: AppointmentFacts) {
    const category =
      a.type === AppointmentType.ASSESSMENT
        ? BillableServiceCategory.ASSESSMENT
        : BillableServiceCategory.THERAPY_SESSION;
    const candidates = services.filter(
      (s) => s.isActive && s.category === category,
    );
    return (
      candidates.find((s) => s.therapyTypeId === a.therapyTypeId) ??
      candidates.find((s) => s.therapyTypeId === null) ??
      null
    );
  }

  private noServiceMessage(a: AppointmentFacts) {
    const what =
      a.type === AppointmentType.ASSESSMENT
        ? 'an assessment'
        : 'a therapy session';
    return `No active service prices ${what} for ${a.therapyType.name}. Add one in billing settings or choose a service.`;
  }

  /** Other invoices already charging for these events (drafts included). */
  private async existingCharges(
    db: Db,
    tenant: TenantContext,
    inputs: InvoiceItemInput[],
    exceptInvoiceId?: string,
  ) {
    const appointmentIds = inputs
      .filter((i) => FEE_KINDS.includes(i.kind) && i.appointmentId)
      .map((i) => i.appointmentId!);
    const enrollmentIds = inputs
      .filter(
        (i) => i.kind === InvoiceItemKind.PACKAGE && i.packageEnrollmentId,
      )
      .map((i) => i.packageEnrollmentId!);
    if (!appointmentIds.length && !enrollmentIds.length) return [];
    return db.invoiceItem.findMany({
      where: {
        centerId: tenant.centerId,
        active: true,
        ...(exceptInvoiceId && { invoiceId: { not: exceptInvoiceId } }),
        OR: [
          { kind: { in: FEE_KINDS }, appointmentId: { in: appointmentIds } },
          {
            kind: InvoiceItemKind.PACKAGE,
            packageEnrollmentId: { in: enrollmentIds },
          },
        ],
      },
      select: {
        appointmentId: true,
        packageEnrollmentId: true,
        invoice: { select: { id: true, number: true, status: true } },
      },
    });
  }

  /**
   * Turns submitted lines into stored ones: checks what each charges for belongs to
   * the patient and can be charged, takes prices from the catalog or the enrollment
   * (other prices and discounts need invoices.discount) and computes the arithmetic.
   */
  private async resolveLines(
    db: Db,
    tenant: TenantContext,
    inputs: InvoiceItemInput[],
    ctx: ResolveContext,
  ): Promise<ResolvedLine[]> {
    const ids = (
      key: 'appointmentId' | 'packageEnrollmentId' | 'serviceId',
    ) => [
      ...new Set(
        inputs.map((i) => i[key]).filter((v): v is string => Boolean(v)),
      ),
    ];
    const [appointments, enrollments, chosen, feeServices, taken] =
      await Promise.all([
        db.appointment.findMany({
          where: {
            id: { in: ids('appointmentId') },
            centerId: tenant.centerId,
          },
          select: appointmentFacts,
        }),
        db.packageEnrollment.findMany({
          where: {
            id: { in: ids('packageEnrollmentId') },
            centerId: tenant.centerId,
          },
          select: enrollmentFacts,
        }),
        db.billableService.findMany({
          where: { id: { in: ids('serviceId') }, centerId: tenant.centerId },
          select: serviceFacts,
        }),
        this.feeServices(db, tenant),
        this.existingCharges(db, tenant, inputs, ctx.invoiceId),
      ]);
    const byId = <T extends { id: string }>(rows: T[]) =>
      new Map(rows.map((r) => [r.id, r]));
    const appointmentMap = byId(appointments);
    const enrollmentMap = byId(enrollments);
    const serviceMap = byId(chosen);
    const seen = new Set<string>();
    const lines: ResolvedLine[] = [];

    inputs.forEach((input, n) => {
      const path = `items.${n}`;
      const quantity = input.quantity ?? 1;
      const line: Omit<
        ResolvedLine,
        keyof LineTotals | 'unitPrice' | 'description'
      > & {
        unitPrice?: Decimal;
        description?: string;
      } = {
        kind: input.kind,
        serviceId: null,
        appointmentId: null,
        packageEnrollmentId: null,
        quantity,
        discountType: input.discountType ?? null,
        discountValue: input.discountValue
          ? new Decimal(input.discountValue)
          : null,
      };
      const given = input.unitPrice ? new Decimal(input.unitPrice) : null;

      // A chosen service: the center's, active (or already on this draft) and fitting.
      let service: ServiceFacts | null = null;
      if (input.serviceId) {
        service = serviceMap.get(input.serviceId) ?? null;
        if (!service) {
          throw lineError(
            `${path}.serviceId`,
            'Choose one of the center’s services',
            'SERVICE_NOT_FOUND',
          );
        }
        if (!service.isActive && !ctx.keptServiceIds?.has(service.id)) {
          throw lineError(
            `${path}.serviceId`,
            `${service.name} is inactive. Choose another service.`,
            'SERVICE_INACTIVE',
          );
        }
      }

      const alreadyCharged = (
        key: 'appointmentId' | 'packageEnrollmentId',
        id: string,
      ) => {
        const other = taken.find((t) => t[key] === id);
        if (other) {
          throw apiError(
            HttpStatus.CONFLICT,
            other.invoice.number
              ? `This is already charged on ${other.invoice.number}. Void that invoice first to charge it again.`
              : 'This is already on a draft invoice. Finish or discard that draft first.',
            'ALREADY_INVOICED',
            { [path]: 'Already invoiced' },
            {
              invoiceId: other.invoice.id,
              invoiceNumber: other.invoice.number,
            },
          );
        }
        if (seen.has(id)) {
          throw lineError(
            path,
            'This is on the invoice twice',
            'DUPLICATE_LINE',
          );
        }
        seen.add(id);
      };

      switch (input.kind) {
        case InvoiceItemKind.PACKAGE: {
          const e = input.packageEnrollmentId
            ? enrollmentMap.get(input.packageEnrollmentId)
            : undefined;
          if (!e || e.patientId !== ctx.patientId) {
            throw lineError(
              `${path}.packageEnrollmentId`,
              'Choose one of this patient’s packages',
              'ENROLLMENT_NOT_FOUND',
            );
          }
          if (e.state === PackageEnrollmentState.CANCELLED) {
            throw lineError(
              `${path}.packageEnrollmentId`,
              `${e.code} was cancelled, so it can’t be invoiced`,
              'ENROLLMENT_CANCELLED',
            );
          }
          if (quantity !== 1 || input.serviceId || line.discountType) {
            throw lineError(
              path,
              'A package is invoiced once at its agreed price. Discounts are agreed on the enrollment.',
              'PACKAGE_TERMS_FIXED',
            );
          }
          if (given && !given.equals(e.finalPrice)) {
            throw lineError(
              `${path}.unitPrice`,
              `${e.code}’s agreed price is ${money(e.finalPrice)}. Change prices on the enrollment, not the invoice.`,
              'PACKAGE_TERMS_FIXED',
            );
          }
          alreadyCharged('packageEnrollmentId', e.id);
          line.packageEnrollmentId = e.id;
          line.unitPrice = e.finalPrice;
          line.description = `${e.packageName} (${e.code})`;
          break;
        }
        case InvoiceItemKind.ASSESSMENT_FEE:
        case InvoiceItemKind.SESSION_FEE: {
          const a = input.appointmentId
            ? appointmentMap.get(input.appointmentId)
            : undefined;
          if (!a || a.patientId !== ctx.patientId) {
            throw lineError(
              `${path}.appointmentId`,
              'Choose one of this patient’s appointments',
              'APPOINTMENT_NOT_FOUND',
            );
          }
          const problem = feeProblem(input.kind, a);
          if (problem) {
            throw lineError(
              `${path}.appointmentId`,
              problem.message,
              problem.code,
              problem.code === 'SESSION_COVERED_BY_PACKAGE'
                ? HttpStatus.CONFLICT
                : HttpStatus.BAD_REQUEST,
            );
          }
          if (quantity !== 1) {
            throw lineError(
              `${path}.quantity`,
              'An appointment’s fee is charged once',
              'VALIDATION_FAILED',
            );
          }
          alreadyCharged('appointmentId', a.id);
          service ??= this.matchService(feeServices, a);
          if (!service) {
            throw lineError(
              `${path}.serviceId`,
              this.noServiceMessage(a),
              'NO_SERVICE_PRICE',
            );
          }
          const category =
            input.kind === InvoiceItemKind.ASSESSMENT_FEE
              ? BillableServiceCategory.ASSESSMENT
              : BillableServiceCategory.THERAPY_SESSION;
          if (
            service.category !== category ||
            (service.therapyTypeId && service.therapyTypeId !== a.therapyTypeId)
          ) {
            throw lineError(
              `${path}.serviceId`,
              `${service.name} doesn’t price this appointment. Choose a ${input.kind === InvoiceItemKind.ASSESSMENT_FEE ? 'assessment' : 'session'} service for ${a.therapyType.name}.`,
              'SERVICE_MISMATCH',
            );
          }
          line.appointmentId = a.id;
          line.description = `${service.name} · ${dateText(instantToZoned(a.startAt, ctx.center.timeZone).date)}`;
          break;
        }
        case InvoiceItemKind.ADDITIONAL_FEE: {
          requirePermission(
            tenant,
            ctx,
            'invoices.additional_charge',
            path,
            'Only managers can add extra charges for an appointment',
          );
          const a = input.appointmentId
            ? appointmentMap.get(input.appointmentId)
            : undefined;
          if (!a || a.patientId !== ctx.patientId) {
            throw lineError(
              `${path}.appointmentId`,
              'Choose one of this patient’s appointments',
              'APPOINTMENT_NOT_FOUND',
            );
          }
          line.appointmentId = a.id;
          if (!service && !given) {
            throw lineError(
              `${path}.unitPrice`,
              'Enter the fee or choose a service',
              'VALIDATION_FAILED',
            );
          }
          if (!service && !input.description) {
            throw lineError(
              `${path}.description`,
              'Describe the charge, e.g. No-show fee',
              'VALIDATION_FAILED',
            );
          }
          // An extra charge is priced as agreed; a service only suggests it.
          line.unitPrice = given ?? service!.price;
          line.description = `${service?.name ?? ''} · ${dateText(instantToZoned(a.startAt, ctx.center.timeZone).date)}`;
          break;
        }
        case InvoiceItemKind.OTHER: {
          if (input.appointmentId || input.packageEnrollmentId) {
            throw lineError(
              path,
              'Choose what this line charges for: an appointment’s fee or a package',
              'VALIDATION_FAILED',
            );
          }
          if (!service) {
            if (!given)
              throw lineError(
                `${path}.unitPrice`,
                'Enter the price',
                'VALIDATION_FAILED',
              );
            if (!input.description)
              throw lineError(
                `${path}.description`,
                'Describe the charge',
                'VALIDATION_FAILED',
              );
            line.unitPrice = given;
          }
          break;
        }
      }

      if (service) {
        line.serviceId = service.id;
        line.description ??= service.name;
        if (line.unitPrice === undefined) {
          line.unitPrice = given ?? service.price;
          if (!line.unitPrice.equals(service.price)) {
            requirePermission(
              tenant,
              ctx,
              'invoices.discount',
              `${path}.unitPrice`,
              `Only managers can change ${service.name}’s price of ${money(service.price)}`,
            );
          }
        }
      }
      if (line.discountType) {
        if (!ctx.allowManualDiscount) {
          throw lineError(
            `${path}.discountValue`,
            'Manual discounts are switched off in billing settings',
            'DISCOUNTS_OFF',
          );
        }
        requirePermission(
          tenant,
          ctx,
          'invoices.discount',
          `${path}.discountValue`,
          'Only managers can give discounts',
        );
      }
      const description = (input.description ?? line.description!).slice(
        0,
        BILLING_LIMITS.description,
      );
      const totals = computeLine(
        {
          quantity,
          unitPrice: line.unitPrice!,
          type: line.discountType ?? null,
          value: line.discountValue,
        },
        path,
      );
      if (!totals.ok)
        throw lineError(totals.field, totals.message, 'VALIDATION_FAILED');
      lines.push({
        ...line,
        unitPrice: line.unitPrice!,
        description,
        amount: totals.amount,
        discountAmount: totals.discountAmount,
        totalAmount: totals.totalAmount,
      });
    });
    return lines;
  }

  private totals(
    lines: LineTotals[],
    discount: {
      type: InvoiceItemInput['discountType'];
      value: string | null | undefined;
    },
    taxRate: Decimal,
    tenant: TenantContext,
    ctx: ResolveContext,
  ) {
    const type = discount.type ?? null;
    if (type) {
      if (!ctx.allowManualDiscount) {
        throw fieldError(
          'discountValue',
          'Manual discounts are switched off in billing settings',
          'DISCOUNTS_OFF',
        );
      }
      requirePermission(
        tenant,
        ctx,
        'invoices.discount',
        'discountValue',
        'Only managers can give discounts',
      );
    }
    const value = type && discount.value ? new Decimal(discount.value) : null;
    if (type && !value)
      throw fieldError(
        'discountValue',
        'Enter the discount',
        'VALIDATION_FAILED',
      );
    const totals = computeInvoice(lines, { type, value }, taxRate);
    if (!totals.ok)
      throw fieldError(totals.field, totals.message, 'VALIDATION_FAILED');
    return {
      ...totals,
      invoiceDiscountType: type,
      invoiceDiscountValue: value,
    };
  }

  private dates(
    center: BillingCenter,
    dueDays: number,
    input: { invoiceDate?: string; dueDate?: string | null },
    current?: { invoiceDate: Date; dueDate: Date | null },
  ) {
    const invoiceDate = input.invoiceDate
      ? parseDate(input.invoiceDate, 'invoiceDate')
      : (current?.invoiceDate ?? center.today);
    if (
      input.invoiceDate &&
      (invoiceDate < addDays(center.today, -BILLING_LIMITS.backdateDays) ||
        invoiceDate > addDays(center.today, BILLING_LIMITS.forwardDays))
    ) {
      throw fieldError(
        'invoiceDate',
        'Choose a date within the last year or the next month',
        'VALIDATION_FAILED',
      );
    }
    let dueDate: Date | null;
    if (input.dueDate === null) dueDate = null;
    else if (input.dueDate) dueDate = parseDate(input.dueDate, 'dueDate');
    else if (current) dueDate = current.dueDate;
    else dueDate = addDays(invoiceDate, dueDays);
    if (
      dueDate &&
      (dueDate < invoiceDate ||
        dueDate > addDays(invoiceDate, BILLING_LIMITS.backdateDays))
    ) {
      throw fieldError(
        'dueDate',
        'Choose a due date on or after the invoice date, within a year',
        'VALIDATION_FAILED',
      );
    }
    return { invoiceDate, dueDate };
  }

  private lineData(
    tenant: TenantContext,
    invoiceId: string,
    lines: ResolvedLine[],
  ) {
    return lines.map((l, position) => ({
      centerId: tenant.centerId,
      invoiceId,
      position,
      kind: l.kind,
      description: l.description,
      serviceId: l.serviceId,
      appointmentId: l.appointmentId,
      packageEnrollmentId: l.packageEnrollmentId,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      amount: l.amount,
      discountType: l.discountType ?? null,
      discountValue: l.discountValue,
      discountAmount: l.discountAmount,
      totalAmount: l.totalAmount,
    }));
  }

  /** An event charged on another invoice meanwhile: the unique index refused it. */
  private raceToCharge(error: unknown) {
    if (
      isUniqueViolation(error, 'InvoiceItem_one_fee_per_appointment') ||
      isUniqueViolation(error, 'InvoiceItem_one_charge_per_enrollment')
    ) {
      return conflict(
        'ALREADY_INVOICED',
        'Someone invoiced this just now. Refresh to see their invoice.',
      );
    }
    return null;
  }

  // ── Drafts ────────────────────────────────────────────────────────────────

  async create(
    tenant: TenantContext,
    dto: CreateInvoiceDto,
    ip: string | null,
    options: { automatic?: boolean } = {},
  ) {
    const repeat = async () =>
      dto.requestId &&
      (await this.prisma.invoice.findFirst({
        where: { centerId: tenant.centerId, requestId: dto.requestId },
        select: { id: true },
      }));
    const earlier = await repeat();
    if (earlier) return this.get(tenant, earlier.id);
    if (dto.issue && !options.automatic) assertCan(tenant, 'invoices.issue');

    const center = await billingCenter(this.prisma, tenant);
    const patient = await this.visiblePatient(
      this.prisma,
      tenant,
      dto.patientId,
      'patientId',
    );
    const settings = await this.settings.settings(this.prisma, tenant.centerId);
    const ctx: ResolveContext = {
      patientId: patient.id,
      allowManualDiscount: settings.allowManualDiscount,
      center,
      automatic: options.automatic,
    };
    const lines = await this.resolveLines(this.prisma, tenant, dto.items, ctx);
    const totals = this.totals(
      lines,
      { type: dto.discountType, value: dto.discountValue },
      settings.taxRate,
      tenant,
      ctx,
    );
    const { invoiceDate, dueDate } = this.dates(
      center,
      settings.defaultDueDays,
      dto,
    );

    let id: string;
    try {
      id = await this.prisma.$transaction(async (tx) => {
        const row = await tx.invoice.create({
          data: {
            centerId: tenant.centerId,
            patientId: patient.id,
            invoiceDate,
            dueDate,
            currency: center.currency,
            subtotal: totals.subtotal,
            discountAmount: totals.discountAmount,
            invoiceDiscountType: totals.invoiceDiscountType,
            invoiceDiscountValue: totals.invoiceDiscountValue,
            invoiceDiscountAmount: totals.invoiceDiscountAmount,
            taxRate: settings.taxRate,
            taxLabel: settings.taxRate.gt(0) ? settings.taxLabel : null,
            taxAmount: totals.taxAmount,
            totalAmount: totals.totalAmount,
            notes: dto.notes ?? null,
            automatic: Boolean(options.automatic),
            requestId: dto.requestId ?? null,
            createdById: tenant.userId,
          },
          select: { id: true },
        });
        await tx.invoiceItem.createMany({
          data: this.lineData(tenant, row.id, lines),
        });
        await this.record(
          tx,
          tenant,
          'invoice.draft_created',
          row.id,
          {
            patientCode: patient.code,
            lines: lines.length,
            total: money(totals.totalAmount),
            ...(options.automatic && { automatic: true }),
          },
          ip,
        );
        if (dto.issue) await this.issueInTx(tx, tenant, row.id, ip);
        return row.id;
      });
    } catch (error) {
      if (isUniqueViolation(error, 'requestId')) {
        const again = await repeat();
        if (again) return this.get(tenant, again.id);
      }
      throw this.raceToCharge(error) ?? error;
    }
    return this.get(tenant, id);
  }

  private async lockDraft(
    tx: Tx,
    tenant: TenantContext,
    id: string,
    revision?: number,
  ) {
    await lockRows(tx, 'Invoice', tenant, [id]);
    const row = await tx.invoice.findFirst({
      where: { id, centerId: tenant.centerId },
      select: {
        id: true,
        status: true,
        number: true,
        revision: true,
        patientId: true,
        invoiceDate: true,
        dueDate: true,
        taxRate: true,
        invoiceDiscountType: true,
        invoiceDiscountValue: true,
        patient: { select: { code: true } },
        items: {
          select: {
            serviceId: true,
            totalAmount: true,
            amount: true,
            discountAmount: true,
          },
        },
      },
    });
    if (!row) throw invoiceNotFound();
    if (row.status !== InvoiceStatus.DRAFT) {
      throw conflict(
        'INVOICE_ISSUED',
        `${row.number} has been issued, so it can’t be edited. Void and reissue it to correct it.`,
      );
    }
    if (revision !== undefined && revision !== row.revision) {
      throw conflict(
        'INVOICE_CHANGED',
        'Someone else saved this draft meanwhile. Reload it to see their changes.',
      );
    }
    return row;
  }

  /** Changes a draft; sent lines replace all of its lines. */
  async update(
    tenant: TenantContext,
    id: string,
    dto: UpdateInvoiceDto,
    ip: string | null,
  ) {
    const center = await billingCenter(this.prisma, tenant);
    const settings = await this.settings.settings(this.prisma, tenant.centerId);
    try {
      await this.prisma.$transaction(async (tx) => {
        const draft = await this.lockDraft(tx, tenant, id, dto.revision);
        const ctx: ResolveContext = {
          patientId: draft.patientId,
          allowManualDiscount: settings.allowManualDiscount,
          center,
          invoiceId: id,
          keptServiceIds: new Set(
            draft.items
              .map((i) => i.serviceId)
              .filter((s): s is string => Boolean(s)),
          ),
        };
        const lines = dto.items
          ? await this.resolveLines(tx, tenant, dto.items, ctx)
          : draft.items;
        const discountChanged =
          dto.discountType !== undefined || dto.discountValue !== undefined;
        const discount = discountChanged
          ? { type: dto.discountType ?? null, value: dto.discountValue }
          : {
              type: draft.invoiceDiscountType,
              value:
                draft.invoiceDiscountValue && money(draft.invoiceDiscountValue),
            };
        // An unchanged discount needs no fresh permission to stay.
        const totals = this.totals(lines, discount, draft.taxRate, tenant, {
          ...ctx,
          automatic: !discountChanged || ctx.automatic,
          allowManualDiscount: settings.allowManualDiscount || !discountChanged,
        });
        const { invoiceDate, dueDate } = this.dates(
          center,
          settings.defaultDueDays,
          dto,
          draft,
        );
        if (dto.items) {
          await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
          await tx.invoiceItem.createMany({
            data: this.lineData(tenant, id, lines as ResolvedLine[]),
          });
        }
        await tx.invoice.update({
          where: { id },
          data: {
            invoiceDate,
            dueDate,
            subtotal: totals.subtotal,
            discountAmount: totals.discountAmount,
            invoiceDiscountType: totals.invoiceDiscountType,
            invoiceDiscountValue: totals.invoiceDiscountValue,
            invoiceDiscountAmount: totals.invoiceDiscountAmount,
            taxAmount: totals.taxAmount,
            totalAmount: totals.totalAmount,
            ...(dto.notes !== undefined && { notes: dto.notes }),
            revision: { increment: 1 },
            updatedById: tenant.userId,
          },
        });
        await this.record(
          tx,
          tenant,
          'invoice.draft_updated',
          id,
          {
            patientCode: draft.patient.code,
            fields: Object.keys(dto).filter((k) => k !== 'revision'),
            total: money(totals.totalAmount),
          },
          ip,
        );
      });
    } catch (error) {
      throw this.raceToCharge(error) ?? error;
    }
    return this.get(tenant, id);
  }

  /** Deletes a draft, freeing what it charged for. Issued invoices are voided instead. */
  async discard(tenant: TenantContext, id: string, ip: string | null) {
    await this.prisma.$transaction(async (tx) => {
      const draft = await this.lockDraft(tx, tenant, id);
      await tx.invoice.delete({ where: { id } });
      await this.record(
        tx,
        tenant,
        'invoice.draft_discarded',
        id,
        { patientCode: draft.patient.code },
        ip,
      );
    });
  }

  // ── Issuing and voiding ───────────────────────────────────────────────────

  async issue(tenant: TenantContext, id: string, ip: string | null) {
    await this.prisma.$transaction((tx) => this.issueInTx(tx, tenant, id, ip));
    return this.get(tenant, id);
  }

  /**
   * Issues a draft: re-checks that what it charges for still can be charged,
   * recalculates its totals from its lines, numbers it and makes it owed. Issuing an
   * issued invoice changes nothing, so a repeated click can't issue twice.
   */
  private async issueInTx(
    tx: Tx,
    tenant: TenantContext,
    id: string,
    ip: string | null,
  ) {
    await lockRows(tx, 'Invoice', tenant, [id]);
    const inv = await tx.invoice.findFirst({
      where: { id, centerId: tenant.centerId },
      select: {
        status: true,
        patientId: true,
        automatic: true,
        taxRate: true,
        invoiceDiscountType: true,
        invoiceDiscountValue: true,
        patient: { select: { code: true } },
        items: {
          select: {
            kind: true,
            appointmentId: true,
            packageEnrollmentId: true,
            amount: true,
            discountAmount: true,
            totalAmount: true,
          },
        },
      },
    });
    if (!inv) throw invoiceNotFound();
    if (inv.status !== InvoiceStatus.DRAFT) return;
    if (!inv.items.length)
      throw fieldError(
        'items',
        'Add at least one line before issuing',
        'VALIDATION_FAILED',
      );
    const center = await billingCenter(tx, tenant);
    await this.checkCharges(tx, tenant, inv.items, center.timeZone);
    const totals = computeInvoice(
      inv.items,
      { type: inv.invoiceDiscountType, value: inv.invoiceDiscountValue },
      inv.taxRate,
    );
    if (!totals.ok)
      throw fieldError(totals.field, totals.message, 'VALIDATION_FAILED');
    const settings = await this.settings.settings(tx, tenant.centerId);
    const n = await nextSequenceValue(tx, tenant.centerId, 'invoice');
    const number = `${settings.invoicePrefix}${String(n).padStart(6, '0')}`;
    await tx.invoice.update({
      where: { id },
      data: {
        number,
        // A fully discounted invoice owes nothing from the start.
        status: totals.totalAmount.gt(0)
          ? InvoiceStatus.ISSUED
          : InvoiceStatus.PAID,
        subtotal: totals.subtotal,
        discountAmount: totals.discountAmount,
        invoiceDiscountAmount: totals.invoiceDiscountAmount,
        taxAmount: totals.taxAmount,
        totalAmount: totals.totalAmount,
        issuedAt: new Date(),
        issuedById: tenant.userId,
        revision: { increment: 1 },
      },
    });
    await this.record(
      tx,
      tenant,
      'invoice.issued',
      id,
      {
        number,
        patientCode: inv.patient.code,
        total: money(totals.totalAmount),
        ...(inv.automatic && { automatic: true }),
      },
      ip,
    );
  }

  /** Refuses issuing a draft whose appointments or packages can no longer be charged. */
  private async checkCharges(
    tx: Tx,
    tenant: TenantContext,
    items: {
      kind: InvoiceItemKind;
      appointmentId: string | null;
      packageEnrollmentId: string | null;
    }[],
    timeZone: string,
  ) {
    const fees = items.filter(
      (i) => FEE_KINDS.includes(i.kind) && i.appointmentId,
    );
    const packages = items.filter(
      (i) => i.kind === InvoiceItemKind.PACKAGE && i.packageEnrollmentId,
    );
    const [appointments, enrollments] = await Promise.all([
      fees.length
        ? tx.appointment.findMany({
            where: {
              id: { in: fees.map((f) => f.appointmentId!) },
              centerId: tenant.centerId,
            },
            select: appointmentFacts,
          })
        : ([] as AppointmentFacts[]),
      packages.length
        ? tx.packageEnrollment.findMany({
            where: {
              id: { in: packages.map((p) => p.packageEnrollmentId!) },
              centerId: tenant.centerId,
            },
            select: enrollmentFacts,
          })
        : ([] as { code: string; state: PackageEnrollmentState }[]),
    ]);
    for (const f of fees) {
      const a = appointments.find((x) => x.id === f.appointmentId)!;
      const problem = feeProblem(f.kind, a);
      if (problem) {
        throw conflict(
          problem.code,
          `${dateText(instantToZoned(a.startAt, timeZone).date)} ${a.therapyType.code}: ${problem.message}. Edit the draft before issuing it.`,
        );
      }
    }
    for (const e of enrollments) {
      if (e.state === PackageEnrollmentState.CANCELLED) {
        throw conflict(
          'ENROLLMENT_CANCELLED',
          `${e.code} was cancelled since this draft was made. Edit the draft before issuing it.`,
        );
      }
    }
  }

  /**
   * Voids an issued invoice, with a reason: payments applied to it are released and
   * become the patient's credit (to apply elsewhere or refund), its lines stop holding
   * what they charged for, and the invoice itself is kept. With `reissue`, a draft
   * copy is started for correcting and issuing again.
   */
  async void(
    tenant: TenantContext,
    id: string,
    dto: VoidInvoiceDto,
    ip: string | null,
  ) {
    // Reissuing starts a draft, which needs the right to create one.
    if (dto.reissue) assertCan(tenant, 'invoices.create');
    const allocated = await this.prisma.paymentAllocation.findMany({
      where: { invoiceId: id, centerId: tenant.centerId, releasedAt: null },
      select: { paymentId: true },
    });
    const reissueId = await this.prisma.$transaction(async (tx) => {
      // Invoices before payments, as everywhere in billing.
      await lockRows(tx, 'Invoice', tenant, [id]);
      await lockRows(
        tx,
        'Payment',
        tenant,
        allocated.map((a) => a.paymentId),
      );
      const inv = await tx.invoice.findFirst({
        where: { id, centerId: tenant.centerId },
        include: {
          items: { orderBy: { position: 'asc' } },
          patient: { select: { code: true } },
        },
      });
      if (!inv) throw invoiceNotFound();
      if (inv.status === InvoiceStatus.DRAFT) {
        throw conflict(
          'INVOICE_DRAFT',
          'Drafts aren’t owed yet: discard it instead.',
        );
      }
      if (inv.status === InvoiceStatus.VOID) {
        throw conflict('ALREADY_VOID', `${inv.number} is already void.`);
      }
      const active = await tx.paymentAllocation.findMany({
        where: { invoiceId: id, releasedAt: null },
        select: { id: true, paymentId: true, amount: true },
      });
      if (
        active.some((a) => !allocated.some((b) => b.paymentId === a.paymentId))
      ) {
        throw changedMeanwhile();
      }
      const now = new Date();
      if (active.length) {
        await tx.paymentAllocation.updateMany({
          where: { id: { in: active.map((a) => a.id) } },
          data: {
            releasedAt: now,
            releasedById: tenant.userId,
            releaseReason: AllocationReleaseReason.INVOICE_VOIDED,
            releaseNote: dto.reason,
          },
        });
      }
      await tx.invoice.update({
        where: { id },
        data: {
          status: InvoiceStatus.VOID,
          voidedAt: now,
          voidedById: tenant.userId,
          voidReason: dto.reason,
        },
      });
      const released = active.reduce(
        (s, a) => s.plus(a.amount),
        new Decimal(0),
      );
      let copyId: string | null = null;
      if (dto.reissue) {
        const center = await billingCenter(tx, tenant);
        const settings = await this.settings.settings(tx, tenant.centerId);
        const copy = await tx.invoice.create({
          data: {
            centerId: tenant.centerId,
            patientId: inv.patientId,
            invoiceDate: center.today,
            dueDate: addDays(center.today, settings.defaultDueDays),
            currency: inv.currency,
            subtotal: inv.subtotal,
            discountAmount: inv.discountAmount,
            invoiceDiscountType: inv.invoiceDiscountType,
            invoiceDiscountValue: inv.invoiceDiscountValue,
            invoiceDiscountAmount: inv.invoiceDiscountAmount,
            taxRate: inv.taxRate,
            taxLabel: inv.taxLabel,
            taxAmount: inv.taxAmount,
            totalAmount: inv.totalAmount,
            notes: inv.notes,
            reissuedFromId: inv.id,
            createdById: tenant.userId,
          },
          select: { id: true },
        });
        // The voided lines are inactive now (trigger), so the copy can hold the same events.
        await tx.invoiceItem.createMany({
          data: inv.items.map((i) => ({
            centerId: tenant.centerId,
            invoiceId: copy.id,
            position: i.position,
            kind: i.kind,
            description: i.description,
            serviceId: i.serviceId,
            appointmentId: i.appointmentId,
            packageEnrollmentId: i.packageEnrollmentId,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            amount: i.amount,
            discountType: i.discountType,
            discountValue: i.discountValue,
            discountAmount: i.discountAmount,
            totalAmount: i.totalAmount,
          })),
        });
        await this.record(
          tx,
          tenant,
          'invoice.draft_created',
          copy.id,
          {
            patientCode: inv.patient.code,
            reissueOf: inv.number,
            lines: inv.items.length,
          },
          ip,
        );
        copyId = copy.id;
      }
      await this.record(
        tx,
        tenant,
        'invoice.voided',
        id,
        {
          number: inv.number,
          patientCode: inv.patient.code,
          total: money(inv.totalAmount),
          releasedAllocations: active.length,
          releasedAmount: money(released),
          ...(copyId && { reissueId: copyId }),
        },
        ip,
      );
      return copyId;
    });
    return { invoice: await this.get(tenant, id), reissueId };
  }

  // ── Charges not yet invoiced ──────────────────────────────────────────────

  /**
   * What the patient could be invoiced for that isn't on an invoice yet: packages
   * bought, assessments booked, and completed sessions no package pays for (with
   * `includeUpcoming`, booked ones too, to invoice in advance). Each comes with the
   * price it would be charged, or why it can't be priced. Scheduled appointments are
   * never charged on their own: staff pick from this list, or a billing policy does.
   */
  async charges(tenant: TenantContext, query: ChargesQuery) {
    await this.visiblePatient(this.prisma, tenant, query.patientId);
    const center = await billingCenter(this.prisma, tenant);
    const notCharged = { none: { active: true, kind: { in: FEE_KINDS } } };
    const sessionStatuses: AppointmentStatus[] = query.includeUpcoming
      ? [
          AppointmentStatus.SCHEDULED,
          AppointmentStatus.CONFIRMED,
          AppointmentStatus.COMPLETED,
        ]
      : [AppointmentStatus.COMPLETED];
    const [enrollments, appointments, services] = await Promise.all([
      this.prisma.packageEnrollment.findMany({
        where: {
          centerId: tenant.centerId,
          patientId: query.patientId,
          state: { not: PackageEnrollmentState.CANCELLED },
          finalPrice: { gt: 0 },
          invoiceItems: {
            none: { active: true, kind: InvoiceItemKind.PACKAGE },
          },
        },
        select: enrollmentFacts,
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.appointment.findMany({
        where: {
          centerId: tenant.centerId,
          patientId: query.patientId,
          invoiceItems: notCharged,
          packageReservations: { none: { status: { in: COVERING } } },
          OR: [
            {
              type: AppointmentType.ASSESSMENT,
              status: {
                in: [
                  AppointmentStatus.SCHEDULED,
                  AppointmentStatus.CONFIRMED,
                  AppointmentStatus.COMPLETED,
                ],
              },
            },
            {
              type: AppointmentType.THERAPY_SESSION,
              status: { in: sessionStatuses },
            },
          ],
        },
        select: appointmentFacts,
        orderBy: { startAt: 'asc' },
        take: 200,
      }),
      this.feeServices(this.prisma, tenant),
    ]);
    const items = [
      ...enrollments.map((e) => ({
        key: `enrollment:${e.id}`,
        kind: InvoiceItemKind.PACKAGE,
        description: `${e.packageName} (${e.code})`,
        date: formatIsoDate(instantToZoned(e.createdAt, center.timeZone).date),
        packageEnrollmentId: e.id,
        appointmentId: null,
        appointment: null,
        service: null,
        unitPrice: money(e.finalPrice),
        problem: null,
      })),
      ...appointments.map((a) => {
        const service = this.matchService(services, a);
        const date = instantToZoned(a.startAt, center.timeZone);
        return {
          key: `appointment:${a.id}`,
          kind:
            a.type === AppointmentType.ASSESSMENT
              ? InvoiceItemKind.ASSESSMENT_FEE
              : InvoiceItemKind.SESSION_FEE,
          description: service
            ? `${service.name} · ${dateText(date.date)}`
            : `${a.therapyType.name} · ${dateText(date.date)}`,
          date: formatIsoDate(date.date),
          packageEnrollmentId: null,
          appointmentId: a.id,
          appointment: {
            id: a.id,
            type: a.type,
            status: a.status,
            date: formatIsoDate(date.date),
            therapyType: a.therapyType,
            therapist: a.therapist,
          },
          service: service && {
            id: service.id,
            code: service.code,
            name: service.name,
          },
          unitPrice: service ? money(service.price) : null,
          problem: service ? null : this.noServiceMessage(a),
        };
      }),
    ];
    return { items };
  }

  // ── Automatic invoicing ───────────────────────────────────────────────────

  /**
   * Invoices one event on its own, issued straight away, because the center's billing
   * policy says so. Called after the event's own transaction has committed, so a
   * billing problem never undoes a booking, enrollment or completed session; anything
   * not invoiced here stays in the patient's uninvoiced charges for staff. Already
   * invoiced events are left alone.
   */
  async invoiceEvent(
    tenant: TenantContext,
    patientId: string,
    item: Pick<
      InvoiceItemInput,
      'kind' | 'appointmentId' | 'packageEnrollmentId'
    >,
  ) {
    try {
      const taken = await this.existingCharges(this.prisma, tenant, [item]);
      if (taken.length) return null;
      const invoice = await this.create(
        tenant,
        { patientId, items: [item], issue: true },
        null,
        { automatic: true },
      );
      return invoice.id;
    } catch (error) {
      if (this.raceToCharge(error)) return null;
      const code = (error as { response?: { code?: string } })?.response?.code;
      this.logger.warn(
        `Automatic ${item.kind} invoice skipped for center ${tenant.centerId}: ${code ?? (error as Error).message}`,
      );
      return null;
    }
  }

  private record(
    tx: Tx,
    tenant: TenantContext,
    action: string,
    entityId: string,
    metadata: Record<string, unknown>,
    ip: string | null,
  ) {
    return this.audit.record(
      {
        centerId: tenant.centerId,
        actorUserId: tenant.userId,
        action,
        entityType: 'Invoice',
        entityId,
        metadata: metadata as Prisma.InputJsonValue,
        ipAddress: ip,
      },
      tx,
    );
  }
}
