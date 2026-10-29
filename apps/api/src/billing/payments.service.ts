import { Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import type { TenantContext } from '../auth/auth-context';
import { nextSequenceValue } from '../common/sequences';
import { Prisma } from '../generated/prisma/client';
import {
  AllocationReleaseReason,
  InvoiceStatus,
  PaymentStatus,
} from '../generated/prisma/enums';
import { visiblePatients } from '../patients/access';
import { fieldError } from '../patients/contacts';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AllocatePaymentDto,
  AllocationInput,
  ApplyCreditDto,
  CollectPaymentDto,
  ListPaymentsQuery,
  RefundPaymentDto,
  ReleaseAllocationDto,
  ReversePaymentDto,
} from './dto';
import { InvoicesService } from './invoices.service';
import {
  BILLING_LIMITS,
  OPEN_INVOICE_STATUSES,
  takeCredit,
  unappliedOf,
} from './rules';
import { BillingSettingsService } from './settings.service';
import {
  Decimal,
  billingCenter,
  can,
  changedMeanwhile,
  conflict,
  instantRange,
  isCheckViolation,
  isUniqueViolation,
  lockRows,
  methodSelect,
  money,
  notFound,
  pastInstant,
  patientSelect,
  toPatient,
  userSelect,
  type Tx,
} from './shared';

const paymentNotFound = () => notFound('Payment');

export const paymentSummarySelect = {
  id: true,
  number: true,
  status: true,
  amount: true,
  currency: true,
  allocatedAmount: true,
  refundedAmount: true,
  transactionReference: true,
  collectedAt: true,
  createdAt: true,
  reversedAt: true,
  patient: patientSelect,
  method: methodSelect,
  collectedBy: userSelect,
  allocations: {
    where: { releasedAt: null },
    select: { invoice: { select: { id: true, number: true } } },
  },
} satisfies Prisma.PaymentSelect;

export type PaymentSummaryRow = Prisma.PaymentGetPayload<{
  select: typeof paymentSummarySelect;
}>;

function paymentActions(tenant: TenantContext, row: PaymentSummaryRow) {
  const recorded = row.status === PaymentStatus.RECORDED;
  const unapplied = unappliedOf(row);
  return {
    allocate: recorded && unapplied.gt(0) && can(tenant, 'payments.collect'),
    refund: recorded && unapplied.gt(0) && can(tenant, 'payments.refund'),
    // Money already returned can't be "un-received": correct the rest by refund.
    reverse:
      recorded && row.refundedAmount.eq(0) && can(tenant, 'payments.reverse'),
    reallocate: recorded && can(tenant, 'payments.reallocate'),
  };
}

export function toPaymentSummary(
  tenant: TenantContext,
  row: PaymentSummaryRow,
) {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    patient: toPatient(row.patient),
    amount: money(row.amount),
    currency: row.currency,
    allocatedAmount: money(row.allocatedAmount),
    refundedAmount: money(row.refundedAmount),
    /** Credit left from it: neither applied to invoices nor refunded */
    unappliedAmount: money(unappliedOf(row)),
    method: row.method,
    transactionReference: row.transactionReference,
    collectedAt: row.collectedAt,
    collectedBy: row.collectedBy,
    reversedAt: row.reversedAt,
    invoices: row.allocations.map((a) => a.invoice),
    createdAt: row.createdAt,
    actions: paymentActions(tenant, row),
  };
}

const detailSelect = {
  ...paymentSummarySelect,
  notes: true,
  reversalReason: true,
  reversedBy: userSelect,
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
      invoice: {
        select: {
          id: true,
          number: true,
          status: true,
          invoiceDate: true,
          totalAmount: true,
          paidAmount: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  },
  refunds: {
    select: {
      id: true,
      amount: true,
      reason: true,
      reference: true,
      refundedAt: true,
      createdAt: true,
      method: methodSelect,
      approvedBy: userSelect,
    },
    orderBy: { refundedAt: 'asc' },
  },
} satisfies Prisma.PaymentSelect;

type DetailRow = Prisma.PaymentGetPayload<{ select: typeof detailSelect }>;

/** Locked invoice facts an allocation is checked against. */
interface OpenInvoice {
  id: string;
  number: string | null;
  patientId: string;
  status: InvoiceStatus;
  totalAmount: Decimal;
  paidAmount: Decimal;
}

const overpaid = (inv: { number: string | null }, outstanding: Decimal) =>
  conflict(
    'INVOICE_OVERPAYMENT',
    outstanding.gt(0)
      ? `${inv.number} has ${money(outstanding)} left to pay. Another payment may have just been recorded.`
      : `${inv.number} is already paid. Another payment may have just been recorded.`,
    { invoiceNumber: inv.number, outstanding: money(outstanding) },
  );

/**
 * Payments and how they're applied. A payment is money received, recorded once with
 * its receipt number and never edited. Allocations apply it to invoices of the same
 * patient; what isn't applied is the patient's credit, which later allocations,
 * refunds or nothing at all may use. Every change locks the invoices, then the
 * payments involved, and the database's CHECKs refuse anything that would pay an
 * invoice beyond its total or use more of a payment than it holds.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: BillingSettingsService,
    private readonly invoices: InvoicesService,
  ) {}

  // ── Reading ───────────────────────────────────────────────────────────────

  async list(tenant: TenantContext, query: ListPaymentsQuery) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const center = await billingCenter(this.prisma, tenant);
    const { instants } = instantRange(query.from, query.to, center.timeZone);
    const search = query.search;
    const f = this.prisma.payment.fields;
    const where: Prisma.PaymentWhereInput = {
      AND: [
        { centerId: tenant.centerId },
        {
          ...(query.patientId && { patientId: query.patientId }),
          ...(query.methodId && { methodId: query.methodId }),
          ...(query.collectedById && { collectedById: query.collectedById }),
          ...(query.status && { status: query.status }),
          ...(instants && { collectedAt: instants }),
        },
        query.withCredit
          ? {
              status: PaymentStatus.RECORDED,
              // Unapplied > 0 can't be one comparison, so: allocated < amount and
              // refunded < amount narrow it; the item's unappliedAmount is exact.
              allocatedAmount: { lt: f.amount },
              refundedAmount: { lt: f.amount },
            }
          : {},
        search
          ? {
              OR: [
                { number: { contains: search, mode: 'insensitive' } },
                {
                  transactionReference: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
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
    const [total, sum, rows] = await Promise.all([
      this.prisma.payment.count({ where }),
      this.prisma.payment.aggregate({
        where: { AND: [where, { status: PaymentStatus.RECORDED }] },
        _sum: { amount: true, refundedAmount: true },
      }),
      this.prisma.payment.findMany({
        where,
        select: paymentSummarySelect,
        orderBy: [{ collectedAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      items: rows.map((r) => toPaymentSummary(tenant, r)),
      total,
      page,
      pageSize,
      /** Recorded (not reversed) payments matching the filters, across all pages */
      totals: {
        amount: money(sum._sum.amount ?? new Decimal(0)),
        refunded: money(sum._sum.refundedAmount ?? new Decimal(0)),
      },
    };
  }

  private toDetail(tenant: TenantContext, row: DetailRow) {
    const summary = toPaymentSummary(tenant, {
      ...row,
      allocations: row.allocations.filter((a) => !a.releasedAt),
    });
    return {
      ...summary,
      notes: row.notes,
      reversalReason: row.reversalReason,
      reversedBy: row.reversedBy,
      allocations: row.allocations.map((a) => ({
        id: a.id,
        amount: money(a.amount),
        active: a.releasedAt === null,
        createdAt: a.createdAt,
        createdBy: a.createdBy,
        releasedAt: a.releasedAt,
        releasedBy: a.releasedBy,
        releaseReason: a.releaseReason,
        releaseNote: a.releaseNote,
        invoice: {
          ...a.invoice,
          invoiceDate: a.invoice.invoiceDate.toISOString().slice(0, 10),
          totalAmount: money(a.invoice.totalAmount),
          outstanding: money(
            OPEN_INVOICE_STATUSES.includes(a.invoice.status)
              ? a.invoice.totalAmount.minus(a.invoice.paidAmount)
              : new Decimal(0),
          ),
        },
      })),
      refunds: row.refunds.map((r) => ({ ...r, amount: money(r.amount) })),
      /**
       * Manual records: a bKash or bank reference here is what staff typed, not a
       * confirmation from the provider.
       */
      verified: false,
    };
  }

  async get(tenant: TenantContext, id: string) {
    const row = await this.prisma.payment.findFirst({
      where: { id, centerId: tenant.centerId },
      select: detailSelect,
    });
    if (!row) throw paymentNotFound();
    return this.toDetail(tenant, row);
  }

  async allocations(tenant: TenantContext, id: string) {
    const payment = await this.get(tenant, id);
    return { items: payment.allocations };
  }

  /** What a printed receipt shows: the center, the payment and where it went. */
  async receipt(tenant: TenantContext, id: string) {
    const [payment, center] = await Promise.all([
      this.get(tenant, id),
      billingCenter(this.prisma, tenant),
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
      payment,
    };
  }

  async patientPayments(tenant: TenantContext, patientId: string) {
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, ...visiblePatients(tenant) },
      select: { id: true },
    });
    if (!patient) throw notFound('Patient');
    const [payments, refunds] = await Promise.all([
      this.prisma.payment.findMany({
        where: { centerId: tenant.centerId, patientId },
        select: paymentSummarySelect,
        orderBy: [{ collectedAt: 'desc' }, { id: 'asc' }],
        take: 200,
      }),
      this.prisma.refund.findMany({
        where: { centerId: tenant.centerId, payment: { patientId } },
        select: {
          id: true,
          amount: true,
          reason: true,
          reference: true,
          refundedAt: true,
          method: methodSelect,
          approvedBy: userSelect,
          payment: { select: { id: true, number: true } },
        },
        orderBy: { refundedAt: 'desc' },
      }),
    ]);
    return {
      items: payments.map((p) => toPaymentSummary(tenant, p)),
      refunds: refunds.map((r) => ({ ...r, amount: money(r.amount) })),
    };
  }

  // ── Collecting ────────────────────────────────────────────────────────────

  private allocationsOf(inputs: AllocationInput[] | undefined) {
    const list = (inputs ?? []).map((a, n) => ({
      invoiceId: a.invoiceId,
      amount: new Decimal(a.amount),
      path: `allocations.${n}.amount`,
    }));
    const ids = new Set<string>();
    for (const a of list) {
      if (a.amount.lte(0))
        throw fieldError(
          a.path,
          'Enter an amount above zero',
          'VALIDATION_FAILED',
        );
      if (ids.has(a.invoiceId)) {
        throw fieldError(
          a.path.replace('amount', 'invoiceId'),
          'This invoice is listed twice',
          'VALIDATION_FAILED',
        );
      }
      ids.add(a.invoiceId);
    }
    return list;
  }

  /**
   * Locks the invoices and checks each can take its share: an open invoice of the
   * patient, not paid beyond its balance, and paid in full unless partial payments
   * are allowed.
   */
  private async lockInvoices(
    tx: Tx,
    tenant: TenantContext,
    patientId: string,
    allocations: { invoiceId: string; amount: Decimal; path: string }[],
    allowPartial: boolean,
  ) {
    await lockRows(
      tx,
      'Invoice',
      tenant,
      allocations.map((a) => a.invoiceId),
    );
    const rows: OpenInvoice[] = await tx.invoice.findMany({
      where: {
        id: { in: allocations.map((a) => a.invoiceId) },
        centerId: tenant.centerId,
      },
      select: {
        id: true,
        number: true,
        patientId: true,
        status: true,
        totalAmount: true,
        paidAmount: true,
      },
    });
    for (const a of allocations) {
      const inv = rows.find((r) => r.id === a.invoiceId);
      const field = a.path.replace('amount', 'invoiceId');
      if (!inv || inv.patientId !== patientId) {
        throw fieldError(
          field,
          'Choose one of this patient’s invoices',
          'INVOICE_NOT_FOUND',
        );
      }
      if (!OPEN_INVOICE_STATUSES.includes(inv.status)) {
        throw conflict(
          'INVOICE_NOT_OPEN',
          inv.status === InvoiceStatus.PAID
            ? `${inv.number} is already paid.`
            : inv.status === InvoiceStatus.DRAFT
              ? 'Issue the draft before collecting payment for it.'
              : `${inv.number} is void.`,
        );
      }
      const outstanding = inv.totalAmount.minus(inv.paidAmount);
      if (a.amount.gt(outstanding)) throw overpaid(inv, outstanding);
      if (!allowPartial && a.amount.lt(outstanding)) {
        throw fieldError(
          a.path,
          `Partial payments are switched off: collect the full ${money(outstanding)} for ${inv.number}`,
          'PARTIAL_PAYMENTS_OFF',
        );
      }
    }
    return rows;
  }

  /**
   * Records money received, with a receipt number, and applies it to the chosen
   * invoices in one transaction. Anything not applied becomes the patient's credit,
   * if the center takes advance payments. The same requestId sent twice records one
   * payment, so a double click or a retry after a timeout can't take money twice.
   */
  async collect(
    tenant: TenantContext,
    dto: CollectPaymentDto,
    ip: string | null,
  ) {
    const repeat = async () =>
      dto.requestId &&
      (await this.prisma.payment.findFirst({
        where: { centerId: tenant.centerId, requestId: dto.requestId },
        select: { id: true },
      }));
    const earlier = await repeat();
    if (earlier) return this.get(tenant, earlier.id);

    const patient = await this.prisma.patient.findFirst({
      where: { id: dto.patientId, ...visiblePatients(tenant) },
      select: { id: true, code: true },
    });
    if (!patient) {
      throw fieldError(
        'patientId',
        'This patient no longer exists. Search again.',
        'PATIENT_NOT_FOUND',
      );
    }
    const amount = new Decimal(dto.amount);
    if (amount.lte(0))
      throw fieldError(
        'amount',
        'Enter an amount above zero',
        'VALIDATION_FAILED',
      );
    if (amount.gt(BILLING_LIMITS.maxAmount)) {
      throw fieldError(
        'amount',
        'Enter up to 99,999,999.99',
        'VALIDATION_FAILED',
      );
    }
    const [settings, center, method] = await Promise.all([
      this.settings.settings(this.prisma, tenant.centerId),
      billingCenter(this.prisma, tenant),
      this.settings.activeMethod(this.prisma, tenant, dto.methodId),
    ]);
    if (method.requiresReference && !dto.transactionReference) {
      throw fieldError(
        'transactionReference',
        `Enter the ${method.name} transaction ID`,
        'REFERENCE_REQUIRED',
      );
    }
    const collectedAt = pastInstant(dto.collectedAt, 'collectedAt');
    const allocations = this.allocationsOf(dto.allocations);
    const applied = allocations.reduce(
      (s, a) => s.plus(a.amount),
      new Decimal(0),
    );
    if (applied.gt(amount)) {
      throw fieldError(
        'amount',
        `Applied amounts add up to ${money(applied)}, more than the payment`,
        'VALIDATION_FAILED',
      );
    }
    if (applied.lt(amount) && !settings.allowAdvancePayment) {
      throw fieldError(
        'amount',
        allocations.length
          ? `Advance payments are switched off: collect at most ${money(applied)}, what the invoices owe`
          : 'Advance payments are switched off: choose an invoice to pay',
        'ADVANCE_PAYMENTS_OFF',
      );
    }

    let id: string;
    try {
      id = await this.prisma.$transaction(async (tx) => {
        // A retry of a submission that got the locks first: return what it recorded.
        await lockRows(
          tx,
          'Invoice',
          tenant,
          allocations.map((a) => a.invoiceId),
        );
        if (dto.requestId) {
          const done = await tx.payment.findFirst({
            where: { centerId: tenant.centerId, requestId: dto.requestId },
            select: { id: true },
          });
          if (done) return done.id;
        }
        const invoices = await this.lockInvoices(
          tx,
          tenant,
          patient.id,
          allocations,
          settings.allowPartialPayment,
        );
        const n = await nextSequenceValue(tx, tenant.centerId, 'receipt');
        const number = `${settings.receiptPrefix}${String(n).padStart(6, '0')}`;
        const row = await tx.payment.create({
          data: {
            centerId: tenant.centerId,
            number,
            patientId: patient.id,
            amount,
            currency: center.currency,
            methodId: method.id,
            transactionReference: dto.transactionReference ?? null,
            collectedAt,
            collectedById: tenant.userId,
            notes: dto.notes ?? null,
            requestId: dto.requestId ?? null,
          },
          select: { id: true },
        });
        if (allocations.length) {
          await tx.paymentAllocation.createMany({
            data: allocations.map((a) => ({
              centerId: tenant.centerId,
              paymentId: row.id,
              invoiceId: a.invoiceId,
              amount: a.amount,
              requestId: dto.requestId ?? null,
              createdById: tenant.userId,
            })),
          });
        }
        await this.record(
          tx,
          tenant,
          'payment.collected',
          row.id,
          {
            number,
            patientCode: patient.code,
            amount: money(amount),
            method: method.name,
            invoices: allocations.map((a) => ({
              number: invoices.find((i) => i.id === a.invoiceId)!.number,
              amount: money(a.amount),
            })),
            unapplied: money(amount.minus(applied)),
          },
          ip,
        );
        return row.id;
      });
    } catch (error) {
      if (isUniqueViolation(error, 'requestId')) {
        const again = await repeat();
        if (again) return this.get(tenant, again.id);
      }
      if (isCheckViolation(error, 'Invoice_paid_check')) {
        throw conflict(
          'INVOICE_OVERPAYMENT',
          'Another payment for this invoice was recorded just now. Refresh and try again.',
        );
      }
      throw error;
    }
    return this.get(tenant, id);
  }

  /** Whether a request already made these allocations (a retried click). */
  private async allocatedBefore(tenant: TenantContext, requestId?: string) {
    if (!requestId) return false;
    const row = await this.prisma.paymentAllocation.findFirst({
      where: { centerId: tenant.centerId, requestId },
      select: { id: true },
    });
    return Boolean(row);
  }

  /** Applies more of an existing payment's credit to invoices of the same patient. */
  async allocate(
    tenant: TenantContext,
    id: string,
    dto: AllocatePaymentDto,
    ip: string | null,
  ) {
    if (await this.allocatedBefore(tenant, dto.requestId))
      return this.get(tenant, id);
    const allocations = this.allocationsOf(dto.allocations);
    const settings = await this.settings.settings(this.prisma, tenant.centerId);
    const payment = await this.prisma.payment.findFirst({
      where: { id, centerId: tenant.centerId },
      select: { patientId: true },
    });
    if (!payment) throw paymentNotFound();
    try {
      await this.prisma.$transaction(async (tx) => {
        const invoices = await this.lockInvoices(
          tx,
          tenant,
          payment.patientId,
          allocations,
          settings.allowPartialPayment,
        );
        await lockRows(tx, 'Payment', tenant, [id]);
        const p = await tx.payment.findUniqueOrThrow({
          where: { id },
          select: {
            number: true,
            status: true,
            amount: true,
            allocatedAmount: true,
            refundedAmount: true,
          },
        });
        if (p.status !== PaymentStatus.RECORDED)
          throw conflict(
            'PAYMENT_REVERSED',
            `${p.number} was reversed, so it can’t be applied.`,
          );
        const available = unappliedOf(p);
        const wanted = allocations.reduce(
          (s, a) => s.plus(a.amount),
          new Decimal(0),
        );
        if (wanted.gt(available)) {
          throw conflict(
            'INSUFFICIENT_CREDIT',
            `${p.number} has ${money(available)} left to apply.`,
            { available: money(available) },
          );
        }
        await tx.paymentAllocation.createMany({
          data: allocations.map((a) => ({
            centerId: tenant.centerId,
            paymentId: id,
            invoiceId: a.invoiceId,
            amount: a.amount,
            requestId: dto.requestId ?? null,
            createdById: tenant.userId,
          })),
        });
        await this.record(
          tx,
          tenant,
          'payment.allocated',
          id,
          {
            number: p.number,
            invoices: allocations.map((a) => ({
              number: invoices.find((i) => i.id === a.invoiceId)!.number,
              amount: money(a.amount),
            })),
          },
          ip,
        );
      });
    } catch (error) {
      if (
        isUniqueViolation(error) &&
        (await this.allocatedBefore(tenant, dto.requestId))
      ) {
        return this.get(tenant, id);
      }
      throw this.balanceConflict(error) ?? error;
    }
    return this.get(tenant, id);
  }

  /**
   * Pays an invoice from the patient's credit, taking it from their payments oldest
   * first. Each payment's credit is locked and re-read before it's used, so the same
   * credit can't be spent twice by concurrent requests.
   */
  async applyCredit(
    tenant: TenantContext,
    invoiceId: string,
    dto: ApplyCreditDto,
    ip: string | null,
  ) {
    const amount = new Decimal(dto.amount);
    if (amount.lte(0))
      throw fieldError(
        'amount',
        'Enter an amount above zero',
        'VALIDATION_FAILED',
      );
    if (await this.allocatedBefore(tenant, dto.requestId))
      return this.invoices.get(tenant, invoiceId);
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, centerId: tenant.centerId },
      select: { patientId: true },
    });
    if (!invoice) throw notFound('Invoice');
    const settings = await this.settings.settings(this.prisma, tenant.centerId);
    const candidates = await this.prisma.payment.findMany({
      where: {
        centerId: tenant.centerId,
        patientId: invoice.patientId,
        status: PaymentStatus.RECORDED,
      },
      select: { id: true },
    });
    try {
      await this.prisma.$transaction(async (tx) => {
        const [inv] = await this.lockInvoices(
          tx,
          tenant,
          invoice.patientId,
          [{ invoiceId, amount, path: 'amount' }],
          settings.allowPartialPayment,
        );
        await lockRows(
          tx,
          'Payment',
          tenant,
          candidates.map((c) => c.id),
        );
        const payments = await tx.payment.findMany({
          where: {
            id: { in: candidates.map((c) => c.id) },
            status: PaymentStatus.RECORDED,
          },
          select: {
            id: true,
            number: true,
            status: true,
            amount: true,
            allocatedAmount: true,
            refundedAmount: true,
            collectedAt: true,
          },
          orderBy: [{ collectedAt: 'asc' }, { id: 'asc' }],
        });
        const parts = takeCredit(payments, amount);
        if (!parts) {
          const available = payments.reduce(
            (s, p) => s.plus(unappliedOf(p)),
            new Decimal(0),
          );
          throw conflict(
            'INSUFFICIENT_CREDIT',
            `The patient has ${money(available)} of credit to apply.`,
            { available: money(available) },
          );
        }
        await tx.paymentAllocation.createMany({
          data: parts.map((p) => ({
            centerId: tenant.centerId,
            paymentId: p.paymentId,
            invoiceId,
            amount: p.amount,
            requestId: dto.requestId ?? null,
            createdById: tenant.userId,
          })),
        });
        await this.record(
          tx,
          tenant,
          'payment.credit_applied',
          invoiceId,
          {
            invoiceNumber: inv.number,
            amount: money(amount),
            payments: parts.map((p) => ({
              number: payments.find((x) => x.id === p.paymentId)!.number,
              amount: money(p.amount),
            })),
          },
          ip,
          'Invoice',
        );
      });
    } catch (error) {
      if (
        isUniqueViolation(error) &&
        (await this.allocatedBefore(tenant, dto.requestId))
      ) {
        return this.invoices.get(tenant, invoiceId);
      }
      throw this.balanceConflict(error) ?? error;
    }
    return this.invoices.get(tenant, invoiceId);
  }

  private balanceConflict(error: unknown) {
    if (isCheckViolation(error, 'Invoice_paid_check')) {
      return conflict(
        'INVOICE_OVERPAYMENT',
        'Another payment for this invoice was recorded just now. Refresh and try again.',
      );
    }
    if (isCheckViolation(error, 'Payment_balance_check')) {
      return conflict(
        'INSUFFICIENT_CREDIT',
        'This credit was used just now by someone else. Refresh and try again.',
      );
    }
    return null;
  }

  // ── Corrections ───────────────────────────────────────────────────────────

  /**
   * Takes an applied amount back off an invoice, e.g. one applied to the wrong
   * invoice. The allocation is kept, marked released with a reason, and the money is
   * the patient's credit again, to apply to the right invoice.
   */
  async releaseAllocation(
    tenant: TenantContext,
    paymentId: string,
    allocationId: string,
    dto: ReleaseAllocationDto,
    ip: string | null,
  ) {
    const allocation = await this.prisma.paymentAllocation.findFirst({
      where: { id: allocationId, paymentId, centerId: tenant.centerId },
      select: { invoiceId: true },
    });
    if (!allocation) throw notFound('Allocation');
    await this.prisma.$transaction(async (tx) => {
      await lockRows(tx, 'Invoice', tenant, [allocation.invoiceId]);
      await lockRows(tx, 'Payment', tenant, [paymentId]);
      const a = await tx.paymentAllocation.findUniqueOrThrow({
        where: { id: allocationId },
        select: {
          amount: true,
          releasedAt: true,
          payment: { select: { number: true, status: true } },
          invoice: { select: { number: true } },
        },
      });
      if (a.releasedAt)
        throw conflict(
          'ALREADY_RELEASED',
          'This was already taken off the invoice.',
        );
      await tx.paymentAllocation.update({
        where: { id: allocationId },
        data: {
          releasedAt: new Date(),
          releasedById: tenant.userId,
          releaseReason: AllocationReleaseReason.REALLOCATED,
          releaseNote: dto.reason,
        },
      });
      await this.record(
        tx,
        tenant,
        'payment.allocation_released',
        paymentId,
        {
          number: a.payment.number,
          invoiceNumber: a.invoice.number,
          amount: money(a.amount),
        },
        ip,
      );
    });
    return this.get(tenant, paymentId);
  }

  /**
   * Returns money to the payer, from what the payment hasn't applied to invoices. To
   * refund money that paid an invoice, take it off the invoice first (or void the
   * invoice). Package sessions are never touched: cancelling or adjusting an
   * enrollment is its own step in packages.
   */
  async refund(
    tenant: TenantContext,
    id: string,
    dto: RefundPaymentDto,
    ip: string | null,
  ) {
    const repeat = async () =>
      dto.requestId &&
      (await this.prisma.refund.findFirst({
        where: { centerId: tenant.centerId, requestId: dto.requestId },
        select: { id: true },
      }));
    if (await repeat()) return this.get(tenant, id);
    const amount = new Decimal(dto.amount);
    if (amount.lte(0))
      throw fieldError(
        'amount',
        'Enter an amount above zero',
        'VALIDATION_FAILED',
      );
    const exists = await this.prisma.payment.findFirst({
      where: { id, centerId: tenant.centerId },
      select: { id: true },
    });
    if (!exists) throw paymentNotFound();
    const method = await this.settings.activeMethod(
      this.prisma,
      tenant,
      dto.methodId,
    );
    const refundedAt = pastInstant(dto.refundedAt, 'refundedAt');
    try {
      await this.prisma.$transaction(async (tx) => {
        await lockRows(tx, 'Payment', tenant, [id]);
        if (dto.requestId) {
          const done = await tx.refund.findFirst({
            where: { centerId: tenant.centerId, requestId: dto.requestId },
            select: { id: true },
          });
          if (done) return;
        }
        const p = await tx.payment.findFirst({
          where: { id, centerId: tenant.centerId },
          select: {
            number: true,
            status: true,
            amount: true,
            allocatedAmount: true,
            refundedAmount: true,
            patient: { select: { code: true } },
          },
        });
        if (!p) throw paymentNotFound();
        if (p.status !== PaymentStatus.RECORDED)
          throw conflict(
            'PAYMENT_REVERSED',
            `${p.number} was reversed, so there’s nothing to refund.`,
          );
        const refundable = unappliedOf(p);
        if (amount.gt(refundable)) {
          throw conflict(
            'REFUND_EXCEEDS_AVAILABLE',
            refundable.gt(0)
              ? `Up to ${money(refundable)} of ${p.number} can be refunded. The rest is applied to invoices: take it off them first.`
              : `Nothing of ${p.number} is left to refund: it’s applied to invoices or already refunded.`,
            { refundable: money(refundable) },
          );
        }
        const row = await tx.refund.create({
          data: {
            centerId: tenant.centerId,
            paymentId: id,
            amount,
            methodId: method.id,
            reason: dto.reason,
            reference: dto.reference ?? null,
            refundedAt,
            approvedById: tenant.userId,
            requestId: dto.requestId ?? null,
          },
          select: { id: true },
        });
        await this.record(
          tx,
          tenant,
          'payment.refunded',
          id,
          {
            number: p.number,
            patientCode: p.patient.code,
            refundId: row.id,
            amount: money(amount),
            method: method.name,
          },
          ip,
        );
      });
    } catch (error) {
      if (isUniqueViolation(error, 'requestId') && (await repeat()))
        return this.get(tenant, id);
      if (isCheckViolation(error, 'Payment_balance_check')) {
        throw conflict(
          'REFUND_EXCEEDS_AVAILABLE',
          'This money was applied or refunded just now. Refresh and try again.',
        );
      }
      throw error;
    }
    return this.get(tenant, id);
  }

  /**
   * Cancels a payment recorded in error (wrong amount, wrong patient, entered twice):
   * it's taken off every invoice and counts for nothing from then on, but stays on
   * record with who reversed it and why. Payments with refunds can't be reversed.
   */
  async reverse(
    tenant: TenantContext,
    id: string,
    dto: ReversePaymentDto,
    ip: string | null,
  ) {
    const allocated = await this.prisma.paymentAllocation.findMany({
      where: { paymentId: id, centerId: tenant.centerId, releasedAt: null },
      select: { invoiceId: true },
    });
    await this.prisma.$transaction(async (tx) => {
      await lockRows(
        tx,
        'Invoice',
        tenant,
        allocated.map((a) => a.invoiceId),
      );
      await lockRows(tx, 'Payment', tenant, [id]);
      const p = await tx.payment.findFirst({
        where: { id, centerId: tenant.centerId },
        select: {
          number: true,
          status: true,
          amount: true,
          refundedAmount: true,
          patient: { select: { code: true } },
          allocations: {
            where: { releasedAt: null },
            select: { id: true, invoiceId: true },
          },
        },
      });
      if (!p) throw paymentNotFound();
      if (p.status === PaymentStatus.REVERSED)
        throw conflict('ALREADY_REVERSED', `${p.number} is already reversed.`);
      if (p.refundedAmount.gt(0)) {
        throw conflict(
          'PAYMENT_HAS_REFUNDS',
          `${p.number} has refunds, so it can’t be reversed. Refund what’s left instead.`,
        );
      }
      if (
        p.allocations.some(
          (a) => !allocated.some((b) => b.invoiceId === a.invoiceId),
        )
      ) {
        throw changedMeanwhile();
      }
      const now = new Date();
      if (p.allocations.length) {
        await tx.paymentAllocation.updateMany({
          where: { id: { in: p.allocations.map((a) => a.id) } },
          data: {
            releasedAt: now,
            releasedById: tenant.userId,
            releaseReason: AllocationReleaseReason.PAYMENT_REVERSED,
            releaseNote: dto.reason,
          },
        });
      }
      await tx.payment.update({
        where: { id },
        data: {
          status: PaymentStatus.REVERSED,
          reversedAt: now,
          reversedById: tenant.userId,
          reversalReason: dto.reason,
        },
      });
      await this.record(
        tx,
        tenant,
        'payment.reversed',
        id,
        {
          number: p.number,
          patientCode: p.patient.code,
          amount: money(p.amount),
          releasedAllocations: p.allocations.length,
        },
        ip,
      );
    });
    return this.get(tenant, id);
  }

  private record(
    tx: Tx,
    tenant: TenantContext,
    action: string,
    entityId: string,
    metadata: Record<string, unknown>,
    ip: string | null,
    entityType = 'Payment',
  ) {
    return this.audit.record(
      {
        centerId: tenant.centerId,
        actorUserId: tenant.userId,
        action,
        entityType,
        entityId,
        metadata: metadata as Prisma.InputJsonValue,
        ipAddress: ip,
      },
      tx,
    );
  }
}
