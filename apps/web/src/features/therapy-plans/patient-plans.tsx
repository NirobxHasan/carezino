'use client';

import * as React from 'react';
import Link from 'next/link';
import { ListChecks, Plus } from 'lucide-react';

import { DataTable } from '@/components/data-table/data-table';
import { EmptyState } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { usePatientPlans } from '@/lib/api/therapy-plans';
import { useSession } from '@/lib/session';
import { useCenterFormat } from '../appointments/appointment-display';
import { planLinks } from './plan-display';
import { planColumns } from './plans-screen';

/**
 * A patient's therapy plans: those in force and drafts first, then previous ones. Each
 * therapy keeps its own plan and goals; nothing is merged across therapies.
 */
export function PatientPlansPanel({ patientId }: { patientId: string }) {
  const { can } = useSession();
  const fmt = useCenterFormat();
  const { data, isFetching, error, refetch } = usePatientPlans(patientId);
  const columns = React.useMemo(() => planColumns({ fmt, showPatient: false }), [fmt]);
  const items = data?.items;
  const current = items?.filter((p) => !['COMPLETED', 'DISCONTINUED'].includes(p.status));
  const previous = items?.filter((p) => ['COMPLETED', 'DISCONTINUED'].includes(p.status));
  const create = can('therapy_plans.create') && (
    <Button size="sm" asChild>
      <Link href={planLinks.create({ patientId })}>
        <Plus /> New therapy plan
      </Link>
    </Button>
  );
  return (
    <div className="grid gap-4">
      <DataTable
        label="Current therapy plans"
        columns={columns}
        data={current}
        loading={isFetching}
        error={error}
        onRetry={() => void refetch()}
        getRowId={(p) => p.id}
        rowHref={(p) => planLinks.detail(p.id)}
        toolbar={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] text-muted-foreground">
              Plans in force and drafts. A patient can have one plan in force per therapy.
            </p>
            {create}
          </div>
        }
        empty={
          <EmptyState compact icon={ListChecks} title="No current therapy plans." action={create} />
        }
      />
      {previous && previous.length > 0 && (
        <DataTable
          label="Previous therapy plans"
          columns={columns}
          data={previous}
          getRowId={(p) => p.id}
          rowHref={(p) => planLinks.detail(p.id)}
          toolbar={<p className="text-[13px] text-muted-foreground">Completed and discontinued.</p>}
        />
      )}
    </div>
  );
}
