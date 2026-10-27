'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CopyPlus,
  FileSearch,
  Pencil,
  Plus,
  Rocket,
  Save,
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
  DialogFooter,
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
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  useTemplate,
  useTemplateAction,
  useTemplateVersion,
  useTemplateVersions,
  useUpdateTemplate,
} from '@/lib/api/assessments';
import { isApiError } from '@/lib/api/client';
import { useTherapyTypeList } from '@/lib/api/therapy-types';
import { formatDate } from '@/lib/format';
import { useUnsavedChanges } from '@/lib/hooks/use-unsaved-changes';
import type {
  AnswerValue,
  AssessmentKind,
  AssessmentTemplateDetail,
  TemplateDefinition,
  TemplateField,
  TemplateFieldType,
  TemplateSection,
} from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  ASSESSMENT_KINDS,
  FIELD_TYPES,
  TemplateStatusBadge,
  assessmentLinks,
} from '../../assessments/assessment-display';
import { SectionFields, type DraftAnswers } from '../../assessments/dynamic-form';

const CHOICE_TYPES: TemplateFieldType[] = ['SINGLE_SELECT', 'MULTI_SELECT', 'RADIO'];
const MAX = { sections: 30, fields: 200, options: 50 };

/** "Fine motor skills" → "fine_motor_skills", unique among `taken`. */
function slug(label: string, taken: Set<string>, prefix: string, needsLetter = true) {
  let base = label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  if (!base || (needsLetter && !/^[a-z]/.test(base))) base = `${prefix}${base ? `_${base}` : ''}`;
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base.slice(0, 34)}_${n}`;
  return key;
}

function keysOf(...definitions: (TemplateDefinition | undefined | null)[]) {
  const fields = new Set<string>();
  const sections = new Set<string>();
  for (const d of definitions) {
    for (const s of d?.sections ?? []) {
      sections.add(s.key);
      for (const f of s.fields) fields.add(f.key);
    }
  }
  return { fields, sections };
}

function move<T>(list: T[], from: number, to: number) {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** "definition.sections.1.fields.0.options" → "Functional assessment › Observations: …" */
export function describeErrors(errors: Record<string, string>, d: TemplateDefinition) {
  return Object.entries(errors).map(([path, message]) => {
    const m = /sections\.(\d+)(?:\.fields\.(\d+))?/.exec(path);
    const section = m ? d.sections[Number(m[1])] : undefined;
    const field = m?.[2] !== undefined ? section?.fields[Number(m[2])] : undefined;
    const where = [section?.title, field?.label].filter(Boolean).join(' › ');
    return where ? `${where}: ${message}` : message;
  });
}

// ── Field editor ────────────────────────────────────────────────────────────

interface OptionRow {
  value: string;
  label: string;
}

function numberOrUndefined(v: string) {
  return v.trim() === '' || !Number.isFinite(Number(v)) ? undefined : Number(v);
}

/**
 * Edits one field. New fields get a stable identifier from their first label; it never
 * changes afterwards, so answers stay attached to the same question across versions.
 */
function FieldDialog({
  field,
  takenKeys,
  lockedType,
  noun,
  onSave,
  onClose,
}: {
  /** Null: a new field */
  field: TemplateField | null;
  /** What the form fills in, e.g. "assessments" */
  noun: string;
  takenKeys: Set<string>;
  /** The type of this field in a published version, which it must keep */
  lockedType?: TemplateFieldType;
  onSave: (field: TemplateField) => void;
  onClose: () => void;
}) {
  const [label, setLabel] = React.useState(field?.label ?? '');
  const [type, setType] = React.useState<TemplateFieldType>(field?.type ?? 'TEXTAREA');
  const [helpText, setHelpText] = React.useState(field?.helpText ?? '');
  const [placeholder, setPlaceholder] = React.useState(field?.placeholder ?? '');
  const [required, setRequired] = React.useState(field?.required ?? false);
  const [options, setOptions] = React.useState<OptionRow[]>(
    field?.options ?? [
      { value: '', label: '' },
      { value: '', label: '' },
    ],
  );
  const v = field?.validation ?? {};
  const [minLength, setMinLength] = React.useState(v.minLength?.toString() ?? '');
  const [maxLength, setMaxLength] = React.useState(v.maxLength?.toString() ?? '');
  const [min, setMin] = React.useState(v.min?.toString() ?? '');
  const [max, setMax] = React.useState(v.max?.toString() ?? '');
  const [integer, setInteger] = React.useState(v.integer ?? false);
  const [maxSelections, setMaxSelections] = React.useState(v.maxSelections?.toString() ?? '');
  const [defaultValue, setDefaultValue] = React.useState<AnswerValue | undefined>(
    field?.defaultValue,
  );
  const [error, setError] = React.useState<string | null>(null);

  const choice = CHOICE_TYPES.includes(type);
  const textual = type === 'TEXT' || type === 'TEXTAREA';

  const save = () => {
    if (!label.trim()) return setError('Give the field a label.');
    const rows = options.map((o) => ({ ...o, label: o.label.trim() })).filter((o) => o.label);
    if (choice && rows.length < 2) return setError('Add at least 2 options.');
    if (choice && new Set(rows.map((o) => o.label.toLowerCase())).size !== rows.length) {
      return setError('Each option needs a different label.');
    }
    // Existing options keep their stored value; new ones get one from their label.
    const values = new Set(rows.filter((o) => o.value).map((o) => o.value));
    const finalOptions = rows.map((o) => {
      if (o.value) return o;
      const value = slug(o.label, values, 'option', false);
      values.add(value);
      return { value, label: o.label };
    });
    const validation = textual
      ? { minLength: numberOrUndefined(minLength), maxLength: numberOrUndefined(maxLength) }
      : type === 'NUMBER'
        ? {
            min: numberOrUndefined(min),
            max: numberOrUndefined(max),
            integer: integer || undefined,
          }
        : type === 'MULTI_SELECT'
          ? { maxSelections: numberOrUndefined(maxSelections) }
          : {};
    const cleanValidation = Object.fromEntries(
      Object.entries(validation).filter(([, x]) => x !== undefined),
    );
    const validDefault =
      defaultValue === undefined || defaultValue === '' || type === 'DATE'
        ? undefined
        : choice
          ? Array.isArray(defaultValue)
            ? defaultValue.filter((d) => finalOptions.some((o) => o.value === d))
            : finalOptions.some((o) => o.value === defaultValue)
              ? defaultValue
              : undefined
          : type === 'NUMBER'
            ? typeof defaultValue === 'number'
              ? defaultValue
              : undefined
            : type === 'CHECKBOX'
              ? defaultValue === true || undefined
              : typeof defaultValue === 'string'
                ? defaultValue
                : undefined;
    onSave({
      key: field?.key ?? slug(label, takenKeys, 'field'),
      type,
      label: label.trim(),
      ...(helpText.trim() && { helpText: helpText.trim() }),
      ...((textual || type === 'NUMBER') &&
        placeholder.trim() && { placeholder: placeholder.trim() }),
      required,
      ...(choice && { options: finalOptions }),
      ...(Object.keys(cleanValidation).length && { validation: cleanValidation }),
      ...(validDefault !== undefined &&
        !(Array.isArray(validDefault) && validDefault.length === 0) && {
          defaultValue: validDefault,
        }),
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{field ? 'Edit field' : 'Add field'}</DialogTitle>
          <DialogDescription>
            {field
              ? `Identifier: ${field.key} (stays the same across versions)`
              : 'Labels and options are plain text.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Label" required>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={200}
              autoFocus
            />
          </Field>
          <Field
            label="Field type"
            required
            helper={
              lockedType
                ? 'Published versions use this type, so it can’t change. Add a new field instead.'
                : FIELD_TYPES[type].description
            }
          >
            <Select
              value={type}
              onValueChange={(t) => {
                setType(t as TemplateFieldType);
                setDefaultValue(undefined);
              }}
              disabled={Boolean(lockedType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(FIELD_TYPES) as TemplateFieldType[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {FIELD_TYPES[t].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Help text" optional>
            <Input value={helpText} onChange={(e) => setHelpText(e.target.value)} maxLength={500} />
          </Field>
          {(textual || type === 'NUMBER') && (
            <Field label="Placeholder" optional>
              <Input
                value={placeholder}
                onChange={(e) => setPlaceholder(e.target.value)}
                maxLength={200}
              />
            </Field>
          )}
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
            <span>
              <span className="font-medium">Required to complete</span>
              <span className="block text-xs text-muted-foreground">
                Drafts can still be saved without it.
                {type === 'CHECKBOX' && ' A required checkbox must be checked.'}
              </span>
            </span>
            <Switch checked={required} onCheckedChange={setRequired} />
          </label>

          {choice && (
            <div className="grid gap-2">
              <span className="text-sm font-medium">Options</span>
              {options.map((o, i) => (
                <div key={i} className="flex items-center gap-1">
                  <Input
                    value={o.label}
                    onChange={(e) =>
                      setOptions(
                        options.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                      )
                    }
                    maxLength={120}
                    aria-label={`Option ${i + 1}`}
                    placeholder={`Option ${i + 1}`}
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Move up"
                    disabled={i === 0}
                    onClick={() => setOptions(move(options, i, i - 1))}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Move down"
                    disabled={i === options.length - 1}
                    onClick={() => setOptions(move(options, i, i + 1))}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    variant="danger-ghost"
                    size="icon-sm"
                    aria-label={`Remove option ${i + 1}`}
                    onClick={() => setOptions(options.filter((_, j) => j !== i))}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <Button
                variant="secondary"
                size="sm"
                className="w-fit"
                disabled={options.length >= MAX.options}
                onClick={() => setOptions([...options, { value: '', label: '' }])}
              >
                <Plus /> Add option
              </Button>
            </div>
          )}

          {textual && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Minimum characters" optional>
                <Input
                  inputMode="numeric"
                  value={minLength}
                  onChange={(e) => setMinLength(e.target.value)}
                />
              </Field>
              <Field
                label="Maximum characters"
                optional
                helper={type === 'TEXT' ? 'Default 500' : 'Default 5,000'}
              >
                <Input
                  inputMode="numeric"
                  value={maxLength}
                  onChange={(e) => setMaxLength(e.target.value)}
                />
              </Field>
            </div>
          )}
          {type === 'NUMBER' && (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Minimum" optional>
                <Input inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} />
              </Field>
              <Field label="Maximum" optional>
                <Input inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} />
              </Field>
              <label className="flex items-end gap-2 pb-2 text-sm">
                <Switch checked={integer} onCheckedChange={setInteger} />
                Whole numbers
              </label>
            </div>
          )}
          {type === 'MULTI_SELECT' && (
            <Field label="Most choices allowed" optional>
              <Input
                inputMode="numeric"
                value={maxSelections}
                onChange={(e) => setMaxSelections(e.target.value)}
                className="max-w-32"
              />
            </Field>
          )}

          {type !== 'DATE' && type !== 'MULTI_SELECT' && (
            <Field
              label="Default answer"
              optional
              helper={`Filled in on new ${noun}; the therapist can change it.`}
            >
              {choice ? (
                <Select
                  value={typeof defaultValue === 'string' ? defaultValue : 'none'}
                  onValueChange={(d) => setDefaultValue(d === 'none' ? undefined : d)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No default</SelectItem>
                    {options
                      .filter((o) => o.value && o.label.trim())
                      .map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              ) : type === 'CHECKBOX' ? (
                <Switch
                  checked={defaultValue === true}
                  onCheckedChange={(c) => setDefaultValue(c || undefined)}
                />
              ) : (
                <Input
                  inputMode={type === 'NUMBER' ? 'decimal' : undefined}
                  value={defaultValue === undefined ? '' : String(defaultValue)}
                  onChange={(e) =>
                    setDefaultValue(
                      type === 'NUMBER'
                        ? numberOrUndefined(e.target.value)
                        : e.target.value || undefined,
                    )
                  }
                />
              )}
            </Field>
          )}
          {error && <p className="text-sm text-danger-foreground">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save}>{field ? 'Save field' : 'Add field'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Read-only outline ───────────────────────────────────────────────────────

export function FormOutline({ definition }: { definition: TemplateDefinition }) {
  if (!definition.sections.length) {
    return <p className="text-[13px] text-muted-foreground">This form has no sections.</p>;
  }
  return (
    <ol className="grid gap-5">
      {definition.sections.map((s, i) => (
        <li key={s.key} className="grid gap-2">
          <p className="text-card-title">
            {i + 1}. {s.title}
          </p>
          {s.description && <p className="text-[13px] text-muted-foreground">{s.description}</p>}
          <ul className="grid gap-1.5 border-l border-border pl-4">
            {s.fields.map((f) => (
              <li key={f.key} className="text-sm">
                {f.label}
                <span className="text-muted-foreground"> · {FIELD_TYPES[f.type].label}</span>
                {f.required && <span className="text-danger-foreground"> · required</span>}
                {f.options && (
                  <span className="block text-xs text-muted-foreground">
                    {f.options.map((o) => o.label).join(', ')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

// ── Builder ─────────────────────────────────────────────────────────────────

/**
 * Edits a draft form: sections, fields, options, order. Shared by assessment and session
 * note templates; `published` is the form in use, whose fields must keep their types.
 */
export function FormBuilder({
  published,
  definition,
  setDefinition,
  errors,
  noun = 'assessments',
}: {
  published: TemplateDefinition | undefined;
  definition: TemplateDefinition;
  setDefinition: (d: TemplateDefinition) => void;
  errors: string[];
  /** What the form fills in, e.g. "assessments" or "session notes" */
  noun?: string;
}) {
  const [selected, setSelected] = React.useState(0);
  const [editing, setEditing] = React.useState<{
    field: TemplateField | null;
    index: number;
  } | null>(null);
  const [removing, setRemoving] = React.useState<number | null>(null);
  const sections = definition.sections;
  const current = sections[Math.min(selected, sections.length - 1)] as TemplateSection | undefined;
  const sectionIndex = Math.min(selected, sections.length - 1);
  const publishedTypes = new Map(
    (published?.sections ?? []).flatMap((s) => s.fields.map((f) => [f.key, f.type] as const)),
  );
  const fieldCount = sections.reduce((n, s) => n + s.fields.length, 0);

  const setSections = (next: TemplateSection[]) => setDefinition({ sections: next });
  const updateSection = (i: number, patch: Partial<TemplateSection>) =>
    setSections(sections.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const addSection = () => {
    const title = `Section ${sections.length + 1}`;
    setSections([
      ...sections,
      { key: slug(title, keysOf(definition, published).sections, 'section'), title, fields: [] },
    ]);
    setSelected(sections.length);
  };

  return (
    <div className="grid gap-4">
      {errors.length > 0 && (
        <div
          role="alert"
          className="rounded-xl border border-danger/30 bg-danger-subtle p-4 text-sm text-danger-foreground"
        >
          <p className="font-medium">Fix these before publishing:</p>
          <ul className="mt-1 list-disc pl-5">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Sections</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {sections.length === 0 && (
              <p className="text-[13px] text-muted-foreground">Add a section to start the form.</p>
            )}
            <ol className="grid gap-1">
              {sections.map((s, i) => (
                <li key={s.key} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setSelected(i)}
                    aria-current={i === sectionIndex ? 'true' : undefined}
                    className={cn(
                      'flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-ring',
                      i === sectionIndex &&
                        'bg-primary-subtle font-medium text-primary-subtle-foreground',
                    )}
                  >
                    <span className="truncate">{s.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular">
                      {s.fields.length}
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Move ${s.title} up`}
                    disabled={i === 0}
                    onClick={() => {
                      setSections(move(sections, i, i - 1));
                      setSelected(i - 1);
                    }}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Move ${s.title} down`}
                    disabled={i === sections.length - 1}
                    onClick={() => {
                      setSections(move(sections, i, i + 1));
                      setSelected(i + 1);
                    }}
                  >
                    <ArrowDown />
                  </Button>
                </li>
              ))}
            </ol>
            <Button
              variant="secondary"
              size="sm"
              onClick={addSection}
              disabled={sections.length >= MAX.sections}
            >
              <Plus /> Add section
            </Button>
          </CardContent>
        </Card>

        {current ? (
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
              <CardTitle>Section details and fields</CardTitle>
              <Button variant="danger-ghost" size="sm" onClick={() => setRemoving(sectionIndex)}>
                <Trash2 /> Remove section
              </Button>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Section title" required>
                  <Input
                    value={current.title}
                    onChange={(e) => updateSection(sectionIndex, { title: e.target.value })}
                    maxLength={120}
                  />
                </Field>
                <Field label="Description" optional>
                  <Input
                    value={current.description ?? ''}
                    onChange={(e) =>
                      updateSection(sectionIndex, { description: e.target.value || undefined })
                    }
                    maxLength={500}
                  />
                </Field>
              </div>
              <ol className="grid gap-2">
                {current.fields.length === 0 && (
                  <p className="rounded-lg border border-dashed border-border p-4 text-center text-[13px] text-muted-foreground">
                    No fields yet.
                  </p>
                )}
                {current.fields.map((f, i) => {
                  const setFields = (fields: TemplateField[]) =>
                    updateSection(sectionIndex, { fields });
                  return (
                    <li
                      key={f.key}
                      className="flex items-center gap-2 rounded-lg border border-border p-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {f.label}
                          {f.required && (
                            <span className="text-danger" aria-label="required">
                              {' '}
                              *
                            </span>
                          )}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {FIELD_TYPES[f.type].label}
                          {f.options && ` · ${f.options.length} options`}
                          {publishedTypes.has(f.key) ? '' : ' · new'}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Move ${f.label} up`}
                        disabled={i === 0}
                        onClick={() => setFields(move(current.fields, i, i - 1))}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Move ${f.label} down`}
                        disabled={i === current.fields.length - 1}
                        onClick={() => setFields(move(current.fields, i, i + 1))}
                      >
                        <ArrowDown />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Edit ${f.label}`}
                        onClick={() => setEditing({ field: f, index: i })}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="danger-ghost"
                        size="icon-sm"
                        aria-label={`Remove ${f.label}`}
                        onClick={() => setFields(current.fields.filter((_, j) => j !== i))}
                      >
                        <Trash2 />
                      </Button>
                    </li>
                  );
                })}
              </ol>
              <Button
                variant="secondary"
                size="sm"
                className="w-fit"
                disabled={fieldCount >= MAX.fields}
                onClick={() => setEditing({ field: null, index: current.fields.length })}
              >
                <Plus /> Add field
              </Button>
              <p className="text-xs text-muted-foreground">
                Removing a field only affects this version. {noun[0].toUpperCase() + noun.slice(1)}{' '}
                filled in with earlier versions keep their answers.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <EmptyState
              title="No sections yet"
              description="A section groups related questions, e.g. “General information”."
              action={
                <Button size="sm" onClick={addSection}>
                  <Plus /> Add section
                </Button>
              }
            />
          </Card>
        )}
      </div>

      {editing && current && (
        <FieldDialog
          field={editing.field}
          noun={noun}
          takenKeys={keysOf(definition, published).fields}
          lockedType={editing.field ? publishedTypes.get(editing.field.key) : undefined}
          onClose={() => setEditing(null)}
          onSave={(field) => {
            const fields = [...current.fields];
            fields.splice(editing.index, editing.field ? 1 : 0, field);
            updateSection(sectionIndex, { fields });
            setEditing(null);
          }}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remove this section?"
        description={
          removing !== null && sections[removing]?.fields.length
            ? `Its ${sections[removing].fields.length} field(s) go too. Earlier published versions are not affected.`
            : 'Earlier published versions are not affected.'
        }
        confirmLabel="Remove section"
        tone="danger"
        onConfirm={() => {
          if (removing !== null) setSections(sections.filter((_, j) => j !== removing));
          setSelected((s) => Math.max(0, s - 1));
          setRemoving(null);
        }}
      />
    </div>
  );
}

export function FormPreview({
  definition,
  note = 'Every assessment also has a clinical summary, recommendations and initial goals after these sections.',
}: {
  definition: TemplateDefinition;
  /** What the record has besides the form */
  note?: string;
}) {
  const [values, setValues] = React.useState<DraftAnswers>({});
  return (
    <div className="grid gap-4">
      <p className="text-[13px] text-muted-foreground">
        How therapists will see the form. Nothing you enter here is saved. {note}
      </p>
      {definition.sections.map((s) => (
        <Card key={s.key}>
          <CardHeader>
            <CardTitle>{s.title}</CardTitle>
            {s.description && <p className="text-[13px] text-muted-foreground">{s.description}</p>}
          </CardHeader>
          <CardContent>
            <SectionFields
              section={s}
              values={values}
              onChange={(k, v) => setValues((x) => ({ ...x, [k]: v }))}
            />
          </CardContent>
        </Card>
      ))}
      {definition.sections.length === 0 && (
        <Card>
          <EmptyState compact title="Nothing to preview yet" />
        </Card>
      )}
    </div>
  );
}

function Versions({ template }: { template: AssessmentTemplateDetail }) {
  const versions = useTemplateVersions(template.id);
  const [open, setOpen] = React.useState<string | null>(null);
  const version = useTemplateVersion(template.id, open);
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
                · {v.fieldCount} fields · {v.assessmentCount} assessment
                {v.assessmentCount === 1 ? '' : 's'}
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
            <DialogDescription>
              The form exactly as assessments filled in with it see it.
            </DialogDescription>
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

function Details({ template }: { template: AssessmentTemplateDetail }) {
  const update = useUpdateTemplate();
  const types = useTherapyTypeList({ status: 'all' });
  const [name, setName] = React.useState(template.name);
  const [description, setDescription] = React.useState(template.description ?? '');
  const [purpose, setPurpose] = React.useState<AssessmentKind | 'any'>(template.purpose ?? 'any');
  const [therapyTypeId, setTherapyTypeId] = React.useState(template.therapyType.id);
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
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Therapy"
            required
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
                {types.data
                  ?.filter((t) => t.isActive || t.id === template.therapyType.id)
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
          <Field label="Used for" optional>
            <Select
              value={purpose}
              onValueChange={(v) => setPurpose(v as AssessmentKind | 'any')}
              disabled={!editable}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any assessment type</SelectItem>
                {Object.entries(ASSESSMENT_KINDS).map(([value, l]) => (
                  <SelectItem key={value} value={value}>
                    {l}
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
                    purpose: purpose === 'any' ? null : purpose,
                    ...(!template.published && { therapyTypeId }),
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

type Action = 'startVersion' | 'discardDraft' | 'publish' | 'archive' | 'restore';

function TemplateBuilder({ template: t }: { template: AssessmentTemplateDetail }) {
  const router = useRouter();
  const update = useUpdateTemplate();
  const action = useTemplateAction();
  const [tab, setTab] = React.useState('form');
  const saved = t.draft?.definition ?? null;
  const [definition, setDefinition] = React.useState<TemplateDefinition | null>(saved);
  const [confirm, setConfirm] = React.useState<Action | null>(null);
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

  const run = (a: Action) =>
    action.mutate(
      { id: t.id, action: a },
      {
        onSuccess: (result) => {
          setConfirm(null);
          if ('deleted' in result) {
            toast.success('Template deleted');
            router.push(assessmentLinks.templates);
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

  const shown = definition ?? t.published?.definition ?? { sections: [] };
  const confirmText: Record<
    Action,
    { title: string; description: string; label: string; danger?: boolean }
  > = {
    publish: {
      title: `Publish version ${t.draft?.version ?? ''}?`,
      description:
        'New assessments will use this form. It can’t be edited after publishing; changes go into a new version. Existing assessments keep the version they were filled in with.',
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
        : 'It was never published, so no assessment uses it.',
      label: t.published ? 'Discard draft' : 'Delete template',
      danger: true,
    },
    archive: {
      title: 'Archive this template?',
      description:
        'It can’t be chosen for new assessments. Existing assessments stay readable with their form.',
      label: 'Archive',
      danger: true,
    },
    restore: {
      title: 'Restore this template?',
      description: 'It can be used for new assessments again.',
      label: 'Restore',
    },
  };

  return (
    <div className="animate-in grid gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-1">
          <Link
            href={assessmentLinks.templates}
            className="inline-flex items-center gap-1.5 rounded text-[13px] text-muted-foreground hover:text-foreground focus-ring"
          >
            <ArrowLeft className="size-3.5" aria-hidden /> Assessment templates
          </Link>
          <h2 className="text-section-title">{t.name}</h2>
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
            <TemplateStatusBadge status={t.status} />
            <span className="inline-flex items-center gap-1.5">
              <ColorDot color={t.therapyType.color} />
              {t.therapyType.name}
            </span>
            <span>· {t.purpose ? ASSESSMENT_KINDS[t.purpose] : 'Any assessment type'}</span>
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
          <FormPreview key={JSON.stringify(shown)} definition={shown} />
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
          loading={action.isPending}
          onConfirm={() => run(confirm)}
        />
      )}
    </div>
  );
}

function TemplatePage() {
  const { id } = useParams<{ id: string }>();
  const query = useTemplate(id);
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
                <Link href={assessmentLinks.templates}>Back to templates</Link>
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

export function TemplateBuilderScreen() {
  return (
    <RequirePermission permission="assessment_templates.read">
      <TemplatePage />
    </RequirePermission>
  );
}
