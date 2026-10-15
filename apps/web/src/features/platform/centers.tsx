'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Building2, CheckCircle2, CircleSlash, Plus, SearchX } from 'lucide-react';

import { DataTable, type ColumnDef } from '@/components/data-table/data-table';
import { FilterBar, SearchInput } from '@/components/data-table/filter-bar';
import { StatusBadge } from '@/components/domain/status-badges';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/sonner';
import { CenterRegistrationForm } from '@/features/auth/register-form';
import { StaffStatusBadge } from '@/features/settings/staff/staff-actions';
import { isApiError } from '@/lib/api/client';
import { useCreateCenter, usePlatformCenter, usePlatformCenters } from '@/lib/api/platform';
import { formatDate, formatPhone } from '@/lib/format';
import { useDebounced } from '@/lib/hooks/use-debounced';
import type { CenterProfile, PlatformCenterListItem } from '@/lib/types';

const PAGE_SIZE = 10;

function CenterStatusBadge({ status }: { status: CenterProfile['status'] }) {
  return (
    <StatusBadge
      def={
        status === 'ACTIVE'
          ? { label: 'Active', tone: 'success', icon: CheckCircle2 }
          : { label: 'Suspended', tone: 'danger', icon: CircleSlash }
      }
    />
  );
}

const registerButton = (
  <Button asChild>
    <Link href="/admin/centers/new">
      <Plus /> Register center
    </Link>
  </Button>
);

export function CentersScreen() {
  const [search, setSearchValue] = React.useState('');
  const [page, setPage] = React.useState(1);
  const debounced = useDebounced(search);
  const { data, isFetching, error, refetch } = usePlatformCenters({
    search: debounced,
    page,
    pageSize: PAGE_SIZE,
  });
  const setSearch = (value: string) => {
    setSearchValue(value);
    setPage(1);
  };

  // Server-paginated, so client-side sorting is off (it would only sort one page).
  const columns = React.useMemo<ColumnDef<PlatformCenterListItem, unknown>[]>(
    () =>
      (
        [
          {
            accessorKey: 'name',
            header: 'Center',
            cell: ({ row }) => (
              <div className="flex min-w-0 flex-col">
                <Link
                  href={`/admin/centers/${row.original.id}`}
                  className="truncate rounded font-medium hover:underline focus-ring"
                >
                  {row.original.name}
                </Link>
                <span className="text-xs text-muted-foreground tabular">{row.original.code}</span>
              </div>
            ),
          },
          {
            id: 'admin',
            header: 'Administrator',
            meta: { className: 'hidden md:table-cell' },
            cell: ({ row }) =>
              row.original.primaryAdmin ? (
                <div className="flex min-w-0 flex-col">
                  <span className="truncate">{row.original.primaryAdmin.fullName}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {row.original.primaryAdmin.email}
                  </span>
                </div>
              ) : (
                <span className="text-subtle-foreground">None active</span>
              ),
          },
          {
            accessorKey: 'phone',
            header: 'Phone',
            meta: { className: 'hidden lg:table-cell tabular whitespace-nowrap' },
            cell: ({ row }) => formatPhone(row.original.phone),
          },
          {
            accessorKey: 'district',
            header: 'District',
            meta: { className: 'hidden xl:table-cell' },
            cell: ({ row }) => row.original.district ?? '—',
          },
          {
            accessorKey: 'activeStaff',
            header: 'Staff',
            meta: { className: 'text-right tabular' },
          },
          {
            accessorKey: 'status',
            header: 'Status',
            cell: ({ row }) => <CenterStatusBadge status={row.original.status} />,
          },
          {
            accessorKey: 'createdAt',
            header: 'Registered',
            meta: { className: 'hidden sm:table-cell tabular whitespace-nowrap' },
            cell: ({ row }) => formatDate(row.original.createdAt),
          },
        ] satisfies ColumnDef<PlatformCenterListItem, unknown>[]
      ).map((column) => ({ ...column, enableSorting: false })),
    [],
  );

  return (
    <div className="animate-in">
      <PageHeader
        title="Therapy centers"
        description="Every center on Carezino. Register new centers here."
        actions={registerButton}
      />
      <DataTable
        label="Therapy centers"
        columns={columns}
        data={data?.items}
        loading={isFetching}
        error={error}
        onRetry={() => void refetch()}
        getRowId={(c) => c.id}
        rowHref={(c) => `/admin/centers/${c.id}`}
        pagination={
          data
            ? { page: data.page, pageSize: data.pageSize, total: data.total, onPageChange: setPage }
            : undefined
        }
        toolbar={
          <FilterBar>
            <SearchInput
              value={search}
              onChange={setSearch}
              label="Search centers"
              placeholder="Search name, code, phone or district…"
            />
          </FilterBar>
        }
        empty={
          debounced ? (
            <EmptyState icon={SearchX} title="No centers match your search" />
          ) : (
            <EmptyState
              icon={Building2}
              title="No therapy centers yet"
              description="Register the first center and its administrator."
              action={registerButton}
            />
          )
        }
      />
    </div>
  );
}

export function NewCenterScreen() {
  const router = useRouter();
  const create = useCreateCenter();
  return (
    <div className="animate-in">
      <PageHeader
        back={{ href: '/admin', label: 'Therapy centers' }}
        title="Register a therapy center"
        description="Creates the center and its first administrator, who can then sign in and invite the team."
      />
      <Card>
        <CardContent className="pt-6">
          <CenterRegistrationForm
            variant="platform"
            onSubmit={async (values) => {
              const { center } = await create.mutateAsync(values);
              toast.success(`${center.name} registered`, {
                description: `Center code ${center.code}. ${values.owner.email} can sign in now.`,
              });
              router.push(`/admin/centers/${center.id}`);
            }}
            footer={
              <Button variant="secondary" size="lg" asChild>
                <Link href="/admin">Cancel</Link>
              </Button>
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words">{children}</dd>
    </div>
  );
}

export function CenterDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const { data: center, isPending, error, refetch } = usePlatformCenter(id);
  const back = { href: '/admin', label: 'Therapy centers' };

  if (isPending) return <PageSkeleton />;
  if (error) {
    return isApiError(error, 404) || isApiError(error, 400) ? (
      <Card>
        <EmptyState
          icon={SearchX}
          title="Center not found"
          action={
            <Button variant="secondary" size="sm" asChild>
              <Link href={back.href}>Back to centers</Link>
            </Button>
          }
        />
      </Card>
    ) : (
      <Card>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </Card>
    );
  }

  return (
    <div className="animate-in">
      <PageHeader
        back={back}
        title={center.name}
        meta={
          <>
            <CenterStatusBadge status={center.status} />
            <span className="text-[13px] text-muted-foreground tabular">{center.code}</span>
          </>
        }
      />
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Active staff', value: center.counts.activeStaff },
          { label: 'Inactive staff', value: center.counts.inactiveStaff },
          { label: 'Pending invitations', value: center.counts.pendingInvitations },
        ].map((stat) => (
          <Card key={stat.label} className="px-5 py-4">
            <p className="text-[13px] text-muted-foreground">{stat.label}</p>
            <p className="text-2xl font-semibold tabular">{stat.value}</p>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Center profile</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Detail label="Phone">{formatPhone(center.phone)}</Detail>
              <Detail label="Email">{center.email ?? '—'}</Detail>
              <Detail label="Address">{center.address}</Detail>
              <Detail label="District">{center.district ?? '—'}</Detail>
              <Detail label="Country">{center.country}</Detail>
              <Detail label="Time zone · currency">
                {center.timezone} · {center.currency}
              </Detail>
              <Detail label="Website">
                {center.website ? (
                  <a
                    href={center.website}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-primary hover:underline"
                  >
                    {center.website.replace(/^https?:\/\//, '')}
                  </a>
                ) : (
                  '—'
                )}
              </Detail>
              <Detail label="Registered">{formatDate(center.createdAt)}</Detail>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Administrators</CardTitle>
          </CardHeader>
          <CardContent>
            {center.administrators.length ? (
              <ul className="divide-y divide-border">
                {center.administrators.map((admin) => (
                  <li
                    key={admin.id}
                    className="flex items-start justify-between gap-3 py-3 first:pt-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{admin.fullName}</p>
                      <p className="truncate text-[13px] text-muted-foreground">{admin.email}</p>
                      {admin.mobile && (
                        <p className="text-[13px] text-muted-foreground tabular">
                          {formatPhone(admin.mobile)}
                        </p>
                      )}
                    </div>
                    <StaffStatusBadge status={admin.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">This center has no administrator.</p>
            )}
            <p className="mt-4 text-[13px] text-muted-foreground">
              Administrators manage the center’s profile and staff themselves after signing in at
              the regular sign-in page.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
