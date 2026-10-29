import { Injectable } from '@nestjs/common';

import type { TenantContext } from '../auth/auth-context';
import { addDays, formatIsoDate } from '../common/time';
import { Prisma } from '../generated/prisma/client';
import {
  ExpenseStatus,
  InvoiceStatus,
  PaymentStatus,
} from '../generated/prisma/enums';
import { visiblePatients } from '../patients/access';
import { PrismaService } from '../prisma/prisma.service';
import type { CollectionsQuery, DuesQuery, RangeQuery } from './dto';
import { expenseSelect, toExpense } from './expenses.service';
import {
  InvoicesService,
  contactOf,
  contactSelect,
  invoiceSummarySelect,
  toInvoiceSummary,
} from './invoices.service';
import { paymentSummarySelect, toPaymentSummary } from './payments.service';
import {
  AGING_BUCKETS,
  OPEN_INVOICE_STATUSES,
  OVERDUE_RANGES,
  type AgingBucket,
} from './rules';
import {
  Decimal,
  billingCenter,
  can,
  instantRange,
  money,
  notFound,
  type BillingCenter,
} from './shared';

const ZERO = new Decimal(0);
const dec = (v: Prisma.Decimal | string | null | undefined) =>
  v === null || v === undefined ? ZERO : new Decimal(v);

/**
 * Financial summaries, all computed by the database (aggregates and GROUP BY), never by
 * loading rows. The terms are deliberate and the same on every screen:
 * - Collections: money received in the period (by when it was received), excluding
 *   payments since reversed as recorded in error. Refunds are shown separately, by
 *   when they were paid out; net collections = collections − refunds.
 * - Invoiced: totals of invoices dated in the period that are issued (void ones and
 *   drafts excluded). Not revenue, and not money received.
 * - Outstanding dues: what open invoices still owe, today.
 * - Unapplied credit: money received but neither applied to invoices nor refunded.
 * - Expenses: recorded (not void) expenses dated in the period.
 * - Net cash movement: collections − refunds − expenses, across every payment method.
 *   It's money in minus money out, not profit.
 * Dates are the center's calendar dates; a period with no dates given is this month.
 */
@Injectable()
export class FinanceReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invoices: InvoicesService,
  ) {}

  /** The period asked for, or this month to date, as dates and instants. */
  private period(center: BillingCenter, query: RangeQuery) {
    const today = formatIsoDate(center.today);
    const from =
      query.from ?? (query.to ? undefined : `${today.slice(0, 8)}01`);
    const to = query.to ?? today;
    const range = instantRange(from, to, center.timeZone);
    return { ...range, fromText: from ?? null, toText: to };
  }

  async summary(tenant: TenantContext, query: RangeQuery) {
    const center = await billingCenter(this.prisma, tenant);
    const period = this.period(center, query);
    const todayText = formatIsoDate(center.today);
    const today = instantRange(todayText, todayText, center.timeZone);
    const centerId = tenant.centerId;
    const recorded = { centerId, status: PaymentStatus.RECORDED };
    const open = { centerId, status: { in: OPEN_INVOICE_STATUSES } };
    const [
      collected,
      collectedToday,
      refunds,
      refundsToday,
      invoiced,
      outstanding,
      overdue,
      credit,
      expenses,
      methodPayments,
      methodRefunds,
      methodExpenses,
      methods,
      recentPayments,
      openInvoices,
      recentExpenses,
    ] = await Promise.all([
      this.prisma.payment.aggregate({
        where: { ...recorded, collectedAt: period.instants },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.payment.aggregate({
        where: { ...recorded, collectedAt: today.instants },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.refund.aggregate({
        where: { centerId, refundedAt: period.instants },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.refund.aggregate({
        where: { centerId, refundedAt: today.instants },
        _sum: { amount: true },
      }),
      this.prisma.invoice.aggregate({
        where: {
          centerId,
          status: { notIn: [InvoiceStatus.DRAFT, InvoiceStatus.VOID] },
          invoiceDate: period.dates,
        },
        _sum: { totalAmount: true },
        _count: true,
      }),
      this.prisma.invoice.aggregate({
        where: open,
        _sum: { totalAmount: true, paidAmount: true },
        _count: true,
      }),
      this.prisma.invoice.aggregate({
        where: { ...open, dueDate: { lt: center.today } },
        _sum: { totalAmount: true, paidAmount: true },
        _count: true,
      }),
      this.prisma.payment.aggregate({
        where: recorded,
        _sum: { amount: true, allocatedAmount: true, refundedAmount: true },
      }),
      this.prisma.expense.aggregate({
        where: {
          centerId,
          status: ExpenseStatus.RECORDED,
          expenseDate: period.dates,
        },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.payment.groupBy({
        by: ['methodId'],
        where: { ...recorded, collectedAt: period.instants },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.refund.groupBy({
        by: ['methodId'],
        where: { centerId, refundedAt: period.instants },
        _sum: { amount: true },
      }),
      this.prisma.expense.groupBy({
        by: ['methodId'],
        where: {
          centerId,
          status: ExpenseStatus.RECORDED,
          expenseDate: period.dates,
        },
        _sum: { amount: true },
      }),
      this.prisma.paymentMethod.findMany({
        where: { centerId },
        select: { id: true, name: true, displayOrder: true },
        orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.payment.findMany({
        where: { centerId },
        select: paymentSummarySelect,
        orderBy: [{ collectedAt: 'desc' }, { id: 'asc' }],
        take: 8,
      }),
      this.prisma.invoice.findMany({
        where: open,
        select: invoiceSummarySelect,
        orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
        take: 8,
      }),
      this.prisma.expense.findMany({
        where: { centerId },
        select: expenseSelect,
        orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }],
        take: 8,
      }),
    ]);
    const collections = dec(collected._sum.amount);
    const refunded = dec(refunds._sum.amount);
    const spent = dec(expenses._sum.amount);
    const byMethod = methods
      .map((m) => {
        const inflow = dec(
          methodPayments.find((p) => p.methodId === m.id)?._sum.amount,
        );
        const refundsOut = dec(
          methodRefunds.find((r) => r.methodId === m.id)?._sum.amount,
        );
        const expensesOut = dec(
          methodExpenses.find((e) => e.methodId === m.id)?._sum.amount,
        );
        return {
          method: { id: m.id, name: m.name },
          payments:
            methodPayments.find((p) => p.methodId === m.id)?._count ?? 0,
          collected: money(inflow),
          refunds: money(refundsOut),
          expenses: money(expensesOut),
          net: money(inflow.minus(refundsOut).minus(expensesOut)),
        };
      })
      .filter(
        (m) => m.payments > 0 || m.refunds !== '0.00' || m.expenses !== '0.00',
      );
    const owed = (a: {
      _sum: {
        totalAmount: Prisma.Decimal | null;
        paidAmount: Prisma.Decimal | null;
      };
    }) => dec(a._sum.totalAmount).minus(dec(a._sum.paidAmount));
    return {
      currency: center.currency,
      from: period.fromText,
      to: period.toText,
      today: todayText,
      todayCollections: money(dec(collectedToday._sum.amount)),
      todayPayments: collectedToday._count,
      todayRefunds: money(dec(refundsToday._sum.amount)),
      collections: money(collections),
      payments: collected._count,
      refunds: money(refunded),
      netCollections: money(collections.minus(refunded)),
      invoiced: money(dec(invoiced._sum.totalAmount)),
      invoiceCount: invoiced._count,
      outstanding: money(owed(outstanding)),
      outstandingInvoices: outstanding._count,
      overdue: money(owed(overdue)),
      overdueInvoices: overdue._count,
      unappliedCredit: money(
        dec(credit._sum.amount)
          .minus(dec(credit._sum.allocatedAmount))
          .minus(dec(credit._sum.refundedAmount)),
      ),
      expenses: money(spent),
      expenseCount: expenses._count,
      netCashMovement: money(collections.minus(refunded).minus(spent)),
      byMethod,
      recentPayments: recentPayments.map((p) => toPaymentSummary(tenant, p)),
      outstandingList: openInvoices.map((i) =>
        toInvoiceSummary(tenant, i, center.today),
      ),
      recentExpenses: recentExpenses.map((e) => toExpense(tenant, e)),
    };
  }

  // ── Dues ──────────────────────────────────────────────────────────────────

  private agingWhere(
    bucket: AgingBucket,
    today: Date,
  ): Prisma.InvoiceWhereInput {
    if (bucket === 'NOT_DUE')
      return { OR: [{ dueDate: null }, { dueDate: { gte: today } }] };
    const [min, max] = OVERDUE_RANGES[bucket];
    return {
      dueDate: {
        lte: addDays(today, -min),
        ...(max !== null && { gte: addDays(today, -max) }),
      },
    };
  }

  /**
   * Open invoices with what's still owed, oldest due first, the payer's contact, and
   * totals per aging bucket across all of them (not just the page).
   */
  async dues(tenant: TenantContext, query: DuesQuery) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const center = await billingCenter(this.prisma, tenant);
    const { dates } = instantRange(query.from, query.to, center.timeZone);
    const due = instantRange(query.dueFrom, query.dueTo, center.timeZone).dates;
    const search = query.search;
    const digits = search
      ?.replace(/[\s\-().]/g, '')
      .replace(/^\+?88(?=01)/, '');
    const phoneLike = digits !== undefined && /^\+?\d{3,}$/.test(digits);
    const base: Prisma.InvoiceWhereInput = {
      AND: [
        { centerId: tenant.centerId, status: { in: OPEN_INVOICE_STATUSES } },
        {
          ...(query.patientId && { patientId: query.patientId }),
          ...(dates && { invoiceDate: dates }),
          ...(due && { dueDate: due }),
        },
        query.overdue ? { dueDate: { lt: center.today } } : {},
        query.therapyTypeId
          ? {
              items: {
                some: {
                  OR: [
                    { appointment: { therapyTypeId: query.therapyTypeId } },
                    {
                      packageEnrollment: {
                        therapyTypes: {
                          some: { therapyTypeId: query.therapyTypeId },
                        },
                      },
                    },
                  ],
                },
              },
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
                ...(phoneLike
                  ? [
                      { patient: { mobile: { contains: digits } } },
                      {
                        patient: {
                          guardians: {
                            some: {
                              guardian: { mobile: { contains: digits } },
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
    const where: Prisma.InvoiceWhereInput = query.aging
      ? { AND: [base, this.agingWhere(query.aging, center.today)] }
      : base;
    const [total, rows, all, ...buckets] = await Promise.all([
      this.prisma.invoice.count({ where }),
      this.prisma.invoice.findMany({
        where,
        select: {
          ...invoiceSummarySelect,
          patient: {
            select: {
              ...invoiceSummarySelect.patient.select,
              ...contactSelect.select,
            },
          },
        },
        orderBy: [
          { dueDate: { sort: 'asc', nulls: 'last' } },
          { invoiceDate: 'asc' },
          { id: 'asc' },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.invoice.aggregate({
        where,
        _sum: { totalAmount: true, paidAmount: true },
      }),
      ...AGING_BUCKETS.map((b) =>
        this.prisma.invoice.aggregate({
          where: { AND: [base, this.agingWhere(b, center.today)] },
          _sum: { totalAmount: true, paidAmount: true },
          _count: true,
        }),
      ),
    ]);
    return {
      currency: center.currency,
      items: rows.map((r) => ({
        ...toInvoiceSummary(tenant, r, center.today),
        contact: contactOf(r.patient),
      })),
      total,
      page,
      pageSize,
      outstanding: money(
        dec(all._sum.totalAmount).minus(dec(all._sum.paidAmount)),
      ),
      aging: AGING_BUCKETS.map((bucket, n) => ({
        bucket,
        invoices: buckets[n]._count,
        outstanding: money(
          dec(buckets[n]._sum.totalAmount).minus(
            dec(buckets[n]._sum.paidAmount),
          ),
        ),
      })),
    };
  }

  // ── Collections ───────────────────────────────────────────────────────────

  /**
   * The daily collection report: per center-local day, collector and method, what was
   * collected, what was recorded in error (reversed since, not counted), refunds paid
   * out, and the net. Callers with only finance_reports.read_own see their own.
   */
  async collections(tenant: TenantContext, query: CollectionsQuery) {
    const center = await billingCenter(this.prisma, tenant);
    const period = this.period(center, query);
    const collector = can(tenant, 'finance_reports.read')
      ? (query.collectedById ?? null)
      : tenant.userId;
    const tz = center.timeZone;
    const start = period.instants?.gte ?? new Date(0);
    const end = period.instants?.lt ?? addDays(new Date(), 1);
    const byCollector = (column: string) =>
      collector
        ? Prisma.sql`AND ${Prisma.raw(column)} = ${collector}::uuid`
        : Prisma.empty;
    const [payments, refunds] = await Promise.all([
      this.prisma.$queryRaw<
        {
          day: string;
          userId: string;
          methodId: string;
          count: number;
          collected: string;
          reversed: string;
          reversedCount: number;
        }[]
      >`
        SELECT ((p."collectedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date::text AS day,
               p."collectedById" AS "userId", p."methodId" AS "methodId",
               (count(*) FILTER (WHERE p."status" = 'RECORDED'))::int AS count,
               coalesce(sum(p."amount") FILTER (WHERE p."status" = 'RECORDED'), 0)::text AS collected,
               (count(*) FILTER (WHERE p."status" = 'REVERSED'))::int AS "reversedCount",
               coalesce(sum(p."amount") FILTER (WHERE p."status" = 'REVERSED'), 0)::text AS reversed
        FROM "Payment" p
        WHERE p."centerId" = ${tenant.centerId}::uuid
          AND p."collectedAt" >= ${start} AND p."collectedAt" < ${end}
          ${byCollector('p."collectedById"')}
        GROUP BY 1, 2, 3`,
      this.prisma.$queryRaw<
        {
          day: string;
          userId: string;
          methodId: string;
          count: number;
          amount: string;
        }[]
      >`
        SELECT ((r."refundedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date::text AS day,
               r."approvedById" AS "userId", r."methodId" AS "methodId",
               count(*)::int AS count, sum(r."amount")::text AS amount
        FROM "Refund" r
        WHERE r."centerId" = ${tenant.centerId}::uuid
          AND r."refundedAt" >= ${start} AND r."refundedAt" < ${end}
          ${byCollector('r."approvedById"')}
        GROUP BY 1, 2, 3`,
    ]);
    const userIds = [
      ...new Set([...payments, ...refunds].map((r) => r.userId)),
    ];
    const [users, methods] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, fullName: true },
      }),
      this.prisma.paymentMethod.findMany({
        where: { centerId: tenant.centerId },
        select: { id: true, name: true },
      }),
    ]);
    const rows = new Map<
      string,
      {
        date: string;
        collector: { id: string; fullName: string } | null;
        method: { id: string; name: string } | null;
        payments: number;
        collected: Decimal;
        reversedPayments: number;
        reversed: Decimal;
        refundCount: number;
        refunds: Decimal;
      }
    >();
    const row = (day: string, userId: string, methodId: string) => {
      const key = `${day}|${userId}|${methodId}`;
      let r = rows.get(key);
      if (!r) {
        r = {
          date: day,
          collector: users.find((u) => u.id === userId) ?? null,
          method: methods.find((m) => m.id === methodId) ?? null,
          payments: 0,
          collected: ZERO,
          reversedPayments: 0,
          reversed: ZERO,
          refundCount: 0,
          refunds: ZERO,
        };
        rows.set(key, r);
      }
      return r;
    };
    for (const p of payments) {
      const r = row(p.day, p.userId, p.methodId);
      r.payments += p.count;
      r.collected = r.collected.plus(dec(p.collected));
      r.reversedPayments += p.reversedCount;
      r.reversed = r.reversed.plus(dec(p.reversed));
    }
    for (const f of refunds) {
      const r = row(f.day, f.userId, f.methodId);
      r.refundCount += f.count;
      r.refunds = r.refunds.plus(dec(f.amount));
    }
    const list = [...rows.values()].sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        (a.collector?.fullName ?? '').localeCompare(
          b.collector?.fullName ?? '',
        ) ||
        (a.method?.name ?? '').localeCompare(b.method?.name ?? ''),
    );
    const sum = (pick: (r: (typeof list)[number]) => Decimal) =>
      list.reduce((s, r) => s.plus(pick(r)), ZERO);
    const collected = sum((r) => r.collected);
    const refunded = sum((r) => r.refunds);
    return {
      currency: center.currency,
      from: period.fromText,
      to: period.toText,
      /** Whose collections these are: null for everyone */
      collectedById: collector,
      rows: list.map((r) => ({
        ...r,
        collected: money(r.collected),
        reversed: money(r.reversed),
        refunds: money(r.refunds),
        net: money(r.collected.minus(r.refunds)),
      })),
      totals: {
        payments: list.reduce((s, r) => s + r.payments, 0),
        collected: money(collected),
        reversedPayments: list.reduce((s, r) => s + r.reversedPayments, 0),
        reversed: money(sum((r) => r.reversed)),
        refundCount: list.reduce((s, r) => s + r.refundCount, 0),
        refunds: money(refunded),
        net: money(collected.minus(refunded)),
      },
    };
  }

  // ── Expenses ──────────────────────────────────────────────────────────────

  async expensesSummary(tenant: TenantContext, query: RangeQuery) {
    const center = await billingCenter(this.prisma, tenant);
    const period = this.period(center, query);
    const where = {
      centerId: tenant.centerId,
      status: ExpenseStatus.RECORDED,
      expenseDate: period.dates,
    };
    const [byCategory, byMethod, categories, methods] = await Promise.all([
      this.prisma.expense.groupBy({
        by: ['categoryId'],
        where,
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.expense.groupBy({
        by: ['methodId'],
        where,
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.expenseCategory.findMany({
        where: { centerId: tenant.centerId },
        select: { id: true, name: true },
      }),
      this.prisma.paymentMethod.findMany({
        where: { centerId: tenant.centerId },
        select: { id: true, name: true },
      }),
    ]);
    const total = byCategory.reduce((s, c) => s.plus(dec(c._sum.amount)), ZERO);
    return {
      currency: center.currency,
      from: period.fromText,
      to: period.toText,
      categories: byCategory
        .map((c) => ({
          category: categories.find((x) => x.id === c.categoryId) ?? null,
          expenses: c._count,
          amount: money(dec(c._sum.amount)),
        }))
        .sort((a, b) => dec(b.amount).comparedTo(dec(a.amount))),
      methods: byMethod
        .map((m) => ({
          method: methods.find((x) => x.id === m.methodId) ?? null,
          expenses: m._count,
          amount: money(dec(m._sum.amount)),
        }))
        .sort((a, b) => dec(b.amount).comparedTo(dec(a.amount))),
      total: money(total),
      count: byCategory.reduce((s, c) => s + c._count, 0),
    };
  }

  // ── Package sales ─────────────────────────────────────────────────────────

  /**
   * Packages sold in the period (enrollments made then, cancelled ones included) with
   * what their invoices charged and what's been paid on those invoices. When an
   * invoice has other lines too, its total (after invoice discount and tax) and its
   * payments are shared out by line totals, so a paid invoice shows invoiced = collected.
   */
  async packageSales(tenant: TenantContext, query: RangeQuery) {
    const center = await billingCenter(this.prisma, tenant);
    const period = this.period(center, query);
    const start = period.instants?.gte ?? new Date(0);
    const end = period.instants?.lt ?? addDays(new Date(), 1);
    const rows = await this.prisma.$queryRaw<
      {
        packageId: string;
        name: string;
        code: string;
        enrollments: number;
        cancelled: number;
        agreed: string;
        invoiced: string;
        collected: string;
        uninvoiced: number;
      }[]
    >`
      WITH e AS (
        SELECT pe."id", pe."packageId", pe."finalPrice", pe."state"
        FROM "PackageEnrollment" pe
        WHERE pe."centerId" = ${tenant.centerId}::uuid
          AND pe."createdAt" >= ${start} AND pe."createdAt" < ${end}
      ), charged AS (
        SELECT ii."packageEnrollmentId" AS "enrollmentId", ii."totalAmount" AS line,
               i."totalAmount", i."paidAmount",
               i."subtotal" - i."discountAmount" + i."invoiceDiscountAmount" AS "linesTotal"
        FROM "InvoiceItem" ii
        JOIN "Invoice" i ON i."id" = ii."invoiceId"
        WHERE ii."kind" = 'PACKAGE' AND ii."active" AND i."status" NOT IN ('DRAFT', 'VOID')
          AND ii."packageEnrollmentId" IN (SELECT "id" FROM e)
      )
      SELECT e."packageId" AS "packageId", tp."name", tp."code",
             count(*)::int AS enrollments,
             (count(*) FILTER (WHERE e."state" = 'CANCELLED'))::int AS cancelled,
             sum(e."finalPrice")::text AS agreed,
             coalesce(sum(CASE WHEN c."linesTotal" > 0 THEN round(c."totalAmount" * c.line / c."linesTotal", 2) ELSE 0 END), 0)::text AS invoiced,
             coalesce(sum(CASE WHEN c."linesTotal" > 0 THEN round(c."paidAmount" * c.line / c."linesTotal", 2) ELSE 0 END), 0)::text AS collected,
             (count(*) FILTER (WHERE c."enrollmentId" IS NULL))::int AS uninvoiced
      FROM e
      JOIN "TherapyPackage" tp ON tp."id" = e."packageId"
      LEFT JOIN charged c ON c."enrollmentId" = e."id"
      GROUP BY e."packageId", tp."name", tp."code"
      ORDER BY sum(e."finalPrice") DESC`;
    const total = (key: 'agreed' | 'invoiced' | 'collected') =>
      money(rows.reduce((s, r) => s.plus(dec(r[key])), ZERO));
    return {
      currency: center.currency,
      from: period.fromText,
      to: period.toText,
      rows: rows.map((r) => ({
        package: { id: r.packageId, name: r.name, code: r.code },
        enrollments: r.enrollments,
        cancelled: r.cancelled,
        /** Enrollments without an issued invoice yet */
        uninvoiced: r.uninvoiced,
        agreed: money(dec(r.agreed)),
        invoiced: money(dec(r.invoiced)),
        collected: money(dec(r.collected)),
      })),
      totals: {
        enrollments: rows.reduce((s, r) => s + r.enrollments, 0),
        agreed: total('agreed'),
        invoiced: total('invoiced'),
        collected: total('collected'),
      },
    };
  }

  // ── Patient ───────────────────────────────────────────────────────────────

  /**
   * One patient's balance: what they owe, their unapplied credit and lifetime totals.
   * Each patient's account is their own, even when a guardian pays for several.
   */
  async patientSummary(tenant: TenantContext, patientId: string) {
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, ...visiblePatients(tenant) },
      select: { id: true, code: true, fullName: true },
    });
    if (!patient) throw notFound('Patient');
    const center = await billingCenter(this.prisma, tenant);
    const mine = { centerId: tenant.centerId, patientId };
    const [open, overdue, issued, drafts, refunds, credit, charges] =
      await Promise.all([
        this.prisma.invoice.aggregate({
          where: { ...mine, status: { in: OPEN_INVOICE_STATUSES } },
          _sum: { totalAmount: true, paidAmount: true },
          _count: true,
        }),
        this.prisma.invoice.aggregate({
          where: {
            ...mine,
            status: { in: OPEN_INVOICE_STATUSES },
            dueDate: { lt: center.today },
          },
          _sum: { totalAmount: true, paidAmount: true },
          _count: true,
        }),
        this.prisma.invoice.aggregate({
          where: {
            ...mine,
            status: { notIn: [InvoiceStatus.DRAFT, InvoiceStatus.VOID] },
          },
          _sum: { totalAmount: true, paidAmount: true },
        }),
        this.prisma.invoice.count({
          where: { ...mine, status: InvoiceStatus.DRAFT },
        }),
        this.prisma.refund.aggregate({
          where: { centerId: tenant.centerId, payment: { patientId } },
          _sum: { amount: true },
        }),
        this.invoices.patientCredit(this.prisma, tenant, patientId),
        can(tenant, 'invoices.create')
          ? this.invoices.charges(tenant, { patientId })
          : Promise.resolve(null),
      ]);
    return {
      patient,
      currency: center.currency,
      outstanding: money(
        dec(open._sum.totalAmount).minus(dec(open._sum.paidAmount)),
      ),
      openInvoices: open._count,
      overdue: money(
        dec(overdue._sum.totalAmount).minus(dec(overdue._sum.paidAmount)),
      ),
      overdueInvoices: overdue._count,
      unappliedCredit: money(credit),
      invoiced: money(dec(issued._sum.totalAmount)),
      paid: money(dec(issued._sum.paidAmount)),
      refunded: money(dec(refunds._sum.amount)),
      draftInvoices: drafts,
      /** Things that could be invoiced but aren't; null without invoices.create */
      uninvoicedCharges: charges && charges.items.length,
    };
  }
}
