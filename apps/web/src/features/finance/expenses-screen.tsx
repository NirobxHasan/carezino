'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Ban, Ellipsis, History, Pencil, Plus, ReceiptText } from 'lucide-react';

import { RequirePermission } from '@/components/auth/require-permission';
import { DataTable, type ColumnDef } from '@/components/data-table/data-table';
import { FilterBar, SearchInput } from '@/components/data-table/filter-bar';
import { EmptyState } from '@/components/feedback/states';
import { DatePicker, DateRangePicker } from '@/components/forms/date-picker';
import { Field } from '@/components/forms/field';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  useCorrectExpense,
  useCreateExpense,
  useExpense,
  useExpenseCategories,
  useExpenseList,
  usePaymentMethods,
  useVoidExpense,
} from '@/lib/api/billing';
import { isApiError } from '@/lib/api/client';
import { useDebounced } from '@/lib/hooks/use-debounced';
import { useSession } from '@/lib/session';
import type { ExpenseItem } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useCenterFormat } from '../appointments/appointment-display';
import { useInstant } from '../packages/package-display';
import { Amount, FinanceNav, formatMoney, isPositive, useCenterToday } from './finance-display';

const PAGE_SIZES = [10, 20, 50];
const DEFAULT_PAGE_SIZE = 20;

const FIELD_LABELS: Record<string, string> = {
  categoryId: 'Category',
  expenseDate: 'Date',
  description: 'Description',
  amount: 'Amount',
  methodId: 'Payment method',
  reference: 'Reference',
  notes: 'Notes',
};

/** Records a new expense, or corrects one with a reason (the earlier values are kept). */
function ExpenseDialog({
  expense,
  open,
  onClose,
}: {
  expense?: ExpenseItem;
  open: boolean;
  onClose: () => void;
}) {
  const today = useCenterToday();
  const categories = useExpenseCategories('ACTIVE', open);
  const methods = usePaymentMethods('ACTIVE', open);
  const create = useCreateExpense();
  const correct = useCorrectExpense();
  const mutation = expense ? correct : create;
  const [categoryId, setCategoryId] = React.useState(expense?.category.id ?? '');
  const [expenseDate, setExpenseDate] = React.useState(expense?.expenseDate ?? today);
  const [amount, setAmount] = React.useState(expense?.amount ?? '');
  const [methodId, setMethodId] = React.useState(expense?.method.id ?? '');
  const [description, setDescription] = React.useState(expense?.description ?? '');
  const [reference, setReference] = React.useState(expense?.reference ?? '');
  const [notes, setNotes] = React.useState(expense?.notes ?? '');
  const [reason, setReason] = React.useState('');
  const [requestId] = React.useState(() => crypto.randomUUID());
  const errors = isApiError(mutation.error) ? (mutation.error.errors ?? {}) : {};
  if (open && !methodId && methods.data?.items.length) setMethodId(methods.data.items[0].id);
  const valid =
    Boolean(categoryId && methodId && description.trim()) &&
    isPositive(amount) &&
    (!expense || reason.trim().length >= 3);
  const submit = () => {
    const body = {
      categoryId,
      expenseDate,
      amount,
      methodId,
      description: description.trim(),
      reference: reference.trim() || null,
      notes: notes.trim() || null,
    };
    const done = {
      onSuccess: () => {
        toast.success(expense ? 'Expense corrected' : 'Expense recorded');
        onClose();
      },
      onError: (err: Error) => {
        if (!(isApiError(err) && err.errors)) toast.error(err.message);
      },
    };
    if (expense) {
      correct.mutate(
        { id: expense.id, input: { ...body, reason: reason.trim(), revision: expense.revision } },
        done,
      );
    } else {
      create.mutate({ ...body, requestId }, done);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{expense ? 'Correct expense' : 'Record expense'}</DialogTitle>
          <DialogDescription>
            {expense
              ? 'The values before your correction are kept with your reason.'
              : 'Money the center paid out. Payroll isn’t calculated here: record a therapist payment as an expense.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category" required error={errors.categoryId}>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose" />
              </SelectTrigger>
              <SelectContent>
                {categories.data?.items.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
                {expense && !expense.category.isActive && (
                  <SelectItem value={expense.category.id}>{expense.category.name}</SelectItem>
                )}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Amount" required error={errors.amount}>
            <Input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="tabular"
              placeholder="0.00"
            />
          </Field>
          <Field label="Date" required error={errors.expenseDate}>
            <DatePicker
              value={expenseDate}
              onChange={(v) => v && setExpenseDate(v)}
              disabledDays={{ after: new Date(`${today}T23:59:59`) }}
            />
          </Field>
          <Field label="Paid by" required error={errors.methodId}>
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
                {expense && !expense.method.isActive && (
                  <SelectItem value={expense.method.id}>{expense.method.name}</SelectItem>
                )}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Description" required error={errors.description} className="sm:col-span-2">
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. November rent"
            />
          </Field>
          <Field label="Reference" optional error={errors.reference}>
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Bill or voucher no."
            />
          </Field>
          <Field label="Notes" optional error={errors.notes}>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          {expense && (
            <Field
              label="Reason for the correction"
              required
              error={errors.reason}
              className="sm:col-span-2"
            >
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          )}
          {isApiError(mutation.error) && !mutation.error.errors && (
            <p className="text-sm text-danger-foreground sm:col-span-2">{mutation.error.message}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid} loading={mutation.isPending}>
            {expense ? 'Save correction' : 'Record expense'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VoidExpenseDialog({ expense, onClose }: { expense: ExpenseItem; onClose: () => void }) {
  const mutation = useVoidExpense();
  const [reason, setReason] = React.useState('');
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Void this expense?</DialogTitle>
          <DialogDescription>
            {expense.description}, {formatMoney(expense.amount)}. It stays on record, marked void,
            and no longer counts in totals.
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
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Keep expense
          </Button>
          <Button
            variant="danger"
            disabled={reason.trim().length < 3}
            loading={mutation.isPending}
            onClick={() =>
              mutation.mutate(
                { id: expense.id, reason: reason.trim() },
                {
                  onSuccess: () => {
                    toast.success('Expense voided');
                    onClose();
                  },
                },
              )
            }
          >
            Void expense
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({ expense, onClose }: { expense: ExpenseItem; onClose: () => void }) {
  const query = useExpense(expense.id);
  const instant = useInstant();
  const fmt = useCenterFormat();
  const show = (field: string, value: string | null) => {
    if (value === null || value === '') return '—';
    if (field === 'amount') return formatMoney(value);
    if (field === 'expenseDate') return fmt.date(value);
    if (field === 'categoryId' || field === 'methodId') return 'changed';
    return value;
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Expense history</DialogTitle>
          <DialogDescription>
            Recorded {instant(expense.createdAt)} by {expense.createdBy.fullName}.
          </DialogDescription>
        </DialogHeader>
        {query.data?.revisions.length ? (
          <ol className="grid gap-3">
            {query.data.revisions.map((r) => (
              <li key={r.id} className="rounded-lg border border-border p-3 text-sm">
                <p className="font-medium">{r.reason}</p>
                <p className="text-xs text-muted-foreground">
                  {instant(r.createdAt)} · {r.createdBy.fullName}
                </p>
                <ul className="mt-2 grid gap-0.5 text-[13px]">
                  {r.changed.map((f) => (
                    <li key={f}>
                      {FIELD_LABELS[f] ?? f}: {show(f, r.before[f])} → {show(f, r.after[f])}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">
            {query.isPending ? 'Loading…' : 'Never corrected.'}
          </p>
        )}
        {expense.status === 'VOID' && (
          <p className="text-sm">
            Voided {expense.voidedAt && instant(expense.voidedAt)}
            {expense.voidedBy && ` by ${expense.voidedBy.fullName}`}: {expense.voidReason}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function useListState() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const page = Number(params.get('page'));
  const size = Number(params.get('size'));
  const state = {
    q: params.get('q') ?? '',
    categoryId: params.get('category') ?? 'all',
    methodId: params.get('method') ?? 'all',
    status: (params.get('status') ?? 'RECORDED') as 'RECORDED' | 'VOID' | 'all',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    page: Number.isInteger(page) && page > 1 ? page : 1,
    pageSize: PAGE_SIZES.includes(size) ? size : DEFAULT_PAGE_SIZE,
  };
  const set = (patch: Partial<typeof state>) => {
    const next = { ...state, ...('page' in patch ? {} : { page: 1 }), ...patch };
    const q = new URLSearchParams();
    if (next.q.trim()) q.set('q', next.q.trim());
    if (next.categoryId !== 'all') q.set('category', next.categoryId);
    if (next.methodId !== 'all') q.set('method', next.methodId);
    if (next.status !== 'RECORDED') q.set('status', next.status);
    if (next.from) q.set('from', next.from);
    if (next.to) q.set('to', next.to);
    if (next.page > 1) q.set('page', String(next.page));
    if (next.pageSize !== DEFAULT_PAGE_SIZE) q.set('size', String(next.pageSize));
    const s = q.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };
  return [state, set] as const;
}

type Pending =
  { kind: 'create' } | { kind: 'correct' | 'void' | 'history'; expense: ExpenseItem } | null;

function ExpenseTable() {
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
  const categories = useExpenseCategories();
  const methods = usePaymentMethods();
  const [pending, setPending] = React.useState<Pending>(null);
  // Dialogs are transient: close them when the page is hidden by a navigation.
  React.useLayoutEffect(() => () => setPending(null), []);
  const { data, isFetching, error, refetch } = useExpenseList({
    search: state.q,
    categoryId: state.categoryId === 'all' ? undefined : state.categoryId,
    methodId: state.methodId === 'all' ? undefined : state.methodId,
    status: state.status === 'all' ? undefined : state.status,
    from: state.from || undefined,
    to: state.to || undefined,
    page: state.page,
    pageSize: state.pageSize,
  });
  const filtered =
    Boolean(state.q || state.from) ||
    state.categoryId !== 'all' ||
    state.methodId !== 'all' ||
    state.status !== 'RECORDED';
  const clear = () => {
    setSearch('');
    set({ q: '', categoryId: 'all', methodId: 'all', status: 'RECORDED', from: '', to: '' });
  };
  const create = can('expenses.create') && (
    <Button onClick={() => setPending({ kind: 'create' })}>
      <Plus /> Record expense
    </Button>
  );

  const columns: ColumnDef<ExpenseItem, unknown>[] = [
    {
      id: 'date',
      header: 'Date',
      meta: { className: 'whitespace-nowrap text-[13px]' },
      cell: ({ row }) => fmt.date(row.original.expenseDate),
    },
    {
      id: 'description',
      header: 'Description',
      cell: ({ row }) => {
        const e = row.original;
        return (
          <span className="flex min-w-0 flex-col">
            <span className={cn('truncate', e.status === 'VOID' && 'line-through')}>
              {e.description}
            </span>
            <span className="text-xs text-muted-foreground">
              {e.category.name}
              {e.reference && ` · ${e.reference}`}
              {e.corrections > 0 && ` · corrected ${e.corrections}×`}
            </span>
          </span>
        );
      },
    },
    {
      id: 'method',
      header: 'Paid by',
      meta: { className: 'hidden md:table-cell text-[13px]' },
      cell: ({ row }) => row.original.method.name,
    },
    {
      id: 'by',
      header: 'Recorded by',
      meta: { className: 'hidden lg:table-cell text-[13px]' },
      cell: ({ row }) => row.original.createdBy.fullName,
    },
    {
      id: 'amount',
      header: () => <span className="block text-right">Amount</span>,
      meta: { className: 'text-right' },
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-2">
          {row.original.status === 'VOID' && <Badge>Void</Badge>}
          <Amount
            value={row.original.amount}
            strong
            className={row.original.status === 'VOID' ? 'line-through' : undefined}
          />
        </span>
      ),
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      meta: { className: 'w-12 text-right' },
      cell: ({ row }) => {
        const e = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${e.description}`}>
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {e.actions.correct && (
                <DropdownMenuItem onSelect={() => setPending({ kind: 'correct', expense: e })}>
                  <Pencil /> Correct
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => setPending({ kind: 'history', expense: e })}>
                <History /> History
              </DropdownMenuItem>
              {e.actions.void && (
                <DropdownMenuItem
                  tone="danger"
                  onSelect={() => setPending({ kind: 'void', expense: e })}
                >
                  <Ban /> Void
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Finance"
        description="Invoices, payments, dues and expenses."
        actions={create}
      />
      <FinanceNav />
      <DataTable
        label="Expenses"
        columns={columns}
        data={data?.items}
        loading={isFetching}
        error={error}
        onRetry={() => void refetch()}
        getRowId={(e) => e.id}
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
                label="Search expenses"
                placeholder="Description or reference…"
              />
              <Select value={state.categoryId} onValueChange={(categoryId) => set({ categoryId })}>
                <SelectTrigger size="sm" className="w-full sm:w-44" aria-label="Filter by category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {categories.data?.items.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                <SelectTrigger size="sm" className="w-full sm:w-36" aria-label="Filter by status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="RECORDED">Recorded</SelectItem>
                  <SelectItem value="VOID">Void</SelectItem>
                  <SelectItem value="all">Any status</SelectItem>
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
                Total of recorded expenses matching:{' '}
                <span className="font-medium text-foreground tabular">
                  {formatMoney(data.totalAmount)}
                </span>
              </p>
            )}
          </div>
        }
        empty={
          filtered ? (
            <EmptyState title="No expenses match these filters" />
          ) : (
            <EmptyState
              icon={ReceiptText}
              title="No expenses yet"
              description="Record rent, supplies, utilities and other money paid out."
              action={create}
            />
          )
        }
      />
      {pending?.kind === 'create' && <ExpenseDialog open onClose={() => setPending(null)} />}
      {pending?.kind === 'correct' && (
        <ExpenseDialog
          key={pending.expense.id}
          expense={pending.expense}
          open
          onClose={() => setPending(null)}
        />
      )}
      {pending?.kind === 'void' && (
        <VoidExpenseDialog expense={pending.expense} onClose={() => setPending(null)} />
      )}
      {pending?.kind === 'history' && (
        <HistoryDialog expense={pending.expense} onClose={() => setPending(null)} />
      )}
    </>
  );
}

export function ExpensesScreen() {
  return (
    <RequirePermission permission="expenses.read">
      <div className="animate-in">
        <ExpenseTable />
      </div>
    </RequirePermission>
  );
}
