'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Banknote, CircleCheck, Eye, Printer } from 'lucide-react';

import { RequirePermission } from '@/components/auth/require-permission';
import { DataTable, type ColumnDef } from '@/components/data-table/data-table';
import { FilterBar, SearchInput } from '@/components/data-table/filter-bar';
import { EmptyState } from '@/components/feedback/states';
import { DateRangePicker } from '@/components/forms/date-picker';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useDues } from '@/lib/api/billing';
import { useTherapyTypeList } from '@/lib/api/therapy-types';
import { formatPhone } from '@/lib/format';
import { useDebounced } from '@/lib/hooks/use-debounced';
import type { AgingBucket, DueItem } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useCenterFormat } from '../appointments/appointment-display';
import { useCollectPaymentDialog } from './collect-payment';
import { AGING, Amount, FinanceNav, financeLinks, formatMoney, sumMoney } from './finance-display';

const PAGE_SIZES = [10, 20, 50];
const DEFAULT_PAGE_SIZE = 20;

function useListState() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const page = Number(params.get('page'));
  const size = Number(params.get('size'));
  const aging = params.get('aging') as AgingBucket | null;
  const state = {
    q: params.get('q') ?? '',
    aging: (aging && aging in AGING ? aging : 'all') as AgingBucket | 'all' | 'overdue',
    therapyTypeId: params.get('therapy') ?? 'all',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    page: Number.isInteger(page) && page > 1 ? page : 1,
    pageSize: PAGE_SIZES.includes(size) ? size : DEFAULT_PAGE_SIZE,
  };
  if (params.get('aging') === 'overdue') state.aging = 'overdue';
  const set = (patch: Partial<typeof state>) => {
    const next = { ...state, ...('page' in patch ? {} : { page: 1 }), ...patch };
    const q = new URLSearchParams();
    if (next.q.trim()) q.set('q', next.q.trim());
    if (next.aging !== 'all') q.set('aging', next.aging);
    if (next.therapyTypeId !== 'all') q.set('therapy', next.therapyTypeId);
    if (next.from) q.set('from', next.from);
    if (next.to) q.set('to', next.to);
    if (next.page > 1) q.set('page', String(next.page));
    if (next.pageSize !== DEFAULT_PAGE_SIZE) q.set('size', String(next.pageSize));
    const s = q.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };
  return [state, set] as const;
}

function DuesTable() {
  const fmt = useCenterFormat();
  const [state, set] = useListState();
  const [search, setSearch] = React.useState(state.q);
  const debounced = useDebounced(search, 300);
  React.useEffect(() => {
    if (debounced.trim() !== state.q.trim()) set({ q: debounced });
    // Only when the typed value settles, not when the URL changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  const types = useTherapyTypeList({ status: 'all' });
  const [collect, dialog] = useCollectPaymentDialog();
  const { data, isFetching, error, refetch } = useDues({
    search: state.q,
    aging: state.aging === 'all' || state.aging === 'overdue' ? undefined : state.aging,
    overdue: state.aging === 'overdue' || undefined,
    therapyTypeId: state.therapyTypeId === 'all' ? undefined : state.therapyTypeId,
    from: state.from || undefined,
    to: state.to || undefined,
    page: state.page,
    pageSize: state.pageSize,
  });
  const filtered =
    Boolean(state.q || state.from) || state.aging !== 'all' || state.therapyTypeId !== 'all';
  const clear = () => {
    setSearch('');
    set({ q: '', aging: 'all', therapyTypeId: 'all', from: '', to: '' });
  };

  const columns: ColumnDef<DueItem, unknown>[] = [
    {
      id: 'invoice',
      header: 'Invoice',
      cell: ({ row }) => (
        <span className="flex flex-col">
          <span className="font-medium tabular">{row.original.number}</span>
          <span className="text-xs text-muted-foreground">
            {fmt.date(row.original.invoiceDate)}
          </span>
        </span>
      ),
    },
    {
      id: 'patient',
      header: 'Patient',
      cell: ({ row }) => {
        const d = row.original;
        return (
          <span className="flex min-w-0 flex-col">
            <span className="truncate">{d.patient.fullName}</span>
            <span className="text-xs text-muted-foreground tabular">{d.patient.code}</span>
          </span>
        );
      },
    },
    {
      id: 'contact',
      header: 'Guardian contact',
      meta: { className: 'hidden md:table-cell text-[13px]' },
      cell: ({ row }) => {
        const c = row.original.contact;
        if (!c.mobile) return <span className="text-subtle-foreground">—</span>;
        return (
          <span className="flex flex-col">
            <a href={`tel:${c.mobile}`} className="tabular hover:underline">
              {formatPhone(c.mobile)}
            </a>
            {c.name && <span className="text-xs text-muted-foreground">{c.name}</span>}
          </span>
        );
      },
    },
    {
      id: 'due',
      header: 'Due date',
      meta: { className: 'hidden lg:table-cell whitespace-nowrap text-[13px]' },
      cell: ({ row }) => (row.original.dueDate ? fmt.date(row.original.dueDate) : '—'),
    },
    {
      id: 'total',
      header: () => <span className="block text-right">Total</span>,
      meta: { className: 'hidden sm:table-cell text-right' },
      cell: ({ row }) => (
        <Amount value={row.original.totalAmount} currency={row.original.currency} />
      ),
    },
    {
      id: 'paid',
      header: () => <span className="block text-right">Paid</span>,
      meta: { className: 'hidden xl:table-cell text-right' },
      cell: ({ row }) => (
        <Amount value={row.original.paidAmount} currency={row.original.currency} />
      ),
    },
    {
      id: 'outstanding',
      header: () => <span className="block text-right">Outstanding</span>,
      meta: { className: 'text-right' },
      cell: ({ row }) => (
        <Amount value={row.original.outstanding} currency={row.original.currency} strong />
      ),
    },
    {
      id: 'aging',
      header: 'Aging',
      cell: ({ row }) => {
        const a = row.original.aging ?? 'NOT_DUE';
        return <Badge tone={AGING[a].tone}>{AGING[a].label}</Badge>;
      },
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      meta: { className: 'text-right whitespace-nowrap' },
      cell: ({ row }) => {
        const d = row.original;
        return (
          <span className="inline-flex gap-1">
            {d.actions.collect && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => collect({ patient: d.patient, invoiceId: d.id })}
              >
                <Banknote /> Collect
              </Button>
            )}
            <Button size="icon-sm" variant="ghost" asChild aria-label={`View ${d.number}`}>
              <Link href={financeLinks.invoice(d.id)}>
                <Eye />
              </Link>
            </Button>
            <Button size="icon-sm" variant="ghost" asChild aria-label={`Print ${d.number}`}>
              <Link href={financeLinks.printInvoice(d.id)}>
                <Printer />
              </Link>
            </Button>
          </span>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader title="Finance" description="Invoices, payments, dues and expenses." />
      <FinanceNav />
      {data && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <button
            type="button"
            onClick={() => set({ aging: 'all' })}
            className={cn(
              'rounded-xl border bg-surface p-3 text-left shadow-xs focus-ring',
              state.aging === 'all' ? 'border-primary' : 'border-border hover:border-border-strong',
            )}
          >
            <span className="block text-xs text-muted-foreground">All dues</span>
            <span className="block text-base font-semibold tabular">
              {formatMoney(sumMoney(data.aging.map((b) => b.outstanding)), data.currency)}
            </span>
          </button>
          {data.aging.map((b) => (
            <button
              key={b.bucket}
              type="button"
              onClick={() => set({ aging: b.bucket })}
              className={cn(
                'rounded-xl border bg-surface p-3 text-left shadow-xs focus-ring',
                state.aging === b.bucket
                  ? 'border-primary'
                  : 'border-border hover:border-border-strong',
              )}
            >
              <span className="block text-xs text-muted-foreground">
                {b.bucket === 'NOT_DUE' ? 'Not due yet' : `${AGING[b.bucket].label} overdue`}
              </span>
              <span className="block text-base font-semibold tabular">
                {formatMoney(b.outstanding, data.currency)}
              </span>
              <span className="block text-xs text-muted-foreground">
                {b.invoices} invoice{b.invoices === 1 ? '' : 's'}
              </span>
            </button>
          ))}
        </div>
      )}
      <DataTable
        label="Outstanding dues"
        columns={columns}
        data={data?.items}
        loading={isFetching}
        error={error}
        onRetry={() => void refetch()}
        getRowId={(d) => d.id}
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
          <FilterBar>
            <SearchInput
              value={search}
              onChange={setSearch}
              label="Search dues"
              placeholder="Patient, invoice or guardian mobile…"
            />
            <Select
              value={state.aging}
              onValueChange={(v) => set({ aging: v as typeof state.aging })}
            >
              <SelectTrigger size="sm" className="w-full sm:w-44" aria-label="Filter by aging">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any aging</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
                {(Object.keys(AGING) as AgingBucket[]).map((b) => (
                  <SelectItem key={b} value={b}>
                    {b === 'NOT_DUE' ? 'Not due yet' : `${AGING[b].label} overdue`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={state.therapyTypeId}
              onValueChange={(therapyTypeId) => set({ therapyTypeId })}
            >
              <SelectTrigger size="sm" className="w-full sm:w-44" aria-label="Filter by therapy">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All therapies</SelectItem>
                {types.data?.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <DateRangePicker
              value={state.from && state.to ? { from: state.from, to: state.to } : null}
              onChange={(r) => set({ from: r.from, to: r.to })}
              placeholder="Any invoice date"
            />
            {filtered && (
              <Button variant="ghost" size="sm" onClick={clear}>
                Clear filters
              </Button>
            )}
          </FilterBar>
        }
        empty={
          filtered ? (
            <EmptyState title="No dues match these filters" />
          ) : (
            <EmptyState
              icon={CircleCheck}
              title="Nothing outstanding"
              description="Every issued invoice is paid."
            />
          )
        }
      />
      {dialog}
    </>
  );
}

export function DuesScreen() {
  return (
    <RequirePermission permission="invoices.read">
      <div className="animate-in">
        <DuesTable />
      </div>
    </RequirePermission>
  );
}
