'use client';

import * as React from 'react';
import Link from 'next/link';
import { Plus, Ticket } from 'lucide-react';

import { DataTable } from '@/components/data-table/data-table';
import { EmptyState } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { usePatientEnrollments } from '@/lib/api/packages';
import { useSession } from '@/lib/session';
import { useCenterFormat } from '../appointments/appointment-display';
import { enrollmentColumns } from './enrollments-screen';
import { packageLinks } from './package-display';

/**
 * A patient's packages: those that can still be used first, then earlier purchases.
 * Each purchase is its own enrollment with its own balance; nothing is combined.
 */
export function PatientPackagesPanel({
  patientId,
  canEnroll,
}: {
  patientId: string;
  /** False for inactive patients, who can't be enrolled */
  canEnroll: boolean;
}) {
  const { can } = useSession();
  const fmt = useCenterFormat();
  const { data, isFetching, error, refetch } = usePatientEnrollments(patientId);
  const columns = React.useMemo(() => enrollmentColumns({ fmt, showPatient: false }), [fmt]);
  const usable = data?.items.filter((e) => e.status === 'ACTIVE' || e.status === 'PENDING');
  const previous = data?.items.filter((e) => e.status !== 'ACTIVE' && e.status !== 'PENDING');
  const enroll = canEnroll && can('package_enrollments.create') && (
    <Button size="sm" asChild>
      <Link href={packageLinks.enroll({ patientId })}>
        <Plus /> Enroll in package
      </Link>
    </Button>
  );
  return (
    <div className="grid gap-4">
      <DataTable
        label="Current packages"
        columns={columns}
        data={usable}
        loading={isFetching}
        error={error}
        onRetry={() => void refetch()}
        getRowId={(e) => e.id}
        rowHref={(e) => packageLinks.enrollment(e.id)}
        toolbar={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] text-muted-foreground">
              Active packages and ones that haven’t started. Prices are what was agreed, not what
              was paid.
            </p>
            {enroll}
          </div>
        }
        empty={<EmptyState compact icon={Ticket} title="No current packages." action={enroll} />}
      />
      {previous && previous.length > 0 && (
        <DataTable
          label="Previous packages"
          columns={columns}
          data={previous}
          getRowId={(e) => e.id}
          rowHref={(e) => packageLinks.enrollment(e.id)}
          toolbar={
            <p className="text-[13px] text-muted-foreground">Used up, expired and cancelled.</p>
          }
        />
      )}
    </div>
  );
}
