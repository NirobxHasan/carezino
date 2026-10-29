'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, FileText, Printer } from 'lucide-react';

import { RequirePermission } from '@/components/auth/require-permission';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/feedback/states';
import { useBreadcrumbLabel } from '@/components/layout/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useInvoicePrint, useReceipt } from '@/lib/api/billing';
import { isApiError } from '@/lib/api/client';
import { formatPhone } from '@/lib/format';
import type { CenterLetterhead } from '@/lib/types';
import { useCenterFormat } from '../appointments/appointment-display';
import { useInstant } from '../packages/package-display';
import { INVOICE_STATUSES, financeLinks, formatMoney, isPositive } from './finance-display';

function Toolbar({ back, label }: { back: string; label: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
      <Button variant="ghost" asChild>
        <Link href={back}>
          <ArrowLeft /> {label}
        </Link>
      </Button>
      <Button onClick={() => window.print()}>
        <Printer /> Print
      </Button>
    </div>
  );
}

function Letterhead({
  center,
  title,
  children,
}: {
  center: CenterLetterhead;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
      <div>
        <p className="text-lg font-semibold">{center.name}</p>
        <p className="text-xs text-muted-foreground">
          {[center.address, center.district].filter(Boolean).join(', ')}
        </p>
        <p className="text-xs text-muted-foreground">
          {[formatPhone(center.phone), center.email, center.website].filter(Boolean).join(' · ')}
        </p>
      </div>
      <div className="text-right">
        <h1 className="text-base font-semibold uppercase tracking-wide">{title}</h1>
        {children}
      </div>
    </header>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children || '—'}</dd>
    </div>
  );
}

const sheet =
  'mx-auto grid max-w-3xl gap-6 rounded-xl border border-border bg-surface p-6 sm:p-10 print:max-w-none print:rounded-none print:border-0 print:p-0';

function Missing({ error, retry, back }: { error: unknown; retry: () => void; back: string }) {
  return (
    <Card>
      {isApiError(error, 404) || isApiError(error, 400) ? (
        <EmptyState
          icon={FileText}
          title="Not found"
          action={
            <Button variant="secondary" size="sm" asChild>
              <Link href={back}>Back</Link>
            </Button>
          }
        />
      ) : (
        <ErrorState error={error} onRetry={retry} />
      )}
    </Card>
  );
}

function InvoicePrint() {
  const { id } = useParams<{ id: string }>();
  const query = useInvoicePrint(id);
  const fmt = useCenterFormat();
  useBreadcrumbLabel(id, query.data?.invoice.number ?? undefined);
  if (query.isPending) return <PageSkeleton />;
  if (query.error || !query.data) {
    return (
      <Missing
        error={query.error}
        retry={() => void query.refetch()}
        back={financeLinks.invoices}
      />
    );
  }
  const { center, contact, invoice: i } = query.data;
  const c = i.currency;
  return (
    <>
      <Toolbar back={financeLinks.invoice(i.id)} label="Back to invoice" />
      <article className={sheet}>
        <Letterhead center={center} title="Invoice">
          <p className="text-sm font-medium tabular">{i.number ?? 'DRAFT'}</p>
          <p className="text-xs text-muted-foreground">Date {fmt.date(i.invoiceDate)}</p>
          {i.dueDate && <p className="text-xs text-muted-foreground">Due {fmt.date(i.dueDate)}</p>}
        </Letterhead>
        {(i.status === 'DRAFT' || i.status === 'VOID') && (
          <p className="rounded-md border border-warning/40 bg-warning-subtle px-3 py-2 text-sm font-medium text-warning-foreground">
            {i.status === 'DRAFT'
              ? 'Draft: not issued, nothing is owed yet.'
              : `Void: ${i.voidReason}`}
          </p>
        )}
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Fact label="Patient">{i.patient.fullName}</Fact>
          <Fact label="Patient ID">{i.patient.code}</Fact>
          <Fact label="Bill to">
            {contact.name
              ? `${contact.name}${contact.mobile ? `, ${formatPhone(contact.mobile)}` : ''}`
              : contact.mobile && formatPhone(contact.mobile)}
          </Fact>
        </dl>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Description</th>
              <th className="py-2 pr-3 text-right font-medium">Qty</th>
              <th className="py-2 pr-3 text-right font-medium">Unit price</th>
              <th className="py-2 pr-3 text-right font-medium">Discount</th>
              <th className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {i.items.map((l) => (
              <tr key={l.id} className="border-b border-border align-top">
                <td className="py-2 pr-3">{l.description}</td>
                <td className="py-2 pr-3 text-right tabular">{l.quantity}</td>
                <td className="py-2 pr-3 text-right tabular">{formatMoney(l.unitPrice, c)}</td>
                <td className="py-2 pr-3 text-right tabular">
                  {isPositive(l.discountAmount) ? `−${formatMoney(l.discountAmount, c)}` : '—'}
                </td>
                <td className="py-2 text-right tabular">{formatMoney(l.totalAmount, c)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="ml-auto grid w-full max-w-xs gap-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="tabular">{formatMoney(i.subtotal, c)}</dd>
          </div>
          {isPositive(i.discountAmount) && (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Discount</dt>
              <dd className="tabular">−{formatMoney(i.discountAmount, c)}</dd>
            </div>
          )}
          {isPositive(i.taxAmount) && (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">
                {i.taxLabel} ({i.taxRate}%)
              </dt>
              <dd className="tabular">{formatMoney(i.taxAmount, c)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-border pt-1 font-semibold">
            <dt>Total</dt>
            <dd className="tabular">{formatMoney(i.totalAmount, c)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Paid</dt>
            <dd className="tabular">{formatMoney(i.paidAmount, c)}</dd>
          </div>
          <div className="flex justify-between font-semibold">
            <dt>Balance due</dt>
            <dd className="tabular">{formatMoney(i.outstanding, c)}</dd>
          </div>
        </dl>
        {i.notes && <p className="whitespace-pre-line text-sm">{i.notes}</p>}
        <footer className="border-t border-border pt-3 text-xs text-muted-foreground">
          Status: {INVOICE_STATUSES[i.status].label}. Please quote{' '}
          {i.number ?? 'the invoice number'} with your payment.
        </footer>
      </article>
    </>
  );
}

function ReceiptPrint() {
  const { id } = useParams<{ id: string }>();
  const query = useReceipt(id);
  const fmt = useCenterFormat();
  const instant = useInstant();
  useBreadcrumbLabel(id, query.data?.payment.number);
  if (query.isPending) return <PageSkeleton />;
  if (query.error || !query.data) {
    return (
      <Missing
        error={query.error}
        retry={() => void query.refetch()}
        back={financeLinks.payments}
      />
    );
  }
  const { center, payment: p } = query.data;
  const c = p.currency;
  const applied = p.allocations.filter((a) => a.active);
  return (
    <>
      <Toolbar back={financeLinks.payment(p.id)} label="Back to payment" />
      <article className={sheet}>
        <Letterhead center={center} title="Money receipt">
          <p className="text-sm font-medium tabular">{p.number}</p>
          <p className="text-xs text-muted-foreground">{instant(p.collectedAt)}</p>
        </Letterhead>
        {p.status === 'REVERSED' && (
          <p className="rounded-md border border-danger/40 bg-danger-subtle px-3 py-2 text-sm font-medium text-danger-foreground">
            Reversed: this payment was recorded in error and doesn’t count. {p.reversalReason}
          </p>
        )}
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Fact label="Received from">{p.patient.fullName}</Fact>
          <Fact label="Patient ID">{p.patient.code}</Fact>
          <Fact label="Amount">
            <span className="text-base font-semibold tabular">{formatMoney(p.amount, c)}</span>
          </Fact>
          <Fact label="Payment method">{p.method.name}</Fact>
          <Fact label="Transaction reference">{p.transactionReference}</Fact>
          <Fact label="Received by">{p.collectedBy.fullName}</Fact>
        </dl>
        <div>
          <h2 className="mb-2 text-sm font-semibold">Applied to</h2>
          {applied.length ? (
            <table className="w-full text-sm">
              <tbody>
                {applied.map((a) => (
                  <tr key={a.id} className="border-b border-border">
                    <td className="py-1.5">
                      Invoice {a.invoice.number}{' '}
                      <span className="text-muted-foreground">
                        of {fmt.date(a.invoice.invoiceDate)}
                      </span>
                    </td>
                    <td className="py-1.5 text-right tabular">{formatMoney(a.amount, c)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted-foreground">Not applied to an invoice.</p>
          )}
          {isPositive(p.unappliedAmount) && (
            <p className="mt-2 text-sm">
              Held as advance credit:{' '}
              <span className="font-medium tabular">{formatMoney(p.unappliedAmount, c)}</span>
            </p>
          )}
          {isPositive(p.refundedAmount) && (
            <p className="mt-1 text-sm">
              Refunded: <span className="tabular">{formatMoney(p.refundedAmount, c)}</span>
            </p>
          )}
        </div>
        <footer className="border-t border-border pt-3 text-xs text-muted-foreground">
          Recorded by the center’s staff.{' '}
          {p.method.name.toLowerCase() === 'cash'
            ? ''
            : `This is not a confirmation from ${p.method.name}.`}
        </footer>
      </article>
    </>
  );
}

export function InvoicePrintScreen() {
  return (
    <RequirePermission permission="invoices.read">
      <InvoicePrint />
    </RequirePermission>
  );
}

export function ReceiptScreen() {
  return (
    <RequirePermission permission="payments.read">
      <ReceiptPrint />
    </RequirePermission>
  );
}
