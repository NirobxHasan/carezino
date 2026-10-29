'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Banknote, Ellipsis, Eye, FileText, Plus, Printer } from 'lucide-react';

import { RequirePermission } from '@/components/auth/require-permission';
import { DataTable, type ColumnDef } from '@/components/data-table/data-table';
import { FilterBar, SearchInput } from '@/components/data-table/filter-bar';
import { EmptyState } from '@/components/feedback/states';
import { DateRangePicker } from '@/components/forms/date-picker';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useInvoiceList } from '@/lib/api/billing';
import { useDebounced } from '@/lib/hooks/use-debounced';
import { useSession } from '@/lib/session';
import type { InvoiceStatus, InvoiceSummary } from '@/lib/types';
import { useCenterFormat } from '../appointments/appointment-display';
import { useCollectPaymentDialog } from './collect-payment';
import { Amount, FinanceNav, InvoiceStatusBadge, financeLinks } from './finance-display';

const PAGE_SIZES = [10, 20, 50];
const DEFAULT_PAGE_SIZE = 20;
const STATUS_FILTERS = [
  'all',
  'DRAFT',
  'ISSUED',
  'PARTIALLY_PAID',
  'PAID',
  'VOID',
  'overdue',
] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];
const STATUS_LABELS: Record<StatusFilter, string> = {
  all: 'Any status',
  DRAFT: 'Draft',
  ISSUED: 'Unpaid',
  PARTIALLY_PAID: 'Partly paid',
  PAID: 'Paid',
  VOID: 'Void',
  overdue: 'Overdue',
};

type Fmt = ReturnType<typeof useCenterFormat>;
type Collect = ReturnType<typeof useCollectPaymentDialog>[0];

function InvoiceActions({
  invoice: i,
  onCollect,
}: {
  invoice: InvoiceSummary;
  onCollect: Collect;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${i.number ?? 'draft'}`}>
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={financeLinks.invoice(i.id)}>
            <Eye /> View
          </Link>
        </DropdownMenuItem>
        {i.actions.collect && (
          <DropdownMenuItem onSelect={() => onCollect({ patient: i.patient, invoiceId: i.id })}>
            <Banknote /> Collect payment
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link href={financeLinks.printInvoice(i.id)}>
            <Printer /> Print
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function invoiceColumns({
  fmt,
  showPatient = true,
  onCollect,
}: {
  fmt: Fmt;
  showPatient?: boolean;
  onCollect: Collect;
}): ColumnDef<InvoiceSummary, unknown>[] {
  return [
    {
      id: 'number',
      header: 'Invoice',
      cell: ({ row }) => {
        const i = row.original;
        return (
          <span className="flex flex-col">
            <span className="font-medium tabular">{i.number ?? 'Draft'}</span>
            <span className="text-xs text-muted-foreground">
              {i.itemCount} line{i.itemCount === 1 ? '' : 's'}
              {i.automatic && ' · automatic'}
            </span>
          </span>
        );
      },
    },
    ...(showPatient
      ? ([
          {
            id: 'patient',
            header: 'Patient',
            cell: ({ row }) => {
              const p = row.original.patient;
              return (
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{p.fullName}</span>
                  <span className="text-xs text-muted-foreground tabular">
                    {p.code}
                    {p.isDeleted && ' · removed'}
                  </span>
                </span>
              );
            },
          },
        ] as ColumnDef<InvoiceSummary, unknown>[])
      : []),
    {
      id: 'date',
      header: 'Date',
      meta: { className: 'hidden md:table-cell whitespace-nowrap text-[13px]' },
      cell: ({ row }) => fmt.date(row.original.invoiceDate),
    },
    {
      id: 'due',
      header: 'Due',
      meta: { className: 'hidden lg:table-cell whitespace-nowrap text-[13px]' },
      cell: ({ row }) => {
        const i = row.original;
        if (!i.dueDate) return <span className="text-subtle-foreground">—</span>;
        return (
          <span className={i.overdue ? 'text-danger-foreground' : undefined}>
            {fmt.date(i.dueDate)}
            {i.daysOverdue ? ` · ${i.daysOverdue}d late` : ''}
          </span>
        );
      },
    },
    {
      id: 'total',
      header: () => <span className="block text-right">Total</span>,
      meta: { className: 'text-right' },
      cell: ({ row }) => (
        <Amount value={row.original.totalAmount} currency={row.original.currency} />
      ),
    },
    {
      id: 'paid',
      header: () => <span className="block text-right">Paid</span>,
      meta: { className: 'hidden sm:table-cell text-right' },
      cell: ({ row }) => (
        <Amount value={row.original.paidAmount} currency={row.original.currency} />
      ),
    },
    {
      id: 'due-amount',
      header: () => <span className="block text-right">Due</span>,
      meta: { className: 'text-right' },
      cell: ({ row }) => (
        <Amount value={row.original.outstanding} currency={row.original.currency} strong />
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <InvoiceStatusBadge status={row.original.status} overdue={row.original.overdue} />
      ),
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      meta: { className: 'w-12 text-right' },
      cell: ({ row }) => <InvoiceActions invoice={row.original} onCollect={onCollect} />,
    },
  ];
}

function useListState() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const page = Number(params.get('page'));
  const size = Number(params.get('size'));
  const status = params.get('status') as StatusFilter | null;
  const state = {
    q: params.get('q') ?? '',
    status: (status && STATUS_FILTERS.includes(status) ? status : 'all') as StatusFilter,
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    page: Number.isInteger(page) && page > 1 ? page : 1,
    pageSize: PAGE_SIZES.includes(size) ? size : DEFAULT_PAGE_SIZE,
  };
  const set = (patch: Partial<typeof state>) => {
    const next = { ...state, ...('page' in patch ? {} : { page: 1 }), ...patch };
    const q = new URLSearchParams();
    if (next.q.trim()) q.set('q', next.q.trim());
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

function InvoiceTable() {
  const { can } = useSession();
  const fmt = useCenterFormat();
  const [state, set] = useListState();
  const [search, setSearch] = React.useState(state.q);
  const debounced = useDebounced(search, 300);
  React.useEffect(() => {
    if (debounced.trim() !== state.q.trim()) set({ q: debounced });
    // Only when the typed value settles, not when the URL changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  const [collect, dialog] = useCollectPaymentDialog();
  const { data, isFetching, error, refetch } = useInvoiceList({
    search: state.q,
    status:
      state.status === 'all' || state.status === 'overdue'
        ? undefined
        : [state.status as InvoiceStatus],
    overdue: state.status === 'overdue' || undefined,
    from: state.from || undefined,
    to: state.to || undefined,
    page: state.page,
    pageSize: state.pageSize,
  });
  const columns = React.useMemo(() => invoiceColumns({ fmt, onCollect: collect }), [fmt, collect]);
  const filtered = Boolean(state.q || state.from) || state.status !== 'all';
  const clear = () => {
    setSearch('');
    set({ q: '', status: 'all', from: '', to: '' });
  };
  const create = can('invoices.create') && (
    <Button asChild>
      <Link href={financeLinks.newInvoice()}>
        <Plus /> New invoice
      </Link>
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Finance"
        description="Invoices, payments, dues and expenses."
        actions={create}
      />
      <FinanceNav />
      <DataTable
        label="Invoices"
        columns={columns}
        data={data?.items}
        loading={isFetching}
        error={error}
        onRetry={() => void refetch()}
        getRowId={(i) => i.id}
        rowHref={(i) => financeLinks.invoice(i.id)}
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
              label="Search invoices"
              placeholder="Invoice number, patient name or ID…"
            />
            <Select value={state.status} onValueChange={(v) => set({ status: v as StatusFilter })}>
              <SelectTrigger size="sm" className="w-full sm:w-40" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTERS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABELS[s]}
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
            <EmptyState
              title="No invoices match these filters"
              action={
                <Button variant="secondary" size="sm" onClick={clear}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={FileText}
              title="No invoices yet"
              description="Invoice a patient’s package, assessment or sessions from their billing tab, or start one here."
              action={create}
            />
          )
        }
      />
      {dialog}
    </>
  );
}

export function InvoicesScreen() {
  return (
    <RequirePermission permission="invoices.read">
      <div className="animate-in">
        <InvoiceTable />
      </div>
    </RequirePermission>
  );
}
