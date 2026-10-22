'use client';

import * as React from 'react';
import Link from 'next/link';
import { Ellipsis, Eye, Pencil, Trash2, UserCheck, UserX } from 'lucide-react';

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
import { useDeletePatient, useSetPatientStatus } from '@/lib/api/patients';
import { useSession } from '@/lib/session';
import type { PatientSummary } from '@/lib/types';

type Target = Pick<PatientSummary, 'id' | 'fullName' | 'code' | 'status'>;
type StatusChange = { patient: Target; to: 'ACTIVE' | 'INACTIVE' };

export const patientLinks = {
  list: '/patients',
  new: '/patients/new',
  profile: (id: string) => `/patients/${id}`,
  edit: (id: string) => `/patients/${id}/edit`,
};

/** Confirmation dialogs for status changes and deletion, shared by list and profile. */
export function usePatientDialogs({ afterDelete }: { afterDelete?: () => void } = {}) {
  const setStatus = useSetPatientStatus();
  const remove = useDeletePatient();
  const [statusChange, setStatusChange] = React.useState<StatusChange | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<Target | null>(null);
  const activating = statusChange?.to === 'ACTIVE';
  const name = statusChange?.patient.fullName;

  const dialogs = (
    <>
      <ConfirmDialog
        open={Boolean(statusChange)}
        onOpenChange={(o) => !o && setStatusChange(null)}
        title={activating ? `Mark ${name} as active?` : `Deactivate ${name}?`}
        description={
          activating
            ? 'They’ll show as an active patient of the center.'
            : // Appointments can't be counted yet, so don't claim there are none.
              'Their record, contacts and history are kept, and appointments already booked aren’t cancelled. You can reactivate them any time.'
        }
        confirmLabel={activating ? 'Mark active' : 'Deactivate'}
        tone={activating ? 'primary' : 'danger'}
        loading={setStatus.isPending}
        onConfirm={() => {
          if (!statusChange) return;
          setStatus.mutate(
            { id: statusChange.patient.id, status: statusChange.to },
            {
              onSuccess: () => {
                toast.success(`${name} ${activating ? 'is now active' : 'deactivated'}`);
                setStatusChange(null);
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
        description={`${deleteTarget?.code} is removed from lists and searches. The record, its guardians and its history are kept, so it can be restored by support if this was a mistake. To pause a patient instead, deactivate them.`}
        confirmLabel="Delete patient"
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
    changeStatus: React.useCallback(
      (patient: Target, to: StatusChange['to']) => setStatusChange({ patient, to }),
      [],
    ),
    remove: React.useCallback((t: Target) => setDeleteTarget(t), []),
    dialogs,
  };
}

/** Activate for new and inactive patients, deactivate for new and active ones. */
export function statusActions(status: PatientSummary['status']) {
  return {
    canActivate: status !== 'ACTIVE',
    canDeactivate: status !== 'INACTIVE',
  };
}

export function PatientActionsMenu({
  patient,
  onChangeStatus,
  onDelete,
}: {
  patient: PatientSummary;
  onChangeStatus: (t: Target, to: StatusChange['to']) => void;
  onDelete: (t: Target) => void;
}) {
  const { can } = useSession();
  const { canActivate, canDeactivate } = statusActions(patient.status);
  const canStatus = can('patients.change_status');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${patient.fullName}`}>
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={patientLinks.profile(patient.id)}>
            <Eye /> View details
          </Link>
        </DropdownMenuItem>
        {can('patients.update') && (
          <DropdownMenuItem asChild>
            <Link href={patientLinks.edit(patient.id)}>
              <Pencil /> Edit patient
            </Link>
          </DropdownMenuItem>
        )}
        {(canStatus || can('patients.delete')) && <DropdownMenuSeparator />}
        {canStatus && canActivate && (
          <DropdownMenuItem onSelect={() => onChangeStatus(patient, 'ACTIVE')}>
            <UserCheck /> Activate
          </DropdownMenuItem>
        )}
        {canStatus && canDeactivate && (
          <DropdownMenuItem tone="danger" onSelect={() => onChangeStatus(patient, 'INACTIVE')}>
            <UserX /> Deactivate
          </DropdownMenuItem>
        )}
        {can('patients.delete') && (
          <DropdownMenuItem tone="danger" onSelect={() => onDelete(patient)}>
            <Trash2 /> Delete
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
