'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  CopyPlus,
  FileSearch,
  Rocket,
  Save,
  Star,
  Trash2,
} from 'lucide-react';

import { RequirePermission } from '@/components/auth/require-permission';
import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/feedback/states';
import { ColorDot } from '@/components/forms/color-picker';
import { Field } from '@/components/forms/field';
import { useBreadcrumbLabel } from '@/components/layout/breadcrumbs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { isApiError } from '@/lib/api/client';
import {
  useNoteTemplate,
  useNoteTemplateAction,
  useNoteTemplateVersion,
  useNoteTemplateVersions,
  useUpdateNoteTemplate,
  type NoteTemplateAction,
} from '@/lib/api/sessions';
import { useTherapyTypeList } from '@/lib/api/therapy-types';
import { formatDate } from '@/lib/format';
import { useUnsavedChanges } from '@/lib/hooks/use-unsaved-changes';
import type { NoteTemplateDetail, TemplateDefinition } from '@/lib/types';
import { TemplateStatusBadge } from '../../assessments/assessment-display';
import { sessionLinks } from '../../sessions/session-display';
import {
  FormBuilder,
  FormOutline,
  FormPreview,
  describeErrors,
} from '../assessment-templates/template-builder';

const NOUN = 'session notes';
const PREVIEW_NOTE =
  'Every note also has goal progress from the patient’s therapy plan, shown before a “Next plan” section if the form has one (key next_plan), otherwise at the end.';
const GENERAL = 'general';

function Versions({ template }: { template: NoteTemplateDetail }) {
  const versions = useNoteTemplateVersions(template.id);
  const [open, setOpen] = React.useState<string | null>(null);
  const version = useNoteTemplateVersion(template.id, open);
  if (versions.isPending) return <Skeleton className="h-40 w-full" />;
  if (versions.error)
    return <ErrorState error={versions.error} onRetry={() => void versions.refetch()} />;
  const label = { DRAFT: 'Draft', PUBLISHED: 'In use', SUPERSEDED: 'Replaced' } as const;
  return (
    <Card>
      <CardContent className="pt-6">
        <ol className="grid gap-2">
          {versions.data.map((v) => (
            <li
              key={v.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3 text-sm"
            >
              <span className="font-medium">Version {v.version}</span>
              <Badge
                tone={
                  v.status === 'PUBLISHED'
                    ? 'success'
                    : v.status === 'DRAFT'
                      ? 'warning'
                      : 'neutral'
                }
              >
                {label[v.status]}
              </Badge>
              <span className="text-[13px] text-muted-foreground">
                {v.publishedAt
                  ? `Published ${formatDate(v.publishedAt)}${v.publishedBy ? ` by ${v.publishedBy.fullName}` : ''}`
                  : `Started ${formatDate(v.createdAt)}`}{' '}
                · {v.fieldCount} fields · {v.noteCount} note{v.noteCount === 1 ? '' : 's'}
              </span>
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setOpen(v.id)}>
                <FileSearch /> View form
              </Button>
            </li>
          ))}
        </ol>
      </CardContent>
      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {version.data ? `Version ${version.data.version}` : 'Version'}
            </DialogTitle>
            <DialogDescription>The form exactly as notes written with it see it.</DialogDescription>
          </DialogHeader>
          {version.data ? (
            <FormOutline definition={version.data.definition} />
          ) : (
            <Skeleton className="h-40 w-full" />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function Details({ template }: { template: NoteTemplateDetail }) {
  const update = useUpdateNoteTemplate();
  const types = useTherapyTypeList({ status: 'all' });
  const [name, setName] = React.useState(template.name);
  const [description, setDescription] = React.useState(template.description ?? '');
  const [therapyTypeId, setTherapyTypeId] = React.useState(template.therapyType?.id ?? GENERAL);
  const errors = isApiError(update.error) ? (update.error.errors ?? {}) : {};
  const editable = template.actions.edit;
  return (
    <Card>
      <CardContent className="grid max-w-2xl gap-4 pt-6">
        <Field label="Template name" required error={errors.name}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            disabled={!editable}
          />
        </Field>
        <Field
          label="Therapy"
          error={errors.therapyTypeId}
          helper={template.published ? 'Fixed once a version is published.' : undefined}
        >
          <Select
            value={therapyTypeId}
            onValueChange={setTherapyTypeId}
            disabled={!editable || Boolean(template.published)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={GENERAL}>General: every therapy</SelectItem>
              {types.data
                ?.filter((t) => t.isActive || t.id === template.therapyType?.id)
                .map((t) => (
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
            rows={3}
            maxLength={1000}
            disabled={!editable}
          />
        </Field>
        {editable && (
          <Button
            className="w-fit"
            loading={update.isPending}
            onClick={() =>
              update.mutate(
                {
                  id: template.id,
                  input: {
                    name: name.trim(),
                    description: description.trim(),
                    ...(!template.published && {
                      therapyTypeId: therapyTypeId === GENERAL ? null : therapyTypeId,
                    }),
                  },
                },
                {
                  onSuccess: () => toast.success('Template details saved'),
                  onError: (e) => !(isApiError(e) && e.errors) && toast.error(e.message),
                },
              )
            }
          >
            <Save /> Save details
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

type Confirm = NoteTemplateAction | 'makeDefault';

function TemplateBuilder({ template: t }: { template: NoteTemplateDetail }) {
  const router = useRouter();
  const update = useUpdateNoteTemplate();
  const action = useNoteTemplateAction();
  const [tab, setTab] = React.useState('form');
  const saved = t.draft?.definition ?? null;
  const [definition, setDefinition] = React.useState<TemplateDefinition | null>(saved);
  const [confirm, setConfirm] = React.useState<Confirm | null>(null);
  const [publishErrors, setPublishErrors] = React.useState<string[]>([]);
  // A new draft (started, published or discarded elsewhere) replaces the local copy.
  const [draftId, setDraftId] = React.useState(t.draft?.id);
  if (draftId !== t.draft?.id) {
    setDraftId(t.draft?.id);
    setDefinition(saved);
    setPublishErrors([]);
  }
  const editing = Boolean(t.draft && t.actions.edit && definition);
  const dirty = editing && JSON.stringify(definition) !== JSON.stringify(saved);
  useUnsavedChanges(dirty);

  const saveDraft = (then?: () => void) =>
    update.mutate(
      { id: t.id, input: { definition: definition! } },
      {
        onSuccess: () => {
          setPublishErrors([]);
          if (then) then();
          else toast.success('Draft saved');
        },
        onError: (e) => {
          if (isApiError(e) && e.errors) setPublishErrors(describeErrors(e.errors, definition!));
          toast.error(e.message);
        },
      },
    );

  const run = (a: Confirm) => {
    if (a === 'makeDefault') {
      update.mutate(
        { id: t.id, input: { isDefault: true } },
        {
          onSuccess: () => {
            setConfirm(null);
            toast.success('Default template set');
          },
          onError: (e) => {
            setConfirm(null);
            toast.error(e.message);
          },
        },
      );
      return;
    }
    action.mutate(
      { id: t.id, action: a },
      {
        onSuccess: (result) => {
          setConfirm(null);
          if ('deleted' in result) {
            toast.success('Template deleted');
            router.push(sessionLinks.templates);
            return;
          }
          toast.success(
            {
              startVersion: `Version ${result.draft?.version} started`,
              discardDraft: 'Draft discarded',
              publish: `Version ${result.published?.version} published`,
              archive: 'Template archived',
              restore: 'Template restored',
            }[a],
          );
          setPublishErrors([]);
        },
        onError: (e) => {
          setConfirm(null);
          if (isApiError(e) && e.errors && definition)
            setPublishErrors(describeErrors(e.errors, definition));
          toast.error(e.message);
        },
      },
    );
  };

  const shown = definition ?? t.published?.definition ?? { sections: [] };
  const scope = t.therapyType ? t.therapyType.name : 'general notes';
  const confirmText: Record<
    Confirm,
    { title: string; description: string; label: string; danger?: boolean }
  > = {
    publish: {
      title: `Publish version ${t.draft?.version ?? ''}?`,
      description:
        'New notes will use this form. It can’t be edited after publishing; changes go into a new version. Existing notes keep the version they were written with.',
      label: 'Publish',
    },
    startVersion: {
      title: 'Start a new version?',
      description:
        'A draft copy of the published form opens for editing. The published version stays in use until you publish the new one.',
      label: 'Start new version',
    },
    discardDraft: {
      title: t.published ? 'Discard this draft version?' : 'Delete this template?',
      description: t.published
        ? 'Changes in the draft are lost. The published version stays in use.'
        : 'It was never published, so no note uses it.',
      label: t.published ? 'Discard draft' : 'Delete template',
      danger: true,
    },
    archive: {
      title: 'Archive this template?',
      description:
        'It can’t be chosen for new notes and stops being a default. Existing notes stay readable with their form.',
      label: 'Archive',
      danger: true,
    },
    restore: {
      title: 'Restore this template?',
      description: 'It can be used for new notes again.',
      label: 'Restore',
    },
    makeDefault: {
      title: 'Make this the default?',
      description: `New notes for ${scope} start with this template, unless the therapist picks another. The current default stops being one.`,
      label: 'Make default',
    },
  };

  return (
    <div className="animate-in grid gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-1">
          <Link
            href={sessionLinks.templates}
            className="inline-flex items-center gap-1.5 rounded text-[13px] text-muted-foreground hover:text-foreground focus-ring"
          >
            <ArrowLeft className="size-3.5" aria-hidden /> Session note templates
          </Link>
          <h2 className="text-section-title">{t.name}</h2>
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
            <TemplateStatusBadge status={t.status} />
            {t.isDefault && <Badge tone="primary">Default</Badge>}
            <span className="inline-flex items-center gap-1.5">
              {t.therapyType ? (
                <>
                  <ColorDot color={t.therapyType.color} />
                  {t.therapyType.name}
                </>
              ) : (
                'General: every therapy'
              )}
            </span>
            {t.published && <span>· v{t.published.version} in use</span>}
            {t.draft && (
              <span className="text-warning-foreground">
                · v{t.draft.version} draft{dirty ? ', unsaved changes' : ''}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {editing && (
            <Button
              variant="secondary"
              onClick={() => saveDraft()}
              loading={update.isPending}
              disabled={!dirty}
            >
              <Save /> Save draft
            </Button>
          )}
          {t.actions.publish && (
            <Button
              onClick={() =>
                dirty ? saveDraft(() => setConfirm('publish')) : setConfirm('publish')
              }
            >
              <Rocket /> Publish
            </Button>
          )}
          {t.actions.startVersion && (
            <Button onClick={() => setConfirm('startVersion')}>
              <CopyPlus /> Start new version
            </Button>
          )}
          {t.actions.makeDefault && (
            <Button variant="secondary" onClick={() => setConfirm('makeDefault')}>
              <Star /> Make default
            </Button>
          )}
          {t.actions.discardDraft && (
            <Button variant="danger-ghost" onClick={() => setConfirm('discardDraft')}>
              <Trash2 /> {t.published ? 'Discard draft' : 'Delete'}
            </Button>
          )}
          {t.actions.archive && t.published && (
            <Button variant="ghost" onClick={() => setConfirm('archive')}>
              <Archive /> Archive
            </Button>
          )}
          {t.actions.restore && (
            <Button variant="secondary" onClick={() => setConfirm('restore')}>
              <ArchiveRestore /> Restore
            </Button>
          )}
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="form">Form</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
          <TabsTrigger value="versions">Versions</TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
        </TabsList>
        <TabsContent value="form">
          {editing ? (
            <FormBuilder
              published={t.published?.definition}
              definition={definition!}
              setDefinition={setDefinition}
              errors={publishErrors}
              noun={NOUN}
            />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>{t.published ? `Version ${t.published.version}` : 'Form'}</CardTitle>
                <p className="text-[13px] text-muted-foreground">
                  {t.status === 'ARCHIVED'
                    ? 'Archived: restore the template to change it.'
                    : t.published
                      ? 'Published versions can’t change. Start a new version to edit the form.'
                      : 'Only administrators can edit templates.'}
                </p>
              </CardHeader>
              <CardContent>
                <FormOutline definition={shown} />
              </CardContent>
            </Card>
          )}
        </TabsContent>
        <TabsContent value="preview">
          <FormPreview key={JSON.stringify(shown)} definition={shown} note={PREVIEW_NOTE} />
        </TabsContent>
        <TabsContent value="versions">
          <Versions template={t} />
        </TabsContent>
        <TabsContent value="details">
          <Details key={t.updatedAt} template={t} />
        </TabsContent>
      </Tabs>

      {confirm && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setConfirm(null)}
          title={confirmText[confirm].title}
          description={confirmText[confirm].description}
          confirmLabel={confirmText[confirm].label}
          tone={confirmText[confirm].danger ? 'danger' : 'primary'}
          loading={action.isPending || update.isPending}
          onConfirm={() => run(confirm)}
        />
      )}
    </div>
  );
}

function TemplatePage() {
  const { id } = useParams<{ id: string }>();
  const query = useNoteTemplate(id);
  useBreadcrumbLabel(id, query.data?.name);
  if (query.isPending) return <PageSkeleton />;
  if (query.error) {
    return (
      <Card>
        {isApiError(query.error, 404) || isApiError(query.error, 400) ? (
          <EmptyState
            icon={FileSearch}
            title="Template not found"
            action={
              <Button variant="secondary" size="sm" asChild>
                <Link href={sessionLinks.templates}>Back to templates</Link>
              </Button>
            }
          />
        ) : (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        )}
      </Card>
    );
  }
  return <TemplateBuilder template={query.data} />;
}

export function NoteTemplatePageScreen() {
  return (
    <RequirePermission permission="session_note_templates.read">
      <TemplatePage />
    </RequirePermission>
  );
}
