import { Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import type { TenantContext } from '../auth/auth-context';
import type { Prisma } from '../generated/prisma/client';
import { fieldError } from '../patients/contacts';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateExpenseCategoryDto,
  CreatePaymentMethodDto,
  ListConfigQuery,
  UpdateBillingSettingsDto,
  UpdateExpenseCategoryDto,
  UpdatePaymentMethodDto,
} from './dto';
import {
  Decimal,
  isUniqueViolation,
  money,
  notFound,
  type Db,
  type Tx,
} from './shared';

/**
 * Starting payment methods and expense categories, created the first time a center
 * looks at them. They're ordinary rows the center renames, reorders or deactivates;
 * nothing depends on these names.
 */
const DEFAULT_METHODS = [
  { name: 'Cash', requiresReference: false },
  { name: 'bKash', requiresReference: true },
  { name: 'Nagad', requiresReference: true },
  { name: 'Bank transfer', requiresReference: true },
  { name: 'Card', requiresReference: false },
  { name: 'Other', requiresReference: false },
];

const DEFAULT_EXPENSE_CATEGORIES = [
  'Rent',
  'Utilities',
  'Therapist payments',
  'Staff expenses',
  'Supplies',
  'Maintenance',
  'Marketing',
  'Miscellaneous',
];

const settingsSelect = {
  invoicePrefix: true,
  receiptPrefix: true,
  defaultDueDays: true,
  allowPartialPayment: true,
  allowAdvancePayment: true,
  allowManualDiscount: true,
  taxRate: true,
  taxLabel: true,
  assessmentBillingPolicy: true,
  sessionBillingPolicy: true,
  packageBillingPolicy: true,
  updatedAt: true,
} as const;

const methodFields = {
  id: true,
  name: true,
  requiresReference: true,
  isActive: true,
  displayOrder: true,
} as const;

const categoryFields = {
  id: true,
  name: true,
  isActive: true,
  displayOrder: true,
} as const;

const nameTaken = (what: string) =>
  fieldError('name', `A ${what} with this name already exists`, 'NAME_TAKEN');

const statusWhere = (status: ListConfigQuery['status']) =>
  status === 'ACTIVE'
    ? { isActive: true }
    : status === 'INACTIVE'
      ? { isActive: false }
      : {};

/**
 * Billing configuration of the active center: preferences, the payment methods money
 * moves by, and expense categories. Changes apply to what's recorded from then on;
 * invoices and payments keep what they were made with.
 */
@Injectable()
export class BillingSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The preferences row, created with its defaults on first use. */
  async settings(db: Db, centerId: string) {
    await db.centerBillingSettings.createMany({
      data: [{ centerId }],
      skipDuplicates: true,
    });
    return db.centerBillingSettings.findUniqueOrThrow({
      where: { centerId },
      select: settingsSelect,
    });
  }

  async get(tenant: TenantContext) {
    const [row, center] = await Promise.all([
      this.settings(this.prisma, tenant.centerId),
      this.prisma.center.findUniqueOrThrow({
        where: { id: tenant.centerId },
        select: { currency: true, timezone: true },
      }),
    ]);
    return {
      ...row,
      taxRate: money(row.taxRate),
      // The center's own, shown for reference; changed on the center profile.
      currency: center.currency,
      timezone: center.timezone,
    };
  }

  async update(
    tenant: TenantContext,
    dto: UpdateBillingSettingsDto,
    ip: string | null,
  ) {
    if (dto.taxRate !== undefined && new Decimal(dto.taxRate).gt(100)) {
      throw fieldError(
        'taxRate',
        'Enter a percentage from 0 to 100',
        'VALIDATION_FAILED',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      const before = await this.settings(tx, tenant.centerId);
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const [key, to] of Object.entries(dto) as [
        keyof typeof before,
        unknown,
      ][]) {
        if (to === undefined) continue;
        const from = key === 'taxRate' ? money(before.taxRate) : before[key];
        const next = key === 'taxRate' ? money(new Decimal(to as string)) : to;
        if (from !== next) changes[key] = { from, to: next };
      }
      if (!Object.keys(changes).length) return;
      await tx.centerBillingSettings.update({
        where: { centerId: tenant.centerId },
        data: dto,
      });
      await this.audit.record(
        {
          centerId: tenant.centerId,
          actorUserId: tenant.userId,
          action: 'billing.settings_updated',
          entityType: 'CenterBillingSettings',
          entityId: tenant.centerId,
          metadata: changes as Prisma.InputJsonValue,
          ipAddress: ip,
        },
        tx,
      );
    });
    return this.get(tenant);
  }

  // ── Payment methods ───────────────────────────────────────────────────────

  private async seedMethods(db: Db, centerId: string) {
    if (await db.paymentMethod.count({ where: { centerId } })) return;
    await db.paymentMethod.createMany({
      data: DEFAULT_METHODS.map((m, displayOrder) => ({
        centerId,
        ...m,
        displayOrder,
      })),
      skipDuplicates: true,
    });
  }

  async methods(tenant: TenantContext, query: ListConfigQuery = {}) {
    await this.seedMethods(this.prisma, tenant.centerId);
    const rows = await this.prisma.paymentMethod.findMany({
      where: { centerId: tenant.centerId, ...statusWhere(query.status) },
      select: methodFields,
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
    return { items: rows };
  }

  /** An active method of the center, for recording a payment, refund or expense. */
  async activeMethod(
    db: Db,
    tenant: TenantContext,
    id: string,
    field = 'methodId',
  ) {
    await this.seedMethods(db, tenant.centerId);
    const method = await db.paymentMethod.findFirst({
      where: { id, centerId: tenant.centerId },
      select: methodFields,
    });
    if (!method) {
      throw fieldError(
        field,
        'Choose one of the center’s payment methods',
        'METHOD_NOT_FOUND',
      );
    }
    if (!method.isActive) {
      throw fieldError(
        field,
        `${method.name} is switched off. Choose another method.`,
        'METHOD_INACTIVE',
      );
    }
    return method;
  }

  async createMethod(
    tenant: TenantContext,
    dto: CreatePaymentMethodDto,
    ip: string | null,
  ) {
    await this.seedMethods(this.prisma, tenant.centerId);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.paymentMethod.create({
          data: { centerId: tenant.centerId, ...dto },
          select: methodFields,
        });
        await this.recordConfig(
          tx,
          tenant,
          'billing.payment_method_created',
          'PaymentMethod',
          row.id,
          { name: row.name },
          ip,
        );
        return row;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken('payment method');
      throw error;
    }
  }

  async updateMethod(
    tenant: TenantContext,
    id: string,
    dto: UpdatePaymentMethodDto,
    ip: string | null,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const before = await tx.paymentMethod.findFirst({
          where: { id, centerId: tenant.centerId },
          select: methodFields,
        });
        if (!before) throw notFound('Payment method');
        const row = await tx.paymentMethod.update({
          where: { id },
          data: dto,
          select: methodFields,
        });
        await this.recordConfig(
          tx,
          tenant,
          'billing.payment_method_updated',
          'PaymentMethod',
          id,
          { name: row.name, fields: Object.keys(dto) },
          ip,
        );
        return row;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken('payment method');
      throw error;
    }
  }

  // ── Expense categories ────────────────────────────────────────────────────

  private async seedCategories(db: Db, centerId: string) {
    if (await db.expenseCategory.count({ where: { centerId } })) return;
    await db.expenseCategory.createMany({
      data: DEFAULT_EXPENSE_CATEGORIES.map((name, displayOrder) => ({
        centerId,
        name,
        displayOrder,
      })),
      skipDuplicates: true,
    });
  }

  async categories(tenant: TenantContext, query: ListConfigQuery = {}) {
    await this.seedCategories(this.prisma, tenant.centerId);
    const rows = await this.prisma.expenseCategory.findMany({
      where: { centerId: tenant.centerId, ...statusWhere(query.status) },
      select: categoryFields,
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
    return { items: rows };
  }

  async activeCategory(db: Db, tenant: TenantContext, id: string) {
    const row = await db.expenseCategory.findFirst({
      where: { id, centerId: tenant.centerId },
      select: categoryFields,
    });
    if (!row) {
      throw fieldError(
        'categoryId',
        'Choose one of the center’s categories',
        'CATEGORY_NOT_FOUND',
      );
    }
    if (!row.isActive) {
      throw fieldError(
        'categoryId',
        `${row.name} is switched off. Choose another category.`,
        'CATEGORY_INACTIVE',
      );
    }
    return row;
  }

  async createCategory(
    tenant: TenantContext,
    dto: CreateExpenseCategoryDto,
    ip: string | null,
  ) {
    await this.seedCategories(this.prisma, tenant.centerId);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const last = await tx.expenseCategory.aggregate({
          where: { centerId: tenant.centerId },
          _max: { displayOrder: true },
        });
        const row = await tx.expenseCategory.create({
          data: {
            centerId: tenant.centerId,
            ...dto,
            displayOrder: (last._max.displayOrder ?? -1) + 1,
          },
          select: categoryFields,
        });
        await this.recordConfig(
          tx,
          tenant,
          'billing.expense_category_created',
          'ExpenseCategory',
          row.id,
          { name: row.name },
          ip,
        );
        return row;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken('category');
      throw error;
    }
  }

  async updateCategory(
    tenant: TenantContext,
    id: string,
    dto: UpdateExpenseCategoryDto,
    ip: string | null,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const before = await tx.expenseCategory.findFirst({
          where: { id, centerId: tenant.centerId },
          select: { id: true },
        });
        if (!before) throw notFound('Expense category');
        const row = await tx.expenseCategory.update({
          where: { id },
          data: dto,
          select: categoryFields,
        });
        await this.recordConfig(
          tx,
          tenant,
          'billing.expense_category_updated',
          'ExpenseCategory',
          id,
          { name: row.name, fields: Object.keys(dto) },
          ip,
        );
        return row;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken('category');
      throw error;
    }
  }

  private recordConfig(
    tx: Tx,
    tenant: TenantContext,
    action: string,
    entityType: string,
    entityId: string,
    metadata: Record<string, unknown>,
    ip: string | null,
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
