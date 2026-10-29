import { Prisma } from '../generated/prisma/client';
import {
  BillingDiscountType,
  InvoiceStatus,
  PaymentStatus,
} from '../generated/prisma/enums';
import {
  agingBucket,
  computeInvoice,
  computeLine,
  discountOf,
  type DiscountInput,
  isOverdue,
  outstandingOf,
  takeCredit,
  unappliedOf,
} from './rules';

const D = (v: string | number) => new Prisma.Decimal(v);
const date = (iso: string) => new Date(`${iso}T00:00:00Z`);
const none: DiscountInput = { type: null, value: null };

function line(quantity: number, unitPrice: string, discount = none) {
  const result = computeLine(
    { quantity, unitPrice: D(unitPrice), ...discount },
    'items.0',
  );
  if (!result.ok) throw new Error(result.message);
  return result;
}

describe('discountOf', () => {
  it('takes a fixed amount off, never more than the base', () => {
    const fixed = { type: BillingDiscountType.FIXED, value: D('500') };
    expect(discountOf(D('9000'), fixed, 'd')).toEqual({
      ok: true,
      amount: D('500'),
    });
    expect(discountOf(D('400'), fixed, 'd')).toMatchObject({
      ok: false,
      field: 'd',
    });
  });

  it('rounds percentages half up to the paisa', () => {
    const pct = { type: BillingDiscountType.PERCENTAGE, value: D('12.5') };
    // 12.5% of 333.33 = 41.66625 → 41.67
    const r = discountOf(D('333.33'), pct, 'd');
    expect(r.ok && r.amount.toFixed(2)).toBe('41.67');
  });

  it('rejects zero, negative and over-100% discounts', () => {
    expect(
      discountOf(D(100), { type: BillingDiscountType.FIXED, value: D(0) }, 'd')
        .ok,
    ).toBe(false);
    expect(
      discountOf(
        D(100),
        { type: BillingDiscountType.PERCENTAGE, value: D('100.01') },
        'd',
      ).ok,
    ).toBe(false);
    expect(
      discountOf(
        D(100),
        { type: BillingDiscountType.PERCENTAGE, value: D(100) },
        'd',
      ),
    ).toEqual({
      ok: true,
      amount: D(100),
    });
  });
});

describe('computeInvoice', () => {
  it('adds lines and applies the invoice discount after line discounts', () => {
    // The spec example: a 9,000 package, a 1,000 assessment and 500 off.
    const totals = computeInvoice(
      [line(1, '9000'), line(1, '1000')],
      { type: BillingDiscountType.FIXED, value: D('500') },
      D(0),
    );
    expect(totals).toMatchObject({ ok: true });
    if (!totals.ok) return;
    expect(totals.subtotal.toFixed(2)).toBe('10000.00');
    expect(totals.discountAmount.toFixed(2)).toBe('500.00');
    expect(totals.totalAmount.toFixed(2)).toBe('9500.00');
  });

  it('keeps decimal precision where floats would drift', () => {
    // 0.1 + 0.2 in floating point is 0.30000000000000004.
    const totals = computeInvoice(
      [line(1, '0.10'), line(1, '0.20')],
      none,
      D(0),
    );
    expect(totals.ok && totals.totalAmount.toFixed(2)).toBe('0.30');
    const many = computeInvoice([line(3, '333.33')], none, D(0));
    expect(many.ok && many.totalAmount.toString()).toBe('999.99');
  });

  it('charges tax once on the discounted subtotal', () => {
    const totals = computeInvoice(
      [line(2, '1000', { type: BillingDiscountType.PERCENTAGE, value: D(10) })],
      { type: BillingDiscountType.FIXED, value: D(200) },
      D('7.5'),
    );
    if (!totals.ok) throw new Error(totals.message);
    // 2000 − 200 (line) − 200 (invoice) = 1600; 7.5% = 120
    expect(totals.discountAmount.toFixed(2)).toBe('400.00');
    expect(totals.invoiceDiscountAmount.toFixed(2)).toBe('200.00');
    expect(totals.taxAmount.toFixed(2)).toBe('120.00');
    expect(totals.totalAmount.toFixed(2)).toBe('1720.00');
  });

  it('never goes below zero: a discount larger than what remains is refused', () => {
    const totals = computeInvoice(
      [line(1, '100', { type: BillingDiscountType.FIXED, value: D(60) })],
      { type: BillingDiscountType.FIXED, value: D(50) },
      D(0),
    );
    expect(totals).toMatchObject({ ok: false, field: 'discountValue' });
  });

  it('allows a fully discounted invoice', () => {
    const totals = computeInvoice(
      [line(1, '100')],
      { type: BillingDiscountType.PERCENTAGE, value: D(100) },
      D(5),
    );
    expect(totals.ok && totals.totalAmount.toFixed(2)).toBe('0.00');
  });

  it('refuses totals beyond what NUMERIC(12, 2) holds', () => {
    expect(computeInvoice([line(1000, '99999999.99')], none, D(0)).ok).toBe(
      false,
    );
  });
});

describe('aging and balances', () => {
  const today = date('2026-11-20');
  const open = (dueDate: string | null, total = '1000', paid = '0') => ({
    status: InvoiceStatus.PARTIALLY_PAID,
    totalAmount: D(total),
    paidAmount: D(paid),
    dueDate: dueDate ? date(dueDate) : null,
  });

  it('buckets by days past the due date in the center’s calendar', () => {
    expect(agingBucket(null, today)).toBe('NOT_DUE');
    expect(agingBucket(date('2026-11-20'), today)).toBe('NOT_DUE');
    expect(agingBucket(date('2026-11-19'), today)).toBe('DAYS_1_7');
    expect(agingBucket(date('2026-11-13'), today)).toBe('DAYS_1_7');
    expect(agingBucket(date('2026-11-12'), today)).toBe('DAYS_8_30');
    expect(agingBucket(date('2026-10-21'), today)).toBe('DAYS_8_30');
    expect(agingBucket(date('2026-10-20'), today)).toBe('DAYS_31_60');
    expect(agingBucket(date('2026-09-21'), today)).toBe('DAYS_31_60');
    expect(agingBucket(date('2026-09-20'), today)).toBe('DAYS_60_PLUS');
  });

  it('is overdue only after the due date and while something is owed', () => {
    expect(isOverdue(open('2026-11-19'), today)).toBe(true);
    expect(isOverdue(open('2026-11-20'), today)).toBe(false);
    expect(isOverdue(open(null), today)).toBe(false);
    expect(isOverdue(open('2026-11-01', '1000', '1000'), today)).toBe(false);
  });

  it('owes nothing on drafts and void invoices', () => {
    expect(
      outstandingOf({ ...open(null), status: InvoiceStatus.DRAFT }).toFixed(2),
    ).toBe('0.00');
    expect(
      outstandingOf({ ...open(null), status: InvoiceStatus.VOID }).toFixed(2),
    ).toBe('0.00');
    expect(outstandingOf(open(null, '9000', '5000')).toFixed(2)).toBe(
      '4000.00',
    );
  });
});

describe('credit', () => {
  const payment = (
    id: string,
    amount: string,
    allocated = '0',
    refunded = '0',
  ) => ({
    id,
    status: PaymentStatus.RECORDED,
    amount: D(amount),
    allocatedAmount: D(allocated),
    refundedAmount: D(refunded),
  });

  it('is what was neither applied nor refunded, and nothing for reversed payments', () => {
    expect(unappliedOf(payment('a', '5000', '4000', '500')).toFixed(2)).toBe(
      '500.00',
    );
    expect(
      unappliedOf({
        ...payment('a', '5000'),
        status: PaymentStatus.REVERSED,
      }).toFixed(2),
    ).toBe('0.00');
  });

  it('is taken oldest first and only once', () => {
    const payments = [
      payment('old', '1000', '1000'),
      payment('a', '1000', '600'),
      payment('b', '3000'),
    ];
    expect(takeCredit(payments, D('1500'))).toEqual([
      { paymentId: 'a', amount: D('400') },
      { paymentId: 'b', amount: D('1100') },
    ]);
    expect(takeCredit(payments, D('3400.01'))).toBeNull();
  });
});
