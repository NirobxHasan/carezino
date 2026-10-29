/**
 * Billing rules as pure functions: invoice arithmetic, discounts, tax, aging and what
 * an invoice's or payment's status allows. The services gather the facts and these
 * decide, so drafts, issuing, lists and reports can never disagree.
 *
 * Arithmetic is decimal (Prisma.Decimal), never floating point, with two decimals:
 * - A line's amount is quantity × unit price; its discount (a fixed amount, or a
 *   percentage of the amount rounded half up) can't exceed it.
 * - The invoice discount applies to the subtotal after line discounts, the same way.
 * - Tax is the center's rate on what remains, rounded half up, charged once per invoice.
 * - Total = subtotal − discounts + tax, never negative; outstanding = total − paid,
 *   where paid is the sum of active allocations.
 *
 * Aging uses the center's calendar date. An invoice without a due date is never
 * overdue; otherwise it's overdue from the day after its due date while unpaid.
 */
import { Prisma } from '../generated/prisma/client';
import {
  BillingDiscountType,
  InvoiceStatus,
  PaymentStatus,
} from '../generated/prisma/enums';

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

export const BILLING_LIMITS = {
  name: 120,
  code: 30,
  description: 300,
  notes: 2000,
  reference: 100,
  prefix: 10,
  taxLabel: 20,
  reason: { min: 3, max: 500 },
  items: 50,
  quantity: { min: 1, max: 1000 },
  allocations: 20,
  /** Up to 99,999,999.99 (NUMERIC(12, 2)) */
  maxAmount: '99999999.99',
  dueDays: { min: 0, max: 365 },
  /** How far back invoices, payments, refunds and expenses may be dated, in days */
  backdateDays: 366,
  /** How far ahead an invoice may be dated, in days */
  forwardDays: 31,
  /** Most days a report or list date range may span */
  reportDays: 732,
} as const;

export type Fail = { ok: false; field: string; message: string };
const fail = (field: string, message: string): Fail => ({
  ok: false,
  field,
  message,
});

const ZERO = new Decimal(0);
const round = (v: Decimal) => v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

export interface DiscountInput {
  type: BillingDiscountType | null;
  value: Decimal | null;
}

/** What a discount takes off `base`; a percentage rounds half up to the paisa. */
export function discountOf(
  base: Decimal,
  input: DiscountInput,
  field: string,
): { ok: true; amount: Decimal } | Fail {
  if (input.type === null) return { ok: true, amount: ZERO };
  if (input.value === null || input.value.lte(0)) {
    return fail(field, 'Enter a discount above zero');
  }
  if (input.type === BillingDiscountType.PERCENTAGE) {
    if (input.value.gt(100)) {
      return fail(field, 'Enter a percentage from 0.01 to 100');
    }
    return { ok: true, amount: round(base.times(input.value).dividedBy(100)) };
  }
  if (input.value.gt(base)) {
    return fail(field, 'The discount can’t be more than the amount');
  }
  return { ok: true, amount: input.value };
}

export interface LineInput extends DiscountInput {
  quantity: number;
  unitPrice: Decimal;
}

export interface LineTotals {
  amount: Decimal;
  discountAmount: Decimal;
  totalAmount: Decimal;
}

export function computeLine(
  line: LineInput,
  field: string,
): ({ ok: true } & LineTotals) | Fail {
  const amount = line.unitPrice.times(line.quantity);
  const discount = discountOf(amount, line, `${field}.discountValue`);
  if (!discount.ok) return discount;
  return {
    ok: true,
    amount,
    discountAmount: discount.amount,
    totalAmount: amount.minus(discount.amount),
  };
}

export interface InvoiceTotals {
  subtotal: Decimal;
  /** Line discounts plus the invoice discount */
  discountAmount: Decimal;
  invoiceDiscountAmount: Decimal;
  taxAmount: Decimal;
  totalAmount: Decimal;
}

/** The invoice's totals from its computed lines, its own discount and the tax rate. */
export function computeInvoice(
  lines: LineTotals[],
  invoiceDiscount: DiscountInput,
  taxRate: Decimal,
): ({ ok: true } & InvoiceTotals) | Fail {
  const subtotal = lines.reduce((sum, l) => sum.plus(l.amount), ZERO);
  const lineDiscounts = lines.reduce(
    (sum, l) => sum.plus(l.discountAmount),
    ZERO,
  );
  const afterLines = subtotal.minus(lineDiscounts);
  const discount = discountOf(afterLines, invoiceDiscount, 'discountValue');
  if (!discount.ok) return discount;
  const taxable = afterLines.minus(discount.amount);
  const taxAmount = round(taxable.times(taxRate).dividedBy(100));
  const totalAmount = taxable.plus(taxAmount);
  if (totalAmount.gt(BILLING_LIMITS.maxAmount)) {
    return fail('items', 'An invoice can total up to 99,999,999.99');
  }
  return {
    ok: true,
    subtotal,
    discountAmount: lineDiscounts.plus(discount.amount),
    invoiceDiscountAmount: discount.amount,
    taxAmount,
    totalAmount,
  };
}

/** Invoices whose balance can still be collected. */
export const OPEN_INVOICE_STATUSES: InvoiceStatus[] = [
  InvoiceStatus.ISSUED,
  InvoiceStatus.PARTIALLY_PAID,
];

export const AGING_BUCKETS = [
  'NOT_DUE',
  'DAYS_1_7',
  'DAYS_8_30',
  'DAYS_31_60',
  'DAYS_60_PLUS',
] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

/** Days overdue (both included) of each overdue bucket; the last is open-ended. */
export const OVERDUE_RANGES = {
  DAYS_1_7: [1, 7],
  DAYS_8_30: [8, 30],
  DAYS_31_60: [31, 60],
  DAYS_60_PLUS: [61, null],
} as const satisfies Record<
  Exclude<AgingBucket, 'NOT_DUE'>,
  [number, number | null]
>;

const DAY_MS = 86_400_000;

/** Whole days past the due date (negative before it); null without a due date. */
export function daysOverdue(dueDate: Date | null, today: Date) {
  if (!dueDate) return null;
  return Math.round((today.getTime() - dueDate.getTime()) / DAY_MS);
}

export function agingBucket(dueDate: Date | null, today: Date): AgingBucket {
  const days = daysOverdue(dueDate, today);
  if (days === null || days <= 0) return 'NOT_DUE';
  if (days <= 7) return 'DAYS_1_7';
  if (days <= 30) return 'DAYS_8_30';
  if (days <= 60) return 'DAYS_31_60';
  return 'DAYS_60_PLUS';
}

export interface BalanceFacts {
  status: InvoiceStatus;
  totalAmount: Decimal;
  paidAmount: Decimal;
  dueDate: Date | null;
}

/** What's left to collect: nothing on drafts and void invoices. */
export function outstandingOf(i: BalanceFacts) {
  return OPEN_INVOICE_STATUSES.includes(i.status)
    ? i.totalAmount.minus(i.paidAmount)
    : ZERO;
}

export function isOverdue(i: BalanceFacts, today: Date) {
  const days = daysOverdue(i.dueDate, today);
  return days !== null && days > 0 && outstandingOf(i).gt(0);
}

export interface PaymentFacts {
  status: PaymentStatus;
  amount: Decimal;
  allocatedAmount: Decimal;
  refundedAmount: Decimal;
}

/** Received but not applied to invoices or refunded: the patient's credit from it. */
export function unappliedOf(p: PaymentFacts) {
  return p.status === PaymentStatus.RECORDED
    ? p.amount.minus(p.allocatedAmount).minus(p.refundedAmount)
    : ZERO;
}

/**
 * Splits `amount` across payments with credit, oldest first, so applying credit uses
 * up earlier money before later. Returns null if there isn't enough.
 */
export function takeCredit<T extends PaymentFacts & { id: string }>(
  payments: T[],
  amount: Decimal,
): { paymentId: string; amount: Decimal }[] | null {
  const parts: { paymentId: string; amount: Decimal }[] = [];
  let left = amount;
  for (const p of payments) {
    if (left.lte(0)) break;
    const available = unappliedOf(p);
    if (available.lte(0)) continue;
    const take = Decimal.min(available, left);
    parts.push({ paymentId: p.id, amount: take });
    left = left.minus(take);
  }
  return left.gt(0) ? null : parts;
}
