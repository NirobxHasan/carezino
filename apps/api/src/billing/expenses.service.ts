import { Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import type { TenantContext } from '../auth/auth-context';
import { addDays } from '../common/time';
import { Prisma } from '../generated/prisma/client';
import { ExpenseStatus } from '../generated/prisma/enums';
import { fieldError } from '../patients/contacts';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateExpenseDto,
  ListExpensesQuery,
  UpdateExpenseDto,
  VoidExpenseDto,
} from './dto';
import { BILLING_LIMITS } from './rules';
import { BillingSettingsService } from './settings.service';
import {
  Decimal,
  billingCenter,
  can,
  conflict,
  instantRange,
  iso,
  isUniqueViolation,
  lockRows,
  methodSelect,
  money,
  notFound,
  parseDate,
  userSelect,
  type BillingCenter,
  type Tx,
} from './shared';

const expenseNotFound = () => notFound('Expense');

export const expenseSelect = {
  id: true,
  expenseDate: true,
  description: true,
  amount: true,
  reference: true,
  notes: true,
  status: true,
  revision: true,
  createdAt: true,
  updatedAt: true,
  voidedAt: true,
  voidReason: true,
  category: { select: { id: true, name: true, isActive: true } },
  method: methodSelect,
  createdBy: userSelect,
  updatedBy: userSelect,
  voidedBy: userSelect,
  _count: { select: { revisions: true } },
} satisfies Prisma.ExpenseSelect;

type ExpenseRow = Prisma.ExpenseGetPayload<{ select: typeof expenseSelect }>;

export function toExpense(tenant: TenantContext, row: ExpenseRow) {
  const { _count, amount, expenseDate, ...rest } = row;
  const recorded = row.status === ExpenseStatus.RECORDED;
  return {
    ...rest,
    expenseDate: iso(expenseDate),
    amount: money(amount),
    corrections: _count.revisions,
    actions: {
      correct: recorded && can(tenant, 'expenses.create'),
      void: recorded && can(tenant, 'expenses.void'),
    },
  };
}

/** The editable fields as a revision records them. */
const snapshot = (e: {
  categoryId: string;
  expenseDate: Date;
  description: string;
  amount: Decimal;
  methodId: string;
  reference: string | null;
  notes: string | null;
}) => ({
  categoryId: e.categoryId,
  expenseDate: iso(e.expenseDate),
  description: e.description,
  amount: money(e.amount),
  methodId: e.methodId,
  reference: e.reference,
  notes: e.notes,
});

/**
 * Money the center spent: rent, supplies, therapist payments recorded by hand. Not
 * payroll and not a ledger: just what was paid, when, how and for what. Expenses are
 * never deleted; a correction keeps the earlier values in ExpenseRevision, and a
 * mistaken entry is voided with a reason.
 */
@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: BillingSettingsService,
  ) {}

  async list(tenant: TenantContext, query: ListExpensesQuery) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const center = await billingCenter(this.prisma, tenant);
    const { dates } = instantRange(query.from, query.to, center.timeZone);
    const where: Prisma.ExpenseWhereInput = {
      centerId: tenant.centerId,
      ...(query.categoryId && { categoryId: query.categoryId }),
      ...(query.methodId && { methodId: query.methodId }),
      ...(query.status && { status: query.status }),
      ...(dates && { expenseDate: dates }),
      ...(query.search && {
        OR: [
          { description: { contains: query.search, mode: 'insensitive' } },
          { reference: { contains: query.search, mode: 'insensitive' } },
        ],
      }),
    };
    const [total, sum, rows] = await Promise.all([
      this.prisma.expense.count({ where }),
      this.prisma.expense.aggregate({
        where: { ...where, status: ExpenseStatus.RECORDED },
        _sum: { amount: true },
      }),
      this.prisma.expense.findMany({
        where,
        select: expenseSelect,
        orderBy: [
          { expenseDate: 'desc' },
          { createdAt: 'desc' },
          { id: 'asc' },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      items: rows.map((r) => toExpense(tenant, r)),
      total,
      page,
      pageSize,
      /** Recorded (not void) expenses matching the filters, across all pages */
      totalAmount: money(sum._sum.amount ?? new Decimal(0)),
    };
  }

  async get(tenant: TenantContext, id: string) {
    const row = await this.prisma.expense.findFirst({
      where: { id, centerId: tenant.centerId },
      select: {
        ...expenseSelect,
        revisions: {
          select: {
            id: true,
            reason: true,
            changed: true,
            before: true,
            after: true,
            createdAt: true,
            createdBy: userSelect,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!row) throw expenseNotFound();
    const { revisions, ...rest } = row;
    return { ...toExpense(tenant, rest), revisions };
  }

  private expenseDate(center: BillingCenter, value: string) {
    const date = parseDate(value, 'expenseDate');
    if (
      date > center.today ||
      date < addDays(center.today, -BILLING_LIMITS.backdateDays)
    ) {
      throw fieldError(
        'expenseDate',
        'Choose a date within the last year, not in the future',
        'VALIDATION_FAILED',
      );
    }
    return date;
  }

  private amount(value: string) {
    const amount = new Decimal(value);
    if (amount.lte(0))
      throw fieldError(
        'amount',
        'Enter an amount above zero',
        'VALIDATION_FAILED',
      );
    return amount;
  }

  async create(
    tenant: TenantContext,
    dto: CreateExpenseDto,
    ip: string | null,
  ) {
    const repeat = async () =>
      dto.requestId &&
      (await this.prisma.expense.findFirst({
        where: { centerId: tenant.centerId, requestId: dto.requestId },
        select: { id: true },
      }));
    const earlier = await repeat();
    if (earlier) return this.get(tenant, earlier.id);
    const center = await billingCenter(this.prisma, tenant);
    const amount = this.amount(dto.amount);
    const expenseDate = this.expenseDate(center, dto.expenseDate);
    const [category, method] = await Promise.all([
      this.settings.activeCategory(this.prisma, tenant, dto.categoryId),
      this.settings.activeMethod(this.prisma, tenant, dto.methodId),
    ]);
    let id: string;
    try {
      id = await this.prisma.$transaction(async (tx) => {
        const row = await tx.expense.create({
          data: {
            centerId: tenant.centerId,
            categoryId: category.id,
            expenseDate,
            description: dto.description,
            amount,
            methodId: method.id,
            reference: dto.reference ?? null,
            notes: dto.notes ?? null,
            requestId: dto.requestId ?? null,
            createdById: tenant.userId,
          },
          select: { id: true },
        });
        await this.record(
          tx,
          tenant,
          'expense.recorded',
          row.id,
          {
            category: category.name,
            amount: money(amount),
            expenseDate: dto.expenseDate,
            method: method.name,
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
      throw error;
    }
    return this.get(tenant, id);
  }

  /** Corrects a recorded expense; the values before and after are kept with the reason. */
  async update(
    tenant: TenantContext,
    id: string,
    dto: UpdateExpenseDto,
    ip: string | null,
  ) {
    const center = await billingCenter(this.prisma, tenant);
    await this.prisma.$transaction(async (tx) => {
      await lockRows(tx, 'Expense', tenant, [id]);
      const e = await tx.expense.findFirst({
        where: { id, centerId: tenant.centerId },
      });
      if (!e) throw expenseNotFound();
      if (e.status === ExpenseStatus.VOID)
        throw conflict(
          'EXPENSE_VOID',
          'This expense is void, so it can’t be corrected.',
        );
      if (dto.revision !== undefined && dto.revision !== e.revision) {
        throw conflict(
          'EXPENSE_CHANGED',
          'Someone else corrected this expense meanwhile. Reload it to see their change.',
        );
      }
      const next = {
        categoryId: dto.categoryId ?? e.categoryId,
        expenseDate: dto.expenseDate
          ? this.expenseDate(center, dto.expenseDate)
          : e.expenseDate,
        description: dto.description ?? e.description,
        amount: dto.amount ? this.amount(dto.amount) : e.amount,
        methodId: dto.methodId ?? e.methodId,
        reference: dto.reference !== undefined ? dto.reference : e.reference,
        notes: dto.notes !== undefined ? dto.notes : e.notes,
      };
      if (next.categoryId !== e.categoryId)
        await this.settings.activeCategory(tx, tenant, next.categoryId);
      if (next.methodId !== e.methodId)
        await this.settings.activeMethod(tx, tenant, next.methodId);
      const before = snapshot(e);
      const after = snapshot(next);
      const changed = (Object.keys(after) as (keyof typeof after)[]).filter(
        (k) => before[k] !== after[k],
      );
      if (!changed.length) return;
      await tx.expense.update({
        where: { id },
        data: {
          ...next,
          revision: { increment: 1 },
          updatedById: tenant.userId,
        },
      });
      await tx.expenseRevision.create({
        data: {
          centerId: tenant.centerId,
          expenseId: id,
          reason: dto.reason,
          changed,
          before,
          after,
          createdById: tenant.userId,
        },
      });
      await this.record(
        tx,
        tenant,
        'expense.corrected',
        id,
        {
          fields: changed,
          ...(changed.includes('amount') && {
            amount: { from: before.amount, to: after.amount },
          }),
        },
        ip,
      );
    });
    return this.get(tenant, id);
  }

  async void(
    tenant: TenantContext,
    id: string,
    dto: VoidExpenseDto,
    ip: string | null,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await lockRows(tx, 'Expense', tenant, [id]);
      const e = await tx.expense.findFirst({
        where: { id, centerId: tenant.centerId },
        select: { status: true, amount: true, expenseDate: true },
      });
      if (!e) throw expenseNotFound();
      if (e.status === ExpenseStatus.VOID)
        throw conflict('ALREADY_VOID', 'This expense is already void.');
      await tx.expense.update({
        where: { id },
        data: {
          status: ExpenseStatus.VOID,
          voidedAt: new Date(),
          voidedById: tenant.userId,
          voidReason: dto.reason,
        },
      });
      await this.record(
        tx,
        tenant,
        'expense.voided',
        id,
        {
          amount: money(e.amount),
          expenseDate: iso(e.expenseDate),
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
  ) {
    return this.audit.record(
      {
        centerId: tenant.centerId,
        actorUserId: tenant.userId,
        action,
        entityType: 'Expense',
        entityId,
        metadata: metadata as Prisma.InputJsonValue,
        ipAddress: ip,
      },
      tx,
    );
  }
}
