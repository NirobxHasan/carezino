import { parseIsoDate } from '../common/time';

/**
 * The dynamic form engine: the one schema template definitions and answers are checked
 * against, shared by assessment templates and session note templates (each keeps its
 * own versioned template tables). Definitions are plain data (labels, types, options
 * and limits), never code: nothing here evaluates expressions, HTML or scripts, and
 * unknown properties are rejected rather than stored. Pure functions, so the rules can
 * be tested without a database.
 *
 * Errors are maps of field paths to messages, like the API's validation errors, e.g.
 * { 'definition.sections.0.fields.2.options': 'Add at least 2 options' } or
 * { 'answers.chief_concern': 'Chief concern is required' }.
 */

export const FIELD_TYPES = [
  'TEXT',
  'TEXTAREA',
  'NUMBER',
  'SINGLE_SELECT',
  'MULTI_SELECT',
  'RADIO',
  'CHECKBOX',
  'DATE',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** Types answered by picking from the field's options. */
export const OPTION_TYPES: readonly FieldType[] = [
  'SINGLE_SELECT',
  'MULTI_SELECT',
  'RADIO',
];
const TEXT_TYPES: readonly FieldType[] = ['TEXT', 'TEXTAREA'];

export const DEFINITION_LIMITS = {
  sections: 30,
  fieldsPerSection: 60,
  fields: 200,
  optionsPerField: 50,
  keyLength: 40,
  optionValueLength: 60,
  titleLength: 120,
  labelLength: 200,
  optionLabelLength: 120,
  helpTextLength: 500,
  placeholderLength: 200,
  sectionDescriptionLength: 500,
  /** Default and largest maxLength for TEXT and TEXTAREA answers */
  text: { default: 500, max: 2000 },
  textarea: { default: 5000, max: 20_000 },
  /** Largest absolute value a NUMBER answer or limit may have */
  number: 1_000_000_000,
} as const;

export interface FieldOption {
  /** Stable stored value, e.g. "fine_motor" */
  value: string;
  label: string;
}

/** Limits a template author can set; which ones apply depends on the field type. */
export interface FieldValidation {
  /** TEXT, TEXTAREA */
  minLength?: number;
  maxLength?: number;
  /** NUMBER */
  min?: number;
  max?: number;
  integer?: boolean;
  /** MULTI_SELECT */
  minSelections?: number;
  maxSelections?: number;
}

export interface TemplateField {
  /** Stable identifier answers are stored under, unique within the template */
  key: string;
  type: FieldType;
  label: string;
  helpText?: string;
  /** TEXT, TEXTAREA and NUMBER only */
  placeholder?: string;
  /** Must be answered before the assessment can be completed */
  required: boolean;
  /** SINGLE_SELECT, MULTI_SELECT and RADIO only */
  options?: FieldOption[];
  /** Pre-filled in new assessments; never for DATE */
  defaultValue?: Answer;
  validation?: FieldValidation;
}

export interface TemplateSection {
  key: string;
  title: string;
  description?: string;
  fields: TemplateField[];
}

export interface TemplateDefinition {
  sections: TemplateSection[];
}

/** TEXT/TEXTAREA/SINGLE_SELECT/RADIO/DATE: string; NUMBER: number; MULTI: string[]; CHECKBOX: true */
export type Answer = string | number | boolean | string[];
export type Answers = Record<string, Answer>;

export type Errors = Record<string, string>;

const KEY = /^[a-z][a-z0-9_]*$/;
const OPTION_VALUE = /^[a-z0-9][a-z0-9_]*$/;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Postgres can't store NUL characters in text or JSONB. */
function clean(value: string) {
  return value.replaceAll(String.fromCharCode(0), '').trim();
}

const SECTION_PROPS = new Set(['key', 'title', 'description', 'fields']);
const FIELD_PROPS = new Set([
  'key',
  'type',
  'label',
  'helpText',
  'placeholder',
  'required',
  'options',
  'defaultValue',
  'validation',
]);
const VALIDATION_PROPS: Record<FieldType, readonly (keyof FieldValidation)[]> =
  {
    TEXT: ['minLength', 'maxLength'],
    TEXTAREA: ['minLength', 'maxLength'],
    NUMBER: ['min', 'max', 'integer'],
    SINGLE_SELECT: [],
    MULTI_SELECT: ['minSelections', 'maxSelections'],
    RADIO: [],
    CHECKBOX: [],
    DATE: [],
  };

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  TEXT: 'Short text',
  TEXTAREA: 'Long text',
  NUMBER: 'Number',
  SINGLE_SELECT: 'Dropdown',
  MULTI_SELECT: 'Multi-select',
  RADIO: 'Single choice',
  CHECKBOX: 'Checkbox',
  DATE: 'Date',
};

class Collector {
  errors: Errors = {};
  add(path: string, message: string) {
    this.errors[path] ??= message;
  }
  get ok() {
    return Object.keys(this.errors).length === 0;
  }
}

/** A required or optional plain-text property, trimmed; undefined when absent or empty. */
function text(
  raw: Json,
  prop: string,
  path: string,
  max: number,
  out: Collector,
  { required = false, label = 'This' } = {},
): string | undefined {
  const value = raw[prop];
  if (value === undefined || value === null) {
    if (required) out.add(`${path}.${prop}`, `${label} is required`);
    return undefined;
  }
  if (typeof value !== 'string') {
    out.add(`${path}.${prop}`, 'Enter text');
    return undefined;
  }
  const trimmed = clean(value);
  if (!trimmed) {
    if (required) out.add(`${path}.${prop}`, `${label} is required`);
    return undefined;
  }
  if (trimmed.length > max) {
    out.add(`${path}.${prop}`, `Use up to ${max} characters`);
    return undefined;
  }
  return trimmed;
}

function wholeNumber(value: unknown, min: number, max: number) {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  );
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseValidation(
  raw: unknown,
  type: FieldType,
  path: string,
  optionCount: number,
  out: Collector,
): FieldValidation | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isObject(raw)) {
    out.add(path, 'Invalid limits');
    return undefined;
  }
  const allowed = VALIDATION_PROPS[type];
  for (const prop of Object.keys(raw)) {
    if (!allowed.includes(prop as keyof FieldValidation)) {
      out.add(
        `${path}.${prop}`,
        `Not a limit a ${FIELD_TYPE_LABELS[type].toLowerCase()} field can have`,
      );
    }
  }
  const v: FieldValidation = {};
  if (TEXT_TYPES.includes(type)) {
    const cap =
      type === 'TEXT'
        ? DEFINITION_LIMITS.text.max
        : DEFINITION_LIMITS.textarea.max;
    for (const prop of ['minLength', 'maxLength'] as const) {
      if (raw[prop] === undefined || raw[prop] === null) continue;
      if (!wholeNumber(raw[prop], prop === 'minLength' ? 0 : 1, cap)) {
        out.add(`${path}.${prop}`, `Enter a whole number up to ${cap}`);
      } else v[prop] = raw[prop] as number;
    }
    if (
      v.minLength !== undefined &&
      v.maxLength !== undefined &&
      v.minLength > v.maxLength
    ) {
      out.add(`${path}.minLength`, 'Must not be more than the maximum');
    }
  }
  if (type === 'NUMBER') {
    for (const prop of ['min', 'max'] as const) {
      if (raw[prop] === undefined || raw[prop] === null) continue;
      if (
        !finite(raw[prop]) ||
        Math.abs(raw[prop]) > DEFINITION_LIMITS.number
      ) {
        out.add(`${path}.${prop}`, 'Enter a number');
      } else v[prop] = raw[prop];
    }
    if (v.min !== undefined && v.max !== undefined && v.min > v.max) {
      out.add(`${path}.min`, 'Must not be more than the maximum');
    }
    if (raw.integer !== undefined && raw.integer !== null) {
      if (typeof raw.integer !== 'boolean')
        out.add(`${path}.integer`, 'Choose yes or no');
      else if (raw.integer) v.integer = true;
    }
  }
  if (type === 'MULTI_SELECT') {
    for (const prop of ['minSelections', 'maxSelections'] as const) {
      if (raw[prop] === undefined || raw[prop] === null) continue;
      if (!wholeNumber(raw[prop], 1, Math.max(1, optionCount))) {
        out.add(
          `${path}.${prop}`,
          `Enter a whole number from 1 to ${Math.max(1, optionCount)}`,
        );
      } else v[prop] = raw[prop] as number;
    }
    if (
      v.minSelections !== undefined &&
      v.maxSelections !== undefined &&
      v.minSelections > v.maxSelections
    ) {
      out.add(`${path}.minSelections`, 'Must not be more than the maximum');
    }
  }
  return Object.keys(v).length ? v : undefined;
}

function parseOptions(
  raw: unknown,
  path: string,
  out: Collector,
): FieldOption[] | undefined {
  if (!Array.isArray(raw)) {
    out.add(path, 'Add at least 2 options');
    return undefined;
  }
  if (raw.length < 2) out.add(path, 'Add at least 2 options');
  if (raw.length > DEFINITION_LIMITS.optionsPerField) {
    out.add(path, `Use up to ${DEFINITION_LIMITS.optionsPerField} options`);
    return undefined;
  }
  const values = new Set<string>();
  const labels = new Set<string>();
  const options: FieldOption[] = [];
  raw.forEach((o: unknown, i) => {
    const at = `${path}.${i}`;
    if (!isObject(o)) {
      out.add(at, 'Invalid option');
      return;
    }
    for (const prop of Object.keys(o)) {
      if (prop !== 'value' && prop !== 'label')
        out.add(`${at}.${prop}`, 'Unknown setting');
    }
    const label = text(
      o,
      'label',
      at,
      DEFINITION_LIMITS.optionLabelLength,
      out,
      {
        required: true,
        label: 'Option label',
      },
    );
    const value = o.value;
    if (
      typeof value !== 'string' ||
      !OPTION_VALUE.test(value) ||
      value.length > DEFINITION_LIMITS.optionValueLength
    ) {
      out.add(`${at}.value`, 'Use lower-case letters, digits and underscores');
      return;
    }
    if (values.has(value))
      out.add(`${at}.value`, 'Each option needs its own value');
    values.add(value);
    if (label) {
      if (labels.has(label.toLowerCase()))
        out.add(`${at}.label`, 'This option is listed twice');
      labels.add(label.toLowerCase());
      options.push({ value, label });
    }
  });
  return options;
}

function parseField(
  raw: unknown,
  path: string,
  keys: Set<string>,
  out: Collector,
): TemplateField | null {
  if (!isObject(raw)) {
    out.add(path, 'Invalid field');
    return null;
  }
  for (const prop of Object.keys(raw)) {
    if (!FIELD_PROPS.has(prop)) out.add(`${path}.${prop}`, 'Unknown setting');
  }
  const key = raw.key;
  if (
    typeof key !== 'string' ||
    !KEY.test(key) ||
    key.length > DEFINITION_LIMITS.keyLength
  ) {
    out.add(
      `${path}.key`,
      'Use a lower-case identifier: letters, digits and underscores, starting with a letter',
    );
    return null;
  }
  if (keys.has(key))
    out.add(`${path}.key`, 'Another field already uses this identifier');
  keys.add(key);

  const type = raw.type;
  if (typeof type !== 'string' || !FIELD_TYPES.includes(type as FieldType)) {
    out.add(`${path}.type`, 'Choose a supported field type');
    return null;
  }
  const t = type as FieldType;
  const label = text(raw, 'label', path, DEFINITION_LIMITS.labelLength, out, {
    required: true,
    label: 'Label',
  });
  const helpText = text(
    raw,
    'helpText',
    path,
    DEFINITION_LIMITS.helpTextLength,
    out,
  );
  let placeholder = text(
    raw,
    'placeholder',
    path,
    DEFINITION_LIMITS.placeholderLength,
    out,
  );
  if (placeholder && !['TEXT', 'TEXTAREA', 'NUMBER'].includes(t)) {
    out.add(
      `${path}.placeholder`,
      'Only text and number fields have a placeholder',
    );
    placeholder = undefined;
  }
  if (
    raw.required !== undefined &&
    raw.required !== null &&
    typeof raw.required !== 'boolean'
  ) {
    out.add(`${path}.required`, 'Choose required or optional');
  }
  let options: FieldOption[] | undefined;
  if (OPTION_TYPES.includes(t)) {
    options = parseOptions(raw.options, `${path}.options`, out);
  } else if (raw.options !== undefined && raw.options !== null) {
    out.add(`${path}.options`, 'Only choice fields have options');
  }
  const validation = parseValidation(
    raw.validation,
    t,
    `${path}.validation`,
    options?.length ?? 0,
    out,
  );
  const field: TemplateField = {
    key,
    type: t,
    label: label ?? '',
    ...(helpText && { helpText }),
    ...(placeholder && { placeholder }),
    required: raw.required === true,
    ...(options && { options }),
    ...(validation && { validation }),
  };
  if (raw.defaultValue !== undefined && raw.defaultValue !== null) {
    if (t === 'DATE') {
      out.add(`${path}.defaultValue`, 'Date fields can’t have a default');
    } else {
      const check = new Collector();
      const value = answerFor(
        field,
        raw.defaultValue,
        `${path}.defaultValue`,
        check,
      );
      for (const [p, m] of Object.entries(check.errors)) out.add(p, m);
      if (value !== undefined) field.defaultValue = value;
    }
  }
  return field;
}

/**
 * Checks and normalizes a template definition. Drafts may be unfinished (no sections,
 * or sections without fields); with `forPublish` every section needs a field.
 */
export function parseDefinition(
  input: unknown,
  { forPublish = false, path = 'definition' } = {},
):
  | { definition: TemplateDefinition; errors: null }
  | { definition: null; errors: Errors } {
  const out = new Collector();
  if (!isObject(input) || !Array.isArray(input.sections)) {
    out.add(path, 'Invalid form definition');
    return { definition: null, errors: out.errors };
  }
  for (const prop of Object.keys(input)) {
    if (prop !== 'sections') out.add(`${path}.${prop}`, 'Unknown setting');
  }
  const raw = input.sections as unknown[];
  if (raw.length > DEFINITION_LIMITS.sections) {
    out.add(
      `${path}.sections`,
      `Use up to ${DEFINITION_LIMITS.sections} sections`,
    );
    return { definition: null, errors: out.errors };
  }
  if (forPublish && raw.length === 0) {
    out.add(`${path}.sections`, 'Add at least one section before publishing');
  }
  const sectionKeys = new Set<string>();
  const fieldKeys = new Set<string>();
  let fieldCount = 0;
  const sections: TemplateSection[] = [];
  raw.forEach((s, i) => {
    const at = `${path}.sections.${i}`;
    if (!isObject(s)) {
      out.add(at, 'Invalid section');
      return;
    }
    for (const prop of Object.keys(s)) {
      if (!SECTION_PROPS.has(prop)) out.add(`${at}.${prop}`, 'Unknown setting');
    }
    const key = s.key;
    if (
      typeof key !== 'string' ||
      !KEY.test(key) ||
      key.length > DEFINITION_LIMITS.keyLength
    ) {
      out.add(`${at}.key`, 'Invalid section identifier');
      return;
    }
    if (sectionKeys.has(key))
      out.add(`${at}.key`, 'Another section already uses this identifier');
    sectionKeys.add(key);
    const title = text(s, 'title', at, DEFINITION_LIMITS.titleLength, out, {
      required: true,
      label: 'Section title',
    });
    const description = text(
      s,
      'description',
      at,
      DEFINITION_LIMITS.sectionDescriptionLength,
      out,
    );
    if (!Array.isArray(s.fields)) {
      out.add(`${at}.fields`, 'Invalid fields');
      return;
    }
    if (s.fields.length > DEFINITION_LIMITS.fieldsPerSection) {
      out.add(
        `${at}.fields`,
        `Use up to ${DEFINITION_LIMITS.fieldsPerSection} fields per section`,
      );
      return;
    }
    if (forPublish && s.fields.length === 0) {
      out.add(`${at}.fields`, 'Add at least one field, or remove this section');
    }
    fieldCount += s.fields.length;
    const fields = (s.fields as unknown[])
      .map((f, j) => parseField(f, `${at}.fields.${j}`, fieldKeys, out))
      .filter((f): f is TemplateField => f !== null);
    sections.push({
      key,
      title: title ?? '',
      ...(description && { description }),
      fields,
    });
  });
  if (fieldCount > DEFINITION_LIMITS.fields) {
    out.add(
      `${path}.sections`,
      `Use up to ${DEFINITION_LIMITS.fields} fields in one template`,
    );
  }
  return out.ok
    ? { definition: { sections }, errors: null }
    : { definition: null, errors: out.errors };
}

/**
 * A field kept across versions must keep its type, so answers stored under one key
 * always mean the same kind of thing. `earlier` are the template's published forms.
 */
export function typeChanges(
  next: TemplateDefinition,
  earlier: TemplateDefinition[],
  path = 'definition',
): Errors {
  const types = new Map<string, FieldType>();
  for (const d of earlier) {
    for (const f of allFields(d)) types.set(f.key, f.type);
  }
  const errors: Errors = {};
  next.sections.forEach((s, i) =>
    s.fields.forEach((f, j) => {
      const before = types.get(f.key);
      if (before && before !== f.type) {
        errors[`${path}.sections.${i}.fields.${j}.type`] =
          `“${f.label}” was a ${FIELD_TYPE_LABELS[before].toLowerCase()} field in an earlier version. Add a new field instead of changing its type.`;
      }
    }),
  );
  return errors;
}

export function allFields(definition: TemplateDefinition) {
  return definition.sections.flatMap((s) => s.fields);
}

/** Stored definitions were checked when saved; this only narrows the type. */
export function storedDefinition(value: unknown): TemplateDefinition {
  return value as TemplateDefinition;
}

/** Values that mean "not answered": never stored, so unanswered stays distinguishable. */
function isEmpty(value: unknown) {
  return (
    value === undefined ||
    value === null ||
    value === false ||
    (typeof value === 'string' && clean(value) === '') ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** One answer, checked against its field. Undefined when empty or invalid. */
function answerFor(
  field: TemplateField,
  value: unknown,
  path: string,
  out: Collector,
): Answer | undefined {
  if (isEmpty(value)) return undefined;
  const v = field.validation ?? {};
  switch (field.type) {
    case 'TEXT':
    case 'TEXTAREA': {
      if (typeof value !== 'string') {
        out.add(path, 'Enter text');
        return undefined;
      }
      const s = clean(value);
      const max =
        v.maxLength ??
        (field.type === 'TEXT'
          ? DEFINITION_LIMITS.text.default
          : DEFINITION_LIMITS.textarea.default);
      if (s.length > max) {
        out.add(path, `Use up to ${max} characters`);
        return undefined;
      }
      if (v.minLength !== undefined && s.length < v.minLength) {
        out.add(path, `Use at least ${v.minLength} characters`);
        return undefined;
      }
      return s;
    }
    case 'NUMBER': {
      if (!finite(value) || Math.abs(value) > DEFINITION_LIMITS.number) {
        out.add(path, 'Enter a number');
        return undefined;
      }
      if (v.integer && !Number.isInteger(value)) {
        out.add(path, 'Enter a whole number');
        return undefined;
      }
      if (v.min !== undefined && value < v.min) {
        out.add(path, `Enter ${v.min} or more`);
        return undefined;
      }
      if (v.max !== undefined && value > v.max) {
        out.add(path, `Enter ${v.max} or less`);
        return undefined;
      }
      return value;
    }
    case 'SINGLE_SELECT':
    case 'RADIO': {
      if (
        typeof value !== 'string' ||
        !field.options?.some((o) => o.value === value)
      ) {
        out.add(path, 'Choose one of the options');
        return undefined;
      }
      return value;
    }
    case 'MULTI_SELECT': {
      if (!Array.isArray(value) || value.some((x) => typeof x !== 'string')) {
        out.add(path, 'Choose from the options');
        return undefined;
      }
      const picked = new Set(value as string[]);
      if (picked.size !== value.length) {
        out.add(path, 'An option is chosen twice');
        return undefined;
      }
      const options = field.options ?? [];
      if ([...picked].some((x) => !options.some((o) => o.value === x))) {
        out.add(path, 'Choose from the options');
        return undefined;
      }
      if (v.minSelections !== undefined && picked.size < v.minSelections) {
        out.add(path, `Choose at least ${v.minSelections}`);
        return undefined;
      }
      if (v.maxSelections !== undefined && picked.size > v.maxSelections) {
        out.add(path, `Choose up to ${v.maxSelections}`);
        return undefined;
      }
      // Stored in the form's order, so equal answers compare equal.
      return options.filter((o) => picked.has(o.value)).map((o) => o.value);
    }
    case 'CHECKBOX': {
      if (value !== true) {
        out.add(path, 'Check or uncheck the box');
        return undefined;
      }
      return true;
    }
    case 'DATE': {
      if (typeof value !== 'string' || !parseIsoDate(value)) {
        out.add(path, 'Choose a valid date');
        return undefined;
      }
      return value;
    }
  }
}

/**
 * Checks answers against the template version they belong to. Unknown keys and values
 * of the wrong kind are always rejected; required fields only when `complete`, since
 * drafts may be unfinished. Empty answers are dropped.
 */
export function validateAnswers(
  definition: TemplateDefinition,
  input: unknown,
  { complete = false, path = 'answers' } = {},
): { answers: Answers; errors: Errors | null } {
  const out = new Collector();
  const answers: Answers = {};
  if (!isObject(input)) {
    out.add(path, 'Invalid answers');
    return { answers, errors: out.errors };
  }
  const fields = new Map(allFields(definition).map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(input)) {
    const field = fields.get(key);
    if (!field) {
      out.add(`${path}.${key}`, 'This question isn’t part of the form');
      continue;
    }
    const answer = answerFor(field, value, `${path}.${key}`, out);
    if (answer !== undefined) answers[key] = answer;
  }
  if (complete) {
    for (const field of fields.values()) {
      if (field.required && answers[field.key] === undefined) {
        out.add(
          `${path}.${field.key}`,
          field.type === 'CHECKBOX'
            ? `“${field.label}” must be checked`
            : `${field.label} is required`,
        );
      }
    }
  }
  return { answers, errors: out.ok ? null : out.errors };
}

/** What a new assessment starts with: the template's default answers. */
export function defaultAnswers(definition: TemplateDefinition): Answers {
  const answers: Answers = {};
  for (const f of allFields(definition)) {
    if (f.defaultValue !== undefined) answers[f.key] = f.defaultValue;
  }
  return answers;
}

/** Labels of the fields whose answers differ, in form order. */
export function changedAnswerLabels(
  definition: TemplateDefinition,
  before: Answers,
  after: Answers,
) {
  return allFields(definition)
    .filter(
      (f) => JSON.stringify(before[f.key]) !== JSON.stringify(after[f.key]),
    )
    .map((f) => f.label);
}

export function fieldCount(definition: TemplateDefinition) {
  return allFields(definition).length;
}
