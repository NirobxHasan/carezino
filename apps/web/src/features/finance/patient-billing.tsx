'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  AlarmClock,
  Banknote,
  FilePlus2,
  FileText,
  HandCoins,
  Receipt,
  Wallet,
} from 'lucide-react';

import { DataTable } from '@/components/data-table/data-table';
import { KpiCard } from '@/components/domain/kpi-card';
import { EmptyState } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  useBillableCharges,
  usePatientBilling,
  usePatientInvoices,
  usePatientPayments,
} from '@/lib/api/billing';
import { useSession } from '@/lib/session';
import { TherapyTypeChip, useCenterFormat } from '../appointments/appointment-display';
import { useInstant } from '../packages/package-display';
import { useCollectPaymentDialog } from './collect-payment';
import {
  Amount,
  ITEM_KINDS,
  financeLinks,
  formatMoney,
  isPositive,
  sumMoney,
} from './finance-display';
import { invoiceColumns } from './invoices-screen';
import { paymentColumns } from './payments-screen';

/** Packages, assessments and sessions not on an invoice yet, to invoice in one go. */
function Uninvoiced({ patientId }: { patientId: string }) {
  const fmt = useCenterFormat();
  const { data, isPending } = useBillableCharges({ patientId });
  const [picked, setPicked] = React.useState<string[]>([]);
  const items = data?.items ?? [];
  if (isPending || !items.length) return null;
  const priced = items.filter((c) => c.unitPrice !== null);
  const chosen = picked.length ? picked : priced.map((c) => c.key);
  const total = sumMoney(
    items.filter((c) => chosen.includes(c.key) && c.unitPrice).map((c) => c.unitPrice!),
  );
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Not yet invoiced</CardTitle>
          <CardDescription>
            Packages bought, assessments booked and completed sessions no package pays for.
          </CardDescription>
        </div>
        <Button size="sm" asChild disabled={!chosen.length}>
          <Link href={financeLinks.newInvoice({ patientId, charges: chosen })}>
            <FilePlus2 /> Invoice {chosen.length === priced.length ? 'all' : chosen.length} ·{' '}
            {formatMoney(total)}
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {items.map((c) => {
            const id = `charge-${c.key}`;
            return (
              <li key={c.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <label htmlFor={id} className="flex min-w-0 cursor-pointer items-center gap-3">
                  <Checkbox
                    id={id}
                    disabled={!c.unitPrice}
                    checked={chosen.includes(c.key)}
                    onCheckedChange={(on) =>
                      setPicked(() => (on ? [...chosen, c.key] : chosen.filter((k) => k !== c.key)))
                    }
                  />
                  <span className="grid min-w-0">
                    <span className="truncate text-sm">{c.description}</span>
                    <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {ITEM_KINDS[c.kind]}
                      {c.appointment && (
                        <>
                          <TherapyTypeChip therapyType={c.appointment.therapyType} />
                          {fmt.date(c.appointment.date)}
                        </>
                      )}
                    </span>
                    {c.problem && (
                      <span className="text-xs text-warning-foreground">{c.problem}</span>
                    )}
                  </span>
                </label>
                {c.unitPrice ? (
                  <Amount value={c.unitPrice} />
                ) : (
                  <span className="text-xs text-muted-foreground">No price</span>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * A patient's billing: what they owe, their credit, what isn't invoiced yet, and every
 * invoice, payment and refund. This patient's account only: balances of siblings who
 * share a guardian are never merged.
 */
export function PatientBillingPanel({
  patient,
}: {
  patient: { id: string; fullName: string; code: string };
}) {
  const { can } = useSession();
  const fmt = useCenterFormat();
  const instant = useInstant();
  const summary = usePatientBilling(patient.id);
  const invoices = usePatientInvoices(patient.id);
  const payments = usePatientPayments(patient.id, can('payments.read'));
  const [collect, dialog] = useCollectPaymentDialog();
  const invoiceCols = React.useMemo(
    () => invoiceColumns({ fmt, showPatient: false, onCollect: collect }),
    [fmt, collect],
  );
  const paymentCols = React.useMemo(
    () => paymentColumns({ instant, showPatient: false }),
    [instant],
  );
  const s = summary.data;
  const c = s?.currency;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted-foreground">
          This patient’s account only. Package sessions are tracked on the Packages tab.
        </p>
        <div className="flex flex-wrap gap-2">
          {can('payments.collect') && (
            <Button size="sm" onClick={() => collect({ patient })}>
              <Banknote /> Collect payment
            </Button>
          )}
          {can('invoices.create') && (
            <Button size="sm" variant="secondary" asChild>
              <Link href={financeLinks.newInvoice({ patientId: patient.id })}>
                <FilePlus2 /> Generate invoice
              </Link>
            </Button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Outstanding"
          value={s ? formatMoney(s.outstanding, c) : '—'}
          hint={s && `${s.openInvoices} open invoice${s.openInvoices === 1 ? '' : 's'}`}
          icon={HandCoins}
          tone={s && isPositive(s.outstanding) ? 'warning' : 'neutral'}
          loading={summary.isPending}
        />
        <KpiCard
          label="Overdue"
          value={s ? formatMoney(s.overdue, c) : '—'}
          hint={s && `${s.overdueInvoices} invoice${s.overdueInvoices === 1 ? '' : 's'}`}
          icon={AlarmClock}
          tone={s && isPositive(s.overdue) ? 'warning' : 'neutral'}
          loading={summary.isPending}
        />
        <KpiCard
          label="Unapplied credit"
          value={s ? formatMoney(s.unappliedCredit, c) : '—'}
          hint="Advance payments held"
          icon={Wallet}
          tone={s && isPositive(s.unappliedCredit) ? 'primary' : 'neutral'}
          loading={summary.isPending}
        />
        <KpiCard
          label="Paid to date"
          value={s ? formatMoney(s.paid, c) : '—'}
          hint={s && `of ${formatMoney(s.invoiced, c)} invoiced`}
          icon={Receipt}
          tone="success"
          loading={summary.isPending}
        />
      </div>
      {can('invoices.create') && <Uninvoiced patientId={patient.id} />}
      <DataTable
        label="Invoices"
        columns={invoiceCols}
        data={invoices.data?.items}
        loading={invoices.isFetching}
        error={invoices.error}
        onRetry={() => void invoices.refetch()}
        getRowId={(i) => i.id}
        rowHref={(i) => financeLinks.invoice(i.id)}
        toolbar={<h2 className="text-card-title">Invoices</h2>}
        empty={<EmptyState compact icon={FileText} title="No invoices yet." />}
      />
      {can('payments.read') && (
        <DataTable
          label="Payments"
          columns={paymentCols}
          data={payments.data?.items}
          loading={payments.isFetching}
          error={payments.error}
          onRetry={() => void payments.refetch()}
          getRowId={(p) => p.id}
          rowHref={(p) => financeLinks.payment(p.id)}
          toolbar={<h2 className="text-card-title">Payments and receipts</h2>}
          empty={<EmptyState compact icon={Receipt} title="No payments yet." />}
        />
      )}
      {payments.data && payments.data.refunds.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Refunds</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {payments.data.refunds.map((r) => (
                <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                  <span className="grid">
                    <span>{r.reason}</span>
                    <span className="text-xs text-muted-foreground">
                      {instant(r.refundedAt)} · from{' '}
                      <Link href={financeLinks.payment(r.payment.id)} className="hover:underline">
                        {r.payment.number}
                      </Link>{' '}
                      · {r.method.name}
                    </span>
                  </span>
                  <Amount value={r.amount} currency={c} strong />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      {dialog}
    </div>
  );
}
