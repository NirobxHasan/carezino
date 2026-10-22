'use client';

import * as React from 'react';
import Link from 'next/link';
import { ClipboardList, ClipboardPlus } from 'lucide-react';

import { DataTable } from '@/components/data-table/data-table';
import { EmptyState } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { usePatientAssessments } from '@/lib/api/assessments';
import { useSession } from '@/lib/session';
import { useCenterFormat } from '../appointments/appointment-display';
import { assessmentLinks } from './assessment-display';
import { assessmentColumns } from './assessments-screen';

/** A patient's assessments, newest first: every type and therapy, never overwritten. */
export function PatientAssessmentsPanel({ patientId }: { patientId: string }) {
  const { can } = useSession();
  const fmt = useCenterFormat();
  const { data, isFetching, error, refetch } = usePatientAssessments(patientId);
  const columns = React.useMemo(() => assessmentColumns({ fmt, showPatient: false }), [fmt]);
  const create = can('assessments.create') && (
    <Button size="sm" asChild>
      <Link href={assessmentLinks.create({ patientId })}>
        <ClipboardPlus /> New assessment
      </Link>
    </Button>
  );
  return (
    <DataTable
      label="Assessment history"
      columns={columns}
      data={data?.items}
      loading={isFetching}
      error={error}
      onRetry={() => void refetch()}
      getRowId={(a) => a.id}
      rowHref={(a) => (a.actions.view ? assessmentLinks.detail(a.id) : null)}
      toolbar={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13px] text-muted-foreground">
            Initial assessments, follow-ups and reassessments, newest first.
          </p>
          {create}
        </div>
      }
      empty={
        <EmptyState compact icon={ClipboardList} title="No assessments yet." action={create} />
      }
    />
  );
}
