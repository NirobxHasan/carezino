'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FilePlus2, FileText } from 'lucide-react';

import { RequirePermission } from '@/components/auth/require-permission';
import { DataTable, type ColumnDef } from '@/components/data-table/data-table';
import { FilterBar } from '@/components/data-table/filter-bar';
import { EmptyState } from '@/components/feedback/states';
import { ColorDot } from '@/components/forms/color-picker';
import { Field } from '@/components/forms/field';
import { SectionHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { RadioCard, RadioGroup } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui/sonner';
import { Textarea } from '@/components/ui/textarea';
import { useCreateTemplate, useTemplateList } from '@/lib/api/assessments';
import { isApiError } from '@/lib/api/client';
import { useTherapyTypeList } from '@/lib/api/therapy-types';
import { formatDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { AssessmentKind, AssessmentTemplateItem, AssessmentTemplateStatus } from '@/lib/types';
import {
  ASSESSMENT_KINDS,
  TEMPLATE_STATUSES,
  TemplateStatusBadge,
  assessmentLinks,
} from '../../assessments/assessment-display';

function NewTemplateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const types = useTherapyTypeList({ status: 'ACTIVE' });
  const create = useCreateTemplate();
  const [name, setName] = React.useState('');
  const [therapyTypeId, setTherapyTypeId] = React.useState('');
  const [purpose, setPurpose] = React.useState<AssessmentKind | 'any'>('any');
  const [description, setDescription] = React.useState('');
  const [start, setStart] = React.useState<'starter' | 'blank'>('starter');
  const errors = isApiError(create.error) ? (create.error.errors ?? {}) : {};
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New assessment template</DialogTitle>
          <DialogDescription>
            It starts as a draft. Publish it when the form is ready to use.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Template name" required error={errors.name}>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              placeholder="e.g. Pediatric OT initial assessment"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Therapy" required error={errors.therapyTypeId}>
              <Select value={therapyTypeId} onValueChange={setTherapyTypeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a therapy" />
                </SelectTrigger>
                <SelectContent>
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
            </Field>
            <Field label="Used for" optional error={errors.purpose}>
              <Select
                value={purpose}
                onValueChange={(v) => setPurpose(v as AssessmentKind | 'any')}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any assessment type</SelectItem>
                  {Object.entries(ASSESSMENT_KINDS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Description" optional error={errors.description}>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={1000}
            />
          </Field>
          <RadioGroup
            value={start}
            onValueChange={(v) => setStart(v as 'starter' | 'blank')}
            aria-label="Start from"
            className="sm:grid-cols-2"
          >
            <RadioCard
              value="starter"
              title="General starter form"
              description="General information and functional assessment, to adapt."
            />
            <RadioCard
              value="blank"
              title="Blank form"
              description="Add your own sections and fields."
            />
          </RadioGroup>
        </div>
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={create.isPending}
          >
            Cancel
          </Button>
          <Button
            loading={create.isPending}
            disabled={!name.trim() || !therapyTypeId}
            onClick={() =>
              create.mutate(
                {
                  name: name.trim(),
                  therapyTypeId,
                  purpose: purpose === 'any' ? null : purpose,
                  description: description.trim(),
                  starter: start === 'starter',
                },
                {
                  onSuccess: (t) => {
                    toast.success('Template created');
                    router.push(assessmentLinks.template(t.id));
                  },
                  onError: (e) => !(isApiError(e) && e.errors) && toast.error(e.message),
                },
              )
            }
          >
            Create draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const columns: ColumnDef<AssessmentTemplateItem, unknown>[] = [
  {
    id: 'name',
    header: 'Template',
    cell: ({ row }) => (
      <span className="flex min-w-0 flex-col">
        <Link
          href={assessmentLinks.template(row.original.id)}
          className="truncate rounded font-medium hover:underline focus-ring"
        >
          {row.original.name}
        </Link>
        {row.original.description && (
          <span className="truncate text-xs text-muted-foreground">{row.original.description}</span>
        )}
      </span>
    ),
  },
  {
    id: 'therapy',
    header: 'Therapy',
    cell: ({ row }) => (
      <span className="inline-flex items-center gap-1.5 text-[13px]">
        <ColorDot color={row.original.therapyType.color} />
        {row.original.therapyType.name}
      </span>
    ),
  },
  {
    id: 'purpose',
    header: 'Used for',
    meta: { className: 'hidden md:table-cell text-[13px]' },
    cell: ({ row }) => (row.original.purpose ? ASSESSMENT_KINDS[row.original.purpose] : 'Any type'),
  },
  {
    id: 'version',
    header: 'Version',
    meta: { className: 'hidden sm:table-cell whitespace-nowrap text-[13px]' },
    cell: ({ row }) => {
      const t = row.original;
      return (
        <span className="flex flex-col">
          <span>
            {t.published
              ? `v${t.published.version} · ${t.published.fieldCount} fields`
              : 'Not published'}
          </span>
          {t.draft && t.published && (
            <span className="text-xs text-warning-foreground">v{t.draft.version} in progress</span>
          )}
        </span>
      );
    },
  },
  {
    id: 'used',
    header: 'Assessments',
    meta: { className: 'hidden lg:table-cell tabular text-[13px]' },
    cell: ({ row }) => row.original.assessmentCount,
  },
  {
    id: 'updated',
    header: 'Updated',
    meta: { className: 'hidden lg:table-cell whitespace-nowrap text-[13px]' },
    cell: ({ row }) => formatDate(row.original.updatedAt),
  },
  {
    id: 'status',
    header: 'Status',
    cell: ({ row }) => <TemplateStatusBadge status={row.original.status} />,
  },
];

export function TemplatesScreen() {
  const { can } = useSession();
  const [status, setStatus] = React.useState<AssessmentTemplateStatus | 'active'>('active');
  const [therapyTypeId, setTherapyTypeId] = React.useState('all');
  const [creating, setCreating] = React.useState(false);
  const types = useTherapyTypeList({ status: 'all' });
  const { data, isFetching, error, refetch } = useTemplateList({
    status: status === 'active' ? ['DRAFT', 'PUBLISHED'] : [status],
    therapyTypeId: therapyTypeId === 'all' ? undefined : therapyTypeId,
  });
  const create = can('assessment_templates.create') && (
    <Button onClick={() => setCreating(true)}>
      <FilePlus2 /> New template
    </Button>
  );
  return (
    <RequirePermission permission="assessment_templates.read">
      <SectionHeader
        title="Assessment templates"
        description="The forms therapists fill in, one or more per therapy. Published versions never change; editing starts a new version."
        actions={create}
      />
      <DataTable
        label="Assessment templates"
        columns={columns}
        data={data}
        loading={isFetching}
        error={error}
        onRetry={() => void refetch()}
        getRowId={(t) => t.id}
        rowHref={(t) => assessmentLinks.template(t.id)}
        toolbar={
          <FilterBar>
            <Select value={therapyTypeId} onValueChange={setTherapyTypeId}>
              <SelectTrigger size="sm" className="w-full sm:w-44" aria-label="Filter by therapy">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All therapies</SelectItem>
                {types.data?.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
              <SelectTrigger size="sm" className="w-full sm:w-40" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">In use and drafts</SelectItem>
                {Object.entries(TEMPLATE_STATUSES).map(([value, s]) => (
                  <SelectItem key={value} value={value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterBar>
        }
        empty={
          <EmptyState
            icon={FileText}
            title="No templates here"
            description="Create a template for each kind of assessment your therapists do. Start from the general form or a blank one."
            action={create}
          />
        }
      />
      {creating && <NewTemplateDialog open onOpenChange={setCreating} />}
    </RequirePermission>
  );
}
