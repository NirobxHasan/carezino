'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FilePlus2, NotebookPen } from 'lucide-react';

import { RequirePermission } from '@/components/auth/require-permission';
import { DataTable, type ColumnDef } from '@/components/data-table/data-table';
import { FilterBar } from '@/components/data-table/filter-bar';
import { EmptyState } from '@/components/feedback/states';
import { ColorDot } from '@/components/forms/color-picker';
import { Field } from '@/components/forms/field';
import { SectionHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
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
import { isApiError } from '@/lib/api/client';
import { useCreateNoteTemplate, useNoteTemplateList } from '@/lib/api/sessions';
import { useTherapyTypeList } from '@/lib/api/therapy-types';
import { formatDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { NoteTemplateItem, SessionNoteTemplateStatus } from '@/lib/types';
import { TEMPLATE_STATUSES, TemplateStatusBadge } from '../../assessments/assessment-display';
import { sessionLinks } from '../../sessions/session-display';

const GENERAL = 'general';

function NewTemplateDialog({ onOpenChange }: { onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const types = useTherapyTypeList({ status: 'ACTIVE' });
  const create = useCreateNoteTemplate();
  const [name, setName] = React.useState('');
  const [therapyTypeId, setTherapyTypeId] = React.useState(GENERAL);
  const [description, setDescription] = React.useState('');
  const [start, setStart] = React.useState<'starter' | 'blank'>('starter');
  const errors = isApiError(create.error) ? (create.error.errors ?? {}) : {};
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New session note template</DialogTitle>
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
              placeholder="e.g. ABA session note"
            />
          </Field>
          <Field
            label="Therapy"
            error={errors.therapyTypeId}
            helper="A general template can be used for any therapy without its own."
          >
            <Select value={therapyTypeId} onValueChange={setTherapyTypeId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={GENERAL}>General: every therapy</SelectItem>
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
              title="Standard session note"
              description="Activities, observations, next plan and comments, to adapt."
            />
            <RadioCard value="blank" title="Blank form" description="Add your own sections." />
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
            disabled={!name.trim()}
            onClick={() =>
              create.mutate(
                {
                  name: name.trim(),
                  therapyTypeId: therapyTypeId === GENERAL ? null : therapyTypeId,
                  description: description.trim(),
                  starter: start === 'starter',
                },
                {
                  onSuccess: (t) => {
                    toast.success('Template created');
                    router.push(sessionLinks.template(t.id));
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

const columns: ColumnDef<NoteTemplateItem, unknown>[] = [
  {
    id: 'name',
    header: 'Template',
    cell: ({ row }) => (
      <span className="flex min-w-0 flex-col">
        <Link
          href={sessionLinks.template(row.original.id)}
          className="flex items-center gap-2 truncate rounded font-medium hover:underline focus-ring"
        >
          {row.original.name}
          {row.original.isDefault && <Badge tone="primary">Default</Badge>}
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
    cell: ({ row }) =>
      row.original.therapyType ? (
        <span className="inline-flex items-center gap-1.5 text-[13px]">
          <ColorDot color={row.original.therapyType.color} />
          {row.original.therapyType.name}
        </span>
      ) : (
        <span className="text-[13px] text-muted-foreground">General</span>
      ),
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
    header: 'Notes',
    meta: { className: 'hidden lg:table-cell tabular text-[13px]' },
    cell: ({ row }) => row.original.noteCount,
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

/**
 * Session note templates: general ones and ones for a single therapy, with one default
 * each. The same form builder as assessments; published versions never change.
 */
export function NoteTemplatesScreen() {
  const { can } = useSession();
  const [status, setStatus] = React.useState<SessionNoteTemplateStatus | 'active'>('active');
  const [creating, setCreating] = React.useState(false);
  const { data, isFetching, error, refetch } = useNoteTemplateList({
    status: status === 'active' ? ['DRAFT', 'PUBLISHED'] : [status],
  });
  const create = can('session_note_templates.manage') && (
    <Button onClick={() => setCreating(true)}>
      <FilePlus2 /> New template
    </Button>
  );
  return (
    <RequirePermission permission="session_note_templates.read">
      <SectionHeader
        title="Session note templates"
        description="The forms therapists document sessions with: general ones, or one per therapy. Goal progress from the patient’s plan is added to every note."
        actions={create}
      />
      <DataTable
        label="Session note templates"
        columns={columns}
        data={data}
        loading={isFetching}
        error={error}
        onRetry={() => void refetch()}
        getRowId={(t) => t.id}
        rowHref={(t) => sessionLinks.template(t.id)}
        toolbar={
          <FilterBar>
            <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
              <SelectTrigger size="sm" className="w-full sm:w-44" aria-label="Filter by status">
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
            icon={NotebookPen}
            title="No note templates here"
            description="The first session note creates the standard template automatically. Create your own to change what therapists record."
            action={create}
          />
        }
      />
      {creating && <NewTemplateDialog onOpenChange={setCreating} />}
    </RequirePermission>
  );
}
