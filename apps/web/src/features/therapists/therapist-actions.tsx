'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  CalendarDays,
  CalendarPlus,
  Clock,
  Ellipsis,
  Eye,
  Pencil,
  Trash2,
  UserCheck,
  UserX,
} from 'lucide-react';

import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/sonner';
import { useDeleteTherapist, useSetTherapistStatus } from '@/lib/api/therapists';
import { useSession } from '@/lib/session';
import type { TherapistDetail, TherapistListItem } from '@/lib/types';

type Target = Pick<TherapistListItem, 'id' | 'fullName' | 'status'> &
  Partial<Pick<TherapistDetail, 'upcomingAppointments' | 'hasAccount'>>;

/** Links into a therapist's profile tabs. */
export const therapistLinks = {
  profile: (id: string) => `/therapists/${id}`,
  edit: (id: string) => `/therapists/${id}/edit`,
  availability: (id: string) => `/therapists/${id}?tab=availability`,
  addTimeOff: (id: string) => `/therapists/${id}?tab=availability&timeOff=new`,
  schedule: (id: string) => `/therapists/${id}/schedule`,
};

function deactivateDescription(t: Target) {
  const n = t.upcomingAppointments;
  // null/undefined: appointments can't be counted yet, so don't claim there are none.
  const bookings =
    n === undefined || n === null
      ? 'Appointments already booked aren’t cancelled.'
      : n > 0
        ? `Their ${n} upcoming appointment${n > 1 ? 's aren’t' : ' isn’t'} cancelled: review ${n > 1 ? 'them' : 'it'} in Appointments.`
        : '';
  const kept = t.hasAccount
    ? 'Their profile and history are kept, and they can still sign in.'
    : 'Their profile and history are kept.';
  return [`${t.fullName} won’t be offered for new bookings.`, bookings, kept]
    .filter(Boolean)
    .join(' ');
}

/** Confirmation dialogs for status changes and deletion, shared by list and profile. */
export function useTherapistDialogs({ afterDelete }: { afterDelete?: () => void } = {}) {
  const setStatus = useSetTherapistStatus();
  const remove = useDeleteTherapist();
  const [statusTarget, setStatusTarget] = React.useState<Target | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<Target | null>(null);
  const activating = statusTarget?.status === 'INACTIVE';

  const dialogs = (
    <>
      <ConfirmDialog
        open={Boolean(statusTarget)}
        onOpenChange={(o) => !o && setStatusTarget(null)}
        title={
          activating
            ? `Reactivate ${statusTarget?.fullName}?`
            : `Deactivate ${statusTarget?.fullName}?`
        }
        description={
          statusTarget &&
          (activating
            ? 'They’ll be available for new bookings again, within their weekly availability.'
            : deactivateDescription(statusTarget))
        }
        confirmLabel={activating ? 'Reactivate' : 'Deactivate'}
        tone={activating ? 'primary' : 'danger'}
        loading={setStatus.isPending}
        onConfirm={() => {
          if (!statusTarget) return;
          setStatus.mutate(
            { id: statusTarget.id, status: activating ? 'ACTIVE' : 'INACTIVE' },
            {
              onSuccess: () => {
                toast.success(
                  `${statusTarget.fullName} ${activating ? 'reactivated' : 'deactivated'}`,
                );
                setStatusTarget(null);
              },
              onError: (e) => toast.error(e.message),
            },
          );
        }}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={`Delete ${deleteTarget?.fullName}?`}
        description="The profile is removed from lists and can’t be booked. Its history is kept for past records, and any linked staff account isn’t affected. To pause a therapist instead, deactivate them."
        confirmLabel="Delete therapist"
        tone="danger"
        loading={remove.isPending}
        onConfirm={() => {
          if (!deleteTarget) return;
          remove.mutate(deleteTarget.id, {
            onSuccess: () => {
              toast.success(`${deleteTarget.fullName} deleted`);
              setDeleteTarget(null);
              afterDelete?.();
            },
            onError: (e) => toast.error(e.message),
          });
        }}
      />
    </>
  );

  return {
    changeStatus: React.useCallback((t: Target) => setStatusTarget(t), []),
    remove: React.useCallback((t: Target) => setDeleteTarget(t), []),
    dialogs,
  };
}

/** The row actions a user may take on a therapist, in one menu. */
export function TherapistActionsMenu({
  therapist,
  onChangeStatus,
  onDelete,
}: {
  therapist: TherapistListItem;
  onChangeStatus: (t: Target) => void;
  onDelete: (t: Target) => void;
}) {
  const { can } = useSession();
  const router = useRouter();
  const active = therapist.status === 'ACTIVE';
  const canStatus = can(active ? 'therapists.deactivate' : 'therapists.update');
  const id = therapist.id;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${therapist.fullName}`}>
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={therapistLinks.profile(id)}>
            <Eye /> View profile
          </Link>
        </DropdownMenuItem>
        {can('therapists.update') && (
          <DropdownMenuItem asChild>
            <Link href={therapistLinks.edit(id)}>
              <Pencil /> Edit therapist
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => router.push(therapistLinks.availability(id))}>
          <Clock /> {can('therapists.manage_availability') ? 'Manage availability' : 'Availability'}
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={therapistLinks.schedule(id)}>
            <CalendarDays /> View schedule
          </Link>
        </DropdownMenuItem>
        {can('therapists.manage_time_off') && (
          <DropdownMenuItem onSelect={() => router.push(therapistLinks.addTimeOff(id))}>
            <CalendarPlus /> Add time off
          </DropdownMenuItem>
        )}
        {(canStatus || can('therapists.delete')) && <DropdownMenuSeparator />}
        {canStatus &&
          (active ? (
            <DropdownMenuItem tone="danger" onSelect={() => onChangeStatus(therapist)}>
              <UserX /> Deactivate
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => onChangeStatus(therapist)}>
              <UserCheck /> Activate
            </DropdownMenuItem>
          ))}
        {can('therapists.delete') && (
          <DropdownMenuItem tone="danger" onSelect={() => onDelete(therapist)}>
            <Trash2 /> Delete
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
