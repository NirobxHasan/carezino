'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  AlarmClock,
  ArrowDownUp,
  Banknote,
  CalendarCheck,
  FileText,
  HandCoins,
  Plus,
  ReceiptText,
  Wallet,
} from 'lucide-react';

import { RequirePermission } from '@/components/auth/require-permission';
import { KpiCard } from '@/components/domain/kpi-card';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { DateRangePicker } from '@/components/forms/date-picker';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useCollectionsReport, useDues, useFinanceSummary } from '@/lib/api/billing';
import { useSession } from '@/lib/session';
import { useCenterFormat } from '../appointments/appointment-display';
import { useInstant } from '../packages/package-display';
import {
  Amount,
  FinanceNav,
  InvoiceStatusBadge,
  PaymentStatusBadge,
  financeLinks,
  formatMoney,
  sumMoney,
} from './finance-display';

function useRange() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const from = params.get('from') ?? undefined;
  const to = params.get('to') ?? undefined;
  const set = (r: { from: string; to: string } | null) => {
    const q = new URLSearchParams();
    if (r) {
      q.set('from', r.from);
      q.set('to', r.to);
    }
    const s = q.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };
  return [{ from, to }, set] as const;
}

/** Managers and administrators: the period's money in and out, and what's owed. */
function ManagerOverview() {
  const fmt = useCenterFormat();
  const instant = useInstant();
  const [range, setRange] = useRange();
  const { data: s, error, refetch, isPending } = useFinanceSummary(range);
  const period = s ? `${s.from ? fmt.date(s.from) : 'start'} – ${fmt.date(s.to)}` : '';
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted-foreground">
          {range.from ? period : `This month so far${s ? ` (${period})` : ''}`}
        </p>
        <DateRangePicker
          value={range.from && range.to ? { from: range.from, to: range.to } : null}
          onChange={setRange}
          placeholder="This month"
        />
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          label="Today’s collections"
          value={s ? formatMoney(s.todayCollections, s.currency) : '—'}
          hint={s && `${s.todayPayments} payment${s.todayPayments === 1 ? '' : 's'}`}
          icon={CalendarCheck}
          tone="primary"
          loading={isPending}
        />
        <KpiCard
          label="Collections"
          value={s ? formatMoney(s.netCollections, s.currency) : '—'}
          hint={
            s &&
            (s.refunds !== '0.00'
              ? `${formatMoney(s.collections, s.currency)} less ${formatMoney(s.refunds, s.currency)} refunded`
              : `${s.payments} payments`)
          }
          icon={Banknote}
          tone="success"
          href={financeLinks.payments}
          loading={isPending}
        />
        <KpiCard
          label="Outstanding dues"
          value={s ? formatMoney(s.outstanding, s.currency) : '—'}
          hint={s && `${formatMoney(s.overdue, s.currency)} overdue`}
          icon={AlarmClock}
          tone={s && s.overdueInvoices > 0 ? 'warning' : 'neutral'}
          href={financeLinks.dues}
          loading={isPending}
        />
        <KpiCard
          label="Unapplied credit"
          value={s ? formatMoney(s.unappliedCredit, s.currency) : '—'}
          hint="Advance payments held"
          icon={Wallet}
          href={`${financeLinks.payments}?status=credit`}
          loading={isPending}
        />
        <KpiCard
          label="Expenses"
          value={s ? formatMoney(s.expenses, s.currency) : '—'}
          hint={s && `${s.expenseCount} recorded`}
          icon={ReceiptText}
          href={financeLinks.expenses}
          loading={isPending}
        />
        <KpiCard
          label="Net cash movement"
          value={s ? formatMoney(s.netCashMovement, s.currency) : '—'}
          hint="Collections − refunds − expenses"
          icon={ArrowDownUp}
          loading={isPending}
        />
      </div>
      {s && (
        <p className="mb-4 text-[13px] text-muted-foreground">
          Invoiced in this period:{' '}
          <span className="font-medium text-foreground tabular">
            {formatMoney(s.invoiced, s.currency)}
          </span>{' '}
          on {s.invoiceCount} invoice{s.invoiceCount === 1 ? '' : 's'}. Invoiced isn’t collected,
          and net cash movement isn’t profit.
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>By payment method</CardTitle>
            <CardDescription>Money in and out of each method in the period.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {s?.byMethod.length ? (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="py-2 font-medium">Method</th>
                    <th className="py-2 text-right font-medium">Collected</th>
                    <th className="py-2 text-right font-medium">Refunds</th>
                    <th className="py-2 text-right font-medium">Expenses</th>
                    <th className="py-2 text-right font-medium">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {s.byMethod.map((m) => (
                    <tr key={m.method.id} className="border-b border-border last:border-0">
                      <td className="py-2">
                        {m.method.name}
                        <span className="ml-1 text-xs text-muted-foreground">({m.payments})</span>
                      </td>
                      <td className="py-2 text-right">
                        <Amount value={m.collected} currency={s.currency} />
                      </td>
                      <td className="py-2 text-right">
                        <Amount value={m.refunds} currency={s.currency} />
                      </td>
                      <td className="py-2 text-right">
                        <Amount value={m.expenses} currency={s.currency} />
                      </td>
                      <td className="py-2 text-right">
                        <Amount value={m.net} currency={s.currency} strong />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState compact title="No money moved in this period." />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Outstanding invoices</CardTitle>
              <CardDescription>Oldest due first.</CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link href={financeLinks.dues}>View all</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {s?.outstandingList.length ? (
              <ul className="divide-y divide-border">
                {s.outstandingList.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-2 py-2">
                    <Link
                      href={financeLinks.invoice(i.id)}
                      className="grid min-w-0 hover:underline"
                    >
                      <span className="truncate text-sm font-medium">{i.patient.fullName}</span>
                      <span className="text-xs text-muted-foreground">
                        {i.number} · {i.dueDate ? `due ${fmt.date(i.dueDate)}` : 'no due date'}
                      </span>
                    </Link>
                    <span className="flex items-center gap-2">
                      <InvoiceStatusBadge status={i.status} overdue={i.overdue} />
                      <Amount value={i.outstanding} currency={i.currency} strong />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState compact title="Nothing outstanding." />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Recent payments</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href={financeLinks.payments}>View all</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {s?.recentPayments.length ? (
              <ul className="divide-y divide-border">
                {s.recentPayments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                    <Link
                      href={financeLinks.payment(p.id)}
                      className="grid min-w-0 hover:underline"
                    >
                      <span className="truncate text-sm font-medium">{p.patient.fullName}</span>
                      <span className="text-xs text-muted-foreground">
                        {p.number} · {p.method.name} · {instant(p.collectedAt)}
                      </span>
                    </Link>
                    <span className="flex items-center gap-2">
                      {p.status === 'REVERSED' && <PaymentStatusBadge status={p.status} />}
                      <Amount value={p.amount} currency={p.currency} strong />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState compact title="No payments yet." />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Recent expenses</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href={financeLinks.expenses}>View all</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {s?.recentExpenses.length ? (
              <ul className="divide-y divide-border">
                {s.recentExpenses.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2 py-2">
                    <span className="grid min-w-0">
                      <span className="truncate text-sm">{e.description}</span>
                      <span className="text-xs text-muted-foreground">
                        {fmt.date(e.expenseDate)} · {e.category.name}
                        {e.status === 'VOID' && ' · void'}
                      </span>
                    </span>
                    <Amount
                      value={e.amount}
                      strong
                      className={e.status === 'VOID' ? 'line-through' : undefined}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState compact title="No expenses yet." />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

/** Front desk: what they collected today and what's owed, with the next steps. */
function FrontDeskOverview() {
  const { can } = useSession();
  const today = useCollectionsReport({});
  const dues = useDues({ pageSize: 1 });
  const todayDate = today.data?.to;
  const mine = today.data?.rows.filter((r) => r.date === todayDate) ?? [];
  const collectedToday = sumMoney(mine.map((r) => r.collected));
  const overdue = dues.data
    ? sumMoney(dues.data.aging.filter((a) => a.bucket !== 'NOT_DUE').map((a) => a.outstanding))
    : '0.00';
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="You collected today"
          value={formatMoney(collectedToday, today.data?.currency)}
          hint={`${mine.reduce((n, r) => n + r.payments, 0)} payments`}
          icon={HandCoins}
          tone="primary"
          href={financeLinks.reports}
          loading={today.isPending}
        />
        <KpiCard
          label="Outstanding dues"
          value={
            dues.data
              ? formatMoney(sumMoney(dues.data.aging.map((a) => a.outstanding)), dues.data.currency)
              : '—'
          }
          hint={dues.data && `${formatMoney(overdue, dues.data.currency)} overdue`}
          icon={AlarmClock}
          tone="warning"
          href={financeLinks.dues}
          loading={dues.isPending}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href={financeLinks.dues}>
            <Banknote /> Collect a payment
          </Link>
        </Button>
        {can('invoices.create') && (
          <Button variant="secondary" asChild>
            <Link href={financeLinks.newInvoice()}>
              <Plus /> New invoice
            </Link>
          </Button>
        )}
        <Button variant="secondary" asChild>
          <Link href={financeLinks.invoices}>
            <FileText /> Invoices
          </Link>
        </Button>
      </div>
    </>
  );
}

export function FinanceOverviewScreen() {
  const { can } = useSession();
  return (
    <RequirePermission permission="invoices.read">
      <div className="animate-in">
        <PageHeader
          title="Finance"
          description="Invoices, payments, dues and expenses."
          actions={
            can('invoices.create') && (
              <Button asChild>
                <Link href={financeLinks.newInvoice()}>
                  <Plus /> New invoice
                </Link>
              </Button>
            )
          }
        />
        <FinanceNav />
        {can('finance_reports.read') ? <ManagerOverview /> : <FrontDeskOverview />}
      </div>
    </RequirePermission>
  );
}
