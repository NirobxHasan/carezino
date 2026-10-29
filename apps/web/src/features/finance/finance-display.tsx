'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Ban,
  CheckCircle2,
  CircleDashed,
  CircleDot,
  FileText,
  Undo2,
  type LucideIcon,
} from 'lucide-react';

import { Badge, type BadgeTone } from '@/components/ui/badge';
import type { Permission } from '@/lib/permissions';
import { useSession } from '@/lib/session';
import type {
  AgingBucket,
  AllocationReleaseReason,
  BillableServiceCategory,
  BillingDiscountType,
  InvoiceItemKind,
  InvoiceStatus,
  Money,
  PaymentStatus,
} from '@/lib/types';
import { cn } from '@/lib/utils';
import { formatMoney, fromPaisa, toPaisa } from '../packages/package-display';

export { formatMoney, fromPaisa, toPaisa };

type StatusDef = { label: string; tone: BadgeTone; icon: LucideIcon };

export const INVOICE_STATUSES: Record<InvoiceStatus, StatusDef> = {
  DRAFT: { label: 'Draft', tone: 'neutral', icon: CircleDashed },
  ISSUED: { label: 'Unpaid', tone: 'info', icon: FileText },
  PARTIALLY_PAID: { label: 'Partly paid', tone: 'warning', icon: CircleDot },
  PAID: { label: 'Paid', tone: 'success', icon: CheckCircle2 },
  VOID: { label: 'Void', tone: 'neutral', icon: Ban },
};

/** The invoice's status, with "Overdue" in place of unpaid ones past their due date. */
export function InvoiceStatusBadge({
  status,
  overdue,
}: {
  status: InvoiceStatus;
  overdue?: boolean;
}) {
  const s = INVOICE_STATUSES[status];
  const Icon = s.icon;
  return (
    <span className="flex flex-wrap items-center gap-1">
      <Badge tone={s.tone}>
        <Icon aria-hidden /> {s.label}
      </Badge>
      {overdue && <Badge tone="danger">Overdue</Badge>}
    </span>
  );
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return status === 'REVERSED' ? (
    <Badge tone="neutral">
      <Undo2 aria-hidden /> Reversed
    </Badge>
  ) : (
    <Badge tone="success">
      <CheckCircle2 aria-hidden /> Recorded
    </Badge>
  );
}

export const ITEM_KINDS: Record<InvoiceItemKind, string> = {
  PACKAGE: 'Package',
  ASSESSMENT_FEE: 'Assessment fee',
  SESSION_FEE: 'Session fee',
  ADDITIONAL_FEE: 'Additional fee',
  OTHER: 'Other charge',
};

export const SERVICE_CATEGORIES: Record<BillableServiceCategory, string> = {
  ASSESSMENT: 'Assessment',
  THERAPY_SESSION: 'Therapy session',
  OTHER: 'Other',
};

export const DISCOUNT_KINDS: Record<BillingDiscountType, string> = {
  FIXED: 'Amount',
  PERCENTAGE: 'Percent',
};

export const AGING: Record<AgingBucket, { label: string; tone: BadgeTone }> = {
  NOT_DUE: { label: 'Not due', tone: 'neutral' },
  DAYS_1_7: { label: '1–7 days', tone: 'warning' },
  DAYS_8_30: { label: '8–30 days', tone: 'warning' },
  DAYS_31_60: { label: '31–60 days', tone: 'danger' },
  DAYS_60_PLUS: { label: '60+ days', tone: 'danger' },
};

export const RELEASE_REASONS: Record<AllocationReleaseReason, string> = {
  REALLOCATED: 'Taken off the invoice',
  INVOICE_VOIDED: 'Invoice voided',
  PAYMENT_REVERSED: 'Payment reversed',
};

export const HISTORY_ACTIONS: Record<string, string> = {
  'invoice.draft_created': 'Draft created',
  'invoice.draft_updated': 'Draft edited',
  'invoice.draft_discarded': 'Draft discarded',
  'invoice.issued': 'Issued',
  'invoice.voided': 'Voided',
  'payment.credit_applied': 'Credit applied',
};

export const financeLinks = {
  overview: '/finance',
  invoices: '/finance/invoices',
  invoice: (id: string) => `/finance/invoices/${encodeURIComponent(id)}`,
  editInvoice: (id: string) => `/finance/invoices/${encodeURIComponent(id)}/edit`,
  printInvoice: (id: string) => `/finance/invoices/${encodeURIComponent(id)}/print`,
  newInvoice: (prefill: { patientId?: string; charges?: string[] } = {}) => {
    const q = new URLSearchParams();
    if (prefill.patientId) q.set('patientId', prefill.patientId);
    if (prefill.charges?.length) q.set('charges', prefill.charges.join(','));
    const s = q.toString();
    return s ? `/finance/invoices/new?${s}` : '/finance/invoices/new';
  },
  payments: '/finance/payments',
  payment: (id: string) => `/finance/payments/${encodeURIComponent(id)}`,
  receipt: (id: string) => `/finance/payments/${encodeURIComponent(id)}/receipt`,
  dues: '/finance/dues',
  expenses: '/finance/expenses',
  reports: '/finance/reports',
  patientBilling: (patientId: string) => `/patients/${encodeURIComponent(patientId)}?tab=billing`,
};

const NAV: { href: string; label: string; permission: Permission; exact?: boolean }[] = [
  { href: financeLinks.overview, label: 'Overview', permission: 'invoices.read', exact: true },
  { href: financeLinks.invoices, label: 'Invoices', permission: 'invoices.read' },
  { href: financeLinks.payments, label: 'Payments', permission: 'payments.read' },
  { href: financeLinks.dues, label: 'Outstanding dues', permission: 'invoices.read' },
  { href: financeLinks.expenses, label: 'Expenses', permission: 'expenses.read' },
  { href: financeLinks.reports, label: 'Reports', permission: 'finance_reports.read_own' },
];

/** The finance section's tabs, matching the packages and settings tab style. */
export function FinanceNav() {
  const pathname = usePathname();
  const { can } = useSession();
  const tabs = NAV.filter((t) => can(t.permission));
  if (tabs.length < 2) return null;
  return (
    <nav
      aria-label="Finance"
      className="mb-5 flex w-full items-center gap-1 overflow-x-auto border-b border-border [scrollbar-width:none] print:hidden"
    >
      {tabs.map((tab) => {
        const active = tab.exact
          ? pathname === tab.href
          : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative inline-flex h-10 shrink-0 items-center whitespace-nowrap rounded-t-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-ring',
              'after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-transparent',
              active && 'text-foreground after:bg-primary',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** An amount, right-aligned in tables, muted when zero. */
export function Amount({
  value,
  currency,
  className,
  strong,
}: {
  value: Money;
  currency?: string;
  className?: string;
  strong?: boolean;
}) {
  const zero = /^-?0(\.0+)?$/.test(value);
  return (
    <span
      className={cn(
        'tabular whitespace-nowrap',
        zero && 'text-subtle-foreground',
        strong && !zero && 'font-semibold',
        className,
      )}
    >
      {formatMoney(value, currency)}
    </span>
  );
}

// ── Previews ────────────────────────────────────────────────────────────────
// What the API will compute, in whole paisa (BigInt) so nothing drifts. The API
// recalculates on save; these only show the receptionist the numbers as they type.

const [ZERO, TWO, HUNDRED_PERCENT] = [0, 2, 10000].map((n) => BigInt(n));

/** A percentage of `base` paisa, rounded half up; `percent` is in hundredths (12.5% → 1250). */
function percentOf(base: bigint, percent: bigint) {
  return (base * percent * TWO + HUNDRED_PERCENT) / (HUNDRED_PERCENT * TWO);
}

function discount(
  base: bigint,
  type: BillingDiscountType | null | undefined,
  value: string | null | undefined,
) {
  if (!type) return { amount: ZERO };
  const v = toPaisa(value ?? '');
  if (v === null || v <= ZERO) return { amount: ZERO, error: 'Enter the discount' };
  if (type === 'PERCENTAGE') {
    if (v > HUNDRED_PERCENT) return { amount: ZERO, error: 'Up to 100%' };
    return { amount: percentOf(base, v) };
  }
  if (v > base) return { amount: ZERO, error: 'More than the amount' };
  return { amount: v };
}

export interface PreviewLine {
  quantity: number;
  unitPrice: string;
  discountType?: BillingDiscountType | null;
  discountValue?: string | null;
}

export function previewLine(line: PreviewLine) {
  const unit = toPaisa(line.unitPrice);
  if (unit === null || !Number.isInteger(line.quantity) || line.quantity < 1) return null;
  const amount = unit * BigInt(line.quantity);
  const d = discount(amount, line.discountType, line.discountValue);
  return { amount, discount: d.amount, total: amount - d.amount, error: d.error };
}

export function previewInvoice(
  lines: PreviewLine[],
  invoiceDiscount: { type?: BillingDiscountType | null; value?: string | null },
  taxRate: Money,
) {
  const computed = lines.map(previewLine);
  const valid = computed.filter((c): c is NonNullable<typeof c> => c !== null);
  const subtotal = valid.reduce((s, l) => s + l.amount, ZERO);
  const lineDiscounts = valid.reduce((s, l) => s + l.discount, ZERO);
  const afterLines = subtotal - lineDiscounts;
  const d = discount(afterLines, invoiceDiscount.type, invoiceDiscount.value);
  const taxable = afterLines - d.amount;
  const rate = toPaisa(taxRate) ?? ZERO;
  const tax = rate > ZERO ? percentOf(taxable, rate) : ZERO;
  return {
    lines: computed,
    subtotal: fromPaisa(subtotal),
    discount: fromPaisa(lineDiscounts + d.amount),
    invoiceDiscount: fromPaisa(d.amount),
    tax: fromPaisa(tax),
    total: fromPaisa(taxable + tax),
    discountError: d.error,
    complete: computed.every(Boolean) && computed.length > 0,
  };
}

/** a − b for (non-negative) money strings, exact; the result may be negative. */
export function subtractMoney(a: Money, b: Money) {
  return fromPaisa((toPaisa(a) ?? ZERO) - (toPaisa(b) ?? ZERO));
}

export function isPositive(value: string) {
  const p = toPaisa(value);
  return p !== null && p > ZERO;
}

export function compareMoney(a: Money, b: Money) {
  const x = toPaisa(a) ?? ZERO;
  const y = toPaisa(b) ?? ZERO;
  return x === y ? 0 : x > y ? 1 : -1;
}

/** Splits `amount` over invoices in order, oldest first, never more than each owes. */
export function distribute(amount: Money, outstanding: Money[]) {
  let left = toPaisa(amount) ?? ZERO;
  return outstanding.map((o) => {
    const owed = toPaisa(o) ?? ZERO;
    const take = left > owed ? owed : left;
    left -= take;
    return fromPaisa(take);
  });
}

export function sumMoney(values: Money[]) {
  return fromPaisa(values.reduce((s, v) => s + (toPaisa(v) ?? ZERO), ZERO));
}

/** "today" in the center's time zone, as YYYY-MM-DD. */
export function useCenterToday() {
  const { activeCenter } = useSession();
  return React.useMemo(
    () =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: activeCenter.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date()),
    [activeCenter.timezone],
  );
}
