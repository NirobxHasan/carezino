'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Ellipsis,
  Eye,
  Link2,
  MailPlus,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  UserPlus,
  UserX,
  Users,
  XCircle,
} from 'lucide-react';

import { RequirePermission } from '@/components/auth/require-permission';
import { DataTable, type ColumnDef } from '@/components/data-table/data-table';
import { FilterBar, SearchInput } from '@/components/data-table/filter-bar';
import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { EmptyState } from '@/components/feedback/states';
import { SectionHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useCreateInvitationLink,
  useInvitations,
  useResendInvitation,
  useRevokeInvitation,
  useStaff,
  type StaffListParams,
} from '@/lib/api/staff';
import { formatDate, formatPhone } from '@/lib/format';
import { useDebounced } from '@/lib/hooks/use-debounced';
import { ROLES, roleLabels } from '@/lib/permissions';
import { useSession } from '@/lib/session';
import type { StaffInvitation, StaffMember } from '@/lib/types';
import {
  InvitationLinkDialog,
  InvitationStatusBadge,
  InviteStaffDialog,
  StaffStatusBadge,
  announceInvitation,
  useStaffDialogs,
  type SharedInvitationLink,
} from './staff-actions';

const PAGE_SIZE = 10;

function StaffActionsMenu({
  member,
  onChangeRole,
  onChangeStatus,
}: {
  member: StaffMember;
  onChangeRole: (m: StaffMember) => void;
  onChangeStatus: (m: StaffMember) => void;
}) {
  const { can } = useSession();
  const canRole = can('staff.assign_role') && !member.isYou;
  const canStatus =
    !member.isYou && can(member.status === 'ACTIVE' ? 'staff.deactivate' : 'staff.update');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${member.fullName}`}>
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem asChild>
          <Link href={`/settings/staff/${member.id}`}>
            <Eye /> View details
          </Link>
        </DropdownMenuItem>
        {canRole && (
          <DropdownMenuItem onSelect={() => onChangeRole(member)}>
            <ShieldCheck /> Change role
          </DropdownMenuItem>
        )}
        {canStatus && (
          <>
            <DropdownMenuSeparator />
            {member.status === 'ACTIVE' ? (
              <DropdownMenuItem tone="danger" onSelect={() => onChangeStatus(member)}>
                <UserX /> Deactivate
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => onChangeStatus(member)}>
                <UserCheck /> Reactivate
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StaffTable({ onInvite }: { onInvite?: () => void }) {
  const [search, setSearchValue] = React.useState('');
  const [role, setRoleValue] = React.useState<StaffListParams['role']>('all');
  const [status, setStatusValue] = React.useState<StaffListParams['status']>('all');
  const [page, setPage] = React.useState(1);
  // A new filter starts from the first page.
  const setSearch = (v: string) => {
    setSearchValue(v);
    setPage(1);
  };
  const setRole = (v: StaffListParams['role']) => {
    setRoleValue(v);
    setPage(1);
  };
  const setStatus = (v: StaffListParams['status']) => {
    setStatusValue(v);
    setPage(1);
  };
  const debouncedSearch = useDebounced(search);
  const params = { search: debouncedSearch, role, status, page, pageSize: PAGE_SIZE };
  const { data, isFetching, error, refetch } = useStaff(params);
  const { changeRole, changeStatus, dialogs } = useStaffDialogs();
  const filtered = Boolean(debouncedSearch || role !== 'all' || status !== 'all');

  // Sorting is off: the list is paginated on the server, so sorting here would only
  // reorder the current page.
  const columns = React.useMemo<ColumnDef<StaffMember, unknown>[]>(
    () =>
      (
        [
          {
            accessorKey: 'fullName',
            header: 'Name',
            cell: ({ row }) => (
              <div className="flex min-w-0 flex-col">
                <span className="flex items-center gap-2">
                  <Link
                    href={`/settings/staff/${row.original.id}`}
                    className="truncate font-medium hover:underline focus-ring rounded"
                  >
                    {row.original.fullName}
                  </Link>
                  {row.original.isYou && <Badge tone="primary">You</Badge>}
                </span>
                <span className="truncate text-xs text-muted-foreground 2xl:hidden">
                  {row.original.email}
                </span>
              </div>
            ),
          },
          {
            accessorKey: 'email',
            header: 'Email',
            meta: { className: 'hidden 2xl:table-cell' },
            cell: ({ getValue }) => (
              <span className="text-muted-foreground">{getValue() as string}</span>
            ),
          },
          {
            accessorKey: 'mobile',
            header: 'Phone',
            meta: { className: 'hidden lg:table-cell tabular whitespace-nowrap' },
            cell: ({ getValue }) => {
              const v = getValue() as string | null;
              return v ? formatPhone(v) : <span className="text-subtle-foreground">—</span>;
            },
          },
          {
            accessorKey: 'role',
            header: 'Role',
            cell: ({ row }) => roleLabels[row.original.role],
          },
          {
            accessorKey: 'status',
            header: 'Status',
            cell: ({ row }) => <StaffStatusBadge status={row.original.status} />,
          },
          {
            accessorKey: 'joinedAt',
            header: 'Joined',
            meta: { className: 'hidden md:table-cell tabular whitespace-nowrap' },
            cell: ({ row }) => formatDate(row.original.joinedAt),
          },
          {
            id: 'actions',
            header: () => <span className="sr-only">Actions</span>,
            meta: { className: 'w-12 text-right' },
            cell: ({ row }) => (
              <StaffActionsMenu
                member={row.original}
                onChangeRole={changeRole}
                onChangeStatus={changeStatus}
              />
            ),
          },
        ] satisfies ColumnDef<StaffMember, unknown>[]
      ).map((column) => ({ ...column, enableSorting: false })),
    [changeRole, changeStatus],
  );

  return (
    <>
      <DataTable
        label="Staff"
        columns={columns}
        data={data?.items}
        loading={isFetching}
        error={error}
        onRetry={() => void refetch()}
        getRowId={(m) => m.id}
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
              label="Search staff"
              placeholder="Search name, email or phone…"
            />
            <Select value={role} onValueChange={(v) => setRole(v as StaffListParams['role'])}>
              <SelectTrigger size="sm" className="w-full sm:w-44" aria-label="Filter by role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {roleLabels[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(v) => setStatus(v as StaffListParams['status'])}>
              <SelectTrigger size="sm" className="w-full sm:w-36" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any status</SelectItem>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="INACTIVE">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </FilterBar>
        }
        empty={
          filtered ? (
            <EmptyState
              title="No staff match these filters"
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setSearch('');
                    setRole('all');
                    setStatus('all');
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Users}
              title="No staff yet"
              description="Invite your therapists, managers and front-desk team."
              action={
                onInvite && (
                  <Button size="sm" onClick={onInvite}>
                    <UserPlus /> Invite staff
                  </Button>
                )
              }
            />
          )
        }
      />
      {dialogs}
    </>
  );
}

function InvitationsTable({
  canManage,
  onShowLink,
}: {
  canManage: boolean;
  onShowLink: (shared: SharedInvitationLink) => void;
}) {
  const { data, isPending, error, refetch } = useInvitations();
  const resend = useResendInvitation();
  const createLink = useCreateInvitationLink();
  const revoke = useRevokeInvitation();
  const [revokeTarget, setRevokeTarget] = React.useState<StaffInvitation | null>(null);

  const columns = React.useMemo<ColumnDef<StaffInvitation, unknown>[]>(
    () => [
      {
        accessorKey: 'fullName',
        header: 'Name',
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{row.original.fullName}</span>
            <span className="truncate text-xs text-muted-foreground">{row.original.email}</span>
          </div>
        ),
      },
      { accessorKey: 'role', header: 'Role', cell: ({ row }) => roleLabels[row.original.role] },
      {
        id: 'status',
        header: 'Status',
        cell: ({ row }) => <InvitationStatusBadge invitation={row.original} />,
      },
      {
        accessorKey: 'expiresAt',
        header: 'Expires',
        meta: { className: 'hidden md:table-cell tabular' },
        cell: ({ row }) => formatDate(row.original.expiresAt),
      },
      {
        accessorKey: 'invitedByName',
        header: 'Invited by',
        meta: { className: 'hidden lg:table-cell' },
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        meta: { className: 'w-12 text-right' },
        cell: ({ row }) =>
          canManage ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Actions for ${row.original.email}`}
                >
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem
                  disabled={createLink.isPending}
                  onSelect={() =>
                    createLink.mutate(row.original.id, {
                      onSuccess: (result) => onShowLink({ ...result, emailFailed: false }),
                      onError: (e) => toast.error(e.message),
                    })
                  }
                >
                  <Link2 /> Get invitation link
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={resend.isPending}
                  onSelect={() =>
                    resend.mutate(row.original.id, {
                      onSuccess: (result) => announceInvitation(result, 'resent', onShowLink),
                      onError: (e) => toast.error(e.message),
                    })
                  }
                >
                  <RefreshCw /> Resend invitation
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem tone="danger" onSelect={() => setRevokeTarget(row.original)}>
                  <XCircle /> Revoke
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null,
      },
    ],
    [canManage, resend, createLink, onShowLink],
  );

  return (
    <>
      <DataTable
        label="Pending invitations"
        columns={columns}
        data={data}
        loading={isPending}
        error={error}
        onRetry={() => void refetch()}
        getRowId={(i) => i.id}
        empty={
          <EmptyState
            icon={MailPlus}
            title="No pending invitations"
            description="Invitations appear here until they’re accepted or revoked."
          />
        }
      />
      <ConfirmDialog
        open={Boolean(revokeTarget)}
        onOpenChange={(o) => !o && setRevokeTarget(null)}
        title={`Revoke the invitation for ${revokeTarget?.fullName}?`}
        description="The link in their email will stop working. You can invite them again later."
        confirmLabel="Revoke invitation"
        tone="danger"
        loading={revoke.isPending}
        onConfirm={() => {
          if (!revokeTarget) return;
          revoke.mutate(revokeTarget.id, {
            onSuccess: () => {
              toast.success('Invitation revoked');
              setRevokeTarget(null);
            },
            onError: (e) => toast.error(e.message),
          });
        }}
      />
    </>
  );
}

export function StaffScreen() {
  const { can } = useSession();
  const canInvite = can('staff.create') && can('staff.assign_role');
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [sharedLink, setSharedLink] = React.useState<SharedInvitationLink | null>(null);
  const invitations = useInvitations(can('staff.read'));
  const pending = invitations.data?.length ?? 0;

  return (
    <RequirePermission permission="staff.read">
      <SectionHeader
        title="Staff"
        description="Everyone who can sign in to this center, and what they can do."
        actions={
          canInvite && (
            <Button onClick={() => setInviteOpen(true)}>
              <UserPlus /> Invite staff
            </Button>
          )
        }
      />
      <Tabs defaultValue="staff">
        <TabsList>
          <TabsTrigger value="staff">Team</TabsTrigger>
          <TabsTrigger value="invitations">
            Invitations
            {pending > 0 && (
              <Badge tone="info" className="px-1.5">
                {pending}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="staff">
          <StaffTable onInvite={canInvite ? () => setInviteOpen(true) : undefined} />
        </TabsContent>
        <TabsContent value="invitations">
          <InvitationsTable canManage={can('staff.create')} onShowLink={setSharedLink} />
        </TabsContent>
      </Tabs>
      {canInvite && (
        <InviteStaffDialog
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          onShowLink={setSharedLink}
        />
      )}
      <InvitationLinkDialog shared={sharedLink} onOpenChange={(o) => !o && setSharedLink(null)} />
    </RequirePermission>
  );
}
