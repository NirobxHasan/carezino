import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import {
  CommaList,
  EmptyToNull,
  IfPresent,
  Money,
  Trim,
  TrimOrNull,
  applyAll,
} from '../common/validation';
import {
  AssessmentBillingPolicy,
  BillableServiceCategory,
  BillingDiscountType,
  ExpenseStatus,
  InvoiceItemKind,
  InvoiceStatus,
  PackageBillingPolicy,
  PaymentStatus,
  SessionBillingPolicy,
} from '../generated/prisma/enums';
import { AGING_BUCKETS, BILLING_LIMITS, type AgingBucket } from './rules';

const L = BILLING_LIMITS;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'Choose a date';
const PREFIX = /^[A-Za-z0-9/-]*$/;

const Text = (max: number, message?: string) =>
  applyAll([
    Trim(),
    IsString({ message }),
    MinLength(1, { message }),
    MaxLength(max, { message: `Use up to ${max} characters` }),
  ]);

const OptionalText = (max: number) =>
  applyAll([
    IsOptional(),
    TrimOrNull(),
    IsString(),
    MaxLength(max, { message: `Use up to ${max} characters` }),
  ]);

const Int = (min: number, max: number, message: string) =>
  applyAll([
    Type(() => Number),
    IsInt({ message }),
    Min(min, { message }),
    Max(max, { message }),
  ]);

const Reason = (message = 'Give a reason (at least 3 characters)') =>
  applyAll([
    Trim(),
    IsString({ message }),
    MinLength(L.reason.min, { message }),
    MaxLength(L.reason.max, {
      message: `Use up to ${L.reason.max} characters`,
    }),
  ]);

const DateField = () =>
  applyAll([
    IsString({ message: DATE_MESSAGE }),
    Matches(ISO_DATE, { message: DATE_MESSAGE }),
  ]);

const OptionalDate = () => applyAll([IsOptional(), DateField()]);

const RequestId = () => applyAll([IsOptional(), IsUUID('4')]);

const Paging = () => [
  applyAll([IsOptional(), Type(() => Number), IsInt(), Min(1)]),
  applyAll([IsOptional(), Type(() => Number), IsInt(), Min(1), Max(100)]),
];
const [Page, PageSize] = Paging();

const Bool = () =>
  applyAll([
    IsOptional(),
    Transform(({ value }: { value: unknown }) =>
      value === 'true' ? true : value === 'false' ? false : value,
    ),
    IsBoolean(),
  ]);

// ── Settings ────────────────────────────────────────────────────────────────

export class UpdateBillingSettingsDto {
  @IfPresent()
  @IsString()
  @MaxLength(L.prefix, { message: `Use up to ${L.prefix} characters` })
  @Matches(PREFIX, { message: 'Use letters, numbers, dashes and slashes' })
  invoicePrefix?: string;

  @IfPresent()
  @IsString()
  @MaxLength(L.prefix, { message: `Use up to ${L.prefix} characters` })
  @Matches(PREFIX, { message: 'Use letters, numbers, dashes and slashes' })
  receiptPrefix?: string;

  @IfPresent()
  @Int(L.dueDays.min, L.dueDays.max, `Enter 0 to ${L.dueDays.max} days`)
  defaultDueDays?: number;

  @IfPresent()
  @IsBoolean()
  allowPartialPayment?: boolean;

  @IfPresent()
  @IsBoolean()
  allowAdvancePayment?: boolean;

  @IfPresent()
  @IsBoolean()
  allowManualDiscount?: boolean;

  /** A percentage, e.g. "7.5"; "0" turns tax off */
  @IfPresent()
  @Money('Enter a percentage from 0 to 100')
  taxRate?: string;

  @IfPresent()
  @Text(L.taxLabel, 'Name the tax, e.g. VAT')
  taxLabel?: string;

  @IfPresent()
  @IsEnum(AssessmentBillingPolicy, {
    message: 'Choose when assessments are invoiced',
  })
  assessmentBillingPolicy?: AssessmentBillingPolicy;

  @IfPresent()
  @IsEnum(SessionBillingPolicy, {
    message: 'Choose when sessions are invoiced',
  })
  sessionBillingPolicy?: SessionBillingPolicy;

  @IfPresent()
  @IsEnum(PackageBillingPolicy, {
    message: 'Choose when packages are invoiced',
  })
  packageBillingPolicy?: PackageBillingPolicy;
}

export class CreatePaymentMethodDto {
  @Text(60, 'Name the payment method, e.g. bKash')
  name!: string;

  @IsOptional()
  @IsBoolean()
  requiresReference?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Int(0, 9999, 'Enter 0 to 9999')
  displayOrder?: number;
}

export class UpdatePaymentMethodDto {
  @IfPresent()
  @Text(60, 'Name the payment method, e.g. bKash')
  name?: string;

  @IfPresent()
  @IsBoolean()
  requiresReference?: boolean;

  @IfPresent()
  @IsBoolean()
  isActive?: boolean;

  @IfPresent()
  @Int(0, 9999, 'Enter 0 to 9999')
  displayOrder?: number;
}

export class CreateExpenseCategoryDto {
  @Text(60, 'Name the category, e.g. Rent')
  name!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateExpenseCategoryDto {
  @IfPresent()
  @Text(60, 'Name the category, e.g. Rent')
  name?: string;

  @IfPresent()
  @IsBoolean()
  isActive?: boolean;
}

export class ListConfigQuery {
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE', 'all'])
  status?: 'ACTIVE' | 'INACTIVE' | 'all';
}

// ── Billable services ───────────────────────────────────────────────────────

const CODE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export class CreateServiceDto {
  @Text(L.name, 'Service name is required')
  name!: string;

  /** Stored upper-cased */
  @Trim()
  @IsString({ message: 'Service code is required' })
  @MinLength(1, { message: 'Service code is required' })
  @MaxLength(L.code, { message: `Use up to ${L.code} characters` })
  @Matches(CODE, { message: 'Use letters, numbers, dashes and underscores' })
  code!: string;

  @IsEnum(BillableServiceCategory, { message: 'Choose a category' })
  category!: BillableServiceCategory;

  @IsOptional()
  @EmptyToNull()
  @IsUUID('all', { message: 'Choose a therapy' })
  therapyTypeId?: string | null;

  @Money()
  price!: string;

  @IsOptional()
  @EmptyToNull()
  @Int(5, 480, 'Enter 5 to 480 minutes')
  defaultDurationMinutes?: number | null;

  @OptionalText(500)
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Int(0, 9999, 'Enter 0 to 9999')
  displayOrder?: number;
}

export class UpdateServiceDto {
  @IfPresent()
  @Text(L.name, 'Service name is required')
  name?: string;

  @IfPresent()
  @Trim()
  @IsString({ message: 'Service code is required' })
  @MinLength(1, { message: 'Service code is required' })
  @MaxLength(L.code, { message: `Use up to ${L.code} characters` })
  @Matches(CODE, { message: 'Use letters, numbers, dashes and underscores' })
  code?: string;

  @IfPresent()
  @IsEnum(BillableServiceCategory, { message: 'Choose a category' })
  category?: BillableServiceCategory;

  @IsOptional()
  @EmptyToNull()
  @IsUUID('all', { message: 'Choose a therapy' })
  therapyTypeId?: string | null;

  @IfPresent()
  @Money()
  price?: string;

  @IsOptional()
  @EmptyToNull()
  @Int(5, 480, 'Enter 5 to 480 minutes')
  defaultDurationMinutes?: number | null;

  @OptionalText(500)
  description?: string | null;

  @IfPresent()
  @Int(0, 9999, 'Enter 0 to 9999')
  displayOrder?: number;
}

export class ServiceStatusDto {
  @IsBoolean()
  isActive!: boolean;
}

export class ListServicesQuery {
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsEnum(BillableServiceCategory)
  category?: BillableServiceCategory;

  @IsOptional()
  @IsUUID()
  therapyTypeId?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE', 'all'])
  status?: 'ACTIVE' | 'INACTIVE' | 'all';
}

// ── Invoices ────────────────────────────────────────────────────────────────

export class InvoiceItemInput {
  @IsEnum(InvoiceItemKind, { message: 'Choose what this line charges for' })
  kind!: InvoiceItemKind;

  /** Defaults to the service's, enrollment's or appointment's description */
  @IsOptional()
  @TrimOrNull()
  @IsString()
  @MaxLength(L.description, {
    message: `Use up to ${L.description} characters`,
  })
  description?: string | null;

  @IsOptional()
  @EmptyToNull()
  @IsUUID('all', { message: 'Choose a service' })
  serviceId?: string | null;

  @IsOptional()
  @IsUUID('all', { message: 'Choose an appointment' })
  appointmentId?: string;

  @IsOptional()
  @IsUUID('all', { message: 'Choose a package enrollment' })
  packageEnrollmentId?: string;

  @IsOptional()
  @Int(
    L.quantity.min,
    L.quantity.max,
    `Enter ${L.quantity.min} to ${L.quantity.max}`,
  )
  quantity?: number;

  /** Defaults to the service's price or the enrollment's agreed price */
  @IsOptional()
  @EmptyToNull()
  @Money()
  unitPrice?: string | null;

  @IsOptional()
  @EmptyToNull()
  @IsEnum(BillingDiscountType, { message: 'Choose an amount or a percentage' })
  discountType?: BillingDiscountType | null;

  @IsOptional()
  @EmptyToNull()
  @Money('Enter the discount, e.g. 500 or 10')
  discountValue?: string | null;
}

class InvoiceTerms {
  @IsOptional()
  @EmptyToNull()
  @IsEnum(BillingDiscountType, { message: 'Choose an amount or a percentage' })
  discountType?: BillingDiscountType | null;

  @IsOptional()
  @EmptyToNull()
  @Money('Enter the discount, e.g. 500 or 10')
  discountValue?: string | null;

  @OptionalText(L.notes)
  notes?: string | null;
}

export class CreateInvoiceDto extends InvoiceTerms {
  @IsUUID('all', { message: 'Choose a patient' })
  patientId!: string;

  /** Center-local; defaults to today */
  @OptionalDate()
  invoiceDate?: string;

  /** Left out: from the center's due period. Null: no due date. */
  @IsOptional()
  @EmptyToNull()
  @DateField()
  dueDate?: string | null;

  @IsArray({ message: 'Add at least one line' })
  @ArrayMinSize(1, { message: 'Add at least one line' })
  @ArrayMaxSize(L.items, { message: `Use up to ${L.items} lines` })
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemInput)
  items!: InvoiceItemInput[];

  /** Issue straight away (needs invoices.issue) */
  @IsOptional()
  @IsBoolean()
  issue?: boolean;

  @RequestId()
  requestId?: string;
}

/** A draft's fields; `items`, when sent, replaces every line. */
export class UpdateInvoiceDto extends InvoiceTerms {
  @IfPresent()
  @DateField()
  invoiceDate?: string;

  @IsOptional()
  @EmptyToNull()
  @DateField()
  dueDate?: string | null;

  @IfPresent()
  @IsArray({ message: 'Add at least one line' })
  @ArrayMinSize(1, { message: 'Add at least one line' })
  @ArrayMaxSize(L.items, { message: `Use up to ${L.items} lines` })
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemInput)
  items?: InvoiceItemInput[];

  /** The revision the edit started from; a different current one is a 409 */
  @IsOptional()
  @IsInt()
  revision?: number;
}

export class VoidInvoiceDto {
  @Reason()
  reason!: string;

  /** Also start a corrected draft with the same lines */
  @IsOptional()
  @IsBoolean()
  reissue?: boolean;
}

export class ApplyCreditDto {
  @Money()
  amount!: string;

  @RequestId()
  requestId?: string;
}

export const INVOICE_SORTS = [
  'invoiceDate',
  'dueDate',
  'createdAt',
  'total',
] as const;

export class ListInvoicesQuery {
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsUUID()
  patientId?: string;

  @IsOptional()
  @CommaList()
  @IsArray()
  @IsEnum(InvoiceStatus, { each: true })
  status?: InvoiceStatus[];

  /** Open invoices past their due date */
  @Bool()
  overdue?: boolean;

  /** Invoice date range, center-local */
  @OptionalDate()
  from?: string;

  @OptionalDate()
  to?: string;

  @IsOptional()
  @IsIn(INVOICE_SORTS)
  sortBy?: (typeof INVOICE_SORTS)[number];

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  @Page
  page?: number;

  @PageSize
  pageSize?: number;
}

export class ChargesQuery {
  @IsUUID('all', { message: 'Choose a patient' })
  patientId!: string;

  /** Also booked sessions not yet held, to invoice in advance */
  @Bool()
  includeUpcoming?: boolean;
}

// ── Payments ────────────────────────────────────────────────────────────────

export class AllocationInput {
  @IsUUID('all', { message: 'Choose an invoice' })
  invoiceId!: string;

  @Money()
  amount!: string;
}

export class CollectPaymentDto {
  @IsUUID('all', { message: 'Choose a patient' })
  patientId!: string;

  @Money()
  amount!: string;

  @IsUUID('all', { message: 'Choose a payment method' })
  methodId!: string;

  @OptionalText(L.reference)
  transactionReference?: string | null;

  /** When the money was received; defaults to now */
  @IsOptional()
  @IsISO8601({}, { message: 'Choose a valid date and time' })
  collectedAt?: string;

  @OptionalText(L.notes)
  notes?: string | null;

  /** Invoices to apply it to; anything left over is the patient's credit */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(L.allocations)
  @ValidateNested({ each: true })
  @Type(() => AllocationInput)
  allocations?: AllocationInput[];

  @RequestId()
  requestId?: string;
}

export class AllocatePaymentDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Choose an invoice' })
  @ArrayMaxSize(L.allocations)
  @ValidateNested({ each: true })
  @Type(() => AllocationInput)
  allocations!: AllocationInput[];

  @RequestId()
  requestId?: string;
}

export class ReleaseAllocationDto {
  @Reason()
  reason!: string;
}

export class RefundPaymentDto {
  @Money()
  amount!: string;

  @IsUUID('all', { message: 'Choose how it was refunded' })
  methodId!: string;

  @Reason()
  reason!: string;

  @OptionalText(L.reference)
  reference?: string | null;

  @IsOptional()
  @IsISO8601({}, { message: 'Choose a valid date and time' })
  refundedAt?: string;

  @RequestId()
  requestId?: string;
}

export class ReversePaymentDto {
  @Reason()
  reason!: string;
}

export class ListPaymentsQuery {
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsUUID()
  patientId?: string;

  @IsOptional()
  @IsUUID()
  methodId?: string;

  @IsOptional()
  @IsUUID()
  collectedById?: string;

  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  /** Only payments with credit left */
  @Bool()
  withCredit?: boolean;

  /** Collection date range, center-local */
  @OptionalDate()
  from?: string;

  @OptionalDate()
  to?: string;

  @Page
  page?: number;

  @PageSize
  pageSize?: number;
}

// ── Expenses ────────────────────────────────────────────────────────────────

export class CreateExpenseDto {
  @IsUUID('all', { message: 'Choose a category' })
  categoryId!: string;

  @DateField()
  expenseDate!: string;

  @Text(L.description, 'Describe the expense')
  description!: string;

  @Money()
  amount!: string;

  @IsUUID('all', { message: 'Choose how it was paid' })
  methodId!: string;

  @OptionalText(L.reference)
  reference?: string | null;

  @OptionalText(L.notes)
  notes?: string | null;

  @RequestId()
  requestId?: string;
}

/** A correction: the fields that change, and why. */
export class UpdateExpenseDto {
  @IfPresent()
  @IsUUID('all', { message: 'Choose a category' })
  categoryId?: string;

  @IfPresent()
  @DateField()
  expenseDate?: string;

  @IfPresent()
  @Text(L.description, 'Describe the expense')
  description?: string;

  @IfPresent()
  @Money()
  amount?: string;

  @IfPresent()
  @IsUUID('all', { message: 'Choose how it was paid' })
  methodId?: string;

  @OptionalText(L.reference)
  reference?: string | null;

  @OptionalText(L.notes)
  notes?: string | null;

  @Reason('Say what you’re correcting (at least 3 characters)')
  reason!: string;

  @IsOptional()
  @IsInt()
  revision?: number;
}

export class VoidExpenseDto {
  @Reason()
  reason!: string;
}

export class ListExpensesQuery {
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  methodId?: string;

  @IsOptional()
  @IsEnum(ExpenseStatus)
  status?: ExpenseStatus;

  @OptionalDate()
  from?: string;

  @OptionalDate()
  to?: string;

  @Page
  page?: number;

  @PageSize
  pageSize?: number;
}

// ── Reports ─────────────────────────────────────────────────────────────────

export class RangeQuery {
  @OptionalDate()
  from?: string;

  @OptionalDate()
  to?: string;
}

export class CollectionsQuery extends RangeQuery {
  @IsOptional()
  @IsUUID()
  collectedById?: string;
}

export class DuesQuery {
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsUUID()
  patientId?: string;

  @IsOptional()
  @IsUUID()
  therapyTypeId?: string;

  @Bool()
  overdue?: boolean;

  @IsOptional()
  @IsIn(AGING_BUCKETS)
  aging?: AgingBucket;

  /** Invoice date range */
  @OptionalDate()
  from?: string;

  @OptionalDate()
  to?: string;

  @OptionalDate()
  dueFrom?: string;

  @OptionalDate()
  dueTo?: string;

  @Page
  page?: number;

  @PageSize
  pageSize?: number;
}
