'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Receipt, ReceiptText, Undo2, Wallet } from 'lucide-react';

import { RequirePermission } from '@/components/auth/require-permission';
import { DataTable, type ColumnDef } from '@/components/data-table/data-table';
import { FilterBar, SearchInput } from '@/components/data-table/filter-bar';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/feedback/states';
import { DateRangePicker } from '@/components/forms/date-picker';
import { Field } from '@/components/forms/field';
import { KpiCard } from '@/components/domain/kpi-card';
import { useBreadcrumbLabel } from '@/components/layout/breadcrumbs';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui/sonner';
import { Textarea } from '@/components/ui/textarea';
import {
  useAllocatePayment,
  useInvoiceList,
  usePayment,
  usePaymentList,
  usePaymentMethods,
  useRefundPayment,
  useReversePayment,
} from '@/lib/api/billing';
import { isApiError } from '@/lib/api/client';
import { useDebounced } from '@/lib/hooks/use-debounced';
import type { PaymentDetail, PaymentStatus, PaymentSummary } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useCenterFormat } from '../appointments/appointment-display';
import { useInstant } from '../packages/package-display';
import {
  Amount,
  FinanceNav,
  PaymentStatusBadge,
  RELEASE_REASONS,
  compareMoney,
  distribute,
  financeLinks,
  formatMoney,
  isPositive,
} from './finance-display';
import { ReleaseDialog } from './invoice-details';

const PAGE_SIZES = [10, 20, 50];
const DEFAULT_PAGE_SIZE = 20;

export function paymentColumns({
  instant,
  showPatient = true,
}: {
  instant: (iso: string) => string;
  showPatient?: boolean;
}): ColumnDef<PaymentSummary, unknown>[] {
  return [
    {
      id: 'number',
      header: 'Receipt',
      cell: ({ row }) => (
        <span className="flex flex-col">
          <span
            className={cn(
              'font-medium tabular',
              row.original.status === 'REVERSED' && 'line-through',
            )}
          >
            {row.original.number}
          </span>
          <span className="text-xs text-muted-foreground">{instant(row.original.collectedAt)}</span>
        </span>
      ),
    },
    ...(showPatient
      ? ([
          {
            id: 'patient',
            header: 'Patient',
            cell: ({ row }) => (
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{row.original.patient.fullName}</span>
                <span className="text-xs text-muted-foreground tabular">
                  {row.original.patient.code}
                </span>
              </span>
            ),
          },
        ] as ColumnDef<PaymentSummary, unknown>[])
      : []),
    {
      id: 'method',
      header: 'Method',
      meta: { className: 'hidden md:table-cell text-[13px]' },
      cell: ({ row }) => (
        <span className="flex flex-col">
          {row.original.method.name}
          {row.original.transactionReference && (
            <span className="text-xs text-muted-foreground">
              {row.original.transactionReference}
            </span>
          )}
        </span>
      ),
    },
    {
      id: 'invoices',
      header: 'Applied to',
      meta: { className: 'hidden lg:table-cell text-[13px]' },
      cell: ({ row }) =>
        row.original.invoices.length ? (
          row.original.invoices.map((i) => i.number).join(', ')
        ) : (
          <span className="text-subtle-foreground">—</span>
        ),
    },
    {
      id: 'amount',
      header: () => <span className="block text-right">Amount</span>,
      meta: { className: 'text-right' },
      cell: ({ row }) => (
        <Amount value={row.original.amount} currency={row.original.currency} strong />
      ),
    },
    {
      id: 'credit',
      header: () => <span className="block text-right">Credit left</span>,
      meta: { className: 'hidden sm:table-cell text-right' },
      cell: ({ row }) => (
        <Amount value={row.original.unappliedAmount} currency={row.original.currency} />
      ),
    },
    {
      id: 'by',
      header: 'Collected by',
      meta: { className: 'hidden xl:table-cell text-[13px]' },
      cell: ({ row }) => row.original.collectedBy.fullName,
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => <PaymentStatusBadge status={row.original.status} />,
    },
  ];
}

function useListState() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const page = Number(params.get('page'));
  const size = Number(params.get('size'));
  const state = {
    q: params.get('q') ?? '',
    methodId: params.get('method') ?? 'all',
    status: (params.get('status') ?? 'all') as PaymentStatus | 'all' | 'credit',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    page: Number.isInteger(page) && page > 1 ? page : 1,
    pageSize: PAGE_SIZES.includes(size) ? size : DEFAULT_PAGE_SIZE,
  };
  const set = (patch: Partial<typeof state>) => {
    const next = { ...state, ...('page' in patch ? {} : { page: 1 }), ...patch };
    const q = new URLSearchParams();
    if (next.q.trim()) q.set('q', next.q.trim());
    if (next.methodId !== 'all') q.set('method', next.methodId);
    if (next.status !== 'all') q.set('status', next.status);
    if (next.from) q.set('from', next.from);
    if (next.to) q.set('to', next.to);
    if (next.page > 1) q.set('page', String(next.page));
    if (next.pageSize !== DEFAULT_PAGE_SIZE) q.set('size', String(next.pageSize));
    const s = q.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };
  return [state, set] as const;
}

function PaymentTable() {
  const instant = useInstant();
  const [state, set] = useListState();
  const [search, setSearch] = React.useState(state.q);
  const debounced = useDebounced(search, 300);
  React.useEffect(() => {
    if (debounced.trim() !== state.q.trim()) set({ q: debounced });
    // Only when the typed value settles, not when the URL changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  const methods = usePaymentMethods();
  const { data, isFetching, error, refetch } = usePaymentList({
    search: state.q,
    methodId: state.methodId === 'all' ? undefined : state.methodId,
    status: state.status === 'RECORDED' || state.status === 'REVERSED' ? state.status : undefined,
    withCredit: state.status === 'credit' || undefined,
    from: state.from || undefined,
    to: state.to || undefined,
    page: state.page,
    pageSize: state.pageSize,
  });
  const columns = React.useMemo(() => paymentColumns({ instant }), [instant]);
  const filtered =
    Boolean(state.q || state.from) || state.methodId !== 'all' || state.status !== 'all';
  const clear = () => {
    setSearch('');
    set({ q: '', methodId: 'all', status: 'all', from: '', to: '' });
  };
  return (
    <>
      <PageHeader title="Finance" description="Invoices, payments, dues and expenses." />
      <FinanceNav />
      <DataTable
        label="Payments"
        columns={columns}
        data={data?.items}
        loading={isFetching}
        error={error}
        onRetry={() => void refetch()}
        getRowId={(p) => p.id}
        rowHref={(p) => financeLinks.payment(p.id)}
        pagination={
          data
            ? {
                page: data.page,
                pageSize: data.pageSize,
                total: data.total,
                onPageChange: (page) => set({ page }),
                pageSizeOptions: PAGE_SIZES,
                onPageSizeChange: (pageSize) => set({ pageSize }),
              }
            : undefined
        }
        toolbar={
          <div className="grid gap-3">
            <FilterBar>
              <SearchInput
                value={search}
                onChange={setSearch}
                label="Search payments"
                placeholder="Receipt, reference, patient…"
              />
              <Select value={state.methodId} onValueChange={(methodId) => set({ methodId })}>
                <SelectTrigger size="sm" className="w-full sm:w-40" aria-label="Filter by method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any method</SelectItem>
                  {methods.data?.items.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={state.status}
                onValueChange={(v) => set({ status: v as typeof state.status })}
              >
                <SelectTrigger size="sm" className="w-full sm:w-40" aria-label="Filter by status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any status</SelectItem>
                  <SelectItem value="RECORDED">Recorded</SelectItem>
                  <SelectItem value="REVERSED">Reversed</SelectItem>
                  <SelectItem value="credit">With credit left</SelectItem>
                </SelectContent>
              </Select>
              <DateRangePicker
                value={state.from && state.to ? { from: state.from, to: state.to } : null}
                onChange={(r) => set({ from: r.from, to: r.to })}
                placeholder="Any date"
              />
              {filtered && (
                <Button variant="ghost" size="sm" onClick={clear}>
                  Clear filters
                </Button>
              )}
            </FilterBar>
            {data && (
              <p className="text-[13px] text-muted-foreground">
                {data.total} payment{data.total === 1 ? '' : 's'}; recorded total{' '}
                <span className="font-medium text-foreground tabular">
                  {formatMoney(data.totals.amount)}
                </span>
                {isPositive(data.totals.refunded) &&
                  `, of which ${formatMoney(data.totals.refunded)} refunded`}
                .
              </p>
            )}
          </div>
        }
        empty={
          filtered ? (
            <EmptyState title="No payments match these filters" />
          ) : (
            <EmptyState
              icon={Receipt}
              title="No payments yet"
              description="Collect payments from an invoice, the dues list or a patient’s billing tab."
            />
          )
        }
      />
    </>
  );
}

export function PaymentsScreen() {
  return (
    <RequirePermission permission="payments.read">
      <div className="animate-in">
        <PaymentTable />
      </div>
    </RequirePermission>
  );
}

// ── Details ─────────────────────────────────────────────────────────────────

function AllocateDialog({
  payment: p,
  open,
  onClose,
}: {
  payment: PaymentDetail;
  open: boolean;
  onClose: () => void;
}) {
  const fmt = useCenterFormat();
  const mutation = useAllocatePayment();
  const invoices = useInvoiceList(
    {
      patientId: p.patient.id,
      status: ['ISSUED', 'PARTIALLY_PAID'],
      sortBy: 'invoiceDate',
      sortOrder: 'asc',
      pageSize: 50,
    },
    open,
  );
  const [requestId, setRequestId] = React.useState(() => crypto.randomUUID());
  const items = invoices.data?.items ?? [];
  const parts = distribute(
    p.unappliedAmount,
    items.map((i) => i.outstanding),
  );
  const allocations = items
    .map((i, n) => ({ invoiceId: i.id, amount: parts[n] }))
    .filter((a) => isPositive(a.amount));
  const close = () => {
    mutation.reset();
    setRequestId(crypto.randomUUID());
    onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Apply {formatMoney(p.unappliedAmount, p.currency)} to invoices</DialogTitle>
          <DialogDescription>
            The credit left on {p.number} pays {p.patient.fullName}’s open invoices, oldest first.
          </DialogDescription>
        </DialogHeader>
        {items.length ? (
          <ul className="grid gap-1 text-sm">
            {items.map((i, n) => (
              <li key={i.id} className="flex justify-between gap-2">
                <span>
                  {i.number}{' '}
                  <span className="text-muted-foreground">
                    · {fmt.date(i.invoiceDate)} · owes {formatMoney(i.outstanding, i.currency)}
                  </span>
                </span>
                <span className="tabular font-medium">
                  {isPositive(parts[n]) ? formatMoney(parts[n], i.currency) : '—'}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            {invoices.isPending ? 'Loading…' : 'No open invoices to apply it to.'}
          </p>
        )}
        {isApiError(mutation.error) && (
          <p className="text-sm text-danger-foreground">{mutation.error.message}</p>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={close} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            disabled={!allocations.length}
            loading={mutation.isPending}
            onClick={() =>
              mutation.mutate(
                { id: p.id, allocations, requestId },
                {
                  onSuccess: () => {
                    toast.success('Credit applied');
                    close();
                  },
                },
              )
            }
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RefundDialog({
  payment: p,
  open,
  onClose,
}: {
  payment: PaymentDetail;
  open: boolean;
  onClose: () => void;
}) {
  const methods = usePaymentMethods('ACTIVE', open);
  const mutation = useRefundPayment();
  const [amount, setAmount] = React.useState(p.unappliedAmount);
  const [methodId, setMethodId] = React.useState(p.method.isActive ? p.method.id : '');
  const [reason, setReason] = React.useState('');
  const [reference, setReference] = React.useState('');
  const [requestId, setRequestId] = React.useState(() => crypto.randomUUID());
  const errors = isApiError(mutation.error) ? (mutation.error.errors ?? {}) : {};
  const close = () => {
    mutation.reset();
    setReason('');
    setReference('');
    setRequestId(crypto.randomUUID());
    onClose();
  };
  const tooMuch = compareMoney(amount, p.unappliedAmount) > 0;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Refund from {p.number}</DialogTitle>
          <DialogDescription>
            Up to {formatMoney(p.unappliedAmount, p.currency)} can be refunded: the part not applied
            to invoices. To refund money that paid an invoice, take it off the invoice first.
            Package sessions aren’t changed: cancel or adjust the enrollment separately if needed.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Amount"
              required
              error={errors.amount ?? (tooMuch ? 'More than can be refunded' : undefined)}
            >
              <Input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="tabular"
              />
            </Field>
            <Field label="Refunded by" required error={errors.methodId}>
              <Select value={methodId} onValueChange={setMethodId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose" />
                </SelectTrigger>
                <SelectContent>
                  {methods.data?.items.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Reference" optional error={errors.reference}>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <Field label="Reason" required error={errors.reason}>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {isApiError(mutation.error) && !mutation.error.errors && (
            <p className="text-sm text-danger-foreground">{mutation.error.message}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={close} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={!isPositive(amount) || tooMuch || !methodId || reason.trim().length < 3}
            loading={mutation.isPending}
            onClick={() =>
              mutation.mutate(
                {
                  id: p.id,
                  input: {
                    amount,
                    methodId,
                    reason: reason.trim(),
                    reference: reference.trim() || null,
                    requestId,
                  },
                },
                {
                  onSuccess: () => {
                    toast.success(`${formatMoney(amount, p.currency)} refunded`);
                    close();
                  },
                },
              )
            }
          >
            Refund {isPositive(amount) && formatMoney(amount, p.currency)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReverseDialog({
  payment: p,
  open,
  onClose,
}: {
  payment: PaymentDetail;
  open: boolean;
  onClose: () => void;
}) {
  const mutation = useReversePayment();
  const [reason, setReason] = React.useState('');
  const close = () => {
    mutation.reset();
    setReason('');
    onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reverse {p.number}?</DialogTitle>
          <DialogDescription>
            For a payment recorded in error, such as a wrong amount or one entered twice. It’s taken
            off {p.invoices.length ? 'its invoices, which are owed again,' : 'the patient’s credit'}{' '}
            and no longer counts in collections. It stays on record as reversed. If money was
            actually received, record a refund instead.
          </DialogDescription>
        </DialogHeader>
        <Field
          label="Reason"
          required
          error={isApiError(mutation.error) ? mutation.error.message : undefined}
        >
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="secondary" onClick={close} disabled={mutation.isPending}>
            Keep payment
          </Button>
          <Button
            variant="danger"
            disabled={reason.trim().length < 3}
            loading={mutation.isPending}
            onClick={() =>
              mutation.mutate(
                { id: p.id, reason: reason.trim() },
                {
                  onSuccess: () => {
                    toast.success(`${p.number} reversed`);
                    close();
                  },
                },
              )
            }
          >
            Reverse payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PaymentPage() {
  const { id } = useParams<{ id: string }>();
  const query = usePayment(id);
  const instant = useInstant();
  const fmt = useCenterFormat();
  const [dialog, setDialog] = React.useState<'allocate' | 'refund' | 'reverse' | null>(null);
  const [release, setRelease] = React.useState<{
    paymentId: string;
    allocationId: string;
    label: string;
    amount: string;
  } | null>(null);
  useBreadcrumbLabel(id, query.data?.number);
  React.useLayoutEffect(
    () => () => {
      setDialog(null);
      setRelease(null);
    },
    [],
  );
  if (query.isPending) return <PageSkeleton />;
  const p = query.data;
  if (query.error || !p) {
    return (
      <Card>
        {isApiError(query.error, 404) || isApiError(query.error, 400) ? (
          <EmptyState
            icon={Receipt}
            title="Payment not found"
            action={
              <Button variant="secondary" size="sm" asChild>
                <Link href={financeLinks.payments}>Back to payments</Link>
              </Button>
            }
          />
        ) : (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        )}
      </Card>
    );
  }
  const a = p.actions;
  return (
    <div className="animate-in">
      <PageHeader
        back={{ href: financeLinks.payments, label: 'Payments' }}
        title={`Payment ${p.number}`}
        description={
          <>
            <Link href={financeLinks.patientBilling(p.patient.id)} className="hover:underline">
              {p.patient.fullName}
            </Link>{' '}
            <span className="text-muted-foreground">
              ({p.patient.code}) · {instant(p.collectedAt)} · {p.method.name}
            </span>
          </>
        }
        meta={<PaymentStatusBadge status={p.status} />}
        actions={
          <>
            <Button asChild>
              <Link href={financeLinks.receipt(p.id)}>
                <ReceiptText /> Receipt
              </Link>
            </Button>
            {a.allocate && (
              <Button variant="secondary" onClick={() => setDialog('allocate')}>
                <Wallet /> Apply to invoices
              </Button>
            )}
            {a.refund && (
              <Button variant="secondary" onClick={() => setDialog('refund')}>
                Refund
              </Button>
            )}
            {a.reverse && (
              <Button variant="danger-ghost" onClick={() => setDialog('reverse')}>
                <Undo2 /> Reverse
              </Button>
            )}
          </>
        }
      />
      {p.status === 'REVERSED' && (
        <p className="mb-4 rounded-lg border border-border bg-muted px-4 py-3 text-sm">
          Reversed {p.reversedAt && instant(p.reversedAt)}
          {p.reversedBy && ` by ${p.reversedBy.fullName}`}: {p.reversalReason}. It doesn’t count in
          collections or balances.
        </p>
      )}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Received"
          value={formatMoney(p.amount, p.currency)}
          icon={Receipt}
          tone="primary"
        />
        <KpiCard
          label="Applied to invoices"
          value={formatMoney(p.allocatedAmount, p.currency)}
          icon={ReceiptText}
        />
        <KpiCard label="Refunded" value={formatMoney(p.refundedAmount, p.currency)} icon={Undo2} />
        <KpiCard
          label="Credit left"
          value={formatMoney(p.unappliedAmount, p.currency)}
          icon={Wallet}
          tone={isPositive(p.unappliedAmount) ? 'warning' : 'neutral'}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Applied to</CardTitle>
            <CardDescription>
              Amounts taken off stay listed, struck through, with the reason.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {p.allocations.length ? (
              <ul className="divide-y divide-border">
                {p.allocations.map((al) => (
                  <li
                    key={al.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                  >
                    <span className="grid">
                      <Link
                        href={financeLinks.invoice(al.invoice.id)}
                        className={cn(
                          'text-sm font-medium hover:underline',
                          !al.active && 'line-through',
                        )}
                      >
                        {al.invoice.number}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {fmt.date(al.invoice.invoiceDate)} · {instant(al.createdAt)} by{' '}
                        {al.createdBy.fullName}
                        {!al.active &&
                          al.releaseReason &&
                          ` · ${RELEASE_REASONS[al.releaseReason]}${al.releaseNote ? `: ${al.releaseNote}` : ''}`}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <Amount
                        value={al.amount}
                        currency={p.currency}
                        className={!al.active ? 'line-through' : undefined}
                      />
                      {al.active && a.reallocate && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setRelease({
                              paymentId: p.id,
                              allocationId: al.id,
                              label: al.invoice.number ?? 'the invoice',
                              amount: al.amount,
                            })
                          }
                        >
                          Take off
                        </Button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                Not applied to any invoice: it’s the patient’s credit.
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 text-sm">
              <div>
                <dt className="text-[13px] text-muted-foreground">Transaction reference</dt>
                <dd>{p.transactionReference ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-[13px] text-muted-foreground">Collected by</dt>
                <dd>{p.collectedBy.fullName}</dd>
              </div>
              {p.notes && (
                <div>
                  <dt className="text-[13px] text-muted-foreground">Notes</dt>
                  <dd className="whitespace-pre-line">{p.notes}</dd>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Recorded by hand: the reference is what staff entered, not a confirmation from the
                provider.
              </p>
            </dl>
          </CardContent>
        </Card>
      </div>
      {p.refunds.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Refunds</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {p.refunds.map((r) => (
                <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2.5 text-sm">
                  <span className="grid">
                    <span>{r.reason}</span>
                    <span className="text-xs text-muted-foreground">
                      {instant(r.refundedAt)} · {r.method.name}
                      {r.reference && ` · ${r.reference}`} · approved by {r.approvedBy.fullName}
                    </span>
                  </span>
                  <Amount value={r.amount} currency={p.currency} strong />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      {dialog === 'allocate' && <AllocateDialog payment={p} open onClose={() => setDialog(null)} />}
      {dialog === 'refund' && <RefundDialog payment={p} open onClose={() => setDialog(null)} />}
      <ReverseDialog payment={p} open={dialog === 'reverse'} onClose={() => setDialog(null)} />
      <ReleaseDialog target={release} onClose={() => setRelease(null)} />
    </div>
  );
}

export function PaymentDetailsScreen() {
  return (
    <RequirePermission permission="payments.read">
      <PaymentPage />
    </RequirePermission>
  );
}
