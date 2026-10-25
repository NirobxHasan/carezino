'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Copy,
  Ellipsis,
  Package,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Trash2,
  UserPlus,
} from 'lucide-react';

import { RequirePermission } from '@/components/auth/require-permission';
import { DataTable, type ColumnDef } from '@/components/data-table/data-table';
import { FilterBar, SearchInput } from '@/components/data-table/filter-bar';
import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { EmptyState } from '@/components/feedback/states';
import { ColorDot } from '@/components/forms/color-picker';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui/sonner';
import {
  useDeletePackage,
  useDuplicatePackage,
  usePackageList,
  useSetPackageStatus,
} from '@/lib/api/packages';
import { useTherapyTypeList } from '@/lib/api/therapy-types';
import { useDebounced } from '@/lib/hooks/use-debounced';
import { useSession } from '@/lib/session';
import type { TherapyPackageItem } from '@/lib/types';
import { cn } from '@/lib/utils';
import { TherapyTypeChip } from '../appointments/appointment-display';
import {
  PackageActiveBadge,
  formatMoney,
  packageLinks,
  usageLimitText,
  validityText,
} from './package-display';

const PAGE_SIZES = [10, 20, 50];
const DEFAULT_PAGE_SIZE = 20;
type StatusFilter = 'ACTIVE' | 'INACTIVE' | 'all';

/** Catalog and enrollments, the two halves of the packages section. */
export function PackagesNav({ current }: { current: 'catalog' | 'enrollments' }) {
  const { can } = useSession();
  const tabs = [
    { key: 'catalog', label: 'Catalog', href: packageLinks.list, show: can('packages.read') },
    {
      key: 'enrollments',
      label: 'Patient enrollments',
      href: packageLinks.enrollments,
      show: can('package_enrollments.read'),
    },
  ].filter((t) => t.show);
  if (tabs.length < 2) return null;
  return (
    <nav aria-label="Packages" className="mb-4 flex gap-1 border-b border-border">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={current === t.key ? 'page' : undefined}
          className={cn(
            '-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-ring',
            current === t.key
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

function useListState() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const page = Number(params.get('page'));
  const size = Number(params.get('size'));
  const status = params.get('status');
  const state = {
    q: params.get('q') ?? '',
    therapyTypeId: params.get('therapy') ?? 'all',
    status: (status === 'ACTIVE' || status === 'INACTIVE' ? status : 'all') as StatusFilter,
    page: Number.isInteger(page) && page > 1 ? page : 1,
    pageSize: PAGE_SIZES.includes(size) ? size : DEFAULT_PAGE_SIZE,
  };
  const set = (patch: Partial<typeof state>) => {
    const next = { ...state, ...('page' in patch ? {} : { page: 1 }), ...patch };
    const q = new URLSearchParams();
    if (next.q.trim()) q.set('q', next.q.trim());
    if (next.therapyTypeId !== 'all') q.set('therapy', next.therapyTypeId);
    if (next.status !== 'all') q.set('status', next.status);
    if (next.page > 1) q.set('page', String(next.page));
    if (next.pageSize !== DEFAULT_PAGE_SIZE) q.set('size', String(next.pageSize));
    const s = q.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };
  return [state, set] as const;
}

type PendingAction = { kind: 'delete' | 'deactivate'; pkg: TherapyPackageItem } | null;

function PackageActions({
  pkg,
  onConfirm,
}: {
  pkg: TherapyPackageItem;
  onConfirm: (action: PendingAction) => void;
}) {
  const router = useRouter();
  const { actions } = pkg;
  const duplicate = useDuplicatePackage();
  const status = useSetPackageStatus();
  if (!Object.values(actions).some(Boolean)) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${pkg.name}`}>
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.edit && (
          <DropdownMenuItem asChild>
            <Link href={packageLinks.edit(pkg.id)}>
              <Pencil /> Edit
            </Link>
          </DropdownMenuItem>
        )}
        {actions.enroll && (
          <DropdownMenuItem asChild>
            <Link href={packageLinks.enroll({ packageId: pkg.id })}>
              <UserPlus /> Enroll a patient
            </Link>
          </DropdownMenuItem>
        )}
        {actions.duplicate && (
          <DropdownMenuItem
            onSelect={() =>
              duplicate.mutate(pkg.id, {
                onSuccess: (copy) => {
                  toast.success('Package duplicated', {
                    description: `${copy.code} is inactive until you review and activate it.`,
                  });
                  router.push(packageLinks.edit(copy.id));
                },
                onError: (e) => toast.error(e.message),
              })
            }
          >
            <Copy /> Duplicate
          </DropdownMenuItem>
        )}
        {(actions.activate || actions.deactivate || actions.delete) && <DropdownMenuSeparator />}
        {actions.activate && (
          <DropdownMenuItem
            onSelect={() =>
              status.mutate(
                { id: pkg.id, isActive: true },
                {
                  onSuccess: () => toast.success(`${pkg.name} is active`),
                  onError: (e) => toast.error(e.message),
                },
              )
            }
          >
            <Power /> Activate
          </DropdownMenuItem>
        )}
        {actions.deactivate && (
          <DropdownMenuItem onSelect={() => onConfirm({ kind: 'deactivate', pkg })}>
            <PowerOff /> Deactivate
          </DropdownMenuItem>
        )}
        {actions.delete && (
          <DropdownMenuItem tone="danger" onSelect={() => onConfirm({ kind: 'delete', pkg })}>
            <Trash2 /> Delete
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PackageTable() {
  const { can } = useSession();
  const [state, set] = useListState();
  const [search, setSearch] = React.useState(state.q);
  const debounced = useDebounced(search, 300);
  React.useEffect(() => {
    if (debounced.trim() !== state.q.trim()) set({ q: debounced });
    // Only when the typed value settles, not when the URL changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const { data, isFetching, error, refetch } = usePackageList({
    search: state.q,
    therapyTypeId: state.therapyTypeId === 'all' ? undefined : state.therapyTypeId,
    status: state.status,
    page: state.page,
    pageSize: state.pageSize,
  });
  const types = useTherapyTypeList({ status: 'all' });

  const [pending, setPending] = React.useState<PendingAction>(null);
  // Dialogs are transient: close them when the page is hidden by a navigation.
  React.useLayoutEffect(() => () => setPending(null), []);
  const remove = useDeletePackage();
  const status = useSetPackageStatus();

  const filtered = Boolean(state.q) || state.therapyTypeId !== 'all' || state.status !== 'all';
  const clear = () => {
    setSearch('');
    set({ q: '', therapyTypeId: 'all', status: 'all' });
  };
  const create = can('packages.create') && (
    <Button asChild>
      <Link href={packageLinks.create}>
        <Plus /> Add package
      </Link>
    </Button>
  );

  const columns: ColumnDef<TherapyPackageItem, unknown>[] = [
    {
      id: 'name',
      header: 'Package',
      cell: ({ row }) => {
        const p = row.original;
        return (
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{p.name}</span>
            <span className="truncate text-xs text-muted-foreground tabular">
              {p.code}
              {p.enrollmentCount > 0 &&
                ` · ${p.enrollmentCount} enrollment${p.enrollmentCount === 1 ? '' : 's'}`}
            </span>
          </span>
        );
      },
    },
    {
      id: 'therapies',
      header: 'Eligible therapies',
      cell: ({ row }) => (
        <span className="flex flex-wrap gap-x-3 gap-y-1">
          {row.original.therapyTypes.map((t) => (
            <TherapyTypeChip key={t.id} therapyType={t} />
          ))}
        </span>
      ),
    },
    {
      id: 'sessions',
      header: 'Sessions',
      meta: { className: 'tabular whitespace-nowrap' },
      cell: ({ row }) => {
        const limit = usageLimitText(row.original.usageLimit);
        return (
          <span className="flex flex-col">
            <span>{row.original.sessionCount}</span>
            {limit && <span className="text-xs text-muted-foreground">{limit}</span>}
          </span>
        );
      },
    },
    {
      id: 'validity',
      header: 'Validity',
      meta: { className: 'hidden md:table-cell whitespace-nowrap' },
      cell: ({ row }) => validityText(row.original.validityValue, row.original.validityUnit),
    },
    {
      id: 'price',
      header: 'Price',
      meta: { className: 'tabular whitespace-nowrap text-right' },
      cell: ({ row }) => formatMoney(row.original.price),
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => <PackageActiveBadge isActive={row.original.isActive} />,
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      meta: { className: 'w-12 text-right' },
      cell: ({ row }) => <PackageActions pkg={row.original} onConfirm={setPending} />,
    },
  ];

  const confirm = () => {
    if (!pending) return;
    const { pkg } = pending;
    const done = {
      onSuccess: () => setPending(null),
      onError: (e: Error) => toast.error(e.message),
    };
    if (pending.kind === 'delete') {
      remove.mutate(pkg.id, {
        ...done,
        onSuccess: () => {
          toast.success(`${pkg.name} deleted`);
          setPending(null);
        },
      });
    } else {
      status.mutate(
        { id: pkg.id, isActive: false },
        {
          ...done,
          onSuccess: () => {
            toast.success(`${pkg.name} is inactive`);
            setPending(null);
          },
        },
      );
    }
  };

  return (
    <>
      <PageHeader
        title="Therapy packages"
        description={
          data
            ? `${data.total} ${data.total === 1 ? 'package' : 'packages'}${filtered ? ' match' : ''}`
            : 'Session packages the center sells, with their prices and terms.'
        }
        actions={create}
      />
      <PackagesNav current="catalog" />
      <DataTable
        label="Therapy packages"
        columns={columns}
        data={data?.items}
        loading={isFetching}
        error={error}
        onRetry={() => void refetch()}
        getRowId={(p) => p.id}
        rowHref={(p) => (p.actions.edit ? packageLinks.edit(p.id) : null)}
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
              label="Search packages"
              placeholder="Package name or code…"
            />
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
                    <span className="flex items-center gap-2">
                      <ColorDot color={t.color} />
                      {t.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={state.status} onValueChange={(v) => set({ status: v as StatusFilter })}>
              <SelectTrigger size="sm" className="w-full sm:w-36" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any status</SelectItem>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="INACTIVE">Inactive</SelectItem>
              </SelectContent>
            </Select>
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
              title="No packages match these filters"
              action={
                <Button variant="secondary" size="sm" onClick={clear}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Package}
              title="No packages yet"
              description="Add the session bundles you sell, e.g. 12 OT sessions valid for 30 days."
              action={create}
            />
          )
        }
      />
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={
          pending?.kind === 'delete'
            ? `Delete ${pending.pkg.name}?`
            : `Deactivate ${pending?.pkg.name}?`
        }
        description={
          pending?.kind === 'delete'
            ? 'Nobody has enrolled in it, so it can be removed for good.'
            : 'Patients can’t be newly enrolled in it. Existing enrollments keep working on their own terms.'
        }
        confirmLabel={pending?.kind === 'delete' ? 'Delete package' : 'Deactivate'}
        tone={pending?.kind === 'delete' ? 'danger' : 'primary'}
        loading={remove.isPending || status.isPending}
        onConfirm={confirm}
      />
    </>
  );
}

export function PackagesScreen() {
  return (
    <RequirePermission permission="packages.read">
      <div className="animate-in">
        <PackageTable />
      </div>
    </RequirePermission>
  );
}
