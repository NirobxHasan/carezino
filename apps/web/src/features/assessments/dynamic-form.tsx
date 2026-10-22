'use client';

import * as React from 'react';
import { AlertCircle } from 'lucide-react';

import { DatePicker } from '@/components/forms/date-picker';
import { Field } from '@/components/forms/field';
import { MultiSelect } from '@/components/forms/searchable-select';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { formatDate } from '@/lib/format';
import type {
  AnswerValue,
  Answers,
  TemplateDefinition,
  TemplateField,
  TemplateSection,
} from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * Renders any template version's form from its definition, and shows answers back.
 * Definitions are data: labels and help text are rendered as plain text, never HTML.
 * The API validates every answer against the same version; the checks here only
 * catch mistakes before a round trip.
 */

/** While typing, a number field may briefly hold text such as "-" or "1." */
export type DraftAnswers = Record<string, AnswerValue | undefined>;

const TEXT_MAX = { TEXT: 500, TEXTAREA: 5000 } as const;

export function isAnswered(value: AnswerValue | undefined) {
  return !(
    value === undefined ||
    value === false ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** Answers as the API expects them: empty ones dropped, text trimmed. */
export function cleanAnswers(definition: TemplateDefinition, values: DraftAnswers): Answers {
  const out: Answers = {};
  for (const field of definition.sections.flatMap((s) => s.fields)) {
    const v = values[field.key];
    if (!isAnswered(v)) continue;
    out[field.key] = typeof v === 'string' && field.type !== 'NUMBER' ? v.trim() : v!;
  }
  return out;
}

function fieldError(field: TemplateField, value: AnswerValue | undefined, complete: boolean) {
  if (!isAnswered(value)) {
    if (!complete || !field.required) return undefined;
    return field.type === 'CHECKBOX'
      ? `“${field.label}” must be checked`
      : `${field.label} is required`;
  }
  const v = field.validation ?? {};
  if (field.type === 'NUMBER') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'Enter a number';
    if (v.integer && !Number.isInteger(value)) return 'Enter a whole number';
    if (v.min !== undefined && value < v.min) return `Enter ${v.min} or more`;
    if (v.max !== undefined && value > v.max) return `Enter ${v.max} or less`;
  }
  if ((field.type === 'TEXT' || field.type === 'TEXTAREA') && typeof value === 'string') {
    const max = v.maxLength ?? TEXT_MAX[field.type];
    if (value.trim().length > max) return `Use up to ${max} characters`;
    if (v.minLength !== undefined && value.trim().length < v.minLength) {
      return `Use at least ${v.minLength} characters`;
    }
  }
  if (field.type === 'MULTI_SELECT' && Array.isArray(value)) {
    if (v.minSelections !== undefined && value.length < v.minSelections) {
      return `Choose at least ${v.minSelections}`;
    }
    if (v.maxSelections !== undefined && value.length > v.maxSelections) {
      return `Choose up to ${v.maxSelections}`;
    }
  }
  return undefined;
}

/** Field key → message, for what the browser can tell before saving. */
export function checkAnswers(
  definition: TemplateDefinition,
  values: DraftAnswers,
  { complete }: { complete: boolean },
) {
  const errors: Record<string, string> = {};
  for (const field of definition.sections.flatMap((s) => s.fields)) {
    const error = fieldError(field, values[field.key], complete);
    if (error) errors[field.key] = error;
  }
  return errors;
}

function NumberInput({
  value,
  onChange,
  field,
  ...props
}: Omit<React.ComponentProps<'input'>, 'value' | 'onChange'> & {
  value: AnswerValue | undefined;
  onChange: (value: AnswerValue | undefined) => void;
  field: TemplateField;
}) {
  // Keep the typed text, so "1." or "-" can be on the way to a number.
  const [text, setText] = React.useState(value === undefined ? '' : String(value));
  const [shown, setShown] = React.useState(value);
  if (shown !== value) {
    setShown(value);
    if (Number(text) !== value) setText(value === undefined ? '' : String(value));
  }
  return (
    <Input
      {...props}
      inputMode={field.validation?.integer ? 'numeric' : 'decimal'}
      value={text}
      placeholder={field.placeholder}
      className="max-w-48 tabular"
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        const trimmed = raw.trim();
        if (trimmed === '') return onChange(undefined);
        const n = Number(trimmed);
        onChange(Number.isFinite(n) && /^-?\d*\.?\d+$|^-?\d+\.?$/.test(trimmed) ? n : trimmed);
      }}
    />
  );
}

/** A labelled group (radio buttons, checkbox), so the label names the whole group. */
function GroupField({
  field,
  error,
  children,
}: {
  field: TemplateField;
  error?: string;
  children: React.ReactNode;
}) {
  const id = React.useId();
  return (
    <fieldset
      className="grid content-start gap-1.5"
      aria-describedby={error ? `${id}-e` : undefined}
    >
      <legend className="mb-1.5 text-sm font-medium">
        {field.label}
        {field.required && (
          <span className="text-danger" aria-hidden>
            *
          </span>
        )}
        {field.required && <span className="sr-only">(required)</span>}
      </legend>
      {children}
      {error ? (
        <p id={`${id}-e`} className="flex items-center gap-1 text-xs text-danger-foreground">
          <AlertCircle className="size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : (
        field.helpText && <p className="text-xs text-muted-foreground">{field.helpText}</p>
      )}
    </fieldset>
  );
}

/** One field's input, for any supported type. */
export function FieldInput({
  field,
  value,
  onChange,
  error,
  disabled,
}: {
  field: TemplateField;
  value: AnswerValue | undefined;
  onChange: (value: AnswerValue | undefined) => void;
  error?: string;
  disabled?: boolean;
}) {
  const options = field.options ?? [];
  switch (field.type) {
    case 'RADIO':
      return (
        <GroupField field={field} error={error}>
          <RadioGroup
            value={typeof value === 'string' ? value : ''}
            onValueChange={(v) => onChange(v)}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            className="flex flex-wrap gap-x-5 gap-y-2"
          >
            {options.map((o) => {
              const id = `${field.key}-${o.value}`;
              return (
                <label key={o.value} htmlFor={id} className="flex items-center gap-2 text-sm">
                  <RadioGroupItem id={id} value={o.value} />
                  {o.label}
                </label>
              );
            })}
          </RadioGroup>
          {typeof value === 'string' && !disabled && (
            <button
              type="button"
              className="w-fit rounded text-xs text-muted-foreground underline-offset-2 hover:underline focus-ring"
              onClick={() => onChange(undefined)}
            >
              Clear answer
            </button>
          )}
        </GroupField>
      );
    case 'CHECKBOX':
      return (
        <GroupField field={field} error={error}>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={value === true}
              disabled={disabled}
              aria-invalid={error ? true : undefined}
              onCheckedChange={(c) => onChange(c === true ? true : undefined)}
            />
            Yes
          </label>
        </GroupField>
      );
  }
  let control: React.ReactElement;
  switch (field.type) {
    case 'TEXT':
      control = (
        <Input
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          maxLength={field.validation?.maxLength ?? TEXT_MAX.TEXT}
          disabled={disabled}
        />
      );
      break;
    case 'TEXTAREA':
      control = (
        <Textarea
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          maxLength={field.validation?.maxLength ?? TEXT_MAX.TEXTAREA}
          rows={4}
          disabled={disabled}
        />
      );
      break;
    case 'NUMBER':
      control = <NumberInput field={field} value={value} onChange={onChange} disabled={disabled} />;
      break;
    case 'SINGLE_SELECT':
      control = (
        <Select
          value={typeof value === 'string' ? value : ''}
          onValueChange={(v) => onChange(v === '__none' ? undefined : v)}
          disabled={disabled}
        >
          <SelectTrigger>
            <SelectValue placeholder="Not recorded" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">
              <span className="text-muted-foreground">Not recorded</span>
            </SelectItem>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
      break;
    case 'MULTI_SELECT':
      control = (
        <MultiSelect
          options={options}
          value={Array.isArray(value) ? value : []}
          onChange={(v) => onChange(v.length ? v : undefined)}
          placeholder="Choose any that apply"
          disabled={disabled}
        />
      );
      break;
    case 'DATE':
      control = (
        <DatePicker
          value={typeof value === 'string' ? value : undefined}
          onChange={(v) => onChange(v)}
          placeholder="Not recorded"
          disabled={disabled}
        />
      );
      break;
  }
  return (
    <Field label={field.label} required={field.required} helper={field.helpText} error={error}>
      {control}
    </Field>
  );
}

/** A section's fields, laid out in a two-column grid where they fit. */
export function SectionFields({
  section,
  values,
  onChange,
  errors = {},
  disabled,
}: {
  section: TemplateSection;
  values: DraftAnswers;
  onChange: (key: string, value: AnswerValue | undefined) => void;
  errors?: Record<string, string>;
  disabled?: boolean;
}) {
  if (!section.fields.length) {
    return <p className="text-[13px] text-muted-foreground">No fields in this section yet.</p>;
  }
  return (
    <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
      {section.fields.map((field) => (
        <div
          key={field.key}
          className={cn(
            'grid',
            (field.type === 'TEXTAREA' ||
              field.type === 'MULTI_SELECT' ||
              field.type === 'RADIO') &&
              'sm:col-span-2',
          )}
          data-field={field.key}
        >
          <FieldInput
            field={field}
            value={values[field.key]}
            onChange={(v) => onChange(field.key, v)}
            error={errors[field.key]}
            disabled={disabled}
          />
        </div>
      ))}
    </div>
  );
}

/** An answer as text, using the option labels of the version it was given in. */
export function formatAnswer(field: TemplateField, value: AnswerValue): string {
  const label = (v: string) => field.options?.find((o) => o.value === v)?.label ?? v;
  switch (field.type) {
    case 'SINGLE_SELECT':
    case 'RADIO':
      return label(String(value));
    case 'MULTI_SELECT':
      return (Array.isArray(value) ? value : [String(value)]).map(label).join(', ');
    case 'CHECKBOX':
      return value === true ? 'Yes' : '';
    case 'DATE':
      return typeof value === 'string' ? formatDate(value) : String(value);
    default:
      return String(value);
  }
}

/**
 * Answers shown back, section by section. Unanswered questions are listed as "Not
 * recorded" rather than left out or shown as blank findings, so it's clear what wasn't
 * assessed.
 */
export function AnswersView({
  definition,
  answers,
  compact = false,
}: {
  definition: TemplateDefinition;
  answers: Answers;
  /** Print layout: list unanswered questions in one line per section */
  compact?: boolean;
}) {
  return (
    <div className="grid gap-6">
      {definition.sections.map((section) => {
        const answered = section.fields.filter((f) => isAnswered(answers[f.key]));
        const missing = section.fields.filter((f) => !isAnswered(answers[f.key]));
        return (
          <section key={section.key} className="grid gap-3 break-inside-avoid-page">
            <h3 className="text-card-title">{section.title}</h3>
            {answered.length === 0 && (
              <p className="text-[13px] text-muted-foreground italic">
                Nothing recorded in this section.
              </p>
            )}
            {answered.length > 0 && (
              <dl className="grid gap-3">
                {answered.map((f) => (
                  <div key={f.key} className="grid gap-0.5">
                    <dt className="text-[13px] text-muted-foreground">{f.label}</dt>
                    <dd className="text-sm whitespace-pre-line">
                      {formatAnswer(f, answers[f.key])}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {missing.length > 0 && answered.length > 0 && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">Not recorded{compact ? ':' : ''}</span>
                {compact ? ' ' : ': '}
                {missing.map((f) => f.label).join(', ')}
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}
