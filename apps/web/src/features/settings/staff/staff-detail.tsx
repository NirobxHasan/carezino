'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ShieldCheck, UserCheck, UserSearch, UserX } from 'lucide-react';

import { RequirePermission } from '@/components/auth/require-permission';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/feedback/states';
import { useBreadcrumbLabel } from '@/components/layout/breadcrumbs';
import { PageHeader } from '@/components/layout/page-header';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { isApiError } from '@/lib/api/client';
import { useStaffMember } from '@/lib/api/staff';
import { formatDate, formatPhone } from '@/lib/format';
import { roleDescriptions, roleLabels } from '@/lib/permissions';
import { useSession } from '@/lib/session';
import { StaffStatusBadge, useStaffDialogs } from './staff-actions';

const back = { href: '/settings/staff', label: 'Staff' };

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export function StaffDetail() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const { data: member, isPending, error, refetch } = useStaffMember(id);
  const { changeRole, changeStatus, dialogs } = useStaffDialogs();
  useBreadcrumbLabel(id, member?.fullName);

  if (isPending) return <PageSkeleton />;
  if (error) {
    // 404 covers both "doesn't exist" and "belongs to another center".
    return isApiError(error, 404) || isApiError(error, 400) ? (
      <Card>
        <EmptyState
          icon={UserSearch}
          title="Staff member not found"
          description="They may have been removed, or the link is wrong."
          action={
            <Button variant="secondary" size="sm" asChild>
              <Link href={back.href}>Back to staff</Link>
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

  const canRole = can('staff.assign_role') && !member.isYou;
  const canStatus =
    !member.isYou && can(member.status === 'ACTIVE' ? 'staff.deactivate' : 'staff.update');

  return (
    <>
      <PageHeader
        back={back}
        title={
          <span className="flex items-center gap-3">
            <Avatar name={member.fullName} size="lg" />
            {member.fullName}
          </span>
        }
        meta={
          <>
            <StaffStatusBadge status={member.status} />
            {member.isYou && <Badge tone="primary">You</Badge>}
          </>
        }
        actions={
          <>
            {canRole && (
              <Button variant="secondary" onClick={() => changeRole(member)}>
                <ShieldCheck /> Change role
              </Button>
            )}
            {canStatus &&
              (member.status === 'ACTIVE' ? (
                <Button variant="danger-ghost" onClick={() => changeStatus(member)}>
                  <UserX /> Deactivate
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => changeStatus(member)}>
                  <UserCheck /> Reactivate
                </Button>
              ))}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Contact</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Detail label="Email">{member.email}</Detail>
              <Detail label="Mobile">{member.mobile ? formatPhone(member.mobile) : '—'}</Detail>
            </dl>
            <p className="mt-4 text-[13px] text-muted-foreground">
              Name, email and mobile belong to the person’s own Carezino account, which they manage
              from their profile.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Access at this center</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Detail label="Role">{roleLabels[member.role]}</Detail>
              <Detail label="Joined">{formatDate(member.joinedAt)}</Detail>
            </dl>
            <p className="mt-4 text-[13px] text-muted-foreground">
              {roleDescriptions[member.role]}
            </p>
          </CardContent>
        </Card>
      </div>
      {dialogs}
    </>
  );
}

export function StaffDetailScreen() {
  return (
    <RequirePermission permission="staff.read">
      <StaffDetail />
    </RequirePermission>
  );
}
