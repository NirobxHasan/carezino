'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Printer } from 'lucide-react';

import { RequirePermission } from '@/components/auth/require-permission';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/feedback/states';
import { DateRangePicker } from '@/components/forms/date-picker';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useCollectionsReport,
  useDues,
  useExpensesSummary,
  usePackageSales,
  type RangeParams,
} from '@/lib/api/billing';
import { useSession } from '@/lib/session';
import { useCenterFormat } from '../appointments/appointment-display';
import { AGING, Amount, FinanceNav, financeLinks } from './finance-display';

type Report = 'collections' | 'dues' | 'expenses' | 'packages';

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`py-2 pr-3 font-medium ${right ? 'text-right' : ''}`}>{children}</th>;
}

function Td({
  children,
  right,
  strong,
}: {
  children: React.ReactNode;
  right?: boolean;
  strong?: boolean;
}) {
  return (
    <td className={`py-2 pr-3 ${right ? 'text-right' : ''} ${strong ? 'font-semibold' : ''}`}>
      {children}
    </td>
  );
}

function Table({
  head,
  children,
  foot,
}: {
  head: React.ReactNode;
  children: React.ReactNode;
  foot?: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr className="border-b border-border">{head}</tr>
        </thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-border">{children}</tbody>
        {foot && <tfoot className="border-t-2 border-border font-semibold">{foot}</tfoot>}
      </table>
    </div>
  );
}

function Collections({ range }: { range: RangeParams }) {
  const fmt = useCenterFormat();
  const { can } = useSession();
  const { data, error, refetch, isPending } = useCollectionsReport(range);
  if (isPending) return <TableSkeleton />;
  if (error || !data) return <ErrorState error={error} onRetry={() => void refetch()} />;
  const c = data.currency;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Daily collections</CardTitle>
        <CardDescription>
          {can('finance_reports.read') ? 'Everyone’s' : 'Your'} collections by day, collector and
          method. Reversed payments were recorded in error and aren’t counted.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {data.rows.length ? (
          <Table
            head={
              <>
                <Th>Date</Th>
                <Th>Collector</Th>
                <Th>Method</Th>
                <Th right>Payments</Th>
                <Th right>Collected</Th>
                <Th right>Reversed</Th>
                <Th right>Refunds</Th>
                <Th right>Net</Th>
              </>
            }
            foot={
              <tr>
                <Td>Total</Td>
                <Td>{''}</Td>
                <Td>{''}</Td>
                <Td right>{data.totals.payments}</Td>
                <Td right>
                  <Amount value={data.totals.collected} currency={c} />
                </Td>
                <Td right>
                  <Amount value={data.totals.reversed} currency={c} />
                </Td>
                <Td right>
                  <Amount value={data.totals.refunds} currency={c} />
                </Td>
                <Td right>
                  <Amount value={data.totals.net} currency={c} strong />
                </Td>
              </tr>
            }
          >
            {data.rows.map((r) => (
              <tr key={`${r.date}-${r.collector?.id}-${r.method?.id}`}>
                <Td>{fmt.date(r.date)}</Td>
                <Td>{r.collector?.fullName ?? '—'}</Td>
                <Td>{r.method?.name ?? '—'}</Td>
                <Td right>{r.payments}</Td>
                <Td right>
                  <Amount value={r.collected} currency={c} />
                </Td>
                <Td right>
                  <Amount value={r.reversed} currency={c} />
                </Td>
                <Td right>
                  <Amount value={r.refunds} currency={c} />
                </Td>
                <Td right>
                  <Amount value={r.net} currency={c} strong />
                </Td>
              </tr>
            ))}
          </Table>
        ) : (
          <EmptyState compact title="No collections in this period." />
        )}
      </CardContent>
    </Card>
  );
}

function DuesAging() {
  const { data, error, refetch, isPending } = useDues({ pageSize: 1 });
  if (isPending) return <TableSkeleton rows={5} />;
  if (error || !data) return <ErrorState error={error} onRetry={() => void refetch()} />;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Outstanding dues by age</CardTitle>
        <Button variant="secondary" size="sm" asChild>
          <Link href={financeLinks.dues}>See every invoice</Link>
        </Button>
      </CardHeader>
      <CardContent>
        <Table
          head={
            <>
              <Th>Aging</Th>
              <Th right>Invoices</Th>
              <Th right>Outstanding</Th>
            </>
          }
          foot={
            <tr>
              <Td>Total</Td>
              <Td right>{data.aging.reduce((n, a) => n + a.invoices, 0)}</Td>
              <Td right>
                <Amount value={data.outstanding} currency={data.currency} strong />
              </Td>
            </tr>
          }
        >
          {data.aging.map((a) => (
            <tr key={a.bucket}>
              <Td>
                <Link href={`${financeLinks.dues}?aging=${a.bucket}`} className="hover:underline">
                  {a.bucket === 'NOT_DUE' ? 'Not due yet' : `${AGING[a.bucket].label} overdue`}
                </Link>
              </Td>
              <Td right>{a.invoices}</Td>
              <Td right>
                <Amount value={a.outstanding} currency={data.currency} />
              </Td>
            </tr>
          ))}
        </Table>
      </CardContent>
    </Card>
  );
}

function Expenses({ range }: { range: RangeParams }) {
  const { data, error, refetch, isPending } = useExpensesSummary(range);
  if (isPending) return <TableSkeleton rows={5} />;
  if (error || !data) return <ErrorState error={error} onRetry={() => void refetch()} />;
  const c = data.currency;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Expenses by category</CardTitle>
        </CardHeader>
        <CardContent>
          {data.categories.length ? (
            <Table
              head={
                <>
                  <Th>Category</Th>
                  <Th right>Entries</Th>
                  <Th right>Amount</Th>
                </>
              }
              foot={
                <tr>
                  <Td>Total</Td>
                  <Td right>{data.count}</Td>
                  <Td right>
                    <Amount value={data.total} currency={c} strong />
                  </Td>
                </tr>
              }
            >
              {data.categories.map((r) => (
                <tr key={r.category?.id ?? 'none'}>
                  <Td>{r.category?.name ?? '—'}</Td>
                  <Td right>{r.expenses}</Td>
                  <Td right>
                    <Amount value={r.amount} currency={c} />
                  </Td>
                </tr>
              ))}
            </Table>
          ) : (
            <EmptyState compact title="No expenses in this period." />
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Paid by</CardTitle>
        </CardHeader>
        <CardContent>
          {data.methods.length ? (
            <Table
              head={
                <>
                  <Th>Method</Th>
                  <Th right>Entries</Th>
                  <Th right>Amount</Th>
                </>
              }
            >
              {data.methods.map((r) => (
                <tr key={r.method?.id ?? 'none'}>
                  <Td>{r.method?.name ?? '—'}</Td>
                  <Td right>{r.expenses}</Td>
                  <Td right>
                    <Amount value={r.amount} currency={c} />
                  </Td>
                </tr>
              ))}
            </Table>
          ) : (
            <EmptyState compact title="No expenses in this period." />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PackageSales({ range }: { range: RangeParams }) {
  const { data, error, refetch, isPending } = usePackageSales(range);
  if (isPending) return <TableSkeleton rows={5} />;
  if (error || !data) return <ErrorState error={error} onRetry={() => void refetch()} />;
  const c = data.currency;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Package sales</CardTitle>
        <CardDescription>
          Enrollments made in the period. Agreed is the enrollments’ price; invoiced and collected
          are what their invoices charged and received.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {data.rows.length ? (
          <Table
            head={
              <>
                <Th>Package</Th>
                <Th right>Enrollments</Th>
                <Th right>Agreed</Th>
                <Th right>Invoiced</Th>
                <Th right>Collected</Th>
              </>
            }
            foot={
              <tr>
                <Td>Total</Td>
                <Td right>{data.totals.enrollments}</Td>
                <Td right>
                  <Amount value={data.totals.agreed} currency={c} />
                </Td>
                <Td right>
                  <Amount value={data.totals.invoiced} currency={c} />
                </Td>
                <Td right>
                  <Amount value={data.totals.collected} currency={c} strong />
                </Td>
              </tr>
            }
          >
            {data.rows.map((r) => (
              <tr key={r.package.id}>
                <Td>
                  {r.package.name}
                  <span className="block text-xs font-normal text-muted-foreground">
                    {r.package.code}
                    {r.cancelled > 0 && ` · ${r.cancelled} cancelled`}
                    {r.uninvoiced > 0 && ` · ${r.uninvoiced} not invoiced`}
                  </span>
                </Td>
                <Td right>{r.enrollments}</Td>
                <Td right>
                  <Amount value={r.agreed} currency={c} />
                </Td>
                <Td right>
                  <Amount value={r.invoiced} currency={c} />
                </Td>
                <Td right>
                  <Amount value={r.collected} currency={c} strong />
                </Td>
              </tr>
            ))}
          </Table>
        ) : (
          <EmptyState compact title="No packages sold in this period." />
        )}
      </CardContent>
    </Card>
  );
}

function Reports() {
  const { can } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const all = can('finance_reports.read');
  const available: Report[] = all
    ? ['collections', 'dues', ...(can('expenses.read') ? (['expenses'] as const) : []), 'packages']
    : ['collections'];
  const requested = params.get('report') as Report | null;
  const report: Report = requested && available.includes(requested) ? requested : 'collections';
  const range: RangeParams = {
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
  };
  const go = (patch: { report?: Report; from?: string; to?: string }) => {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) if (v) q.set(k, v);
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  };
  return (
    <>
      <PageHeader
        title="Finance"
        description="Invoices, payments, dues and expenses."
        actions={
          <Button variant="secondary" onClick={() => window.print()} className="print:hidden">
            <Printer /> Print
          </Button>
        }
      />
      <FinanceNav />
      <Tabs value={report} onValueChange={(v) => go({ report: v as Report })}>
        <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
          <TabsList>
            <TabsTrigger value="collections">Daily collections</TabsTrigger>
            {available.includes('dues') && <TabsTrigger value="dues">Outstanding dues</TabsTrigger>}
            {available.includes('expenses') && <TabsTrigger value="expenses">Expenses</TabsTrigger>}
            {available.includes('packages') && (
              <TabsTrigger value="packages">Package sales</TabsTrigger>
            )}
          </TabsList>
          {report !== 'dues' && (
            <DateRangePicker
              value={range.from && range.to ? { from: range.from, to: range.to } : null}
              onChange={(r) => go(r)}
              placeholder="This month"
            />
          )}
        </div>
        <TabsContent value="collections">
          <Collections range={range} />
        </TabsContent>
        <TabsContent value="dues">{report === 'dues' && <DuesAging />}</TabsContent>
        <TabsContent value="expenses">
          {report === 'expenses' && <Expenses range={range} />}
        </TabsContent>
        <TabsContent value="packages">
          {report === 'packages' && <PackageSales range={range} />}
        </TabsContent>
      </Tabs>
    </>
  );
}

export function FinanceReportsScreen() {
  return (
    <RequirePermission permission="finance_reports.read_own">
      <div className="animate-in">
        <Reports />
      </div>
    </RequirePermission>
  );
}
